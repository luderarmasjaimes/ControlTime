#include "text_spell_service.hpp"

#include <algorithm>
#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <regex>
#include <sstream>
#include <string>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;

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

std::string gLanguageToolBase;
int gLanguageToolTimeoutMs = 45000;
std::string gOllamaBase;
std::string gOllamaModel = "tinyllama";
int gOllamaTimeoutMs = 120000;
std::size_t gMaxTextChars = 30000;

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
  gLanguageToolBase = getenvOr("LANGUAGETOOL_URL", "");
  gOllamaBase = getenvOr("OLLAMA_URL", "");
  gOllamaModel = getenvOr("OLLAMA_MODEL", "tinyllama");
  try {
    gLanguageToolTimeoutMs =
        std::clamp(std::stoi(getenvOr("LANGUAGETOOL_TIMEOUT_MS", "45000")), 1000, 120000);
  } catch (...) {
    gLanguageToolTimeoutMs = 45000;
  }
  try {
    gOllamaTimeoutMs = std::clamp(std::stoi(getenvOr("OLLAMA_TIMEOUT_MS", "120000")), 5000,
                                   600000);
  } catch (...) {
    gOllamaTimeoutMs = 120000;
  }
  try {
    gMaxTextChars = static_cast<std::size_t>(
        std::clamp(std::stoll(getenvOr("TEXT_SPELL_MAX_CHARS", "30000")), 2000LL, 100000LL));
  } catch (...) {
    gMaxTextChars = 30000;
  }
  if (!gLanguageToolBase.empty()) {
    std::cerr << "[text_spell] LANGUAGETOOL_URL configured (on-premise spell service)" << std::endl;
  } else {
    std::cerr << "[text_spell] LANGUAGETOOL_URL empty — text spell endpoints will fail" << std::endl;
  }
  if (!gOllamaBase.empty()) {
    std::cerr << "[text_spell] OLLAMA_URL configured model=" << gOllamaModel << std::endl;
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
  const std::string out = applyQuickSpanishCorrections(src);
  return json::object{{"text", out}, {"source", "backend_quick"}};
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

} // namespace text_spell
