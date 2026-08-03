#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/permissions.hpp"

#include <mutex>
#include <optional>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
// safeStod/safeStoi promovidos a http_utils (compartidos con surveillance_service.cpp
// y cualquier otro archivo que parsee columnas Postgres nullable) — antes vivían
// duplicados aquí en un namespace anónimo.
using http_utils::safeStod;
using http_utils::safeStoi;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl
// Lecturas de sensores (dashboard) → réplica read-only si está configurada.
#define gReadUrl         AppConfig::instance().readUrl()

namespace mining {

namespace {
/**
 * Resuelve el tenant efectivo de una lectura de sensores/telemetría a prueba
 * de IDOR — mismo criterio que resolveAllowedReportTenant (report_routes.cpp)
 * y que surveillance_service.cpp. Auditoría de seguridad 2026-07-19:
 * `handleGetSensorData` y `handleGetTelemetrySummary` (a) devolvían datos
 * GLOBALES sin scope cuando la petición no traía `tenant_id` (fuga del
 * inventario de sensores de TODOS los tenants a cualquiera con sesión, o
 * incluso sin ella en el caso de sensors/data), y (b) confiaban ciegamente
 * en el `tenant_id` del cliente sin verificar que perteneciera a la sesión
 * (IDOR horizontal: un usuario del tenant A podía pedir `?tenant_id=<B>` y
 * leer los sensores del tenant B). El tenant efectivo SIEMPRE se deriva de
 * la sesión; solo se acepta un tenant distinto si `userBelongsToTenant` lo
 * autoriza (rol admin multi-tenant). `ok=false` → 403.
 */
std::string resolveAllowedSensorTenant(
    const auth::AuthSession &session,
    const std::unordered_map<std::string, std::string> &query, bool &ok) {
  ok = true;
  auto it = query.find("tenant_id");
  if (it == query.end() || it->second.empty() || it->second == session.tenantId) {
    return session.tenantId;
  }
  if (auth::userBelongsToTenant(session.userId, session.tenantId, it->second)) {
    return it->second;
  }
  ok = false;
  return session.tenantId;
}
}  // namespace

http::response<http::string_body>
handleGetSensorData(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
  // --- SECURITY (auditoría 2026-07-19): sesión OBLIGATORIA + scope por
  //     tenant de la sesión (a prueba de IDOR) ---
  // Antes: sin `tenant_id` en query se devolvía el inventario GLOBAL de
  // sensores de todos los tenants SIN pedir siquiera sesión; y con
  // `tenant_id` solo se comprobaba que existiera una sesión, no que ese
  // tenant perteneciera a ella (IDOR horizontal). Ahora se exige sesión
  // siempre y el tenant efectivo se deriva de la sesión (ver
  // resolveAllowedSensorTenant) — nunca hay lectura global.
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }
  // --- END SECURITY ---

  json::object data;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    // Lectura de sensores para dashboard → pool de RÉPLICA (offload primario).
    auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      // El scope SIEMPRE está activo con el tenant efectivo de la sesión —
      // las ramas "global" (sin filtro) del código previo quedan muertas.
      const bool scoped = true;
      const std::string tenantVal = effectiveTenant;
      const std::string scopeWhere = " AND s.tenant_id = $1::uuid ";
      // Ejecuta una query pasando el tenant como $1 (siempre scoped ahora).
      const auto runScoped = [&](const std::string &q) -> PGresult * {
        const char *p[1] = {tenantVal.c_str()};
        return PQexecParams(conn, q.c_str(), 1, nullptr, p, nullptr, nullptr, 0);
      };
      (void)scoped;

      const std::string sqlCategories =
          scoped ? ("SELECT DISTINCT c.id, c.name, c.description FROM mining_sensor_categories c "
                    "INNER JOIN mining_sensor_types t ON t.category_id = c.id "
                    "INNER JOIN mining_sensors s ON s.type_id = t.id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY c.id ASC")
                 : "SELECT id, name, description FROM mining_sensor_categories ORDER BY id ASC";
      const std::string sqlTypes =
          scoped ? ("SELECT DISTINCT t.id, t.category_id, t.name, t.unit FROM mining_sensor_types t "
                    "INNER JOIN mining_sensors s ON s.type_id = t.id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY t.id ASC")
                 : "SELECT id, category_id, name, unit FROM mining_sensor_types ORDER BY id ASC";
      const std::string sqlSensors =
          scoped ? ("SELECT s.id, s.type_id, s.name, s.lat, s.lng, s.status, s.current_value, "
                    "s.tenant_id::text AS tenant_id_txt, "
                    "z.id AS zone_pk, z.code AS zone_code, z.name_es AS zone_name_es "
                    "FROM mining_sensors s "
                    "LEFT JOIN mining_sensor_zones z ON z.id = s.zone_id AND "
                    "z.tenant_id = s.tenant_id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY s.id ASC")
                 : "SELECT s.id, s.type_id, s.name, s.lat, s.lng, s.status, s.current_value, "
                   "s.tenant_id::text AS tenant_id_txt, "
                   "z.id AS zone_pk, z.code AS zone_code, z.name_es AS zone_name_es "
                   "FROM mining_sensors s "
                   "LEFT JOIN mining_sensor_zones z ON z.id = s.zone_id AND "
                   "z.tenant_id = s.tenant_id "
                   "ORDER BY s.id ASC";
      const std::string sqlHistory =
          scoped ? ("SELECT h.sensor_id, h.value, h.timestamp FROM mining_sensor_history h "
                    "INNER JOIN mining_sensors s ON s.id = h.sensor_id "
                    "WHERE h.timestamp > NOW() - INTERVAL '7 DAYS' " +
                    scopeWhere + "ORDER BY h.sensor_id ASC, h.timestamp ASC")
                 : "SELECT sensor_id, value, timestamp FROM mining_sensor_history WHERE timestamp > "
                   "NOW() - INTERVAL '7 DAYS' ORDER BY sensor_id ASC, timestamp ASC";

      storage::PgResult res_cat{runScoped(sqlCategories)};
      json::array categories;
      if (res_cat.okTuples()) {
        for (int i = 0; i < PQntuples(res_cat.get()); ++i) {
          categories.push_back(json::object{{"id", safeStoi(PQgetvalue(res_cat.get(), i, 0))},
                                            {"name", PQgetvalue(res_cat.get(), i, 1)},
                                            {"description", PQgetvalue(res_cat.get(), i, 2)}});
        }
      }
      data["categories"] = categories;

      const std::string sqlZones =
          scoped ? ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "WHERE tenant_id = $1::uuid ORDER BY sort_order ASC, id ASC")
                 : ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "ORDER BY tenant_id ASC, sort_order ASC, id ASC");
      storage::PgResult res_zones{runScoped(sqlZones)};
      json::array zones;
      if (res_zones.okTuples()) {
        for (int zi = 0; zi < PQntuples(res_zones.get()); ++zi) {
          zones.push_back(json::object{{"id", safeStoi(PQgetvalue(res_zones.get(), zi, 0))},
                                        {"code", PQgetvalue(res_zones.get(), zi, 1)},
                                        {"name_es", PQgetvalue(res_zones.get(), zi, 2)},
                                        {"sort_order", safeStoi(PQgetvalue(res_zones.get(), zi, 3))},
                                        {"tenant_id", PQgetvalue(res_zones.get(), zi, 4)}});
        }
      }
      data["zones"] = zones;

      storage::PgResult res_types{runScoped(sqlTypes)};
      json::array sensor_types;
      if (res_types.okTuples()) {
        for (int i = 0; i < PQntuples(res_types.get()); ++i) {
          sensor_types.push_back(
              json::object{{"id", safeStoi(PQgetvalue(res_types.get(), i, 0))},
                           {"category_id", safeStoi(PQgetvalue(res_types.get(), i, 1))},
                           {"name", PQgetvalue(res_types.get(), i, 2)},
                           {"unit", PQgetvalue(res_types.get(), i, 3)}});
        }
      }
      data["sensor_types"] = sensor_types;

      storage::PgResult res_sensors{runScoped(sqlSensors)};
      json::array sensors;
      if (res_sensors.okTuples()) {
        for (int i = 0; i < PQntuples(res_sensors.get()); ++i) {
          json::object so{{"id", safeStoi(PQgetvalue(res_sensors.get(), i, 0))},
                          {"type_id", safeStoi(PQgetvalue(res_sensors.get(), i, 1))},
                          {"name", PQgetvalue(res_sensors.get(), i, 2)},
                          {"lat", safeStod(PQgetvalue(res_sensors.get(), i, 3))},
                          {"lng", safeStod(PQgetvalue(res_sensors.get(), i, 4))},
                          {"status", PQgetvalue(res_sensors.get(), i, 5)},
                          {"current_value", safeStod(PQgetvalue(res_sensors.get(), i, 6))},
                          {"tenant_id", PQgetvalue(res_sensors.get(), i, 7)}};
          if (!PQgetisnull(res_sensors.get(), i, 8)) {
            so["zone_id"] = safeStoi(PQgetvalue(res_sensors.get(), i, 8));
            so["zone_code"] = std::string(PQgetvalue(res_sensors.get(), i, 9));
            so["zone_name"] = std::string(PQgetvalue(res_sensors.get(), i, 10));
          }
          sensors.push_back(so);
        }
      }
      data["sensors"] = sensors;

      storage::PgResult res_history{runScoped(sqlHistory)};
      json::array history;
      if (res_history.okTuples()) {
        for (int i = 0; i < PQntuples(res_history.get()); ++i) {
          history.push_back(json::object{
              {"sensor_id", safeStoi(PQgetvalue(res_history.get(), i, 0))},
              {"value", safeStod(PQgetvalue(res_history.get(), i, 1))},
              {"timestamp", PQgetvalue(res_history.get(), i, 2)}});
        }
      }
      data["history"] = history;

      return makeJsonResponse(http::status::ok, data);
    }
#endif
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
}

http::response<http::string_body>
handleGetTelemetrySummary(const http::request<http::string_body>& req,
                          const std::unordered_map<std::string, std::string>& query) {
  // Mismo blindaje IDOR que handleGetSensorData (auditoría 2026-07-19):
  // sesión OBLIGATORIA y tenant efectivo derivado de la sesión — nunca
  // lectura global ni tenant tomado a ciegas del cliente.
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  // Ventana de la serie/conteo en horas: default 7 días. `telemetry_raw`
  // tiene decenas de millones de filas — todas las consultas van dirigidas
  // por sensor vía idx_telemetry_sensor_time (sensor_id, captured_at DESC),
  // nunca por un scan del rango temporal completo.
  int windowHours = 168;
  const auto itHours = query.find("hours");
  if (itHours != query.end()) {
    const int parsed = safeStoi(itHours->second.c_str());
    if (parsed >= 1 && parsed <= 720) windowHours = parsed;
  }
  const std::string windowLit = std::to_string(windowHours);

  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      const std::string tenantVal = effectiveTenant;
      const std::string scopeWhere = " AND s.tenant_id = $1::uuid ";
      const auto runScoped = [&](const std::string &q) -> PGresult * {
        const char *p[1] = {tenantVal.c_str()};
        return PQexecParams(conn, q.c_str(), 1, nullptr, p, nullptr, nullptr, 0);
      };

      // Un renglón por sensor IoT activo: metadatos + última lectura (LATERAL
      // con LIMIT 1 sobre el índice por sensor) + muestras dentro de la
      // ventana. Se excluyen los sensores de prueba de carga (load_test) —
      // ruido del stress test ADR-054, no instrumentación real.
      const std::string sqlSensors =
          "SELECT s.sensor_id::text, s.sensor_code, s.sensor_name, s.sensor_type, "
          "COALESCE(s.unit,'') AS unit, s.protocol, s.connection_status, "
          "COALESCE(s.external_id,'') AS external_id, "
          "last.v AS last_value, COALESCE(last.at::text,'') AS last_at, "
          "COALESCE(win.n,0) AS samples_window "
          "FROM sensors s "
          "LEFT JOIN LATERAL (SELECT tr.value_numeric AS v, tr.captured_at AS at "
          "  FROM telemetry_raw tr WHERE tr.sensor_id = s.sensor_id "
          "  ORDER BY tr.captured_at DESC LIMIT 1) last ON true "
          "LEFT JOIN LATERAL (SELECT COUNT(*) AS n FROM telemetry_raw tr "
          "  WHERE tr.sensor_id = s.sensor_id AND tr.captured_at > NOW() - INTERVAL '" + windowLit + " hours') win ON true "
          "WHERE s.is_active AND s.sensor_type <> 'load_test'" + scopeWhere +
          " ORDER BY s.sensor_type ASC, s.sensor_code ASC";

      storage::PgResult resSensors{runScoped(sqlSensors)};
      json::array sensors;
      if (resSensors.okTuples()) {
        for (int i = 0; i < PQntuples(resSensors.get()); ++i) {
          json::object so{
              {"id", PQgetvalue(resSensors.get(), i, 0)},
              {"code", PQgetvalue(resSensors.get(), i, 1)},
              {"name", PQgetvalue(resSensors.get(), i, 2)},
              {"type", PQgetvalue(resSensors.get(), i, 3)},
              {"unit", PQgetvalue(resSensors.get(), i, 4)},
              {"protocol", PQgetvalue(resSensors.get(), i, 5)},
              {"connection_status", PQgetvalue(resSensors.get(), i, 6)},
              {"external_id", PQgetvalue(resSensors.get(), i, 7)},
              {"last_at", PQgetvalue(resSensors.get(), i, 9)},
              {"samples_window", safeStoi(PQgetvalue(resSensors.get(), i, 10))}};
          if (!PQgetisnull(resSensors.get(), i, 8)) {
            so["last_value"] = safeStod(PQgetvalue(resSensors.get(), i, 8));
          }
          sensors.push_back(so);
        }
      }

      // Serie horaria promedio por sensor dentro de la ventana — dirigida
      // por la lista de sensores (nestloop sobre el índice por sensor), no
      // por un filtro temporal suelto que barrería toda la hypertable.
      const std::string sqlSeries =
          "SELECT s.sensor_id::text, date_trunc('hour', tr.captured_at)::text AS h, "
          "AVG(tr.value_numeric) AS v "
          "FROM sensors s JOIN telemetry_raw tr ON tr.sensor_id = s.sensor_id "
          "WHERE s.is_active AND s.sensor_type <> 'load_test' "
          "AND tr.captured_at > NOW() - INTERVAL '" + windowLit + " hours'" + scopeWhere +
          " GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC";

      storage::PgResult resSeries{runScoped(sqlSeries)};
      json::array series;
      if (resSeries.okTuples()) {
        for (int i = 0; i < PQntuples(resSeries.get()); ++i) {
          series.push_back(json::object{
              {"sensor_id", PQgetvalue(resSeries.get(), i, 0)},
              {"t", PQgetvalue(resSeries.get(), i, 1)},
              {"v", safeStod(PQgetvalue(resSeries.get(), i, 2))}});
        }
      }

      return makeJsonResponse(http::status::ok,
                              json::object{{"sensors", sensors},
                                           {"series", series},
                                           {"window_hours", windowHours}});
    }
#endif
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
}

} // namespace mining
