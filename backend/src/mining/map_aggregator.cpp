#include "map_aggregator.hpp"
#include "../ws_broadcast.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#if HAS_LIBPQ
#if __has_include(<libpq-fe.h>)
#  include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#  include <postgresql/libpq-fe.h>
#endif
#include "../storage/pg_pool.hpp"
#include "../storage/pg_result.hpp"
#endif

#include <boost/json.hpp>

#include <chrono>
#include <future>
#include <iostream>
#include <vector>

namespace json = boost::json;

namespace mining {

MapAggregator &MapAggregator::instance() {
    static MapAggregator inst;
    return inst;
}

MapAggregator::~MapAggregator() { stop(); }

void MapAggregator::start(const std::string &databaseUrl, int pollIntervalMs) {
    bool expected = false;
    if (!running_.compare_exchange_strong(expected, true)) return;
    databaseUrl_ = databaseUrl;
    pollIntervalMs_ = pollIntervalMs > 0 ? pollIntervalMs : 1500;
    thread_ = std::thread([this] { loop(); });
    std::cout << "[MAP_AGGREGATOR] started poll_interval_ms=" << pollIntervalMs_ << std::endl;
}

void MapAggregator::stop() {
    bool expected = true;
    if (!running_.compare_exchange_strong(expected, false)) return;
    if (thread_.joinable()) thread_.join();
}

void MapAggregator::loop() {
#if HAS_LIBPQ
    while (running_.load()) {
        auto tenants = WsRegistry::instance().tenantsWithListeners();

        // Despacho paralelo por tenant (antes: secuencial -- un tenant lento
        // o con muchos sensores demoraba el push de TODOS los demás dentro
        // del mismo ciclo, aunque son lógicamente independientes). Cada
        // pollTenant() es autocontenido: hace su propia query, calcula su
        // propio diff y empuja su propio WS update -- despacharlo vía
        // std::async hace que cada tenant reciba su actualización tan
        // pronto como SU trabajo termine, sin esperar al más lento.
        //
        // Seguro de paralelizar (estado compartido revisado):
        //   - storage::PgPool::acquire() es thread-safe (mutex interno +
        //     condition_variable, ver storage/pg_pool.hpp) -- diseñado
        //     justamente para acquire() concurrente desde múltiples hilos;
        //     cada tenant obtiene su propio Lease/PGconn, sin compartir
        //     conexión entre hilos.
        //   - snapshotMutex_ ya protege CUALQUIER acceso a
        //     lastSnapshotByTenant_ (el lock envuelve el operator[] más el
        //     cálculo del diff, no solo la escritura final), así que no hay
        //     carrera de rehash del unordered_map compartido aunque dos
        //     tenants distintos lo toquen a la vez -- solo se serializa el
        //     cómputo barato del diff, nunca la query SQL.
        //   - WsRegistry está documentado thread-safe (mutex propio, ver
        //     ws_broadcast.hpp) -- broadcastToTenant() concurrente es
        //     seguro.
        // Mismo patrón (std::async + std::future) que ya usa main.cpp para
        // despachar trabajo independiente sin bloquear la ruta principal
        // (ver cartoonFut / fetchCartoonAvatarBestEffort) -- se reutiliza en
        // vez de introducir un thread pool nuevo.
        std::vector<std::future<void>> pending;
        pending.reserve(tenants.size());
        for (auto &tenantId : tenants) {
            if (!running_.load()) break;
            pending.push_back(std::async(std::launch::async,
                                         [this, tenantId] { pollTenant(tenantId); }));
        }
        // Esperar a que el ciclo termine antes de dormir/reiniciar -- el
        // push por tenant ya ocurrió dentro de cada pollTenant() en cuanto
        // ese tenant estuvo listo; este wait solo evita acumular hilos/
        // conexiones de ciclos sucesivos si algún tenant resulta más lento
        // que pollIntervalMs_.
        for (auto &f : pending) {
            if (f.valid()) f.wait();
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(pollIntervalMs_));
    }
#else
    // Sin libpq (build sin Postgres): no hay nada que agregar, dormir es
    // más honesto que fingir progreso.
    while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(pollIntervalMs_));
    }
#endif
}

#if HAS_LIBPQ
void MapAggregator::pollTenant(const std::string &tenantId) {
    auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl_);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return;

    const char *params[1] = {tenantId.c_str()};
    // Mismo UNION que /api/map/markers (map_routes.cpp), incluido el status
    // compuesto (alarma activa > connection_status) y sensor_type, sin
    // bbox/limit -- el agregador necesita ver el universo completo del
    // tenant para poder detectar altas/bajas correctamente; el recorte por
    // viewport es responsabilidad del fetch inicial del cliente, no de este
    // diff. Ver comentario extenso en map_routes.cpp sobre por qué prevalece
    // la severidad de alarma sobre connection_status.
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT * FROM ("
        "  SELECT id::text AS id, type, lat, lng, name, status, "
        "         updated_at::text AS updated_at, NULL::text AS sensor_type "
        "  FROM map_markers WHERE tenant_id = $1::uuid "
        "  UNION ALL "
        "  SELECT s.sensor_id::text AS id, 'sensor' AS type, s.lat, s.lng, "
        "         s.sensor_name AS name, "
        "         COALESCE(alarm.severity, s.connection_status) AS status, "
        "         s.last_seen_at::text AS updated_at, "
        "         s.sensor_type AS sensor_type "
        "  FROM sensors s "
        "  LEFT JOIN LATERAL ("
        "    SELECT pa.severity FROM platform_alarms pa "
        "    JOIN platform_alarm_rules par ON par.id = pa.rule_id "
        "    WHERE par.sensor_id = s.sensor_id AND pa.resolved_at IS NULL "
        "    ORDER BY CASE pa.severity WHEN 'critical' THEN 3 "
        "                              WHEN 'warning' THEN 2 ELSE 1 END DESC "
        "    LIMIT 1"
        "  ) alarm ON true "
        "  WHERE s.tenant_id = $1::uuid AND s.is_active = true "
        "    AND s.lat IS NOT NULL AND s.lng IS NOT NULL"
        ") u",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples()) return;

    const int rows = PQntuples(res.get());
    std::unordered_map<std::string, std::string> current;
    std::unordered_map<std::string, json::object> currentObjs;
    current.reserve(static_cast<size_t>(rows));

    for (int i = 0; i < rows; ++i) {
        if (PQgetisnull(res.get(), i, 2) || PQgetisnull(res.get(), i, 3)) continue;
        const std::string id = PQgetvalue(res.get(), i, 0);
        const std::string type = PQgetvalue(res.get(), i, 1);
        const std::string lat = PQgetvalue(res.get(), i, 2);
        const std::string lng = PQgetvalue(res.get(), i, 3);
        const std::string name = PQgetisnull(res.get(), i, 4) ? "" : PQgetvalue(res.get(), i, 4);
        const std::string status = PQgetisnull(res.get(), i, 5) ? "" : PQgetvalue(res.get(), i, 5);
        const std::string updatedAt = PQgetisnull(res.get(), i, 6) ? "" : PQgetvalue(res.get(), i, 6);
        const std::string sensorType = PQgetisnull(res.get(), i, 7) ? "" : PQgetvalue(res.get(), i, 7);
        // "Hash" barato: concatenación de campos que importan para el
        // render del mapa. No es criptográfico, solo detección de cambio.
        // Incluye sensor_type por completitud aunque rara vez cambie.
        current[id] = type + "|" + lat + "|" + lng + "|" + name + "|" + status + "|" + updatedAt +
                      "|" + sensorType;
        currentObjs[id] = json::object{{"id", id},       {"type", type},
                                       {"lat", std::stod(lat)}, {"lng", std::stod(lng)},
                                       {"name", name},   {"status", status},
                                       {"updated_at", updatedAt}, {"sensor_type", sensorType}};
    }

    json::array added;
    json::array updated;
    json::array removedIds;

    {
        std::lock_guard<std::mutex> lock(snapshotMutex_);
        auto &prev = lastSnapshotByTenant_[tenantId];
        for (auto &kv : current) {
            auto it = prev.find(kv.first);
            if (it == prev.end()) {
                added.push_back(currentObjs[kv.first]);
            } else if (it->second != kv.second) {
                updated.push_back(currentObjs[kv.first]);
            }
        }
        for (auto &kv : prev) {
            if (current.find(kv.first) == current.end()) {
                removedIds.push_back(json::value(kv.first));
            }
        }
        prev = std::move(current);
    }

    if (added.empty() && updated.empty() && removedIds.empty()) return; // sin cambios: no se emite nada

    json::object diff{
        {"channel", "map_markers_diff"},
        {"tenant_id", tenantId},
        {"added", added},
        {"updated", updated},
        {"removed", removedIds},
    };
    const std::string payload = json::serialize(diff);
    const std::size_t sent = WsRegistry::instance().broadcastToTenant(tenantId, payload);
    if (sent > 0) {
        std::cout << "[MAP_AGGREGATOR] tenant=" << tenantId
                  << " added=" << added.size() << " updated=" << updated.size()
                  << " removed=" << removedIds.size() << " sent_to=" << sent << std::endl;
    }
}
#endif

} // namespace mining
