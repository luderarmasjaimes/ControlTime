// --------------------------------------------------------------------------
// pg_result.hpp — RAII para PGresult y helpers de conexión cruda (header-only)
// --------------------------------------------------------------------------
// El pool (pg_pool.hpp) ya administra el ciclo de vida de PGconn vía Lease.
// Falta la contraparte para PGresult*: hoy se libera con PQclear() manual, lo
// que filtra memoria en cualquier `return`/throw temprano entre PQexec y PQclear.
//
// PgResult envuelve PGresult* en un unique_ptr con deleter PQclear, dando
// limpieza determinista y a prueba de excepciones.
//
// Uso:
//   storage::PgResult r{ PQexec(conn, sql) };
//   if (!r.ok()) { return false; }          // PQclear automático al salir
//   const int n = PQntuples(r.get());
//   const char* v = PQgetvalue(r.get(), 0, 0);
//
// Para conexiones fuera del pool (jobs/hilos propios como el ingestor):
//   storage::PgConn c{ PQconnectdb(url.c_str()) };
//   if (!c.ok()) { ... }                     // PQfinish automático
// --------------------------------------------------------------------------
#pragma once

#if HAS_LIBPQ

#include <libpq-fe.h>

#include <memory>
#include <string>
#include <utility>

namespace storage {

// ── PGresult RAII ──────────────────────────────────────────────────────────
struct PgResultDeleter {
  void operator()(PGresult* r) const noexcept {
    if (r) PQclear(r);
  }
};

class PgResult {
public:
  PgResult() = default;
  explicit PgResult(PGresult* r) noexcept : res_(r) {}

  PGresult* get() const noexcept { return res_.get(); }
  explicit operator bool() const noexcept { return static_cast<bool>(res_); }

  /// Estado de resultado esperado para SELECT (filas).
  bool okTuples() const noexcept {
    return res_ && PQresultStatus(res_.get()) == PGRES_TUPLES_OK;
  }

  /// Estado esperado para INSERT/UPDATE/DELETE/DDL sin filas.
  bool okCommand() const noexcept {
    return res_ && PQresultStatus(res_.get()) == PGRES_COMMAND_OK;
  }

  /// True si el comando terminó bien, ya sea con filas o sin ellas.
  bool ok() const noexcept { return okTuples() || okCommand(); }

  /// Mensaje de error del resultado (vacío si no hay).
  std::string error() const {
    return res_ ? std::string(PQresultErrorMessage(res_.get())) : std::string{};
  }

private:
  std::unique_ptr<PGresult, PgResultDeleter> res_;
};

// ── PGconn RAII (para conexiones fuera del pool) ───────────────────────────
struct PgConnDeleter {
  void operator()(PGconn* c) const noexcept {
    if (c) PQfinish(c);
  }
};

class PgConn {
public:
  PgConn() = default;
  explicit PgConn(PGconn* c) noexcept : conn_(c) {}

  PGconn* get() const noexcept { return conn_.get(); }
  explicit operator bool() const noexcept { return static_cast<bool>(conn_); }

  bool ok() const noexcept {
    return conn_ && PQstatus(conn_.get()) == CONNECTION_OK;
  }

  std::string error() const {
    return conn_ ? std::string(PQerrorMessage(conn_.get())) : std::string{};
  }

private:
  std::unique_ptr<PGconn, PgConnDeleter> conn_;
};

}  // namespace storage

#endif  // HAS_LIBPQ
