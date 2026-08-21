#pragma once

// map_aggregator.hpp — Agregador en memoria + push diferencial de
// marcadores de mapa por tenant (ADR: cierra la brecha "el pipeline de
// telemetría en tiempo real y la capa de mapa son dos sistemas
// desconectados" -- ver memoria de sesión).
//
// Diseño: hilo de fondo, período fijo (kPollIntervalMs), que para cada
// tenant con al menos una sesión WS activa (WsRegistry::tenantsWithListeners,
// así no se hace trabajo de diff para tenants sin nadie escuchando) vuelve a
// leer el mismo UNION map_markers+sensors que expone /api/map/markers,
// compara contra el último snapshot en memoria de ese tenant, y si hay
// diferencias, empuja SOLO el diff (agregados/actualizados/eliminados) por
// WS -- no el snapshot completo. Formato JSON simple e inspeccionable (el
// wire format binario compacto para "modo campo" es responsabilidad del
// cliente/tarea 5, no de este agregador).
//
// Nota deliberada: se optó por polling periódico en vez de enganchar un
// callback dentro de telemetry_ingest.cpp (el ingestor real hace batching a
// batch_size_/flush_ms_ configurable, ver TelemetryIngestor::flushLoop --
// engancharle un callback por-fila ahí sería invasivo y arriesgado de tocar
// sin motivo; el propio brief de esta tarea permite "periódicamente O en
// evento de ingesta", así que polling cumple el contrato sin ese riesgo).

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

namespace mining {

class MapAggregator {
public:
    static MapAggregator &instance();

    /** @brief Arranca el hilo de polling (no-op si ya está corriendo). databaseUrl: cadena de conexión Postgres a usar en cada ciclo. */
    void start(const std::string &databaseUrl, int pollIntervalMs = 1500);

    void stop();

private:
    MapAggregator() = default;
    ~MapAggregator();

    void loop();
    void pollTenant(const std::string &tenantId);

    std::atomic<bool> running_{false};
    std::thread thread_;
    std::string databaseUrl_;
    int pollIntervalMs_ = 1500;

    // Último snapshot conocido por tenant: id de marcador -> hash de sus
    // campos relevantes (lat/lng/status/updated_at concatenados). Comparar
    // hashes en vez de objetos completos evita retener 2x el payload por
    // tenant en memoria para 10k sensores.
    std::mutex snapshotMutex_;
    std::unordered_map<std::string, std::unordered_map<std::string, std::string>> lastSnapshotByTenant_;
};

} // namespace mining
