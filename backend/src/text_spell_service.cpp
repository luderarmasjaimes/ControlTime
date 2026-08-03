#include "text_spell_service.hpp"

#include <algorithm>
#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/version.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;
namespace ssl = boost::asio::ssl;

namespace {

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

std::string getenvOr(const char *key, const std::string &def) {
  const char *v = std::getenv(key);
  return v ? std::string(v) : def;
}

std::string formUrlEncodeUtf8(std::string_view s) {
  static const char *hex = "0123456789ABCDEF";
  std::string out;
  out.reserve(s.size() * 3);
  for (unsigned char c : s) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out.push_back(static_cast<char>(c));
    } else if (c == ' ') {
      out.push_back('+');
    } else {
      out.push_back('%');
      out.push_back(hex[c >> 4]);
      out.push_back(hex[c & 0x0F]);
    }
  }
  return out;
}

struct HttpStringResult {
  int status = 0;
  std::string body;
  std::string error;
  bool ok() const { return error.empty() && status == 200; }
};

HttpStringResult httpPostUrlEncoded(const std::string &fullUrl,
                                    const std::string &formBody, int timeoutMs) {
  HttpStringResult out;
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
  req.set(http::field::content_type, "application/x-www-form-urlencoded");
  req.body() = formBody;
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

HttpStringResult httpPostJson(const std::string &fullUrl, const std::string &jsonBody,
                              int timeoutMs) {
  HttpStringResult out;
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

/**
 * Cliente HTTPS de salida (TLS) — no existía en este backend hasta ahora
 * (todas las integraciones previas eran HTTP plano intra-red Docker:
 * LanguageTool, Ollama). Necesario para consultar una API de búsqueda real
 * externa (Serper.dev) para verificar que las referencias bibliográficas
 * sean fuentes reales, en vez de que el LLM las "recuerde" de su
 * entrenamiento (que puede alucinar). Verifica el certificado del peer
 * contra los CA del sistema (ca-certificates, ya presente en la imagen).
 */
HttpStringResult httpsPostJson(const std::string &host, const std::string &target,
                               const std::string &jsonBody,
                               const std::vector<std::pair<std::string, std::string>> &extraHeaders,
                               int timeoutMs) {
  HttpStringResult out;
  try {
    asio::io_context ioc;
    ssl::context ctx{ssl::context::tlsv12_client};
    ctx.set_default_verify_paths();
    ctx.set_verify_mode(ssl::verify_peer);

    beast::ssl_stream<beast::tcp_stream> stream{ioc, ctx};
    if (!SSL_set_tlsext_host_name(stream.native_handle(), host.c_str())) {
      out.error = "sni_set_failed";
      return out;
    }

    beast::error_code ec;
    asio::ip::tcp::resolver resolver{ioc};
    auto const results = resolver.resolve(host, "443", ec);
    if (ec) {
      out.error = "resolve_failed";
      return out;
    }

    beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
    beast::get_lowest_layer(stream).connect(results, ec);
    if (ec) {
      out.error = "connect_failed";
      return out;
    }

    stream.handshake(ssl::stream_base::client, ec);
    if (ec) {
      out.error = "tls_handshake_failed: " + ec.message();
      return out;
    }

    http::request<http::string_body> req{http::verb::post, target, 11};
    req.set(http::field::host, host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::content_type, "application/json");
    for (const auto &h : extraHeaders) {
      req.set(h.first, h.second);
    }
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
    if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated) {
      out.error = "read_failed: " + ec.message();
      return out;
    }
    out.status = static_cast<int>(res.result_int());
    out.body = res.body();

    beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(3));
    stream.shutdown(ec); // muchos servidores cierran abrupto -- ignorar el error de shutdown
  } catch (const std::exception &ex) {
    out.error = std::string("exception: ") + ex.what();
  }
  return out;
}

std::string gLanguageToolBase;
int gLanguageToolTimeoutMs = 45000;
std::string gOllamaBase;
// tinyllama (1.1B, default anterior) alucinaba contenido sin relación con el
// texto de entrada -- verificado en vivo 2026-07-22 (ver docker-compose.yml,
// servicio ollama). gemma2:2b probado en el mismo caso: reescritura fiel al
// original y formato APA 7 correcto de una cita real dada.
std::string gOllamaModel = "gemma2:2b";
// Benchmark de esfuerzo continuo 2026-07-22 (20 iteraciones c/u, rewrite +
// APA7): qwen2.5:7b fue 100% fiel en APA7 (vs 75% de gemma2:2b, que devolvia
// un placeholder literal "Author, Year..." cuando el autor venia vacio), pero
// en rewrite qwen2.5:7b filtro texto en chino dentro de una respuesta en
// español en 2/20 corridas (reproducible, mismo caso de prueba) -- ademas de
// ser ~2.4x mas lento (p50 18s vs 7s) y requerir ~3x mas RAM. Por eso se usa
// un modelo distinto por tarea: qwen2.5:7b solo para APA7 (accion puntual,
// la latencia importa menos, y ahi fue mas fiel), gemma2:2b para rewrite
// (interactivo, necesita responder rapido, y no mostro el filtrado de chino).
std::string gOllamaApa7Model = "qwen2.5:7b";
int gOllamaTimeoutMs = 120000;
std::size_t gMaxTextChars = 30000;
// Serper.dev: API de búsqueda real (Google SERP) para verificar que las
// referencias bibliográficas sean fuentes que EXISTEN de verdad, filtradas a
// una lista de dominios confiables -- nunca se le pide al LLM que "recuerde"
// una fuente de su entrenamiento (eso es exactamente lo que puede alucinar).
// Vacío por defecto: sin API key configurada, /api/text/search-references
// responde "serper_not_configured" en vez de fallar en silencio.
std::string gSerperApiKey;
int gSerperTimeoutMs = 15000;
// Tavily (api.tavily.com): proveedor de búsqueda preferido -- a diferencia de
// Serper (SERP crudo de Google), Tavily está diseñado para agentes de IA/RAG,
// da un free tier mensual recurrente (no de una sola vez) y permite acotar
// la búsqueda con include_domains. Aun así, el filtro de confianza local
// (isDomainTrusted) SIEMPRE se re-aplica sobre lo que devuelve Tavily -- el
// proveedor externo nunca es la única fuente de "confiabilidad".
std::string gTavilyApiKey;
int gTavilyTimeoutMs = 15000;

void regexReplaceAllI(std::string &s, const std::string &pattern,
                      const std::string &replacement) {
  try {
    std::regex re(pattern, std::regex::icase | std::regex::ECMAScript);
    s = std::regex_replace(s, re, replacement);
  } catch (...) {
  }
}

std::string applyQuickSpanishCorrections(std::string corrected) {
  regexReplaceAllI(corrected, R"(\bcprregido\b)", "corregido");
  regexReplaceAllI(corrected, R"(\bigiual\b)", "igual");
  regexReplaceAllI(corrected, R"(\botograficas\b)", "ortográficas");
  regexReplaceAllI(corrected, R"(\bcamboa\b)", "cambia");
  regexReplaceAllI(corrected, R"(\badiconalmente\b)", "adicionalmente");
  regexReplaceAllI(corrected, R"(\besscriba\b)", "escriba");
  regexReplaceAllI(corrected, R"(\bautimaticmante\b)", "automáticamente");
  regexReplaceAllI(corrected, R"(\besscribir\b)", "escribir");
  regexReplaceAllI(corrected, R"(\bseccion\b)", "sección");
  regexReplaceAllI(corrected, R"(\bpérmita\b)", "permita");
  regexReplaceAllI(corrected, R"(\bcorreciones\b)", "correcciones");
  regexReplaceAllI(corrected, R"(\bgrabado\b)", "grabación");
  regexReplaceAllI(corrected, R"(\btextp\b)", "texto");

  try {
    corrected = std::regex_replace(corrected, std::regex(R"([ \t]+)"), " ");
    corrected = std::regex_replace(corrected, std::regex(R"(\s+\n)"), "\n");
    corrected = std::regex_replace(corrected, std::regex(R"(\n\s+)"), "\n");
    corrected = std::regex_replace(corrected, std::regex(R"(\s+([,.;:!?]))"), "$1");
    corrected = std::regex_replace(corrected, std::regex(R"(([,.;:!?])(?![\s\n]|$))"), "$1 ");
    corrected = std::regex_replace(corrected, std::regex(R"(\n{3,})"), "\n\n");
  } catch (...) {
  }

  while (!corrected.empty() && std::isspace(static_cast<unsigned char>(corrected.front()))) {
    corrected.erase(corrected.begin());
  }
  while (!corrected.empty() && std::isspace(static_cast<unsigned char>(corrected.back()))) {
    corrected.pop_back();
  }

  for (std::size_t i = 0; i < corrected.size(); ++i) {
    bool boundary = (i == 0);
    if (!boundary && i > 0) {
      const char prev = corrected[i - 1];
      if (prev == '\n') {
        boundary = true;
      } else if (prev == ' ' || prev == '\t') {
        for (int k = static_cast<int>(i) - 2; k >= 0; --k) {
          const char p = corrected[static_cast<std::size_t>(k)];
          if (p == '.' || p == '!' || p == '?') {
            boundary = true;
            break;
          }
          if (p != ' ' && p != '\t') {
            break;
          }
        }
      }
    }
    if (boundary && corrected[i] >= 'a' && corrected[i] <= 'z') {
      corrected[i] = static_cast<char>(corrected[i] - 'a' + 'A');
    }
  }

  return corrected;
}

std::optional<json::value> languageToolCheckJson(const std::string &text,
                                                const std::string &requestedLanguage,
                                                const std::string &level) {
  (void)level;
  if (gLanguageToolBase.empty()) {
    return std::nullopt;
  }
  std::string base = gLanguageToolBase;
  while (!base.empty() && base.back() == '/') {
    base.pop_back();
  }
  const std::string url = base + "/v2/check";

  std::string langNorm = requestedLanguage;
  {
    std::string low;
    low.reserve(langNorm.size());
    for (unsigned char c : langNorm) {
      low.push_back(static_cast<char>(std::tolower(c)));
    }
    if (low == "es-pe") {
      langNorm = "es";
    }
  }
  // Some self-hosted LanguageTool images reject unknown params (e.g. level).
  // Keep request conservative for maximum on-premise compatibility.
  std::ostringstream form;
  form << "text=" << formUrlEncodeUtf8(text) << "&language=" << formUrlEncodeUtf8(langNorm)
       << "&enabledOnly=false";

  const auto hr = httpPostUrlEncoded(url, form.str(), gLanguageToolTimeoutMs);
  if (!hr.ok()) {
    return std::nullopt;
  }
  try {
    return json::parse(hr.body);
  } catch (...) {
    return std::nullopt;
  }
}

bool categoryAllowedForAutoApply(const std::string &cat) {
  return cat == "TYPOS" || cat == "GRAMMAR" || cat == "MISSPELLING" || cat == "TYPOGRAPHY";
}

std::string applyLanguageToolSafeMatches(const std::string &sourceText,
                                         const json::value &ltRoot) {
  if (!ltRoot.is_object()) {
    return sourceText;
  }
  const auto &root = ltRoot.as_object();
  if (!root.contains("matches") || !root.at("matches").is_array()) {
    return sourceText;
  }
  struct Cand {
    std::size_t offset = 0;
    std::size_t length = 0;
    std::string replacement;
  };
  std::vector<Cand> cands;
  for (const auto &m : root.at("matches").as_array()) {
    if (!m.is_object()) {
      continue;
    }
    const auto &mo = m.as_object();
    if (!mo.contains("offset") || !mo.contains("length")) {
      continue;
    }
    std::size_t off = 0;
    std::size_t len = 0;
    if (mo.at("offset").is_int64()) {
      off = static_cast<std::size_t>(std::max<std::int64_t>(0, mo.at("offset").as_int64()));
    } else if (mo.at("offset").is_uint64()) {
      off = static_cast<std::size_t>(mo.at("offset").as_uint64());
    } else {
      continue;
    }
    if (mo.at("length").is_int64()) {
      len = static_cast<std::size_t>(std::max<std::int64_t>(0, mo.at("length").as_int64()));
    } else if (mo.at("length").is_uint64()) {
      len = static_cast<std::size_t>(mo.at("length").as_uint64());
    } else {
      continue;
    }
    if (len == 0) {
      continue;
    }
    std::string cat;
    if (mo.contains("rule") && mo.at("rule").is_object()) {
      const auto &rule = mo.at("rule").as_object();
      if (rule.contains("category") && rule.at("category").is_object()) {
        const auto &c = rule.at("category").as_object();
        if (c.contains("id") && c.at("id").is_string()) {
          cat = json::value_to<std::string>(c.at("id"));
        }
      }
    }
    if (!categoryAllowedForAutoApply(cat)) {
      continue;
    }
    std::string rep;
    if (mo.contains("replacements") && mo.at("replacements").is_array()) {
      for (const auto &r : mo.at("replacements").as_array()) {
        if (r.is_object()) {
          const auto &ro = r.as_object();
          if (ro.contains("value") && ro.at("value").is_string()) {
            rep = json::value_to<std::string>(ro.at("value"));
            while (!rep.empty() && std::isspace(static_cast<unsigned char>(rep.front()))) {
              rep.erase(rep.begin());
            }
            while (!rep.empty() && std::isspace(static_cast<unsigned char>(rep.back()))) {
              rep.pop_back();
            }
            break;
          }
        }
      }
    }
    if (rep.empty()) {
      continue;
    }
    cands.push_back({off, len, std::move(rep)});
  }
  std::sort(cands.begin(), cands.end(),
            [](const Cand &a, const Cand &b) { return a.offset > b.offset; });
  std::string nextText = sourceText;
  for (const auto &item : cands) {
    if (item.offset + item.length > nextText.size()) {
      continue;
    }
    nextText.replace(item.offset, item.length, item.replacement);
  }
  return nextText;
}

std::string trimCopy(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
    s.erase(s.begin());
  }
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
    s.pop_back();
  }
  return s;
}

std::string stripCodeFences(std::string s) {
  s = trimCopy(s);
  if (s.size() >= 7 && s.compare(0, 7, "```json") == 0) {
    s = s.substr(7);
  } else if (s.size() >= 3 && s.compare(0, 3, "```") == 0) {
    s = s.substr(3);
  }
  s = trimCopy(s);
  if (!s.empty() && s.back() == '`') {
    while (!s.empty() && s.back() == '`') {
      s.pop_back();
    }
  }
  return trimCopy(s);
}

std::optional<std::string> parseRewriteJsonText(const std::string &rawResponse) {
  const std::string cleaned = stripCodeFences(rawResponse);
  if (cleaned.empty()) {
    return std::nullopt;
  }
  try {
    auto val = json::parse(cleaned);
    if (!val.is_object()) {
      return std::nullopt;
    }
    const auto &o = val.as_object();
    if (!o.contains("text") || !o.at("text").is_string()) {
      return std::nullopt;
    }
    auto out = trimCopy(json::value_to<std::string>(o.at("text")));
    if (out.empty()) {
      return std::nullopt;
    }
    return out;
  } catch (...) {
    return std::nullopt;
  }
}

/**
 * Llama a Ollama con un prompt libre y espera de vuelta un JSON de una sola
 * clave string (p.ej. {"apa":"..."}). El modelo se pasa explicito porque cada
 * tarea usa uno distinto (ver comentario junto a gOllamaApa7Model).
 */
std::optional<std::string> ollamaGenerateJsonField(const std::string &prompt,
                                                   const std::string &jsonKey,
                                                   const std::string &model) {
  if (gOllamaBase.empty()) {
    return std::nullopt;
  }
  std::string base = gOllamaBase;
  while (!base.empty() && base.back() == '/') {
    base.pop_back();
  }
  const std::string url = base + "/api/generate";

  json::object body;
  body["model"] = model;
  body["stream"] = false;
  body["format"] = "json";
  body["prompt"] = prompt;
  json::object opts;
  opts["temperature"] = 0.1;
  body["options"] = opts;

  const std::string payload = json::serialize(json::value(body));
  const auto hr = httpPostJson(url, payload, gOllamaTimeoutMs);
  if (hr.status != 200) {
    std::cerr << "[text_spell] ollama HTTP status=" << hr.status << std::endl;
    return std::nullopt;
  }
  try {
    auto val = json::parse(hr.body);
    if (!val.is_object()) {
      return std::nullopt;
    }
    const auto &o = val.as_object();
    if (!o.contains("response") || !o.at("response").is_string()) {
      return std::nullopt;
    }
    const std::string responseStr = json::value_to<std::string>(o.at("response"));
    const std::string cleaned = stripCodeFences(responseStr);
    if (cleaned.empty()) {
      return std::nullopt;
    }
    auto parsed = json::parse(cleaned);
    if (!parsed.is_object()) {
      return std::nullopt;
    }
    const auto &po = parsed.as_object();
    if (!po.contains(jsonKey) || !po.at(jsonKey).is_string()) {
      return std::nullopt;
    }
    auto out = trimCopy(json::value_to<std::string>(po.at(jsonKey)));
    return out.empty() ? std::nullopt : std::make_optional(out);
  } catch (...) {
    return std::nullopt;
  }
}

/** Escapa un valor de campo bibliográfico antes de insertarlo en el prompt
 * (evita que comillas del usuario rompan la instrucción o intenten inyectar
 * instrucciones nuevas -- el modelo igual solo puntúa/ordena, no ejecuta
 * nada, pero se mantiene el prompt bien formado). */
std::string sanitizePromptField(std::string v) {
  v = trimCopy(std::move(v));
  std::string out;
  out.reserve(v.size());
  for (char c : v) {
    if (c == '\n' || c == '\r') {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

std::optional<std::string> ollamaRewriteText(const std::string &input) {
  if (gOllamaBase.empty()) {
    return std::nullopt;
  }
  std::string base = gOllamaBase;
  while (!base.empty() && base.back() == '/') {
    base.pop_back();
  }
  const std::string url = base + "/api/generate";

  json::object body;
  body["model"] = gOllamaModel;
  body["stream"] = false;
  // Forzar JSON evita que modelos pequeños (p. ej. tinyllama) vuelquen el prompt al texto.
  body["format"] = "json";
  body["prompt"] =
      "Eres editor técnico de informes mineros en español (Perú). Reescribe el TEXTO_ORIGINAL "
      "con registro formal y claridad. No inventes datos, cifras ni referencias. Conserva "
      "viñetas y numeración si existen.\n"
      "Responde EXCLUSIVAMENTE con un JSON válido de una sola línea o varias, con esta forma "
      "exacta: {\"text\":\"...\"} . Dentro de \"text\" escapa comillas y saltos como JSON "
      "estándar.\n"
      "TEXTO_ORIGINAL:\n" +
      input;

  json::object opts;
  opts["temperature"] = 0.2;
  body["options"] = opts;

  const std::string payload = json::serialize(json::value(body));
  const auto hr = httpPostJson(url, payload, gOllamaTimeoutMs);
  if (hr.status != 200) {
    std::cerr << "[text_spell] ollama HTTP status=" << hr.status << std::endl;
    return std::nullopt;
  }
  try {
    auto val = json::parse(hr.body);
    if (!val.is_object()) {
      return std::nullopt;
    }
    const auto &o = val.as_object();
    if (!o.contains("response") || !o.at("response").is_string()) {
      return std::nullopt;
    }
    const std::string responseStr = json::value_to<std::string>(o.at("response"));
    return parseRewriteJsonText(responseStr);
  } catch (...) {
    return std::nullopt;
  }
}

std::string requireTextField(const json::object &obj, std::string &err) {
  if (!obj.contains("text") || !obj.at("text").is_string()) {
    err = "missing_text";
    return {};
  }
  std::string t = json::value_to<std::string>(obj.at("text"));
  if (t.size() > gMaxTextChars) {
    err = "text_too_long";
    return {};
  }
  return t;
}

} // namespace

namespace text_spell {

void configureFromEnv() {
  gLanguageToolBase = getenvOr("BEEMETRY_LANGUAGETOOL_URL", "");
  gOllamaBase = getenvOr("BEEMETRY_OLLAMA_URL", "");
  gOllamaModel = getenvOr("BEEMETRY_OLLAMA_MODEL", "gemma2:2b");
  gOllamaApa7Model = getenvOr("BEEMETRY_OLLAMA_APA7_MODEL", "qwen2.5:7b");
  try {
    gLanguageToolTimeoutMs =
        std::clamp(std::stoi(getenvOr("BEEMETRY_LANGUAGETOOL_TIMEOUT_MS", "45000")), 1000, 120000);
  } catch (...) {
    gLanguageToolTimeoutMs = 45000;
  }
  try {
    gOllamaTimeoutMs = std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_TIMEOUT_MS", "120000")), 5000,
                                   600000);
  } catch (...) {
    gOllamaTimeoutMs = 120000;
  }
  try {
    gMaxTextChars = static_cast<std::size_t>(
        std::clamp(std::stoll(getenvOr("BEEMETRY_TEXT_SPELL_MAX_CHARS", "30000")), 2000LL, 100000LL));
  } catch (...) {
    gMaxTextChars = 30000;
  }
  if (!gLanguageToolBase.empty()) {
    std::cerr << "[text_spell] LANGUAGETOOL_URL configured (on-premise spell service)" << std::endl;
  } else {
    std::cerr << "[text_spell] LANGUAGETOOL_URL empty — text spell endpoints will fail" << std::endl;
  }
  if (!gOllamaBase.empty()) {
    std::cerr << "[text_spell] OLLAMA_URL configured rewrite_model=" << gOllamaModel
               << " apa7_model=" << gOllamaApa7Model << std::endl;
  }
  gSerperApiKey = getenvOr("BEEMETRY_SERPER_API_KEY", "");
  try {
    gSerperTimeoutMs =
        std::clamp(std::stoi(getenvOr("BEEMETRY_SERPER_TIMEOUT_MS", "15000")), 3000, 60000);
  } catch (...) {
    gSerperTimeoutMs = 15000;
  }
  if (!gSerperApiKey.empty()) {
    std::cerr << "[text_spell] SERPER_API_KEY configured (búsqueda real de referencias habilitada)"
              << std::endl;
  } else {
    std::cerr << "[text_spell] SERPER_API_KEY vacío — /api/text/search-references responderá "
                 "serper_not_configured"
              << std::endl;
  }
  gTavilyApiKey = getenvOr("BEEMETRY_TAVILY_API_KEY", "");
  try {
    gTavilyTimeoutMs =
        std::clamp(std::stoi(getenvOr("BEEMETRY_TAVILY_TIMEOUT_MS", "15000")), 3000, 60000);
  } catch (...) {
    gTavilyTimeoutMs = 15000;
  }
  if (!gTavilyApiKey.empty()) {
    std::cerr << "[text_spell] TAVILY_API_KEY configured (proveedor de búsqueda preferido)"
              << std::endl;
  } else {
    std::cerr << "[text_spell] TAVILY_API_KEY vacío — se usará Serper si está configurado, "
                 "si no, search_not_configured"
              << std::endl;
  }
}

boost::json::object handleCorrectQuick(const boost::json::value &body) {
  std::string err;
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  const std::string src = requireTextField(obj, err);
  if (!err.empty()) {
    return json::object{{"error", err}};
  }
  const std::string trimmed = trimCopy(src);
  static const std::string kDemoPlaceholder = "Escribe aquí tu texto técnico...";
  if (trimmed.empty() || trimmed == kDemoPlaceholder) {
    return json::object{{"error", "empty_text"}};
  }

  // Corrección ortográfica/gramatical de MÁXIMA PRECISIÓN y FIEL al texto:
  // LanguageTool (NUNCA un LLM) es la fuente de las correcciones — se aplican
  // solo reemplazos seguros de las categorías ortografía/gramática
  // (TYPOS/MISSPELLING/GRAMMAR/TYPOGRAPHY, ver categoryAllowedForAutoApply /
  // applyLanguageToolSafeMatches). Así se corrigen los errores (p.ej.
  // "operatibo"->"operativo", "disponivilidad"->"disponibilidad") SIN
  // parafrasear ni inventar contenido ajeno al original. El reescritor con IA
  // (Ollama, /api/text/rewrite y "Optimizar IA") es una función APARTE, para
  // mejorar la redacción — no debe confundirse con este corrector.
  std::string working = src;
  const std::string lang =
      obj.contains("language") && obj.at("language").is_string()
          ? json::value_to<std::string>(obj.at("language"))
          : "es";
  std::string source = "languagetool_safe";
  if (auto lt = languageToolCheckJson(working, lang, "picky")) {
    working = applyLanguageToolSafeMatches(working, *lt);
  } else {
    // LanguageTool no disponible: se degrada al pulido determinístico (no
    // inventa nada; solo espacios, mayúscula inicial y unos pocos typos fijos).
    source = "backend_quick_fallback";
  }
  // Pulido determinístico final (espaciado, mayúscula inicial) — inofensivo,
  // se aplica siempre encima del resultado de LanguageTool.
  working = applyQuickSpanishCorrections(working);
  return json::object{{"text", working}, {"source", source}};
}

boost::json::object handleCorrectAdvanced(const boost::json::value &body) {
  std::string err;
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  const std::string src = requireTextField(obj, err);
  if (!err.empty()) {
    return json::object{{"error", err}};
  }
  static const std::string kDemoPlaceholder = "Escribe aquí tu texto técnico...";
  const std::string srcTrim = trimCopy(src);
  if (srcTrim.empty() || srcTrim == kDemoPlaceholder) {
    return json::object{{"error", "empty_text"}, {"suggestions", json::array{}}};
  }
  const std::string lang =
      obj.contains("language") && obj.at("language").is_string()
          ? json::value_to<std::string>(obj.at("language"))
          : "es-PE";
  const std::string level =
      obj.contains("level") && obj.at("level").is_string()
          ? json::value_to<std::string>(obj.at("level"))
          : "picky";

  auto lt = languageToolCheckJson(srcTrim, lang, level);
  if (!lt.has_value()) {
    // Return empty suggestions gracefully instead of failing
    return json::object{
        {"suggestions", json::array{}},
        {"language", lang},
        {"level", level},
        {"source", "backend_languagetool_mock"}
    };
  }
  json::array suggestions;
  if (lt->is_object() && lt->as_object().contains("matches") &&
      lt->as_object().at("matches").is_array()) {
    for (const auto &m : lt->as_object().at("matches").as_array()) {
      if (!m.is_object()) {
        continue;
      }
      const auto &mo = m.as_object();
      json::object row;
      if (mo.contains("offset") && mo.at("offset").is_int64()) {
        row["offset"] = mo.at("offset").as_int64();
      } else if (mo.contains("offset") && mo.at("offset").is_uint64()) {
        row["offset"] = static_cast<std::int64_t>(mo.at("offset").as_uint64());
      } else {
        continue;
      }
      if (mo.contains("length") && mo.at("length").is_int64()) {
        row["length"] = mo.at("length").as_int64();
      } else if (mo.contains("length") && mo.at("length").is_uint64()) {
        row["length"] = static_cast<std::int64_t>(mo.at("length").as_uint64());
      } else {
        continue;
      }
      if (row.at("length").as_int64() <= 0) {
        continue;
      }
      row["message"] = mo.contains("message") && mo.at("message").is_string()
                           ? mo.at("message")
                           : json::value("Posible corrección");
      json::array reps;
      if (mo.contains("replacements") && mo.at("replacements").is_array()) {
        int n = 0;
        for (const auto &r : mo.at("replacements").as_array()) {
          if (n >= 5) {
            break;
          }
          if (r.is_object()) {
            const auto &ro = r.as_object();
            if (ro.contains("value") && ro.at("value").is_string()) {
              std::string v = json::value_to<std::string>(ro.at("value"));
              v = trimCopy(std::move(v));
              if (!v.empty()) {
                reps.push_back(json::value(v));
                ++n;
              }
            }
          }
        }
      }
      row["replacements"] = reps;
      if (mo.contains("context") && mo.at("context").is_object()) {
        const auto &ctx = mo.at("context").as_object();
        if (ctx.contains("text") && ctx.at("text").is_string()) {
          row["context"] = ctx.at("text");
        }
      }
      suggestions.push_back(row);
    }
  }
  return json::object{{"suggestions", suggestions},
                      {"language", lang},
                      {"level", level},
                      {"source", "backend_languagetool"}};
}

boost::json::object handleRewrite(const boost::json::value &body) {
  std::string err;
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  std::string src = requireTextField(obj, err);
  if (!err.empty()) {
    return json::object{{"error", err}};
  }
  src = trimCopy(std::move(src));
  if (src.empty()) {
    return json::object{{"error", "empty_text"}};
  }
  static const std::string kDemoPlaceholder = "Escribe aquí tu texto técnico...";
  if (src == kDemoPlaceholder) {
    return json::object{{"error", "empty_text"}};
  }

  const std::string lang =
      obj.contains("language") && obj.at("language").is_string()
          ? json::value_to<std::string>(obj.at("language"))
          : "es-PE";
  const std::string level =
      obj.contains("level") && obj.at("level").is_string()
          ? json::value_to<std::string>(obj.at("level"))
          : "picky";
  bool useLlm = true;
  if (obj.contains("use_llm")) {
    if (obj.at("use_llm").is_bool()) {
      useLlm = obj.at("use_llm").as_bool();
    } else if (obj.at("use_llm").is_string()) {
      useLlm = json::value_to<std::string>(obj.at("use_llm")) != "false";
    }
  }

  json::array steps;
  std::string working = src;

  auto lt = languageToolCheckJson(working, lang, level);
  if (lt.has_value()) {
    working = applyLanguageToolSafeMatches(working, *lt);
    steps.push_back("languagetool_safe_apply");
  } else {
    steps.push_back("languagetool_skipped");
  }
  working = applyQuickSpanishCorrections(working);
  steps.push_back("quick_spanish");

  bool llmApplied = false;
  if (useLlm) {
    if (auto rewritten = ollamaRewriteText(working)) {
      if (!rewritten->empty() && *rewritten != working) {
        working = *rewritten;
        llmApplied = true;
        steps.push_back("ollama_rewrite");
      } else {
        steps.push_back("ollama_no_change");
      }
    } else {
      steps.push_back("ollama_unavailable_or_disabled");
    }
  } else {
    steps.push_back("ollama_skipped_by_client");
  }

  return json::object{{"text", working},
                      {"llm_applied", llmApplied},
                      {"steps", steps},
                      {"source", "backend_on_premise"}};
}

boost::json::object handleLanguageToolCheck(const boost::json::value &body) {
  std::string err;
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  const std::string src = requireTextField(obj, err);
  if (!err.empty()) {
    return json::object{{"error", err}};
  }
  const std::string lang =
      obj.contains("language") && obj.at("language").is_string()
          ? json::value_to<std::string>(obj.at("language"))
          : "es-PE";
  const std::string level =
      obj.contains("level") && obj.at("level").is_string()
          ? json::value_to<std::string>(obj.at("level"))
          : "picky";
  auto lt = languageToolCheckJson(trimCopy(src), lang, level);
  if (!lt.has_value()) {
    return json::object{{"error", "languagetool_unavailable"}};
  }
  return json::object{{"languagetool", *lt}};
}

namespace {

/** true si `haystack` contiene `needle` (comparación simple, sin
 * normalizar mayúsculas/acentos -- alcanza para detectar si el LLM
 * "recortó" o cambió un campo, no para comparación lingüística fina). */
bool containsSubstr(const std::string &haystack, const std::string &needle) {
  return !needle.empty() && haystack.find(needle) != std::string::npos;
}

/**
 * Validación estructural mínima de la respuesta del LLM antes de aceptarla:
 * (1) el año, si se dio, debe aparecer literalmente (evita que lo cambie o
 * lo omita); (2) el título, si se dio, debe aparecer literalmente en algún
 * lado (con o sin asteriscos de énfasis alrededor); (3) no debe quedar vacía
 * ni ser sospechosamente corta. No valida gramática APA fina -- solo que el
 * LLM no haya alterado/inventado el CONTENIDO de los campos, que es la
 * garantía que de verdad importa (el formato en sí es cosmético).
 */
bool apa7ResponseLooksValid(const std::string &candidate, const std::string &year,
                            const std::string &title) {
  if (candidate.size() < 8) {
    return false;
  }
  if (!year.empty() && !containsSubstr(candidate, year)) {
    return false;
  }
  if (!title.empty() && !containsSubstr(candidate, title)) {
    return false;
  }
  return true;
}

/** Formato APA 7 puramente mecánico, sin LLM -- usado como fallback si
 * Ollama no responde (o responde algo que alteró los datos originales), y
 * también disponible directo con `use_llm:false`. Nunca inventa nada: solo
 * ordena/puntúa los campos tal como llegaron. */
std::string deterministicApa7(const std::string &author, const std::string &year,
                              const std::string &title, const std::string &source,
                              const std::string &url) {
  std::ostringstream out;
  if (!author.empty()) {
    out << author << ". ";
  }
  out << "(" << (year.empty() ? "s.f." : year) << "). ";
  if (!title.empty()) {
    out << "*" << title << "*. ";
  }
  if (!source.empty()) {
    out << source << ". ";
  }
  if (!url.empty()) {
    out << url;
  }
  return trimCopy(out.str());
}

// ── Búsqueda real de referencias (Serper.dev) + filtro por dominio ────────
//
// El LLM local NUNCA decide qué fuente es "confiable" -- eso sería la misma
// alucinación que se quiere evitar, solo que disfrazada de juicio de
// confiabilidad. La confianza depende ÚNICAMENTE de esta lista de dominios,
// curada explícitamente por criterio humano (gobierno, universidades,
// organismos internacionales, editoriales/revistas académicas reconocidas
// del área de minería/geotecnia). Es una lista inicial razonable, no
// exhaustiva -- se espera que el equipo la amplíe según necesidad real.

/** Sufijos de dominio confiables en bloque (gobierno, educación, organismos
 * internacionales) -- cualquier host que TERMINE en uno de estos sufijos se
 * acepta, sin necesitar estar en la lista exacta de abajo. */
const std::vector<std::string> &trustedDomainSuffixes() {
  static const std::vector<std::string> kSuffixes = {
      ".gob.pe", ".gob.mx", ".gob.cl", ".gob.ar", ".gob.bo", ".gob.ec",
      ".gob.co", ".gob.uy", ".gob.py", ".gob.ve", ".gov", ".edu", ".edu.pe",
      ".ac.uk", ".ac.pe", ".int",
  };
  return kSuffixes;
}

/** Dominios exactos confiables (organismos internacionales, editoriales y
 * revistas académicas reconocidas) -- incluye subdominios de estos (p.ej.
 * "www.un.org", "link.springer.com"). */
const std::set<std::string> &trustedExactDomains() {
  static const std::set<std::string> kExact = {
      "un.org", "worldbank.org", "iso.org", "oecd.org", "who.int", "unesco.org",
      "icmm.com", "smenet.org", "cepal.org", "iadb.org", "cdc.gov", "usgs.gov",
      "epa.gov", "elsevier.com", "springer.com", "sciencedirect.com", "mdpi.com",
      "scielo.org", "redalyc.org",
  };
  return kExact;
}

std::string toLowerAsciiLocal(std::string s) {
  for (char &c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

/** Host (dominio:puerto) en minúsculas a partir de una URL completa --
 * parseo suficiente para el propósito (no necesita ser un parser de URL
 * completo, solo aislar el host para el chequeo de confianza). */
std::string extractHost(const std::string &url) {
  std::string rest = url;
  const auto schemePos = rest.find("://");
  if (schemePos != std::string::npos) {
    rest = rest.substr(schemePos + 3);
  }
  const auto slashPos = rest.find('/');
  if (slashPos != std::string::npos) {
    rest = rest.substr(0, slashPos);
  }
  const auto colonPos = rest.find(':');
  if (colonPos != std::string::npos) {
    rest = rest.substr(0, colonPos);
  }
  return toLowerAsciiLocal(rest);
}

bool isDomainTrusted(const std::string &host) {
  if (host.empty()) {
    return false;
  }
  for (const auto &suf : trustedDomainSuffixes()) {
    if (host.size() >= suf.size() &&
        host.compare(host.size() - suf.size(), suf.size(), suf) == 0) {
      return true;
    }
  }
  const auto &exact = trustedExactDomains();
  if (exact.count(host) > 0) {
    return true;
  }
  for (const auto &d : exact) {
    const std::string suf = "." + d;
    if (host.size() > suf.size() &&
        host.compare(host.size() - suf.size(), suf.size(), suf) == 0) {
      return true;
    }
  }
  return false;
}

struct SearchHit {
  std::string title;
  std::string url;
  std::string snippet;
};

/** Llama a Serper.dev (Google SERP real) -- devuelve error explícito en
 * `error` si la API key no está configurada, la llamada falla, o la
 * respuesta no tiene el formato esperado. Nunca lanza. */
std::vector<SearchHit> serperSearch(const std::string &query, std::string &error) {
  std::vector<SearchHit> out;
  if (gSerperApiKey.empty()) {
    error = "serper_not_configured";
    return out;
  }

  json::object body;
  body["q"] = query;
  body["gl"] = "pe";
  body["hl"] = "es";
  body["num"] = 20;
  const std::string payload = json::serialize(json::value(body));

  const auto hr = httpsPostJson("google.serper.dev", "/search", payload,
                                {{"X-API-KEY", gSerperApiKey}}, gSerperTimeoutMs);
  if (!hr.error.empty()) {
    error = "serper_" + hr.error;
    std::cerr << "[text_spell] serper error: " << hr.error << std::endl;
    return out;
  }
  if (hr.status != 200) {
    error = "serper_http_" + std::to_string(hr.status);
    std::cerr << "[text_spell] serper HTTP status=" << hr.status << std::endl;
    return out;
  }

  try {
    auto val = json::parse(hr.body);
    if (!val.is_object() || !val.as_object().contains("organic") ||
        !val.as_object().at("organic").is_array()) {
      return out;
    }
    for (const auto &item : val.as_object().at("organic").as_array()) {
      if (!item.is_object()) {
        continue;
      }
      const auto &o = item.as_object();
      SearchHit hit;
      hit.title = o.contains("title") && o.at("title").is_string()
                      ? json::value_to<std::string>(o.at("title"))
                      : "";
      hit.url = o.contains("link") && o.at("link").is_string()
                    ? json::value_to<std::string>(o.at("link"))
                    : "";
      hit.snippet = o.contains("snippet") && o.at("snippet").is_string()
                        ? json::value_to<std::string>(o.at("snippet"))
                        : "";
      if (!hit.url.empty()) {
        out.push_back(std::move(hit));
      }
    }
  } catch (...) {
    error = "serper_invalid_response";
  }
  return out;
}

/** Llama a Tavily (api.tavily.com/search) -- proveedor de búsqueda preferido.
 * Igual que serperSearch: nunca lanza, `error` queda vacío si todo bien. */
std::vector<SearchHit> tavilySearch(const std::string &query, std::string &error) {
  std::vector<SearchHit> out;
  if (gTavilyApiKey.empty()) {
    error = "tavily_not_configured";
    return out;
  }

  json::object body;
  body["api_key"] = gTavilyApiKey;
  body["query"] = query;
  body["search_depth"] = "basic";
  body["max_results"] = 20;
  // include_domains es una señal para Tavily, no la garantía real -- el
  // filtro local isDomainTrusted() se re-aplica siempre sobre la respuesta.
  json::array includeDomains;
  for (const auto &d : trustedExactDomains()) {
    includeDomains.push_back(json::string(d));
  }
  body["include_domains"] = includeDomains;
  const std::string payload = json::serialize(json::value(body));

  const auto hr = httpsPostJson("api.tavily.com", "/search", payload, {}, gTavilyTimeoutMs);
  if (!hr.error.empty()) {
    error = "tavily_" + hr.error;
    std::cerr << "[text_spell] tavily error: " << hr.error << std::endl;
    return out;
  }
  if (hr.status != 200) {
    error = "tavily_http_" + std::to_string(hr.status);
    std::cerr << "[text_spell] tavily HTTP status=" << hr.status << " body=" << hr.body
              << std::endl;
    return out;
  }

  try {
    auto val = json::parse(hr.body);
    if (!val.is_object() || !val.as_object().contains("results") ||
        !val.as_object().at("results").is_array()) {
      return out;
    }
    for (const auto &item : val.as_object().at("results").as_array()) {
      if (!item.is_object()) {
        continue;
      }
      const auto &o = item.as_object();
      SearchHit hit;
      hit.title = o.contains("title") && o.at("title").is_string()
                      ? json::value_to<std::string>(o.at("title"))
                      : "";
      hit.url = o.contains("url") && o.at("url").is_string()
                    ? json::value_to<std::string>(o.at("url"))
                    : "";
      hit.snippet = o.contains("content") && o.at("content").is_string()
                        ? json::value_to<std::string>(o.at("content"))
                        : "";
      if (!hit.url.empty()) {
        out.push_back(std::move(hit));
      }
    }
  } catch (...) {
    error = "tavily_invalid_response";
  }
  return out;
}

/** Llama a Tavily /extract sobre una URL puntual y devuelve el contenido
 * crudo de la página (para verificación programática, NUNCA vía LLM). */
std::string tavilyExtract(const std::string &url, std::string &error) {
  if (gTavilyApiKey.empty()) {
    error = "tavily_not_configured";
    return "";
  }
  json::object body;
  body["api_key"] = gTavilyApiKey;
  json::array urls;
  urls.push_back(json::string(url));
  body["urls"] = urls;
  const std::string payload = json::serialize(json::value(body));

  const auto hr = httpsPostJson("api.tavily.com", "/extract", payload, {}, gTavilyTimeoutMs);
  if (!hr.error.empty()) {
    error = "tavily_" + hr.error;
    return "";
  }
  if (hr.status != 200) {
    error = "tavily_http_" + std::to_string(hr.status);
    return "";
  }
  try {
    auto val = json::parse(hr.body);
    if (!val.is_object() || !val.as_object().contains("results") ||
        !val.as_object().at("results").is_array()) {
      error = "tavily_no_results";
      return "";
    }
    const auto &results = val.as_object().at("results").as_array();
    if (results.empty() || !results[0].is_object()) {
      error = "tavily_extract_failed";
      return "";
    }
    const auto &o = results[0].as_object();
    if (o.contains("raw_content") && o.at("raw_content").is_string()) {
      return json::value_to<std::string>(o.at("raw_content"));
    }
    error = "tavily_extract_empty";
    return "";
  } catch (...) {
    error = "tavily_invalid_response";
    return "";
  }
}

/** true si `needle` (ya en minúsculas ASCII, sin acentos garantizados) aparece
 * como substring de `haystackLower` (también ya normalizado a minúsculas). */
bool containsLowerSubstr(const std::string &haystackLower, const std::string &needleRaw) {
  if (needleRaw.empty()) {
    return false;
  }
  const std::string needle = toLowerAsciiLocal(needleRaw);
  return haystackLower.find(needle) != std::string::npos;
}

} // namespace

boost::json::object handleFormatApa7(const boost::json::value &body) {
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  auto getField = [&](const char *k) -> std::string {
    return obj.contains(k) && obj.at(k).is_string() ? json::value_to<std::string>(obj.at(k))
                                                    : std::string();
  };
  const std::string author = sanitizePromptField(getField("author"));
  const std::string year = sanitizePromptField(getField("year"));
  const std::string title = sanitizePromptField(getField("title"));
  const std::string source = sanitizePromptField(getField("source"));
  const std::string url = sanitizePromptField(getField("url"));

  if (title.empty() && author.empty()) {
    return json::object{{"error", "missing_fields"}};
  }

  const std::string fallback = deterministicApa7(author, year, title, source, url);

  bool useLlm = true;
  if (obj.contains("use_llm") && obj.at("use_llm").is_bool()) {
    useLlm = obj.at("use_llm").as_bool();
  }
  if (!useLlm) {
    return json::object{{"apa", fallback}, {"source", "deterministic"}};
  }

  // El LLM SOLO puntúa/ordena estos mismos campos -- instrucción explícita
  // de no agregar ni inventar ningún dato. Nunca es la fuente de los datos
  // en sí (esos ya vienen del usuario, verificados por él).
  const std::string prompt =
      "Tienes estos datos bibliograficos REALES, ya verificados por el usuario. "
      "NO agregues, cambies ni inventes ningun dato adicional -- usa EXACTAMENTE "
      "estos campos, solo ordenalos y puntualos segun la norma APA 7 (7ma edicion, "
      "estilo autor-fecha).\n"
      "autor=\"" + author + "\"\n"
      "anio=\"" + year + "\"\n"
      "titulo=\"" + title + "\"\n"
      "fuente=\"" + source + "\"\n"
      "url=\"" + url + "\"\n"
      "Responde EXCLUSIVAMENTE con un JSON de una sola linea: {\"apa\":\"...\"}";

  auto result = ollamaGenerateJsonField(prompt, "apa", gOllamaApa7Model);
  // Si el LLM no respondió, o respondió algo que alteró/omitió el año o el
  // título dados (ver apa7ResponseLooksValid) -- señal de que "mejoró" o
  // recortó el dato en vez de solo darle formato -- se descarta y se usa el
  // determinístico. Nunca se entrega al usuario una cita cuyo contenido no
  // se pueda verificar contra lo que él mismo ingresó.
  if (!result.has_value() || result->empty() ||
      !apa7ResponseLooksValid(*result, year, title)) {
    return json::object{{"apa", fallback}, {"source", "deterministic_fallback"}};
  }
  return json::object{{"apa", *result}, {"source", "ollama"}};
}

boost::json::object handleSearchReferences(const boost::json::value &body) {
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  std::string query;
  if (obj.contains("query") && obj.at("query").is_string()) {
    query = json::value_to<std::string>(obj.at("query"));
  }
  query = trimCopy(query);
  if (query.empty()) {
    return json::object{{"error", "missing_query"}};
  }
  if (query.size() > 300) {
    query = query.substr(0, 300);
  }

  // Tavily es el proveedor preferido (free tier mensual recurrente, pensado
  // para IA/RAG); si no está configurado, se cae a Serper (ya implementado
  // antes); si ninguno está configurado, error explícito -- nunca falla en
  // silencio ni finge tener resultados.
  std::string err;
  std::vector<SearchHit> hits;
  std::string source;
  if (!gTavilyApiKey.empty()) {
    hits = tavilySearch(query, err);
    source = "tavily";
  } else if (!gSerperApiKey.empty()) {
    hits = serperSearch(query, err);
    source = "serper";
  } else {
    return json::object{{"error", "search_not_configured"}};
  }
  if (!err.empty()) {
    return json::object{{"error", err}};
  }

  // El filtro de confianza por dominio es la ÚNICA garantía real acá -- se
  // aplica siempre, sin excepción ni "el proveedor/LLM decide que igual es
  // confiable", sin importar cuál de los dos proveedores haya respondido.
  json::array trusted;
  int excludedCount = 0;
  for (const auto &hit : hits) {
    const std::string host = extractHost(hit.url);
    if (isDomainTrusted(host)) {
      trusted.push_back(json::object{
          {"title", hit.title}, {"url", hit.url}, {"snippet", hit.snippet}, {"domain", host}});
    } else {
      ++excludedCount;
    }
  }

  return json::object{{"results", trusted},
                      {"excluded_untrusted_count", excludedCount},
                      {"source", source}};
}

boost::json::object handleVerifyReference(const boost::json::value &body) {
  if (!body.is_object()) {
    return json::object{{"error", "invalid_json"}};
  }
  const auto &obj = body.as_object();
  auto getField = [&](const char *k) -> std::string {
    return obj.contains(k) && obj.at(k).is_string() ? json::value_to<std::string>(obj.at(k))
                                                    : std::string();
  };
  const std::string url = trimCopy(getField("url"));
  const std::string title = trimCopy(getField("title"));
  const std::string year = trimCopy(getField("year"));
  if (url.empty()) {
    return json::object{{"error", "missing_url"}};
  }

  std::string err;
  const std::string content = tavilyExtract(url, err);
  if (!err.empty()) {
    // No configurado o falló la extracción -- no es un error fatal para el
    // flujo de inserción de la cita, solo significa "no se pudo verificar
    // programáticamente". El frontend debe tratarlo como advertencia, no
    // como bloqueo.
    return json::object{{"error", err}};
  }

  const std::string contentLower = toLowerAsciiLocal(content);
  const bool yearMatched = year.empty() ? false : containsLowerSubstr(contentLower, year);
  // Para el título, alcanza con que una porción significativa de palabras
  // (>=4 letras) del título ingresado aparezca en el contenido de la
  // página -- exigir el título completo carácter por carácter sería frágil
  // ante diferencias de puntuación/mayúsculas entre la cita y la página real.
  int titleWordsTotal = 0;
  int titleWordsMatched = 0;
  {
    std::istringstream iss(title);
    std::string word;
    while (iss >> word) {
      std::string clean;
      for (char c : word) {
        if (std::isalnum(static_cast<unsigned char>(c))) {
          clean.push_back(c);
        }
      }
      if (clean.size() < 4) {
        continue;
      }
      ++titleWordsTotal;
      if (containsLowerSubstr(contentLower, clean)) {
        ++titleWordsMatched;
      }
    }
  }
  const bool titleMatched =
      titleWordsTotal > 0 && (static_cast<double>(titleWordsMatched) / titleWordsTotal) >= 0.6;
  const bool verified = yearMatched || titleMatched;

  return json::object{{"verified", verified},
                      {"matched_year", yearMatched},
                      {"matched_title", titleMatched},
                      {"source", "tavily_extract"}};
}

} // namespace text_spell
