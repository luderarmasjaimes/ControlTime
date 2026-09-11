// --------------------------------------------------------------------------
// gpu_mutex.hpp — Mutex de GPU entre servicios de inferencia (header-only)
// --------------------------------------------------------------------------
// ADR-150/160 dejaron documentado que `avatar_engine` (estático, ADR-141) y
// `avatar_animation_engine` (animado, ADR-150) NO caben corriendo inferencia
// a la vez en los 8151 MiB de VRAM de este host, y que no existe ningún
// mecanismo de exclusión mutua real -- "count: all" en docker-compose.yml da
// acceso compartido a la GPU, no una cuota, y la única defensa documentada
// hasta ahora era apagar un servicio a mano mientras se usa el otro. Eso
// alcanza para evaluación, no para producto: un usuario puede pedir su
// avatar animado mientras otro se está registrando (avatar_engine activo).
//
// Esta clase serializa, a nivel del backend, cualquier llamada saliente a un
// servicio de inferencia con GPU pesada bajo una única key compartida
// (pg_advisory_lock de sesión) -- los servicios Python siguen sin saber nada
// entre ellos, el árbitro vive acá porque el backend ya habla con Postgres
// para todo lo demás y no hay otra infraestructura de coordinación entre
// procesos en este repo (sin Redis; Redpanda es solo para telemetría).
//
// Uso:
//   #include "storage/gpu_mutex.hpp"
//   ...
//   storage::GpuInferenceMutex lock(cfg.gpuMutexDatabaseUrl());  // bloquea si hace falta
//   if (!lock.locked()) { /* Postgres no disponible -- degradar, no bloquear
//                            eternamente una función best-effort */ }
//   ... llamar a avatar_engine o avatar_animation_engine ...
//   // el destructor libera el advisory lock ANTES de devolver la conexión
//   // al pool -- ver comentario en el destructor, es la parte que importa.
//
// IMPORTANTE -- conexión directa, sin pgbouncer (incidente 2026-09-09/10):
// esta clase usa PgPool::gpuMutex(), un pool separado de PgPool::instance(),
// y espera recibir cfg.gpuMutexDatabaseUrl() (host=db directo), NUNCA
// cfg.gDatabaseUrl (host=pgbouncer, POOL_MODE=transaction). pg_advisory_lock
// es un lock de SESIÓN: si el lock y el pg_advisory_unlock_all() del
// destructor caen en dos conexiones físicas de Postgres distintas -- algo
// que pgbouncer en modo transaction puede hacer con dos PQexec sueltos de la
// misma conexión lógica del pool -- el unlock no libera nada. El lock queda
// retenido para siempre en la conexión física original, que pgbouncer sigue
// reciclando para otras requests sin enterarse de que "tiene" un mutex que
// nunca pidió. Reproducido en vivo: un CUDA OOM en avatar_engine dejó un
// hilo de fondo sin liberar el lock correctamente y, en los ~20 minutos
// siguientes, CADA intento de generar un avatar (cartoon o animado) se
// bloqueó en fila detrás de ese lock fantasma, sin timeout y sin una sola
// línea de log entre "thread_start" y el bloqueo -- silencioso desde la
// perspectiva del usuario y del propio backend. Ver logs [GPU_MUTEX] abajo:
// ahora cada acquire/release imprime pid de Postgres + tiempo de espera/
// retención, y el release verifica explícitamente que el conteo de locks
// haya quedado en 0 antes de devolver la conexión al pool, para que un
// futuro lock fantasma sea un [GPU_MUTEX] CRITICAL en los logs en vez de un
// cuelgue mudo que solo psql a pg_locks revela.
// --------------------------------------------------------------------------
#pragma once

#if HAS_LIBPQ

#include "pg_pool.hpp"
#include "pg_result.hpp"

#include <libpq-fe.h>

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>

namespace storage {

class GpuInferenceMutex {
public:
    // Bloqueante: puede esperar minutos si otra llamada GPU-pesada está en
    // curso (ej. una animación SadTalker de 200-300s, ver ADR-150). Correcto
    // porque todo llamador de esta clase ya corre en un hilo de fondo/async
    // (fetchCartoonAvatarBestEffort ya se llama vía std::async/hilo detached
    // en main.cpp, y runAvatarAnimationJob corre en su propio
    // std::thread(...).detach()) -- nunca en el hilo que atiende el request
    // HTTP original.
    explicit GpuInferenceMutex(const std::string &databaseUrl)
        : lease_(storage::PgPool::gpuMutex().acquire(databaseUrl)) {
        const auto tStart = std::chrono::steady_clock::now();
        PGconn *conn = lease_.get();
        if (!conn || PQstatus(conn) != CONNECTION_OK) {
            std::cerr << "[GPU_MUTEX] no se pudo tomar conexión del pool (conn="
                      << (conn ? "non-null" : "null") << ")" << std::endl;
            return;
        }

        {
            storage::PgResult pidR{PQexec(conn, "SELECT pg_backend_pid()")};
            if (pidR.okTuples() && PQntuples(pidR.get()) > 0) {
                backendPid_ = std::atoi(PQgetvalue(pidR.get(), 0, 0));
            }
        }

        storage::PgResult r{PQexec(
            conn, "SELECT pg_advisory_lock(hashtext('beemetry_gpu_inference_mutex'))")};
        locked_ = r.okTuples();
        const auto waitMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 std::chrono::steady_clock::now() - tStart)
                                 .count();
        if (!locked_) {
            std::cerr << "[GPU_MUTEX] lock query failed: pid=" << backendPid_
                      << " wait_ms=" << waitMs << " err="
                      << (r ? r.error() : "no result") << std::endl;
            return;
        }

        acquiredAt_ = std::chrono::steady_clock::now();
        // >= kSlowWaitWarnMs: no es un bug por sí solo (otra llamada
        // GPU-pesada real, ej. una animación de 200-300s, produce esto todo
        // el tiempo) -- pero es la señal que faltaba para distinguir "estuvo
        // esperando de verdad" de "se colgó" sin ir a psql. Ver pg_locks +
        // este pid si wait_ms crece de forma sostenida entre requests.
        if (waitMs >= kSlowWaitWarnMs) {
            std::cerr << "[GPU_MUTEX] acquired (esperó) pid=" << backendPid_
                      << " wait_ms=" << waitMs << std::endl;
        } else {
            std::cerr << "[GPU_MUTEX] acquired pid=" << backendPid_
                      << " wait_ms=" << waitMs << std::endl;
        }
    }

    ~GpuInferenceMutex() {
        // CRÍTICO: liberar el advisory lock ANTES de que el Lease del pool
        // devuelva la conexión (su propio destructor, después de este
        // cuerpo). Un advisory lock de sesión queda atado a la conexión, no
        // al PgPool::Lease -- si se devolviera al pool todavía tomado, la
        // próxima llamada que reciclara esa misma conexión heredaría un
        // mutex que nunca pidió, sin enterarse, y ninguna GPU-heavy call
        // futura en esa conexión reciclada podría volver a tomarlo (ya lo
        // tiene "gratis"), rompiendo la serialización que esta clase existe
        // para garantizar.
        //
        // pg_advisory_unlock_all() en vez de pg_advisory_unlock() puntual:
        // un advisory lock de sesión es reentrante/contado -- si por
        // cualquier motivo un solo lock/unlock quedó descompensado alguna
        // vez en el proceso, la conexión vuelve al pool con el contador en 1
        // en vez de 0, sigue pareciendo sana, y CUALQUIER otra sesión que
        // pida esta misma key se queda bloqueada para siempre.
        // pg_advisory_unlock_all() libera TODAS las veces que esta sesión
        // haya tomado CUALQUIER advisory lock, sin importar el contador.
        // Único código de este backend que usa advisory locks (grep
        // confirmado), así que no hay riesgo de liberar el lock de otra
        // funcionalidad por error.
        //
        // Con el pool dedicado (gpuMutex(), sin pgbouncer de por medio) esta
        // conexión es la MISMA que tomó el lock arriba, así que unlock_all
        // debería bastar siempre. El chequeo de abajo lo confirma en vez de
        // asumirlo, para que un futuro escape de este invariante (ej.
        // alguien vuelve a apuntar esta clase a una URL con pgbouncer) sea
        // un [GPU_MUTEX] CRITICAL explícito y no un cuelgue silencioso.
        PGconn *conn = lease_.get();
        if (!locked_) {
            return;
        }
        const long heldMs =
            acquiredAt_.has_value()
                ? std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - *acquiredAt_)
                      .count()
                : -1;
        if (!conn || PQstatus(conn) != CONNECTION_OK) {
            std::cerr << "[GPU_MUTEX] no se pudo liberar el lock: pid="
                      << backendPid_ << " held_ms=" << heldMs
                      << " conn=" << (conn ? "non-null" : "null")
                      << " status=" << (conn ? PQstatus(conn) : -1) << std::endl;
            return;
        }

        storage::PgResult r{PQexec(conn, "SELECT pg_advisory_unlock_all()")};
        if (!r.okTuples()) {
            std::cerr << "[GPU_MUTEX] unlock query failed: pid=" << backendPid_
                      << " held_ms=" << heldMs << " err="
                      << (r ? r.error() : "no result") << std::endl;
            return;
        }

        // Confirmación explícita en vez de asumir que unlock_all() bastó
        // (ver comentario arriba de la clase, incidente 2026-09-09/10).
        storage::PgResult chk{PQexec(
            conn,
            "SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() "
            "AND locktype = 'advisory'")};
        std::string remaining = "?";
        if (chk.okTuples() && PQntuples(chk.get()) > 0) {
            remaining = PQgetvalue(chk.get(), 0, 0);
        }
        if (remaining != "0") {
            std::cerr << "[GPU_MUTEX] CRITICAL: unlock_all no dejó el conteo en 0 -- "
                      << "pid=" << backendPid_ << " held_ms=" << heldMs
                      << " advisory_locks_remaining=" << remaining
                      << " (revisar pg_locks: este lock puede seguir bloqueando"
                         " a otros)"
                      << std::endl;
        } else {
            std::cerr << "[GPU_MUTEX] released pid=" << backendPid_
                      << " held_ms=" << heldMs << std::endl;
        }
    }

    bool locked() const noexcept { return locked_; }

    GpuInferenceMutex(const GpuInferenceMutex &) = delete;
    GpuInferenceMutex &operator=(const GpuInferenceMutex &) = delete;

private:
    static constexpr long kSlowWaitWarnMs = 3000;

    storage::PgPool::Lease lease_;
    bool locked_{false};
    int backendPid_{-1};
    std::optional<std::chrono::steady_clock::time_point> acquiredAt_;
};

}  // namespace storage

#endif  // HAS_LIBPQ
