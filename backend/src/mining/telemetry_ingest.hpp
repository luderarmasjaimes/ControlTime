// --------------------------------------------------------------------------
// telemetry_ingest.hpp — Ingesta durable de telemetría de alta tasa (25K/s)
// --------------------------------------------------------------------------
// Diseño:
//   - Caché en memoria sensor_code -> (sensor_id, tenant_id): evita lookup por
//     mensaje y permite validar sin tocar la BD en el hot path.
//   - Cola acotada thread-safe: los hilos del mining_gateway hacen enqueue().
//   - Hilo flusher: drena por lotes (N filas o cada flush_ms) e inserta con
//     COPY (camino más rápido de libpq) a telemetry_raw.
//   - Conexión PG persistente y dedicada al flusher (reconexión automática).
//   - Métricas atómicas para /api/metrics.
// --------------------------------------------------------------------------
#pragma once

// Detección de libpq igual que auth_storage_pg.hpp. #ifndef evita redefinir
// si otro header (incluido antes en la misma TU) ya la fijó.
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  elif __has_include(<postgresql/libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#if HAS_LIBPQ

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace mining {

struct TelemetryRow {
    std::string tenant_id;  // uuid (texto)
    std::string sensor_id;  // uuid (texto)
    double value_numeric{0.0};
    int quality_code{0};
    // Marca de tiempo explícita de captura (epoch ms, UTC). 0 = sin definir:
    // el flusher usa now() al momento del COPY — comportamiento histórico
    // sin cambios para MQTT/Modbus/OPC-UA/HTTP (todos "tiempo real", el
    // dato se genera y se ingesta casi al mismo instante). Backfill/sync
    // desde una plataforma externa (ThingsBoard/AWS, ver thingsboard_sync.*)
    // SÍ necesita preservar la fecha real del dato histórico — usar este
    // campo en vez de dejarlo en 0 para esos casos.
    std::int64_t captured_at_epoch_ms{0};
    // Identidad durable asignada por Kafka. Una reentrega tras COPY exitoso
    // y commit fallido debe ser idempotente en TimescaleDB.
    std::int32_t kafka_partition{-1};
    std::int64_t kafka_offset{-1};
};

class TelemetryIngestor {
public:
    enum class Mode { Direct, Kafka };

    struct Stats {
        std::uint64_t received{0};      // líneas válidas (encoladas o producidas)
        std::uint64_t inserted{0};      // filas confirmadas en BD
        std::uint64_t dropped_full{0};  // descartadas por cola llena
        std::uint64_t dropped_unknown{0};  // sensor_code no reconocido
        std::uint64_t flushes{0};
        std::uint64_t flush_errors{0};
        std::size_t   queued{0};
        std::size_t   sensors_cached{0};
        std::uint64_t batch_max{0};
        // Kafka
        std::uint64_t produced{0};      // mensajes producidos a Kafka
        std::uint64_t delivered{0};     // confirmados por el broker
        std::uint64_t produce_errors{0};
        std::uint64_t delivery_errors{0};
        std::uint64_t consumed{0};      // mensajes consumidos de Kafka
        std::uint64_t commits{0};       // commits de offset (lotes durables)
        std::uint64_t commit_errors{0};
        std::uint64_t copy_retries{0};
        std::uint64_t malformed{0};
        std::uint64_t deduplicated{0};
        std::size_t   consumer_workers{0};
        std::size_t   stalled_workers{0};
        std::size_t   producer_outq{0};
        const char*   mode{"direct"};
    };

    static TelemetryIngestor& instance();

    // Configura el modo de ingesta (llamar ANTES de start()).
    void configureKafka(const std::string& brokers, const std::string& topic,
                        const std::string& group,
                        std::size_t consumer_workers = 3,
                        int copy_retry_ms = 100);

    // Carga caché de sensores y arranca el pipeline (flusher o consumidor).
    void start(const std::string& db_url,
               std::size_t batch_size = 1000,
               int flush_ms = 200,
               std::size_t max_queue = 200000);
    void stop();

    // Resuelve sensor_code → ids. true si existe en la caché.
    bool resolveSensor(const std::string& code,
                       std::string& sensor_id,
                       std::string& tenant_id) const;

    // Encola una fila ya resuelta. false si la cola está llena (se descarta).
    bool enqueue(TelemetryRow&& row);

    // Conveniencia: parsea "<code>,<value>[,<quality>]", resuelve y encola.
    // Devuelve true si quedó encolada.
    bool ingestLine(const std::string& line);

    Stats stats() const;
    bool running() const { return running_.load(); }

    // Motor de alarmas en tiempo real (ADR-140, actualización 2026-09-02):
    // llamado desde copyBatch() apenas un lote queda COMMIT-eado (durable en
    // telemetry_raw/telemetry_fact), con el lote completo -- así el
    // evaluador de alarmas puede reaccionar al valor recién ingresado sin
    // esperar el ciclo de polling de 10s ni volver a leer la BD para el
    // valor actual (ya lo tiene en memoria). Debe llamarse ANTES de start()
    // (mismo criterio que configureKafka()) — este ingestor no sabe nada de
    // alarmas, solo invoca lo que le hayan registrado. Se ejecuta EN el
    // hilo de flush/consumo (flushLoop/consumerLoop), nunca en el hot path
    // de la request HTTP -- por eso debe ser barato en el caso común (sin
    // disparo) y nunca debe lanzar: copyBatch() lo envuelve en try/catch
    // para que un bug en el callback jamás tumbe la ingesta.
    void setOnBatchCommitted(std::function<void(const std::vector<TelemetryRow>&)> cb) {
        on_batch_committed_ = std::move(cb);
    }

private:
    TelemetryIngestor() = default;
    ~TelemetryIngestor();
    TelemetryIngestor(const TelemetryIngestor&) = delete;
    TelemetryIngestor& operator=(const TelemetryIngestor&) = delete;

    void flushLoop();
    void loadSensorCache();
    bool ensureConn(void*& conn);  // una conexión persistente por worker
    bool copyBatch(const std::vector<TelemetryRow>& batch, void*& conn);

    // Kafka / Redpanda
    bool kafkaInitProducer();
    void* kafkaCreateConsumer(std::size_t worker_index);
    bool produceRow(TelemetryRow& row);
    void consumerLoop(std::size_t worker_index);

    Mode mode_{Mode::Direct};
    std::string kafka_brokers_;
    std::string kafka_topic_;
    std::string kafka_group_;
    void* producer_{nullptr};    // RdKafka::Producer*
    void* delivery_cb_{nullptr}; // RdKafka::DeliveryReportCb*
    std::size_t consumer_worker_count_{3};
    int copy_retry_ms_{100};
    std::vector<void*> consumers_;      // un KafkaConsumer por worker
    std::vector<void*> kafka_conns_;    // un PGconn por worker
    std::vector<std::thread> consumer_threads_;
    std::thread producer_poll_thread_;

    std::string db_url_;
    std::size_t batch_size_{1000};
    int flush_ms_{200};
    std::size_t max_queue_{200000};

    // Caché de sensores: inmutable tras start() (lecturas concurrentes seguras).
    std::unordered_map<std::string, std::pair<std::string, std::string>> sensor_cache_;

    mutable std::mutex q_mtx_;
    std::condition_variable q_cv_;
    std::vector<TelemetryRow> queue_;

    std::thread flusher_;
    std::atomic<bool> running_{false};

    void* conn_{nullptr};  // PGconn* opaco (evita incluir libpq en el header)

    std::function<void(const std::vector<TelemetryRow>&)> on_batch_committed_;

    // Métricas
    std::atomic<std::uint64_t> m_received_{0};
    std::atomic<std::uint64_t> m_inserted_{0};
    std::atomic<std::uint64_t> m_dropped_full_{0};
    std::atomic<std::uint64_t> m_dropped_unknown_{0};
    std::atomic<std::uint64_t> m_flushes_{0};
    std::atomic<std::uint64_t> m_flush_errors_{0};
    std::atomic<std::uint64_t> m_batch_max_{0};
    std::atomic<std::uint64_t> m_produced_{0};
    std::atomic<std::uint64_t> m_delivered_{0};
    std::atomic<std::uint64_t> m_produce_errors_{0};
    std::atomic<std::uint64_t> m_delivery_errors_{0};
    std::atomic<std::uint64_t> m_consumed_{0};
    std::atomic<std::uint64_t> m_commits_{0};
    std::atomic<std::uint64_t> m_commit_errors_{0};
    std::atomic<std::uint64_t> m_copy_retries_{0};
    std::atomic<std::uint64_t> m_malformed_{0};
    std::atomic<std::uint64_t> m_deduplicated_{0};
    std::atomic<std::size_t> m_stalled_workers_{0};
};

} // namespace mining

#endif // HAS_LIBPQ
