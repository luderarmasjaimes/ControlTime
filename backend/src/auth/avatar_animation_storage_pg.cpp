#include "avatar_animation_storage_pg.hpp"

// HAS_LIBPQ se define POR ARCHIVO, no globalmente (mismo patrón que
// auth_storage_pg.hpp) -- hallazgo real, sesión 2026-09-08: este archivo no
// lo definía, así que "#if HAS_LIBPQ" evaluaba como macro no definida (0) y
// las tres funciones de abajo siempre devolvían "postgres support is not
// compiled", pese a que Postgres funcionaba bien en el resto del backend.
// Reproducido con un JWT propio minteado para pruebas (sin usar la sesión
// real de ningún usuario) contra POST /api/auth/avatar/animation.
#if __has_include(<libpq-fe.h>)
#define HAS_LIBPQ 1
#include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#define HAS_LIBPQ 1
#include <postgresql/libpq-fe.h>
#else
#define HAS_LIBPQ 0
#endif

#include "../storage/pg_pool.hpp"
#include "../storage/pg_result.hpp"

namespace auth {

bool createAvatarAnimationJobPg(const std::string &databaseUrl, const std::string &userId,
                                const std::string &tenantId, const std::string &kind,
                                std::string &outJobId, std::string &error) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const char *params[3] = {
      userId.c_str(),
      tenantId.empty() ? nullptr : tenantId.c_str(),
      kind.c_str(),
  };
  static const char *kInsertJobSql =
      "INSERT INTO avatar_animation_job (user_id, tenant_id, kind) "
      "VALUES ($1::uuid, $2::uuid, $3) "
      "RETURNING job_id::text";
  storage::PgResult res{PQexecParams(conn, kInsertJobSql, 3, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    error = res ? res.error() : PQerrorMessage(conn);
    return false;
  }
  outJobId = PQgetvalue(res.get(), 0, 0);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool getAvatarAnimationJobPg(const std::string &databaseUrl, const std::string &jobId,
                             const std::string &userId, AvatarAnimationJob &out,
                             std::string &error) {
  if (userId.empty()) {
    error = "avatar_animation_job_not_found";
    return false;
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  // Filtro directo por user_id -- guard IDOR: un usuario no puede consultar
  // ni descargar el job de otro, mismo criterio que handleMyAvatarHd.
  const char *params[2] = {jobId.c_str(), userId.c_str()};
  static const char *kGetJobSql =
      "SELECT job_id::text, user_id::text, COALESCE(tenant_id::text,''), kind, status, "
      "COALESCE(storage_uri,''), COALESCE(error_message,''), "
      "created_at::text, COALESCE(started_at::text,''), COALESCE(completed_at::text,'') "
      "FROM avatar_animation_job WHERE job_id = $1::uuid AND user_id = $2::uuid";
  storage::PgResult res{PQexecParams(conn, kGetJobSql, 2, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    error = "avatar_animation_job_not_found";
    return false;
  }
  out.jobId = PQgetvalue(res.get(), 0, 0);
  out.userId = PQgetvalue(res.get(), 0, 1);
  out.tenantId = PQgetvalue(res.get(), 0, 2);
  out.kind = PQgetvalue(res.get(), 0, 3);
  out.status = PQgetvalue(res.get(), 0, 4);
  out.storageUri = PQgetvalue(res.get(), 0, 5);
  out.errorMessage = PQgetvalue(res.get(), 0, 6);
  out.createdAt = PQgetvalue(res.get(), 0, 7);
  out.startedAt = PQgetvalue(res.get(), 0, 8);
  out.completedAt = PQgetvalue(res.get(), 0, 9);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool findLatestSuccessfulAvatarAnimationJobPg(const std::string &databaseUrl,
                                              const std::string &userId,
                                              const std::string &kind,
                                              AvatarAnimationJob &out) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return false;
  }
  const char *params[2] = {userId.c_str(), kind.c_str()};
  static const char *kSql =
      "SELECT job_id::text, user_id::text, COALESCE(tenant_id::text,''), kind, status, "
      "COALESCE(storage_uri,''), COALESCE(error_message,''), "
      "created_at::text, COALESCE(started_at::text,''), COALESCE(completed_at::text,'') "
      "FROM avatar_animation_job WHERE user_id = $1::uuid AND kind = $2 "
      "AND status = 'success' AND storage_uri IS NOT NULL "
      "ORDER BY completed_at DESC LIMIT 1";
  storage::PgResult res{PQexecParams(conn, kSql, 2, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return false;
  }
  out.jobId = PQgetvalue(res.get(), 0, 0);
  out.userId = PQgetvalue(res.get(), 0, 1);
  out.tenantId = PQgetvalue(res.get(), 0, 2);
  out.kind = PQgetvalue(res.get(), 0, 3);
  out.status = PQgetvalue(res.get(), 0, 4);
  out.storageUri = PQgetvalue(res.get(), 0, 5);
  out.errorMessage = PQgetvalue(res.get(), 0, 6);
  out.createdAt = PQgetvalue(res.get(), 0, 7);
  out.startedAt = PQgetvalue(res.get(), 0, 8);
  out.completedAt = PQgetvalue(res.get(), 0, 9);
  return true;
#else
  (void)databaseUrl;
  (void)userId;
  (void)kind;
  (void)out;
  return false;
#endif
}

bool findInProgressAvatarAnimationJobPg(const std::string &databaseUrl,
                                        const std::string &userId,
                                        const std::string &kind,
                                        AvatarAnimationJob &out) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return false;
  }
  const char *params[2] = {userId.c_str(), kind.c_str()};
  static const char *kSql =
      "SELECT job_id::text, user_id::text, COALESCE(tenant_id::text,''), kind, status, "
      "COALESCE(storage_uri,''), COALESCE(error_message,''), "
      "created_at::text, COALESCE(started_at::text,''), COALESCE(completed_at::text,'') "
      "FROM avatar_animation_job WHERE user_id = $1::uuid AND kind = $2 "
      "AND status IN ('queued','running') "
      "ORDER BY created_at DESC LIMIT 1";
  storage::PgResult res{PQexecParams(conn, kSql, 2, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return false;
  }
  out.jobId = PQgetvalue(res.get(), 0, 0);
  out.userId = PQgetvalue(res.get(), 0, 1);
  out.tenantId = PQgetvalue(res.get(), 0, 2);
  out.kind = PQgetvalue(res.get(), 0, 3);
  out.status = PQgetvalue(res.get(), 0, 4);
  out.storageUri = PQgetvalue(res.get(), 0, 5);
  out.errorMessage = PQgetvalue(res.get(), 0, 6);
  out.createdAt = PQgetvalue(res.get(), 0, 7);
  out.startedAt = PQgetvalue(res.get(), 0, 8);
  out.completedAt = PQgetvalue(res.get(), 0, 9);
  return true;
#else
  (void)databaseUrl;
  (void)userId;
  (void)kind;
  (void)out;
  return false;
#endif
}

bool updateAvatarAnimationJobStatusPg(const std::string &databaseUrl, const std::string &jobId,
                                      const std::string &status, const std::string &storageUri,
                                      const std::string &errorMessage, std::string &error) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const char *params[4] = {
      jobId.c_str(),
      status.c_str(),
      storageUri.empty() ? nullptr : storageUri.c_str(),
      errorMessage.empty() ? nullptr : errorMessage.c_str(),
  };
  static const char *kUpdateJobSql =
      "UPDATE avatar_animation_job SET "
      "status = $2, "
      "storage_uri = COALESCE($3, storage_uri), "
      "error_message = $4, "
      "started_at = CASE WHEN $2 = 'running' AND started_at IS NULL "
      "  THEN NOW() ELSE started_at END, "
      "completed_at = CASE WHEN $2 IN ('success','failed','cancelled') "
      "  THEN NOW() ELSE completed_at END "
      "WHERE job_id = $1::uuid";
  storage::PgResult res{PQexecParams(conn, kUpdateJobSql, 4, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = res ? res.error() : PQerrorMessage(conn);
    return false;
  }
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

}  // namespace auth
