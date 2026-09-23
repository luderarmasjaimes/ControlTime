#include "pdf_ocr_client.hpp"
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
#define gAiEnginePdfOcrTimeoutMs config::AppConfig::instance().gAiEnginePdfOcrTimeoutMs

namespace reports {

namespace {

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

std::optional<double> getOptDouble(const json::object &o, const char *key) {
  if (!o.contains(key)) return std::nullopt;
  const auto &v = o.at(key);
  if (v.is_double()) return v.as_double();
  if (v.is_int64()) return static_cast<double>(v.as_int64());
  return std::nullopt;
}

std::optional<int> getOptInt(const json::object &o, const char *key) {
  if (!o.contains(key)) return std::nullopt;
  const auto &v = o.at(key);
  if (v.is_int64()) return static_cast<int>(v.as_int64());
  if (v.is_double()) return static_cast<int>(v.as_double());
  return std::nullopt;
}

std::optional<bool> getOptBool(const json::object &o, const char *key) {
  if (!o.contains(key) || !o.at(key).is_bool()) return std::nullopt;
  return o.at(key).as_bool();
}

/** Cuenta CARACTERES Unicode (no bytes) de un string UTF-8 -- necesario
 * porque los spans de estilo usan offsets de carácter (mismo contrato que
 * TextStyleSpan.start/end en el frontend, que indexa el string de JS, no
 * bytes). `block.text.size()` cuenta bytes -- con texto en español real
 * (ñ/á/é/...) eso da un `end` más grande que el largo real del texto. */
int utf8Length(const std::string &s) {
  int count = 0;
  for (unsigned char c : s) {
    if ((c & 0xC0) != 0x80) ++count; // no es byte de continuación UTF-8
  }
  return count;
}

PdfOcrSpan parseSpan(const json::object &s) {
  PdfOcrSpan span;
  span.start = getOptInt(s, "start").value_or(0);
  span.end = getOptInt(s, "end").value_or(0);
  span.bold = getOptBool(s, "bold");
  span.italic = getOptBool(s, "italic");
  span.underline = getOptBool(s, "underline");
  span.color = getStr(s, "color");
  span.fontSize = getOptDouble(s, "font_size");
  span.fontFamily = getStr(s, "font_family");
  span.headingStyle = getStr(s, "heading_style");
  span.textAlign = getStr(s, "text_align");
  return span;
}

std::optional<PdfOcrPageGeometry> parseGeometry(const json::object &p) {
  if (!p.contains("page_geometry") || !p.at("page_geometry").is_object()) return std::nullopt;
  const auto &g = p.at("page_geometry").as_object();
  PdfOcrPageGeometry geo;
  geo.widthPt = getOptDouble(g, "width_pt").value_or(0);
  geo.heightPt = getOptDouble(g, "height_pt").value_or(0);
  geo.paperSize = getStr(g, "paper_size");
  geo.orientation = getStr(g, "orientation");
  geo.marginLeftPt = getOptDouble(g, "margin_left_pt").value_or(0);
  geo.marginTopPt = getOptDouble(g, "margin_top_pt").value_or(0);
  geo.marginRightPt = getOptDouble(g, "margin_right_pt").value_or(0);
  geo.marginBottomPt = getOptDouble(g, "margin_bottom_pt").value_or(0);
  return geo;
}

std::optional<PdfOcrBlockBBox> parseBlockBBox(const json::object &b) {
  if (!b.contains("bbox") || !b.at("bbox").is_array()) return std::nullopt;
  const auto &arr = b.at("bbox").as_array();
  if (arr.size() != 4) return std::nullopt;
  auto num = [](const json::value &v) -> double {
    if (v.is_double()) return v.as_double();
    if (v.is_int64()) return static_cast<double>(v.as_int64());
    return 0;
  };
  PdfOcrBlockBBox box;
  box.x0 = num(arr[0]);
  box.y0 = num(arr[1]);
  box.x1 = num(arr[2]);
  box.y1 = num(arr[3]);
  return box;
}

std::optional<PdfOcrTextLayout> parseTextLayout(const json::object &b) {
  if (!b.contains("layout") || !b.at("layout").is_object()) return std::nullopt;
  const auto &l = b.at("layout").as_object();
  PdfOcrTextLayout layout;
  layout.baselinePt = getOptDouble(l, "baseline_pt").value_or(0);
  layout.pitchPt = getOptDouble(l, "pitch_pt").value_or(0);
  layout.fontSizePt = getOptDouble(l, "font_size_pt").value_or(0);
  layout.lineCount = getOptInt(l, "line_count").value_or(1);
  if (layout.pitchPt <= 0 || layout.fontSizePt <= 0) return std::nullopt;
  return layout;
}

PdfOcrBlock parseBlock(const json::object &b) {
  PdfOcrBlock block;
  block.type = getStr(b, "type");
  block.bbox = parseBlockBBox(b);
  if (block.type == "paragraph") {
    block.text = getStr(b, "text");
    block.layout = parseTextLayout(b);
    if (b.contains("spans") && b.at("spans").is_array()) {
      for (const auto &sVal : b.at("spans").as_array()) {
        if (sVal.is_object()) block.spans.push_back(parseSpan(sVal.as_object()));
      }
    }
    // heading_style/text_align a nivel de bloque (ver pdf_ocr_pipeline.py)
    // se traducen acá a un span que cubre el párrafo COMPLETO -- mismo
    // contrato que TextStyleSpan.headingStyle/textAlign en el frontend
    // (un span de rango completo equivale a la propiedad a nivel de bloque).
    const std::string headingStyle = getStr(b, "heading_style");
    const std::string textAlign = getStr(b, "text_align");
    if (!headingStyle.empty() || !textAlign.empty()) {
      PdfOcrSpan wholeParagraph;
      wholeParagraph.start = 0;
      wholeParagraph.end = utf8Length(block.text);
      wholeParagraph.headingStyle = headingStyle;
      wholeParagraph.textAlign = textAlign;
      block.spans.push_back(wholeParagraph);
    }
  } else if (block.type == "table") {
    if (b.contains("rows") && b.at("rows").is_array()) {
      for (const auto &rowVal : b.at("rows").as_array()) {
        if (!rowVal.is_array()) continue;
        std::vector<std::string> row;
        for (const auto &cellVal : rowVal.as_array()) {
          row.push_back(cellVal.is_string() ? json::value_to<std::string>(cellVal) : std::string());
        }
        block.tableRows.push_back(std::move(row));
      }
    }
  } else if (block.type == "figure") {
    block.imageBase64 = getStr(b, "image_base64");
    block.imageMime = getStr(b, "mime");
    if (block.imageMime.empty()) block.imageMime = "image/png";
  }
  return block;
}

PdfOcrPage parsePage(const json::object &p) {
  PdfOcrPage page;
  page.pageNumber = getOptInt(p, "page_number").value_or(0);
  page.source = getStr(p, "source");
  page.confidence = getOptDouble(p, "confidence");
  page.error = getStr(p, "error");
  page.geometry = parseGeometry(p);
  page.layout = getStr(p, "layout");
  if (p.contains("background") && p.at("background").is_object()) {
    const auto &bg = p.at("background").as_object();
    const std::string mime = getStr(bg, "mime");
    // Allowlist estricta, mismo criterio que el resto de imágenes del
    // editor: solo PNG/JPEG llegan como data: URI al lienzo.
    if (mime == "image/png" || mime == "image/jpeg") {
      page.backgroundBase64 = getStr(bg, "image_base64");
      page.backgroundMime = mime;
    }
  }
  if (p.contains("blocks") && p.at("blocks").is_array()) {
    for (const auto &bVal : p.at("blocks").as_array()) {
      if (bVal.is_object()) page.blocks.push_back(parseBlock(bVal.as_object()));
    }
  }
  return page;
}

} // namespace

PdfOcrImportResult importPdfWithOcr(const std::vector<unsigned char> &fileBytes,
                                    const std::string &filename) {
  PdfOcrImportResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (fileBytes.empty()) {
    out.error = "empty_file";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/ocr_pdf", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  const std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(fileBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"file\"; filename=\"" +
          (filename.empty() ? std::string("documento.pdf") : filename) + "\"\r\n";
  body += "Content-Type: application/pdf\r\n\r\n";
  body.append(reinterpret_cast<const char *>(fileBytes.data()),
              static_cast<std::streamsize>(fileBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEnginePdfOcrTimeoutMs));

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
  // El JSON de respuesta puede traer varias páginas con imágenes recortadas
  // en base64 (figuras/diagramas de páginas escaneadas) -- mismo techo de
  // 64MB que el resto de payloads grandes de este backend (ver nginx.conf
  // client_max_body_size / main.cpp body_limit).
  parser.body_limit(64U * 1024U * 1024U);
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
      out.error = getStr(obj, "error").empty() ? "ocr_pdf_failed" : getStr(obj, "error");
      out.scannedPages = getOptInt(obj, "scanned_pages").value_or(0);
      out.scannedPagesLimit = getOptInt(obj, "limit").value_or(0);
      return out;
    }
    out.pageCount = getOptInt(obj, "page_count").value_or(0);
    if (obj.contains("pages") && obj.at("pages").is_array()) {
      for (const auto &pVal : obj.at("pages").as_array()) {
        if (pVal.is_object()) out.pages.push_back(parsePage(pVal.as_object()));
      }
    }
    out.ok = true;
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

} // namespace reports
