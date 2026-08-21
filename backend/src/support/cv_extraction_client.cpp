#include "cv_extraction_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <regex>
#include <sstream>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace json = boost::json;

using http_utils::makeId;
using config::AppConfig;

#define gAiEngineUrl config::AppConfig::instance().gAiEngineUrl
#define gAiEngineCvExtractTimeoutMs config::AppConfig::instance().gAiEngineCvExtractTimeoutMs

namespace support {

namespace {

// Config propia del cliente Ollama de CV -- separada de mining_chatbot_service.cpp
// y text_spell_service.cpp (mismo BEEMETRY_OLLAMA_URL, pero cada módulo
// mantiene su propia copia mínima, convención ya establecida en este
// codebase). qwen2.5:7b por defecto: es el modelo de "máxima capacidad" ya
// desplegado en este stack (ver text_spell_service.cpp/ADR-118), preferido
// aquí sobre gemma2:2b porque la extracción de un CV entero + el scoring no
// son una tarea interactiva -- la latencia importa menos que la fidelidad.
std::string gOllamaBase;
std::string gOllamaCvModel = "qwen2.5:7b";
int gOllamaCvTimeoutMs = 120000;
int gOllamaCvNumCtx = 8192;
bool gConfigured = false;

std::string getenvOr(const char *key, const std::string &def) {
  const char *v = std::getenv(key);
  return v ? std::string(v) : def;
}

void ensureConfigured() {
  if (gConfigured) return;
  gOllamaBase = getenvOr("BEEMETRY_OLLAMA_URL", "");
  gOllamaCvModel = getenvOr("BEEMETRY_OLLAMA_CV_MODEL", "qwen2.5:7b");
  try {
    gOllamaCvTimeoutMs =
        std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_CV_TIMEOUT_MS", "120000")), 5000, 300000);
  } catch (...) {
    gOllamaCvTimeoutMs = 120000;
  }
  try {
    gOllamaCvNumCtx =
        std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_CV_NUM_CTX", "8192")), 2048, 32768);
  } catch (...) {
    gOllamaCvNumCtx = 8192;
  }
  gConfigured = true;
  if (!gOllamaBase.empty()) {
    std::cerr << "[CV_EXTRACT] OLLAMA_URL configured model=" << gOllamaCvModel << std::endl;
  }
}

struct ParsedHttpEndpoint {
  std::string host;
  std::string port = "80";
  std::string target = "/";
};

bool parseHttpEndpoint(const std::string &url, ParsedHttpEndpoint &out) {
  static const std::regex kHttpRegex(R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
                                     std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpRegex)) return false;
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched) out.port = m[2].str();
  if (m.size() > 3 && m[3].matched && !m[3].str().empty()) out.target = m[3].str();
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
  if (ec) { out.error = "resolve_failed"; return out; }
  stream.connect(results, ec);
  if (ec) { out.error = "connect_failed"; return out; }

  http::request<http::string_body> req{http::verb::post, ep.target, 11};
  req.set(http::field::host, ep.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "application/json");
  req.body() = jsonBody;
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) { out.error = "write_failed"; return out; }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
  if (ec && ec != beast::errc::not_connected) { out.error = "read_failed"; return out; }
  out.status = static_cast<int>(res.result_int());
  out.body = res.body();
  return out;
}

std::string trimCopy(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
  return s;
}

// Mismo truco que text_spell_service.cpp::stripCodeFences -- algunos modelos
// envuelven el JSON en ```json ... ``` pese a format:"json".
std::string stripCodeFences(std::string s) {
  s = trimCopy(s);
  if (s.size() >= 7 && s.compare(0, 7, "```json") == 0) s = s.substr(7);
  else if (s.size() >= 3 && s.compare(0, 3, "```") == 0) s = s.substr(3);
  s = trimCopy(s);
  while (!s.empty() && s.back() == '`') s.pop_back();
  return trimCopy(s);
}

std::string toLowerAscii(std::string s) {
  for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

/** true si `needle` (recortado, no vacío) aparece como substring de
 * `haystack`, sin distinguir mayúsculas/minúsculas -- chequeo de presencia
 * anti-alucinación, mismo espíritu que apa7ResponseLooksValid en
 * text_spell_service.cpp: no valida que el dato sea "correcto", solo que el
 * LLM no lo haya inventado de la nada (debe aparecer, aunque sea parcial,
 * en el texto que realmente se le dio). */
bool looksPresentInSource(const std::string &haystackLower, const std::string &value) {
  const std::string v = trimCopy(value);
  if (v.empty()) return true; // campo vacío no es una alucinación
  // Para nombres compuestos, alcanza con que la primera palabra (>=3 letras)
  // aparezca -- exigir la cadena completa sería frágil ante espacios/orden
  // distintos entre el CV y lo que el LLM extrajo.
  std::istringstream iss(v);
  std::string firstWord;
  iss >> firstWord;
  if (firstWord.size() < 3) return true; // demasiado corto para verificar con sentido
  return haystackLower.find(toLowerAscii(firstWord)) != std::string::npos;
}

std::string getStr(const json::object &o, const char *key) {
  return o.contains(key) && o.at(key).is_string() ? json::value_to<std::string>(o.at(key)) : "";
}

json::array getArr(const json::object &o, const char *key) {
  return o.contains(key) && o.at(key).is_array() ? o.at(key).as_array() : json::array{};
}

std::optional<int> getOptInt(const json::object &o, const char *key) {
  if (!o.contains(key)) return std::nullopt;
  const auto &v = o.at(key);
  if (v.is_int64()) return static_cast<int>(v.as_int64());
  if (v.is_double()) return static_cast<int>(v.as_double());
  return std::nullopt;
}

std::optional<double> getOptDouble(const json::object &o, const char *key) {
  if (!o.contains(key)) return std::nullopt;
  const auto &v = o.at(key);
  if (v.is_double()) return v.as_double();
  if (v.is_int64()) return static_cast<double>(v.as_int64());
  return std::nullopt;
}

} // namespace

CvTextExtractionResult extractCvTextFromAiEngine(const std::vector<unsigned char> &fileBytes,
                                                  const std::string &filename,
                                                  const std::string &mimeType) {
  CvTextExtractionResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (fileBytes.empty()) {
    out.error = "empty_file";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/extract_cv_text", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  const std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(fileBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"file\"; filename=\"" +
          (filename.empty() ? std::string("cv") : filename) + "\"\r\n";
  body += "Content-Type: " + (mimeType.empty() ? std::string("application/octet-stream") : mimeType) +
          "\r\n\r\n";
  body.append(reinterpret_cast<const char *>(fileBytes.data()),
              static_cast<std::streamsize>(fileBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEngineCvExtractTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) { out.error = "ai_engine_resolve_failed"; return out; }
  stream.connect(results, ec);
  if (ec) { out.error = "ai_engine_connect_failed"; return out; }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) { out.error = "ai_engine_write_failed"; return out; }

  beast::flat_buffer buffer;
  http::response_parser<http::string_body> parser;
  parser.body_limit(4U * 1024U * 1024U); // el texto extraído es mucho más chico que el archivo
  http::read(stream, buffer, parser, ec);
  auto res = parser.release();
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
  if (ec) { out.error = "ai_engine_read_failed"; return out; }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    const auto payload = json::parse(res.body());
    if (!payload.is_object()) { out.error = "ai_engine_invalid_json"; return out; }
    const auto &obj = payload.as_object();
    const bool okFlag = obj.if_contains("ok") && obj.at("ok").is_bool() && obj.at("ok").as_bool();
    if (!okFlag) {
      out.error = getStr(obj, "error").empty() ? "extract_cv_text_failed" : getStr(obj, "error");
      return out;
    }
    out.text = getStr(obj, "text");
    out.ok = !out.text.empty();
    if (!out.ok) out.error = "empty_document";
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

CvFieldExtractionResult extractCvFieldsWithOllama(const std::string &rawText) {
  ensureConfigured();
  CvFieldExtractionResult out;
  if (gOllamaBase.empty()) {
    out.error = "ollama_not_configured";
    return out;
  }
  if (trimCopy(rawText).empty()) {
    out.error = "empty_text";
    return out;
  }

  // Prompt de extracción + scoring (ADR-122): instrucción explícita de NO
  // inventar nada -- null/[] si el dato no aparece. El score es una señal de
  // TRIAJE (completitud/relevancia del CV), nunca una decisión de
  // contratar/descartar -- ver ADR-122 (distinción explícita con ADR-121,
  // que rechazó el LLM para GENERAR coordenadas GPS: esto es EXTRACCIÓN de
  // datos ya presentes en un texto dado, verificable contra ese mismo texto).
  const std::string prompt =
      "Eres un asistente de RRHH que EXTRAE informacion ya presente en un CV. "
      "NUNCA inventes, infieras ni completes datos que no esten explicitamente "
      "en el texto. Si un campo no aparece, usa null (para texto/numero) o [] "
      "(para listas) -- nunca un valor de relleno ni un supuesto razonable.\n\n"
      "TEXTO DEL CV (extraido automaticamente, puede tener errores de formato):\n"
      "\"\"\"\n" + rawText + "\n\"\"\"\n\n"
      "Extrae EXACTAMENTE estos campos y responde SOLO con un JSON valido de "
      "una linea, con esta forma exacta (usa null cuando el dato no este "
      "presente):\n"
      "{\"nombres\":string|null,\"apellidos\":string|null,"
      "\"telefono_fijo\":string|null,\"celular\":string|null,"
      "\"whatsapp\":string|null,\"centro_estudios\":string|null,"
      "\"edad\":integer|null,\"lugar_residencia\":string|null,"
      "\"pretensiones_economicas\":string|null,\"anios_experiencia\":number|null,"
      "\"cargo_postulado\":string|null,"
      "\"experiencia_laboral\":[{\"empresa\":string,\"funciones\":string}],"
      "\"cursos_capacitacion\":[string],"
      "\"ingles_lectura\":string|null,\"ingles_escritura\":string|null,"
      "\"ingles_conversacion\":string|null,\"otra_informacion_relevante\":string|null,"
      "\"score\":integer (0-100),\"score_rationale\":string}\n\n"
      "Reglas para \"score\": evalua QUE TAN COMPLETO Y RELEVANTE es el CV "
      "para un proceso de seleccion general (claridad de la experiencia, "
      "consistencia, relevancia declarada de la experiencia al cargo si se "
      "indico) -- NO es un juicio de si la persona \"merece\" el puesto, es "
      "una senal de TRIAJE para que un analista humano priorice revision, "
      "nunca una decision automatica de contratar/descartar. "
      "\"score_rationale\" debe citar brevemente en que te basaste, en "
      "espanol, sin inventar hechos no presentes en el texto.";

  json::object body;
  body["model"] = gOllamaCvModel;
  body["stream"] = false;
  body["format"] = "json";
  json::object opts;
  opts["temperature"] = 0.1;
  opts["num_ctx"] = gOllamaCvNumCtx;
  body["options"] = opts;
  body["prompt"] = prompt;
  // "5m": una postulación es un evento puntual (no interactivo como el
  // chat) -- no hace falta mantener qwen2.5:7b caliente tanto tiempo como
  // en text_spell_service.cpp (APA7), pero sí más que el default de Ollama
  // para absorber varias postulaciones seguidas sin recargar el modelo.
  body["keep_alive"] = "5m";

  std::string base = gOllamaBase;
  while (!base.empty() && base.back() == '/') base.pop_back();
  const auto hr = httpPostJson(base + "/api/generate", json::serialize(json::value(body)),
                               gOllamaCvTimeoutMs);
  if (!hr.ok()) {
    std::cerr << "[CV_EXTRACT] ollama status=" << hr.status << " error=" << hr.error << std::endl;
    out.error = "ollama_unavailable";
    return out;
  }

  try {
    const auto val = json::parse(hr.body);
    if (!val.is_object() || !val.as_object().contains("response") ||
        !val.as_object().at("response").is_string()) {
      out.error = "ollama_invalid_response";
      return out;
    }
    const std::string responseStr = json::value_to<std::string>(val.as_object().at("response"));
    const std::string cleaned = stripCodeFences(responseStr);
    const auto parsed = json::parse(cleaned);
    if (!parsed.is_object()) {
      out.error = "ollama_response_not_object";
      return out;
    }
    const auto &po = parsed.as_object();

    // Validación estructural mínima: score debe ser un entero en [0,100] --
    // sin esto, no hay respuesta utilizable (es el único campo obligatorio;
    // todos los demás pueden venir null legítimamente).
    const auto scoreOpt = getOptInt(po, "score");
    if (!scoreOpt.has_value() || *scoreOpt < 0 || *scoreOpt > 100) {
      out.error = "ollama_invalid_score";
      return out;
    }

    CvCandidateProfile p;
    p.nombres = getStr(po, "nombres");
    p.apellidos = getStr(po, "apellidos");
    p.telefonoFijo = getStr(po, "telefono_fijo");
    p.celular = getStr(po, "celular");
    p.whatsapp = getStr(po, "whatsapp");
    p.centroEstudios = getStr(po, "centro_estudios");
    p.edad = getOptInt(po, "edad");
    p.lugarResidencia = getStr(po, "lugar_residencia");
    p.pretensionesEconomicas = getStr(po, "pretensiones_economicas");
    p.aniosExperiencia = getOptDouble(po, "anios_experiencia");
    p.cargoPostulado = getStr(po, "cargo_postulado");
    p.experienciaLaboral = getArr(po, "experiencia_laboral");
    p.cursosCapacitacion = getArr(po, "cursos_capacitacion");
    p.inglesLectura = getStr(po, "ingles_lectura");
    p.inglesEscritura = getStr(po, "ingles_escritura");
    p.inglesConversacion = getStr(po, "ingles_conversacion");
    p.otraInformacion = getStr(po, "otra_informacion_relevante");
    p.score = scoreOpt;
    p.scoreRationale = getStr(po, "score_rationale");
    p.llmModel = gOllamaCvModel;

    // Chequeo de presencia anti-alucinación (ver looksPresentInSource):
    // campos clave que el LLM llenó pero que no aparecen en el texto fuente
    // se anulan y quedan registrados en extraction_warnings -- nunca se
    // confía en un campo string sin poder verificarlo contra lo que
    // realmente se le dio al modelo.
    const std::string sourceLower = toLowerAscii(rawText);
    json::array warnings;
    auto checkField = [&](std::string &field, const char *label) {
      if (field.empty()) return;
      if (!looksPresentInSource(sourceLower, field)) {
        warnings.push_back(json::string(std::string(label) + ": \"" + field +
                                        "\" no se encontró en el texto del CV, se anuló"));
        field.clear();
      }
    };
    checkField(p.nombres, "nombres");
    checkField(p.apellidos, "apellidos");
    checkField(p.cargoPostulado, "cargo_postulado");
    p.extractionWarnings = warnings;

    out.ok = true;
    out.profile = std::move(p);
    return out;
  } catch (const std::exception &ex) {
    out.error = std::string("ollama_parse_failed: ") + ex.what();
    return out;
  }
}

} // namespace support
