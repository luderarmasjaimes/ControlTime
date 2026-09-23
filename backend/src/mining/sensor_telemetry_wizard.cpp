#include "sensor_telemetry_wizard.hpp"
#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <algorithm>
#include <cctype>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// HAS_LIBPQ no se propaga entre translation units (se define localmente por
// archivo, ver el mismo bloque en auth_storage_pg.hpp / device_alarm_routes.cpp).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::safeStod;
using http_utils::safeStoi;
using http_utils::splitCsvLower;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gReadUrl         AppConfig::instance().readUrl()

namespace mining {

namespace {

// Construye el literal de arreglo Postgres `{a,b,c}` a partir de una lista
// de UUIDs ya validados con formato básico (36 chars, hex + guiones) —
// valores que no calzan ese formato se descartan en vez de romper el
// literal (nunca se concatenan directo en el SQL: solo entran como texto
// de un único bind param `$N::uuid[]`, así que no hay superficie de
// inyección, pero sí queremos evitar que un valor absurdo tumbe la query
// entera con un error de cast).
bool looksLikeUuid(const std::string &s) {
  if (s.size() != 36) return false;
  for (size_t i = 0; i < s.size(); ++i) {
    const char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
      return false;
    }
  }
  return true;
}

std::string toPgUuidArrayLiteral(const std::vector<std::string> &ids) {
  std::string out = "{";
  bool first = true;
  for (const auto &id : ids) {
    if (!looksLikeUuid(id)) continue;
    if (!first) out += ",";
    out += id;
    first = false;
  }
  out += "}";
  return out;
}

// Postgres `{"a","b"}` para un `text[]` -- a diferencia de
// toPgUuidArrayLiteral, acá los valores SÍ pueden traer prácticamente
// cualquier caracter (id compuesto "sensor_id~channel_code"), así que cada
// elemento va entre comillas dobles con `"`/`\` escapados, en vez de
// confiar en que nunca aparezca una coma o llave suelta.
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

// Separador de un id "virtual" sensor+canal (p.ej. "sensor-uuid~accel_x")
// para exponer sensores multivariados (ADR-189: acelerógrafo triaxial,
// GNSS, etc.) como una fila SELECCIONABLE por canal en el wizard de
// reportes -- en vez de un único checkbox por sensor físico que solo puede
// mostrar UNA serie (ver el fallback de telemetry_multivariate más abajo).
// '~' nunca aparece en un UUID ni en un channel_code (identificador simple
// [a-z0-9_]), así que partir por la primera ocurrencia es inambiguo.
constexpr char kChannelIdSep = '~';

// Unidad razonable para un canal crudo sin unidad propia en el esquema
// (sensor_input_channel_def no tiene columna `unit`) -- se deriva del
// prefijo del channel_code, cayendo a la unidad del sensor físico si no
// matchea ningún prefijo conocido.
std::string unitForRawChannel(const std::string &channelCode, const std::string &sensorUnit) {
  if (channelCode.rfind("accel_", 0) == 0) return sensorUnit.empty() ? "g" : sensorUnit;
  if (channelCode.rfind("gps_", 0) == 0) return "°";
  return sensorUnit;
}

}  // namespace

http::response<http::string_body>
handleGetTelemetryWizardCatalog(const http::request<http::string_body>& req,
                                const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  std::string sensorTypeFilter;
  const auto itType = query.find("sensor_type");
  if (itType != query.end()) sensorTypeFilter = itType->second;

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // --- Paso 1 del wizard: tipos de sensor disponibles para el tenant ---
  const std::string sqlTypes =
      "SELECT sensor_type, COALESCE(unit,'') AS unit, COUNT(*) AS n "
      "FROM sensors "
      "WHERE tenant_id = $1::uuid AND is_active AND sensor_type <> 'load_test' "
      "GROUP BY sensor_type, unit ORDER BY sensor_type ASC, unit ASC";
  {
    const char *p[1] = {effectiveTenant.c_str()};
    storage::PgResult res{PQexecParams(conn, sqlTypes.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
    }
    json::array sensorTypes;
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      sensorTypes.push_back(json::object{
          {"type", PQgetvalue(res.get(), i, 0)},
          {"unit", PQgetvalue(res.get(), i, 1)},
          {"count", safeStoi(PQgetvalue(res.get(), i, 2))}});
    }

    // --- Zonas geográficas del tenant (db_scripts/54) ---
    const std::string sqlZones =
        "SELECT zone_id, code, name_es, sort_order FROM sensor_zones "
        "WHERE tenant_id = $1::uuid ORDER BY sort_order ASC, zone_id ASC";
    storage::PgResult resZones{PQexecParams(conn, sqlZones.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
    json::array zones;
    if (resZones.okTuples()) {
      for (int i = 0; i < PQntuples(resZones.get()); ++i) {
        zones.push_back(json::object{
            {"id", safeStoi(PQgetvalue(resZones.get(), i, 0))},
            {"code", PQgetvalue(resZones.get(), i, 1)},
            {"name_es", PQgetvalue(resZones.get(), i, 2)},
            {"sort_order", safeStoi(PQgetvalue(resZones.get(), i, 3))}});
      }
    }

    json::array sensorsArr;
    // --- Paso 2/3: sensores del tipo elegido, agrupados por zona +
    //     device_key (dispositivo físico) para el árbol zona→dispositivo→unidad.
    if (!sensorTypeFilter.empty()) {
      const std::string sqlSensors =
          "SELECT s.sensor_id::text, s.sensor_code, s.sensor_name, s.sensor_type, "
          "COALESCE(s.unit,'') AS unit, s.zone_id, COALESCE(z.code,''), COALESCE(z.name_es,''), "
          "COALESCE(NULLIF(s.serial_number,''), NULLIF(s.external_id,''), s.sensor_code) AS device_key, "
          "s.lat, s.lng, COALESCE(s.connection_status,'') "
          "FROM sensors s "
          "LEFT JOIN sensor_zones z ON z.zone_id = s.zone_id "
          "WHERE s.tenant_id = $1::uuid AND s.is_active AND s.sensor_type = $2 "
          "ORDER BY z.sort_order ASC NULLS LAST, device_key ASC, s.sensor_code ASC";
      const char *ps[2] = {effectiveTenant.c_str(), sensorTypeFilter.c_str()};
      storage::PgResult resSensors{
          PQexecParams(conn, sqlSensors.c_str(), 2, nullptr, ps, nullptr, nullptr, 0)};
      if (resSensors.okTuples()) {
        const int nSensors = PQntuples(resSensors.get());
        std::vector<std::string> sensorIds;
        sensorIds.reserve(static_cast<std::size_t>(nSensors));
        for (int i = 0; i < nSensors; ++i) sensorIds.push_back(PQgetvalue(resSensors.get(), i, 0));
        const std::string sensorIdsLiteral = toPgUuidArrayLiteral(sensorIds);

        // ADR-189: sensores multivariados (acelerógrafo triaxial, GNSS,
        // etc.) declaran sus canales crudos en sensor_input_channel_def y
        // su(s) métrica(s) calculada(s) en sensor_formula_def -- un único
        // checkbox de "sensor físico" en el wizard solo puede mostrar UNA
        // serie (ver el fallback de telemetry_multivariate en
        // handleQueryTelemetrySeries), así que estos sensores se expanden
        // acá en una fila SELECCIONABLE POR CANAL (id compuesto
        // "sensor_id~channel_code"). Una sola consulta batched para
        // TODOS los sensores de este tipo, no una por fila -- evita N+1.
        std::unordered_map<std::string, std::vector<std::string>> rawChannelsBySensor;
        if (sensorIdsLiteral != "{}") {
          const char *pc[1] = {sensorIdsLiteral.c_str()};
          storage::PgResult resChan{PQexecParams(
              conn,
              "SELECT sensor_id::text, channel_code FROM sensor_input_channel_def "
              "WHERE sensor_id = ANY($1::uuid[]) ORDER BY sensor_id, sort_order",
              1, nullptr, pc, nullptr, nullptr, 0)};
          if (resChan.okTuples()) {
            for (int i = 0; i < PQntuples(resChan.get()); ++i) {
              rawChannelsBySensor[PQgetvalue(resChan.get(), i, 0)].push_back(
                  PQgetvalue(resChan.get(), i, 1));
            }
          }
        }
        std::unordered_map<std::string, std::vector<std::string>> formulaChannelsBySensor;
        if (sensorIdsLiteral != "{}") {
          const char *pf[1] = {sensorIdsLiteral.c_str()};
          storage::PgResult resFormula{PQexecParams(
              conn,
              "SELECT sensor_id::text, output_channel_code FROM sensor_formula_def "
              "WHERE sensor_id = ANY($1::uuid[]) AND enabled ORDER BY sensor_id, formula_id",
              1, nullptr, pf, nullptr, nullptr, 0)};
          if (resFormula.okTuples()) {
            for (int i = 0; i < PQntuples(resFormula.get()); ++i) {
              formulaChannelsBySensor[PQgetvalue(resFormula.get(), i, 0)].push_back(
                  PQgetvalue(resFormula.get(), i, 1));
            }
          }
        }

        for (int i = 0; i < nSensors; ++i) {
          const std::string sensorId = PQgetvalue(resSensors.get(), i, 0);
          const std::string sensorCode = PQgetvalue(resSensors.get(), i, 1);
          const std::string sensorName = PQgetvalue(resSensors.get(), i, 2);
          const std::string sensorUnit = PQgetvalue(resSensors.get(), i, 4);
          json::object base{
              {"type", PQgetvalue(resSensors.get(), i, 3)},
              {"zone_code", PQgetvalue(resSensors.get(), i, 6)},
              {"zone_name", PQgetvalue(resSensors.get(), i, 7)},
              {"device_key", PQgetvalue(resSensors.get(), i, 8)},
              {"connection_status", PQgetvalue(resSensors.get(), i, 11)}};
          if (!PQgetisnull(resSensors.get(), i, 5)) {
            base["zone_id"] = safeStoi(PQgetvalue(resSensors.get(), i, 5));
          }
          if (!PQgetisnull(resSensors.get(), i, 9)) base["lat"] = safeStod(PQgetvalue(resSensors.get(), i, 9));
          if (!PQgetisnull(resSensors.get(), i, 10)) base["lng"] = safeStod(PQgetvalue(resSensors.get(), i, 10));

          const auto rawIt = rawChannelsBySensor.find(sensorId);
          const auto formIt = formulaChannelsBySensor.find(sensorId);
          const bool hasRaw = rawIt != rawChannelsBySensor.end() && !rawIt->second.empty();
          const bool hasFormula = formIt != formulaChannelsBySensor.end() && !formIt->second.empty();
          if (!hasRaw && !hasFormula) {
            json::object so = base;
            so["id"] = sensorId;
            so["code"] = sensorCode;
            so["name"] = sensorName;
            so["unit"] = sensorUnit;
            sensorsArr.push_back(std::move(so));
            continue;
          }
          if (hasRaw) {
            for (const auto &chan : rawIt->second) {
              json::object so = base;
              so["id"] = sensorId + kChannelIdSep + chan;
              so["code"] = sensorCode + " · " + chan;
              so["name"] = sensorName + " · " + chan;
              so["unit"] = unitForRawChannel(chan, sensorUnit);
              // ZoneSensorPicker.tsx muestra `s.type` como etiqueta de la
              // fila hoja cuando un mismo device_key agrupa varias filas
              // (pensado originalmente para un dispositivo físico con
              // varios `sensors.sensor_type` distintos) -- acá TODAS las
              // filas virtuales de un mismo sensor comparten el mismo
              // sensor_type real ("accelerograph"), así que se sobreescribe
              // con el nombre del canal para que la fila sea distinguible
              // ("accel_x" en vez de "accelerograph" repetido 6 veces).
              so["type"] = chan;
              sensorsArr.push_back(std::move(so));
            }
          }
          if (hasFormula) {
            for (const auto &chan : formIt->second) {
              json::object so = base;
              so["id"] = sensorId + kChannelIdSep + chan;
              so["code"] = sensorCode + " · " + chan;
              so["name"] = sensorName + " · " + chan;
              so["unit"] = sensorUnit;
              so["type"] = chan;
              sensorsArr.push_back(std::move(so));
            }
          }
        }
      }
    }

    return makeJsonResponse(http::status::ok, json::object{
        {"sensor_types", sensorTypes}, {"zones", zones}, {"sensors", sensorsArr}});
  }
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleQueryTelemetrySeries(const http::request<http::string_body>& req,
                           const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  const auto itIds = query.find("sensor_ids");
  const auto itFrom = query.find("from");
  const auto itTo = query.find("to");
  if (itIds == query.end() || itIds->second.empty() ||
      itFrom == query.end() || itFrom->second.empty() ||
      itTo == query.end() || itTo->second.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "sensor_ids_from_to_required"}});
  }

  const std::vector<std::string> rawIds = splitCsvLower(itIds->second);
  if (rawIds.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sensor_ids_required"}});
  }
  if (rawIds.size() > 50) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "too_many_sensors"}});
  }
  const std::string idsLiteral = toPgUuidArrayLiteral(rawIds);
  // Un id compuesto "sensor_id~channel_code" (ver kChannelIdSep) nunca pasa
  // looksLikeUuid, así que queda fuera de idsLiteral a propósito -- sus
  // datos salen del bloque de ids compuestos más abajo, no de acá. Si TODO
  // lo pedido es un id compuesto, idsLiteral queda vacío legítimamente; el
  // 400 solo aplica cuando no hay NINGÚN id utilizable de ningún tipo.
  const bool hasCompositeId = itIds->second.find(kChannelIdSep) != std::string::npos;
  if (idsLiteral == "{}" && !hasCompositeId) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sensor_ids_invalid"}});
  }

  std::string agg = "hourly";
  const auto itAgg = query.find("agg");
  if (itAgg != query.end() &&
      (itAgg->second == "raw" || itAgg->second == "hourly" || itAgg->second == "daily")) {
    agg = itAgg->second;
  }

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // Valida el rango (from < to, <= 90 días) reutilizando el mismo cast que
  // usará la query principal — si `from`/`to` no son timestamps válidos,
  // esto falla con PGRES_FATAL_ERROR y se traduce en 400, sin llegar a la
  // query pesada sobre telemetry_raw.
  const std::string sqlValidate =
      "SELECT ($2::timestamptz < $1::timestamptz) AS inverted, "
      "EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 86400.0 AS span_days";
  const char *pv[2] = {itFrom->second.c_str(), itTo->second.c_str()};
  storage::PgResult resValidate{
      PQexecParams(conn, sqlValidate.c_str(), 2, nullptr, pv, nullptr, nullptr, 0)};
  if (!resValidate.okTuples() || PQntuples(resValidate.get()) != 1) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_from_to"}});
  }
  const bool inverted = std::string(PQgetvalue(resValidate.get(), 0, 0)) == "t";
  const double spanDays = safeStod(PQgetvalue(resValidate.get(), 0, 1));
  if (inverted) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "from_after_to"}});
  }
  if (spanDays > 90.0) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "range_too_wide_max_90_days"}});
  }
  // Rango histórico crudo demasiado amplio: degrada a promedio horario para
  // no devolver un payload desproporcionado (mismo espíritu que el tope de
  // handleGetTelemetrySummary sobre la ventana en horas).
  if (agg == "raw" && spanDays > 7.0) {
    agg = "hourly";
  }

  const std::string tenantVal = effectiveTenant;
  const char *ps[4] = {tenantVal.c_str(), idsLiteral.c_str(), itFrom->second.c_str(), itTo->second.c_str()};

  // ADR-131: telemetry_raw -> telemetry_fact (vía dim_sensor/dim_tenant).
  // hourly/daily leen directo de telemetry_fact_hourly/_daily (ya
  // materializados por TimescaleDB) en vez de GROUP BY date_trunc sobre la
  // hypertable cruda -- la agregación ya está pagada. "raw" (acotado a <=7
  // días por el degrade de arriba) sigue siendo resolución exacta sobre
  // telemetry_fact.
  const std::string sqlSeries =
      agg == "raw"
          ? ("SELECT ds.sensor_id::text, tf.captured_at::text AS t, tf.value_numeric AS v "
             "FROM telemetry_fact tf "
             "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
             "WHERE tf.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
             "AND ds.sensor_id = ANY($2::uuid[]) AND tf.channel_id = 0 "
             "AND tf.captured_at >= $3::timestamptz AND tf.captured_at <= $4::timestamptz "
             "ORDER BY ds.sensor_id ASC, tf.captured_at ASC")
          : ("SELECT ds.sensor_id::text, h.bucket::text AS t, h.avg_value AS v "
             "FROM telemetry_fact_" + (agg == "daily" ? std::string("daily") : std::string("hourly")) + " h "
             "JOIN dim_sensor ds ON ds.sensor_id_sk = h.sensor_id_sk "
             "WHERE h.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
             "AND ds.sensor_id = ANY($2::uuid[]) AND h.channel_id = 0 "
             "AND h.bucket >= $3::timestamptz AND h.bucket <= $4::timestamptz "
             "ORDER BY ds.sensor_id ASC, h.bucket ASC");

  storage::PgResult resSeries{PQexecParams(conn, sqlSeries.c_str(), 4, nullptr, ps, nullptr, nullptr, 0)};
  if (!resSeries.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
  }
  json::array series;
  std::unordered_set<std::string> sensorsWithSeries;
  for (int i = 0; i < PQntuples(resSeries.get()); ++i) {
    if (PQgetisnull(resSeries.get(), i, 2)) continue;
    const std::string sid = PQgetvalue(resSeries.get(), i, 0);
    sensorsWithSeries.insert(sid);
    series.push_back(json::object{
        {"sensor_id", sid},
        {"t", PQgetvalue(resSeries.get(), i, 1)},
        {"v", safeStod(PQgetvalue(resSeries.get(), i, 2))}});
  }

  // ADR-189: sensores multivariados (acelerógrafo triaxial del celular,
  // GNSS, etc.) nunca escriben en telemetry_fact.channel_id=0 -- su
  // entrada son canales crudos con nombre (sensor_input_channel_def) y su
  // única serie de "un valor" comparable a las de arriba es la salida de
  // su fórmula habilitada (tinyexpr, ver sensor_formula_evaluator.cpp),
  // que el evaluador escribe en telemetry_multivariate, no en
  // telemetry_fact. Sin este fallback el widget de reportes nunca
  // encuentra datos para estos sensores y cae al placeholder "datos de
  // prueba". Solo se consulta para los sensor_ids que quedaron SIN filas
  // arriba -- cero cambio de comportamiento ni query extra para los
  // sensores clásicos de un canal.
  std::vector<std::string> missingIds;
  for (const auto &id : rawIds) {
    if (looksLikeUuid(id) && !sensorsWithSeries.count(id)) missingIds.push_back(id);
  }
  if (!missingIds.empty()) {
    const std::string missingLiteral = toPgUuidArrayLiteral(missingIds);
    const std::string sqlMulti =
        agg == "raw"
            ? ("SELECT tm.sensor_id::text, tm.captured_at::text AS t, tm.value_numeric AS v "
               "FROM telemetry_multivariate tm "
               "JOIN LATERAL (SELECT sf.output_channel_code FROM sensor_formula_def sf "
               "  WHERE sf.sensor_id = tm.sensor_id AND sf.enabled "
               "  ORDER BY sf.formula_id ASC LIMIT 1) sf ON sf.output_channel_code = tm.channel_code "
               "WHERE tm.tenant_id = $1::uuid AND tm.sensor_id = ANY($2::uuid[]) "
               "AND tm.captured_at >= $3::timestamptz AND tm.captured_at <= $4::timestamptz "
               "AND tm.value_numeric IS NOT NULL "
               "ORDER BY tm.sensor_id ASC, tm.captured_at ASC")
            : ("SELECT tm.sensor_id::text, date_trunc('" +
               std::string(agg == "daily" ? "day" : "hour") +
               "', tm.captured_at)::text AS t, avg(tm.value_numeric) AS v "
               "FROM telemetry_multivariate tm "
               "JOIN LATERAL (SELECT sf.output_channel_code FROM sensor_formula_def sf "
               "  WHERE sf.sensor_id = tm.sensor_id AND sf.enabled "
               "  ORDER BY sf.formula_id ASC LIMIT 1) sf ON sf.output_channel_code = tm.channel_code "
               "WHERE tm.tenant_id = $1::uuid AND tm.sensor_id = ANY($2::uuid[]) "
               "AND tm.captured_at >= $3::timestamptz AND tm.captured_at <= $4::timestamptz "
               "AND tm.value_numeric IS NOT NULL "
               "GROUP BY tm.sensor_id, 2 ORDER BY tm.sensor_id ASC, 2 ASC");
    const char *pms[4] = {tenantVal.c_str(), missingLiteral.c_str(), itFrom->second.c_str(),
                          itTo->second.c_str()};
    storage::PgResult resMulti{
        PQexecParams(conn, sqlMulti.c_str(), 4, nullptr, pms, nullptr, nullptr, 0)};
    if (resMulti.okTuples()) {
      for (int i = 0; i < PQntuples(resMulti.get()); ++i) {
        if (PQgetisnull(resMulti.get(), i, 2)) continue;
        series.push_back(json::object{
            {"sensor_id", PQgetvalue(resMulti.get(), i, 0)},
            {"t", PQgetvalue(resMulti.get(), i, 1)},
            {"v", safeStod(PQgetvalue(resMulti.get(), i, 2))}});
      }
    }
  }

  // Ids "virtuales" sensor+canal (p.ej. "7b7a6b8e-...~accel_x",
  // "...~PGA"), del catálogo de handleGetTelemetryWizardCatalog -- una fila
  // seleccionable POR CANAL para poder graficar cada eje del acelerómetro y
  // cada coordenada GPS por separado, en vez de solo la métrica de la
  // fórmula (fallback de arriba, que sigue existiendo para cuando el
  // frontend pide el sensor_id plano sin desglosar). Se buscan por
  // separado de `rawIds` (que ya viene en minúsculas de splitCsvLower, y
  // acá la comparación es case-insensitive) para preservar el string
  // EXACTO que mandó el cliente y devolverlo tal cual en `sensor_id` --
  // así el widget, que indexa por ese string literal, encuentra la serie.
  std::vector<std::pair<std::string, std::string>> compositeIds;  // (lowerKey, original)
  {
    std::string cur;
    auto flush = [&]() {
      if (!cur.empty()) {
        const auto tilde = cur.find(kChannelIdSep);
        if (tilde != std::string::npos && tilde > 0 && tilde + 1 < cur.size()) {
          std::string lowerKey = cur;
          std::transform(lowerKey.begin(), lowerKey.end(), lowerKey.begin(),
                        [](unsigned char c) { return std::tolower(c); });
          compositeIds.emplace_back(std::move(lowerKey), cur);
        }
      }
      cur.clear();
    };
    for (char c : itIds->second) {
      if (c == ',') flush(); else cur += c;
    }
    flush();
  }
  if (!compositeIds.empty()) {
    std::vector<std::string> lowerKeys;
    lowerKeys.reserve(compositeIds.size());
    std::unordered_map<std::string, std::string> originalByLowerKey;
    for (const auto &entry : compositeIds) {
      lowerKeys.push_back(entry.first);
      originalByLowerKey.emplace(entry.first, entry.second);
    }
    const std::string compositeLiteral = toPgTextArrayLiteral(lowerKeys);
    // UNION de las dos fuentes posibles para el canal pedido: crudo
    // (telemetry_fact, vía dim_channel) o calculado (telemetry_multivariate,
    // salida de fórmula) -- un channel_code dado solo existe en una de las
    // dos, así que no hay riesgo de sumar el mismo dato dos veces.
    const std::string sqlComposite =
        agg == "raw"
            ? ("SELECT lower(ds.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || dc.channel_code) AS k, "
               "tf.captured_at::text AS t, tf.value_numeric AS v "
               "FROM telemetry_fact tf "
               "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
               "JOIN dim_channel dc ON dc.channel_id = tf.channel_id "
               "WHERE tf.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
               "AND lower(ds.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || dc.channel_code) = ANY($2::text[]) "
               "AND tf.captured_at >= $3::timestamptz AND tf.captured_at <= $4::timestamptz "
               "UNION ALL "
               "SELECT lower(tm.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || tm.channel_code), "
               "tm.captured_at::text, tm.value_numeric "
               "FROM telemetry_multivariate tm "
               "WHERE tm.tenant_id = $1::uuid "
               "AND lower(tm.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || tm.channel_code) = ANY($2::text[]) "
               "AND tm.captured_at >= $3::timestamptz AND tm.captured_at <= $4::timestamptz "
               "AND tm.value_numeric IS NOT NULL "
               "ORDER BY k ASC, t ASC")
            : ("SELECT k, date_trunc('" + std::string(agg == "daily" ? "day" : "hour") + "', ts)::text AS t, avg(val) AS v FROM ("
               "SELECT lower(ds.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || dc.channel_code) AS k, "
               "tf.captured_at AS ts, tf.value_numeric AS val "
               "FROM telemetry_fact tf "
               "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
               "JOIN dim_channel dc ON dc.channel_id = tf.channel_id "
               "WHERE tf.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
               "AND lower(ds.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || dc.channel_code) = ANY($2::text[]) "
               "AND tf.captured_at >= $3::timestamptz AND tf.captured_at <= $4::timestamptz "
               "UNION ALL "
               "SELECT lower(tm.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || tm.channel_code), "
               "tm.captured_at, tm.value_numeric "
               "FROM telemetry_multivariate tm "
               "WHERE tm.tenant_id = $1::uuid "
               "AND lower(tm.sensor_id::text || '" + std::string(1, kChannelIdSep) + "' || tm.channel_code) = ANY($2::text[]) "
               "AND tm.captured_at >= $3::timestamptz AND tm.captured_at <= $4::timestamptz "
               "AND tm.value_numeric IS NOT NULL"
               ") x GROUP BY k, 2 ORDER BY k ASC, 2 ASC");
    const char *pcc[4] = {tenantVal.c_str(), compositeLiteral.c_str(), itFrom->second.c_str(),
                          itTo->second.c_str()};
    storage::PgResult resComposite{
        PQexecParams(conn, sqlComposite.c_str(), 4, nullptr, pcc, nullptr, nullptr, 0)};
    if (resComposite.okTuples()) {
      for (int i = 0; i < PQntuples(resComposite.get()); ++i) {
        if (PQgetisnull(resComposite.get(), i, 2)) continue;
        const std::string key = PQgetvalue(resComposite.get(), i, 0);
        const auto origIt = originalByLowerKey.find(key);
        if (origIt == originalByLowerKey.end()) continue;
        series.push_back(json::object{
            {"sensor_id", origIt->second},
            {"t", PQgetvalue(resComposite.get(), i, 1)},
            {"v", safeStod(PQgetvalue(resComposite.get(), i, 2))}});
      }
    }
  }

  const char *pm[2] = {tenantVal.c_str(), idsLiteral.c_str()};
  const std::string sqlMeta =
      "SELECT s.sensor_id::text, s.sensor_code, s.sensor_name, COALESCE(s.unit,''), s.sensor_type, "
      "COALESCE(NULLIF(s.serial_number,''), NULLIF(s.external_id,''), s.sensor_code) AS device_key "
      "FROM sensors s WHERE s.tenant_id = $1::uuid AND s.sensor_id = ANY($2::uuid[])";
  storage::PgResult resMeta{PQexecParams(conn, sqlMeta.c_str(), 2, nullptr, pm, nullptr, nullptr, 0)};
  json::array sensorsArr;
  if (resMeta.okTuples()) {
    for (int i = 0; i < PQntuples(resMeta.get()); ++i) {
      sensorsArr.push_back(json::object{
          {"id", PQgetvalue(resMeta.get(), i, 0)},
          {"code", PQgetvalue(resMeta.get(), i, 1)},
          {"name", PQgetvalue(resMeta.get(), i, 2)},
          {"unit", PQgetvalue(resMeta.get(), i, 3)},
          {"type", PQgetvalue(resMeta.get(), i, 4)},
          {"device_key", PQgetvalue(resMeta.get(), i, 5)}});
    }
  }

  return makeJsonResponse(http::status::ok, json::object{
      {"sensors", sensorsArr}, {"series", series},
      {"from", itFrom->second}, {"to", itTo->second}, {"agg", agg}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
