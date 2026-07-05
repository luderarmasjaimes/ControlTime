// --------------------------------------------------------------------------
// telemetry_ingest.hpp — Ingesta de telemetría de alta tasa (10K+ sensores)
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
        std::uint64_t produce_errors{0};
        std::uint64_t consumed{0};      // mensajes consumidos de Kafka
        std::uint64_t commits{0};       // commits de offset (lotes durables)
        const char*   mode{"direct"};
    };

    static TelemetryIngestor& instance();

    // Configura el modo de ingesta (llamar ANTES de start()).
    void configureKafka(const std::string& brokers, const std::string& topic,
                        const std::string& group);

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

private:
    TelemetryIngestor() = default;
    ~TelemetryIngestor();
    TelemetryIngestor(const TelemetryIngestor&) = delete;
    TelemetryIngestor& operator=(const TelemetryIngestor&) = delete;

    void flushLoop();
    void loadSensorCache();
    bool ensureConn();           // conecta/reconecta la conexión del flusher
    bool copyBatch(const std::vector<TelemetryRow>& batch);

    // Kafka / Redpanda
    bool kafkaInitProducer();
    bool kafkaInitConsumer();
    void produceRow(const TelemetryRow& row);
    void consumerLoop();         // poll Kafka -> COPY -> commit (durable)

    Mode mode_{Mode::Direct};
    std::string kafka_brokers_;
    std::string kafka_topic_;
    std::string kafka_group_;
    void* producer_{nullptr};    // RdKafka::Producer*
    void* consumer_{nullptr};    // RdKafka::KafkaConsumer*
    std::thread consumer_thread_;

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

    // Métricas
    std::atomic<std::uint64_t> m_received_{0};
    std::atomic<std::uint64_t> m_inserted_{0};
    std::atomic<std::uint64_t> m_dropped_full_{0};
    std::atomic<std::uint64_t> m_dropped_unknown_{0};
    std::atomic<std::uint64_t> m_flushes_{0};
    std::atomic<std::uint64_t> m_flush_errors_{0};
    std::atomic<std::uint64_t> m_batch_max_{0};
    std::atomic<std::uint64_t> m_produced_{0};
    std::atomic<std::uint64_t> m_produce_errors_{0};
    std::atomic<std::uint64_t> m_consumed_{0};
    std::atomic<std::uint64_t> m_commits_{0};
};

} // namespace mining

#endif // HAS_LIBPQ
