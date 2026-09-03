#include "device_alarm_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/jwt.hpp"
#include "../auth/permissions.hpp"
#include "telemetry_ingest.hpp"
#include "alarm_notifier.hpp"
#include "alarm_rule_evaluator.hpp"

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

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <vector>

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

// Forward declaration -- definida junto al resto de la infraestructura del
// cache de reglas (SPEC-016 T3/T12), más abajo en este archivo, pero los
// handlers CRUD de reglas (arriba en el orden del archivo) necesitan
// invalidarlo al escribir.
void invalidateRuleCache();

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
  // SPEC-016 T1/T4/T5 (db_scripts/89): condition_type 'value' (default,
  // comportamiento original) o 'rate' (compara la tasa de cambio, no el
  // valor absoluto); debounce_secs opcional, 0 = desactivado.
  const std::string conditionType = obj.if_contains("condition_type")
                                        ? jsonToStringSafe(obj.at("condition_type"))
                                        : std::string("value");
  if (conditionType != "value" && conditionType != "rate") {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "condition_type_invalido"}});
  }
  int debounceSecs = 0;
  if (obj.if_contains("debounce_secs")) {
    double d = 0;
    if (!jsonToDoubleSafe(obj.at("debounce_secs"), d) || d < 0) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "debounce_secs_invalido"}});
    }
    debounceSecs = static_cast<int>(d);
  }

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
  const std::string debounceString = std::to_string(debounceSecs);
  const char *params[9] = {
      session->tenantId.c_str(),
      hasSensorId ? sensorId.c_str() : nullptr,
      hasSensorId ? nullptr : miningSensorId.c_str(),
      ruleName.c_str(), op.c_str(), thresholdString.c_str(), severity.c_str(),
      conditionType.c_str(), debounceString.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO platform_alarm_rules "
      "(tenant_id, sensor_id, mining_sensor_id, rule_name, operator, threshold, severity, "
      "condition_type, debounce_secs) "
      "VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6::double precision, $7, $8, $9::int) "
      "RETURNING id",
      9, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "insert_failed"}});
  }
  invalidateRuleCache(); // T12: la próxima corrida del evaluador ve la regla nueva sin esperar el TTL
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
        "threshold, severity, enabled, condition_type, debounce_secs "
        "FROM platform_alarm_rules "
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
            {"enabled", std::string(PQgetvalue(res.get(), i, 7)) == "t"},
            {"condition_type", PQgetvalue(res.get(), i, 8)},
            {"debounce_secs", std::atoi(PQgetvalue(res.get(), i, 9))}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"rules", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"rules", json::array()}});
#endif
}

// SPEC-016 T9: reemplazo completo de la regla (PUT, no PATCH parcial —
// mismo criterio simple que el resto de este archivo, sin merge parcial de
// campos). `enabled` es el único campo antes solo alcanzable borrando y
// recreando la regla; ahora se puede pausar/reactivar sin perder su
// historial de alarmas (`platform_alarms.rule_id` sigue apuntando a la
// misma fila).
http::response<http::string_body>
handleUpdateAlarmRule(const http::request<http::string_body> &req,
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
  if (ruleId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_rule_id"}});
  }
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
      !obj.if_contains("threshold")) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "rule_name, operator y threshold son requeridos"}});
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
  bool enabled = true;
  if (obj.if_contains("enabled")) {
    if (!obj.at("enabled").is_bool()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "enabled_invalido"}});
    }
    enabled = obj.at("enabled").as_bool();
  }
  const std::string conditionType = obj.if_contains("condition_type")
                                        ? jsonToStringSafe(obj.at("condition_type"))
                                        : std::string("value");
  if (conditionType != "value" && conditionType != "rate") {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "condition_type_invalido"}});
  }
  int debounceSecs = 0;
  if (obj.if_contains("debounce_secs")) {
    double d = 0;
    if (!jsonToDoubleSafe(obj.at("debounce_secs"), d) || d < 0) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "debounce_secs_invalido"}});
    }
    debounceSecs = static_cast<int>(d);
  }

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
  const std::string debounceString = std::to_string(debounceSecs);
  const std::string enabledString = enabled ? "true" : "false";
  const char *params[9] = {
      ruleId.c_str(), session->tenantId.c_str(), ruleName.c_str(), op.c_str(),
      thresholdString.c_str(), severity.c_str(), conditionType.c_str(),
      debounceString.c_str(), enabledString.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE platform_alarm_rules SET rule_name = $3, operator = $4, "
      "threshold = $5::double precision, severity = $6, condition_type = $7, "
      "debounce_secs = $8::int, enabled = $9::boolean "
      "WHERE id = $1::bigint AND tenant_id = $2::uuid",
      9, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "rule_not_found"}});
  }
  invalidateRuleCache(); // T12
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
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
  invalidateRuleCache(); // T12
  return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// SPEC-016 T10: paginación real (antes `LIMIT 200` fijo, sin offset ni
// forma de saber si había más) + filtro por severidad. `open`/`sensor_id`/
// `mining_sensor_id` siguen sin filtro dedicado (fuera de alcance de este
// cierre puntual) -- severidad era el filtro que la Capa 5 de QA (T19/T20)
// necesitaba para poder pedir "solo criticas" sin traer las 200 más
// recientes de cualquier severidad.
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
  long long total = 0;
  if (PQstatus(conn) == CONNECTION_OK) {
    const bool onlyOpen = query.count("open") && query.at("open") == "true";
    static const std::set<std::string> kSeverities = {"info", "warning", "critical"};
    const bool hasSeverity =
        query.count("severity") && kSeverities.count(query.at("severity")) > 0;

    int limit = 50;
    if (query.count("limit")) {
      try { limit = std::stoi(query.at("limit")); } catch (...) {}
    }
    limit = std::max(1, std::min(limit, 500));
    int offset = 0;
    if (query.count("offset")) {
      try { offset = std::stoi(query.at("offset")); } catch (...) {}
    }
    offset = std::max(0, offset);
    const std::string limitStr = std::to_string(limit);
    const std::string offsetStr = std::to_string(offset);

    std::string whereClause = "a.tenant_id = $1::uuid";
    if (onlyOpen) whereClause += " AND a.resolved_at IS NULL";
    if (hasSeverity) whereClause += " AND a.severity = $2";

    std::vector<const char *> params;
    params.push_back(session->tenantId.c_str());
    if (hasSeverity) params.push_back(query.at("severity").c_str());
    const int filterParamCount = static_cast<int>(params.size());
    params.push_back(limitStr.c_str());
    params.push_back(offsetStr.c_str());

    const std::string listSql =
        "SELECT a.id, a.rule_id, r.rule_name, a.triggered_at, "
        "a.observed_value, a.severity, a.message, a.acknowledged, a.resolved_at "
        "FROM platform_alarms a JOIN platform_alarm_rules r ON r.id = a.rule_id "
        "WHERE " + whereClause +
        " ORDER BY a.triggered_at DESC LIMIT $" + std::to_string(filterParamCount + 1) +
        " OFFSET $" + std::to_string(filterParamCount + 2);
    storage::PgResult res{PQexecParams(
        conn, listSql.c_str(), static_cast<int>(params.size()), nullptr,
        params.data(), nullptr, nullptr, 0)};
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

    // Total con el mismo filtro (sin LIMIT/OFFSET) -- para que el cliente
    // sepa si hay más páginas sin tener que sumar de a 500.
    std::vector<const char *> countParams(params.begin(),
                                          params.begin() + filterParamCount);
    const std::string countSql =
        "SELECT COUNT(*) FROM platform_alarms a WHERE " + whereClause;
    storage::PgResult countRes{PQexecParams(
        conn, countSql.c_str(), filterParamCount, nullptr, countParams.data(),
        nullptr, nullptr, 0)};
    if (countRes.okTuples() && PQntuples(countRes.get()) > 0) {
      total = std::atoll(PQgetvalue(countRes.get(), 0, 0));
    }

    return makeJsonResponse(
        http::status::ok,
        json::object{{"alarms", items},
                     {"total", total},
                     {"limit", limit},
                     {"offset", offset}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{{"alarms", items}, {"total", 0}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"alarms", json::array()}, {"total", 0}});
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
// Cache de reglas (SPEC-016 T3) + estado en memoria por regla (T4 rate_of_
// change, T5 debounce). Un solo hilo (evaluatorLoop) es el único lector real
// de estas estructuras en el ciclo de evaluación; el mutex protege contra la
// escritura concurrente de gRuleCacheDirty desde los handlers HTTP
// (create/update/delete, hilos del pool del servidor) que invalidan el
// cache al escribir (T12). No es una cache "LRU" clásica en el sentido
// estricto (no hay entradas individuales que desalojar por uso): es TTL de
// 60s sobre el único conjunto cacheable (todas las reglas habilitadas), que
// es lo que el ciclo del evaluador necesita — ver ADR-016-1..5 para la nota
// de por qué el nombre del ticket original ("LRU") no aplica literalmente.
// ---------------------------------------------------------------------------
struct AlarmRuleRow {
  std::string id;
  std::string tenantId;
  bool hasSensorId{false};
  std::string sensorId;
  std::string miningSensorId;
  std::string op;
  double threshold{0.0};
  std::string severity;
  std::string ruleName;
  std::string conditionType; // 'value' | 'rate' (db_scripts/89)
  int debounceSecs{0};
};

struct RuleRuntimeState {
  bool hasLastValue{false};
  double lastValue{0.0};
  std::chrono::steady_clock::time_point lastValueAt;
  std::optional<std::chrono::steady_clock::time_point> lastTriggeredAt;
};

std::mutex gRuleCacheMutex;
std::vector<AlarmRuleRow> gRuleCache;
// Índice sensor_id (uuid texto) -> reglas de esa regla con `sensor_id` real
// (NO `mining_sensor_id`) -- alimenta el camino en tiempo real (ver más
// abajo, `handleRealtimeTelemetryBatch`). Reconstruido junto con
// `gRuleCache` en cada refresh, mismo mutex.
std::unordered_map<std::string, std::vector<AlarmRuleRow>> gSensorIdToRules;
std::chrono::steady_clock::time_point gRuleCacheFetchedAt;
bool gRuleCacheHasFetched = false;
std::atomic<bool> gRuleCacheDirty{true};
constexpr int kRuleCacheTtlSeconds = 60;

std::mutex gRuleRuntimeMutex;
std::unordered_map<std::string, RuleRuntimeState> gRuleRuntimeState;

/** @brief Marca el cache de reglas como obsoleto -- llamar desde cualquier
 * handler que cree/edite/borre una regla (T12). El próximo ciclo del
 * evaluador vuelve a consultar `platform_alarm_rules` sin esperar el TTL. */
void invalidateRuleCache() { gRuleCacheDirty.store(true); }

#if HAS_LIBPQ
/** @brief `true` si el cache sigue vigente (sin invalidar, dentro del TTL) --
 * sin efectos secundarios, no toca Postgres. Usado por el camino en tiempo
 * real para decidir SIN abrir conexión si hace falta refrescar antes de
 * mirar el índice por sensor (ver `handleRealtimeTelemetryBatch`). */
bool ruleCacheIsFresh() {
  const auto now = std::chrono::steady_clock::now();
  std::lock_guard<std::mutex> lk(gRuleCacheMutex);
  return gRuleCacheHasFetched &&
      (now - gRuleCacheFetchedAt) < std::chrono::seconds(kRuleCacheTtlSeconds) &&
      !gRuleCacheDirty.load();
}

/** @brief Devuelve las reglas habilitadas, sirviendo del cache (T3) si sigue
 * vigente (sin invalidar y dentro de `kRuleCacheTtlSeconds`) o refrescando
 * desde Postgres si no. */
std::vector<AlarmRuleRow> getCachedEnabledRules(PGconn *conn) {
  const auto now = std::chrono::steady_clock::now();
  if (ruleCacheIsFresh()) {
    std::lock_guard<std::mutex> lk(gRuleCacheMutex);
    return gRuleCache; // copia -- barata (reglas son pocas por diseño, no telemetría)
  }

  storage::PgResult rules{PQexec(
      conn,
      "SELECT id, tenant_id, sensor_id, mining_sensor_id, operator, "
      "threshold, severity, rule_name, condition_type, debounce_secs "
      "FROM platform_alarm_rules WHERE enabled = TRUE")};
  std::vector<AlarmRuleRow> fresh;
  if (rules.okTuples()) {
    fresh.reserve(PQntuples(rules.get()));
    for (int i = 0; i < PQntuples(rules.get()); ++i) {
      AlarmRuleRow row;
      row.id = PQgetvalue(rules.get(), i, 0);
      row.tenantId = PQgetvalue(rules.get(), i, 1);
      row.hasSensorId = !PQgetisnull(rules.get(), i, 2);
      row.sensorId = row.hasSensorId ? PQgetvalue(rules.get(), i, 2) : "";
      row.miningSensorId = row.hasSensorId ? "" : PQgetvalue(rules.get(), i, 3);
      row.op = PQgetvalue(rules.get(), i, 4);
      row.threshold = std::atof(PQgetvalue(rules.get(), i, 5));
      row.severity = PQgetvalue(rules.get(), i, 6);
      row.ruleName = PQgetvalue(rules.get(), i, 7);
      row.conditionType = PQgetvalue(rules.get(), i, 8);
      row.debounceSecs = std::atoi(PQgetvalue(rules.get(), i, 9));
      fresh.push_back(std::move(row));
    }
  }

  std::unordered_map<std::string, std::vector<AlarmRuleRow>> freshIndex;
  for (const auto &r : fresh) {
    if (r.hasSensorId) freshIndex[r.sensorId].push_back(r);
  }

  std::lock_guard<std::mutex> lk(gRuleCacheMutex);
  gRuleCache = fresh;
  gSensorIdToRules = std::move(freshIndex);
  gRuleCacheFetchedAt = now;
  gRuleCacheHasFetched = true;
  gRuleCacheDirty.store(false);
  return gRuleCache;
}

/** @brief Reglas con `sensor_id` real que aplican a un sensor puntual, del
 * mismo cache que `getCachedEnabledRules()` (mismo TTL/invalidación) --
 * usado por el camino en tiempo real, que no puede darse el lujo de una
 * query a Postgres por cada fila de cada lote de ingesta. Si el cache nunca
 * se pobló todavía (arranque en frío antes del primer ciclo del evaluador
 * periódico), devuelve vacío -- el evaluador periódico lo cubre en su
 * siguiente ciclo igual, esto es solo una mejora de latencia, no la única
 * vía de disparo. */
std::vector<AlarmRuleRow> getCachedRulesForSensor(const std::string &sensorId) {
  std::lock_guard<std::mutex> lk(gRuleCacheMutex);
  auto it = gSensorIdToRules.find(sensorId);
  return it != gSensorIdToRules.end() ? it->second : std::vector<AlarmRuleRow>{};
}
#endif

// ---------------------------------------------------------------------------
// Evaluación de una regla contra un valor ya conocido. Compartida por DOS
// caminos (ADR-140, actualización 2026-09-02 -- evaluación en tiempo real):
//   1. `evaluateRulesOnce()` (hilo de fondo, polling periódico) -- sigue
//      existiendo como red de seguridad y como ÚNICA vía para reglas de
//      `mining_sensor_id` (dashboard de simulación, sin telemetría real de
//      ingesta detrás).
//   2. `handleRealtimeTelemetryBatch()` (más abajo) -- se dispara desde
//      `TelemetryIngestor::copyBatch()` apenas un lote de telemetría REAL
//      queda COMMIT-eado, con el valor ya en memoria (sin volver a leer la
//      BD). Esta es la vía que baja la latencia de "lectura cruza umbral"
//      de ~10s (intervalo de polling) a milisegundos para reglas de
//      `sensor_id` real -- decisión explícita del developer del 2026-09-02
//      de priorizar latencia real sobre la simplicidad de un solo camino de
//      evaluación (que es lo que ADR-034 había elegido originalmente, ver
//      su propia actualización). El costo por lote es marginal: una consulta
//      hash por sensor del lote contra el índice de reglas en memoria
//      (`getCachedRulesForSensor`), sin tocar Postgres salvo que una regla
//      realmente dispare -- eso sigue siendo el caso raro, no el común.
// ---------------------------------------------------------------------------
#if HAS_LIBPQ
void evaluateRuleAgainstValue(PGconn *conn, const AlarmRuleRow &rule,
                              double currentValue,
                              std::chrono::steady_clock::time_point evalNow) {
    const std::string &ruleId = rule.id;
    const std::string &tenantId = rule.tenantId;
    const std::string &op = rule.op;
    const double threshold = rule.threshold;
    const std::string &severity = rule.severity;
    const std::string &ruleName = rule.ruleName;

    // T4: condición por valor (comportamiento original) o por tasa de
    // cambio (rate_of_change) -- ver alarm_rule_evaluator.hpp. El estado
    // por regla (último valor + timestamp, último disparo) vive en memoria
    // de proceso, separado del cache de reglas de arriba (T3). Compartido
    // entre los dos caminos de disparo (protegido por `gRuleRuntimeMutex`,
    // ya no "un solo hilo escritor" desde que el camino en tiempo real
    // también puede escribir aquí concurrentemente con el polling).
    double comparisonValue = currentValue;
    bool canEvaluate = true;
    bool debounced = false;
    {
      std::lock_guard<std::mutex> lk(gRuleRuntimeMutex);
      auto &state = gRuleRuntimeState[ruleId];
      if (rule.conditionType == "rate") {
        if (!state.hasLastValue) {
          // Primera lectura de esta regla en este proceso: no hay ventana
          // todavía para calcular una tasa real -- se guarda como base y se
          // difiere la evaluación al siguiente ciclo (evita un falso disparo
          // "0 unidades/min" o un valor inventado en el primer ciclo).
          canEvaluate = false;
        } else {
          const double deltaSeconds = std::chrono::duration<double>(
                                           evalNow - state.lastValueAt)
                                           .count();
          comparisonValue = computeRatePerMinute(state.lastValue, currentValue, deltaSeconds);
        }
        state.hasLastValue = true;
        state.lastValue = currentValue;
        state.lastValueAt = evalNow;
      }
      if (canEvaluate && evaluateThresholdCondition(op, comparisonValue, threshold)) {
        debounced = isWithinDebounceWindow(state.lastTriggeredAt, rule.debounceSecs, evalNow);
        // lastTriggeredAt se actualiza recién si el INSERT de abajo
        // realmente crea una fila nueva -- no acá, para no arrancar la
        // ventana de debounce por un ciclo que ni siquiera insertó nada
        // (p.ej. porque ya había una alarma abierta para esta regla).
      } else {
        canEvaluate = false; // reusa la bandera para saltar el bloque `triggered` de abajo
      }
    }

    const bool triggered = canEvaluate;

    if (triggered) {
      if (debounced) return; // T5: dentro de la ventana -- ni insert ni notify.

      std::ostringstream msg;
      msg << ruleName << ": valor " << currentValue;
      if (rule.conditionType == "rate") msg << " (tasa " << comparisonValue << "/min)";
      msg << " " << op << " " << threshold;
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
        {
          std::lock_guard<std::mutex> lk(gRuleRuntimeMutex);
          gRuleRuntimeState[ruleId].lastTriggeredAt = evalNow;
        }
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

/** @brief Camino de polling (red de seguridad + única vía para reglas de
 * `mining_sensor_id`, ver comentario de arriba). Sigue leyendo el valor
 * actual de Postgres por cada regla -- eso ya era así antes de esta
 * actualización, no es nuevo; lo nuevo es que ya no es la ÚNICA vía para
 * reglas de `sensor_id`. */
void evaluateRulesOnce(PGconn *conn) {
  const std::vector<AlarmRuleRow> rules = getCachedEnabledRules(conn);
  const auto evalNow = std::chrono::steady_clock::now();

  for (const auto &rule : rules) {
    const bool hasSensorId = rule.hasSensorId;
    const std::string &sensorId = rule.sensorId;
    const std::string &miningSensorId = rule.miningSensorId;

    bool hasValue = false;
    double currentValue = 0.0;
    if (hasSensorId) {
      const char *p[1] = {sensorId.c_str()};
      // ADR-131: último valor vía telemetry_fact (dim_sensor resuelve el
      // UUID a sensor_id_sk) -- solo esta lectura puntual, platform_alarm_
      // rules/platform_alarms y su CHECK XOR sensor_id/mining_sensor_id
      // quedan sin tocar (fuera de alcance deliberado, ver ADR-131).
      storage::PgResult vres{PQexecParams(
          conn,
          "SELECT tf.value_numeric FROM telemetry_fact tf "
          "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
          "WHERE ds.sensor_id = $1::uuid AND tf.channel_id = 0 "
          "AND tf.value_numeric IS NOT NULL ORDER BY tf.captured_at DESC LIMIT 1",
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

    evaluateRuleAgainstValue(conn, rule, currentValue, evalNow);
  }
}

// ---------------------------------------------------------------------------
// Camino en tiempo real (ADR-140, actualización 2026-09-02): registrado como
// callback de `TelemetryIngestor` (ver `startAlarmEvaluator()` más abajo).
// Se ejecuta EN el hilo de flush/consumo de telemetría, nunca en una request
// HTTP -- debe ser barato en el caso común. Solo cubre reglas de
// `sensor_id` real (las de `mining_sensor_id` siguen dependiendo
// exclusivamente del polling, ver `evaluateRulesOnce`, porque
// `mining_sensors.current_value` no pasa por `TelemetryIngestor`).
// ---------------------------------------------------------------------------
void handleRealtimeTelemetryBatch(const std::vector<mining::TelemetryRow> &batch) {
  storage::PgPool::Lease lease;
  PGconn *conn = nullptr;

  // Si el cache está obsoleto o fue invalidado (p.ej. una regla se acaba de
  // crear/editar/borrar, T12), hay que refrescarlo ANTES de mirar el índice
  // por sensor -- si no, un evento en tiempo real justo después de crear
  // una regla nunca la vería (el índice seguiría reflejando el estado
  // anterior hasta que el polling periódico lo refresque, hasta 10s
  // después) y esta vía dejaría de cumplir su propósito. Caso común (cache
  // fresco, sin cambios de reglas recientes): sin esto, cero conexiones.
  if (!ruleCacheIsFresh()) {
    auto &cfg = AppConfig::instance();
    lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    conn = lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      getCachedEnabledRules(conn); // fuerza el refresh; el resultado en sí no se usa, solo el índice que deja actualizado
    }
  }

  bool anyCandidate = false;
  for (const auto &row : batch) {
    if (!getCachedRulesForSensor(row.sensor_id).empty()) {
      anyCandidate = true;
      break;
    }
  }
  if (!anyCandidate) return;

  if (!conn || PQstatus(conn) != CONNECTION_OK) {
    auto &cfg = AppConfig::instance();
    lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return;  // el polling lo cubre en su próximo ciclo
  }

  const auto evalNow = std::chrono::steady_clock::now();
  for (const auto &row : batch) {
    const auto matchingRules = getCachedRulesForSensor(row.sensor_id);
    for (const auto &rule : matchingRules) {
      evaluateRuleAgainstValue(conn, rule, row.value_numeric, evalNow);
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
  // ADR-140 (actualización 2026-09-02): registrar el camino en tiempo real
  // ANTES de que main.cpp llame a TelemetryIngestor::instance().start() —
  // mismo orden que ya exige configureKafka(). Si por algún motivo se
  // llamara después de start(), el peor caso es perder el disparo en
  // tiempo real de los primeros lotes (el polling los cubre igual en su
  // siguiente ciclo) — nunca una pérdida de datos.
  mining::TelemetryIngestor::instance().setOnBatchCommitted(handleRealtimeTelemetryBatch);
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
  r.put("/api/mining/alarms/rules/", handleUpdateAlarmRule);
  r.del("/api/mining/alarms/rules/", handleDeleteAlarmRule);

  r.get("/api/mining/alarms", handleListAlarms);
  r.post("/api/mining/alarms/", handleAcknowledgeAlarm);
}

} // namespace mining_iot
