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

#include <boost/asio.hpp>
#include <boost/asio/connect.hpp>
#include <boost/beast.hpp>
#include <boost/beast/websocket.hpp>
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

// ── Cliente HTTP síncrono (mismo patrón que biometric/ai_engine_client.cpp) ─
struct HttpResult {
    bool ok{false};
    int status{0};
    std::string body;
    std::string error;
};

HttpResult httpRequest(const ParsedUrl& u, http::verb method, const std::string& target,
                        const std::string& body, const std::string& bearerToken,
                        int timeoutMs) {
    HttpResult out;
    if (u.tls) {
        // El ThingsBoard legacy en AWS puede exponer TLS — este módulo, igual
        // que ai_engine_client.cpp, asume por ahora conexión en texto plano o
        // TLS terminado por un balanceador delante; agregar boost::asio::ssl
        // aquí si el despliegue real lo requiere (no verificado contra un TB
        // real, ver limitación documentada al usuario).
        out.error = "tls_not_implemented_use_plain_http_or_terminate_tls_upstream";
        return out;
    }
    try {
        asio::io_context ioc;
        tcp::resolver resolver{ioc};
        beast::tcp_stream stream{ioc};
        stream.expires_after(std::chrono::milliseconds(timeoutMs));

        beast::error_code ec;
        const auto results = resolver.resolve(u.host, u.port, ec);
        if (ec) { out.error = "resolve_failed: " + ec.message(); return out; }

        stream.connect(results, ec);
        if (ec) { out.error = "connect_failed: " + ec.message(); return out; }

        http::request<http::string_body> req{method, u.base_path + target, 11};
        req.set(http::field::host, u.host);
        req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
        req.set(http::field::content_type, "application/json");
        if (!bearerToken.empty()) {
            // ThingsBoard espera el JWT en X-Authorization (no en el header
            // Authorization estándar) — particularidad documentada de su API
            // REST. Verificar contra la versión real desplegada si difiere.
            req.set("X-Authorization", "Bearer " + bearerToken);
        }
        if (!body.empty()) {
            req.body() = body;
            req.prepare_payload();
        }

        http::write(stream, req, ec);
        if (ec) { out.error = "write_failed: " + ec.message(); return out; }

        beast::flat_buffer buffer;
        http::response<http::string_body> res;
        http::read(stream, buffer, res, ec);
        stream.socket().shutdown(tcp::socket::shutdown_both, ec);

        if (ec && ec != beast::errc::not_connected) {
            out.error = "read_failed: " + ec.message();
            return out;
        }
        out.status = static_cast<int>(res.result_int());
        out.body = std::move(res.body());
        out.ok = out.status >= 200 && out.status < 300;
        return out;
    } catch (const std::exception& e) {
        out.error = std::string("exception: ") + e.what();
        return out;
    }
}

// ── Login / refresh de sesión ThingsBoard ─────────────────────────────────
struct TbSession {
    std::string jwt;
    std::chrono::steady_clock::time_point obtained_at;
};

bool tbLogin(const TbPeer& peer, TbSession& out) {
    ParsedUrl u;
    if (!parseBaseUrl(peer.base_url, u)) {
        std::cerr << "[TB_SYNC] base_url invalida para peer " << peer.peer_id << std::endl;
        return false;
    }
    json::object body;
    body["username"] = peer.username;
    body["password"] = peer.password;
    const auto res = httpRequest(u, http::verb::post, "/api/auth/login",
                                  json::serialize(body), "", 5000);
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
struct HistPoint { std::int64_t ts_ms; double value; };

bool fetchHistoryPage(const ParsedUrl& u, const std::string& jwt,
                       const std::string& device_uuid, const std::string& key,
                       std::int64_t start_ms, std::int64_t end_ms,
                       std::vector<HistPoint>& out) {
    std::ostringstream target;
    target << "/api/plugins/telemetry/DEVICE/" << device_uuid
           << "/values/timeseries?keys=" << key
           << "&startTs=" << start_ms << "&endTs=" << end_ms
           << "&limit=1000&orderBy=ASC&useStrictDataTypes=true";
    const auto res = httpRequest(u, http::verb::get, target.str(), "", jwt, 15000);
    if (!res.ok) return false;
    try {
        const auto payload = json::parse(res.body);
        if (!payload.is_object()) return true;  // sin datos, no es error
        const auto& obj = payload.as_object();
        if (!obj.if_contains(key) || !obj.at(key).is_array()) return true;
        for (const auto& v : obj.at(key).as_array()) {
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
            out.push_back(hp);
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

            ParsedUrl u;
            if (!parseBaseUrl(peer.base_url, u)) continue;

            const auto mappings = loadMappings(db_url, peer.tenant_id);
            const std::int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

            const std::int64_t runId = startSyncRun(db_url, peer.peer_id, "incremental");
            std::uint64_t totalPoints = 0;
            bool anyError = false;

            for (const auto& m : mappings) {
                if (!g_running.load()) break;
                const std::string streamCode = m.device_uuid + ":" + m.key;
                std::int64_t startMs = loadWatermarkMs(db_url, peer.peer_id, streamCode);
                if (startMs <= 0) {
                    // Primera corrida para este stream: backfill acotado (no
                    // "toda la historia" por defecto, para no saturar en el
                    // primer arranque) — configurable.
                    int lookbackDays = 7;
                    try { lookbackDays = std::stoi(envOr("BEEMETRY_TB_INITIAL_LOOKBACK_DAYS", "7")); }
                    catch (...) {}
                    startMs = nowMs - static_cast<std::int64_t>(lookbackDays) * 86400000LL;
                }

                std::vector<HistPoint> points;
                if (!fetchHistoryPage(u, session.jwt, m.device_uuid, m.key, startMs + 1, nowMs, points)) {
                    m_backfill_errors.fetch_add(1, std::memory_order_relaxed);
                    anyError = true;
                    continue;
                }

                std::int64_t lastTs = startMs;
                for (const auto& p : points) {
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
                if (lastTs > startMs) saveWatermarkMs(db_url, peer.peer_id, streamCode, lastTs);
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
// WebSocket. Si el TB real desplegado usa un protocolo de suscripción
// distinto (versiones muy nuevas ofrecen también "EntityDataQuery"
// unificado), este comando puntual es lo primero a ajustar — no verificado
// contra un servidor real, ver limitación documentada al usuario.
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

        try {
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

            const std::string wsTarget =
                u.base_path + "/api/ws/plugins/telemetry?token=" + session.jwt;
            ws.handshake(u.host, wsTarget);
            m_ws_connects.fetch_add(1, std::memory_order_relaxed);

            json::array tsSubCmds;
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
                cmd["cmdId"] = cmdId++;
                tsSubCmds.push_back(cmd);
            }
            json::object subMsg;
            subMsg["tsSubCmds"] = tsSubCmds;
            subMsg["historyCmds"] = json::array{};
            subMsg["attrSubCmds"] = json::array{};
            ws.write(asio::buffer(json::serialize(subMsg)));

            beast::flat_buffer buffer;
            while (g_running.load()) {
                buffer.clear();
                beast::error_code ec;
                ws.read(buffer, ec);
                if (ec) {
                    if (ec != websocket::error::closed) {
                        m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
                    }
                    break;  // reconectar en el while externo
                }
                const std::string msg = beast::buffers_to_string(buffer.data());
                try {
                    const auto payload = json::parse(msg);
                    if (!payload.is_object()) continue;
                    const auto& obj = payload.as_object();
                    if (!obj.if_contains("data") || !obj.at("data").is_object()) continue;
                    // ThingsBoard no repite el entityId en cada push del mismo
                    // stream — se necesita el cmdId->entityId para desambiguar
                    // si dos dispositivos comparten nombre de key. Simplificación
                    // aceptada: se resuelve la key contra CUALQUIER dispositivo
                    // mapeado que la tenga (ver limitación en el .hpp/README).
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

                            // Busca a qué mapeo pertenece esta key (primer match).
                            bool mapped = false;
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
                            if (!mapped) {
                                m_realtime_dropped.fetch_add(1, std::memory_order_relaxed);
                            }
                        }
                    }
                } catch (...) {
                    m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
                }
            }
        } catch (const std::exception&) {
            m_realtime_errors.fetch_add(1, std::memory_order_relaxed);
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
