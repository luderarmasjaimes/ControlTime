#include "fotocheck_routes.hpp"
#include "fotocheck_crypto.hpp"
#include "fotocheck_share_links.hpp"
#include "auth_storage_pg.hpp"
#include "../biometric/face_analysis.hpp"  // decodeBase64/encodeBase64 (helper autocontenido reusado)
#include "../config/app_config.hpp"
#include "../http/http_client.hpp"
#include "../http/http_utils.hpp"
#include "../support/image_analysis_client.hpp"

#include <boost/json.hpp>
#include <chrono>

namespace http = boost::beast::http;
namespace json = boost::json;
using http_utils::makeJsonResponse;
using http_utils::makePngResponse;
using http_utils::routePathOnly;
using config::AppConfig;

namespace auth {
namespace fotocheck {
namespace {

long long nowUnixSeconds() {
  return static_cast<long long>(
      std::chrono::duration_cast<std::chrono::seconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

// Validez del contenido del QR (no de la credencial en sí, que no expira): el
// QR solo sirve para precargar un formulario, así que una fecha de
// vencimiento larga es una salvaválvula razonable, no un requisito de
// seguridad estricto -- ver fotocheck_crypto.hpp.
constexpr long long kQrValiditySeconds = 60LL * 60 * 24 * 365 * 2;  // 2 años

json::object buildFotocheckFields(const AuthUser &user) {
  return json::object{
      {"dni", user.dni},
      {"first_name", user.firstName},
      {"last_name", user.lastName},
      {"company", user.company},
      {"email", user.email},
      {"mobile", user.mobile},
      {"phone", user.phone},
      {"role", user.role},
      {"username", user.username},
  };
}

// ── GET /api/fotocheck/{token} ──────────────────────────────────────────
http::response<http::string_body>
handleGetFotocheck(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &) {
  const std::string pathOnly = routePathOnly(std::string(req.target()));
  static const std::string kPrefix = "/api/fotocheck/";
  if (pathOnly.rfind(kPrefix, 0) != 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string token = pathOnly.substr(kPrefix.size());
  if (token.empty() || token == "scan-qr") {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }

  auto &cfg = AppConfig::instance();
  const auto userId = resolveFotocheckShareLinkPg(cfg.gDatabaseUrl, token);
  if (!userId) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "fotocheck_link_invalido"}});
  }
  const auto user = findUserByIdPg(cfg.gDatabaseUrl, *userId);
  if (!user) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "usuario_no_encontrado"}});
  }
  if (user->idPhotoBase64.empty()) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "foto_no_disponible"}});
  }

  json::object qrPayload = buildFotocheckFields(*user);
  qrPayload["exp"] = nowUnixSeconds() + kQrValiditySeconds;
  const std::string qrCiphertext = encryptFotocheckPayload(qrPayload);
  if (qrCiphertext.empty()) {
    return makeJsonResponse(http::status::service_unavailable,
                            json::object{{"error", "fotocheck_qr_key_no_configurada"}});
  }

  if (cfg.gAiEngineUrl.empty()) {
    return makeJsonResponse(http::status::service_unavailable,
                            json::object{{"error", "ai_engine_disabled"}});
  }
  const json::object requestBody{
      {"photo_base64", user->idPhotoBase64},
      {"qr_payload", qrCiphertext},
      {"fields", buildFotocheckFields(*user)},
  };
  const auto result = http_client::request(
      cfg.gAiEngineUrl + "/generate_fotocheck", http::verb::post, json::serialize(requestBody),
      {{"Content-Type", "application/json"}}, cfg.gAiEngineCartoonTimeoutMs);
  if (!result.ok) {
    return makeJsonResponse(http::status::bad_gateway,
                            json::object{{"error", "fotocheck_render_failed"},
                                         {"detail", result.error}});
  }
  try {
    const auto payload = json::parse(result.body);
    const auto &obj = payload.as_object();
    if (!obj.if_contains("ok") || !obj.at("ok").as_bool() || !obj.if_contains("image_base64")) {
      return makeJsonResponse(http::status::bad_gateway,
                              json::object{{"error", "fotocheck_render_invalid_response"}});
    }
    const std::string imageBase64 = json::value_to<std::string>(obj.at("image_base64"));
    std::vector<unsigned char> pngBytes;
    if (!biometric::decodeBase64(imageBase64, pngBytes) || pngBytes.empty()) {
      return makeJsonResponse(http::status::bad_gateway,
                              json::object{{"error", "fotocheck_render_decode_failed"}});
    }
    return makePngResponse(std::string(pngBytes.begin(), pngBytes.end()));
  } catch (...) {
    return makeJsonResponse(http::status::bad_gateway,
                            json::object{{"error", "fotocheck_render_invalid_json"}});
  }
}

// ── POST /api/fotocheck/scan-qr ─────────────────────────────────────────
http::response<http::string_body>
handleScanFotocheckQr(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &) {
  std::string imageBase64;
  try {
    const auto val = json::parse(req.body());
    const auto &obj = val.as_object();
    if (obj.if_contains("image_base64") && obj.at("image_base64").is_string()) {
      imageBase64 = json::value_to<std::string>(obj.at("image_base64"));
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"ok", false},
                                                                     {"error", "invalid_json"}});
  }
  if (imageBase64.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"ok", false}, {"error", "image_base64_requerido"}});
  }

  std::vector<unsigned char> imageBytes;
  if (!biometric::decodeBase64(imageBase64, imageBytes) || imageBytes.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"ok", false}, {"error", "imagen_invalida"}});
  }

  // Reutiliza el analizador genérico de QR/OCR ya usado por el chat de
  // soporte (ADR-129) -- decodifica CUALQUIER QR (pyzbar sin filtro de
  // símbolo), no algo específico de fotocheck del lado de ai_engine.
  const auto analysis = support::analyzeImageWithAiEngine(imageBytes, "frame.jpg", "jpg");
  if (!analysis.ok || analysis.qrCodes.empty()) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", false}, {"error", "qr_no_encontrado"}});
  }

  // El QR podría contener cualquier string si el objeto no es un fotocheck
  // -- se intenta descifrar cada candidato hasta que uno valide (tag GCM),
  // en vez de asumir que el primer QR detectado es el correcto.
  for (const auto &candidate : analysis.qrCodes) {
    const auto decrypted = decryptFotocheckPayload(candidate);
    if (!decrypted) continue;
    const auto &obj = *decrypted;
    long long exp = 0;
    if (obj.if_contains("exp") && obj.at("exp").is_int64()) {
      exp = obj.at("exp").as_int64();
    }
    if (exp > 0 && exp < nowUnixSeconds()) {
      return makeJsonResponse(http::status::ok,
                              json::object{{"ok", false}, {"error", "qr_expirado"}});
    }
    // "exp" queda incluido en `fields` sin problema -- el frontend solo lee
    // las claves que conoce (dni/first_name/...) para precargar el
    // formulario, cualquier campo extra se ignora.
    return makeJsonResponse(http::status::ok, json::object{{"ok", true}, {"fields", obj}});
  }

  return makeJsonResponse(http::status::ok,
                          json::object{{"ok", false}, {"error", "qr_invalido"}});
}

}  // namespace

void registerRoutes(router::Router &r) {
  r.get("/api/fotocheck/", handleGetFotocheck);  // prefix match, ver /api/reports/{id}
  r.post("/api/fotocheck/scan-qr", handleScanFotocheckQr);
}

}  // namespace fotocheck
}  // namespace auth
