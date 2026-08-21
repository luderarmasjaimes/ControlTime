#include "mining_chatbot_service.hpp"
#include "whatsapp_client.hpp"
#include "../config/app_config.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;

using config::AppConfig;

#define gOllamaChatbotModel     AppConfig::instance().gOllamaChatbotModel
#define gWhatsappSupportToE164  AppConfig::instance().gWhatsappSupportToE164
#define gWhatsappTemplateName   AppConfig::instance().gWhatsappTemplateName
#define gWhatsappTemplateLang   AppConfig::instance().gWhatsappTemplateLang

namespace support {

namespace {

// Config propia del chatbot (separada de text_spell_service.cpp -- mismo
// BEEMETRY_OLLAMA_URL, pero cada modulo mantiene su propia copia minima del
// cliente HTTP, convencion ya establecida en este codebase).
std::string gOllamaBase;
int gOllamaChatTimeoutMs = 60000;
/** Ver support::chatbotNumCtx() en el .hpp: sin esto Ollama aplicaba su
 * default por VRAM (4096 en este stack) y truncaba el prompt por su cuenta. */
int gOllamaChatNumCtx = 8192;
bool gConfigured = false;

std::string getenvOr(const char *key, const std::string &def) {
  const char *v = std::getenv(key);
  return v ? std::string(v) : def;
}

void ensureConfigured() {
  if (gConfigured) return;
  gOllamaBase = getenvOr("BEEMETRY_OLLAMA_URL", "");
  try {
    gOllamaChatTimeoutMs =
        std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_CHATBOT_TIMEOUT_MS", "60000")), 5000, 180000);
  } catch (...) {
    gOllamaChatTimeoutMs = 60000;
  }
  try {
    gOllamaChatNumCtx =
        std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_CHATBOT_NUM_CTX", "8192")), 2048, 32768);
  } catch (...) {
    gOllamaChatNumCtx = 8192;
  }
  gConfigured = true;
}

struct ParsedHttpEndpoint {
  std::string host;
  std::string port = "80";
  std::string target = "/";
};

bool parseHttpEndpoint(const std::string &url, ParsedHttpEndpoint &out) {
  static const std::regex kHttpRegex(
      R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
      std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpRegex)) {
    return false;
  }
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched) {
    out.port = m[2].str();
  }
  if (m.size() > 3 && m[3].matched && !m[3].str().empty()) {
    out.target = m[3].str();
  }
  return !out.host.empty();
}

struct HttpResult {
  int status = 0;
  std::string body;
  std::string error;
  bool ok() const { return error.empty() && status == 200; }
};

HttpResult httpPostJson(const std::string &fullUrl, const std::string &jsonBody, int timeoutMs) {
  HttpResult out;
  ParsedHttpEndpoint ep;
  if (!parseHttpEndpoint(fullUrl, ep)) {
    out.error = "invalid_url";
    return out;
  }
  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(timeoutMs));

  auto const results = resolver.resolve(ep.host, ep.port, ec);
  if (ec) {
    out.error = "resolve_failed";
    return out;
  }
  stream.connect(results, ec);
  if (ec) {
    out.error = "connect_failed";
    return out;
  }

  http::request<http::string_body> req{http::verb::post, ep.target, 11};
  req.set(http::field::host, ep.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "application/json");
  req.body() = jsonBody;
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    out.error = "write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
  if (ec && ec != beast::errc::not_connected) {
    out.error = "read_failed";
    return out;
  }
  out.status = static_cast<int>(res.result_int());
  out.body = res.body();
  return out;
}

std::string trimCopy(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
  return s;
}

std::string getStringField(const json::object &o, const char *key, const std::string &def = "") {
  return o.contains(key) && o.at(key).is_string() ? json::value_to<std::string>(o.at(key)) : def;
}

/** true si el codepoint cae en los rangos CJK unificados/extensión A que se
 * han visto filtrarse en respuestas de qwen2.5:7b/gemma2:2b en español. */
bool isCjkCodepoint(std::uint32_t codepoint) {
  return (codepoint >= 0x4E00 && codepoint <= 0x9FFF) ||
         (codepoint >= 0x3400 && codepoint <= 0x4DBF);
}

/** true si `text` contiene al menos un carácter CJK -- decodifica UTF-8 a
 * mano (sin depender de locale/ICU, consistente con el resto del backend). */
bool textHasCjk(const std::string &text) {
  for (std::size_t i = 0; i < text.size();) {
    unsigned char c = static_cast<unsigned char>(text[i]);
    std::uint32_t codepoint = 0;
    std::size_t len = 1;
    if ((c & 0x80) == 0) {
      codepoint = c;
      len = 1;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < text.size()) {
      codepoint = (c & 0x1F) << 6 | (static_cast<unsigned char>(text[i + 1]) & 0x3F);
      len = 2;
    } else if ((c & 0xF0) == 0xE0 && i + 2 < text.size()) {
      codepoint = (c & 0x0F) << 12 |
                  (static_cast<unsigned char>(text[i + 1]) & 0x3F) << 6 |
                  (static_cast<unsigned char>(text[i + 2]) & 0x3F);
      len = 3;
    } else if ((c & 0xF8) == 0xF0 && i + 3 < text.size()) {
      len = 4;
    }
    if (isCjkCodepoint(codepoint)) {
      return true;
    }
    i += len;
  }
  return false;
}

/**
 * qwen2.5:7b/gemma2:2b filtran ocasionalmente texto en chino dentro de una
 * respuesta en español (ya documentado en text_spell_service.cpp para
 * /api/text/rewrite, ~2/20 corridas en el benchmark de 2026-07-22) -- ahí
 * importaba menos por ser una tarea puntual, pero en un chat conversacional
 * en vivo es directamente visible para el usuario. Se descartan por completo
 * las líneas que contengan al menos un carácter CJK en vez de confiar en que
 * el prompt (instrucción "solo español") baste -- nunca se confía ciegamente
 * en la obediencia del LLM.
 */
std::string stripCjkLines(const std::string &text) {
  std::istringstream lines(text);
  std::ostringstream out;
  std::string line;
  bool first = true;
  while (std::getline(lines, line)) {
    if (textHasCjk(line)) continue;
    if (!first) out << "\n";
    out << line;
    first = false;
  }
  return out.str();
}

/**
 * Prompt de sistema con contexto minero real -- responde SOLO sobre el
 * dominio de la plataforma (sensores geotécnicos/geoespaciales/ambientales/
 * hídricos, sismicidad IGP/CENSIS, reportabilidad) y sobre minería en
 * general; ante temas fuera de alcance o preguntas que requieran datos
 * específicos de la cuenta que no tiene, debe indicar que escalará a un
 * asesor humano en vez de inventar una respuesta.
 */
std::string buildSystemPrompt(const json::object &qualifying) {
  std::ostringstream oss;
  oss << "Eres el asistente virtual de soporte de Beemetry, una plataforma de monitoreo minero "
         "(sensores geotecnicos: inclinometros, piezometros, radar de taludes GB-SAR; "
         "geoespaciales: GPS geodesico; ambientales: PM10, CO2; hidrologicos: nivel de relaves, "
         "pH, caudal; y sismicidad oficial IGP/CENSIS combinada con microsismicidad propia). "
         "Respondes en espanol, de forma breve, clara y profesional, con terminologia minera "
         "correcta. Si la pregunta requiere datos especificos de la cuenta del cliente que no "
         "tienes (facturacion, incidentes puntuales, configuracion de su tenant), o el usuario "
         "insiste en hablar con una persona, dile explicitamente que puede pulsar el boton "
         "'Hablar con soporte humano por WhatsApp' -- nunca inventes datos que no tienes.";
  const std::string name = getStringField(qualifying, "name");
  const std::string company = getStringField(qualifying, "company");
  const std::string topic = getStringField(qualifying, "topic");
  const std::string urgency = getStringField(qualifying, "urgency");
  const std::string description = getStringField(qualifying, "description");
  if (!name.empty() || !company.empty() || !topic.empty()) {
    oss << " Contexto de este usuario -- nombre: \"" << name << "\", empresa/unidad: \""
        << company << "\", motivo de consulta: \"" << topic << "\", urgencia: \"" << urgency
        << "\", descripcion: \"" << description << "\". Usa este contexto, no vuelvas a pedirlo.";
  }
  oss << " Si el usuario pregunta por sensores instalados (piezometros, inclinometros, radares, "
         "GPS, sensores ambientales/hidrologicos, etc.), la respuesta REAL de la base de datos de "
         "su unidad minera viene mas abajo bajo 'DATOS REALES DE SENSORES' cuando corresponde -- "
         "usala directamente y en ningun caso le pidas al usuario que te de el numero de sensor o "
         "la ubicacion para 'poder buscarlo': el sistema ya hizo esa busqueda por el.";
  return oss.str();
}

/**
 * Normaliza un mensaje del usuario para la deteccion de tema: minusculas ASCII
 * + plegado de las tildes/dieresis/enie del espanol (UTF-8 de 2 bytes) a su
 * letra base. Sin el plegado, "PIEZOMETROS" escrito como "PIEZÓMETROS" no
 * matcheaba ningun patron (std::tolower no toca bytes multibyte), y el usuario
 * se quedaba sin los datos reales de sus sensores por una tilde.
 */
std::string normalizeForTopic(const std::string &s) {
  std::string out;
  out.reserve(s.size());
  for (std::size_t i = 0; i < s.size();) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (c == 0xC3 && i + 1 < s.size()) {
      const unsigned char d = static_cast<unsigned char>(s[i + 1]);
      // U+00C0..U+00FF en UTF-8 son 0xC3 seguido de 0x80..0xBF.
      switch (d) {
        case 0xA1: case 0x81: out += 'a'; i += 2; continue; // á Á
        case 0xA9: case 0x89: out += 'e'; i += 2; continue; // é É
        case 0xAD: case 0x8D: out += 'i'; i += 2; continue; // í Í
        case 0xB3: case 0x93: out += 'o'; i += 2; continue; // ó Ó
        case 0xBA: case 0x9A: out += 'u'; i += 2; continue; // ú Ú
        case 0xBC: case 0x9C: out += 'u'; i += 2; continue; // ü Ü
        case 0xB1: case 0x91: out += 'n'; i += 2; continue; // ñ Ñ
        default: break;
      }
    }
    out += static_cast<char>(std::tolower(c));
    ++i;
  }
  return out;
}

bool containsAny(const std::string &haystackLower, const std::vector<std::string> &needles) {
  for (const auto &n : needles) {
    if (haystackLower.find(n) != std::string::npos) return true;
  }
  return false;
}

/**
 * Detecta a que categoria de sensor se refiere un mensaje del usuario (si a
 * alguna) y devuelve los patrones ILIKE a aplicar contra el nombre del TIPO de
 * sensor o del sensor mismo en la base de datos. Los nombres de tipo NO son
 * consistentes entre distintos origenes de siembra de datos de este proyecto
 * (p.ej. dashboard.sql usa "Piezometro", pero los datos reales sembrados en
 * Postgres usan "Presion poros") -- por eso se matchea por substrings/
 * sinonimos en vez de un nombre exacto unico.
 *
 * `message` debe venir ya normalizado por normalizeForTopic() (minusculas y
 * sin tildes), por eso las palabras clave se listan sin acentuar.
 */
std::vector<std::string> sensorLikePatternsForMessage(const std::string &message) {
  static const std::vector<std::pair<std::vector<std::string>, std::vector<std::string>>> kGroups = {
      {{"piezometro", "piezometros"}, {"%piez%", "%poros%"}},
      {{"inclinometro", "inclinometros", "inclinacion"}, {"%inclin%"}},
      {{"extensometro", "extensometros"}, {"%extens%"}},
      {{"radar", "gb-sar", "gbsar", "talud"}, {"%radar%", "%talud%"}},
      {{"gps", "geodesico"}, {"%gps%", "%geodes%"}},
      {{"relaves", "relave"}, {"%relave%"}},
      {{" ph ", "de ph", "nivel de ph"}, {"%ph%"}},
      {{"caudal", "caudalimetro"}, {"%caudal%"}},
      {{"pm10", "particulas", "polvo"}, {"%pm10%", "%polvo%", "%particul%"}},
      {{"co2", "gas "}, {"%co2%", "%gas%"}},
      {{"vibracion", "molino"}, {"%vibrac%", "%molino%"}},
      {{"temperatura"}, {"%temp%"}},
      {{"ruido"}, {"%ruido%"}},
      {{"tuberia"}, {"%tuber%"}},
  };
  for (const auto &group : kGroups) {
    if (containsAny(message, group.first)) {
      return group.second;
    }
  }
  return {};
}

bool messageAsksAboutSensorsGeneric(const std::string &message) {
  static const std::vector<std::string> kGeneric = {
      "sensor", "sensores", "telemetria", "instalado", "instalados", "equipo", "equipos"};
  return containsAny(message, kGeneric);
}

/** Tema de sensores vigente en la conversacion (patrones ILIKE o "todos"). */
struct SensorTopic {
  std::vector<std::string> patterns;
  bool generic = false;
  bool active() const { return !patterns.empty() || generic; }
};

/** Cuantos mensajes del usuario hacia atras se consideran "el tema vigente". */
constexpr int kTopicLookbackUserMessages = 8;

/**
 * Resuelve el tema mirando el historial, no solo el ULTIMO mensaje.
 *
 * Correccion 2026-08-03 (sintoma 2 del reporte: "si hago una nueva pregunta
 * del tema tratado no responde lo esperado"): antes solo se miraba el ultimo
 * mensaje del usuario, asi que en cuanto el seguimiento no repetia la palabra
 * clave -- "de esos, cual esta en alerta?", "y el valor mas alto?", o
 * cualquiera de los chips Resumir/Ampliar/Ideas -- el bloque 'DATOS REALES DE
 * SENSORES' desaparecia del prompt y el modelo se quedaba sin los datos que
 * acababa de usar. Medido en vivo contra este stack: 2499 tokens de prompt en
 * el turno del listado vs 932 en el seguimiento inmediato.
 *
 * Se recorre de lo mas reciente a lo mas antiguo y gana la primera coincidencia
 * (un cambio de tema explicito del usuario reemplaza al anterior).
 */
SensorTopic resolveSensorTopic(const json::array &messages) {
  int userSeen = 0;
  for (auto it = messages.rbegin(); it != messages.rend(); ++it) {
    if (!it->is_object()) continue;
    const auto &mo = it->as_object();
    if (getStringField(mo, "role", "user") != "user") continue;
    if (++userSeen > kTopicLookbackUserMessages) break;
    const std::string norm = normalizeForTopic(getStringField(mo, "content"));
    auto patterns = sensorLikePatternsForMessage(norm);
    if (!patterns.empty()) return SensorTopic{std::move(patterns), false};
    if (messageAsksAboutSensorsGeneric(norm)) return SensorTopic{{}, true};
  }
  return SensorTopic{};
}

struct SensorRow {
  std::string name;
  std::string typeName;
  std::string status;
  std::string zoneName;
  double currentValue = 0.0;
  bool hasValue = false;
};

/** Consulta real a mining_sensors, scoped por tenant_id de la sesion (nunca
 * del body del cliente -- misma proteccion IDOR que sensor_service.cpp).
 * Lectura via replica si esta configurada, igual que el resto del backend. */
std::vector<SensorRow> fetchMatchingSensors(const std::string &tenantId,
                                            const std::vector<std::string> &likePatterns,
                                            bool genericAll) {
  std::vector<SensorRow> out;
  if (tenantId.empty()) return out;
#if HAS_LIBPQ
  auto lease = storage::PgPool::replica().acquire(config::AppConfig::instance().readUrl());
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return out;

  std::ostringstream sql;
  sql << "SELECT s.name, t.name AS type_name, COALESCE(s.status,''), COALESCE(z.name_es,''), s.current_value "
         "FROM mining_sensors s "
         "JOIN mining_sensor_types t ON t.id = s.type_id "
         "LEFT JOIN mining_sensor_zones z ON z.id = s.zone_id AND z.tenant_id = s.tenant_id "
         "WHERE s.tenant_id = $1::uuid ";
  if (!genericAll && !likePatterns.empty()) {
    sql << "AND (";
    for (std::size_t i = 0; i < likePatterns.size(); ++i) {
      if (i > 0) sql << " OR ";
      sql << "t.name ILIKE $" << (i + 2) << " OR s.name ILIKE $" << (i + 2);
    }
    sql << ") ";
  }
  sql << "ORDER BY t.name, s.name LIMIT 60";

  std::vector<std::string> paramStorage;
  paramStorage.push_back(tenantId);
  if (!genericAll) {
    for (const auto &p : likePatterns) paramStorage.push_back(p);
  }
  std::vector<const char *> params;
  params.reserve(paramStorage.size());
  for (auto &s : paramStorage) params.push_back(s.c_str());

  storage::PgResult res{PQexecParams(conn, sql.str().c_str(), static_cast<int>(paramStorage.size()),
                                     nullptr, params.data(), nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      SensorRow row;
      row.name = PQgetvalue(res.get(), i, 0);
      row.typeName = PQgetvalue(res.get(), i, 1);
      row.status = PQgetvalue(res.get(), i, 2);
      row.zoneName = PQgetvalue(res.get(), i, 3);
      if (!PQgetisnull(res.get(), i, 4)) {
        row.currentValue = std::atof(PQgetvalue(res.get(), i, 4));
        row.hasValue = true;
      }
      out.push_back(std::move(row));
    }
  }
#endif
  return out;
}

std::string formatSensorContext(const std::vector<SensorRow> &rows) {
  std::ostringstream oss;
  if (rows.empty()) {
    oss << "DATOS REALES DE SENSORES (consulta ya ejecutada contra la base de datos de esta "
           "unidad minera): no se encontraron sensores de ese tipo registrados. Informa esto al "
           "usuario de forma directa y breve -- NO inventes sensores ni le pidas mas datos para "
           "'poder buscar', la busqueda real ya se hizo.\n\n";
    return oss.str();
  }
  oss << "DATOS REALES DE SENSORES (consulta ya ejecutada contra la base de datos de esta unidad "
         "minera -- usa EXCLUSIVAMENTE esta lista para responder, nunca le pidas al usuario "
         "numero de sensor o ubicacion, ya los tienes aqui):\n";
  for (const auto &r : rows) {
    oss << "- " << r.name << " (" << r.typeName << ")";
    if (!r.zoneName.empty()) oss << ", zona: " << r.zoneName;
    if (r.hasValue) oss << ", valor actual: " << r.currentValue;
    if (!r.status.empty()) oss << ", estado: " << r.status;
    oss << "\n";
  }
  oss << "\n";
  return oss.str();
}

/**
 * Presupuesto de caracteres del historial que viaja en el prompt. El prompt
 * total = sistema (~1.6k caracteres) + datos reales de sensores (hasta ~5k) +
 * historial; con num_ctx=8192 (~24k caracteres de espanol) queda margen
 * holgado incluso en el peor caso.
 *
 * El tope existe para que sea ESTE codigo el que decida que se descarta y no
 * el runtime de Ollama: cuando el prompt excede num_ctx, Ollama lo trunca por
 * su cuenta descartando el principio -- o sea el prompt de sistema y el bloque
 * 'DATOS REALES DE SENSORES', justamente lo unico que no se puede perder.
 * Recortando aqui los turnos mas antiguos, lo que se pierde es lo menos
 * relevante y de forma explicita (se avisa al modelo con una linea).
 */
constexpr std::size_t kHistoryCharBudget = 9000;

/**
 * Renderiza el historial de lo mas reciente a lo mas antiguo hasta agotar el
 * presupuesto, y lo devuelve en orden cronologico. El ultimo mensaje siempre
 * entra completo aunque exceda el presupuesto: es la peticion actual del
 * usuario (y con los chips Resumir/Ampliar lleva incrustado el texto a
 * procesar), asi que recortarlo seria exactamente el bug que se corrige.
 */
std::vector<std::string> renderHistoryWithinBudget(const json::array &messages, bool &trimmedOut) {
  std::vector<std::string> reversed;
  std::size_t used = 0;
  trimmedOut = false;
  bool isNewest = true;
  for (auto it = messages.rbegin(); it != messages.rend(); ++it) {
    if (!it->is_object()) continue;
    const auto &mo = it->as_object();
    const std::string content = trimCopy(getStringField(mo, "content"));
    if (content.empty()) continue;
    const std::string role = getStringField(mo, "role", "user");
    std::string line = (role == "assistant" ? "Asistente: " : "Usuario: ") + content;
    if (!isNewest && used + line.size() > kHistoryCharBudget) {
      trimmedOut = true;
      break;
    }
    used += line.size();
    isNewest = false;
    reversed.push_back(std::move(line));
  }
  std::reverse(reversed.begin(), reversed.end());
  return reversed;
}

int numPredictFor(ChatIntent intent, bool hasSensorRows) {
  // Presupuesto de generacion por intencion. El valor unico de 180 tokens
  // (~130 palabras) que habia antes cortaba a media frase tanto las respuestas
  // conversacionales normales como -- sobre todo -- el chip "Ampliar", que por
  // definicion pide MAS texto del que ya hay.
  int base = 320;
  switch (intent) {
    case ChatIntent::Summarize: base = 400; break;
    case ChatIntent::Expand:    base = 800; break;
    case ChatIntent::Ideas:     base = 400; break;
    case ChatIntent::Chat:      base = 320; break;
  }
  // Un listado real de sensores puede ser largo (hasta 60 filas, ~28 tokens
  // por fila). Medido en vivo contra este stack con 60 piezometros: con 500
  // tokens Ollama devolvia done_reason="length" tras la fila 12, y ese listado
  // a medias era lo unico que quedaba en el historial para los turnos
  // siguientes. 900 cubre ~32 filas completas; por encima de eso el modelo
  // corta, pero ya no arrastra un listado partido como si fuera completo.
  return hasSensorRows ? std::max(base, 900) : base;
}

} // namespace

ChatIntent parseChatIntent(const std::string &raw) {
  const std::string v = normalizeForTopic(trimCopy(raw));
  if (v == "summarize" || v == "resumir") return ChatIntent::Summarize;
  if (v == "expand" || v == "ampliar") return ChatIntent::Expand;
  if (v == "ideas") return ChatIntent::Ideas;
  return ChatIntent::Chat;
}

int chatbotNumCtx() {
  ensureConfigured();
  return gOllamaChatNumCtx;
}

json::object buildOllamaOptions(const ChatPromptResult &promptResult) {
  json::object opts;
  opts["temperature"] = 0.4;
  opts["num_ctx"] = promptResult.numCtx;
  opts["num_predict"] = promptResult.numPredict;
  // El prompt es un dialogo en texto plano ("Usuario:"/"Asistente:"): sin
  // secuencias de parada el modelo sigue solo la conversacion inventando el
  // siguiente turno del usuario, y ese texto inventado se mostraba como parte
  // de la respuesta y luego volvia al backend como historial real.
  opts["stop"] = json::array{"\nUsuario:", "\nUsuario :", "\nUSUARIO:"};
  return opts;
}

ChatPromptResult buildChatPromptForStreaming(const json::object &qualifying,
                                             const json::array &messages,
                                             const std::string &tenantId,
                                             ChatIntent intent) {
  std::string sensorContext;
  bool hasSensorRows = false;
  if (!tenantId.empty()) {
    const auto topic = resolveSensorTopic(messages);
    if (topic.active()) {
      const auto rows = fetchMatchingSensors(tenantId, topic.patterns, topic.generic);
      hasSensorRows = !rows.empty();
      sensorContext = formatSensorContext(rows);
    }
  }

  bool trimmed = false;
  const auto history = renderHistoryWithinBudget(messages, trimmed);

  std::ostringstream prompt;
  prompt << buildSystemPrompt(qualifying) << "\n\n";
  if (!sensorContext.empty()) {
    prompt << sensorContext;
  }
  if (trimmed) {
    prompt << "(Se omitieron turnos antiguos de esta conversacion por longitud; el contexto "
              "relevante mas reciente esta completo debajo.)\n";
  }
  for (const auto &line : history) {
    prompt << line << "\n";
  }
  prompt << "Asistente:";

  ChatPromptResult out;
  out.prompt = prompt.str();
  out.hasSensorRows = hasSensorRows;
  out.numPredict = numPredictFor(intent, hasSensorRows);
  out.numCtx = chatbotNumCtx();
  out.historyTrimmed = trimmed;
  return out;
}

bool fragmentHasCjk(const std::string &fragment) { return textHasCjk(fragment); }

json::object handleChatMessage(const json::value &body, const std::string &tenantId) {
  ensureConfigured();
  if (gOllamaBase.empty()) {
    return json::object{{"error", "ollama_not_configured"}};
  }
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  json::object qualifying;
  if (obj.contains("qualifying") && obj.at("qualifying").is_object()) {
    qualifying = obj.at("qualifying").as_object();
  }
  if (!obj.contains("messages") || !obj.at("messages").is_array()) {
    return json::object{{"error", "missing_messages"}};
  }
  const auto &messages = obj.at("messages").as_array();
  if (messages.empty()) {
    return json::object{{"error", "empty_messages"}};
  }
  // Tope de abuso, no de contexto: el recorte por presupuesto lo hace
  // renderHistoryWithinBudget(). Antes eran 40 y una conversacion de soporte
  // real (con los chips Resumir/Ampliar, que suman dos mensajes cada uno) la
  // rompia de golpe con "conversation_too_long".
  if (messages.size() > 200) {
    return json::object{{"error", "conversation_too_long"}};
  }
  const ChatIntent intent =
      parseChatIntent(obj.contains("intent") && obj.at("intent").is_string()
                          ? json::value_to<std::string>(obj.at("intent"))
                          : std::string{});

  // /api/generate (no /api/chat) por consistencia con text_spell_service.cpp
  // -- se construye el prompt completo con el historial en texto plano.
  const auto promptResult = buildChatPromptForStreaming(qualifying, messages, tenantId, intent);

  json::object reqBody;
  reqBody["model"] = gOllamaChatbotModel;
  reqBody["stream"] = false;
  reqBody["prompt"] = promptResult.prompt;
  // "10m": evita que Ollama descargue el modelo de RAM entre turnos de un
  // mismo chat (el default de Ollama ya es 5m, pero un chat con pausas para
  // que el usuario lea/escriba puede superarlo fácilmente -- una recarga del
  // modelo agrega varios segundos extra a la siguiente respuesta).
  reqBody["keep_alive"] = "10m";
  // num_ctx / num_predict / stop: ver buildOllamaOptions -- compartido con la
  // ruta de streaming SSE para que ambas no puedan divergir.
  reqBody["options"] = buildOllamaOptions(promptResult);

  std::string base = gOllamaBase;
  while (!base.empty() && base.back() == '/') base.pop_back();
  const auto hr = httpPostJson(base + "/api/generate", json::serialize(json::value(reqBody)),
                               gOllamaChatTimeoutMs);
  if (!hr.ok()) {
    std::cerr << "[mining_chatbot] ollama status=" << hr.status << " error=" << hr.error
              << std::endl;
    return json::object{{"error", "ollama_unavailable"}};
  }
  try {
    auto val = json::parse(hr.body);
    if (!val.is_object() || !val.as_object().contains("response") ||
        !val.as_object().at("response").is_string()) {
      return json::object{{"error", "ollama_invalid_response"}};
    }
    const std::string rawReply = json::value_to<std::string>(val.as_object().at("response"));
    const std::string reply = trimCopy(stripCjkLines(rawReply));
    if (reply.empty()) {
      return json::object{{"error", "ollama_empty_response"}};
    }
    return json::object{{"reply", reply}};
  } catch (...) {
    return json::object{{"error", "ollama_parse_failed"}};
  }
}

json::object handleEscalateToWhatsapp(const json::value &body) {
  std::string toE164 = gWhatsappSupportToE164;
  if (body.is_object()) {
    const auto &obj = body.as_object();
    if (obj.contains("to") && obj.at("to").is_string()) {
      // Permite anular el destino por defecto puntualmente (p. ej. pruebas),
      // pero nunca lo exige -- sin 'to' explicito cae al numero de soporte
      // configurado por variable de entorno.
      const std::string override_ = trimCopy(json::value_to<std::string>(obj.at("to")));
      if (!override_.empty()) toE164 = override_;
    }
  }
  if (toE164.empty()) {
    return json::object{{"error", "support_number_not_configured"}};
  }
  const auto *line = AppConfig::instance().defaultWhatsappLine();
  if (!line) {
    return json::object{{"error", "whatsapp_not_configured"}};
  }
  const auto result =
      sendWhatsappTemplateMessage(*line, toE164, gWhatsappTemplateName, gWhatsappTemplateLang, {});
  if (!result.ok) {
    return json::object{{"error", result.error.empty() ? "whatsapp_send_failed" : result.error}};
  }
  return json::object{{"status", "sent"}, {"to", toE164}};
}

} // namespace support
