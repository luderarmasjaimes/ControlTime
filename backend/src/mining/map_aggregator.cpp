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
#include <iostream>

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
        for (auto &tenantId : tenants) {
            if (!running_.load()) break;
            pollTenant(tenantId);
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
    // Mismo UNION que /api/map/markers (map_routes.cpp), sin bbox/limit --
    // el agregador necesita ver el universo completo del tenant para poder
    // detectar altas/bajas correctamente; el recorte por viewport es
    // responsabilidad del fetch inicial del cliente, no de este diff.
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT * FROM ("
        "  SELECT id::text AS id, type, lat, lng, name, status, updated_at::text AS updated_at "
        "  FROM map_markers WHERE tenant_id = $1::uuid "
        "  UNION ALL "
        "  SELECT sensor_id::text AS id, 'sensor' AS type, lat, lng, sensor_name AS name, "
        "         connection_status AS status, last_seen_at::text AS updated_at "
        "  FROM sensors WHERE tenant_id = $1::uuid AND is_active = true "
        "    AND lat IS NOT NULL AND lng IS NOT NULL"
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
        // "Hash" barato: concatenación de campos que importan para el
        // render del mapa. No es criptográfico, solo detección de cambio.
        current[id] = type + "|" + lat + "|" + lng + "|" + name + "|" + status + "|" + updatedAt;
        currentObjs[id] = json::object{{"id", id},       {"type", type},
                                       {"lat", std::stod(lat)}, {"lng", std::stod(lng)},
                                       {"name", name},   {"status", status},
                                       {"updated_at", updatedAt}};
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
