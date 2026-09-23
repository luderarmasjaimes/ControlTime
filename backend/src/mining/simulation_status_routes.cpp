#include "simulation_status_routes.hpp"
#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::safeStod;
using http_utils::safeStoi;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
// Lectura de estado de simulación (dashboard) -> réplica read-only, igual que
// sensor_service.cpp.
#define gReadUrl AppConfig::instance().readUrl()

namespace mining {

http::response<http::string_body>
handleGetSimulationLiveStatus(const http::request<http::string_body>& req,
                              const std::unordered_map<std::string, std::string>& query) {
  // --- SECURITY: mismo guard anti-IDOR que handleGetSensorData/
  //     handleGetTelemetrySummary (sensor_service.cpp) -- sesión obligatoria,
  //     tenant efectivo derivado de la sesión, un tenant_id de query distinto
  //     sólo se acepta si userBelongsToTenant lo autoriza. ---
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

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  const std::string tenantVal = effectiveTenant;
  const auto runScoped = [&](const std::string &q) -> PGresult * {
    const char *p[1] = {tenantVal.c_str()};
    return PQexecParams(conn, q.c_str(), 1, nullptr, p, nullptr, nullptr, 0);
  };

  // ADR-136: telemetry_fact/telemetry_fact_calc no tienen PK con
  // tenant_id_sk, se filtra vía JOIN a dim_tenant (mismo patrón que
  // sensor_service.cpp).
  //
  // ACTUALIZACIÓN 2026-09-13 -- la nota de performance original de este
  // comentario ("aceptable hoy... volumen muy por debajo de 25k/s") estaba
  // basada en una premisa incorrecta: el costo real de "COUNT(*) sin filtro
  // de tiempo sobre una hypertable" no lo determina el VOLUMEN de filas, lo
  // determina la CANTIDAD DE CHUNKS que el planner debe considerar -- y eso
  // depende de `chunk_time_interval` (1h aquí, ADR-131/db_scripts/74) por el
  // tiempo transcurrido, no de cuántas filas por segundo entran. Medido en
  // vivo hoy (no en un escenario futuro de 25k/s): con ~10.900 chunks
  // acumulados, el `ORDER BY captured_at DESC LIMIT 20` hermano de esta
  // consulta (`sqlRawLatest`, ver abajo) no completaba ni en 45s reales --
  // ya se corrigió acotándolo a 24h.
  //
  // ACTUALIZACIÓN (esta pasada) -- implementado el arreglo que quedaba
  // documentado como pendiente arriba: `count_total` ya NO escanea
  // `telemetry_fact` crudo, suma `telemetry_fact_hourly.sample_count`
  // (rollup por continuous aggregate, `db_scripts/76_telemetry_fact_
  // continuous_aggregates.sql`, mismo patrón que ya usaba `sensor_
  // service.cpp::handleGetTelemetrySummary` para `samples_window`) -- el
  // significado ("total histórico") no cambia, sólo la fuente. `count_last_
  // hour` pasa de un `FILTER` (que NO habilita constraint exclusion -- el
  // predicado de tiempo vive dentro del agregado, no en el `WHERE`, así que
  // igual escaneaba todos los chunks) a un `WHERE` real sobre `telemetry_
  // fact` crudo en un subquery aparte, acotado a la última hora -- ahora sí
  // excluye por constraint exclusion. No se puede resolver `count_last_hour`
  // contra el rollup: `add_continuous_aggregate_policy` tiene `end_offset =>
  // INTERVAL '1 hour'`, así que la hora más reciente típicamente NO está
  // materializada todavía cuando este endpoint se consulta -- usar el
  // rollup ahí daría un `count_last_hour` incorrecto (subcontado), no sólo
  // impreciso.
  //
  // Trade-off a vigilar (no verificado en vivo en esta pasada):
  // `telemetry_fact_hourly` materializa en background con `end_offset =>
  // INTERVAL '1 hour'` (`db_scripts/76`), así que la última hora de datos no
  // está materializada todavía por la policy. Ningún script de este repo
  // fija `materialized_only` al crear la vista, así que queda en su default
  // de TimescaleDB (`false`, agregación en tiempo real activada) -- eso
  // significa que consultar `telemetry_fact_hourly` normalmente combina lo
  // ya materializado con un agregado en vivo sobre el tramo reciente sin
  // materializar, así que `count_total` no debería tener el hueco de ~1h
  // que tendría si `materialized_only=true`. No se confirmó contra la BD
  // real en esta pasada (ver ADR-186 para el estándar de verificación en
  // vivo que sí se aplicó a los otros 3 fixes de esa ADR) -- si en el futuro
  // se nota un `count_total` corto, revisar primero si algo cambió ese
  // default antes de sospechar de esta query.
  const std::string sqlRawCounts =
      "SELECT "
      "  (SELECT COALESCE(SUM(tfh.sample_count), 0)::bigint FROM telemetry_fact_hourly tfh "
      "   JOIN dim_tenant dt2 ON dt2.tenant_id_sk = tfh.tenant_id_sk "
      "   WHERE dt2.tenant_id = $1::uuid) AS count_total, "
      "  (SELECT COUNT(*) FROM telemetry_fact tf "
      "   JOIN dim_tenant dt3 ON dt3.tenant_id_sk = tf.tenant_id_sk "
      "   WHERE dt3.tenant_id = $1::uuid "
      "   AND tf.captured_at > NOW() - INTERVAL '1 hour') AS count_last_hour";

  // Bug real encontrado y corregido 2026-09-13 (mismo hallazgo que
  // device_alarm_routes.cpp::evaluateRulesOnce y
  // sensor_service.cpp::handleGetTelemetrySummary): sin cota de tiempo, este
  // `ORDER BY captured_at DESC LIMIT 20` obliga al planner a considerar los
  // ~10.900 chunks históricos de `telemetry_fact` (chunk_time_interval=1h).
  // Acotado a 24h (igual que el fix de sensor_service.cpp), sigue mostrando
  // las lecturas más recientes reales -- que es lo que un panel de "estado
  // en vivo" necesita -- sin escanear el historial completo.
  const std::string sqlRawLatest =
      "SELECT ds.sensor_code, ds.sensor_type, tf.value_numeric, tf.captured_at::text "
      "FROM telemetry_fact tf "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tf.tenant_id_sk "
      "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
      "WHERE dt.tenant_id = $1::uuid AND tf.captured_at > NOW() - INTERVAL '24 hours' "
      "ORDER BY tf.captured_at DESC LIMIT 20";

  // Mismo patrón de bug que sqlRawCounts (arriba) -- `telemetry_fact_calc`
  // también tiene chunk_time_interval=1h (db_scripts/87_telemetry_fact_
  // calc.sql) y el mismo `FILTER` (no `WHERE`) para `count_last_hour`, que
  // tampoco habilitaba constraint exclusion. A diferencia de `telemetry_
  // fact`, acá NO existe un rollup horario equivalente a `telemetry_fact_
  // hourly` (verificado: `grep -rn telemetry_fact_calc db_scripts/` sólo
  // devuelve `87_telemetry_fact_calc.sql`, que crea la hypertable cruda, sin
  // ningún `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)`
  // sobre ella) -- consistente con su propio comentario de diseño ("volumen
  // bajo/derivado, por eso SIN retention agresiva"), no se justificó nunca
  // un continuous aggregate para esta tabla. Sin rollup que sumar, se acota
  // `count_total` a 24h (mismo criterio que `sqlCalcLatest`/`sqlRawLatest`
  // de este archivo) en vez de dejarlo sin cota -- a diferencia de `sqlRaw
  // Counts`, esto SÍ cambia el significado de "total histórico" a "últimas
  // 24h" para esta tabla en particular (trade-off documentado, no
  // silencioso: es la opción que da la ADR-186 para cuando no hay rollup
  // disponible).
  const std::string sqlCalcCounts =
      "SELECT "
      "  (SELECT COUNT(*) FROM telemetry_fact_calc tfc "
      "   JOIN dim_tenant dt2 ON dt2.tenant_id_sk = tfc.tenant_id_sk "
      "   WHERE dt2.tenant_id = $1::uuid "
      "   AND tfc.captured_at > NOW() - INTERVAL '24 hours') AS count_total, "
      "  (SELECT COUNT(*) FROM telemetry_fact_calc tfc "
      "   JOIN dim_tenant dt3 ON dt3.tenant_id_sk = tfc.tenant_id_sk "
      "   WHERE dt3.tenant_id = $1::uuid "
      "   AND tfc.captured_at > NOW() - INTERVAL '1 hour') AS count_last_hour";

  // Mismo fix que sqlRawLatest arriba -- telemetry_fact_calc también tiene
  // chunk_time_interval=1h (db_scripts/87_telemetry_fact_calc.sql).
  const std::string sqlCalcLatest =
      "SELECT ds.sensor_code, tfc.metric_code, tfc.value_numeric, tfc.alert_level, tfc.captured_at::text "
      "FROM telemetry_fact_calc tfc "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tfc.tenant_id_sk "
      "JOIN dim_sensor ds ON ds.sensor_id_sk = tfc.sensor_id_sk "
      "WHERE dt.tenant_id = $1::uuid AND tfc.captured_at > NOW() - INTERVAL '24 hours' "
      "ORDER BY tfc.captured_at DESC LIMIT 20";

  json::object raw;
  {
    storage::PgResult resCounts{runScoped(sqlRawCounts)};
    int countTotal = 0, countLastHour = 0;
    if (resCounts.okTuples() && PQntuples(resCounts.get()) > 0) {
      countTotal = safeStoi(PQgetvalue(resCounts.get(), 0, 0));
      countLastHour = safeStoi(PQgetvalue(resCounts.get(), 0, 1));
    }
    raw["count_total"] = countTotal;
    raw["count_last_hour"] = countLastHour;

    storage::PgResult resLatest{runScoped(sqlRawLatest)};
    json::array latest;
    if (resLatest.okTuples()) {
      for (int i = 0; i < PQntuples(resLatest.get()); ++i) {
        json::object row{
            {"sensor_code", PQgetvalue(resLatest.get(), i, 0)},
            {"sensor_type", PQgetvalue(resLatest.get(), i, 1)},
            {"captured_at", PQgetvalue(resLatest.get(), i, 3)}};
        if (!PQgetisnull(resLatest.get(), i, 2)) {
          row["value_numeric"] = safeStod(PQgetvalue(resLatest.get(), i, 2));
        }
        latest.push_back(row);
      }
    }
    raw["latest"] = latest;
  }

  json::object calc;
  {
    storage::PgResult resCounts{runScoped(sqlCalcCounts)};
    int countTotal = 0, countLastHour = 0;
    if (resCounts.okTuples() && PQntuples(resCounts.get()) > 0) {
      countTotal = safeStoi(PQgetvalue(resCounts.get(), 0, 0));
      countLastHour = safeStoi(PQgetvalue(resCounts.get(), 0, 1));
    }
    calc["count_total"] = countTotal;
    calc["count_last_hour"] = countLastHour;

    storage::PgResult resLatest{runScoped(sqlCalcLatest)};
    json::array latest;
    if (resLatest.okTuples()) {
      for (int i = 0; i < PQntuples(resLatest.get()); ++i) {
        json::object row{
            {"sensor_code", PQgetvalue(resLatest.get(), i, 0)},
            {"metric_code", PQgetvalue(resLatest.get(), i, 1)},
            {"alert_level", PQgetvalue(resLatest.get(), i, 3)},
            {"captured_at", PQgetvalue(resLatest.get(), i, 4)}};
        if (!PQgetisnull(resLatest.get(), i, 2)) {
          row["value_numeric"] = safeStod(PQgetvalue(resLatest.get(), i, 2));
        }
        latest.push_back(row);
      }
    }
    calc["latest"] = latest;
  }

  json::object data{
      {"tenant_id", effectiveTenant},
      {"generated_at", http_utils::nowIso8601()},
      {"raw", raw},
      {"calc", calc}};

  return makeJsonResponse(http::status::ok, data);
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
