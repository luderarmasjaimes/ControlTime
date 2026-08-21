#include "ai_engine_client.hpp"
#include "ai_engine_conn_pool.hpp"
#include "face_analysis.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../onnx_cartoon.hpp"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <iostream>

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>
#include <opencv2/opencv.hpp>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace json = boost::json;
namespace fs = std::filesystem;

using http_utils::makeId;
using auth::GlassesEmaState;
using auth::gGlassesEmaMutex;
using auth::gGlassesEmaBySession;
using auth::applyIcaoGlassesEma;

#define gAiEngineUrl              config::AppConfig::instance().gAiEngineUrl
#define gAiEngineMaxImageBytes    config::AppConfig::instance().gAiEngineMaxImageBytes
#define gAiEngineTimeoutMs        config::AppConfig::instance().gAiEngineTimeoutMs
#define gSeetaFace6TimeoutMs      config::AppConfig::instance().gSeetaFace6TimeoutMs
#define gDeepFaceSilentTimeoutMs  config::AppConfig::instance().gDeepFaceSilentTimeoutMs
#define gAiEngineCartoonTimeoutMs config::AppConfig::instance().gAiEngineCartoonTimeoutMs
#define gCartoonOnnxModelPath     config::AppConfig::instance().gCartoonOnnxModelPath

namespace biometric {

// Cada llamada a ai_engine es un POST-respuesta chico (frame JPEG + JSON de
// vuelta) sobre la red interna del bridge de Docker: exactamente el patrón
// que Nagle's algorithm castiga con ~40ms de espera artificial por paquete
// chico, sin ganar nada a cambio (no hay throughput bulk que agrupar). En la
// cadencia de verify-frame (VERIFY_SYNC_MS=175ms), ese retraso es un
// porcentaje no despreciable del presupuesto por frame. No falla la
// request si el socket no soporta la opción (best-effort).
static void disableNagleForLowLatency(beast::tcp_stream &stream) {
  beast::error_code ec;
  stream.socket().set_option(asio::ip::tcp::no_delay(true), ec);
}

namespace {

PooledAiConn makeFreshAiConn(const ParsedHttpEndpoint &endpoint,
                              beast::error_code &ec) {
  PooledAiConn c;
  c.ioc = std::make_shared<asio::io_context>();
  asio::ip::tcp::resolver resolver{*c.ioc};
  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) return c;
  c.stream = std::make_shared<beast::tcp_stream>(*c.ioc);
  c.stream->connect(results, ec);
  if (ec) {
    c.stream.reset();
    return c;
  }
  disableNagleForLowLatency(*c.stream);
  return c;
}

// POST reusando una conexión pooled hacia `endpoint` si hay una idle
// disponible (ver ai_engine_conn_pool.hpp para el porqué). Si la conexión
// reusada falla al escribir (el peer la cerró mientras esperaba idle, p.ej.
// keep-alive timeout del lado ai_engine), se descarta y se reintenta UNA vez
// con una conexión nueva -- nunca degrada por debajo del connect-per-request
// anterior, solo mejora cuando la reutilización efectivamente funciona. Si
// el servidor no ofrece keep-alive en la respuesta (res.keep_alive()==false
// -- p.ej. si el server WSGI de desarrollo de Flask no lo soporta), la
// conexión se cierra normalmente y no se poolea: el código sigue siendo
// correcto sin importar si ai_engine soporta HTTP/1.1 persistente o no.
bool sendPooledAiEnginePost(const ParsedHttpEndpoint &endpoint,
                             const std::string &contentType,
                             const std::string &body, long timeoutMs,
                             http::response<http::string_body> &outRes,
                             std::string &outError) {
  auto &pool = AiEngineConnPool::instance();

  beast::error_code ec;
  bool reused = false;
  std::optional<PooledAiConn> conn = pool.tryAcquire(endpoint.host, endpoint.port);
  if (conn) {
    reused = true;
  } else {
    PooledAiConn c = makeFreshAiConn(endpoint, ec);
    if (!c.valid()) {
      outError = "ai_engine_connect_failed";
      return false;
    }
    conn = std::move(c);
  }

  auto writeRequest = [&](PooledAiConn &c, beast::error_code &e) {
    c.stream->expires_after(std::chrono::milliseconds(timeoutMs));
    http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
    req.set(http::field::host, endpoint.host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::content_type, contentType);
    req.keep_alive(true);
    req.body() = body;  // copia: permite reintentar sin mover el original
    req.prepare_payload();
    http::write(*c.stream, req, e);
  };

  writeRequest(*conn, ec);
  if (ec && reused) {
    conn->stream.reset();
    beast::error_code ec2;
    PooledAiConn fresh = makeFreshAiConn(endpoint, ec2);
    if (!fresh.valid()) {
      outError = "ai_engine_connect_failed";
      return false;
    }
    conn = std::move(fresh);
    reused = false;
    ec.clear();
    writeRequest(*conn, ec);
  }
  if (ec) {
    outError = "ai_engine_write_failed";
    return false;
  }

  beast::flat_buffer buffer;
  http::read(*conn->stream, buffer, outRes, ec);
  if (ec) {
    outError = "ai_engine_read_failed";
    return false;
  }

  if (outRes.keep_alive() && conn->valid()) {
    conn->stream->expires_never();
    pool.release(endpoint.host, endpoint.port, *conn);
  } else if (conn->valid()) {
    beast::error_code ignore;
    conn->stream->socket().shutdown(asio::ip::tcp::socket::shutdown_both, ignore);
  }
  return true;
}

}  // namespace

std::optional<AiEngineFrameResult>
analyzeFrameWithAiEngine(
    const std::vector<unsigned char> &imageBytes,
    const std::optional<std::string> &glassesSessionKey) {
  if (gAiEngineUrl.empty()) {
    return std::nullopt;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    AiEngineFrameResult limited;
    limited.error = "ai_engine_skipped_size_limit";
    return limited;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/analyze_eyes", endpoint)) {
    AiEngineFrameResult bad;
    bad.error = "ai_engine_invalid_url";
    return bad;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  // session_id: aisla la histeresis de lentes/EAR en eye_analyzer.py por
  // captura (antes eran variables globales de modulo compartidas por TODAS
  // las capturas concurrentes -- una segunda pestana, o incluso trafico de
  // pruebas, contaminaba la deteccion de otra sesion).
  if (glassesSessionKey.has_value() && !glassesSessionKey->empty()) {
    body += "--" + boundary + "\r\n";
    body += "Content-Disposition: form-data; name=\"session_id\"\r\n\r\n";
    body += *glassesSessionKey;
    body += "\r\n";
  }
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  http::response<http::string_body> res;
  std::string sendError;
  if (!sendPooledAiEnginePost(endpoint, "multipart/form-data; boundary=" + boundary,
                               body, gAiEngineTimeoutMs, res, sendError)) {
    AiEngineFrameResult fail;
    fail.error = sendError;
    return fail;
  }
  if (res.result() != http::status::ok) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_http_not_ok";
    return fail;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      AiEngineFrameResult fail;
      fail.error = "ai_engine_invalid_json";
      return fail;
    }
    const auto &obj = payload.as_object();
    const bool hasOvalField =
        obj.if_contains("face_oval_points") && obj.at("face_oval_points").is_array();
    if (hasOvalField) {
      std::cerr << "[AI_OVAL] face_oval_points raw size="
                << obj.at("face_oval_points").as_array().size() << std::endl;
    } else {
      std::cerr << "[AI_OVAL] face_oval_points missing in ai payload" << std::endl;
    }
    AiEngineFrameResult out;
    out.available = true;
    out.detected = obj.if_contains("detected") && obj.at("detected").is_bool()
                       ? obj.at("detected").as_bool()
                       : false;
    out.bothOpen = obj.if_contains("both_open") && obj.at("both_open").is_bool()
                       ? obj.at("both_open").as_bool()
                       : true;
    out.mouthClosed =
        obj.if_contains("mouth_closed") && obj.at("mouth_closed").is_bool()
            ? obj.at("mouth_closed").as_bool()
            : true;

    double rawGlasses = 0.0;
    if (obj.if_contains("glasses_fusion_score") &&
        (obj.at("glasses_fusion_score").is_double() ||
         obj.at("glasses_fusion_score").is_int64())) {
      rawGlasses = obj.at("glasses_fusion_score").is_double()
                       ? obj.at("glasses_fusion_score").as_double()
                       : static_cast<double>(obj.at("glasses_fusion_score").as_int64());
    } else if (obj.if_contains("glasses_score") &&
               (obj.at("glasses_score").is_double() ||
                obj.at("glasses_score").is_int64())) {
      rawGlasses = obj.at("glasses_score").is_double()
                       ? obj.at("glasses_score").as_double()
                       : static_cast<double>(obj.at("glasses_score").as_int64());
    } else if (obj.if_contains("glasses_cv_score") &&
               (obj.at("glasses_cv_score").is_double() ||
                obj.at("glasses_cv_score").is_int64())) {
      rawGlasses = obj.at("glasses_cv_score").is_double()
                       ? obj.at("glasses_cv_score").as_double()
                       : static_cast<double>(obj.at("glasses_cv_score").as_int64());
    }
    out.glassesCvScore = rawGlasses;
    if (obj.if_contains("glasses_cv_score") &&
        (obj.at("glasses_cv_score").is_double() ||
         obj.at("glasses_cv_score").is_int64())) {
      out.glassesCvScore = obj.at("glasses_cv_score").is_double()
                               ? obj.at("glasses_cv_score").as_double()
                               : static_cast<double>(obj.at("glasses_cv_score").as_int64());
    }

    // NOTA: el booleano "no_glasses" que manda ai_engine por frame se
    // ignora deliberadamente aquí. Antes se usaba para pisar el resultado
    // de applyIcaoGlassesEma (Schmitt-trigger sobre rawGlasses), lo que
    // anulaba esa histéresis y dejaba pasar directo el ruido frame a frame
    // del detector de lentes -- causa raíz del parpadeo SI/NO observado en
    // "LENTE/SIN LENTE" durante la captura biométrica, que además impedía
    // sostener kRequiredValidCaptureFrames consecutivos (biometric_types.hpp).
    if (glassesSessionKey.has_value() && !glassesSessionKey->empty()) {
      std::scoped_lock lk(gGlassesEmaMutex);
      GlassesEmaState &st = gGlassesEmaBySession[*glassesSessionKey];
      double emaOut = 0.0;
      out.noGlasses =
          applyIcaoGlassesEma(st, rawGlasses, out.detected, emaOut);
      out.glassesScore = emaOut;
    } else {
      out.glassesScore = rawGlasses;
      out.noGlasses = rawGlasses < 59.0;
    }
    bool hasLeftEar = false;
    bool hasRightEar = false;
    if (obj.if_contains("left_ear") &&
        (obj.at("left_ear").is_double() || obj.at("left_ear").is_int64())) {
      out.leftEar = obj.at("left_ear").is_double()
                        ? obj.at("left_ear").as_double()
                        : static_cast<double>(obj.at("left_ear").as_int64());
      hasLeftEar = true;
    }
    if (obj.if_contains("right_ear") &&
        (obj.at("right_ear").is_double() || obj.at("right_ear").is_int64())) {
      out.rightEar = obj.at("right_ear").is_double()
                         ? obj.at("right_ear").as_double()
                         : static_cast<double>(obj.at("right_ear").as_int64());
      hasRightEar = true;
    }
    out.hasEarMetrics = hasLeftEar && hasRightEar;
    if (obj.if_contains("confidence") &&
        (obj.at("confidence").is_double() || obj.at("confidence").is_int64())) {
      out.hasAiEyeConfidence = true;
      out.aiEyeConfidence01 =
          obj.at("confidence").is_double()
              ? obj.at("confidence").as_double()
              : static_cast<double>(obj.at("confidence").as_int64());
    }
    if (obj.if_contains("face_frontal") && obj.at("face_frontal").is_bool()) {
      out.hasFaceFrontal = true;
      out.faceFrontal = obj.at("face_frontal").as_bool();
    }
    if (obj.if_contains("head_yaw_ratio") &&
        (obj.at("head_yaw_ratio").is_double() || obj.at("head_yaw_ratio").is_int64())) {
      out.hasHeadYawRatio = true;
      out.headYawRatio = obj.at("head_yaw_ratio").is_double()
                              ? obj.at("head_yaw_ratio").as_double()
                              : static_cast<double>(obj.at("head_yaw_ratio").as_int64());
    }
    if (obj.if_contains("face_oval_points") && obj.at("face_oval_points").is_array()) {
      const auto &arr = obj.at("face_oval_points").as_array();
      out.faceOvalPoints.reserve(arr.size());
      for (const auto &v : arr) {
        if (!v.is_array()) {
          continue;
        }
        const auto &pt = v.as_array();
        if (pt.size() < 2) {
          continue;
        }
        if (!((pt[0].is_double() || pt[0].is_int64()) &&
              (pt[1].is_double() || pt[1].is_int64()))) {
          continue;
        }
        const float x = static_cast<float>(
            pt[0].is_double() ? pt[0].as_double() : static_cast<double>(pt[0].as_int64()));
        const float y = static_cast<float>(
            pt[1].is_double() ? pt[1].as_double() : static_cast<double>(pt[1].as_int64()));
        out.faceOvalPoints.emplace_back(x, y);
      }
      out.hasFaceOvalPoints = out.faceOvalPoints.size() >= 5;
      std::cerr << "[AI_OVAL] parsed points=" << out.faceOvalPoints.size() << std::endl;
      if (!out.faceOvalPoints.empty()) {
        float minX = out.faceOvalPoints[0].x;
        float maxX = out.faceOvalPoints[0].x;
        float minY = out.faceOvalPoints[0].y;
        float maxY = out.faceOvalPoints[0].y;
        for (const auto &p : out.faceOvalPoints) {
          minX = std::min(minX, p.x);
          maxX = std::max(maxX, p.x);
          minY = std::min(minY, p.y);
          maxY = std::max(maxY, p.y);
        }
        std::cerr << "[AI_OVAL] pts bbox min=(" << minX << "," << minY
                  << ") max=(" << maxX << "," << maxY << ")" << std::endl;
      }
      if (out.hasFaceOvalPoints) {
        try {
          out.faceOvalEllipse = cv::fitEllipse(out.faceOvalPoints);
          out.hasFaceOvalEllipse = true;
          std::cerr << "[AI_OVAL] fitEllipse ok" << std::endl;
          std::cerr << "[AI_OVAL] ellipse cx=" << out.faceOvalEllipse.center.x
                    << " cy=" << out.faceOvalEllipse.center.y
                    << " w=" << out.faceOvalEllipse.size.width
                    << " h=" << out.faceOvalEllipse.size.height
                    << " ang=" << out.faceOvalEllipse.angle << std::endl;
        } catch (...) {
          out.hasFaceOvalEllipse = false;
          std::cerr << "[AI_OVAL] fitEllipse failed" << std::endl;
        }
      }
    }
    return out;
  } catch (...) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_parse_failed";
    return fail;
  }
}

AiEngineEmbeddingResult
fetchFaceEmbeddingFromAiEngine(const std::vector<unsigned char> &imageBytes) {
  AiEngineEmbeddingResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.error = "ai_engine_skipped_size_limit";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/face_embedding", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEngineTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    out.error = "ai_engine_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) {
    out.error = "ai_engine_connect_failed";
    return out;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type,
          "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    out.error = "ai_engine_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  // El JSON incluye miniatura + maestro PNG 4K en base64. El límite por
  // defecto de Beast puede ser insuficiente para retratos con mucho detalle.
  http::response_parser<http::string_body> parser;
  parser.body_limit(64U * 1024U * 1024U);
  http::read(stream, buffer, parser, ec);
  auto res = parser.release();
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "ai_engine_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.error = "ai_engine_invalid_json";
      return out;
    }
    const auto &obj = payload.as_object();
    if (obj.if_contains("ok") && obj.at("ok").is_bool() && !obj.at("ok").as_bool()) {
      if (obj.if_contains("error") && obj.at("error").is_string()) {
        out.error = json::value_to<std::string>(obj.at("error"));
      } else {
        out.error = "face_embedding_failed";
      }
      return out;
    }
    if (!obj.if_contains("embedding") || !obj.at("embedding").is_array()) {
      out.error = "ai_engine_no_embedding";
      return out;
    }
    for (const auto &v : obj.at("embedding").as_array()) {
      if (v.is_double()) {
        out.embedding.push_back(v.as_double());
      } else if (v.is_int64()) {
        out.embedding.push_back(static_cast<double>(v.as_int64()));
      }
    }
    if (out.embedding.size() != kFaceEmbeddingVectorDim) {
      out.embedding.clear();
      out.error = "embedding_dim_mismatch";
      return out;
    }
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

FaceAnalysis fetchSeetaFaceAnalysisFromAiEngine(
    const std::vector<unsigned char> &imageBytes, const std::string &mode) {
  FaceAnalysis out;
  out.provider = "seetaface6_local";
  if (gAiEngineUrl.empty()) {
    out.issues.push_back("ai_engine_disabled");
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.issues.push_back("ai_engine_skipped_size_limit");
    return out;
  }
  if (mode != "register" && mode != "verify") {
    out.issues.push_back("invalid_biometric_mode");
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/seetaface_analyze", endpoint)) {
    out.issues.push_back("ai_engine_invalid_url");
    return out;
  }
  const std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 384);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"mode\"\r\n\r\n" + mode + "\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gSeetaFace6TimeoutMs));
  const auto results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) { out.issues.push_back("ai_engine_resolve_failed"); return out; }
  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) { out.issues.push_back("ai_engine_connect_failed"); return out; }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();
  http::write(stream, req, ec);
  if (ec) { out.issues.push_back("ai_engine_write_failed"); return out; }

  beast::flat_buffer buffer;
  http::response_parser<http::string_body> parser;
  parser.body_limit(4U * 1024U * 1024U);
  http::read(stream, buffer, parser, ec);
  auto res = parser.release();
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
  if (ec) { out.issues.push_back("ai_engine_read_failed"); return out; }
  if (res.result() != http::status::ok) {
    out.issues.push_back("seetaface6_http_not_ok");
    return out;
  }

  try {
    const auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.issues.push_back("seetaface6_invalid_json");
      return out;
    }
    const auto &obj = payload.as_object();
    if (const auto *quality = obj.if_contains("quality"); quality && quality->is_object()) {
      const auto &q = quality->as_object();
      if (const auto *score = q.if_contains("score"); score &&
          (score->is_double() || score->is_int64())) {
        out.qualityScore = score->is_double() ? score->as_double()
                                             : static_cast<double>(score->as_int64());
      }
      if (const auto *issues = q.if_contains("issues"); issues && issues->is_array()) {
        for (const auto &issue : issues->as_array()) {
          if (issue.is_string()) out.issues.push_back(json::value_to<std::string>(issue));
        }
      }
    }
    if (const auto *error = obj.if_contains("error"); error && error->is_string()) {
      out.issues.push_back(json::value_to<std::string>(*error));
    }
    if (const auto *tpl = obj.if_contains("template"); tpl && tpl->is_array()) {
      for (const auto &value : tpl->as_array()) {
        double parsed = 0.0;
        if (value.is_double()) parsed = value.as_double();
        else if (value.is_int64()) parsed = static_cast<double>(value.as_int64());
        else continue;
        if (!std::isfinite(parsed)) {
          out.faceTemplate.clear();
          out.issues.push_back("seetaface6_template_non_finite");
          return out;
        }
        out.faceTemplate.push_back(parsed);
      }
    }
    const bool pass = obj.if_contains("pass") && obj.at("pass").is_bool() &&
                      obj.at("pass").as_bool();
    const bool validDim = out.faceTemplate.size() == 512 || out.faceTemplate.size() == 1024;
    if (pass && !validDim) out.issues.push_back("seetaface6_template_dim_invalid");
    out.ok = pass && validDim;
    return out;
  } catch (...) {
    out.issues.push_back("seetaface6_parse_failed");
    return out;
  }
}

FaceAnalysis fetchDeepFaceSilentAnalysisFromAiEngine(
    const std::vector<unsigned char> &imageBytes, const std::string &mode) {
  FaceAnalysis out;
  out.provider = "deepface_silentface";
  if (gAiEngineUrl.empty()) {
    out.issues.push_back("ai_engine_disabled");
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.issues.push_back("ai_engine_skipped_size_limit");
    return out;
  }
  if (mode != "register" && mode != "verify") {
    out.issues.push_back("invalid_biometric_mode");
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/deepface_analyze", endpoint)) {
    out.issues.push_back("ai_engine_invalid_url");
    return out;
  }
  const std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 384);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"mode\"\r\n\r\n" + mode + "\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gDeepFaceSilentTimeoutMs));
  const auto results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) { out.issues.push_back("ai_engine_resolve_failed"); return out; }
  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) { out.issues.push_back("ai_engine_connect_failed"); return out; }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();
  http::write(stream, req, ec);
  if (ec) { out.issues.push_back("ai_engine_write_failed"); return out; }

  beast::flat_buffer buffer;
  http::response_parser<http::string_body> parser;
  parser.body_limit(4U * 1024U * 1024U);
  http::read(stream, buffer, parser, ec);
  auto res = parser.release();
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
  if (ec) { out.issues.push_back("ai_engine_read_failed"); return out; }
  if (res.result() != http::status::ok) {
    out.issues.push_back("ai_engine_http_not_ok");
    return out;
  }

  try {
    const auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.issues.push_back("deepface_silentface_invalid_json");
      return out;
    }
    const auto &obj = payload.as_object();
    if (const auto *quality = obj.if_contains("quality"); quality && quality->is_object()) {
      const auto &q = quality->as_object();
      if (const auto *score = q.if_contains("score"); score &&
          (score->is_double() || score->is_int64())) {
        out.qualityScore = score->is_double() ? score->as_double()
                                             : static_cast<double>(score->as_int64());
      }
      if (const auto *issues = q.if_contains("issues"); issues && issues->is_array()) {
        for (const auto &issue : issues->as_array()) {
          if (issue.is_string()) out.issues.push_back(json::value_to<std::string>(issue));
        }
      }
    }
    if (const auto *error = obj.if_contains("error"); error && error->is_string()) {
      out.issues.push_back(json::value_to<std::string>(*error));
    }
    if (const auto *tpl = obj.if_contains("template"); tpl && tpl->is_array()) {
      for (const auto &value : tpl->as_array()) {
        double parsed = 0.0;
        if (value.is_double()) parsed = value.as_double();
        else if (value.is_int64()) parsed = static_cast<double>(value.as_int64());
        else continue;
        if (!std::isfinite(parsed)) {
          out.faceTemplate.clear();
          out.issues.push_back("deepface_silentface_template_non_finite");
          return out;
        }
        out.faceTemplate.push_back(parsed);
      }
    }
    const bool pass = obj.if_contains("pass") && obj.at("pass").is_bool() &&
                      obj.at("pass").as_bool();
    // Facenet512 siempre entrega 512 componentes -- a diferencia de
    // SeetaFace6, que acepta 512 o 1024 según el modelo de reconocimiento.
    const bool validDim = out.faceTemplate.size() == kFaceEmbeddingVectorDim;
    if (pass && !validDim) out.issues.push_back("deepface_silentface_template_dim_invalid");
    out.ok = pass && validDim;
    return out;
  } catch (...) {
    out.issues.push_back("deepface_silentface_parse_failed");
    return out;
  }
}

AiEngineCartoonResult
fetchCartoonAvatarFromAiEngine(const std::vector<unsigned char> &imageBytes) {
  AiEngineCartoonResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.error = "ai_engine_skipped_size_limit";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/cartoon_avatar", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"portrait.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(
      std::chrono::milliseconds(gAiEngineCartoonTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    out.error = "ai_engine_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) {
    out.error = "ai_engine_connect_failed";
    return out;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type,
          "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    out.error = "ai_engine_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "ai_engine_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.error = "ai_engine_invalid_json";
      return out;
    }
    const auto &obj = payload.as_object();
    if (obj.if_contains("ok") && obj.at("ok").is_bool() && !obj.at("ok").as_bool()) {
      if (obj.if_contains("error") && obj.at("error").is_string()) {
        out.error = json::value_to<std::string>(obj.at("error"));
      } else {
        out.error = "cartoon_avatar_failed";
      }
      return out;
    }
    if (!obj.if_contains("image_base64") ||
        !obj.at("image_base64").is_string()) {
      out.error = "ai_engine_no_image";
      return out;
    }
    out.imageBase64 = json::value_to<std::string>(obj.at("image_base64"));
    if (obj.if_contains("image_hd_base64") &&
        obj.at("image_hd_base64").is_string()) {
      out.imageHdBase64 =
          json::value_to<std::string>(obj.at("image_hd_base64"));
    }
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes) {
  // El sidecar local conserva la silueta con MediaPipe y entrega miniatura +
  // maestro 4K. Se prefiere para evitar ampliar un tensor AnimeGAN de 512 px.
  AiEngineCartoonResult sidecar = fetchCartoonAvatarFromAiEngine(imageBytes);
  if (sidecar.ok()) {
    return sidecar;
  }

  AiEngineCartoonResult out;
  if (informeCartoonOnnxRuntimeLinked() && !gCartoonOnnxModelPath.empty() &&
      fs::exists(gCartoonOnnxModelPath)) {
    std::string b64;
    std::string err;
    if (informeCartoonOnnxFromImageBytes(imageBytes, gCartoonOnnxModelPath, b64,
                                         err) &&
        !b64.empty()) {
      out.imageBase64 = std::move(b64);
      return out;
    }
  }
  out.error = sidecar.error.empty() ? "all_local_avatar_generators_failed"
                                    : sidecar.error;
  return out;
}

AiEngineDniScanResult
scanDocumentWithAiEngine(const std::vector<unsigned char> &imageBytes) {
  AiEngineDniScanResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.error = "ai_engine_skipped_size_limit";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/scan_document", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEngineTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    out.error = "ai_engine_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) {
    out.error = "ai_engine_connect_failed";
    return out;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type,
          "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    out.error = "ai_engine_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "ai_engine_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.error = "ai_engine_invalid_json";
      return out;
    }
    const auto &obj = payload.as_object();
    const auto getStr = [&obj](const char *key) -> std::string {
      return obj.if_contains(key) && obj.at(key).is_string()
                 ? json::value_to<std::string>(obj.at(key))
                 : std::string();
    };
    out.found = obj.if_contains("found") && obj.at("found").is_bool() &&
               obj.at("found").as_bool();
    out.method = getStr("method");
    out.dni = getStr("dni");
    out.firstName = getStr("first_name");
    out.lastName = getStr("last_name");
    out.sex = getStr("sex");
    out.birthDate = getStr("birth_date");
    out.expiryDate = getStr("expiry_date");
    out.checksumValid = obj.if_contains("checksum_valid") &&
                        obj.at("checksum_valid").is_bool() &&
                        obj.at("checksum_valid").as_bool();
    return out;
  } catch (const std::exception &) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

} // namespace biometric
