#include "fotocheck_share_links.hpp"
#include "../http/http_utils.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "../storage/pg_pool.hpp"
#include "../storage/pg_result.hpp"

namespace auth {
namespace fotocheck {

std::string getOrCreateFotocheckShareLinkPg(const std::string &databaseUrl,
                                            const std::string &userId,
                                            std::string &error) {
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return "";
  }

  // Reutiliza el token existente si ya se generó uno para este usuario --
  // evita acumular filas huérfanas en cada reintento/reenvío y mantiene el
  // mismo link válido para siempre (no es una descarga puntual).
  const char *selParams[1] = {userId.c_str()};
  storage::PgResult existing{PQexecParams(
      conn, "SELECT token FROM fotocheck_share_links WHERE user_id = $1 LIMIT 1", 1,
      nullptr, selParams, nullptr, nullptr, 0)};
  if (existing.okTuples() && PQntuples(existing.get()) > 0) {
    return PQgetvalue(existing.get(), 0, 0);
  }

  // 32 bytes -> 64 caracteres hex, mismo generador que
  // reports::createReportShareLinkPg / auth::makeSessionToken.
  const std::string token = http_utils::secureRandomHex(32);
  const char *insParams[2] = {token.c_str(), userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "INSERT INTO fotocheck_share_links(token, user_id) VALUES($1, $2)", 2,
      nullptr, insParams, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = PQresultErrorMessage(res.get());
    return "";
  }
  return token;
#else
  (void)databaseUrl;
  (void)userId;
  error = "db_unavailable";
  return "";
#endif
}

std::optional<std::string> resolveFotocheckShareLinkPg(const std::string &databaseUrl,
                                                        const std::string &token) {
#if HAS_LIBPQ
  if (token.empty()) return std::nullopt;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return std::nullopt;

  const char *params[1] = {token.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT user_id FROM fotocheck_share_links WHERE token = $1", 1, nullptr,
      params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return std::nullopt;
  }
  return std::string(PQgetvalue(res.get(), 0, 0));
#else
  (void)databaseUrl;
  (void)token;
  return std::nullopt;
#endif
}

}  // namespace fotocheck
}  // namespace auth
