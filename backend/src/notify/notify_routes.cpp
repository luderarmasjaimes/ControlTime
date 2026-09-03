#include "notify_routes.hpp"
#include "notify_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"

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

namespace json = boost::json;
using http_utils::makeJsonResponse;
using http_utils::routePathOnly;
using config::AppConfig;
using auth::resolveAuthSession;
using auth::hasPermission;

namespace notify {
namespace {

std::string jsonStr(const json::object &o, const char *k, const std::string &def = "") {
  if (const auto *v = o.if_contains(k))
    if (v->is_string()) return std::string(v->as_string());
  return def;
}

// ── POST /api/notifications/send ─────────────────────────────────────────
// API genérica reutilizable por cualquier app de la empresa (otros
// frontends, apps de smartphone, etc.) -- misma convención de autenticación
// que el resto de la plataforma documenta para integradores externos (login
// normal -> sesión -> llamar esta ruta con esa sesión, ver
// docs/integration/EXTERNAL_FRONTEND_AUTH.md), sin inventar un esquema de
// API-key nuevo.
//
// El destinatario SIEMPRE se resuelve server-side contra `auth_users` a
// partir de `user_id` -- deliberadamente NO se acepta un email/teléfono
// arbitrario en el body. Aceptar destinos arbitrarios convertiría esta ruta
// en un relay de spam (cualquier caller autorizado podría hacer que el
// backend mande WhatsApp/SMS/email a cualquier número/dirección). Si en el
// futuro hace falta notificar a alguien fuera de la plataforma, es una
// decisión deliberada de v2 (permiso nuevo + validación propia), no un
// default silencioso.
http::response<http::string_body>
handleSendNotification(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  if (!hasPermission(session->userId, session->tenantId, session->role, "notificaciones.send"))
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "notificaciones.send"}});

  std::string targetUserId, title, bodyText, sourceApp, relatedType, relatedId;
  std::vector<std::string> channels;
  try {
    const auto val = json::parse(req.body());
    const auto &obj = val.as_object();
    targetUserId = jsonStr(obj, "user_id");
    title = jsonStr(obj, "title");
    bodyText = jsonStr(obj, "body");
    sourceApp = jsonStr(obj, "source_app", "desconocido");
    relatedType = jsonStr(obj, "related_type");
    relatedId = jsonStr(obj, "related_id");
    if (const auto *ch = obj.if_contains("channels"))
      if (ch->is_array())
        for (const auto &c : ch->as_array())
          if (c.is_string()) channels.push_back(std::string(c.as_string()));
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (targetUserId.empty() || title.empty() || channels.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "faltan_campos"},
                                         {"detail", "user_id, title y channels son obligatorios"}});
  }

#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK)
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});

  // Guardia IDOR: el destinatario debe pertenecer a la MISMA empresa que la
  // sesión que envía -- sin esto, adivinar un UUID de auth_users de OTRA
  // empresa bastaría para hacer que el backend le notifique por email/
  // WhatsApp/SMS a un desconocido.
  const char *userParams[2] = {targetUserId.c_str(), session->company.c_str()};
  storage::PgResult userRes{PQexecParams(conn,
      "SELECT COALESCE(email,''), COALESCE(phone,''), COALESCE(mobile,'') "
      "FROM auth_users WHERE id = $1::uuid AND company_name = $2",
      2, nullptr, userParams, nullptr, nullptr, 0)};
  if (!userRes.okTuples() || PQntuples(userRes.get()) < 1) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "destinatario_no_encontrado"}});
  }
  NotifyRequest nreq;
  nreq.recipientUserId = targetUserId;
  nreq.recipientEmail = PQgetvalue(userRes.get(), 0, 0);
  nreq.recipientPhoneE164 = PQgetvalue(userRes.get(), 0, 1);
  const std::string mobile = PQgetvalue(userRes.get(), 0, 2);
  nreq.recipientMobileE164 = mobile.empty() ? nreq.recipientPhoneE164 : mobile;
  nreq.title = title;
  nreq.body = bodyText;
  nreq.channels = channels;
  nreq.sourceApp = sourceApp;
  nreq.relatedType = relatedType;
  nreq.relatedId = relatedId;

  const auto results = dispatch(AppConfig::instance().gDatabaseUrl, nreq);
  json::array arr;
  for (const auto &r : results)
    arr.push_back(json::object{{"channel", r.channel}, {"ok", r.ok}, {"detail", r.detail}});
  return makeJsonResponse(http::status::ok, json::object{{"status", "dispatched"}, {"results", arr}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ── GET /api/notifications — bandeja propia (canal in_app) ──────────────
http::response<http::string_body>
handleListMyNotifications(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
  PGconn *conn = lease.get();
  const char *p[1] = {session->userId.c_str()};
  storage::PgResult res{PQexecParams(conn,
      "SELECT id::text, type, payload::text, is_read, created_at::text "
      "FROM notifications WHERE user_id = $1::uuid "
      "ORDER BY created_at DESC LIMIT 50",
      1, nullptr, p, nullptr, nullptr, 0)};
  json::array items;
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      json::value payload;
      try {
        payload = json::parse(PQgetvalue(res.get(), i, 2));
      } catch (...) {
        payload = json::object{};
      }
      items.push_back(json::object{
          {"id", PQgetvalue(res.get(), i, 0)},
          {"type", PQgetvalue(res.get(), i, 1)},
          {"payload", payload},
          {"is_read", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
          {"created_at", PQgetvalue(res.get(), i, 4)}});
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"notifications", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"notifications", json::array()}});
#endif
}

// ── POST /api/notifications/{id}/read ────────────────────────────────────
http::response<http::string_body>
handleMarkNotificationRead(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  const std::string pathOnly = routePathOnly(std::string(req.target()));
  static const std::string kPrefix = "/api/notifications/";
  static const std::string kSuffix = "/read";
  if (pathOnly.size() <= kPrefix.size() + kSuffix.size() ||
      pathOnly.compare(pathOnly.size() - kSuffix.size(), kSuffix.size(), kSuffix) != 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string id =
      pathOnly.substr(kPrefix.size(), pathOnly.size() - kPrefix.size() - kSuffix.size());
  if (id.empty())
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_id"}});
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
  PGconn *conn = lease.get();
  // El filtro por user_id (no solo id) es el guardia IDOR: sin él, cualquier
  // sesión podría marcar como leída una notificación ajena adivinando el id.
  const char *p[2] = {id.c_str(), session->userId.c_str()};
  storage::PgResult res{PQexecParams(conn,
      "UPDATE notifications SET is_read = true WHERE id = $1::uuid AND user_id = $2::uuid",
      2, nullptr, p, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  return makeJsonResponse(ok ? http::status::ok : http::status::not_found,
                          json::object{{"status", ok ? "read" : "not_found"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace

void registerRoutes(router::Router &r) {
  r.post("/api/notifications/send", handleSendNotification);
  r.get("/api/notifications", handleListMyNotifications);
  r.post("/api/notifications/", handleMarkNotificationRead);  // prefix match /{id}/read
}

} // namespace notify
