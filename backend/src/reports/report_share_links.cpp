#include "report_share_links.hpp"
#include "../http/http_utils.hpp"

// HAS_LIBPQ no se propaga entre translation units (ver el mismo bloque en
// otros .cpp del proyecto, p.ej. report_routes.cpp).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

namespace reports {

std::string createReportShareLinkPg(const std::string &databaseUrl, const std::string &reportId,
                                    const std::string &tenantId, const std::string &createdByUserId,
                                    const std::string &createdByUsername, int ttlHours,
                                    std::string &error) {
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return "";
  }
  // 32 bytes -> 64 caracteres hex, mismo generador que auth::makeSessionToken
  // (http_utils::secureRandomHex) -- opaco, no es un JWT, entropía de sobra
  // para no ser adivinable por fuerza bruta.
  const std::string token = http_utils::secureRandomHex(32);
  const std::string ttlInterval = std::to_string(ttlHours) + " hours";
  const char *params[6] = {token.c_str(),        reportId.c_str(),        tenantId.c_str(),
                           createdByUserId.c_str(), createdByUsername.c_str(), ttlInterval.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO report_pdf_share_links "
      "(token, report_id, tenant_id, created_by_user_id, created_by_username, expires_at) "
      "VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, now() + $6::interval)",
      6, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = PQresultErrorMessage(res.get());
    return "";
  }
  return token;
#else
  error = "db_unavailable";
  return "";
#endif
}

std::optional<ShareLink> resolveReportShareLinkPg(const std::string &databaseUrl,
                                                  const std::string &token) {
#if HAS_LIBPQ
  if (token.empty()) return std::nullopt;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return std::nullopt;

  const char *selParams[1] = {token.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT report_id::text, tenant_id::text, created_by_user_id::text, created_by_username "
      "FROM report_pdf_share_links "
      "WHERE token = $1 AND revoked = false AND expires_at > now()",
      1, nullptr, selParams, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return std::nullopt;
  }
  ShareLink link;
  link.token = token;
  link.reportId = PQgetvalue(res.get(), 0, 0);
  link.tenantId = PQgetvalue(res.get(), 0, 1);
  link.createdByUserId = PQgetvalue(res.get(), 0, 2);
  link.createdByUsername = PQgetvalue(res.get(), 0, 3);

  // Best-effort: el contador/timestamp de acceso son solo trazabilidad
  // (auditoría de "quién escaneó y cuándo"), nunca deben bloquear la
  // resolución del link si el UPDATE falla por cualquier motivo.
  const char *updParams[1] = {token.c_str()};
  storage::PgResult upd{PQexecParams(
      conn,
      "UPDATE report_pdf_share_links SET accessed_count = accessed_count + 1, "
      "last_accessed_at = now() WHERE token = $1",
      1, nullptr, updParams, nullptr, nullptr, 0)};
  (void)upd;

  return link;
#else
  (void)databaseUrl;
  (void)token;
  return std::nullopt;
#endif
}

}  // namespace reports
