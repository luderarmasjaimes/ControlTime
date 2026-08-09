#include "report_document_settings.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../http/http_utils.hpp"

#include <boost/json.hpp>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

namespace json = boost::json;

namespace reports {

namespace {

std::string buildDefaultWatermarkText(const std::string &tenantId, const std::string &username) {
  const std::string date = http_utils::nowIso8601().substr(0, 10);  // solo YYYY-MM-DD
  std::string text = "CONFIDENCIAL — " + (tenantId.empty() ? std::string("—") : tenantId);
  if (!username.empty()) {
    text += " — Generado para " + username;
  }
  text += " — " + date;
  return text;
}

}  // namespace

std::string resolveWatermarkText(const std::string &databaseUrl, const std::string &reportId,
                                 const std::string &tenantId, const std::string &username) {
  const std::string fallback = buildDefaultWatermarkText(tenantId, username);
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return fallback;
  }
  const char *params[1] = {reportId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT watermark_json::text FROM report_document_settings WHERE report_id = $1",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return fallback;
  }
  const char *raw = PQgetvalue(res.get(), 0, 0);
  if (raw == nullptr || raw[0] == '\0') {
    return fallback;
  }
  try {
    auto parsed = json::parse(raw);
    if (parsed.is_object()) {
      auto &obj = parsed.as_object();
      auto it = obj.if_contains("text");
      if (it && it->is_string()) {
        std::string text(it->as_string().c_str());
        if (!text.empty()) {
          return text;
        }
      }
    }
  } catch (...) {
    // watermark_json corrupto: no debe bloquear el export, se usa el default.
  }
#endif
  return fallback;
}

}  // namespace reports
