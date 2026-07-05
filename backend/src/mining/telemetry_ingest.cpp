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

#include <chrono>
#include <cstdio>
#include <ctime>
#include <iostream>

#include "config/constants.hpp"
#include "storage/pg_result.hpp"

#if HAVE_RDKAFKA
#include <librdkafka/rdkafkacpp.h>
#endif

namespace mining {

TelemetryIngestor& TelemetryIngestor::instance() {
    static TelemetryIngestor inst;
    return inst;
}

TelemetryIngestor::~TelemetryIngestor() { stop(); }

void TelemetryIngestor::configureKafka(const std::string& brokers,
                                       const std::string& topic,
                                       const std::string& group) {
#if HAVE_RDKAFKA
    kafka_brokers_ = brokers;
    kafka_topic_ = topic;
    kafka_group_ = group;
    mode_ = Mode::Kafka;
#else
    (void)brokers; (void)topic; (void)group;
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
        if (kafkaInitProducer() && kafkaInitConsumer()) {
            consumer_thread_ = std::thread([this] { consumerLoop(); });
            std::cout << "[TELEMETRY] Ingestor started mode=KAFKA brokers="
                      << kafka_brokers_ << " topic=" << kafka_topic_
                      << " group=" << kafka_group_ << " batch=" << batch_size_
                      << " sensors_cached=" << sensor_cache_.size() << std::endl;
            return;
        }
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
    if (consumer_thread_.joinable()) consumer_thread_.join();
#if HAVE_RDKAFKA
    if (producer_) {
        static_cast<RdKafka::Producer*>(producer_)->flush(5000);
        delete static_cast<RdKafka::Producer*>(producer_);
        producer_ = nullptr;
    }
    if (consumer_) {
        static_cast<RdKafka::KafkaConsumer*>(consumer_)->close();
        delete static_cast<RdKafka::KafkaConsumer*>(consumer_);
        consumer_ = nullptr;
    }
#endif
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
        produceRow(row);   // durable en Redpanda; el consumidor hace COPY
        m_received_.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
#endif
    return enqueue(std::move(row));
}

bool TelemetryIngestor::ensureConn() {
    PGconn* c = static_cast<PGconn*>(conn_);
    if (c && PQstatus(c) == CONNECTION_OK) return true;
    if (c) {
        PQfinish(c);
        conn_ = nullptr;
    }
    c = PQconnectdb(db_url_.c_str());
    if (PQstatus(c) != CONNECTION_OK) {
        PQfinish(c);
        conn_ = nullptr;
        return false;
    }
    // La conexión de ingesta NUNCA debe ser matada por statement_timeout
    // (gobierno aplicado a dashboards). Un COPY largo bajo contención no debe
    // perder el lote. Aislamos esta sesión.
    PGresult* r = PQexec(c, "SET statement_timeout = 0");
    if (r) PQclear(r);
    conn_ = c;
    return true;
}

static std::string nowTimestampUtc() {
    using namespace std::chrono;
    auto now = system_clock::now();
    auto ms = duration_cast<milliseconds>(now.time_since_epoch()) % 1000;
    std::time_t t = system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[40];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%03d+00",
                  tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour,
                  tm.tm_min, tm.tm_sec, static_cast<int>(ms.count()));
    return std::string(buf);
}

bool TelemetryIngestor::copyBatch(const std::vector<TelemetryRow>& batch) {
    if (batch.empty()) return true;
    if (!ensureConn()) {
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    PGconn* c = static_cast<PGconn*>(conn_);

    PGresult* res = PQexec(
        c,
        "COPY telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric, "
        "quality_code) FROM STDIN");
    if (!res || PQresultStatus(res) != PGRES_COPY_IN) {
        if (res) PQclear(res);
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        // Forzar reconexión en el próximo intento
        PQfinish(c);
        conn_ = nullptr;
        return false;
    }
    PQclear(res);

    const std::string ts = nowTimestampUtc();
    std::string lineBuf;
    lineBuf.reserve(128);
    bool ok = true;
    for (const auto& r : batch) {
        lineBuf.clear();
        lineBuf += r.tenant_id;
        lineBuf += '\t';
        lineBuf += r.sensor_id;
        lineBuf += '\t';
        lineBuf += ts;
        lineBuf += '\t';
        lineBuf += std::to_string(r.value_numeric);
        lineBuf += '\t';
        lineBuf += std::to_string(r.quality_code);
        lineBuf += '\n';
        if (PQputCopyData(c, lineBuf.data(),
                          static_cast<int>(lineBuf.size())) != 1) {
            ok = false;
            break;
        }
    }

    if (PQputCopyEnd(c, ok ? nullptr : "ingest aborted") != 1) ok = false;

    PGresult* fin = PQgetResult(c);
    if (!fin || PQresultStatus(fin) != PGRES_COMMAND_OK) ok = false;
    if (fin) PQclear(fin);
    // Drenar resultados pendientes
    while ((fin = PQgetResult(c)) != nullptr) PQclear(fin);

    if (ok) {
        m_inserted_.fetch_add(batch.size(), std::memory_order_relaxed);
    } else {
        m_flush_errors_.fetch_add(1, std::memory_order_relaxed);
        PQfinish(c);
        conn_ = nullptr;
    }
    return ok;
}

// ===================== Kafka / Redpanda =====================
#if HAVE_RDKAFKA

bool TelemetryIngestor::kafkaInitProducer() {
    std::string err;
    RdKafka::Conf* conf = RdKafka::Conf::create(RdKafka::Conf::CONF_GLOBAL);
    conf->set("bootstrap.servers", kafka_brokers_, err);
    conf->set("compression.type", "lz4", err);
    conf->set("linger.ms", "20", err);          // micro-batching del productor
    conf->set("batch.num.messages", "10000", err);
    conf->set("queue.buffering.max.messages", "1000000", err);
    conf->set("acks", "1", err);                // durabilidad razonable/latencia
    RdKafka::Producer* p = RdKafka::Producer::create(conf, err);
    delete conf;
    if (!p) {
        std::cerr << "[TELEMETRY] producer create fail: " << err << std::endl;
        return false;
    }
    producer_ = p;
    return true;
}

bool TelemetryIngestor::kafkaInitConsumer() {
    std::string err;
    RdKafka::Conf* conf = RdKafka::Conf::create(RdKafka::Conf::CONF_GLOBAL);
    conf->set("bootstrap.servers", kafka_brokers_, err);
    conf->set("group.id", kafka_group_, err);
    conf->set("enable.auto.commit", "false", err);   // commit manual tras COPY
    conf->set("auto.offset.reset", "earliest", err);
    conf->set("fetch.min.bytes", "1", err);
    conf->set("max.partition.fetch.bytes", "10485760", err);
    RdKafka::KafkaConsumer* c = RdKafka::KafkaConsumer::create(conf, err);
    delete conf;
    if (!c) {
        std::cerr << "[TELEMETRY] consumer create fail: " << err << std::endl;
        return false;
    }
    std::vector<std::string> topics{kafka_topic_};
    RdKafka::ErrorCode e = c->subscribe(topics);
    if (e) {
        std::cerr << "[TELEMETRY] subscribe fail: " << RdKafka::err2str(e)
                  << std::endl;
        delete c;
        return false;
    }
    consumer_ = c;
    return true;
}

void TelemetryIngestor::produceRow(const TelemetryRow& row) {
    RdKafka::Producer* p = static_cast<RdKafka::Producer*>(producer_);
    if (!p) return;
    // Payload compacto: tenant\tsensor\tvalue\tquality  (key=sensor → partición)
    std::string payload;
    payload.reserve(96);
    payload += row.tenant_id; payload += '\t';
    payload += row.sensor_id; payload += '\t';
    payload += std::to_string(row.value_numeric); payload += '\t';
    payload += std::to_string(row.quality_code);
    RdKafka::ErrorCode e = p->produce(
        kafka_topic_, RdKafka::Topic::PARTITION_UA,
        RdKafka::Producer::RK_MSG_COPY,
        const_cast<char*>(payload.data()), payload.size(),
        row.sensor_id.data(), row.sensor_id.size(), 0, nullptr);
    if (e != RdKafka::ERR_NO_ERROR) {
        m_produce_errors_.fetch_add(1, std::memory_order_relaxed);
        if (e == RdKafka::ERR__QUEUE_FULL) p->poll(10);
    } else {
        m_produced_.fetch_add(1, std::memory_order_relaxed);
    }
    p->poll(0);  // sirve callbacks de entrega
}

void TelemetryIngestor::consumerLoop() {
    RdKafka::KafkaConsumer* c = static_cast<RdKafka::KafkaConsumer*>(consumer_);
    std::vector<TelemetryRow> batch;
    batch.reserve(batch_size_ * 2);
    auto last_flush = std::chrono::steady_clock::now();

    auto flush = [&]() {
        if (batch.empty()) return;
        std::uint64_t prev = m_batch_max_.load(std::memory_order_relaxed);
        if (batch.size() > prev)
            m_batch_max_.store(batch.size(), std::memory_order_relaxed);
        if (copyBatch(batch)) {
            // Commit de offsets SOLO tras COPY exitoso → at-least-once (durable)
            c->commitSync();
            m_commits_.fetch_add(1, std::memory_order_relaxed);
        }
        m_flushes_.fetch_add(1, std::memory_order_relaxed);
        batch.clear();
    };

    while (running_.load()) {
        RdKafka::Message* msg = c->consume(200);  // timeout ms
        if (msg->err() == RdKafka::ERR_NO_ERROR) {
            // parse "tenant\tsensor\tvalue\tquality"
            const char* d = static_cast<const char*>(msg->payload());
            std::string s(d, msg->len());
            std::size_t a = s.find('\t');
            std::size_t b = s.find('\t', a + 1);
            std::size_t cc = s.find('\t', b + 1);
            if (a != std::string::npos && b != std::string::npos &&
                cc != std::string::npos) {
                TelemetryRow r;
                r.tenant_id = s.substr(0, a);
                r.sensor_id = s.substr(a + 1, b - a - 1);
                try { r.value_numeric = std::stod(s.substr(b + 1, cc - b - 1)); }
                catch (...) { r.value_numeric = 0; }
                try { r.quality_code = std::stoi(s.substr(cc + 1)); }
                catch (...) { r.quality_code = 0; }
                batch.push_back(std::move(r));
                m_consumed_.fetch_add(1, std::memory_order_relaxed);
            }
        }
        delete msg;

        auto now = std::chrono::steady_clock::now();
        bool by_size = batch.size() >= batch_size_;
        bool by_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                           now - last_flush).count() >= flush_ms_;
        if (by_size || (by_time && !batch.empty())) {
            flush();
            last_flush = now;
        }
    }
    flush();  // último lote al apagar
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
                copyBatch(chunk);
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
    if (!local.empty()) copyBatch(local);
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
    s.produce_errors = m_produce_errors_.load(std::memory_order_relaxed);
    s.consumed = m_consumed_.load(std::memory_order_relaxed);
    s.commits = m_commits_.load(std::memory_order_relaxed);
    s.mode = (mode_ == Mode::Kafka) ? "kafka" : "direct";
    {
        std::lock_guard<std::mutex> lk(q_mtx_);
        s.queued = queue_.size();
    }
    return s;
}

} // namespace mining

#endif // HAS_LIBPQ
