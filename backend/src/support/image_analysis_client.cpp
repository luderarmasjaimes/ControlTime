#include "image_analysis_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>

#include <regex>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace json = boost::json;

using http_utils::makeId;

#define gAiEngineUrl config::AppConfig::instance().gAiEngineUrl
#define gAiEngineImageAnalyzeTimeoutMs config::AppConfig::instance().gAiEngineCvExtractTimeoutMs

namespace support {

namespace {

// Duplicado a propósito de cv_extraction_client.cpp::ParsedHttpEndpoint /
// parseHttpEndpoint -- mismo criterio de helper mínimo autocontenido por
// archivo ya establecido en este codebase (ver DynamicWhere en
// support_storage_pg.cpp/cv_storage_pg.cpp).
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

std::string getStr(const json::object &o, const char *key) {
  return o.contains(key) && o.at(key).is_string() ? json::value_to<std::string>(o.at(key)) : "";
}

} // namespace

ImageAnalysisResult analyzeImageWithAiEngine(const std::vector<unsigned char> &imageBytes,
                                             const std::string &filename,
                                             const std::string &mimeType) {
  ImageAnalysisResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty()) {
    out.error = "empty_image";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/analyze_image", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  const std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"image\"; filename=\"" +
          (filename.empty() ? std::string("imagen.jpg") : filename) + "\"\r\n";
  body += "Content-Type: " + (mimeType.empty() ? std::string("application/octet-stream") : mimeType) +
          "\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEngineImageAnalyzeTimeoutMs));

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
  // La respuesta es solo QR/OCR de texto -- mucho más chica que la imagen.
  parser.body_limit(2U * 1024U * 1024U);
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
      out.error = getStr(obj, "error").empty() ? "analyze_image_failed" : getStr(obj, "error");
      return out;
    }
    if (obj.contains("qr_codes") && obj.at("qr_codes").is_array()) {
      for (const auto &v : obj.at("qr_codes").as_array()) {
        if (v.is_string()) out.qrCodes.push_back(json::value_to<std::string>(v));
      }
    }
    out.ocrText = getStr(obj, "ocr_text");
    out.ok = true;
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

} // namespace support
