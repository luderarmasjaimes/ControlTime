// --------------------------------------------------------------------------
// thingsboard_sync.cpp — implementación (ver thingsboard_sync.hpp)
// --------------------------------------------------------------------------
#include "thingsboard_sync.hpp"
#include "telemetry_ingest.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#    include <libpq-fe.h>
#  elif __has_include(<postgresql/libpq-fe.h>)
#    define HAS_LIBPQ 1
#    include <postgresql/libpq-fe.h>
#  else
#    define HAS_LIBPQ 0
#  endif
#else
#  if __has_include(<libpq-fe.h>)
#    include <libpq-fe.h>
#  else
#    include <postgresql/libpq-fe.h>
#  endif
#endif

#if HAS_LIBPQ

#include "storage/pg_result.hpp"
#include "http/http_client.hpp"

#include <boost/asio.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/websocket/ssl.hpp>
#include <boost/json.hpp>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace asio = boost::asio;
namespace ssl = boost::asio::ssl;
namespace json = boost::json;
using tcp = asio::ip::tcp;

namespace mining {
namespace tbsync {

namespace {

// ── Config/env helpers (mismo patrón que protocol_adapters.cpp) ──────────
std::string envOr(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::string(v) : def;
}
bool envFlag(const char* k, bool def) {
    const std::string v = envOr(k, def ? "true" : "false");
    return v == "true" || v == "1" || v == "yes";
}

std::atomic<bool> g_running{false};
std::string g_db_url;
std::vector<std::thread> g_threads;

std::atomic<std::uint64_t> m_peers_configured{0};
std::atomic<std::uint64_t> m_peers_authenticated{0};
std::atomic<std::uint64_t> m_login_failures{0};
std::atomic<std::uint64_t> m_backfill_runs{0};
std::atomic<std::uint64_t> m_backfill_points{0};
std::atomic<std::uint64_t> m_backfill_errors{0};
std::atomic<std::uint64_t> m_ws_connects{0};
std::atomic<std::uint64_t> m_ws_reconnects{0};
std::atomic<std::uint64_t> m_realtime_points{0};
std::atomic<std::uint64_t> m_realtime_dropped{0};
std::atomic<std::uint64_t> m_realtime_errors{0};
std::atomic<std::uint64_t> m_backfill_rejected_bad_ts{0};
std::atomic<std::uint64_t> m_realtime_rejected_bad_ts{0};

// ── Filtro de sanidad de captured_at ──────────────────────────────────────
// Hallazgo en producción (análisis del esquema real de ThingsBoard, ver
// ADR-054): algunos dispositivos mandan ts corruptos — RTC sin sincronizar
// (ej. arranca en 1990 y nunca se resetea) o unidad mal escalada (segundos
// en vez de ms, cae en 1970). Sin filtro, esos puntos entrarían a
// telemetry_raw con la misma fecha corrupta y, si esa tabla también está
// particionada por tiempo (ADR-006), reproducirían ahí el mismo problema de
// bloat de particiones que se encontró en la BD de ThingsBoard real
// (cientos de particiones casi vacías por fechas de 1970 a 2279).
constexpr std::int64_t kMinSaneCapturedAtMs = 946684800000LL;  // 2000-01-01T00:00:00Z
std::int64_t maxFutureSkewMs() {
    static const std::int64_t v = [] {
        try { return std::stoll(envOr("BEEMETRY_TB_MAX_FUTURE_SKEW_MS", "86400000")); }
        catch (...) { return 86400000LL; }  // default: tolera hasta 24h de adelanto de reloj
    }();
    return v;
}
bool isSaneCapturedAt(std::int64_t ts_ms) {
    if (ts_ms < kMinSaneCapturedAtMs) return false;
    const std::int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return ts_ms <= nowMs + maxFutureSkewMs();
}

// ── Estructuras de configuración/mapeo ────────────────────────────────────
struct TbPeer {
    std::string peer_id;
    std::string tenant_id;
    std::string base_url;   // p.ej. "http://legacy-tb.cliente.com:8080" (sin slash final)
    std::string username;
    std::string password;
};

struct TbSensorMapping {
    std::string sensor_id;    // uuid propio
    std::string tenant_id;    // uuid propio
    std::string device_uuid;  // entity_id/device.id en ThingsBoard
    std::string key;          // nombre de la key de telemetría en ThingsBoard
};

struct ParsedUrl {
    bool tls{false};
    std::string host;
    std::string port;
    std::string base_path;  // "" o "/algo" si base_url trae subpath
};

bool parseBaseUrl(const std::string& url, ParsedUrl& out) {
    std::string rest = url;
    if (rest.rfind("https://", 0) == 0) { out.tls = true; rest = rest.substr(8); }
    else if (rest.rfind("http://", 0) == 0) { out.tls = false; rest = rest.substr(7); }
    else return false;
    const auto slashPos = rest.find('/');
    std::string hostport = (slashPos == std::string::npos) ? rest : rest.substr(0, slashPos);
    out.base_path = (slashPos == std::string::npos) ? "" : rest.substr(slashPos);
    if (!out.base_path.empty() && out.base_path.back() == '/') out.base_path.pop_back();
    const auto colonPos = hostport.find(':');
    if (colonPos == std::string::npos) {
        out.host = hostport;
        out.port = out.tls ? "443" : "80";
    } else {
        out.host = hostport.substr(0, colonPos);
        out.port = hostport.substr(colonPos + 1);
    }
    return !out.host.empty();
}

// ── Carga de configuración (etl_sync_peer / sensors.external_id) ─────────
// Convención de mapeo: sensors.external_id = "tb:<device_uuid>:<key>"
// (documentado en thingsboard_sync.hpp) — se reutiliza la columna ya
// existente en vez de agregar una tabla nueva.
std::vector<TbPeer> loadPeers(const std::string& db_url) {
    std::vector<TbPeer> out;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) {
        std::cerr << "[TB_SYNC] no se pudo conectar para leer etl_sync_peer: "
                  << conn.error() << std::endl;
        return out;
    }
    storage::PgResult res{PQexec(conn.get(),
        "SELECT peer_id, tenant_id, base_url, "
        "       auth_config->>'username', auth_config->>'password' "
        "FROM etl_sync_peer "
        "WHERE is_active AND auth_config->>'kind' = 'thingsboard'")};
    if (!res.okTuples()) {
        std::cerr << "[TB_SYNC] error leyendo etl_sync_peer: " << res.error() << std::endl;
        return out;
    }
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        TbPeer p;
        p.peer_id   = PQgetvalue(res.get(), i, 0);
        p.tenant_id = PQgetvalue(res.get(), i, 1);
        p.base_url  = PQgetvalue(res.get(), i, 2);
        p.username  = PQgetisnull(res.get(), i, 3) ? "" : PQgetvalue(res.get(), i, 3);
        p.password  = PQgetisnull(res.get(), i, 4) ? "" : PQgetvalue(res.get(), i, 4);
        if (!p.base_url.empty() && p.base_url.back() == '/') p.base_url.pop_back();
        out.push_back(std::move(p));
    }
    return out;
}

// Fallback de un único peer vía variables de entorno — solo para pruebas
// locales sin fila en etl_sync_peer (ver comentario en el .hpp).
bool loadEnvFallbackPeer(TbPeer& out) {
    const std::string url = envOr("BEEMETRY_TB_URL", "");
    if (url.empty()) return false;
    out.peer_id   = "env-fallback";
    out.tenant_id = envOr("BEEMETRY_TB_TENANT_ID", "");
    out.base_url  = url;
    if (!out.base_url.empty() && out.base_url.back() == '/') out.base_url.pop_back();
    out.username  = envOr("BEEMETRY_TB_USERNAME", "");
    out.password  = envOr("BEEMETRY_TB_PASSWORD", "");
    return !out.tenant_id.empty() && !out.username.empty();
}

std::vector<TbSensorMapping> loadMappings(const std::string& db_url, const std::string& tenant_id) {
    std::vector<TbSensorMapping> out;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return out;
    const char* params[1] = {tenant_id.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "SELECT sensor_id, tenant_id, external_id FROM sensors "
        "WHERE tenant_id = $1::uuid AND is_active AND external_id LIKE 'tb:%'",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples()) return out;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        const std::string extId = PQgetvalue(res.get(), i, 2);
        // "tb:<device_uuid>:<key>"
        const auto p1 = extId.find(':');
        if (p1 == std::string::npos) continue;
        const auto p2 = extId.find(':', p1 + 1);
        if (p2 == std::string::npos) continue;
        TbSensorMapping m;
        m.sensor_id   = PQgetvalue(res.get(), i, 0);
        m.tenant_id   = PQgetvalue(res.get(), i, 1);
        m.device_uuid = extId.substr(p1 + 1, p2 - p1 - 1);
        m.key         = extId.substr(p2 + 1);
        out.push_back(std::move(m));
    }
    return out;
}

// ── Watermark / bitácora (etl_sync_state / etl_sync_run) ──────────────────
std::int64_t loadWatermarkMs(const std::string& db_url, const std::string& peer_id,
                              const std::string& stream_code) {
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return 0;
    const char* params[2] = {peer_id.c_str(), stream_code.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "SELECT watermark_bigint FROM etl_sync_state "
        "WHERE peer_id = $1::uuid AND stream_code = $2",
        2, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return 0;
    if (PQgetisnull(res.get(), 0, 0)) return 0;
    try { return std::stoll(PQgetvalue(res.get(), 0, 0)); } catch (...) { return 0; }
}

void saveWatermarkMs(const std::string& db_url, const std::string& peer_id,
                      const std::string& stream_code, std::int64_t watermark_ms) {
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return;
    const std::string wmStr = std::to_string(watermark_ms);
    const char* params[3] = {peer_id.c_str(), stream_code.c_str(), wmStr.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "INSERT INTO etl_sync_state (peer_id, stream_code, watermark_bigint, updated_at) "
        "VALUES ($1::uuid, $2, $3::bigint, NOW()) "
        "ON CONFLICT (peer_id, stream_code) DO UPDATE SET "
        "  watermark_bigint = EXCLUDED.watermark_bigint, updated_at = NOW()",
        3, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
}

std::int64_t startSyncRun(const std::string& db_url, const std::string& peer_id,
                           const std::string& mode) {
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return -1;
    const char* params[2] = {peer_id.c_str(), mode.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "INSERT INTO etl_sync_run (peer_id, mode, status) "
        "VALUES ($1::uuid, $2, 'running') RETURNING run_id",
        2, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return -1;
    try { return std::stoll(PQgetvalue(res.get(), 0, 0)); } catch (...) { return -1; }
}

void finishSyncRun(const std::string& db_url, std::int64_t run_id, bool ok,
                    std::uint64_t points, const std::string& error_message) {
    if (run_id < 0) return;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return;
    json::object stats;
    stats["points_ingested"] = static_cast<std::int64_t>(points);
    const std::string statsJson = json::serialize(stats);
    const std::string runIdStr = std::to_string(run_id);
    const std::string status = ok ? "success" : "failed";
    const char* params[4] = {runIdStr.c_str(), status.c_str(), statsJson.c_str(),
                              error_message.empty() ? nullptr : error_message.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "UPDATE etl_sync_run SET finished_at = NOW(), status = $2, "
        "  stats = $3::jsonb, error_message = $4 WHERE run_id = $1::bigint",
        4, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
}

// ── Cliente HTTP síncrono ──────────────────────────────────────────────────
// Antes esto era un cliente casero que ni siquiera soportaba TLS ("el
// ThingsBoard legacy puede exponer TLS... agregar boost::asio::ssl si el
// despliegue real lo requiere" — nunca se hizo). Confirmado con el
// ThingsBoard real de producción (board.beemetry.com): es HTTPS puro, sin
// balanceador que termine TLS antes — así que sin TLS este módulo no podía
// ni loguearse. Se reemplaza por el cliente compartido `http_client`
// (ADR-103, ya probado contra HTTPS real en la integración RP/TimeTelemetry)
// en vez de duplicar el boilerplate de Boost.Beast otra vez.
using HttpResult = http_client::HttpResult;

// ── Login / refresh de sesión ThingsBoard ─────────────────────────────────
struct TbSession {
    std::string jwt;
    std::chrono::steady_clock::time_point obtained_at;
};

bool tbLogin(const TbPeer& peer, TbSession& out) {
    json::object body;
    body["username"] = peer.username;
    body["password"] = peer.password;
    const auto res = http_client::request(peer.base_url + "/api/auth/login",
                                           http::verb::post, json::serialize(body),
                                           {}, 5000);
    if (!res.ok) {
        std::cerr << "[TB_SYNC] login fallido peer=" << peer.peer_id
                  << " status=" << res.status << " err=" << res.error << std::endl;
        m_login_failures.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    try {
        const auto payload = json::parse(res.body);
        if (!payload.is_object() || !payload.as_object().if_contains("token")) {
            m_login_failures.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        out.jwt = json::value_to<std::string>(payload.as_object().at("token"));
        out.obtained_at = std::chrono::steady_clock::now();
        m_peers_authenticated.fetch_add(1, std::memory_order_relaxed);
        return true;
    } catch (...) {
        m_login_failures.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
}

// ── Backfill histórico/incremental (REST) ─────────────────────────────────
// GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries — API documentada
// de ThingsBoard (TelemetryController.java, ver investigación previa).
//
// Batching por dispositivo (no por stream): la API acepta "keys" como CSV de
// varias keys en una sola llamada para un mismo dispositivo — el código
// original hacía una llamada HTTP separada POR CADA combinación
// dispositivo+key (una fila de `sensors` = un stream), secuencial y sin
// paralelismo. A la escala de 25k sensores eso son decenas de miles de
// llamadas HTTP por ciclo de backfill (minutos/decenas de minutos), inviable
// incluso como respaldo. Agrupar por dispositivo reduce el número de
// llamadas de O(streams) a O(dispositivos) — sigue sin ser la vía de tiempo
// real (para eso está el WebSocket), pero la deja usable como lo que en
// realidad es: respaldo ante caídas del WS, no cuello de botella aparte.
struct HistPoint { std::int64_t ts_ms; double value; };

// Devuelve, por cada key pedida, sus puntos nuevos (mapa key -> puntos).
bool fetchHistoryPageMulti(const std::string& baseUrl, const std::string& jwt,
                            const std::string& device_uuid, const std::string& keysCsv,
                            std::int64_t start_ms, std::int64_t end_ms,
                            std::unordered_map<std::string, std::vector<HistPoint>>& out,
                            std::string* errorOut = nullptr) {
    std::ostringstream target;
    target << baseUrl << "/api/plugins/telemetry/DEVICE/" << device_uuid
           << "/values/timeseries?keys=" << keysCsv
           << "&startTs=" << start_ms << "&endTs=" << end_ms
           << "&limit=1000&orderBy=ASC&useStrictDataTypes=true";
    // ThingsBoard espera el JWT en X-Authorization (no en el header
    // Authorization estándar) — particularidad documentada de su API REST.
    const auto res = http_client::request(target.str(), http::verb::get, "",
                                           {{"X-Authorization", "Bearer " + jwt}}, 15000);
    if (!res.ok) {
        if (errorOut) {
            *errorOut = "status=" + std::to_string(res.status) + " err=" + res.error;
        }
        return false;
    }
    try {
        const auto payload = json::parse(res.body);
        if (!payload.is_object()) return true;  // sin datos, no es error
        for (const auto& kv : payload.as_object()) {
            const std::string key = kv.key();
            if (!kv.value().is_array()) continue;
            auto& bucket = out[key];
            for (const auto& v : kv.value().as_array()) {
                if (!v.is_object()) continue;
                const auto& pt = v.as_object();
                if (!pt.if_contains("ts") || !pt.if_contains("value")) continue;
                HistPoint hp;
                hp.ts_ms = pt.at("ts").is_int64() ? pt.at("ts").as_int64()
                           : static_cast<std::int64_t>(pt.at("ts").as_double());
                const auto& valNode = pt.at("value");
                if (valNode.is_double()) hp.value = valNode.as_double();
                else if (valNode.is_int64()) hp.value = static_cast<double>(valNode.as_int64());
                else if (valNode.is_string()) {
                    try { hp.value = std::stod(json::value_to<std::string>(valNode)); }
                    catch (...) { continue; }
                } else continue;
                bucket.push_back(hp);
            }
        }
        return true;
    } catch (...) {
        return false;
    }
}

void backfillLoop(const std::string& db_url) {
    const int intervalMs = [] {
        try { return std::stoi(envOr("BEEMETRY_TB_BACKFILL_INTERVAL_MS", "60000")); }
        catch (...) { return 60000; }
    }();

    while (g_running.load()) {
        auto peers = loadPeers(db_url);
        TbPeer envPeer;
        if (peers.empty() && loadEnvFallbackPeer(envPeer)) peers.push_back(envPeer);
        m_peers_configured.store(peers.size(), std::memory_order_relaxed);

        for (const auto& peer : peers) {
            if (!g_running.load()) break;
            TbSession session;
            if (!tbLogin(peer, session)) continue;

            const auto mappings = loadMappings(db_url, peer.tenant_id);
            const std::int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

            const std::int64_t runId = startSyncRun(db_url, peer.peer_id, "incremental");
            std::uint64_t totalPoints = 0;
            bool anyError = false;

            // Agrupa streams por dispositivo: una sola llamada HTTP por
            // dispositivo (keys en CSV), no una por cada combinación
            // dispositivo+key. Ver comentario sobre fetchHistoryPageMulti.
            std::unordered_map<std::string, std::vector<TbSensorMapping>> mappingsByDevice;
            for (const auto& m : mappings) mappingsByDevice[m.device_uuid].push_back(m);

            for (const auto& devEntry : mappingsByDevice) {
                if (!g_running.load()) break;
                const std::string& deviceUuid = devEntry.first;
                const auto& devMappings = devEntry.second;

                // Watermark por key (cada stream avanza independiente), pero
                // la llamada HTTP pide desde el mínimo de todos — los puntos
                // ya vistos de una key que iba más adelantada se filtran
                // después, en memoria, sin gastar otra llamada.
                std::unordered_map<std::string, std::int64_t> watermarkByKey;
                std::string keysCsv;
                std::int64_t batchStartMs = nowMs;
                bool first = true;
                for (const auto& m : devMappings) {
                    std::int64_t wm = loadWatermarkMs(db_url, peer.peer_id, m.device_uuid + ":" + m.key);
                    if (wm <= 0) {
                        int lookbackDays = 7;
                        try { lookbackDays = std::stoi(envOr("BEEMETRY_TB_INITIAL_LOOKBACK_DAYS", "7")); }
                        catch (...) {}
                        wm = nowMs - static_cast<std::int64_t>(lookbackDays) * 86400000LL;
                    }
                    watermarkByKey[m.key] = wm;
                    if (first || wm < batchStartMs) { batchStartMs = wm; first = false; }
                    if (!keysCsv.empty()) keysCsv += ',';
                    keysCsv += m.key;
                }

                std::unordered_map<std::string, std::vector<HistPoint>> pointsByKey;
                std::string fetchError;
                if (!fetchHistoryPageMulti(peer.base_url, session.jwt, deviceUuid, keysCsv,
                                            batchStartMs + 1, nowMs, pointsByKey, &fetchError)) {
                    m_backfill_errors.fetch_add(1, std::memory_order_relaxed);
                    anyError = true;
                    std::cerr << "[TB_SYNC] backfill: fallo device=" << deviceUuid
                              << " " << fetchError << std::endl;
                    continue;
                }

                for (const auto& m : devMappings) {
                    const auto itp = pointsByKey.find(m.key);
                    if (itp == pointsByKey.end()) continue;
                    const std::int64_t wm = watermarkByKey[m.key];
                    std::int64_t lastTs = wm;
                    for (const auto& p : itp->second) {
                        if (p.ts_ms <= wm) continue;  // ya visto para ESTA key
                        // Descarta captured_at fuera de rango sano ANTES de
                        // tocar el watermark: si se dejara avanzar lastTs con
                        // un ts corrupto (ej. año 2065), la siguiente corrida
                        // pediría startTs > endTs (ahora) y el stream
                        // quedaría "varado" sin traer datos reales nunca más.
                        if (!isSaneCapturedAt(p.ts_ms)) {
                            m_backfill_rejected_bad_ts.fetch_add(1, std::memory_order_relaxed);
                            std::cerr << "[TB_SYNC] backfill: ts fuera de rango descartado device="
                                      << deviceUuid << " key=" << m.key << " ts_ms=" << p.ts_ms
                                      << std::endl;
                            continue;
                        }
                        mining::TelemetryRow row;
                        row.tenant_id = m.tenant_id;
                        row.sensor_id = m.sensor_id;
                        row.value_numeric = p.value;
                        row.quality_code = 0;
                        row.captured_at_epoch_ms = p.ts_ms;
                        if (mining::TelemetryIngestor::instance().enqueue(std::move(row))) {
                            ++totalPoints;
                            m_backfill_points.fetch_add(1, std::memory_order_relaxed);
                        }
                        if (p.ts_ms > lastTs) lastTs = p.ts_ms;
                    }
                    if (lastTs > wm) saveWatermarkMs(db_url, peer.peer_id, m.device_uuid + ":" + m.key, lastTs);
                }
            }

            finishSyncRun(db_url, runId, !anyError, totalPoints,
                          anyError ? "uno o más streams fallaron; ver logs" : "");
            m_backfill_runs.fetch_add(1, std::memory_order_relaxed);
        }

        for (int waited = 0; waited < intervalMs && g_running.load(); waited += 500) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
    }
}

// ── Tiempo real (WebSocket) ────────────────────────────────────────────────
// Suscripción clásica de ThingsBoard (tsSubCmds por entidad) — formato
// estable y ampliamente documentado de su API pública de telemetría por
// WebSocket. Verificado 2026-08-25 contra el ThingsBoard real de producción
// (board.beemetry.com, v4.3.1.3): el push real es
// {"subscriptionId":1,"errorCode":0,"errorMsg":null,"data":{...},"latestValues":{...}}
// — confirma que "subscriptionId" == "cmdId" de la suscripción, como asume
// el fix de resolución O(1) más abajo.
//
// Envía y recibe la suscripción sobre un stream WS ya conectado (y, si
// aplica, con el handshake TLS ya hecho) — común a las dos ramas (TLS/no
// TLS) de realtimeLoop(), que solo difieren en cómo se arma ese stream.
template <typename WsStream>
void runWsSession(WsStream& ws,
                   const std::unordered_map<std::string, std::vector<std::string>>& keysByDevice,
                   const std::unordered_map<std::string, TbSensorMapping>& byStream) {
    // cmdId -> device_uuid: ThingsBoard devuelve "subscriptionId" en cada
    // push, igual al "cmdId" que se mandó en el comando de suscripción
    // correspondiente. Esto permite resolver el dispositivo de un push por
    // lookup O(1) en vez de recorrer todo el mapa de streams comparando por
    // nombre de key — a la escala de miles de dispositivos, ese recorrido
    // lineal por cada dato entrante era un cuello de botella real de CPU,
    // además de poder asignar un dato al dispositivo equivocado si dos
    // dispositivos comparten el mismo nombre de key.
    // Enviar TODA la suscripción en un solo mensaje ("tsSubCmds": [...miles
    // de dispositivos...]) rompe silenciosamente contra ThingsBoard real: no
    // hay error, no hay log de ningún lado — el servidor simplemente cierra
    // la sesión WS con un cierre "correcto" del protocolo apenas se pasa de
    // cierto tamaño. Medido empíricamente contra board.beemetry.com/local
    // (2026-08-28): estable hasta 3.500 streams (70 dispositivos x 50 keys)
    // en un solo mensaje, falla de forma consistente desde 4.000 (80
    // dispositivos). Se manda en lotes bien por debajo de ese umbral, como
    // mensajes de suscripción separados sobre la MISMA conexión ya abierta
    // (ThingsBoard acepta comandos de suscripción incrementales sobre una
    // sesión existente — es como arma sus suscripciones un dashboard real
    // con muchos widgets, no una particularidad de este cliente).
    constexpr std::size_t kMaxDevicesPerSubBatch = 40;
    std::unordered_map<int, std::string> cmdIdToDevice;
    std::vector<json::object> subCmds;
    {
        int cmdId = 1;
        for (const auto& kv : keysByDevice) {
            json::object cmd;
            cmd["entityType"] = "DEVICE";
            cmd["entityId"] = kv.first;
            // "keys" es un string separado por comas, NO un array JSON —
            // verificado contra un ThingsBoard real (v4.3.1.3): con array
            // el servidor acepta la suscripción (errorCode 0) pero nunca
            // empuja datos; con string sí llegan los push en tiempo real.
            std::string keysCsv;
            for (std::size_t i = 0; i < kv.second.size(); ++i) {
                if (i) keysCsv += ',';
                keysCsv += kv.second[i];
            }
            cmd["keys"] = keysCsv;
            cmd["cmdId"] = cmdId;
            cmdIdToDevice[cmdId] = kv.first;
            ++cmdId;
            subCmds.push_back(std::move(cmd));
        }
    }

    std::mutex writeMutex;
    auto sendAllBatches = [&]() {
        std::lock_guard<std::mutex> lock(writeMutex);
        json::array batch;
        for (const auto& cmd : subCmds) {
            batch.push_back(cmd);
            if (batch.size() >= kMaxDevicesPerSubBatch) {
                json::object subMsg;
                subMsg["tsSubCmds"] = batch;
                subMsg["historyCmds"] = json::array{};
                subMsg["attrSubCmds"] = json::array{};
                ws.write(asio::buffer(json::serialize(subMsg)));
                batch = json::array{};
            }
        }
        if (!batch.empty()) {
            json::object subMsg;
            subMsg["tsSubCmds"] = batch;
            subMsg["historyCmds"] = json::array{};
            subMsg["attrSubCmds"] = json::array{};
            ws.write(asio::buffer(json::serialize(subMsg)));
        }
    };
    sendAllBatches();  // suscripción inicial

    // Hallazgo en prueba de carga sostenida (2026-08-29, 25k streams/seg
    // durante 60 min): la suscripción puede "perderse" del lado de
    // ThingsBoard SIN NINGÚN aviso — el socket queda sano (TCP establecido,
    // sin datos en tránsito, sin retransmisiones) y ThingsBoard sigue
    // persistiendo telemetría real fresca (confirmado vía REST, <1s de
    // antigüedad, para dispositivos de todos los lotes), pero deja de
    // empujar por este WS sin cerrar la sesión ni mandar ningún error.
    // websocket::error::closed nunca dispara porque el servidor no cierra
    // nada — simplemente deja de notificar. Mitigación defensiva: re-enviar
    // la suscripción completa cada 45s mientras dure la sesión, sin esperar
    // a un error que en este caso nunca llega.
    std::atomic<bool> sessionAlive{true};
    std::thread resubscribeThread([&]() {
        while (sessionAlive.load() && g_running.load()) {
            for (int waited = 0; waited < 45 && sessionAlive.load() && g_running.load(); ++waited) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
            if (!sessionAlive.load() || !g_running.load()) break;
            try {
                sendAllBatches();
            } catch (...) {
                break;  // el hilo de lectura detecta y reporta el problema real
            }
        }
    });

    beast::flat_buffer buffer;
    while (g_running.load()) {
        buffer.clear();
        beast::error_code ec;
        ws.read(buffer, ec);
        if (ec) {
            if (ec != websocket::error::closed) {
                m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
            }
            std::cerr << "[TB_SYNC] realtime: WS cerrado/error ec=" << ec.message() << std::endl;
            break;  // reconectar en el while externo
        }
        const std::string msg = beast::buffers_to_string(buffer.data());
        try {
            const auto payload = json::parse(msg);
            if (!payload.is_object()) continue;
            const auto& obj = payload.as_object();
            if (!obj.if_contains("data") || !obj.at("data").is_object()) continue;

            // Resuelve el dispositivo del push por "subscriptionId" (== cmdId
            // de la suscripción, ver arriba) — O(1) contra cmdIdToDevice.
            std::string deviceUuid;
            if (obj.if_contains("subscriptionId")) {
                const auto& sidNode = obj.at("subscriptionId");
                const int sid = sidNode.is_int64() ? static_cast<int>(sidNode.as_int64())
                                : sidNode.is_double() ? static_cast<int>(sidNode.as_double())
                                : -1;
                const auto dit = cmdIdToDevice.find(sid);
                if (dit != cmdIdToDevice.end()) deviceUuid = dit->second;
            }

            for (const auto& kv2 : obj.at("data").as_object()) {
                const std::string key = kv2.key();
                if (!kv2.value().is_array()) continue;
                for (const auto& sample : kv2.value().as_array()) {
                    if (!sample.is_array() || sample.as_array().size() < 2) continue;
                    const auto& pair = sample.as_array();
                    const std::int64_t ts = pair[0].is_int64()
                        ? pair[0].as_int64()
                        : static_cast<std::int64_t>(pair[0].as_double());
                    double val = 0.0;
                    bool valOk = true;
                    if (pair[1].is_double()) val = pair[1].as_double();
                    else if (pair[1].is_int64()) val = static_cast<double>(pair[1].as_int64());
                    else if (pair[1].is_string()) {
                        try { val = std::stod(json::value_to<std::string>(pair[1])); }
                        catch (...) { valOk = false; }
                    } else valOk = false;
                    if (!valOk) continue;
                    if (!isSaneCapturedAt(ts)) {
                        m_realtime_rejected_bad_ts.fetch_add(1, std::memory_order_relaxed);
                        // Detalle a nivel dispositivo+key: sin esto, el contador
                        // agregado no le sirve a nadie para ir a corregir el
                        // dispositivo real que sigue mandando timestamps
                        // corruptos en producción (hallazgo de ADR-054: RTC sin
                        // sincronizar, unidad mal escalada, o timestamp fijo en
                        // atributos de configuración).
                        std::cerr << "[TB_SYNC] realtime: ts fuera de rango descartado device="
                                  << (deviceUuid.empty() ? "?" : deviceUuid) << " key=" << key
                                  << " ts_ms=" << ts << std::endl;
                        continue;
                    }

                    bool mapped = false;
                    if (!deviceUuid.empty()) {
                        // Camino rápido O(1): dispositivo ya resuelto por subscriptionId.
                        const auto it = byStream.find(deviceUuid + ":" + key);
                        if (it != byStream.end()) {
                            mining::TelemetryRow row;
                            row.tenant_id = it->second.tenant_id;
                            row.sensor_id = it->second.sensor_id;
                            row.value_numeric = val;
                            row.captured_at_epoch_ms = ts;
                            if (mining::TelemetryIngestor::instance().enqueue(std::move(row))) {
                                m_realtime_points.fetch_add(1, std::memory_order_relaxed);
                            }
                            mapped = true;
                        }
                    } else {
                        // Respaldo O(n): sin subscriptionId reconocible (no
                        // debería pasar contra el protocolo verificado, ver
                        // comentario arriba), busca por nombre de key contra
                        // cualquier dispositivo mapeado que la tenga.
                        for (const auto& bs : byStream) {
                            if (bs.second.key != key) continue;
                            mining::TelemetryRow row;
                            row.tenant_id = bs.second.tenant_id;
                            row.sensor_id = bs.second.sensor_id;
                            row.value_numeric = val;
                            row.captured_at_epoch_ms = ts;
                            if (mining::TelemetryIngestor::instance().enqueue(std::move(row))) {
                                m_realtime_points.fetch_add(1, std::memory_order_relaxed);
                            }
                            mapped = true;
                            break;
                        }
                    }
                    if (!mapped) {
                        m_realtime_dropped.fetch_add(1, std::memory_order_relaxed);
                    }
                }
            }
        } catch (...) {
            m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
        }
    }
    sessionAlive.store(false);
    resubscribeThread.join();
}

void realtimeLoop(const TbPeer& peer, const std::string& db_url) {
    while (g_running.load()) {
        TbSession session;
        if (!tbLogin(peer, session)) {
            std::this_thread::sleep_for(std::chrono::seconds(10));
            continue;
        }

        ParsedUrl u;
        if (!parseBaseUrl(peer.base_url, u)) return;

        const auto mappings = loadMappings(db_url, peer.tenant_id);
        if (mappings.empty()) {
            std::this_thread::sleep_for(std::chrono::seconds(30));
            continue;
        }
        // sensor lookup por "device_uuid:key" para resolver mensajes entrantes.
        std::unordered_map<std::string, TbSensorMapping> byStream;
        // Agrupa keys por dispositivo para armar un tsSubCmd por entidad.
        std::unordered_map<std::string, std::vector<std::string>> keysByDevice;
        for (const auto& m : mappings) {
            byStream[m.device_uuid + ":" + m.key] = m;
            keysByDevice[m.device_uuid].push_back(m.key);
        }

        const std::string wsTarget =
            u.base_path + "/api/ws/plugins/telemetry?token=" + session.jwt;

        // ThingsBoard real de producción (board.beemetry.com) es HTTPS/WSS
        // puro, sin balanceador que termine TLS antes — confirmado
        // 2026-08-25. Antes esta función solo sabía construir un
        // websocket::stream<tcp_stream> plano; contra un endpoint TLS eso
        // ni siquiera falla con un error claro, intenta un handshake WS de
        // texto plano contra un puerto que espera TLS y se cuelga/rompe de
        // forma confusa. Rama explícita por u.tls, mismo patrón SSL que
        // http_client.cpp (ADR-103).
        try {
            if (u.tls) {
                asio::io_context ioc;
                tcp::resolver resolver{ioc};
                ssl::context ctx{ssl::context::tlsv12_client};
                ctx.set_default_verify_paths();
                ctx.set_verify_mode(ssl::verify_peer);
                websocket::stream<beast::ssl_stream<beast::tcp_stream>> ws{ioc, ctx};

                if (!SSL_set_tlsext_host_name(ws.next_layer().native_handle(), u.host.c_str())) {
                    throw std::runtime_error("sni_set_failed");
                }
                const auto results = resolver.resolve(u.host, u.port);
                beast::get_lowest_layer(ws).connect(results);
                ws.next_layer().handshake(ssl::stream_base::client);
                beast::get_lowest_layer(ws).expires_never();

                ws.set_option(websocket::stream_base::decorator(
                    [](websocket::request_type& req) {
                        req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
                    }));
                ws.handshake(u.host, wsTarget);
                m_ws_connects.fetch_add(1, std::memory_order_relaxed);

                runWsSession(ws, keysByDevice, byStream);
            } else {
                asio::io_context ioc;
                tcp::resolver resolver{ioc};
                websocket::stream<beast::tcp_stream> ws{ioc};

                const auto results = resolver.resolve(u.host, u.port);
                beast::get_lowest_layer(ws).connect(results);
                beast::get_lowest_layer(ws).expires_never();

                ws.set_option(websocket::stream_base::decorator(
                    [](websocket::request_type& req) {
                        req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
                    }));
                ws.handshake(u.host, wsTarget);
                m_ws_connects.fetch_add(1, std::memory_order_relaxed);

                runWsSession(ws, keysByDevice, byStream);
            }
        } catch (const std::exception& e) {
            m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
            std::cerr << "[TB_SYNC] realtime: excepcion peer=" << peer.peer_id
                      << " what=" << e.what() << std::endl;
        }

        if (!g_running.load()) break;
        m_ws_reconnects.fetch_add(1, std::memory_order_relaxed);
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }
}

void realtimeSupervisor(const std::string& db_url) {
    // Un hilo de tiempo real por peer activo — releído periódicamente por si
    // se agrega/quita un peer sin reiniciar el backend (mismo criterio que
    // protocol_adapter_sources en protocol_adapters.cpp).
    std::vector<std::thread> peerThreads;
    auto peers = loadPeers(db_url);
    TbPeer envPeer;
    if (peers.empty() && loadEnvFallbackPeer(envPeer)) peers.push_back(envPeer);
    for (const auto& peer : peers) {
        peerThreads.emplace_back(realtimeLoop, peer, db_url);
    }
    for (auto& t : peerThreads) if (t.joinable()) t.join();
}

} // namespace

void startThingsBoardSync(const std::string& db_url) {
    bool expected = false;
    if (!g_running.compare_exchange_strong(expected, true)) return;
    if (!envFlag("BEEMETRY_THINGSBOARD_SYNC_ENABLED", false)) {
        g_running.store(false);
        std::cout << "[TB_SYNC] deshabilitado (BEEMETRY_THINGSBOARD_SYNC_ENABLED=false) — "
                     "integración con sistema externo del cliente, opt-in explícito."
                  << std::endl;
        return;
    }
    g_db_url = db_url;
    std::cout << "[TB_SYNC] iniciando sincronización con ThingsBoard (backfill + tiempo real)"
              << std::endl;
    g_threads.emplace_back(backfillLoop, db_url);
    g_threads.emplace_back(realtimeSupervisor, db_url);
}

void stopThingsBoardSync() {
    g_running.store(false);
    for (auto& t : g_threads) if (t.joinable()) t.join();
    g_threads.clear();
}

ThingsBoardSyncStats thingsBoardSyncStats() {
    ThingsBoardSyncStats s;
    s.enabled = g_running.load();
    s.peers_configured = m_peers_configured.load();
    s.peers_authenticated = m_peers_authenticated.load();
    s.login_failures = m_login_failures.load();
    s.backfill_runs = m_backfill_runs.load();
    s.backfill_points_ingested = m_backfill_points.load();
    s.backfill_errors = m_backfill_errors.load();
    s.realtime_ws_connects = m_ws_connects.load();
    s.realtime_ws_reconnects = m_ws_reconnects.load();
    s.realtime_points_ingested = m_realtime_points.load();
    s.realtime_points_dropped_unmapped = m_realtime_dropped.load();
    s.realtime_errors = m_realtime_errors.load();
    s.backfill_points_rejected_bad_ts = m_backfill_rejected_bad_ts.load();
    s.realtime_points_rejected_bad_ts = m_realtime_rejected_bad_ts.load();
    return s;
}

} // namespace tbsync
} // namespace mining

#else  // !HAS_LIBPQ

namespace mining {
namespace tbsync {
void startThingsBoardSync(const std::string&) {}
void stopThingsBoardSync() {}
ThingsBoardSyncStats thingsBoardSyncStats() { return {}; }
} // namespace tbsync
} // namespace mining

#endif // HAS_LIBPQ
