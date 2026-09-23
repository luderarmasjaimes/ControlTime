#include "device_alarm_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/jwt.hpp"
#include "../auth/permissions.hpp"
#include "telemetry_ingest.hpp"
#include "alarm_notifier.hpp"
#include "alarm_rule_evaluator.hpp"
#include "sensor_formula_routes.hpp"
#include "sensor_formula_template_routes.hpp"
#include "sensor_type_catalog_routes.hpp"
#include "internal_session_routes.hpp"
#include "protocol_adapters.hpp"

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
#include <cctype>
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

  // Sin esto, TelemetryIngestor::resolveSensor() no reconoce este
  // sensor_code hasta el próximo reinicio del proceso -- su caché de
  // sensores se carga una vez en start() (ver telemetry_ingest.cpp). El
  // dispositivo quedaría registrado pero sin poder recibir ninguna lectura
  // (incluida la de "Probar ahora" en SensorManagementView) hasta ese
  // reinicio. Encontrado en vivo probando el registro end-to-end.
  auto &ingestorRefresh = mining::TelemetryIngestor::instance();
  if (ingestorRefresh.running()) ingestorRefresh.refreshSensorCache();

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
        "(device_api_key_hash IS NOT NULL) AS has_credential, "
        "unit, zone_id, lat, lng, label, serial_number, external_id "
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
            {"has_credential", std::string(PQgetvalue(res.get(), i, 8)) == "t"},
            {"unit", PQgetisnull(res.get(), i, 9) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 9))},
            {"zone_id", PQgetisnull(res.get(), i, 10) ? json::value(nullptr) : json::value(std::atoi(PQgetvalue(res.get(), i, 10)))},
            {"lat", PQgetisnull(res.get(), i, 11) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 11)))},
            {"lng", PQgetisnull(res.get(), i, 12) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 12)))},
            {"label", PQgetisnull(res.get(), i, 13) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 13))},
            {"serial_number", PQgetisnull(res.get(), i, 14) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 14))},
            {"external_id", PQgetisnull(res.get(), i, 15) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 15))}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"devices", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"devices", json::array()}});
#endif
}

// GET /api/mining/devices/traceability -- SPEC-027 (T5, CA-1) / ADR-192:
// matriz de trazabilidad sensor -> tipo -> protocolo -> modo de conexión ->
// canales -> fórmulas -> reglas de alarma -> última lectura, para los
// sensores con credencial real de ESTE tenant. Simple SELECT sobre
// `v_sensor_traceability` (db_scripts/103), que ya aplica el filtro
// `device_api_key_hash IS NOT NULL` -- acá solo se acota por tenant_id de la
// sesión (mismo criterio anti-IDOR que handleListDevices: el tenant sale
// SIEMPRE de la sesión, nunca de un query param).
http::response<http::string_body>
handleDeviceTraceability(const http::request<http::string_body> &req,
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
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const char *params[1] = {session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT sensor_id, sensor_code, sensor_name, sensor_type, protocol, "
        "connection_mode, gateway_label, connection_status, last_seen_at, "
        "zone_id, channels, formulas, alarm_rules "
        "FROM v_sensor_traceability WHERE tenant_id = $1::uuid "
        "ORDER BY sensor_code",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        const bool hasLastSeen = !PQgetisnull(res.get(), i, 8);
        json::value channelsVal, formulasVal, alarmRulesVal;
        try { channelsVal = json::parse(PQgetvalue(res.get(), i, 10)); } catch (...) { channelsVal = json::array(); }
        try { formulasVal = json::parse(PQgetvalue(res.get(), i, 11)); } catch (...) { formulasVal = json::array(); }
        try { alarmRulesVal = json::parse(PQgetvalue(res.get(), i, 12)); } catch (...) { alarmRulesVal = json::array(); }
        json::object o{
            {"sensor_id", PQgetvalue(res.get(), i, 0)},
            {"sensor_code", PQgetvalue(res.get(), i, 1)},
            {"sensor_name", PQgetvalue(res.get(), i, 2)},
            {"sensor_type", PQgetvalue(res.get(), i, 3)},
            {"protocol", PQgetvalue(res.get(), i, 4)},
            {"connection_mode", PQgetisnull(res.get(), i, 5) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 5))},
            {"gateway_label", PQgetisnull(res.get(), i, 6) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 6))},
            {"connection_status", PQgetvalue(res.get(), i, 7)},
            {"last_seen_at", hasLastSeen ? json::value(PQgetvalue(res.get(), i, 8)) : json::value(nullptr)},
            {"zone_id", PQgetisnull(res.get(), i, 9) ? json::value(nullptr) : json::value(std::atoi(PQgetvalue(res.get(), i, 9)))},
            {"channels", channelsVal},
            {"formulas", formulasVal},
            {"alarm_rules", alarmRulesVal}};
        items.push_back(std::move(o));
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"devices", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"devices", json::array()}});
#endif
}

// PUT /api/mining/devices/{id} -- actualización parcial de los campos de
// configuración del sensor que `handleRegisterDevice` nunca fijó (zona,
// geolocalización, etiqueta, número de serie, id externo). Solo se tocan
// las columnas presentes en el body **con valor no nulo**; un campo ausente
// (o `null`) deja el dato actual sin cambios -- ver el COALESCE del lado
// SQL. No hay migración nueva: las seis columnas ya existen en `sensors`
// (db_scripts/18, 39, 54), solo faltaba el endpoint de escritura.
http::response<http::string_body>
handleUpdateDevice(const http::request<http::string_body> &req,
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
  static const std::string kUpdatePrefix = "/api/mining/devices/";
  std::string sensorId, updateSubpath;
  {
    auto idStr = rawTarget.substr(kUpdatePrefix.size());
    auto q = idStr.find('?');
    if (q != std::string::npos) idStr = idStr.substr(0, q);
    auto slash = idStr.find('/');
    sensorId = slash != std::string::npos ? idStr.substr(0, slash) : idStr;
    if (slash != std::string::npos) updateSubpath = idStr.substr(slash + 1);
  }
  if (sensorId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_sensor_id"}});
  }
  // `/api/mining/devices/` ya está tomado como prefijo PUT por este mismo
  // handler -- ADR-187 (motor de fórmulas) despacha por sufijo acá en vez de
  // registrar rutas nuevas, mismo criterio que rotate-key en
  // handleRevokeDevice.
  if (updateSubpath == "parameters") {
    return handleUpdateSensorParameters(req, query, sensorId);
  }
  static const std::string kFormulasPrefix = "formulas/";
  if (updateSubpath.rfind(kFormulasPrefix, 0) == 0) {
    return handleUpdateSensorFormula(req, query, sensorId,
                                     updateSubpath.substr(kFormulasPrefix.size()));
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

  std::string zoneIdStr, latStr, lngStr, labelStr, serialStr, externalStr,
      connectionModeStr, gatewayLabelStr;
  const char *zoneIdParam = nullptr, *latParam = nullptr, *lngParam = nullptr,
             *labelParam = nullptr, *serialParam = nullptr, *externalParam = nullptr,
             *connectionModeParam = nullptr, *gatewayLabelParam = nullptr;
  if (const auto *v = obj.if_contains("zone_id"); v && !v->is_null()) {
    zoneIdStr = jsonToStringSafe(*v); zoneIdParam = zoneIdStr.c_str();
  }
  if (const auto *v = obj.if_contains("lat"); v && !v->is_null()) {
    latStr = jsonToStringSafe(*v); latParam = latStr.c_str();
  }
  if (const auto *v = obj.if_contains("lng"); v && !v->is_null()) {
    lngStr = jsonToStringSafe(*v); lngParam = lngStr.c_str();
  }
  if (const auto *v = obj.if_contains("label"); v && !v->is_null()) {
    labelStr = jsonToStringSafe(*v); labelParam = labelStr.c_str();
  }
  if (const auto *v = obj.if_contains("serial_number"); v && !v->is_null()) {
    serialStr = jsonToStringSafe(*v); serialParam = serialStr.c_str();
  }
  if (const auto *v = obj.if_contains("external_id"); v && !v->is_null()) {
    externalStr = jsonToStringSafe(*v); externalParam = externalStr.c_str();
  }
  // SPEC-027 (T8) / ADR-192: metadatos ligeros de trazabilidad
  // directo/gateway -- mismo patrón COALESCE que el resto de este endpoint,
  // sin tocar el flujo de ingesta/autenticación. connection_mode se valida
  // acá (400 si no es uno de los 2 valores permitidos) además del CHECK de
  // db_scripts/102, para devolver un error claro al frontend en vez de un
  // 500 de constraint violation.
  static const std::set<std::string> kConnectionModes = {"direct", "gateway"};
  if (const auto *v = obj.if_contains("connection_mode"); v && !v->is_null()) {
    connectionModeStr = jsonToStringSafe(*v);
    if (kConnectionModes.find(connectionModeStr) == kConnectionModes.end()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "connection_mode_invalido"}});
    }
    connectionModeParam = connectionModeStr.c_str();
  }
  if (const auto *v = obj.if_contains("gateway_label"); v && !v->is_null()) {
    gatewayLabelStr = jsonToStringSafe(*v); gatewayLabelParam = gatewayLabelStr.c_str();
  }

  auto &cfgUpd = AppConfig::instance();
  auto leaseUpd = storage::PgPool::instance().acquire(cfgUpd.gDatabaseUrl);
  PGconn *connUpd = leaseUpd.get();
  if (PQstatus(connUpd) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  // IDOR: mismo criterio que handleRevokeDevice -- el UPDATE está acotado a
  // tenant_id de la sesión, un sensor_id de otro tenant no matchea filas.
  const char *updParams[10] = {sensorId.c_str(), session->tenantId.c_str(),
                               zoneIdParam, latParam, lngParam,
                               labelParam, serialParam, externalParam,
                               connectionModeParam, gatewayLabelParam};
  storage::PgResult updRes{PQexecParams(
      connUpd,
      "UPDATE sensors SET "
      "zone_id = COALESCE($3::int, zone_id), "
      "lat = COALESCE($4::double precision, lat), "
      "lng = COALESCE($5::double precision, lng), "
      "label = COALESCE($6, label), "
      "serial_number = COALESCE($7, serial_number), "
      "external_id = COALESCE($8, external_id), "
      "connection_mode = COALESCE($9, connection_mode), "
      "gateway_label = COALESCE($10, gateway_label) "
      "WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid "
      "RETURNING sensor_id",
      10, nullptr, updParams, nullptr, nullptr, 0)};
  if (!updRes.okTuples() || PQntuples(updRes.get()) == 0) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "device_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ADR-208: CRUD real de `sensor_zones` (antes solo sembrada por
// db_scripts/54 -- cuadrantes automáticos por centroide -- y de solo
// lectura desde el backend: el usuario podía reasignar el zone_id de un
// sensor a una zona ya existente vía handleUpdateDevice, pero no crear,
// renombrar ni borrar la zona en sí). Mismo criterio de permiso que
// handleUpdateDevice ("dispositivos.manage": las zonas son metadata de
// organización de sensores, no una entidad con su propio permiso).
http::response<http::string_body>
handleListZones(const http::request<http::string_body> &req,
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
        "SELECT z.zone_id, z.code, z.name_es, z.sort_order, "
        "z.centroid_lat, z.centroid_lng, "
        "(SELECT COUNT(*) FROM sensors s WHERE s.zone_id = z.zone_id) AS sensor_count "
        "FROM sensor_zones z WHERE z.tenant_id = $1::uuid "
        "ORDER BY z.sort_order ASC, z.zone_id ASC",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        items.push_back(json::object{
            {"zone_id", std::atoi(PQgetvalue(res.get(), i, 0))},
            {"code", PQgetvalue(res.get(), i, 1)},
            {"name_es", PQgetvalue(res.get(), i, 2)},
            {"sort_order", std::atoi(PQgetvalue(res.get(), i, 3))},
            {"centroid_lat", PQgetisnull(res.get(), i, 4) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 4)))},
            {"centroid_lng", PQgetisnull(res.get(), i, 5) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 5)))},
            {"sensor_count", std::atoi(PQgetvalue(res.get(), i, 6))}});
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"zones", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"zones", json::array()}});
#endif
}

http::response<http::string_body>
handleCreateZone(const http::request<http::string_body> &req,
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
  if (!obj.if_contains("code") || !obj.if_contains("name_es")) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "code_y_name_es_son_requeridos"}});
  }
  const std::string code = jsonToStringSafe(obj.at("code"));
  const std::string nameEs = jsonToStringSafe(obj.at("name_es"));
  if (code.empty() || nameEs.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "code_y_name_es_no_pueden_estar_vacios"}});
  }
  int sortOrder = 50;
  if (obj.if_contains("sort_order")) {
    double d = 0;
    if (jsonToDoubleSafe(obj.at("sort_order"), d)) sortOrder = static_cast<int>(d);
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const std::string sortOrderStr = std::to_string(sortOrder);
  const char *params[4] = {session->tenantId.c_str(), code.c_str(), nameEs.c_str(),
                            sortOrderStr.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order) "
      "VALUES ($1::uuid, $2, $3, $4::int) RETURNING zone_id",
      4, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    // UNIQUE (tenant_id, code) es la única violación esperable acá (ver
    // sensor_zones en db_scripts/54) -- se reporta como conflicto de
    // negocio, no como error 500, para que la UI pueda mostrar un mensaje
    // específico ("ya existe una zona con ese código") en vez de genérico.
    return makeJsonResponse(http::status::conflict,
                            json::object{{"error", "zone_code_ya_existe"}});
  }
  return makeJsonResponse(
      http::status::created,
      json::object{{"zone_id", std::atoi(PQgetvalue(res.get(), 0, 0))}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleUpdateZone(const http::request<http::string_body> &req,
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
  static const std::string kPrefix = "/api/mining/zones/";
  std::string zoneId;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    zoneId = q != std::string::npos ? idStr.substr(0, q) : idStr;
  }
  if (zoneId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_zone_id"}});
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
  const bool hasNameEs = obj.if_contains("name_es");
  const bool hasCode = obj.if_contains("code");
  const bool hasSortOrder = obj.if_contains("sort_order");
  if (!hasNameEs && !hasCode && !hasSortOrder) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "nada_para_actualizar"}});
  }
  const std::string nameEs = hasNameEs ? jsonToStringSafe(obj.at("name_es")) : std::string();
  const std::string code = hasCode ? jsonToStringSafe(obj.at("code")) : std::string();
  std::string sortOrderStr;
  if (hasSortOrder) {
    double d = 0;
    if (jsonToDoubleSafe(obj.at("sort_order"), d)) sortOrderStr = std::to_string(static_cast<int>(d));
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *params[5] = {
      zoneId.c_str(), session->tenantId.c_str(),
      hasNameEs && !nameEs.empty() ? nameEs.c_str() : nullptr,
      hasCode && !code.empty() ? code.c_str() : nullptr,
      hasSortOrder && !sortOrderStr.empty() ? sortOrderStr.c_str() : nullptr};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE sensor_zones SET "
      "name_es = COALESCE($3, name_es), "
      "code = COALESCE($4, code), "
      "sort_order = COALESCE($5::int, sort_order) "
      "WHERE zone_id = $1::int AND tenant_id = $2::uuid "
      "RETURNING zone_id",
      5, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "zone_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// El borrado no exige reasignar sensores a mano primero: `sensors.zone_id`
// referencia `sensor_zones(zone_id)` con `ON DELETE SET NULL`
// (db_scripts/54) -- los sensores de la zona borrada quedan sin zona
// ("Sin zona asignada" en la UI, mismo criterio de fallback visual que ya
// usa zoneLabel() en ZoneSensorPicker/SensorManagementView), no bloqueados
// ni huérfanos.
http::response<http::string_body>
handleDeleteZone(const http::request<http::string_body> &req,
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
  static const std::string kPrefix = "/api/mining/zones/";
  std::string zoneId;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    zoneId = q != std::string::npos ? idStr.substr(0, q) : idStr;
  }
  if (zoneId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_zone_id"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *params[2] = {zoneId.c_str(), session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "DELETE FROM sensor_zones WHERE zone_id = $1::int AND tenant_id = $2::uuid",
      2, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "zone_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

namespace {
// Emite una nueva `device_api_key` para un sensor ya registrado, sin pasar
// por `handleRegisterDevice` (que chocaría con la restricción UNIQUE de
// `sensor_code` si se intentara "re-registrar" el mismo sensor). Es lo que
// hace posible volver a probar la conexión de un dispositivo cuando la key
// original (mostrada una sola vez) ya no se tiene -- ver "Probar ahora" en
// SensorManagementView. Mismo patrón de auditoría que handleRegisterDevice
// (emitir una credencial es una acción sensible, a diferencia de un simple
// PUT de metadata) -- a diferencia de handleRevokeDevice, que hoy no audita.
http::response<http::string_body>
rotateDeviceKeyImpl(const std::string &tenantId, const std::string &username,
                    const std::string &sensorId) {
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const std::string rawApiKey = "dev_" + http_utils::secureRandomHex(32);
  const std::string apiKeyHash = auth::jwt::sha256Hex(rawApiKey);
  const char *params[3] = {apiKeyHash.c_str(), sensorId.c_str(), tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE sensors SET device_api_key_hash = $1, connection_status = 'unknown', "
      "revoked_at = NULL WHERE sensor_id = $2::uuid AND tenant_id = $3::uuid",
      3, nullptr, params, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "device_not_found"}});
  }
  const char *auditParams[3] = {tenantId.c_str(), sensorId.c_str(), username.c_str()};
  storage::PgResult auditRes{PQexecParams(
      conn,
      "SELECT fn_platform_audit_insert($1::uuid, NULL, $3::text, "
      "'device_key_rotate', 'sensor', $2::text, NULL, NULL, "
      "jsonb_build_object('sensor_id', $2::text), TRUE, NULL)",
      3, nullptr, auditParams, nullptr, nullptr, 0)};
  (void)auditRes;
  return makeJsonResponse(
      http::status::ok,
      json::object{{"device_api_key", rawApiKey},
                   {"warning", "Guarde esta clave ahora — no se puede recuperar después."}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// Pedido explícito del usuario (2026-09-18): recalibración/reset remoto de
// sensores. Downlink real solo funciona para `sensors.protocol='mqtt'`
// (publishMqttCommand, protocol_adapters.cpp) o `'http_push'` (dispositivos
// que llegan por API key HTTP, como el smartphone de prueba -- el comando
// queda 'pending' hasta que el dispositivo lo recoja vía
// GET /api/mining/telemetry/commands). Cualquier otro protocolo
// (legacy_tls/modbus/opcua) responde 'failed' con un motivo honesto: escribir
// a ciegas un registro Modbus o un NodeId OPC UA de un PLC real sin su ficha
// técnica es peligroso, no se simula un éxito falso.
http::response<http::string_body>
sendDeviceCommandImpl(const std::string &tenantId, const std::string &userId,
                      const std::string &username, const std::string &sensorId,
                      const http::request<http::string_body> &req) {
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
  static const std::set<std::string> kCommandTypes = {"recalibrate", "reset_factory", "reconfigure"};
  if (!obj.if_contains("command_type") || !obj.if_contains("reason")) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "command_type y reason son requeridos"}});
  }
  const std::string commandType = jsonToStringSafe(obj.at("command_type"));
  if (kCommandTypes.find(commandType) == kCommandTypes.end()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "command_type_invalido"}});
  }
  const std::string reason = jsonToStringSafe(obj.at("reason"));
  bool reasonBlank = true;
  for (char c : reason) {
    if (!std::isspace(static_cast<unsigned char>(c))) { reasonBlank = false; break; }
  }
  if (reasonBlank) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "reason_requerido"}});
  }
  std::string payloadJson = "{}";
  if (const auto *p = obj.if_contains("payload"); p && p->is_object()) {
    payloadJson = json::serialize(*p);
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }

  // anti-IDOR: el sensor debe pertenecer al tenant de la sesión.
  const char *lookupParams[2] = {sensorId.c_str(), tenantId.c_str()};
  storage::PgResult sensorRes{PQexecParams(
      conn,
      "SELECT sensor_code, protocol FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid",
      2, nullptr, lookupParams, nullptr, nullptr, 0)};
  if (!sensorRes.okTuples() || PQntuples(sensorRes.get()) == 0) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "device_not_found"}});
  }
  const std::string sensorCode = PQgetvalue(sensorRes.get(), 0, 0);
  const std::string protocol = PQgetvalue(sensorRes.get(), 0, 1);
  const bool isMqtt = protocol == "mqtt";
  // 'http_push' es el valor real que asigna SensorManagementView.tsx al
  // registrar cualquier sensor desde la UI (registerDevice(), línea ~410) --
  // no 'http_poll'. El "transport" interno se sigue llamando http_poll
  // porque describe el MECANISMO (el dispositivo sondea comandos, el
  // servidor no le escribe), no el valor crudo de la columna.
  const bool isHttpPoll = protocol == "http_push";
  const std::string transport = isMqtt ? "mqtt" : (isHttpPoll ? "http_poll" : "unsupported");

  const char *insParams[7] = {tenantId.c_str(),   sensorId.c_str(), commandType.c_str(),
                              payloadJson.c_str(), reason.c_str(),   transport.c_str(),
                              userId.empty() ? nullptr : userId.c_str()};
  storage::PgResult ins{PQexecParams(
      conn,
      "INSERT INTO device_command_log (tenant_id, sensor_id, command_type, payload, "
      "reason, transport, requested_by, status) "
      "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7::uuid, 'pending') "
      "RETURNING command_id::text",
      7, nullptr, insParams, nullptr, nullptr, 0)};
  if (!ins.okTuples() || PQntuples(ins.get()) == 0) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "command_log_insert_failed"}});
  }
  const std::string commandId = PQgetvalue(ins.get(), 0, 0);

  std::string finalStatus = "pending";
  std::string resultMsg;
  if (isMqtt) {
    // Tópico por convención: el dispositivo real debe suscribirse a su
    // propio tópico "devices/{sensor_code}/cmd" para recibir esto -- no hay
    // forma de verificar desde acá que algo del otro lado esté escuchando.
    const std::string topic = "devices/" + sensorCode + "/cmd";
    json::object cmdMsg{{"command_id", commandId},
                        {"command_type", commandType},
                        {"payload", json::parse(payloadJson)}};
    const bool sent = mining::protocols::publishMqttCommand(topic, json::serialize(cmdMsg));
    finalStatus = sent ? "delivered" : "failed";
    resultMsg = sent ? ("publicado en " + topic)
                     : "broker MQTT no disponible o adaptador deshabilitado (BEEMETRY_MQTT_ENABLED)";
  } else if (!isHttpPoll) {
    finalStatus = "failed";
    resultMsg = "protocolo '" + protocol + "' no soporta downlink todavía -- Modbus/OPC-UA write "
                "requieren la ficha técnica del dispositivo real (dirección de registro/NodeId) "
                "antes de implementarse, no se simula un envío exitoso.";
  }
  // isHttpPoll se queda en 'pending': el dispositivo lo recoge en su
  // próximo GET /api/mining/telemetry/commands.

  if (finalStatus != "pending") {
    const char *updParams[3] = {finalStatus.c_str(), resultMsg.c_str(), commandId.c_str()};
    storage::PgResult upd{PQexecParams(
        conn,
        "UPDATE device_command_log SET status = $1, result = $2, "
        "delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END "
        "WHERE command_id = $3::bigint",
        3, nullptr, updParams, nullptr, nullptr, 0)};
    (void)upd;
  }

  // Auditoría -- pedido explícito del usuario: toda acción sensible sobre un
  // sensor queda registrada, con el motivo incluido en el detalle.
  const char *auditParams[5] = {tenantId.c_str(), sensorId.c_str(), username.c_str(),
                                commandType.c_str(), reason.c_str()};
  storage::PgResult auditRes{PQexecParams(
      conn,
      "SELECT fn_platform_audit_insert($1::uuid, NULL, $3::text, "
      "'device_command_send', 'sensor', $2::text, NULL, NULL, "
      "jsonb_build_object('command_type', $4::text, 'reason', $5::text), TRUE, NULL)",
      5, nullptr, auditParams, nullptr, nullptr, 0)};
  (void)auditRes;

  return makeJsonResponse(
      http::status::accepted,
      json::object{{"command_id", commandId}, {"status", finalStatus}, {"detail", resultMsg}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// Declara canales de entrada multivariados (sensor_input_channel_def,
// ADR-189) para un sensor SIN pasar por "aplicar plantilla de fórmula" --
// necesario para canales que no son entrada de ninguna fórmula (p.ej.
// gps_lat/gps_lng de un smartphone de prueba, usados solo para posicionar el
// marcador en el mapa/geocercas, ver el hook en handleHttpTelemetryMulti).
http::response<http::string_body>
declareDeviceChannelsImpl(const std::string &tenantId, const std::string &username,
                          const std::string &sensorId,
                          const http::request<http::string_body> &req) {
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
  const auto *chArr = obj.if_contains("channels");
  if (!chArr || !chArr->is_array() || chArr->as_array().empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "channels_array_required"}});
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *ownParams[2] = {sensorId.c_str(), tenantId.c_str()};
  storage::PgResult ownRes{PQexecParams(
      conn, "SELECT 1 FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid",
      2, nullptr, ownParams, nullptr, nullptr, 0)};
  if (!ownRes.okTuples() || PQntuples(ownRes.get()) == 0) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "device_not_found"}});
  }

  int declared = 0;
  int sortOrder = 0;
  for (const auto &v : chArr->as_array()) {
    if (!v.is_string()) continue;
    const std::string code = std::string(v.as_string());
    if (code.empty()) continue;
    const std::string sortStr = std::to_string(sortOrder++);
    const char *insParams[3] = {sensorId.c_str(), code.c_str(), sortStr.c_str()};
    storage::PgResult ins{PQexecParams(
        conn,
        "INSERT INTO sensor_input_channel_def (sensor_id, channel_code, sort_order) "
        "VALUES ($1::uuid, $2, $3::int) ON CONFLICT (sensor_id, channel_code) DO NOTHING",
        3, nullptr, insParams, nullptr, nullptr, 0)};
    if (ins.okCommand()) ++declared;
  }

  const char *auditParams[3] = {tenantId.c_str(), sensorId.c_str(), username.c_str()};
  storage::PgResult auditRes{PQexecParams(
      conn,
      "SELECT fn_platform_audit_insert($1::uuid, NULL, $3::text, "
      "'device_channels_declare', 'sensor', $2::text, NULL, NULL, '{}'::jsonb, TRUE, NULL)",
      3, nullptr, auditParams, nullptr, nullptr, 0)};
  (void)auditRes;

  return makeJsonResponse(http::status::ok, json::object{{"declared", declared}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}
}  // namespace

http::response<http::string_body>
handleRevokeDevice(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/devices/";
  std::string sensorId, subpath;
  {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    if (q != std::string::npos) idStr = idStr.substr(0, q);
    auto slash = idStr.find('/');
    sensorId = slash != std::string::npos ? idStr.substr(0, slash) : idStr;
    if (slash != std::string::npos) subpath = idStr.substr(slash + 1);
  }
  if (sensorId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_sensor_id"}});
  }
  // ADR-195: POST .../{id}/formulas/{formula_id}/diagram/regenerate se
  // resuelve ANTES del gate de dispositivos.manage de abajo, a propósito --
  // ver el comentario dentro de handleRegenerateSensorFormulaDiagram. No
  // acepta ningún contenido del caller, solo reconstruye determinísticamente
  // el diagrama desde una fórmula que el usuario ya puede leer en "Fórmulas
  // de Sensores" (esa vista tampoco exige el permiso) -- confirmado en vivo
  // que dejarlo detrás del gate de abajo daba 403 a cualquier usuario sin
  // dispositivos.manage, incluso solo para VER un diagrama.
  {
    static const std::string kFormulasPrefix = "formulas/";
    static const std::string kDiagramSuffix = "/diagram/regenerate";
    if (subpath.rfind(kFormulasPrefix, 0) == 0 &&
        subpath.size() > kFormulasPrefix.size() + kDiagramSuffix.size() &&
        subpath.compare(subpath.size() - kDiagramSuffix.size(), kDiagramSuffix.size(), kDiagramSuffix) == 0) {
      const std::string formulaId = subpath.substr(
          kFormulasPrefix.size(), subpath.size() - kFormulasPrefix.size() - kDiagramSuffix.size());
      return handleRegenerateSensorFormulaDiagram(req, query, sensorId, formulaId);
    }
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                          "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
  // `/api/mining/devices/` ya está tomado como prefijo POST por este mismo
  // handler (revoke) -- una segunda ruta de prefijo separada para
  // `.../rotate-key` sería ambigua con esta. Se despacha por sufijo acá en
  // vez de registrar una ruta nueva.
  if (subpath == "rotate-key") {
    return rotateDeviceKeyImpl(session->tenantId, session->username, sensorId);
  }
  // Recalibración/reset remoto (pedido explícito 2026-09-18) y declaración
  // de canales custom (p.ej. gps_lat/gps_lng de un smartphone) -- mismo
  // criterio de despacho por sufijo que rotate-key/formulas de arriba.
  if (subpath == "command") {
    return sendDeviceCommandImpl(session->tenantId, session->userId, session->username,
                                 sensorId, req);
  }
  if (subpath == "channels") {
    return declareDeviceChannelsImpl(session->tenantId, session->username, sensorId, req);
  }
  // ADR-187: POST .../{id}/formulas crea una fórmula -- mismo criterio de
  // despacho por sufijo que rotate-key, ese mismo motivo (prefijo POST ya
  // tomado por este handler).
  if (subpath == "formulas") {
    return handleCreateSensorFormula(req, query, sensorId);
  }
  // ADR-189: POST .../{id}/formulas/apply-template -- aplica una plantilla
  // del catálogo (canales de entrada + parámetros + N fórmulas de salida de
  // una vez). Mismo criterio de despacho por sufijo, mismo motivo.
  if (subpath == "formulas/apply-template") {
    return handleApplyFormulaTemplate(req, query, sensorId);
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
    // Rechazar NaN/Inf ACA (400, error del cliente) en vez de dejar que
    // ingestLine() lo descarte más abajo y devuelva el genérico
    // "ingest_queue_full" (503) -- ese mensaje sugeriría reintentar/backoff
    // de capacidad, cuando el problema real es el valor enviado. Mismo
    // criterio que handleHttpTelemetryMulti (ver más abajo en este archivo).
    if (!mining::isSaneTelemetryValue(value)) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "invalid_value"}});
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
// POST /api/mining/telemetry/multi — ADR-189: ingesta de 2-3 valores crudos
// NOMBRADOS por mensaje (Freq/Temp/Press...), SOLO para sensores que declaran
// sensor_input_channel_def (multivariados) -- ver
// db_scripts/95_sensor_formula_template_catalog.sql. Mismo patrón de
// autenticación por X-Device-Key que handleHttpTelemetry arriba (extensión
// acotada: ningún sensor de 1 valor pasa nunca por acá, sigue exclusivamente
// por /api/mining/telemetry). A propósito NO se enruta por
// TelemetryIngestor::ingestLine()/COPY binario -- ese camino está optimizado
// para el hot path de alto volumen de un solo valor; estos sensores
// geotécnicos reportan cada varios minutos, volumen bajo, un INSERT
// parametrizado directo es correcto acá y no arriesga el pipeline existente.
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleHttpTelemetryMulti(const http::request<http::string_body> &req,
                         const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  const auto keyIt = req.find("X-Device-Key");
  if (keyIt == req.end() || keyIt->value().empty()) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "missing_device_key"}});
  }
  const std::string keyHash = auth::jwt::sha256Hex(std::string(keyIt->value()));

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *keyParams[1] = {keyHash.c_str()};
  storage::PgResult sensorRes{PQexecParams(
      conn,
      "SELECT sensor_id::text FROM sensors "
      "WHERE device_api_key_hash = $1 AND revoked_at IS NULL AND is_active "
      "LIMIT 1",
      1, nullptr, keyParams, nullptr, nullptr, 0)};
  if (!sensorRes.okTuples() || PQntuples(sensorRes.get()) == 0) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "invalid_device_key"}});
  }
  const std::string sensorId = PQgetvalue(sensorRes.get(), 0, 0);

  // Mismo upsert perezoso de dim_sensor que TelemetryIngestor::copyBatch()
  // (telemetry_ingest.cpp) -- si la PRIMERA telemetría de este sensor llega
  // por esta ruta (nunca pasó por /api/mining/telemetry), dim_sensor todavía
  // no tiene su fila y el INSERT a telemetry_fact de abajo emparejaría 0
  // filas en silencio sin esto.
  const char *dimSensorParams[1] = {sensorId.c_str()};
  storage::PgResult dimSensorUpsert{PQexecParams(
      conn,
      "INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, site_id_sk, "
      "sensor_code, sensor_type, unit, is_active) "
      "SELECT 'iot_v2', sn.sensor_id, dt.tenant_id_sk, dsi.site_id_sk, "
      "sn.sensor_code, sn.sensor_type, sn.unit, sn.is_active "
      "FROM sensors sn JOIN dim_tenant dt ON dt.tenant_id = sn.tenant_id "
      "LEFT JOIN dim_site dsi ON dsi.site_id = sn.site_id "
      "WHERE sn.sensor_id = $1::uuid "
      "AND NOT EXISTS (SELECT 1 FROM dim_sensor ds WHERE ds.sensor_id = sn.sensor_id) "
      "ON CONFLICT (sensor_id) DO NOTHING",
      1, nullptr, dimSensorParams, nullptr, nullptr, 0)};
  (void)dimSensorUpsert;

  std::unordered_map<std::string, double> channels;
  try {
    const auto body = json::parse(req.body());
    const auto &o = body.as_object();
    const auto *chObj = o.if_contains("channels");
    if (!chObj || !chObj->is_object() || chObj->as_object().empty()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "channels_required"}});
    }
    for (const auto &kv : chObj->as_object()) {
      double v = 0.0;
      // mining::isSaneTelemetryValue rechaza NaN/Inf -- ver telemetry_ingest.hpp
      // (Fase 1, plan de telemetría 2026-09-17). Esta ruta inserta directo a
      // telemetry_fact sin pasar por TelemetryIngestor::enqueue()/ingestLine(),
      // así que necesita su propio chequeo -- de lo contrario un "nan"/"inf"
      // enviado como string JSON (jsonToDoubleSafe lo parsea con std::stod)
      // se cuela intacto a la tabla.
      if (!jsonToDoubleSafe(kv.value(), v) || !mining::isSaneTelemetryValue(v)) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "invalid_channel_value"}, {"channel", std::string(kv.key())}});
      }
      channels[std::string(kv.key())] = v;
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }

  // Solo canales declarados en sensor_input_channel_def para ESTE sensor --
  // un sensor sin filas ahí (el caso común, un solo valor) nunca puede
  // recibir por esta ruta.
  const char *sidParam[1] = {sensorId.c_str()};
  storage::PgResult declaredRes{PQexecParams(
      conn,
      "SELECT channel_code FROM sensor_input_channel_def WHERE sensor_id = $1::uuid",
      1, nullptr, sidParam, nullptr, nullptr, 0)};
  std::set<std::string> declared;
  if (declaredRes.okTuples()) {
    for (int i = 0; i < PQntuples(declaredRes.get()); ++i) declared.insert(PQgetvalue(declaredRes.get(), i, 0));
  }
  if (declared.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "sensor_not_multichannel"}});
  }
  for (const auto &kv : channels) {
    if (!declared.count(kv.first)) {
      return makeJsonResponse(
          http::status::bad_request,
          json::object{{"error", "undeclared_channel"}, {"channel", kv.first}});
    }
  }

  int written = 0;
  for (const auto &kv : channels) {
    // Reserva channel_id en dim_channel si es la primera vez que se ve este
    // channel_code -- vía secuencia (dim_channel_channel_id_seq), a salvo de
    // la carrera de un MAX(channel_id)+1 bajo concurrencia.
    const char *chCode[1] = {kv.first.c_str()};
    storage::PgResult upsertChannel{PQexecParams(
        conn,
        "INSERT INTO dim_channel (channel_id, channel_code, description) "
        "VALUES (nextval('dim_channel_channel_id_seq'), $1, "
        "'Canal de entrada multivariado (ADR-189)') "
        "ON CONFLICT (channel_code) DO NOTHING",
        1, nullptr, chCode, nullptr, nullptr, 0)};
    (void)upsertChannel;

    const std::string valStr = std::to_string(kv.second);
    const char *insParams[3] = {sensorId.c_str(), kv.first.c_str(), valStr.c_str()};
    storage::PgResult ins{PQexecParams(
        conn,
        "INSERT INTO telemetry_fact (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric) "
        "SELECT ds.tenant_id_sk, ds.sensor_id_sk, dc.channel_id, NOW(), $3::real "
        "FROM dim_sensor ds, dim_channel dc "
        "WHERE ds.sensor_id = $1::uuid AND dc.channel_code = $2 "
        "ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING",
        3, nullptr, insParams, nullptr, nullptr, 0)};
    // okCommand() no distingue "insertó una fila" de "el INSERT...SELECT no
    // matcheó nada" (p.ej. dim_channel aún sin el channel_code) -- se cuenta
    // solo si PQcmdTuples realmente afectó una fila.
    if (ins.okCommand()) {
      const char *affected = PQcmdTuples(ins.get());
      if (affected && affected[0] != '\0' && std::atoi(affected) > 0) ++written;
    }
  }

  const char *seenParams[1] = {keyHash.c_str()};
  storage::PgResult seen{PQexecParams(
      conn,
      "UPDATE sensors SET last_seen_at = NOW(), connection_status = 'online' "
      "WHERE device_api_key_hash = $1",
      1, nullptr, seenParams, nullptr, nullptr, 0)};
  (void)seen;

  // Posición en vivo (pedido explícito 2026-09-18: probar geocercas con el
  // GPS del smartphone) -- si el mensaje trae AMBOS canales gps_lat/gps_lng
  // declarados (ver declareDeviceChannelsImpl), refleja la posición real en
  // sensors.lat/lng, que es lo que ya lee el mapa (/api/map/markers) y el
  // motor de geocercas (/api/map/compliance-intersections) para CUALQUIER
  // sensor -- no hace falta lógica nueva ahí, solo mantener la columna al
  // día. Rango validado (no solo isSaneTelemetryValue, que no acota a
  // coordenadas reales) para no dejar un marcador en medio del océano por un
  // GPS con glitch.
  if (const auto latIt = channels.find("gps_lat"), lngIt = channels.find("gps_lng");
      latIt != channels.end() && lngIt != channels.end()) {
    const double lat = latIt->second;
    const double lng = lngIt->second;
    if (lat >= -90.0 && lat <= 90.0 && lng >= -180.0 && lng <= 180.0) {
      const std::string latStr = std::to_string(lat);
      const std::string lngStr = std::to_string(lng);
      const char *posParams[3] = {latStr.c_str(), lngStr.c_str(), sensorId.c_str()};
      storage::PgResult posUpd{PQexecParams(
          conn,
          "UPDATE sensors SET lat = $1::double precision, lng = $2::double precision "
          "WHERE sensor_id = $3::uuid",
          3, nullptr, posParams, nullptr, nullptr, 0)};
      (void)posUpd;
    }
  }

  return makeJsonResponse(http::status::accepted,
                          json::object{{"status", "accepted"}, {"channels_written", written}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// GET /api/mining/telemetry/commands — recalibración/reset remoto, camino
// HTTP poll (sensores.protocol='http_push', p.ej. el smartphone de prueba):
// el dispositivo no tiene un socket abierto al que el servidor pueda
// escribir (a diferencia de MQTT), así que revisa periódicamente si hay
// comandos pendientes. Autenticación por X-Device-Key, igual que
// handleHttpTelemetry/Multi -- quien llama es la máquina, no una sesión de
// usuario. Al devolver los comandos pendientes los marca 'delivered' (no
// implica que el dispositivo ya los ejecutó -- eso lo confirma
// POST .../commands/ack).
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleGetPendingDeviceCommands(const http::request<http::string_body> &req,
                               const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  const auto keyIt = req.find("X-Device-Key");
  if (keyIt == req.end() || keyIt->value().empty()) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "missing_device_key"}});
  }
  const std::string keyHash = auth::jwt::sha256Hex(std::string(keyIt->value()));
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *keyParams[1] = {keyHash.c_str()};
  storage::PgResult sensorRes{PQexecParams(
      conn,
      "SELECT sensor_id::text FROM sensors "
      "WHERE device_api_key_hash = $1 AND revoked_at IS NULL AND is_active LIMIT 1",
      1, nullptr, keyParams, nullptr, nullptr, 0)};
  if (!sensorRes.okTuples() || PQntuples(sensorRes.get()) == 0) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "invalid_device_key"}});
  }
  const std::string sensorId = PQgetvalue(sensorRes.get(), 0, 0);

  const char *pendParams[1] = {sensorId.c_str()};
  storage::PgResult pend{PQexecParams(
      conn,
      "SELECT command_id::text, command_type, payload::text FROM device_command_log "
      "WHERE sensor_id = $1::uuid AND status = 'pending' ORDER BY created_at",
      1, nullptr, pendParams, nullptr, nullptr, 0)};
  json::array items;
  bool anyPending = false;
  if (pend.okTuples()) {
    for (int i = 0; i < PQntuples(pend.get()); ++i) {
      anyPending = true;
      json::value payload;
      try { payload = json::parse(PQgetvalue(pend.get(), i, 2)); } catch (...) { payload = json::object{}; }
      items.push_back(json::object{{"command_id", PQgetvalue(pend.get(), i, 0)},
                                   {"command_type", PQgetvalue(pend.get(), i, 1)},
                                   {"payload", payload}});
    }
  }
  if (anyPending) {
    const char *updParams[1] = {sensorId.c_str()};
    storage::PgResult upd{PQexecParams(
        conn,
        "UPDATE device_command_log SET status = 'delivered', delivered_at = NOW() "
        "WHERE sensor_id = $1::uuid AND status = 'pending'",
        1, nullptr, updParams, nullptr, nullptr, 0)};
    (void)upd;
  }
  return makeJsonResponse(http::status::ok, json::object{{"commands", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"commands", json::array()}});
#endif
}

// POST /api/mining/telemetry/commands/ack — el dispositivo confirma que
// ejecutó (o falló al ejecutar) un comando recibido por el poll de arriba.
// Mismo patrón de auth por X-Device-Key; el command_id se valida contra
// EL SENSOR de esa key (no se confía en lo que el dispositivo diga sobre a
// quién pertenece el comando).
http::response<http::string_body>
handleAckDeviceCommand(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  const auto keyIt = req.find("X-Device-Key");
  if (keyIt == req.end() || keyIt->value().empty()) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "missing_device_key"}});
  }
  const std::string keyHash = auth::jwt::sha256Hex(std::string(keyIt->value()));
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object() || !body.as_object().if_contains("command_id") ||
      !body.as_object().if_contains("status")) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "command_id y status son requeridos"}});
  }
  const auto &obj = body.as_object();
  const std::string commandId = jsonToStringSafe(obj.at("command_id"));
  const std::string status = jsonToStringSafe(obj.at("status"));
  if (status != "completed" && status != "failed") {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "status_invalido"}});
  }
  const std::string result = obj.if_contains("result") ? jsonToStringSafe(obj.at("result")) : std::string();

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  const char *keyParams[1] = {keyHash.c_str()};
  storage::PgResult sensorRes{PQexecParams(
      conn,
      "SELECT sensor_id::text FROM sensors "
      "WHERE device_api_key_hash = $1 AND revoked_at IS NULL AND is_active LIMIT 1",
      1, nullptr, keyParams, nullptr, nullptr, 0)};
  if (!sensorRes.okTuples() || PQntuples(sensorRes.get()) == 0) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "invalid_device_key"}});
  }
  const std::string sensorId = PQgetvalue(sensorRes.get(), 0, 0);

  const char *updParams[4] = {status.c_str(), result.c_str(), commandId.c_str(), sensorId.c_str()};
  storage::PgResult upd{PQexecParams(
      conn,
      "UPDATE device_command_log SET status = $1, result = $2, completed_at = NOW() "
      "WHERE command_id = $3::bigint AND sensor_id = $4::uuid",
      4, nullptr, updParams, nullptr, nullptr, 0)};
  const bool ok = upd.okCommand() && std::string(PQcmdTuples(upd.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "command_not_found"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "ack_recorded"}});
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
  // ADR-189: si se da, la regla evalúa un canal de SALIDA de fórmula
  // (telemetry_multivariate) en vez del canal crudo channel_id=0 -- ver
  // evaluateRulesOnce(). Solo tiene sentido junto a sensor_id (un
  // mining_sensor_id nunca tiene sensor_formula_def detrás), pero no se
  // rechaza explícitamente combinarlo con mining_sensor_id -- simplemente
  // evaluateRulesOnce() nunca lo mira en esa rama.
  const bool hasFormulaOutput = obj.if_contains("formula_output_channel_code");
  const std::string formulaOutputChannelCode =
      hasFormulaOutput ? jsonToStringSafe(obj.at("formula_output_channel_code")) : std::string();
  // SPEC-016 T1/T4/T5 (db_scripts/89): condition_type 'value' (default,
  // comportamiento original), 'rate' (compara la tasa de cambio, no el
  // valor absoluto) o 'inactivity' (ADR-193, db_scripts/104 -- ver abajo);
  // debounce_secs opcional, 0 = desactivado.
  const std::string conditionType = obj.if_contains("condition_type")
                                        ? jsonToStringSafe(obj.at("condition_type"))
                                        : std::string("value");
  if (conditionType != "value" && conditionType != "rate" && conditionType != "inactivity") {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "condition_type_invalido"}});
  }
  // ADR-193: inactividad solo tiene sentido para un sensor con conexión real
  // (sensor_id) -- un mining_sensor_id es un dato de simulación de dashboard
  // sin dispositivo detrás, no tiene last_seen_at que degrade. Se exige
  // operator='gt' porque 'threshold' pasa a significar "segundos de silencio
  // tolerados": la única condición con sentido es "el silencio actual es
  // MAYOR al umbral" -- cualquier otro operador (lt/eq/...) sería una alarma
  // que nunca dispara o dispara siempre, casi con certeza un error de config.
  if (conditionType == "inactivity") {
    if (!hasSensorId) {
      return makeJsonResponse(
          http::status::bad_request,
          json::object{{"error", "inactivity_requiere_sensor_id"}});
    }
    if (op != "gt") {
      return makeJsonResponse(
          http::status::bad_request,
          json::object{{"error", "inactivity_requiere_operator_gt"}});
    }
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
  const char *params[10] = {
      session->tenantId.c_str(),
      hasSensorId ? sensorId.c_str() : nullptr,
      hasSensorId ? nullptr : miningSensorId.c_str(),
      ruleName.c_str(), op.c_str(), thresholdString.c_str(), severity.c_str(),
      conditionType.c_str(), debounceString.c_str(),
      hasFormulaOutput ? formulaOutputChannelCode.c_str() : nullptr};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO platform_alarm_rules "
      "(tenant_id, sensor_id, mining_sensor_id, rule_name, operator, threshold, severity, "
      "condition_type, debounce_secs, formula_output_channel_code) "
      "VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6::double precision, $7, $8, $9::int, $10) "
      "RETURNING id",
      10, nullptr, params, nullptr, nullptr, 0)};
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
        "threshold, severity, enabled, condition_type, debounce_secs, "
        "formula_output_channel_code "
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
            {"debounce_secs", std::atoi(PQgetvalue(res.get(), i, 9))},
            {"formula_output_channel_code", PQgetisnull(res.get(), i, 10) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 10))}};
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
  if (conditionType != "value" && conditionType != "rate" && conditionType != "inactivity") {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "condition_type_invalido"}});
  }
  // ADR-193: mismo criterio que handleCreateAlarmRule -- 'inactivity'
  // requiere operator='gt' (ver ese comentario para el porqué). sensor_id/
  // mining_sensor_id no viajan en este body (son inmutables tras crear la
  // regla, ver UPDATE de abajo, que no los toca), así que la restricción de
  // "requiere sensor_id real" se valida más abajo contra la fila existente,
  // justo antes del UPDATE, en vez de acá.
  if (conditionType == "inactivity" && op != "gt") {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "inactivity_requiere_operator_gt"}});
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
  // ADR-189: igual criterio de reemplazo completo que el resto de esta
  // ruta (severity/condition_type ya se resetean a su default si se omiten)
  // -- si el body no manda formula_output_channel_code, queda en NULL.
  const bool hasFormulaOutput = obj.if_contains("formula_output_channel_code");
  const std::string formulaOutputChannelCode =
      hasFormulaOutput ? jsonToStringSafe(obj.at("formula_output_channel_code")) : std::string();

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  if (conditionType == "inactivity") {
    const char *p[2] = {ruleId.c_str(), session->tenantId.c_str()};
    storage::PgResult chk{PQexecParams(
        conn,
        "SELECT sensor_id IS NOT NULL FROM platform_alarm_rules "
        "WHERE id = $1::bigint AND tenant_id = $2::uuid",
        2, nullptr, p, nullptr, nullptr, 0)};
    if (!chk.okTuples() || PQntuples(chk.get()) == 0) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "rule_not_found"}});
    }
    if (std::string(PQgetvalue(chk.get(), 0, 0)) != "t") {
      return makeJsonResponse(
          http::status::bad_request,
          json::object{{"error", "inactivity_requiere_sensor_id"}});
    }
  }
  std::ostringstream thresholdStr;
  thresholdStr << threshold;
  const std::string thresholdString = thresholdStr.str();
  const std::string debounceString = std::to_string(debounceSecs);
  const std::string enabledString = enabled ? "true" : "false";
  const char *params[10] = {
      ruleId.c_str(), session->tenantId.c_str(), ruleName.c_str(), op.c_str(),
      thresholdString.c_str(), severity.c_str(), conditionType.c_str(),
      debounceString.c_str(), enabledString.c_str(),
      hasFormulaOutput ? formulaOutputChannelCode.c_str() : nullptr};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE platform_alarm_rules SET rule_name = $3, operator = $4, "
      "threshold = $5::double precision, severity = $6, condition_type = $7, "
      "debounce_secs = $8::int, enabled = $9::boolean, "
      "formula_output_channel_code = $10 "
      "WHERE id = $1::bigint AND tenant_id = $2::uuid",
      10, nullptr, params, nullptr, nullptr, 0)};
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
  // ADR-189: si no está vacío, evaluateRulesOnce() lee este canal de
  // telemetry_multivariate (salida de sensor_formula_def) en vez de
  // telemetry_fact.channel_id=0 -- solo aplica junto a hasSensorId=true.
  // El camino en tiempo real (handleRealtimeTelemetryBatch) NUNCA evalúa
  // estas reglas con el valor crudo del lote -- ver ese comentario.
  std::string formulaOutputChannelCode;
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
  // Art. 5 (Constitución): gauge de salud del cache, actualizado en cada
  // refresh real (no en el camino cacheado de arriba -- el tamaño no cambia
  // entre refreshes).

  storage::PgResult rules{PQexec(
      conn,
      "SELECT id, tenant_id, sensor_id, mining_sensor_id, operator, "
      "threshold, severity, rule_name, condition_type, debounce_secs, "
      "formula_output_channel_code "
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
      row.formulaOutputChannelCode = PQgetisnull(rules.get(), i, 10) ? "" : PQgetvalue(rules.get(), i, 10);
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
  alarmEngineStats().rules_cached.store(gRuleCache.size(), std::memory_order_relaxed);
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
    alarmEngineStats().evaluations.fetch_add(1, std::memory_order_relaxed);
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
      if (debounced) {
        alarmEngineStats().debounced.fetch_add(1, std::memory_order_relaxed);
        return; // T5: dentro de la ventana -- ni insert ni notify.
      }

      std::ostringstream msg;
      // ADR-193: mensaje legible para operador -- "valor X gt Y" no dice
      // nada sobre inactividad a quien recibe la notificación por
      // email/webhook, y currentValue acá son segundos de silencio, no una
      // lectura de sensor.
      if (rule.conditionType == "inactivity") {
        msg << ruleName << ": sin reportar hace " << currentValue
            << "s (umbral " << threshold << "s)";
      } else {
        msg << ruleName << ": valor " << currentValue;
        if (rule.conditionType == "rate") msg << " (tasa " << comparisonValue << "/min)";
        msg << " " << op << " " << threshold;
      }
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
        alarmEngineStats().triggered.fetch_add(1, std::memory_order_relaxed);
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
          alarmEngineStats().resolved.fetch_add(1, std::memory_order_relaxed);
          mining_iot::notifyAlarmEvent(
              PQgetvalue(res.get(), k, 1), PQgetvalue(res.get(), k, 0),
              "resolved", PQgetvalue(res.get(), k, 2),
              PQgetvalue(res.get(), k, 3), currentValue);
        }
    }
}

// ---------------------------------------------------------------------------
// Fetch batcheado de "valor actual" para evaluateRulesOnce() -- fix de N+1
// (severidad moderada: cada regla habilitada hacía su propio PQexecParams,
// O(reglas) round-trips por ciclo de 10s; con suficientes reglas el ciclo
// podía eventualmente superar su propio intervalo). Se agrupan las reglas
// por tipo de fuente (las mismas 4 ramas que ya existían) y se hace UNA
// consulta por grupo con `= ANY($N::tipo[])`, mismo patrón de literal de
// arreglo Postgres que ya usa `sensor_telemetry_wizard.cpp`
// (`toPgUuidArrayLiteral`/`toPgTextArrayLiteral`) -- duplicado acá porque
// ambos archivos están en namespaces anónimos distintos (sin linkage
// compartido entre translation units).
//
// A propósito, SOLO se batchea la LECTURA. `evaluateRuleAgainstValue` (el
// INSERT/UPDATE de `platform_alarms`, el debounce T5, la dedup vía
// `idx_alarms_one_open_per_rule`) sigue exactamente igual: secuencial, una
// llamada por regla, sin tocar -- es la parte correctness-sensitive de este
// código (falsos positivos/negativos en un contexto de seguridad minera),
// no vale el riesgo de reescribirla en la misma pasada que el batching de
// lectura.
std::string toPgUuidArrayLiteral(const std::vector<std::string> &ids) {
  std::string out = "{";
  bool first = true;
  for (const auto &id : ids) {
    if (id.empty()) continue;
    if (!first) out += ",";
    out += id;
    first = false;
  }
  out += "}";
  return out;
}

std::string toPgTextArrayLiteral(const std::vector<std::string> &vals) {
  std::string out = "{";
  bool first = true;
  for (const auto &v : vals) {
    if (!first) out += ",";
    out += '"';
    for (char c : v) {
      if (c == '"' || c == '\\') out += '\\';
      out += c;
    }
    out += '"';
    first = false;
  }
  out += "}";
  return out;
}

std::string toPgIntArrayLiteral(const std::vector<std::string> &vals) {
  std::string out = "{";
  bool first = true;
  for (const auto &v : vals) {
    if (v.empty()) continue;
    if (!first) out += ",";
    out += v;
    first = false;
  }
  out += "}";
  return out;
}

// Separador de la clave compuesta sensor_id+channel_code del mapa de
// canales de fórmula (ADR-189) -- '~' nunca aparece en un UUID ni en un
// channel_code (identificador simple [a-z0-9_]), mismo criterio que
// `sensor_telemetry_wizard.cpp::kChannelIdSep`.
constexpr char kFormulaChannelKeySep = '~';

/** @brief Camino de polling (red de seguridad + única vía para reglas de
 * `mining_sensor_id`, ver comentario de arriba). Ya no hace una query por
 * regla para el "valor actual" -- ver el bloque de helpers arriba: agrupa
 * las reglas por tipo de fuente y hace 4 queries como máximo por ciclo (una
 * por grupo no vacío), en vez de una por regla. */
void evaluateRulesOnce(PGconn *conn) {
  const std::vector<AlarmRuleRow> rules = getCachedEnabledRules(conn);
  const auto evalNow = std::chrono::steady_clock::now();
  if (rules.empty()) return;

  // --- Paso 1: clasificar las reglas habilitadas por tipo de fuente --
  //     misma clasificación que las 4 ramas que este loop tenía antes. ---
  std::vector<std::string> inactivitySensorIds;
  std::vector<std::string> formulaSensorIds, formulaChannelCodes;
  std::vector<std::string> rawSensorIds;
  std::vector<std::string> miningSensorIds;
  for (const auto &rule : rules) {
    if (rule.hasSensorId && rule.conditionType == "inactivity") {
      inactivitySensorIds.push_back(rule.sensorId);
    } else if (rule.hasSensorId && !rule.formulaOutputChannelCode.empty()) {
      formulaSensorIds.push_back(rule.sensorId);
      formulaChannelCodes.push_back(rule.formulaOutputChannelCode);
    } else if (rule.hasSensorId) {
      rawSensorIds.push_back(rule.sensorId);
    } else {
      miningSensorIds.push_back(rule.miningSensorId);
    }
  }

  // --- Paso 2: una consulta por grupo no vacío (en vez de una por regla).
  //     Mismas ventanas/condiciones/tablas que cada rama tenía antes de este
  //     cambio (ver ADR-193, ADR-189, ADR-131/ADR-186 respectivamente). ---
  std::unordered_map<std::string, double> inactivityBySensor;
  if (!inactivitySensorIds.empty()) {
    // ADR-193: no lee telemetría -- el valor es "segundos desde la última
    // vez que este sensor reportó" (sensors.last_seen_at).
    const std::string literal = toPgUuidArrayLiteral(inactivitySensorIds);
    const char *p[1] = {literal.c_str()};
    storage::PgResult vres{PQexecParams(
        conn,
        "SELECT sensor_id::text, EXTRACT(EPOCH FROM (NOW() - last_seen_at)) "
        "FROM sensors WHERE sensor_id = ANY($1::uuid[]) AND last_seen_at IS NOT NULL",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (vres.okTuples()) {
      for (int i = 0; i < PQntuples(vres.get()); ++i) {
        inactivityBySensor[PQgetvalue(vres.get(), i, 0)] = std::atof(PQgetvalue(vres.get(), i, 1));
      }
    }
  }

  std::unordered_map<std::string, double> formulaByKey;
  if (!formulaSensorIds.empty()) {
    // ADR-189: canal de SALIDA de fórmula (telemetry_multivariate), no
    // telemetría cruda -- mismo criterio de ventana de 15 min que el camino
    // crudo de abajo. `DISTINCT ON (sensor_id, channel_code)` + `ORDER BY
    // ... captured_at DESC` reproduce, por par, el `ORDER BY captured_at
    // DESC LIMIT 1` que cada regla hacía antes por su cuenta. El filtro
    // `sensor_id = ANY(...) AND channel_code = ANY(...)` puede traer algún
    // par sensor/canal de más (producto cruzado de los arreglos, no tuplas
    // exactas) si dos reglas distintas piden combinaciones distintas -- no
    // afecta la corrección: cada regla solo consulta su propia clave exacta
    // en `formulaByKey` abajo, una entrada de más simplemente no se usa.
    const std::string sensorLiteral = toPgUuidArrayLiteral(formulaSensorIds);
    const std::string channelLiteral = toPgTextArrayLiteral(formulaChannelCodes);
    const char *p[2] = {sensorLiteral.c_str(), channelLiteral.c_str()};
    storage::PgResult vres{PQexecParams(
        conn,
        "SELECT DISTINCT ON (sensor_id, channel_code) sensor_id::text, channel_code, value_numeric "
        "FROM telemetry_multivariate "
        "WHERE sensor_id = ANY($1::uuid[]) AND channel_code = ANY($2::text[]) "
        "AND captured_at > NOW() - INTERVAL '15 minutes' AND value_numeric IS NOT NULL "
        "ORDER BY sensor_id, channel_code, captured_at DESC",
        2, nullptr, p, nullptr, nullptr, 0)};
    if (vres.okTuples()) {
      for (int i = 0; i < PQntuples(vres.get()); ++i) {
        const std::string key = std::string(PQgetvalue(vres.get(), i, 0)) + kFormulaChannelKeySep +
                                 PQgetvalue(vres.get(), i, 1);
        formulaByKey[key] = std::atof(PQgetvalue(vres.get(), i, 2));
      }
    }
  }

  std::unordered_map<std::string, double> rawBySensor;
  if (!rawSensorIds.empty()) {
    // ADR-131/ADR-186: último valor vía telemetry_fact (dim_sensor resuelve
    // el UUID a sensor_id_sk), acotado a los últimos 15 minutos -- sin esa
    // cota, el planner de TimescaleDB debe considerar los ~10.900+ chunks
    // históricos (chunk_time_interval=1h) y la consulta no completa ni con
    // `statement_timeout` de 10s (ver ADR-186). `DISTINCT ON (ds.sensor_id)`
    // + `ORDER BY ds.sensor_id, tf.captured_at DESC` reproduce el mismo
    // `ORDER BY captured_at DESC LIMIT 1` de antes, por sensor.
    const std::string literal = toPgUuidArrayLiteral(rawSensorIds);
    const char *p[1] = {literal.c_str()};
    storage::PgResult vres{PQexecParams(
        conn,
        "SELECT DISTINCT ON (ds.sensor_id) ds.sensor_id::text, tf.value_numeric "
        "FROM telemetry_fact tf "
        "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
        "WHERE ds.sensor_id = ANY($1::uuid[]) AND tf.channel_id = 0 "
        "AND tf.captured_at > NOW() - INTERVAL '15 minutes' AND tf.value_numeric IS NOT NULL "
        "ORDER BY ds.sensor_id, tf.captured_at DESC",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (vres.okTuples()) {
      for (int i = 0; i < PQntuples(vres.get()); ++i) {
        rawBySensor[PQgetvalue(vres.get(), i, 0)] = std::atof(PQgetvalue(vres.get(), i, 1));
      }
    }
  }

  std::unordered_map<std::string, double> miningById;
  if (!miningSensorIds.empty()) {
    const std::string literal = toPgIntArrayLiteral(miningSensorIds);
    const char *p[1] = {literal.c_str()};
    storage::PgResult vres{PQexecParams(
        conn,
        "SELECT id::text, current_value FROM mining_sensors "
        "WHERE id = ANY($1::int[]) AND current_value IS NOT NULL",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (vres.okTuples()) {
      for (int i = 0; i < PQntuples(vres.get()); ++i) {
        miningById[PQgetvalue(vres.get(), i, 0)] = std::atof(PQgetvalue(vres.get(), i, 1));
      }
    }
  }

  // --- Paso 3: misma clasificación de Paso 1, ahora resolviendo el valor
  //     actual desde los mapas de arriba en vez de una query nueva. La
  //     evaluación en sí (evaluateRuleAgainstValue) no cambia. ---
  for (const auto &rule : rules) {
    bool hasValue = false;
    double currentValue = 0.0;

    if (rule.hasSensorId && rule.conditionType == "inactivity") {
      auto it = inactivityBySensor.find(rule.sensorId);
      if (it != inactivityBySensor.end()) { currentValue = it->second; hasValue = true; }
    } else if (rule.hasSensorId && !rule.formulaOutputChannelCode.empty()) {
      const std::string key = rule.sensorId + kFormulaChannelKeySep + rule.formulaOutputChannelCode;
      auto it = formulaByKey.find(key);
      if (it != formulaByKey.end()) { currentValue = it->second; hasValue = true; }
    } else if (rule.hasSensorId) {
      auto it = rawBySensor.find(rule.sensorId);
      if (it != rawBySensor.end()) { currentValue = it->second; hasValue = true; }
    } else {
      auto it = miningById.find(rule.miningSensorId);
      if (it != miningById.end()) { currentValue = it->second; hasValue = true; }
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
      // ADR-189: `row.value_numeric` es telemetría CRUDA de este lote
      // (channel_id=0) -- una regla con formula_output_channel_code evalúa
      // un valor CALCULADO por el motor de fórmulas (poller aparte, 10s),
      // nunca coincide con lo que llega acá. Esas reglas dependen
      // exclusivamente del polling periódico (evaluateRulesOnce), igual que
      // las de mining_sensor_id (ver comentario de cabecera de esta función).
      if (!rule.formulaOutputChannelCode.empty()) continue;
      // ADR-193: una regla 'inactivity' compara SEGUNDOS DE SILENCIO, nunca
      // el valor crudo entrante -- de hecho, que este batch exista ya prueba
      // que el sensor NO está inactivo ahora mismo. Sin este filtro,
      // row.value_numeric (una lectura real, p.ej. 42.5) se compararía por
      // error contra el umbral de inactividad como si fuera una duración de
      // silencio, pudiendo disparar o des-disparar la alarma con un dato que
      // no tiene ninguna relación con el significado real de la regla. Se
      // deja exclusivamente al polling (evaluateRulesOnce, que sí calcula
      // el silencio real vía sensors.last_seen_at) -- mismo criterio que la
      // rama de arriba.
      if (rule.conditionType == "inactivity") continue;
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

AlarmEngineStats &alarmEngineStats() {
  static AlarmEngineStats stats;
  return stats;
}

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
  // SPEC-027 (T5): ruta exacta distinta de "/api/mining/devices" (arriba) --
  // debe registrarse antes que nada que pudiera capturarla como prefijo; no
  // hay conflicto real porque el router matchea exact vs. prefix por
  // separado (ver router.hpp), pero se deja junto al resto de rutas de
  // /devices por legibilidad.
  r.get("/api/mining/devices/traceability", handleDeviceTraceability);
  r.put("/api/mining/devices/", handleUpdateDevice);
  // ADR-208: CRUD de zonas mineras (creación/edición/borrado); antes solo
  // se podía reasignar el zone_id de un sensor a una zona ya sembrada por
  // db_scripts/54 -- ver handleListZones/handleCreateZone/handleUpdateZone/
  // handleDeleteZone arriba.
  r.get("/api/mining/zones", handleListZones);
  r.post("/api/mining/zones", handleCreateZone);
  r.put("/api/mining/zones/", handleUpdateZone);
  r.del("/api/mining/zones/", handleDeleteZone);
  // POST .../{id} revoca; POST .../{id}/rotate-key emite una key nueva --
  // ambas resueltas dentro de handleRevokeDevice (ver comentario ahí), no
  // como dos rutas de prefijo separadas.
  r.post("/api/mining/devices/", handleRevokeDevice);
  r.post("/api/mining/telemetry", handleHttpTelemetry);
  // ADR-189: ingesta multicanal, exclusiva de sensores con
  // sensor_input_channel_def (ver handleHttpTelemetryMulti arriba).
  r.post("/api/mining/telemetry/multi", handleHttpTelemetryMulti);
  // Recalibración/reset remoto (pedido 2026-09-18), camino HTTP poll (el
  // smartphone de prueba y cualquier dispositivo protocol='http_push').
  r.get("/api/mining/telemetry/commands", handleGetPendingDeviceCommands);
  r.post("/api/mining/telemetry/commands/ack", handleAckDeviceCommand);
  // ADR-187: GET .../{id}/parameters|formulas|formula-results y
  // DELETE .../{id}/formulas/{id} -- únicos prefijos libres en
  // /api/mining/devices/ para esos verbos, registrados desde su propio
  // archivo (sensor_formula_routes.cpp) en vez de acá.
  registerFormulaRoutes(r);
  // ADR-189: catálogo de plantillas de fórmula de calibración geotécnica.
  registerFormulaTemplateRoutes(r);
  // ADR-188: catálogo gobernado de tipo de sensor -> parámetros habilitados.
  registerSensorTypeCatalogRoutes(r);
  // ADR-188: resolución de sesión servicio-a-servicio para formula_engine.
  registerInternalSessionRoutes(r);

  r.post("/api/mining/alarms/rules", handleCreateAlarmRule);
  r.get("/api/mining/alarms/rules", handleListAlarmRules);
  r.put("/api/mining/alarms/rules/", handleUpdateAlarmRule);
  r.del("/api/mining/alarms/rules/", handleDeleteAlarmRule);

  r.get("/api/mining/alarms", handleListAlarms);
  r.post("/api/mining/alarms/", handleAcknowledgeAlarm);
}

} // namespace mining_iot
