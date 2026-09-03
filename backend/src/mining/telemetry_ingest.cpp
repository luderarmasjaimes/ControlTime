// --------------------------------------------------------------------------
// telemetry_ingest.cpp — implementación del ingestor de telemetría
// --------------------------------------------------------------------------
#include "telemetry_ingest.hpp"

#if HAS_LIBPQ

#if __has_include(<libpq-fe.h>)
#  include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#  include <postgresql/libpq-fe.h>
#endif

#include <algorithm>
#include <chrono>
#include <cstring>
#include <iostream>
#include <thread>

#include "config/constants.hpp"
#include "storage/pg_result.hpp"

#if HAVE_RDKAFKA
#include <librdkafka/rdkafkacpp.h>
#endif

namespace mining {

#if HAVE_RDKAFKA
namespace {

class TelemetryDeliveryReportCb final : public RdKafka::DeliveryReportCb {
public:
    TelemetryDeliveryReportCb(std::atomic<std::uint64_t>& delivered,
                              std::atomic<std::uint64_t>& errors)
        : delivered_(delivered), errors_(errors) {}

    void dr_cb(RdKafka::Message& message) override {
        if (message.err() == RdKafka::ERR_NO_ERROR) {
            delivered_.fetch_add(1, std::memory_order_relaxed);
        } else {
            errors_.fetch_add(1, std::memory_order_relaxed);
        }
    }

private:
    std::atomic<std::uint64_t>& delivered_;
    std::atomic<std::uint64_t>& errors_;
};

std::int64_t nowUnixEpochMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

} // namespace
#endif

TelemetryIngestor& TelemetryIngestor::instance() {
    static TelemetryIngestor inst;
    return inst;
}

TelemetryIngestor::~TelemetryIngestor() { stop(); }

void TelemetryIngestor::configureKafka(const std::string& brokers,
                                       const std::string& topic,
                                       const std::string& group,
                                       std::size_t consumer_workers,
                                       int copy_retry_ms) {
#if HAVE_RDKAFKA
    kafka_brokers_ = brokers;
    kafka_topic_ = topic;
    kafka_group_ = group;
    consumer_worker_count_ = std::max<std::size_t>(1, consumer_workers);
    copy_retry_ms_ = std::max(10, copy_retry_ms);
    mode_ = Mode::Kafka;
#else
    (void)brokers; (void)topic; (void)group; (void)consumer_workers;
    (void)copy_retry_ms;
    std::cerr << "[TELEMETRY] Kafka solicitado pero binario sin HAVE_RDKAFKA; "
                 "usando modo directo." << std::endl;
#endif
}

void TelemetryIngestor::start(const std::string& db_url, std::size_t batch_size,
                              int flush_ms, std::size_t max_queue) {
    bool expected = false;
    if (!running_.compare_exchange_strong(expected, true)) {
        return;  // ya arrancado
    }
    db_url_ = db_url;
    batch_size_ = batch_size ? batch_size : config::telemetry::kDefaultBatchSize;
    flush_ms_ = flush_ms > 0 ? flush_ms : config::telemetry::kDefaultFlushMs;
    max_queue_ = max_queue ? max_queue : config::telemetry::kDefaultMaxQueue;
    queue_.reserve(batch_size_ * config::telemetry::kQueueReserveFactor);

    loadSensorCache();

#if HAVE_RDKAFKA
    if (mode_ == Mode::Kafka) {
        bool kafka_ok = kafkaInitProducer();
        consumers_.reserve(consumer_worker_count_);
        kafka_conns_.assign(consumer_worker_count_, nullptr);
        for (std::size_t i = 0; kafka_ok && i < consumer_worker_count_; ++i) {
            void* consumer = kafkaCreateConsumer(i);
            if (!consumer) kafka_ok = false;
            else consumers_.push_back(consumer);
        }
        if (kafka_ok && consumers_.size() == consumer_worker_count_) {
            // Drenar delivery reports aun cuando cese el tráfico. Sin este
            // hilo las últimas confirmaciones quedaban en outq.
            producer_poll_thread_ = std::thread([this] {
                auto* p = static_cast<RdKafka::Producer*>(producer_);
                while (running_.load()) p->poll(50);
            });
            consumer_threads_.reserve(consumer_worker_count_);
            for (std::size_t i = 0; i < consumer_worker_count_; ++i) {
                consumer_threads_.emplace_back([this, i] { consumerLoop(i); });
            }
            std::cout << "[TELEMETRY] Ingestor started mode=KAFKA brokers="
                      << kafka_brokers_ << " topic=" << kafka_topic_
                      << " group=" << kafka_group_ << " batch=" << batch_size_
                      << " workers=" << consumer_worker_count_
                      << " sensors_cached=" << sensor_cache_.size() << std::endl;
            return;
        }
        for (void* raw : consumers_) {
            auto* c = static_cast<RdKafka::KafkaConsumer*>(raw);
            c->close();
            delete c;
        }
        consumers_.clear();
        kafka_conns_.clear();
        if (producer_) {
            delete static_cast<RdKafka::Producer*>(producer_);
            producer_ = nullptr;
        }
        delete static_cast<TelemetryDeliveryReportCb*>(delivery_cb_);
        delivery_cb_ = nullptr;
        std::cerr << "[TELEMETRY] Kafka init falló; fallback a modo directo."
                  << std::endl;
        mode_ = Mode::Direct;
    }
#endif

    flusher_ = std::thread([this] { flushLoop(); });
    std::cout << "[TELEMETRY] Ingestor started mode=DIRECT batch=" << batch_size_
              << " flush_ms=" << flush_ms_ << " max_queue=" << max_queue_
              << " sensors_cached=" << sensor_cache_.size() << std::endl;
}

void TelemetryIngestor::stop() {
    bool expected = true;
    if (!running_.compare_exchange_strong(expected, false)) {
        return;
    }
    q_cv_.notify_all();
    if (flusher_.joinable()) flusher_.join();
    for (auto& thread : consumer_threads_) {
        if (thread.joinable()) thread.join();
    }
    consumer_threads_.clear();
#if HAVE_RDKAFKA
    if (producer_poll_thread_.joinable()) producer_poll_thread_.join();
    if (producer_) {
        static_cast<RdKafka::Producer*>(producer_)->flush(5000);
        delete static_cast<RdKafka::Producer*>(producer_);
        producer_ = nullptr;
    }
    for (void* raw : consumers_) {
        auto* consumer = static_cast<RdKafka::KafkaConsumer*>(raw);
        consumer->close();
        delete consumer;
    }
    consumers_.clear();
    delete static_cast<TelemetryDeliveryReportCb*>(delivery_cb_);
    delivery_cb_ = nullptr;
#endif
    for (void*& raw : kafka_conns_) {
        if (raw) PQfinish(static_cast<PGconn*>(raw));
        raw = nullptr;
    }
    kafka_conns_.clear();
    if (conn_) {
        PQfinish(static_cast<PGconn*>(conn_));
        conn_ = nullptr;
    }
}

void TelemetryIngestor::loadSensorCache() {
    // Conexión y resultado con RAII (storage::PgConn/PgResult): limpieza
    // determinista aunque haya un return temprano. La consulta vive ahora en
    // el stored procedure sp_load_active_sensors() (ver 30_refactor_*.sql),
    // desacoplando el esquema del binario C++.
    storage::PgConn conn{PQconnectdb(db_url_.c_str())};
    if (!conn.ok()) {
        std::cerr << "[TELEMETRY] cache load: connection failed: "
                  << conn.error() << std::endl;
        return;
    }
    storage::PgResult res{
        PQexec(conn.get(), "SELECT * FROM sp_load_active_sensors()")};
    if (!res.okTuples()) {
        std::cerr << "[TELEMETRY] cache load query failed: " << res.error()
                  << std::endl;
        return;
    }
    const int n = PQntuples(res.get());
    sensor_cache_.reserve(static_cast<std::size_t>(n) *
                          config::telemetry::kSensorCacheReserveFactor);
    for (int i = 0; i < n; ++i) {
        sensor_cache_.emplace(
            PQgetvalue(res.get(), i, 0),
            std::make_pair(std::string(PQgetvalue(res.get(), i, 1)),
                           std::string(PQgetvalue(res.get(), i, 2))));
    }
}

bool TelemetryIngestor::resolveSensor(const std::string& code,
                                      std::string& sensor_id,
                                      std::string& tenant_id) const {
    auto it = sensor_cache_.find(code);
    if (it == sensor_cache_.end()) return false;
    sensor_id = it->second.first;
    tenant_id = it->second.second;
    return true;
}

bool TelemetryIngestor::enqueue(TelemetryRow&& row) {
#if HAVE_RDKAFKA
    // En modo Kafka el flusher_ (drena queue_ -> COPY) no se arranca — solo
    // corre consumer_thread_ (Kafka -> COPY). Encolar aquí sin producir a
    // Kafka dejaría la fila varada en memoria para siempre (visto en vivo:
    // integración ThingsBoard con mapas_backend_telemetry_queued creciendo
    // y _inserted_total en 0). Mismo camino que ingestLine() ya usaba.
    if (mode_ == Mode::Kafka) {
        if (!produceRow(row)) return false;
        m_received_.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
#endif
    {
        std::lock_guard<std::mutex> lk(q_mtx_);
        if (queue_.size() >= max_queue_) {
            m_dropped_full_.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        queue_.push_back(std::move(row));
    }
    m_received_.fetch_add(1, std::memory_order_relaxed);
    q_cv_.notify_one();
    return true;
}

bool TelemetryIngestor::ingestLine(const std::string& line) {
    // Formato: "<sensor_code>,<value_numeric>[,<quality_code>]"
    const auto p1 = line.find(',');
    if (p1 == std::string::npos) return false;
    std::string code = line.substr(0, p1);
    const auto p2 = line.find(',', p1 + 1);
    std::string valStr = (p2 == std::string::npos)
                             ? line.substr(p1 + 1)
                             : line.substr(p1 + 1, p2 - p1 - 1);

    TelemetryRow row;
    if (!resolveSensor(code, row.sensor_id, row.tenant_id)) {
        m_dropped_unknown_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    try {
        row.value_numeric = std::stod(valStr);
    } catch (...) {
        return false;
    }
    if (p2 != std::string::npos) {
        try { row.quality_code = std::stoi(line.substr(p2 + 1)); }
        catch (...) { row.quality_code = 0; }
    }

#if HAVE_RDKAFKA
    if (mode_ == Mode::Kafka) {
        if (!produceRow(row)) return false;
        m_received_.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
#endif
    return enqueue(std::move(row));
}

bool TelemetryIngestor::ensureConn(void*& connection) {
    PGconn* c = static_cast<PGconn*>(connection);
    if (c && PQstatus(c) == CONNECTION_OK) return true;
    if (c) {
        PQfinish(c);
        connection = nullptr;
    }
    c = PQconnectdb(db_url_.c_str());
    if (PQstatus(c) != CONNECTION_OK) {
        PQfinish(c);
        connection = nullptr;
        return false;
    }
    // La conexión de ingesta NUNCA debe ser matada por statement_timeout
    // (gobierno aplicado a dashboards). Un COPY largo bajo contención no debe
    // perder el lote. Aislamos esta sesión.
    // El servidor usa synchronous_commit=off para tráfico general, pero el
    // consumidor no puede confirmar offsets sobre una transacción cuyo WAL
    // aún no es durable. Esta sesión de ingesta lo fuerza a ON.
    PGresult* r = PQexec(c,
        "SET statement_timeout = 0; SET synchronous_commit = on; "
        "SET application_name = 'telemetry-copy-worker'; "
        "CREATE TEMP TABLE IF NOT EXISTS telemetry_ingest_stage ("
        "tenant_id uuid NOT NULL, sensor_id uuid NOT NULL, "
        "captured_at timestamptz NOT NULL, value_numeric double precision, "
        "quality_code smallint NOT NULL, kafka_partition integer, "
        "kafka_offset bigint) ON COMMIT PRESERVE ROWS");
    if (!r || PQresultStatus(r) != PGRES_COMMAND_OK) {
        if (r) PQclear(r);
        PQfinish(c);
        connection = nullptr;
        return false;
    }
    PQclear(r);
    connection = c;
    return true;
}

// ── ADR-008: COPY binario ──────────────────────────────────────────────
// Formato binario nativo de PostgreSQL (COPY ... WITH (FORMAT binary)):
// firma de 11 bytes + flags(int32=0) + longitud de extensión(int32=0),
// luego por fila: int16 con la cantidad de campos, y por campo un int32 de
// longitud (o -1 para NULL) seguido de esa cantidad de bytes en la
// representación binaria del tipo de columna (big-endian / network order).
// Evita el parseo de texto→número en el servidor en el hot path de ingesta,
// que es justamente lo que este ADR pide ("COPY binario maximiza el
// throughput de escritura").
namespace {

void appendBE16(std::string& buf, std::int16_t v) {
    const auto u = static_cast<std::uint16_t>(v);
    const char b[2] = {static_cast<char>((u >> 8) & 0xFF),
                       static_cast<char>(u & 0xFF)};
    buf.append(b, 2);
}

void appendBE32(std::string& buf, std::int32_t v) {
    const auto u = static_cast<std::uint32_t>(v);
    const char b[4] = {
        static_cast<char>((u >> 24) & 0xFF), static_cast<char>((u >> 16) & 0xFF),
        static_cast<char>((u >> 8) & 0xFF), static_cast<char>(u & 0xFF)};
    buf.append(b, 4);
}

void appendBE64(std::string& buf, std::int64_t v) {
    const auto u = static_cast<std::uint64_t>(v);
    char b[8];
    for (int i = 0; i < 8; ++i) {
        b[i] = static_cast<char>((u >> (56 - 8 * i)) & 0xFF);
    }
    buf.append(b, 8);
}

void appendBEDouble(std::string& buf, double d) {
    std::uint64_t bits;
    std::memcpy(&bits, &d, sizeof(bits));
    appendBE64(buf, static_cast<std::int64_t>(bits));
}

/** @brief Parsea un UUID con guiones ("xxxxxxxx-xxxx-...") a sus 16 bytes crudos (formato binario nativo de la columna uuid). */
bool parseUuidBytes(const std::string& s, unsigned char out[16]) {
    std::string hex;
    hex.reserve(32);
    for (char ch : s) {
        if (ch != '-') hex.push_back(ch);
    }
    if (hex.size() != 32) return false;
    auto hexVal = [](char ch) -> int {
        if (ch >= '0' && ch <= '9') return ch - '0';
        if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
        if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
        return -1;
    };
    for (int i = 0; i < 16; ++i) {
        const int hi = hexVal(hex[static_cast<std::size_t>(i * 2)]);
        const int lo = hexVal(hex[static_cast<std::size_t>(i * 2 + 1)]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<unsigned char>((hi << 4) | lo);
    }
    return true;
}

void appendUuidField(std::string& buf, const std::string& uuidText, bool& okOut) {
    unsigned char raw[16];
    if (!parseUuidBytes(uuidText, raw)) {
        okOut = false;
        return;
    }
    appendBE32(buf, 16);
    buf.append(reinterpret_cast<const char*>(raw), 16);
}

constexpr std::int64_t kPgEpochOffsetMicros = 946684800LL * 1000000LL;  // 2000-01-01 - 1970-01-01

/** @brief Microsegundos desde el epoch de Postgres (2000-01-01 UTC), representación binaria de timestamptz. */
std::int64_t nowPgTimestampMicros() {
    using namespace std::chrono;
    const auto usSinceUnixEpoch =
        duration_cast<microseconds>(system_clock::now().time_since_epoch()).count();
    return usSinceUnixEpoch - kPgEpochOffsetMicros;
}

/** @brief Igual que nowPgTimestampMicros() pero para un epoch-ms explícito
 * (backfill histórico) en vez de "ahora". */
std::int64_t epochMsToPgTimestampMicros(std::int64_t epochMs) {
    return epochMs * 1000LL - kPgEpochOffsetMicros;
}

constexpr char kBinaryCopySignature[11] = {'P', 'G', 'C', 'O', 'P', 'Y',
                                           '\n', '\xFF', '\r', '\n', '\0'};

} // namespace

bool TelemetryIngestor::copyBatch(const std::vector<TelemetryRow>& batch,
                                  void*& connection) {
    if (batch.empty()) return true;
    if (!ensureConn(connection)) {
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    PGconn* c = static_cast<PGconn*>(connection);

    PGresult* tx = PQexec(c, "BEGIN; TRUNCATE telemetry_ingest_stage");
    if (!tx || PQresultStatus(tx) != PGRES_COMMAND_OK) {
        if (tx) PQclear(tx);
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        PQfinish(c);
        connection = nullptr;
        return false;
    }
    PQclear(tx);

    PGresult* res = PQexec(
        c,
        "COPY telemetry_ingest_stage (tenant_id, sensor_id, captured_at, "
        "value_numeric, quality_code, kafka_partition, kafka_offset) "
        "FROM STDIN WITH (FORMAT binary)");
    if (!res || PQresultStatus(res) != PGRES_COPY_IN) {
        if (res) PQclear(res);
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        // Forzar reconexión en el próximo intento
        PQfinish(c);
        connection = nullptr;
        return false;
    }
    PQclear(res);

    std::string header;
    header.reserve(19);
    header.append(kBinaryCopySignature, sizeof(kBinaryCopySignature));
    appendBE32(header, 0);  // flags
    appendBE32(header, 0);  // longitud de extensión de cabecera
    bool ok = PQputCopyData(c, header.data(), static_cast<int>(header.size())) == 1;

    const std::int64_t capturedAtMicros = nowPgTimestampMicros();
    std::string rowBuf;
    rowBuf.reserve(64);
    for (std::size_t i = 0; ok && i < batch.size(); ++i) {
        const auto& r = batch[i];
        rowBuf.clear();
        appendBE16(rowBuf, 7);  // 7 campos por fila

        bool uuidOk = true;
        appendUuidField(rowBuf, r.tenant_id, uuidOk);
        appendUuidField(rowBuf, r.sensor_id, uuidOk);
        if (!uuidOk) {
            // UUID malformado (no debería ocurrir: viene de sensor_cache_
            // resuelto contra la BD) — se descarta la fila, no todo el lote.
            m_dropped_unknown_.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        appendBE32(rowBuf, 8);  // captured_at: timestamptz = int64
        appendBE64(rowBuf, r.captured_at_epoch_ms > 0
                                ? epochMsToPgTimestampMicros(r.captured_at_epoch_ms)
                                : capturedAtMicros);

        appendBE32(rowBuf, 8);  // value_numeric: double precision = float8
        appendBEDouble(rowBuf, r.value_numeric);

        appendBE32(rowBuf, 2);  // quality_code: smallint = int16
        appendBE16(rowBuf, static_cast<std::int16_t>(r.quality_code));

        if (r.kafka_partition >= 0) {
            appendBE32(rowBuf, 4);
            appendBE32(rowBuf, r.kafka_partition);
        } else {
            appendBE32(rowBuf, -1);
        }
        if (r.kafka_offset >= 0) {
            appendBE32(rowBuf, 8);
            appendBE64(rowBuf, r.kafka_offset);
        } else {
            appendBE32(rowBuf, -1);
        }

        if (PQputCopyData(c, rowBuf.data(), static_cast<int>(rowBuf.size())) != 1) {
            ok = false;
        }
    }

    if (ok) {
        std::string trailer;
        appendBE16(trailer, -1);  // -1 en el conteo de campos = fin de datos
        ok = PQputCopyData(c, trailer.data(), static_cast<int>(trailer.size())) == 1;
    }

    if (PQputCopyEnd(c, ok ? nullptr : "ingest aborted") != 1) ok = false;

    PGresult* fin = PQgetResult(c);
    if (!fin || PQresultStatus(fin) != PGRES_COMMAND_OK) ok = false;
    if (fin) PQclear(fin);
    // Drenar resultados pendientes
    while ((fin = PQgetResult(c)) != nullptr) PQclear(fin);

    std::uint64_t inserted = 0;
    if (ok) {
        PGresult* merge = PQexec(c,
            "INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, "
            "value_numeric, quality_code, kafka_partition, kafka_offset) "
            "SELECT tenant_id, sensor_id, captured_at, value_numeric, "
            "quality_code, kafka_partition, kafka_offset "
            "FROM telemetry_ingest_stage "
            "ON CONFLICT (captured_at, kafka_partition, kafka_offset) "
            "WHERE kafka_partition IS NOT NULL AND kafka_offset IS NOT NULL "
            "DO NOTHING");
        if (!merge || PQresultStatus(merge) != PGRES_COMMAND_OK) {
            ok = false;
        } else {
            const char* tuples = PQcmdTuples(merge);
            if (tuples && *tuples) inserted = std::stoull(tuples);
        }
        if (merge) PQclear(merge);
    }
    // ADR-131: dual-write hacia el modelo consolidado (telemetry_fact) en la
    // MISMA transacción que el INSERT de arriba — o ambas tablas quedan
    // consistentes, o ninguna (el ROLLBACK de abajo cubre las dos). Mantiene
    // dim_tenant/dim_sensor al día para cualquier tenant/sensor nuevo que
    // llegue en el lote sin haber pasado por el backfill manual
    // (78_telemetry_fact_backfill.sql) — join contra tenants/sensors (fuente
    // real), no contra telemetry_ingest_stage, para capturar nombre/tipo
    // reales en vez de un placeholder.
    if (ok) {
        PGresult* dimTenant = PQexec(c,
            "INSERT INTO dim_tenant (tenant_id, display_name) "
            "SELECT DISTINCT t.tenant_id, t.tenant_name "
            "FROM telemetry_ingest_stage s "
            "JOIN tenants t ON t.tenant_id = s.tenant_id "
            "WHERE NOT EXISTS (SELECT 1 FROM dim_tenant dt WHERE dt.tenant_id = s.tenant_id) "
            "ON CONFLICT (tenant_id) DO NOTHING");
        if (!dimTenant || PQresultStatus(dimTenant) != PGRES_COMMAND_OK) ok = false;
        if (dimTenant) PQclear(dimTenant);
    }
    if (ok) {
        PGresult* dimSensor = PQexec(c,
            "INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, "
            "site_id_sk, sensor_code, sensor_type, unit, is_active) "
            "SELECT DISTINCT 'iot_v2', sn.sensor_id, dt.tenant_id_sk, dsi.site_id_sk, "
            "sn.sensor_code, sn.sensor_type, sn.unit, sn.is_active "
            "FROM telemetry_ingest_stage s "
            "JOIN sensors sn ON sn.sensor_id = s.sensor_id "
            "JOIN dim_tenant dt ON dt.tenant_id = sn.tenant_id "
            "LEFT JOIN dim_site dsi ON dsi.site_id = sn.site_id "
            "WHERE NOT EXISTS (SELECT 1 FROM dim_sensor ds WHERE ds.sensor_id = sn.sensor_id) "
            "ON CONFLICT (sensor_id) DO NOTHING");
        if (!dimSensor || PQresultStatus(dimSensor) != PGRES_COMMAND_OK) ok = false;
        if (dimSensor) PQclear(dimSensor);
    }
    if (ok) {
        PGresult* factMerge = PQexec(c,
            "INSERT INTO telemetry_fact (tenant_id_sk, sensor_id_sk, channel_id, "
            "captured_at, value_numeric, quality_code, kafka_partition, kafka_offset) "
            "SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, s.captured_at, "
            "s.value_numeric::real, s.quality_code, s.kafka_partition, s.kafka_offset "
            "FROM telemetry_ingest_stage s "
            "JOIN dim_sensor ds ON ds.sensor_id = s.sensor_id "
            "ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING");
        if (!factMerge || PQresultStatus(factMerge) != PGRES_COMMAND_OK) ok = false;
        if (factMerge) PQclear(factMerge);
    }
    if (ok) {
        PGresult* commit = PQexec(c, "COMMIT");
        ok = commit && PQresultStatus(commit) == PGRES_COMMAND_OK;
        if (commit) PQclear(commit);
    }
    if (ok) {
        m_inserted_.fetch_add(inserted, std::memory_order_relaxed);
        m_deduplicated_.fetch_add(batch.size() - inserted,
                                  std::memory_order_relaxed);
        // ADR-140: motor de alarmas en tiempo real. `batch` ya está COMMIT-
        // eado (durable) en este punto -- evaluar contra un lote que todavía
        // pudiera hacer ROLLBACK produciría alarmas fantasma. Nunca debe
        // poder tumbar la ingesta: cualquier excepción se registra y se
        // descarta, el hilo de flush/consumo sigue con el próximo lote.
        if (on_batch_committed_) {
            try {
                on_batch_committed_(batch);
            } catch (const std::exception& e) {
                std::cerr << "[TELEMETRY] on_batch_committed_ (alarmas tiempo real) "
                             "lanzó excepción, ignorada: " << e.what() << std::endl;
            } catch (...) {
                std::cerr << "[TELEMETRY] on_batch_committed_ (alarmas tiempo real) "
                             "lanzó excepción no-std, ignorada" << std::endl;
            }
        }
    } else {
        PGresult* rollback = PQexec(c, "ROLLBACK");
        if (rollback) PQclear(rollback);
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        PQfinish(c);
        connection = nullptr;
    }
    return ok;
}

// ===================== Kafka / Redpanda =====================
#if HAVE_RDKAFKA

bool TelemetryIngestor::kafkaInitProducer() {
    std::string err;
    RdKafka::Conf* conf = RdKafka::Conf::create(RdKafka::Conf::CONF_GLOBAL);
    conf->set("bootstrap.servers", kafka_brokers_, err);
    conf->set("enable.idempotence", "true", err);
    conf->set("acks", "all", err);
    conf->set("compression.type", "lz4", err);
    conf->set("linger.ms", "5", err);
    conf->set("batch.num.messages", "10000", err);
    conf->set("queue.buffering.max.messages", "1000000", err);
    conf->set("queue.buffering.max.kbytes", "262144", err);
    conf->set("message.timeout.ms", "120000", err);
    delivery_cb_ = new TelemetryDeliveryReportCb(m_delivered_, m_delivery_errors_);
    conf->set("dr_cb", static_cast<RdKafka::DeliveryReportCb*>(delivery_cb_), err);
    RdKafka::Producer* p = RdKafka::Producer::create(conf, err);
    delete conf;
    if (!p) {
        std::cerr << "[TELEMETRY] producer create fail: " << err << std::endl;
        delete static_cast<TelemetryDeliveryReportCb*>(delivery_cb_);
        delivery_cb_ = nullptr;
        return false;
    }
    producer_ = p;
    return true;
}

void* TelemetryIngestor::kafkaCreateConsumer(std::size_t worker_index) {
    std::string err;
    RdKafka::Conf* conf = RdKafka::Conf::create(RdKafka::Conf::CONF_GLOBAL);
    conf->set("bootstrap.servers", kafka_brokers_, err);
    conf->set("group.id", kafka_group_, err);
    conf->set("client.id", "telemetry-writer-" + std::to_string(worker_index), err);
    conf->set("enable.auto.commit", "false", err);   // commit manual tras COPY
    conf->set("enable.auto.offset.store", "true", err);
    conf->set("auto.offset.reset", "earliest", err);
    // Una caída breve de DB no debe provocar rebalance mientras el worker
    // conserva y reintenta el mismo lote.
    conf->set("max.poll.interval.ms", "3600000", err);
    conf->set("session.timeout.ms", "45000", err);
    conf->set("fetch.min.bytes", "65536", err);
    conf->set("fetch.wait.max.ms", "50", err);
    conf->set("max.partition.fetch.bytes", "10485760", err);
    RdKafka::KafkaConsumer* c = RdKafka::KafkaConsumer::create(conf, err);
    delete conf;
    if (!c) {
        std::cerr << "[TELEMETRY] consumer create fail: " << err << std::endl;
        return nullptr;
    }
    std::vector<std::string> topics{kafka_topic_};
    RdKafka::ErrorCode e = c->subscribe(topics);
    if (e) {
        std::cerr << "[TELEMETRY] subscribe fail: " << RdKafka::err2str(e)
                  << std::endl;
        delete c;
        return nullptr;
    }
    return c;
}

bool TelemetryIngestor::produceRow(TelemetryRow& row) {
    RdKafka::Producer* p = static_cast<RdKafka::Producer*>(producer_);
    if (!p) return false;
    if (row.captured_at_epoch_ms <= 0) row.captured_at_epoch_ms = nowUnixEpochMs();
    // Payload compacto: tenant\tsensor\tvalue\tquality\tcaptured_at_epoch_ms
    // (key=sensor → partición). El 5to campo es nuevo; consumerLoop() lo
    // trata como opcional (mensajes viejos en el topic sin ese campo siguen
    // parseando bien, quedan con captured_at_epoch_ms=0 = comportamiento
    // legacy "now" en copyBatch()).
    std::string payload;
    payload.reserve(112);
    payload += row.tenant_id; payload += '\t';
    payload += row.sensor_id; payload += '\t';
    payload += std::to_string(row.value_numeric); payload += '\t';
    payload += std::to_string(row.quality_code); payload += '\t';
    payload += std::to_string(row.captured_at_epoch_ms);
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(250);
    for (;;) {
        RdKafka::ErrorCode e = p->produce(
            kafka_topic_, RdKafka::Topic::PARTITION_UA,
            RdKafka::Producer::RK_MSG_COPY,
            const_cast<char*>(payload.data()), payload.size(),
            row.sensor_id.data(), row.sensor_id.size(), 0, nullptr);
        if (e == RdKafka::ERR_NO_ERROR) {
            m_produced_.fetch_add(1, std::memory_order_relaxed);
            p->poll(0);
            return true;
        }
        if (e != RdKafka::ERR__QUEUE_FULL ||
            std::chrono::steady_clock::now() >= deadline) {
            m_produce_errors_.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        // Backpressure acotado: servir delivery callbacks libera el out-queue.
        p->poll(5);
    }
}

void TelemetryIngestor::consumerLoop(std::size_t worker_index) {
    auto* c = static_cast<RdKafka::KafkaConsumer*>(consumers_[worker_index]);
    void*& connection = kafka_conns_[worker_index];
    std::vector<TelemetryRow> batch;
    batch.reserve(batch_size_ * 2);
    auto last_flush = std::chrono::steady_clock::now();

    auto flush = [&]() -> bool {
        if (batch.empty()) return true;
        std::uint64_t prev = m_batch_max_.load(std::memory_order_relaxed);
        if (batch.size() > prev)
            m_batch_max_.store(batch.size(), std::memory_order_relaxed);

        bool marked_stalled = false;
        int retry_ms = copy_retry_ms_;
        while (running_.load() && !copyBatch(batch, connection)) {
            m_copy_retries_.fetch_add(1, std::memory_order_relaxed);
            if (!marked_stalled) {
                m_stalled_workers_.fetch_add(1, std::memory_order_relaxed);
                marked_stalled = true;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(retry_ms));
            retry_ms = std::min(retry_ms * 2, 5000);
        }
        if (marked_stalled)
            m_stalled_workers_.fetch_sub(1, std::memory_order_relaxed);
        if (!running_.load()) return false;

        // El lote ya es durable e idempotente. Si el commit falla por un
        // rebalance, volver a consume() permite reasignar; cualquier replay
        // se elimina por (captured_at, partition, offset). No usar poll() en
        // KafkaConsumer: librdkafka requiere consume() para esta API.
        const RdKafka::ErrorCode commit_error = c->commitSync();
        if (commit_error == RdKafka::ERR_NO_ERROR) {
            m_commits_.fetch_add(1, std::memory_order_relaxed);
        } else {
            m_commit_errors_.fetch_add(1, std::memory_order_relaxed);
        }
        m_flushes_.fetch_add(1, std::memory_order_relaxed);
        batch.clear();
        return true;
    };

    while (running_.load()) {
        RdKafka::Message* msg = c->consume(200);  // timeout ms
        if (msg->err() == RdKafka::ERR_NO_ERROR) {
            // parse "tenant\tsensor\tvalue\tquality[\tcaptured_at_ms]"
            const char* d = static_cast<const char*>(msg->payload());
            std::string s(d, msg->len());
            std::size_t a = s.find('\t');
            std::size_t b = s.find('\t', a + 1);
            std::size_t cc = s.find('\t', b + 1);
            if (a != std::string::npos && b != std::string::npos &&
                cc != std::string::npos) {
                TelemetryRow r;
                r.kafka_partition = msg->partition();
                r.kafka_offset = msg->offset();
                r.tenant_id = s.substr(0, a);
                r.sensor_id = s.substr(a + 1, b - a - 1);
                // 5to campo (captured_at_epoch_ms) es opcional: mensajes
                // producidos antes de esta extensión no lo traen.
                std::size_t dd = s.find('\t', cc + 1);
                try { r.value_numeric = std::stod(s.substr(b + 1, cc - b - 1)); }
                catch (...) { r.value_numeric = 0; }
                std::string qualityPart = (dd == std::string::npos)
                    ? s.substr(cc + 1) : s.substr(cc + 1, dd - cc - 1);
                try { r.quality_code = std::stoi(qualityPart); }
                catch (...) { r.quality_code = 0; }
                if (dd != std::string::npos) {
                    try { r.captured_at_epoch_ms = std::stoll(s.substr(dd + 1)); }
                    catch (...) { r.captured_at_epoch_ms = 0; }
                }
                batch.push_back(std::move(r));
                m_consumed_.fetch_add(1, std::memory_order_relaxed);
            } else {
                m_malformed_.fetch_add(1, std::memory_order_relaxed);
            }
        }
        delete msg;

        auto now = std::chrono::steady_clock::now();
        bool by_size = batch.size() >= batch_size_;
        bool by_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                           now - last_flush).count() >= flush_ms_;
        if (by_size || (by_time && !batch.empty())) {
            if (!flush()) break;
            last_flush = now;
        }
    }
    // Al apagar no se fuerza COPY: el batch queda sin commit y Kafka lo
    // reentrega en el próximo arranque. Esto prioriza pérdida cero.
}

#endif // HAVE_RDKAFKA

void TelemetryIngestor::flushLoop() {
    std::vector<TelemetryRow> local;
    local.reserve(batch_size_ * 2);

    while (running_.load()) {
        {
            std::unique_lock<std::mutex> lk(q_mtx_);
            q_cv_.wait_for(lk, std::chrono::milliseconds(flush_ms_), [this] {
                return queue_.size() >= batch_size_ || !running_.load();
            });
            if (!queue_.empty()) {
                local.swap(queue_);
                queue_.reserve(batch_size_ * 2);
            }
        }

        if (!local.empty()) {
            std::uint64_t prev = m_batch_max_.load(std::memory_order_relaxed);
            if (local.size() > prev)
                m_batch_max_.store(local.size(), std::memory_order_relaxed);

            // Acotar cada COPY a un máximo de filas: bajo contención un COPY
            // gigante puede tardar mucho; si falla, solo se pierde este sub-lote
            // (no toda la cola). 10K es un buen balance throughput/riesgo.
            const std::size_t kCopyCap = 10000;
            for (std::size_t off = 0; off < local.size(); off += kCopyCap) {
                const std::size_t n = std::min(kCopyCap, local.size() - off);
                std::vector<TelemetryRow> chunk(local.begin() + off,
                                                local.begin() + off + n);
                copyBatch(chunk, conn_);
                m_flushes_.fetch_add(1, std::memory_order_relaxed);
            }
            local.clear();
        }
    }

    // Flush final al apagar
    {
        std::lock_guard<std::mutex> lk(q_mtx_);
        if (!queue_.empty()) local.swap(queue_);
    }
    if (!local.empty()) copyBatch(local, conn_);
}

TelemetryIngestor::Stats TelemetryIngestor::stats() const {
    Stats s;
    s.received = m_received_.load(std::memory_order_relaxed);
    s.inserted = m_inserted_.load(std::memory_order_relaxed);
    s.dropped_full = m_dropped_full_.load(std::memory_order_relaxed);
    s.dropped_unknown = m_dropped_unknown_.load(std::memory_order_relaxed);
    s.flushes = m_flushes_.load(std::memory_order_relaxed);
    s.flush_errors = m_flush_errors_.load(std::memory_order_relaxed);
    s.batch_max = m_batch_max_.load(std::memory_order_relaxed);
    s.sensors_cached = sensor_cache_.size();
    s.produced = m_produced_.load(std::memory_order_relaxed);
    s.delivered = m_delivered_.load(std::memory_order_relaxed);
    s.produce_errors = m_produce_errors_.load(std::memory_order_relaxed);
    s.delivery_errors = m_delivery_errors_.load(std::memory_order_relaxed);
    s.consumed = m_consumed_.load(std::memory_order_relaxed);
    s.commits = m_commits_.load(std::memory_order_relaxed);
    s.commit_errors = m_commit_errors_.load(std::memory_order_relaxed);
    s.copy_retries = m_copy_retries_.load(std::memory_order_relaxed);
    s.malformed = m_malformed_.load(std::memory_order_relaxed);
    s.deduplicated = m_deduplicated_.load(std::memory_order_relaxed);
    s.consumer_workers = consumers_.size();
    s.stalled_workers = m_stalled_workers_.load(std::memory_order_relaxed);
#if HAVE_RDKAFKA
    if (producer_)
        s.producer_outq = static_cast<RdKafka::Producer*>(producer_)->outq_len();
#endif
    s.mode = (mode_ == Mode::Kafka) ? "kafka" : "direct";
    {
        std::lock_guard<std::mutex> lk(q_mtx_);
        s.queued = queue_.size();
    }
    return s;
}

} // namespace mining

#endif // HAS_LIBPQ
