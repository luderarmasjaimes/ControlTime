// --------------------------------------------------------------------------
// pg_pool.hpp — Pool in-process de conexiones libpq (header-only)
// --------------------------------------------------------------------------
// Diseño:
//   - Singleton: una instancia global por proceso.
//   - RAII Lease: la conexión vuelve al pool en el destructor; si está en
//     estado malo (PQstatus != OK o transacción no idle) se descarta.
//   - Acquire bloqueante (sin timeout): la cola crece hasta max_size_ y luego
//     espera con condition_variable.
//   - Pool size configurable vía env PG_POOL_SIZE (default 64).
//
// Uso:
//   #include "storage/pg_pool.hpp"
//   ...
//   auto lease = storage::PgPool::instance().acquire(databaseUrl);
//   PGconn *conn = lease.get();
//   if (PQstatus(conn) != CONNECTION_OK) { return false; } // RAII descarta
//   ... PQexec(conn, ...) ...
//   // sin PQfinish — el destructor de lease lo maneja
// --------------------------------------------------------------------------
#pragma once

#if HAS_LIBPQ

#include <libpq-fe.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <mutex>
#include <string>

namespace storage {

class PgPool {
public:
    struct Stats {
        std::size_t idle{0};
        std::size_t active{0};
        std::size_t max_size{0};
        std::uint64_t acquires{0};
        std::uint64_t bad_connections{0};
        std::uint64_t waits{0};
    };

    class Lease {
    public:
        Lease() = default;
        Lease(PGconn* c, PgPool* p) noexcept : conn_(c), pool_(p) {}
        Lease(const Lease&) = delete;
        Lease& operator=(const Lease&) = delete;
        Lease(Lease&& o) noexcept : conn_(o.conn_), pool_(o.pool_) {
            o.conn_ = nullptr;
            o.pool_ = nullptr;
        }
        Lease& operator=(Lease&& o) noexcept {
            if (this != &o) {
                release();
                conn_ = o.conn_;
                pool_ = o.pool_;
                o.conn_ = nullptr;
                o.pool_ = nullptr;
            }
            return *this;
        }
        ~Lease() { release(); }

        PGconn* get() const noexcept { return conn_; }
        operator PGconn*() const noexcept { return conn_; }

    private:
        void release() noexcept {
            if (conn_ && pool_) {
                pool_->returnConn(conn_);
            }
            conn_ = nullptr;
            pool_ = nullptr;
        }
        PGconn* conn_{nullptr};
        PgPool* pool_{nullptr};
    };

    /** @brief Pool singleton para la base de datos PRIMARIA (escrituras y lecturas transaccionales). */
    static PgPool& instance() {
        static PgPool inst;
        return inst;
    }

    // Pool SEPARADO para la réplica read-only (dashboards/KPIs). Es obligatorio
    // que sea distinto del primario: acquire() reutiliza conexiones idle sin
    // re-chequear la cadena de conexión, así que un pool no puede mezclar dos
    // URLs (primario y réplica) sin devolver conexiones al servidor equivocado.
    /** @brief Pool singleton para la base de datos RÉPLICA read-only (offload de dashboards/KPIs). Nunca compartir con `instance()`. */
    static PgPool& replica() {
        static PgPool inst;
        return inst;
    }

    /** @brief Toma prestada una conexión idle (o crea una nueva hasta `max_size_`) hacia `conn_str`; bloquea si el pool está lleno y sin conexiones idle. @return Un `Lease` RAII — la conexión vuelve al pool (o se descarta si quedó en mal estado) al destruirse. */
    Lease acquire(const std::string& conn_str) {
        std::unique_lock<std::mutex> lk(mtx_);
        // Capacity = idle + active. Espera mientras esté lleno y sin idle.
        while (idle_.empty() && (active_ + idle_.size()) >= max_size_) {
            ++waits_;
            cv_.wait(lk);
        }

        PGconn* conn = nullptr;
        if (!idle_.empty()) {
            conn = idle_.front();
            idle_.pop_front();
            // Validar idle: si PQstatus quedó malo (reset de pgbouncer, etc),
            // descartar y crear nueva.
            if (PQstatus(conn) != CONNECTION_OK) {
                PQfinish(conn);
                ++bad_connections_;
                conn = nullptr;
            }
        }
        if (!conn) {
            lk.unlock();
            conn = PQconnectdb(conn_str.c_str());
            lk.lock();
        }
        ++active_;
        ++acquires_;
        return Lease(conn, this);
    }

    Stats stats() const {
        std::lock_guard<std::mutex> lk(mtx_);
        Stats s;
        s.idle = idle_.size();
        s.active = active_;
        s.max_size = max_size_;
        s.acquires = acquires_;
        s.bad_connections = bad_connections_;
        s.waits = waits_;
        return s;
    }

private:
    PgPool() {
        max_size_ = 64;
        if (const char* e = std::getenv("BEEMETRY_PG_POOL_SIZE")) {
            try {
                max_size_ = std::max<std::size_t>(2, std::stoul(e));
            } catch (...) {
            }
        }
    }
    ~PgPool() {
        std::lock_guard<std::mutex> lk(mtx_);
        while (!idle_.empty()) {
            PQfinish(idle_.front());
            idle_.pop_front();
        }
    }
    PgPool(const PgPool&) = delete;
    PgPool& operator=(const PgPool&) = delete;

    void returnConn(PGconn* c) noexcept {
        if (!c) {
            std::lock_guard<std::mutex> lk(mtx_);
            if (active_ > 0) --active_;
            cv_.notify_one();
            return;
        }
        // Conexión inutilizable → descartar.
        if (PQstatus(c) != CONNECTION_OK ||
            PQtransactionStatus(c) != PQTRANS_IDLE) {
            PQfinish(c);
            std::lock_guard<std::mutex> lk(mtx_);
            if (active_ > 0) --active_;
            ++bad_connections_;
            cv_.notify_one();
            return;
        }
        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (active_ > 0) --active_;
            idle_.push_back(c);
        }
        cv_.notify_one();
    }

    mutable std::mutex mtx_;
    std::condition_variable cv_;
    std::deque<PGconn*> idle_;
    std::size_t active_{0};
    std::size_t max_size_{64};
    std::uint64_t acquires_{0};
    std::uint64_t bad_connections_{0};
    std::uint64_t waits_{0};
};

} // namespace storage

#endif // HAS_LIBPQ
