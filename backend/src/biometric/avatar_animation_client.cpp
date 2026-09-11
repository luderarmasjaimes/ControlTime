#include "avatar_animation_client.hpp"
#include "biometric_types.hpp"
#include "face_analysis.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

// HAS_LIBPQ se define POR ARCHIVO en este backend (ver nota en
// app_config.hpp) -- este archivo solo incluía app_config.hpp/http_utils.hpp
// antes de gpu_mutex.hpp, así que "#if HAS_LIBPQ" ahí evaluaba como macro no
// definida (0) y el mutex de exclusión GPU quedaba compilado-fuera en
// silencio, nunca activo.
#if __has_include(<libpq-fe.h>)
#define HAS_LIBPQ 1
#elif __has_include(<postgresql/libpq-fe.h>)
#define HAS_LIBPQ 1
#else
#define HAS_LIBPQ 0
#endif

#include "../storage/gpu_mutex.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;

namespace biometric {

namespace {

// Duplicado a propósito (mismo criterio que report_export_jobs.cpp): este
// archivo solo direcciona una URL http:// interna simple, mantenerlo
// independiente de ai_engine_client.cpp evita acoplar el avatar animado a
// cambios pensados solo para el resto de llamadas a ai_engine.
void disableNagleForLowLatency(beast::tcp_stream &stream) {
  beast::error_code ec;
  auto &sock = beast::get_lowest_layer(stream).socket();
  sock.set_option(asio::ip::tcp::no_delay(true), ec);
}

}  // namespace

AvatarAnimationResult fetchAnimatedAvatar(
    const std::vector<unsigned char> &sourceImageBytes,
    const std::string &drivingText, bool transparentBg) {
  AvatarAnimationResult out;
  auto &cfg = config::AppConfig::instance();

  if (cfg.gAvatarAnimationEngineUrl.empty()) {
    out.error = "avatar_animation_disabled";
    return out;
  }
  if (sourceImageBytes.empty() || drivingText.empty()) {
    out.error = "avatar_animation_missing_input";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(cfg.gAvatarAnimationEngineUrl + "/animate", endpoint)) {
    out.error = "avatar_animation_invalid_url";
    return out;
  }

  std::string boundary = "----InformeBoundary" + http_utils::makeId();
  std::string body;
  body.reserve(sourceImageBytes.size() + drivingText.size() + 512);
  body += "--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"image\"; filename=\"source.png\"\r\n";
  body += "Content-Type: image/png\r\n\r\n";
  body.append(reinterpret_cast<const char *>(sourceImageBytes.data()),
              static_cast<std::streamsize>(sourceImageBytes.size()));
  body += "\r\n--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"text\"\r\n\r\n";
  body += drivingText;
  body += "\r\n--" + boundary + "\r\n";
  body += "Content-Disposition: form-data; name=\"transparent_bg\"\r\n\r\n";
  body += (transparentBg ? "1" : "0");
  body += "\r\n--" + boundary + "--\r\n";

  // Mutex de GPU (ADR-150/160): serializa esta llamada -- que puede tardar
  // 200-300s reales -- contra cualquier otra inferencia GPU-pesada de este
  // backend (avatar_engine vía fetchCartoonAvatarFromAiEngine incluida). A
  // diferencia de esa función, ESTA sí debe bloquear en vez de degradar
  // silenciosamente: sin el mutex, dos llamadas GPU simultáneas en los
  // mismos ~8GB de VRAM compartidos son exactamente el escenario que
  // ADR-150 midió a 403 MiB de margen real.
#if HAS_LIBPQ
  storage::GpuInferenceMutex gpuLock(cfg.gpuMutexDatabaseUrl());
#endif

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(cfg.gAvatarAnimationTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    out.error = "avatar_animation_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  disableNagleForLowLatency(stream);
  if (ec) {
    out.error = "avatar_animation_connect_failed";
    return out;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    out.error = "avatar_animation_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  // 96MB: generoso para un video corto (segundos, no minutos) en 256/512px
  // -- ver avatar_animation_engine/server.py, mismo criterio que el límite
  // de 64MB ya usado para el PNG 4K de fetchFaceEmbeddingFromAiEngine.
  http::response_parser<http::string_body> parser;
  parser.body_limit(96U * 1024U * 1024U);
  http::read(stream, buffer, parser, ec);
  auto res = parser.release();
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "avatar_animation_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "avatar_animation_http_not_ok";
    return out;
  }

  auto ctIt = res.find(http::field::content_type);
  out.contentType = ctIt != res.end() ? std::string(ctIt->value()) : "video/mp4";
  const std::string &b = res.body();
  out.videoBytes.assign(b.begin(), b.end());
  return out;
}

}  // namespace biometric
