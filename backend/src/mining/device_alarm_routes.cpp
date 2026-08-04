#include "device_alarm_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/jwt.hpp"
#include "../auth/permissions.hpp"
#include "telemetry_ingest.hpp"
#include "alarm_notifier.hpp"

// HAS_LIBPQ no se propaga entre translation units (se define localmente por
// archivo, ver el mismo bloque en auth_storage_pg.hpp). El propio
// `#include <libpq-fe.h>` (bare) ahora resuelve de verdad gracias al
// PQ_INCLUDE_DIR agregado en CMakeLists.txt (antes solo funcionaba en otros
// .cpp por una dependencia frágil del orden de includes — ver ese comentario
// en CMakeLists.txt para el detalle completo de lo que se encontró y corrigió).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <set>
#include <sstream>
#include <thread>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace mining_iot {

namespace {

std::atomic<bool> gEvaluatorRunning{false};
std::atomic<bool> gEvaluatorStopRequested{false};
std::thread gEvaluatorThread;

// json::value_to<std::string>() lanza una excepción no capturada (que tumba
// TODO el proceso backend, no solo la request — confirmado en vivo: un
// `mining_sensor_id` enviado como número JSON, el tipo natural en el que
// cualquier frontend lo mandaría, mataba `beemetry-api` entero con
// "value is not a string") si el campo no es literalmente un string JSON.
// Estos helpers aceptan también número/booleano, que es exactamente lo que
// un cliente real puede enviar sin que sea un error de su parte.
std::string jsonToStringSafe(const json::value &v) {
  if (v.is_string()) return std::string(v.as_string());
  if (v.is_int64()) return std::to_string(v.as_int64());
  if (v.is_uint64()) return std::to_string(v.as_uint64());
  if (v.is_double()) return std::to_string(v.as_double());
  if (v.is_bool()) return v.as_bool() ? "true" : "false";
  return std::string();
}

bool jsonToDoubleSafe(const json::value &v, double &out) {
  if (v.is_double()) { out = v.as_double(); return true; }
  if (v.is_int64()) { out = static_cast<double>(v.as_int64()); return true; }
  if (v.is_uint64()) { out = static_cast<double>(v.as_uint64()); return true; }
  if (v.is_string()) {
    try { out = std::stod(std::string(v.as_string())); return true; }
    catch (...) { return false; }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Device management (ADR-034: identidad/credenciales, sobre la tabla
// `sensors` real de ingesta — no se crea una tercera tabla de sensores).
// ---------------------------------------------------------------------------

http::response<http::string_body>
handleRegisterDevice(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                          "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
#if HAS_LIBPQ
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  const auto &obj = body.as_object();
  if (!obj.if_contains("sensor_code") || !obj.if_contains("sensor_name") ||
      !obj.if_contains("sensor_type")) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "sensor_code, sensor_name, sensor_type son requeridos"}});
  }
  const std::string sensorCode = jsonToStringSafe(obj.at("sensor_code"));
  const std::string sensorName = jsonToStringSafe(obj.at("sensor_name"));
  const std::string sensorType = jsonToStringSafe(obj.at("sensor_type"));
  const std::string unit = obj.if_contains("unit")
                               ? jsonToStringSafe(obj.at("unit"))
                               : std::string();
  const std::string protocol = obj.if_contains("protocol")
                                   ? jsonToStringSafe(obj.at("protocol"))
                                   : std::string("legacy_tls");

  // Credencial: mismo patrón que auth_refresh_tokens (ADR-029) — la key
  // cruda solo se devuelve UNA vez en esta respuesta; solo se persiste su
  // hash SHA-256. Si se pierde, hay que revocar y registrar un dispositivo
  // nuevo (no hay forma de recuperarla, por diseño).
  const std::string rawApiKey = "dev_" + http_utils::secureRandomHex(32);
  const std::string apiKeyHash = auth::jwt::sha256Hex(rawApiKey);

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }

  const char *params[7] = {session->tenantId.c_str(), sensorCode.c_str(),
                           sensorName.c_str(),        sensorType.c_str(),
                           unit.c_str(),               protocol.c_str(),
                           apiKeyHash.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, "
      "unit, protocol, device_api_key_hash, connection_status) "
      "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'unknown') "
      "RETURNING sensor_id",
      7, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    const std::string errMsg = PQresultErrorMessage(res.get());
    const bool duplicate = errMsg.find("sensors_tenant_id_sensor_code_key") != std::string::npos;
    return makeJsonResponse(
        duplicate ? http::status::conflict : http::status::internal_server_error,
        json::object{{"error", duplicate ? "sensor_code_already_exists" : "insert_failed"}});
  }
  const std::string sensorId = PQgetvalue(res.get(), 0, 0);

  // Auditoría (ADR-030): registrar dispositivo es una acción sensible
  // (equivale a emitir una credencial) — misma tabla con hash encadenado.
  const char *auditParams[3] = {session->tenantId.c_str(), sensorId.c_str(),
                                session->username.c_str()};
  storage::PgResult auditRes{PQexecParams(
      conn,
      "SELECT fn_platform_audit_insert($1::uuid, NULL, $3::text, "
      "'device_register', 'sensor', $2::text, NULL, NULL, "
      "jsonb_build_object('sensor_code', $2::text), TRUE, NULL)",
      3, nullptr, auditParams, nullptr, nullptr, 0)};
  (void)auditRes;

  return makeJsonResponse(
      http::status::created,
      json::object{{"sensor_id", sensorId},
                   {"device_api_key", rawApiKey},
                   {"warning", "Guarde esta clave ahora — no se puede recuperar después."}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleListDevices(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    // IDOR: tenant siempre de la sesión, nunca de query param.
    const char *params[1] = {session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT sensor_id, sensor_code, sensor_name, sensor_type, protocol, "
        "COALESCE(connection_status, 'unknown'), last_seen_at, "
        "(revoked_at IS NOT NULL) AS revoked, "
        "(device_api_key_hash IS NOT NULL) AS has_credential "
        "FROM sensors WHERE tenant_id = $1::uuid ORDER BY sensor_code",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        const bool hasLastSeen = !PQgetisnull(res.get(), i, 6);
        json::object o{
            {"sensor_id", PQgetvalue(res.get(), i, 0)},
            {"sensor_code", PQgetvalue(res.get(), i, 1)},
            {"sensor_name", PQgetvalue(res.get(), i, 2)},
            {"sensor_type", PQgetvalue(res.get(), i, 3)},
            {"protocol", PQgetvalue(res.get(), i, 4)},
            {"connection_status", PQgetvalue(res.get(), i, 5)},
            {"last_seen_at", hasLastSeen ? json::value(PQgetvalue(res.get(), i, 6)) : json::value(nullptr)},
            {"revoked", std::string(PQgetvalue(res.get(), i, 7)) == "t"},
            {"has_credential", std::string(PQgetvalue(res.get(), i, 8)) == "t"}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"devices", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"devices", json::array()}});
#endif
}

http::response<http::string_body>
handleRevokeDevice(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                          "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
#if HAS_LIBPQ
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/devices/";
  std::string sensorId;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    if (q != std::string::npos) idStr = idStr.substr(0, q);
    auto slash = idStr.find('/');
    sensorId = slash != std::string::npos ? idStr.substr(0, slash) : idStr;
  }
  if (sensorId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_sensor_id"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  // IDOR: el UPDATE está acotado a tenant_id de la sesión, así que un
  // sensor_id de otro tenant simplemente no matchea ninguna fila (0 rows).
  const char *params[2] = {sensorId.c_str(), session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE sensors SET revoked_at = NOW(), device_api_key_hash = NULL, "
      "connection_status = 'unknown' "
      "WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid",
      2, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "device_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "revoked"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// Ingesta HTTP(S) de telemetría (ADR-034, adaptador push): dispositivos
// domésticos/comerciales y webhooks que no hablan MQTT/Modbus/OPC UA ni el
// gateway TLS. Autenticación por API key de dispositivo (la emitida UNA vez
// por /api/mining/devices/register) — NO por sesión de usuario: quien llama
// es una máquina. La key identifica al sensor, así que el body solo trae el
// valor (el dispositivo no puede escribir telemetría de otros sensores).
// ---------------------------------------------------------------------------

http::response<http::string_body>
handleHttpTelemetry(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  const auto keyIt = req.find("X-Device-Key");
  if (keyIt == req.end() || keyIt->value().empty()) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "missing_device_key"}});
  }
  const std::string keyHash =
      auth::jwt::sha256Hex(std::string(keyIt->value()));

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *params[1] = {keyHash.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT sensor_code FROM sensors "
      "WHERE device_api_key_hash = $1 AND revoked_at IS NULL AND is_active "
      "LIMIT 1",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "invalid_device_key"}});
  }
  const std::string sensorCode = PQgetvalue(res.get(), 0, 0);

  double value = 0.0;
  int quality = 0;
  try {
    const auto body = json::parse(req.body());
    const auto &o = body.as_object();
    const auto *v = o.if_contains("value");
    if (!v || !jsonToDoubleSafe(*v, value)) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "value_required"}});
    }
    if (const auto *q = o.if_contains("quality")) {
      double qd = 0;
      if (jsonToDoubleSafe(*q, qd)) quality = static_cast<int>(qd);
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }

  auto &ingestor = mining::TelemetryIngestor::instance();
  if (!ingestor.running()) {
    return makeJsonResponse(http::status::service_unavailable,
                            json::object{{"error", "ingest_disabled"}});
  }
  std::ostringstream line;
  line << sensorCode << ',' << value;
  if (quality != 0) line << ',' << quality;
  if (!ingestor.ingestLine(line.str())) {
    return makeJsonResponse(http::status::service_unavailable,
                            json::object{{"error", "ingest_queue_full"}});
  }

  // Presencia del dispositivo (mejor esfuerzo — la lectura ya quedó encolada).
  const char *seenParams[1] = {keyHash.c_str()};
  storage::PgResult seen{PQexecParams(
      conn,
      "UPDATE sensors SET last_seen_at = NOW(), connection_status = 'online' "
      "WHERE device_api_key_hash = $1",
      1, nullptr, seenParams, nullptr, nullptr, 0)};
  (void)seen;

  return makeJsonResponse(http::status::accepted,
                          json::object{{"status", "accepted"},
                                       {"sensor_code", sensorCode}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// Motor de alarmas: reglas (CRUD) + eventos (lectura/ack).
// ---------------------------------------------------------------------------

http::response<http::string_body>
handleCreateAlarmRule(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                          "alarmas.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "alarmas.manage"}});
  }
#if HAS_LIBPQ
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  const auto &obj = body.as_object();
  static const std::set<std::string> kOps = {"gt", "gte", "lt", "lte", "eq"};
  if (!obj.if_contains("rule_name") || !obj.if_contains("operator") ||
      !obj.if_contains("threshold") ||
      (!obj.if_contains("sensor_id") && !obj.if_contains("mining_sensor_id"))) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "rule_name, operator, threshold y (sensor_id o mining_sensor_id) son requeridos"}});
  }
  const std::string ruleName = jsonToStringSafe(obj.at("rule_name"));
  const std::string op = jsonToStringSafe(obj.at("operator"));
  if (kOps.find(op) == kOps.end()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "operator_invalido"}});
  }
  double threshold = 0.0;
  if (!jsonToDoubleSafe(obj.at("threshold"), threshold)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "threshold_invalido"}});
  }
  const std::string severity = obj.if_contains("severity")
                                   ? jsonToStringSafe(obj.at("severity"))
                                   : std::string("warning");
  const bool hasSensorId = obj.if_contains("sensor_id");
  const std::string sensorId = hasSensorId ? jsonToStringSafe(obj.at("sensor_id")) : std::string();
  const std::string miningSensorId = obj.if_contains("mining_sensor_id")
                                         ? jsonToStringSafe(obj.at("mining_sensor_id"))
                                         : std::string();

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  std::ostringstream thresholdStr;
  thresholdStr << threshold;
  const std::string thresholdString = thresholdStr.str();
  const char *params[7] = {
      session->tenantId.c_str(),
      hasSensorId ? sensorId.c_str() : nullptr,
      hasSensorId ? nullptr : miningSensorId.c_str(),
      ruleName.c_str(), op.c_str(), thresholdString.c_str(), severity.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO platform_alarm_rules "
      "(tenant_id, sensor_id, mining_sensor_id, rule_name, operator, threshold, severity) "
      "VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6::double precision, $7) "
      "RETURNING id",
      7, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "insert_failed"}});
  }
  return makeJsonResponse(http::status::created,
                          json::object{{"id", PQgetvalue(res.get(), 0, 0)}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleListAlarmRules(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const char *params[1] = {session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT id, sensor_id, mining_sensor_id, rule_name, operator, "
        "threshold, severity, enabled FROM platform_alarm_rules "
        "WHERE tenant_id = $1::uuid ORDER BY id DESC",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        json::object o{
            {"id", PQgetvalue(res.get(), i, 0)},
            {"sensor_id", PQgetisnull(res.get(), i, 1) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 1))},
            {"mining_sensor_id", PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 2))},
            {"rule_name", PQgetvalue(res.get(), i, 3)},
            {"operator", PQgetvalue(res.get(), i, 4)},
            {"threshold", std::atof(PQgetvalue(res.get(), i, 5))},
            {"severity", PQgetvalue(res.get(), i, 6)},
            {"enabled", std::string(PQgetvalue(res.get(), i, 7)) == "t"}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"rules", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"rules", json::array()}});
#endif
}

http::response<http::string_body>
handleDeleteAlarmRule(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                          "alarmas.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "alarmas.manage"}});
  }
#if HAS_LIBPQ
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/alarms/rules/";
  std::string ruleId;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    ruleId = q != std::string::npos ? idStr.substr(0, q) : idStr;
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *params[2] = {ruleId.c_str(), session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "DELETE FROM platform_alarm_rules WHERE id = $1::bigint AND tenant_id = $2::uuid",
      2, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "rule_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleListAlarms(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const bool onlyOpen = query.count("open") && query.at("open") == "true";
    const char *params[1] = {session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        onlyOpen
            ? "SELECT a.id, a.rule_id, r.rule_name, a.triggered_at, "
              "a.observed_value, a.severity, a.message, a.acknowledged, a.resolved_at "
              "FROM platform_alarms a JOIN platform_alarm_rules r ON r.id = a.rule_id "
              "WHERE a.tenant_id = $1::uuid AND a.resolved_at IS NULL "
              "ORDER BY a.triggered_at DESC LIMIT 200"
            : "SELECT a.id, a.rule_id, r.rule_name, a.triggered_at, "
              "a.observed_value, a.severity, a.message, a.acknowledged, a.resolved_at "
              "FROM platform_alarms a JOIN platform_alarm_rules r ON r.id = a.rule_id "
              "WHERE a.tenant_id = $1::uuid "
              "ORDER BY a.triggered_at DESC LIMIT 200",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        json::object o{
            {"id", PQgetvalue(res.get(), i, 0)},
            {"rule_id", PQgetvalue(res.get(), i, 1)},
            {"rule_name", PQgetvalue(res.get(), i, 2)},
            {"triggered_at", PQgetvalue(res.get(), i, 3)},
            {"observed_value", std::atof(PQgetvalue(res.get(), i, 4))},
            {"severity", PQgetvalue(res.get(), i, 5)},
            {"message", PQgetvalue(res.get(), i, 6)},
            {"acknowledged", std::string(PQgetvalue(res.get(), i, 7)) == "t"},
            {"resolved", !PQgetisnull(res.get(), i, 8)}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"alarms", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"alarms", json::array()}});
#endif
}

http::response<http::string_body>
handleAcknowledgeAlarm(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/alarms/";
  std::string alarmId;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto slash = idStr.find('/');
    alarmId = slash != std::string::npos ? idStr.substr(0, slash) : idStr;
    auto q = alarmId.find('?');
    if (q != std::string::npos) alarmId = alarmId.substr(0, q);
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *params[3] = {alarmId.c_str(), session->tenantId.c_str(), session->userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE platform_alarms SET acknowledged = TRUE, "
      "acknowledged_by = $3::uuid, acknowledged_at = NOW() "
      "WHERE id = $1::bigint AND tenant_id = $2::uuid",
      3, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "alarm_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "acknowledged"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// Evaluador de reglas (hilo de fondo). Semántica: near-real-time por
// polling (no un trigger síncrono en el hot path de ingesta, ver
// razonamiento en ADR-034 — evita meter lógica de reglas en
// telemetry_ingest.cpp::copyBatch(), que debe seguir optimizado para
// 10K/seg). Cada ciclo: evalúa reglas contra el valor cacheado más
// reciente del sensor; abre una alarma si no hay una ya abierta para esa
// regla (índice único parcial en la tabla evita duplicados); resuelve
// (resolved_at) la alarma abierta si la condición deja de cumplirse.
// ---------------------------------------------------------------------------
#if HAS_LIBPQ
void evaluateRulesOnce(PGconn *conn) {
  storage::PgResult rules{PQexec(
      conn,
      "SELECT id, tenant_id, sensor_id, mining_sensor_id, operator, "
      "threshold, severity, rule_name FROM platform_alarm_rules WHERE enabled = TRUE")};
  if (!rules.okTuples()) return;

  for (int i = 0; i < PQntuples(rules.get()); ++i) {
    const std::string ruleId = PQgetvalue(rules.get(), i, 0);
    const std::string tenantId = PQgetvalue(rules.get(), i, 1);
    const bool hasSensorId = !PQgetisnull(rules.get(), i, 2);
    const std::string sensorId = hasSensorId ? PQgetvalue(rules.get(), i, 2) : "";
    const std::string miningSensorId = hasSensorId ? "" : PQgetvalue(rules.get(), i, 3);
    const std::string op = PQgetvalue(rules.get(), i, 4);
    const double threshold = std::atof(PQgetvalue(rules.get(), i, 5));
    const std::string severity = PQgetvalue(rules.get(), i, 6);
    const std::string ruleName = PQgetvalue(rules.get(), i, 7);

    bool hasValue = false;
    double currentValue = 0.0;
    if (hasSensorId) {
      const char *p[1] = {sensorId.c_str()};
      storage::PgResult vres{PQexecParams(
          conn,
          "SELECT value_numeric FROM telemetry_raw WHERE sensor_id = $1::uuid "
          "AND value_numeric IS NOT NULL ORDER BY captured_at DESC LIMIT 1",
          1, nullptr, p, nullptr, nullptr, 0)};
      if (vres.okTuples() && PQntuples(vres.get()) > 0) {
        currentValue = std::atof(PQgetvalue(vres.get(), 0, 0));
        hasValue = true;
      }
    } else {
      const char *p[1] = {miningSensorId.c_str()};
      storage::PgResult vres{PQexecParams(
          conn,
          "SELECT current_value FROM mining_sensors WHERE id = $1::int "
          "AND current_value IS NOT NULL",
          1, nullptr, p, nullptr, nullptr, 0)};
      if (vres.okTuples() && PQntuples(vres.get()) > 0) {
        currentValue = std::atof(PQgetvalue(vres.get(), 0, 0));
        hasValue = true;
      }
    }
    if (!hasValue) continue;

    bool triggered = false;
    if (op == "gt") triggered = currentValue > threshold;
    else if (op == "gte") triggered = currentValue >= threshold;
    else if (op == "lt") triggered = currentValue < threshold;
    else if (op == "lte") triggered = currentValue <= threshold;
    else if (op == "eq") triggered = currentValue == threshold;

    if (triggered) {
      std::ostringstream msg;
      msg << ruleName << ": valor " << currentValue << " " << op << " " << threshold;
      const std::string msgStr = msg.str();
      std::ostringstream valStr;
      valStr << currentValue;
      const std::string valString = valStr.str();
      const char *p[5] = {ruleId.c_str(), tenantId.c_str(), valString.c_str(),
                          severity.c_str(), msgStr.c_str()};
      // ON CONFLICT DO NOTHING via el índice único parcial (idx_alarms_one_open_per_rule):
      // si ya hay una alarma abierta para esta regla, no se duplica.
      storage::PgResult ins{PQexecParams(
          conn,
          "INSERT INTO platform_alarms (rule_id, tenant_id, observed_value, severity, message) "
          "VALUES ($1::bigint, $2::uuid, $3::double precision, $4, $5) "
          "ON CONFLICT (rule_id) WHERE resolved_at IS NULL DO NOTHING "
          "RETURNING id",
          5, nullptr, p, nullptr, nullptr, 0)};
      if (!ins.okTuples()) {
        std::cerr << "[ALARM-ENGINE] insert de alarma falló: " << PQresultErrorMessage(ins.get()) << "\n";
      } else if (PQntuples(ins.get()) > 0) {
        const std::string alarmId = PQgetvalue(ins.get(), 0, 0);
        const char *auditParams[3] = {tenantId.c_str(), alarmId.c_str(), msgStr.c_str()};
        storage::PgResult auditRes{PQexecParams(
            conn,
            "SELECT fn_platform_audit_insert($1::uuid, NULL, 'alarm_engine', "
            "'alarm_triggered', 'alarm', $2::text, NULL, NULL, "
            "jsonb_build_object('message', $3::text), TRUE, NULL)",
            3, nullptr, auditParams, nullptr, nullptr, 0)};
        if (!auditRes.okTuples()) {
          std::cerr << "[ALARM-ENGINE] audit insert falló: " << PQresultErrorMessage(auditRes.get()) << "\n";
        } else {
          std::cout << "[ALARM-ENGINE] alarma " << alarmId << " creada + auditada\n";
        }
        // Notificación multi-canal en tiempo real (WS + email + webhook),
        // en hilo desprendido para no bloquear el ciclo del evaluador.
        mining_iot::notifyAlarmEvent(tenantId, alarmId, "triggered", severity,
                                     msgStr, currentValue);
      }
    } else {
      // Auto-resolución: si la condición ya no se cumple, cerrar cualquier
      // alarma abierta de esta regla. RETURNING para notificar el "resolved".
      const char *p[1] = {ruleId.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "UPDATE platform_alarms SET resolved_at = NOW() "
          "WHERE rule_id = $1::bigint AND resolved_at IS NULL "
          "RETURNING id, tenant_id, severity, message",
          1, nullptr, p, nullptr, nullptr, 0)};
      if (res.okTuples())
        for (int k = 0; k < PQntuples(res.get()); ++k) {
          mining_iot::notifyAlarmEvent(
              PQgetvalue(res.get(), k, 1), PQgetvalue(res.get(), k, 0),
              "resolved", PQgetvalue(res.get(), k, 2),
              PQgetvalue(res.get(), k, 3), currentValue);
        }
    }
  }
}

void evaluatorLoop() {
  auto &cfg = AppConfig::instance();
  int intervalMs = 10000;
  if (const char *e = std::getenv("BEEMETRY_ALARM_EVAL_INTERVAL_MS")) {
    try { intervalMs = std::max(2000, std::stoi(e)); } catch (...) {}
  }
  PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    std::cerr << "[ALARM-ENGINE] No se pudo conectar a Postgres, evaluador no arranca\n";
    PQfinish(conn);
    gEvaluatorRunning.store(false);
    return;
  }
  std::cout << "[ALARM-ENGINE] Evaluador iniciado, intervalo=" << intervalMs << "ms\n";
  while (!gEvaluatorStopRequested.load()) {
    if (PQstatus(conn) != CONNECTION_OK) {
      PQfinish(conn);
      conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
    }
    if (PQstatus(conn) == CONNECTION_OK) {
      try { evaluateRulesOnce(conn); }
      catch (const std::exception &e) {
        std::cerr << "[ALARM-ENGINE] Error en ciclo de evaluación: " << e.what() << "\n";
      }
    }
    for (int waited = 0; waited < intervalMs && !gEvaluatorStopRequested.load(); waited += 200) {
      std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
  }
  PQfinish(conn);
  gEvaluatorRunning.store(false);
  std::cout << "[ALARM-ENGINE] Evaluador detenido\n";
}
#endif

} // namespace

void startAlarmEvaluator() {
#if HAS_LIBPQ
  bool expected = false;
  if (!gEvaluatorRunning.compare_exchange_strong(expected, true)) return;
  gEvaluatorStopRequested.store(false);
  gEvaluatorThread = std::thread(evaluatorLoop);
  gEvaluatorThread.detach();
#endif
}

void stopAlarmEvaluator() {
  gEvaluatorStopRequested.store(true);
}

void registerRoutes(router::Router &r) {
  r.post("/api/mining/devices/register", handleRegisterDevice);
  r.get("/api/mining/devices", handleListDevices);
  r.post("/api/mining/devices/", handleRevokeDevice);
  r.post("/api/mining/telemetry", handleHttpTelemetry);

  r.post("/api/mining/alarms/rules", handleCreateAlarmRule);
  r.get("/api/mining/alarms/rules", handleListAlarmRules);
  r.del("/api/mining/alarms/rules/", handleDeleteAlarmRule);

  r.get("/api/mining/alarms", handleListAlarms);
  r.post("/api/mining/alarms/", handleAcknowledgeAlarm);
}

} // namespace mining_iot
