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

std::string toLowerAsciiChatbot(std::string s) {
  for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

bool containsAny(const std::string &haystackLower, const std::vector<std::string> &needles) {
  for (const auto &n : needles) {
    if (haystackLower.find(n) != std::string::npos) return true;
  }
  return false;
}

/**
 * Detecta a que categoria de sensor se refiere el ultimo mensaje del usuario
 * (si a alguna) y devuelve los patrones ILIKE a aplicar contra el nombre del
 * TIPO de sensor o del sensor mismo en la base de datos. Los nombres de tipo
 * NO son consistentes entre distintos origenes de siembra de datos de este
 * proyecto (p.ej. dashboard.sql usa "Piezometro", pero los datos reales
 * sembrados en Postgres usan "Presion poros") -- por eso se matchea por
 * substrings/sinonimos en vez de un nombre exacto unico.
 */
std::vector<std::string> sensorLikePatternsForMessage(const std::string &messageLower) {
  static const std::vector<std::pair<std::vector<std::string>, std::vector<std::string>>> kGroups = {
      {{"piezometro", "piezómetro", "piezometros", "piezómetros"}, {"%piez%", "%poros%"}},
      {{"inclinometro", "inclinómetro", "inclinometros", "inclinómetros", "inclinacion", "inclinación"}, {"%inclin%"}},
      {{"extensometro", "extensómetro"}, {"%extens%"}},
      {{"radar", "gb-sar", "gbsar", "talud"}, {"%radar%", "%talud%"}},
      {{"gps", "geodesico", "geodésico"}, {"%gps%", "%geodes%"}},
      {{"relaves", "relave"}, {"%relave%"}},
      {{" ph ", "de ph", "nivel de ph"}, {"%ph%"}},
      {{"caudal", "caudalimetro", "caudalímetro"}, {"%caudal%"}},
      {{"pm10", "particulas", "partículas", "polvo"}, {"%pm10%", "%polvo%", "%particul%"}},
      {{"co2", "gas "}, {"%co2%", "%gas%"}},
      {{"vibracion", "vibración", "molino"}, {"%vibrac%", "%molino%"}},
      {{"temperatura"}, {"%temp%"}},
      {{"ruido"}, {"%ruido%"}},
      {{"tuberia", "tubería"}, {"%tuber%"}},
  };
  for (const auto &group : kGroups) {
    if (containsAny(messageLower, group.first)) {
      return group.second;
    }
  }
  return {};
}

bool messageAsksAboutSensorsGeneric(const std::string &messageLower) {
  static const std::vector<std::string> kGeneric = {
      "sensor", "sensores", "telemetria", "telemetría", "instalado", "instalados", "equipo", "equipos"};
  return containsAny(messageLower, kGeneric);
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

} // namespace

ChatPromptResult buildChatPromptForStreaming(const json::object &qualifying,
                                             const json::array &messages,
                                             const std::string &tenantId) {
  std::string sensorContext;
  bool hasSensorRows = false;
  if (!tenantId.empty()) {
    std::string lastUserMsg;
    for (auto it = messages.rbegin(); it != messages.rend(); ++it) {
      if (it->is_object()) {
        const auto &mo = it->as_object();
        if (getStringField(mo, "role", "user") == "user") {
          lastUserMsg = getStringField(mo, "content");
          break;
        }
      }
    }
    const std::string lower = toLowerAsciiChatbot(lastUserMsg);
    const auto patterns = sensorLikePatternsForMessage(lower);
    const bool generic = patterns.empty() && messageAsksAboutSensorsGeneric(lower);
    if (!patterns.empty() || generic) {
      const auto rows = fetchMatchingSensors(tenantId, patterns, generic);
      hasSensorRows = !rows.empty();
      sensorContext = formatSensorContext(rows);
    }
  }
  std::ostringstream prompt;
  prompt << buildSystemPrompt(qualifying) << "\n\n";
  if (!sensorContext.empty()) {
    prompt << sensorContext;
  }
  for (const auto &m : messages) {
    if (!m.is_object()) continue;
    const auto &mo = m.as_object();
    const std::string role = getStringField(mo, "role", "user");
    const std::string content = getStringField(mo, "content");
    if (content.empty()) continue;
    prompt << (role == "assistant" ? "Asistente: " : "Usuario: ") << content << "\n";
  }
  prompt << "Asistente:";
  return ChatPromptResult{prompt.str(), hasSensorRows};
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
  if (messages.size() > 40) {
    return json::object{{"error", "conversation_too_long"}};
  }

  // /api/generate (no /api/chat) por consistencia con text_spell_service.cpp
  // -- se construye el prompt completo con el historial en texto plano.
  const auto promptResult = buildChatPromptForStreaming(qualifying, messages, tenantId);

  json::object reqBody;
  reqBody["model"] = gOllamaChatbotModel;
  reqBody["stream"] = false;
  reqBody["prompt"] = promptResult.prompt;
  // "10m": evita que Ollama descargue el modelo de RAM entre turnos de un
  // mismo chat (el default de Ollama ya es 5m, pero un chat con pausas para
  // que el usuario lea/escriba puede superarlo fácilmente -- una recarga del
  // modelo agrega varios segundos extra a la siguiente respuesta).
  reqBody["keep_alive"] = "10m";
  json::object opts;
  opts["temperature"] = 0.4;
  // Acota la respuesta a ~180 tokens (~130-150 palabras en español): un chat
  // de soporte debe ser breve por diseño (ver buildSystemPrompt, "de forma
  // breve"); limitar la generación además reduce la latencia máxima, ya que
  // el tiempo de generación crece linealmente con los tokens producidos.
  // Excepción: si se inyectaron datos reales de sensores (promptResult.
  // hasSensorRows), un listado real puede necesitar más tokens que una
  // respuesta conversacional corta -- el límite corto estaba truncando
  // listados reales de sensores a mitad de camino (bug real, reportado
  // 2026-07-29: pedía todos los piezómetros y la respuesta se cortaba tras
  // el primero).
  opts["num_predict"] = promptResult.hasSensorRows ? 500 : 180;
  reqBody["options"] = opts;

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
  const auto result =
      sendWhatsappTemplateMessage(toE164, gWhatsappTemplateName, gWhatsappTemplateLang, {});
  if (!result.ok) {
    return json::object{{"error", result.error.empty() ? "whatsapp_send_failed" : result.error}};
  }
  return json::object{{"status", "sent"}, {"to", toE164}};
}

} // namespace support
