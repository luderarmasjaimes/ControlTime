// --------------------------------------------------------------------------
// mfa_routes.cpp — enrolamiento/verificación de TOTP (RFC 6238), ADR-135.
//
// Contexto: cierre de la ronda de endurecimiento post red-team 2026-08-26/27
// (ADR-133/134). Aquellos ADR cerraron el ROBO/uso indebido de una sesión ya
// emitida; este cierra la TOMA DE CONTROL de una cuenta legítima cuya
// contraseña se filtró/robó/adivinó -- sin el código del segundo factor, esa
// contraseña sola ya no basta para loguearse.
// --------------------------------------------------------------------------
#include "mfa_routes.hpp"
#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "totp.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../security/security_alerts.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <boost/json.hpp>
#include <chrono>
#include <mutex>
#include <string>
#include <unordered_map>

namespace json = boost::json;
using http_utils::makeJsonResponse;
using config::AppConfig;

namespace auth {
namespace mfa {
namespace {

// Limitador simple de intentos de verificación (enroll y login), separado
// del limitador de login por contraseña (main.cpp::loginRateCheck, no
// exportado desde esa unidad de compilación) -- mismo criterio de "5 en 5
// min" ya calibrado para biometría/contraseña en este proyecto. Sin esto,
// un código de 6 dígitos (1 en 1,000,000 por ventana de 30s) queda expuesto
// a fuerza bruta sin fricción si un atacante ya tiene la contraseña.
std::mutex gMfaAttemptMutex;
std::unordered_map<std::string, std::pair<int, std::chrono::steady_clock::time_point>> gMfaAttempts;

bool mfaRateCheck(const std::string &key) {
  std::scoped_lock lk(gMfaAttemptMutex);
  const auto now = std::chrono::steady_clock::now();
  auto it = gMfaAttempts.find(key);
  if (it == gMfaAttempts.end()) return true;
  if (now - it->second.second > std::chrono::minutes(5)) {
    gMfaAttempts.erase(it);
    return true;
  }
  return it->second.first < 5;
}

void mfaRateIncrement(const std::string &key) {
  std::scoped_lock lk(gMfaAttemptMutex);
  auto &entry = gMfaAttempts[key];
  entry.first += 1;
  entry.second = std::chrono::steady_clock::now();
}

void mfaRateClear(const std::string &key) {
  std::scoped_lock lk(gMfaAttemptMutex);
  gMfaAttempts.erase(key);
}

}  // namespace

// ── GET /api/auth/mfa/status ────────────────────────────────────────────
http::response<http::string_body>
handleMfaStatus(const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  std::string err;
  const auto status = getTotpStatusPg(AppConfig::instance().gDatabaseUrl, session->userId, err);
  const bool enabled = status.has_value() && status->second;
  return makeJsonResponse(http::status::ok, json::object{{"enabled", enabled}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"enabled", false}});
#endif
}

// ── POST /api/auth/mfa/enroll ───────────────────────────────────────────
// Genera un secreto nuevo y lo guarda PENDIENTE (totp_enabled sigue false
// hasta /verify-enroll) -- así un enrolamiento a medias (usuario cierra la
// pestaña antes de escanear/confirmar) nunca deja la cuenta con un secreto
// "activo" que el propio usuario no llegó a guardar en su authenticator.
http::response<http::string_body>
handleMfaEnroll(const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  const std::string secret = totp::generateBase32Secret();
  std::string err;
  if (!setPendingTotpSecretPg(AppConfig::instance().gDatabaseUrl, session->userId, secret, err)) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "no_se_pudo_generar_el_secreto"}});
  }
  const std::string accountLabel = session->username + "@" + session->company;
  const std::string uri = totp::buildOtpAuthUri(secret, accountLabel);
  return makeJsonResponse(http::status::ok,
                          json::object{{"secret", secret}, {"otpauth_uri", uri}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "postgres support is not compiled"}});
#endif
}

// ── POST /api/auth/mfa/verify-enroll ────────────────────────────────────
// body: {"code": "123456"}. Confirma que el usuario efectivamente guardó el
// secreto en un authenticator real (no solo que el servidor lo generó).
http::response<http::string_body>
handleMfaVerifyEnroll(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!mfaRateCheck("enroll|" + session->userId)) {
    return makeJsonResponse(http::status::too_many_requests,
                            json::object{{"error", "demasiados_intentos"}});
  }
#if HAS_LIBPQ
  std::string code;
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("code")) if (v->is_string()) code = json::value_to<std::string>(*v);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  std::string err;
  const auto status = getTotpStatusPg(AppConfig::instance().gDatabaseUrl, session->userId, err);
  if (!status || status->first.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "no_hay_enrolamiento_pendiente"}});
  }
  if (!totp::verifyCode(status->first, code)) {
    mfaRateIncrement("enroll|" + session->userId);
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "codigo_invalido"}});
  }
  mfaRateClear("enroll|" + session->userId);
  if (!enableTotpPg(AppConfig::instance().gDatabaseUrl, session->userId, err)) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "no_se_pudo_activar"}});
  }
  auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
  if (PQstatus(lease.get()) == CONNECTION_OK) {
    appendAuthAuditLogPg(lease.get(), "mfa_enrolled", session->company, session->username, true,
                         "ok", std::nullopt, std::nullopt, std::nullopt, http_utils::getClientIp(req));
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "enabled"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "postgres support is not compiled"}});
#endif
}

// ── POST /api/auth/mfa/disable ──────────────────────────────────────────
// body: {"code": "123456"} -- exige el código vigente (prueba de posesión
// del segundo factor) antes de quitarlo; no basta con estar logueado, o un
// atacante con una sesión robada (ventana de 15 min, ver ADR-132) podría
// desactivar el MFA de la víctima sin siquiera tener el celular.
http::response<http::string_body>
handleMfaDisable(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!mfaRateCheck("disable|" + session->userId)) {
    return makeJsonResponse(http::status::too_many_requests,
                            json::object{{"error", "demasiados_intentos"}});
  }
#if HAS_LIBPQ
  std::string code;
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("code")) if (v->is_string()) code = json::value_to<std::string>(*v);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  std::string err;
  const auto status = getTotpStatusPg(AppConfig::instance().gDatabaseUrl, session->userId, err);
  if (!status || !status->second) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "mfa_no_esta_activo"}});
  }
  if (!totp::verifyCode(status->first, code)) {
    mfaRateIncrement("disable|" + session->userId);
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "codigo_invalido"}});
  }
  mfaRateClear("disable|" + session->userId);
  if (!disableTotpPg(AppConfig::instance().gDatabaseUrl, session->userId, err)) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "no_se_pudo_desactivar"}});
  }
  auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
  if (PQstatus(lease.get()) == CONNECTION_OK) {
    appendAuthAuditLogPg(lease.get(), "mfa_disabled", session->company, session->username, true,
                         "ok", std::nullopt, std::nullopt, std::nullopt, http_utils::getClientIp(req));
  }
  // Cambio de postura de seguridad de la cuenta -- vale la pena que alguien
  // se entere, no solo que quede en el log de auditoría (mismo criterio que
  // los otros 3 puntos de detección de ADR-133/134).
  security::sendSecurityAlert("mfa_disabled",
                              "company=" + session->company + " user=" + session->username +
                                  " ip=" + http_utils::getClientIp(req));
  return makeJsonResponse(http::status::ok, json::object{{"status", "disabled"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "postgres support is not compiled"}});
#endif
}

void registerRoutes(router::Router &r) {
  r.get("/api/auth/mfa/status",         handleMfaStatus);
  r.post("/api/auth/mfa/enroll",        handleMfaEnroll);
  r.post("/api/auth/mfa/verify-enroll", handleMfaVerifyEnroll);
  r.post("/api/auth/mfa/disable",       handleMfaDisable);
}

}  // namespace mfa
}  // namespace auth
