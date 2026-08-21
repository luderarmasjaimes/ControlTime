#include "mining_routes.hpp"
#include "kpi_service.hpp"
#include "sensor_service.hpp"
#include "sensor_telemetry_wizard.hpp"
#include "surveillance_service.hpp"
#include "igp_seismic_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl

namespace mining {

// ── GET /api/dashboard/metrics ───────────────────────────────────────
static http::response<http::string_body>
handleDashboardMetrics(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query) {
  // Fix (auditoría de seguridad 2026-07-13): sin auth, expone KPIs/heatmap
  // operativos a cualquiera sin login.
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  // `days`: tamaño de la ventana del heatmap (antes fijo a los 15 días
  // sembrados). El dataset de demo (dashboard_heatmap.day) solo tiene datos
  // reales hasta el día 15 -- pedir una ventana mayor simplemente no trae
  // filas extra (honesto: no se inventan eventos), pero permite al frontend
  // ofrecer un selector de rango real sin mentir sobre la disponibilidad.
  int days = 15;
  const auto itDays = query.find("days");
  if (itDays != query.end()) {
    try { days = std::clamp(std::stoi(itDays->second), 1, 90); } catch (...) { days = 15; }
  }
  json::object metrics;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      storage::PgResult res_kpi{PQexec(conn, "SELECT name, value, unit, trend, trend_value FROM dashboard_kpis")};
      json::object kpis;
      if (res_kpi.okTuples()) {
          for (int i = 0; i < PQntuples(res_kpi.get()); ++i) {
              std::string name = PQgetvalue(res_kpi.get(), i, 0);
              kpis[name] = json::object{{"value", std::stod(PQgetvalue(res_kpi.get(), i, 1))}, {"unit", PQgetvalue(res_kpi.get(), i, 2)}, {"trend", PQgetvalue(res_kpi.get(), i, 3)}, {"trend_value", std::stod(PQgetvalue(res_kpi.get(), i, 4))}};
          }
      }
      metrics["kpis"] = kpis;

      const std::string daysStr = std::to_string(days);
      const char *daysParam[1] = {daysStr.c_str()};
      storage::PgResult res_heat{PQexecParams(conn,
          "SELECT day, level_name, x_coord, y_coord, intensity FROM dashboard_heatmap "
          "WHERE day <= $1::int ORDER BY day ASC",
          1, nullptr, daysParam, nullptr, nullptr, 0)};
      json::array heatmap;
      if (res_heat.okTuples()) {
          for (int i = 0; i < PQntuples(res_heat.get()); ++i) {
              heatmap.push_back(json::object{{"day", std::stoi(PQgetvalue(res_heat.get(), i, 0))}, {"level", PQgetvalue(res_heat.get(), i, 1)}, {"x", std::stoi(PQgetvalue(res_heat.get(), i, 2))}, {"y", std::stoi(PQgetvalue(res_heat.get(), i, 3))}, {"val", std::stod(PQgetvalue(res_heat.get(), i, 4))}});
          }
      }
      metrics["heatmap"] = heatmap;
      metrics["days"] = days;
      return makeJsonResponse(http::status::ok, metrics);
    }
#endif
  }
  metrics["days"] = days;
  return makeJsonResponse(http::status::ok, metrics);
}

namespace {

// Copia un campo string del evento IGP si viene presente y no-null, con un
// nombre de salida normalizado (el API del IGP no es 100% consistente entre
// /ultimo-sismo y /ajaxb/{year}: unas veces "fecha_local", otras
// "fecha_hora" -- se intentan ambas variantes por campo).
void copyIgpField(const json::object &src, json::object &dst,
                  const std::string &outKey,
                  std::initializer_list<const char *> candidates) {
  for (const char *key : candidates) {
    if (src.if_contains(key) && !src.at(key).is_null()) {
      dst[outKey] = src.at(key);
      return;
    }
  }
}

json::object normalizeIgpEvent(const json::value &raw) {
  json::object out;
  if (!raw.is_object()) return out;
  const auto &o = raw.as_object();
  copyIgpField(o, out, "codigo", {"codigo"});
  copyIgpField(o, out, "fecha_local", {"fecha_local", "fecha_hora"});
  copyIgpField(o, out, "hora_local", {"hora_local"});
  copyIgpField(o, out, "magnitud", {"magnitud"});
  copyIgpField(o, out, "profundidad", {"profundidad"});
  copyIgpField(o, out, "referencia", {"referencia", "referencia2"});
  copyIgpField(o, out, "latitud", {"latitud"});
  copyIgpField(o, out, "longitud", {"longitud"});
  copyIgpField(o, out, "intensidad", {"intensidad", "intensidades"});
  copyIgpField(o, out, "mapa_sismico_url", {"mapa", "mapa_sismico_url"});
  copyIgpField(o, out, "reporte_acelerometrico_pdf", {"reporte_acelerometrico_pdf"});
  out["source"] = "IGP/CENSIS";
  return out;
}

// Numero de dias desde una fecha civil arbitraria (algoritmo de Howard
// Hinnant, http://howardhinnant.github.io/date_algorithms.html) -- se evita
// std::get_time/timegm por diferencias de portabilidad Windows/Linux entre
// el build local y el contenedor; esto es aritmetica pura sobre y/m/d, sin
// zona horaria.
long daysFromCivil(int y, int m, int d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<long>(doe) - 719468;
}

bool parseIsoDate(const std::string &s, int &y, int &m, int &d) {
  if (s.size() < 10) return false;
  try {
    y = std::stoi(s.substr(0, 4));
    m = std::stoi(s.substr(5, 2));
    d = std::stoi(s.substr(8, 2));
  } catch (...) {
    return false;
  }
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

} // namespace

// ── GET /api/mining/seismic/report ───────────────────────────────────
// Combina (a) sismos oficiales del IGP/CENSIS (fuente gubernamental real de
// Peru -- NO INDECI/Defensa Civil, que solo coordinan respuesta a
// emergencias, no detectan sismos) obtenidos en vivo vía igp_seismic_client,
// con (b) los eventos microsísmicos detectados por la red de sensores
// propia de la mina (tabla dashboard_heatmap, misma fuente que ya usa
// /api/dashboard/metrics para el heatmap "Nv.4200...Nv.3800").
static http::response<http::string_body>
handleSeismicReport(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }

  // Rango de fechas explicito (?start=YYYY-MM-DD&end=YYYY-MM-DD), pedido para
  // que el usuario pueda elegir dia/mes/año en vez de estar atado al año
  // calendario actual. Si no viene un rango valido, se cae al comportamiento
  // legado (?year=, año calendario actual por defecto) por compatibilidad.
  int sy = 0, sm = 0, sd = 0, ey = 0, em = 0, ed = 0;
  bool hasRange = false;
  const auto itStart = query.find("start");
  const auto itEnd = query.find("end");
  std::string startStr, endStr;
  if (itStart != query.end() && itEnd != query.end() &&
      parseIsoDate(itStart->second, sy, sm, sd) &&
      parseIsoDate(itEnd->second, ey, em, ed)) {
    startStr = itStart->second.substr(0, 10);
    endStr = itEnd->second.substr(0, 10);
    if (startStr > endStr) std::swap(startStr, endStr);
    hasRange = true;
  }

  int year = 0;
  const auto itYear = query.find("year");
  if (itYear != query.end()) {
    try { year = std::stoi(itYear->second); } catch (...) { year = 0; }
  }
  if (year < 2000 || year > 2100) {
    std::time_t tt = std::time(nullptr);
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &tt);
#else
    gmtime_r(&tt, &utc);
#endif
    year = utc.tm_year + 1900;
  }

  json::object result;

  // (a) IGP/CENSIS -- llamada(s) HTTPS en vivo, sin cache local; best-effort
  // (si el servicio del IGP no responde, se informa igp.available=false en
  // vez de fallar toda la respuesta). El API del IGP solo pagina por año
  // calendario (/ajaxb/{year}) -- si el rango pedido cruza años, se consultan
  // todos los años involucrados (acotado a 3 para no encadenar llamadas de
  // mas) y se filtra el resultado combinado por fecha exacta.
  json::array igpNormalized;
  if (hasRange) {
    const int spanYears = std::min(ey - sy, 2);
    for (int yy = sy; yy <= sy + spanYears; ++yy) {
      json::array yearEvents = mining::fetchIgpYearEvents(yy);
      for (const auto &ev : yearEvents) {
        json::object norm = normalizeIgpEvent(ev);
        if (norm.if_contains("fecha_local") && norm.at("fecha_local").is_string()) {
          const std::string fecha(norm.at("fecha_local").as_string());
          const std::string datePart = fecha.substr(0, 10);
          if (datePart >= startStr && datePart <= endStr) {
            igpNormalized.push_back(std::move(norm));
          }
        }
      }
    }
  } else {
    json::array igpEvents = mining::fetchIgpYearEvents(year);
    igpNormalized.reserve(igpEvents.size());
    for (const auto &ev : igpEvents) {
      igpNormalized.push_back(normalizeIgpEvent(ev));
    }
  }
  result["igp"] = json::object{
      {"available", !igpNormalized.empty()},
      {"source", "IGP/CENSIS - ultimosismo.igp.gob.pe (oficial, Peru)"},
      {"year", year},
      {"range_start", startStr},
      {"range_end", endStr},
      {"events", igpNormalized}};

  // (b) Red de sensores microsísmicos propia de la mina. El dataset de demo
  // (dashboard_heatmap.day) no tiene fecha calendario real, solo un indice
  // de dia relativo 1..15 -- el rango elegido por el usuario se traduce al
  // numero de dias que abarca (acotado 1-90) y se usa como ventana "day <=
  // N", igual que en /api/dashboard/metrics. Es una aproximacion honesta:
  // si el usuario pide un rango mas amplio que los 15 dias sembrados, no
  // aparecen filas extra en vez de inventar eventos.
  int companyDays = 15;
  if (hasRange) {
    const long d0 = daysFromCivil(sy, sm, sd);
    const long d1 = daysFromCivil(ey, em, ed);
    companyDays = std::clamp(static_cast<int>(std::labs(d1 - d0)) + 1, 1, 90);
  } else {
    const auto itDays = query.find("days");
    if (itDays != query.end()) {
      try { companyDays = std::clamp(std::stoi(itDays->second), 1, 90); } catch (...) { companyDays = 15; }
    }
  }

  json::array companyEvents;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      const std::string daysStr = std::to_string(companyDays);
      const char *daysParam[1] = {daysStr.c_str()};
      storage::PgResult res_heat{PQexecParams(conn,
          "SELECT day, level_name, x_coord, y_coord, intensity FROM dashboard_heatmap "
          "WHERE day <= $1::int ORDER BY day ASC",
          1, nullptr, daysParam, nullptr, nullptr, 0)};
      if (res_heat.okTuples()) {
        for (int i = 0; i < PQntuples(res_heat.get()); ++i) {
          companyEvents.push_back(json::object{
              {"day", std::stoi(PQgetvalue(res_heat.get(), i, 0))},
              {"level", PQgetvalue(res_heat.get(), i, 1)},
              {"x", std::stoi(PQgetvalue(res_heat.get(), i, 2))},
              {"y", std::stoi(PQgetvalue(res_heat.get(), i, 3))},
              {"intensity", std::stod(PQgetvalue(res_heat.get(), i, 4))},
              {"source", "sensores_propios"}});
        }
      }
    }
#endif
  }
  result["company"] = json::object{
      {"available", !companyEvents.empty()},
      {"source", "Red sismológica propia (sensores instalados en la unidad minera)"},
      {"days", companyDays},
      {"events", companyEvents}};

  return makeJsonResponse(http::status::ok, result);
}

// ── GET /api/config/mining-locations ─────────────────────────────────
static http::response<http::string_body>
handleMiningLocations(const http::request<http::string_body>& req,
                      const std::unordered_map<std::string, std::string>& query) {
  json::array locations;
  locations.push_back(json::object{{"company_name", "Minera Antamina"}, {"latitude", -9.549}, {"longitude", -77.054}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Compania Minera Antamina"}, {"latitude", -9.549}, {"longitude", -77.054}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Sociedad Minera Cerro Verde"}, {"latitude", -16.536}, {"longitude", -71.583}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Minera Cerro Verde"}, {"latitude", -16.536}, {"longitude", -71.583}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Las Bambas"}, {"latitude", -14.156}, {"longitude", -72.333}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Southern Peru Copper Corporation"}, {"latitude", -17.246}, {"longitude", -70.612}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Yanacocha"}, {"latitude", -6.983}, {"longitude", -78.508}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Anglo American Quellaveco"}, {"latitude", -17.112}, {"longitude", -70.625}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Buenaventura"}, {"latitude", -12.115}, {"longitude", -76.995}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Chinalco Peru"}, {"latitude", -11.595}, {"longitude", -76.195}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Volcan"}, {"latitude", -10.68}, {"longitude", -76.25}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Raura"}, {"latitude", -10.45}, {"longitude", -76.75}, {"zoom", 14}});
  return makeJsonResponse(http::status::ok, locations);
}

void registerRoutes(router::Router& r) {
  r.get("/api/dashboard/metrics", handleDashboardMetrics);
  r.get("/api/mining/seismic/report", handleSeismicReport);
  r.get("/api/config/mining-locations", handleMiningLocations);

  r.get("/api/mining/kpis", handleGetKpis);
  r.post("/api/mining/kpis/upsert", handleUpsertKpis);
  r.post("/api/mining/kpis/sync-from-dashboard", handleSyncFromDashboard);
  r.post("/api/mining/kpis/sync-from-external", handleSyncFromExternal);
  r.get("/api/mining/kpis/points", handleGetKpiPoints);

  r.get("/api/sensors/data", handleGetSensorData);
  r.get("/api/mining/telemetry/summary", handleGetTelemetrySummary);
  r.get("/api/mining/telemetry/wizard/catalog", handleGetTelemetryWizardCatalog);
  r.get("/api/mining/telemetry/wizard/query", handleQueryTelemetrySeries);

  r.get("/api/surveillance/cameras", handleGetCameras);
  r.get("/api/surveillance/camera-snapshot", handleCameraSnapshot);
  r.post("/api/surveillance/cameras", handleCreateCamera);
  // prefix routes for /api/surveillance/cameras/<id>
  r.put("/api/surveillance/cameras/", handleUpdateCamera);
  r.del("/api/surveillance/cameras/", handleDeleteCamera);
}

} // namespace mining
