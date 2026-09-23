#include "report_document_settings.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../http/http_utils.hpp"

#include <boost/json.hpp>

#include <algorithm>
#include <regex>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

namespace json = boost::json;

namespace reports {

namespace {

// Duplicado a propósito de `mining_iot::alarm_notifier::isSafeEmail` — no se
// acopla el dominio `reports` al de `mining_iot` por una validación de
// formato tan chica (ver report_document_settings.hpp::savePdfShareRecipients).
bool isSafeEmailFormat(const std::string &s) {
  static const std::regex re(R"(^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$)");
  return std::regex_match(s, re);
}

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

std::vector<std::string> resolvePdfShareRecipients(const std::string &databaseUrl,
                                                    const std::string &reportId) {
  std::vector<std::string> result;
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return result;
  }
  const char *params[1] = {reportId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT pdf_share_recipients_json::text FROM report_document_settings WHERE report_id = $1",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    return result;
  }
  const char *raw = PQgetvalue(res.get(), 0, 0);
  if (raw == nullptr || raw[0] == '\0') {
    return result;
  }
  try {
    auto parsed = json::parse(raw);
    if (parsed.is_array()) {
      for (const auto &item : parsed.as_array()) {
        if (item.is_string()) {
          result.emplace_back(item.as_string().c_str());
        }
      }
    }
  } catch (...) {
    // JSON corrupto: no debe bloquear el export, se usa lista vacía.
  }
#endif
  return result;
}

bool savePdfShareRecipients(const std::string &databaseUrl, const std::string &reportId,
                            const std::vector<std::string> &emails, std::string &error) {
  std::vector<std::string> valid;
  for (const auto &raw : emails) {
    if (valid.size() >= 10) break;
    if (!isSafeEmailFormat(raw)) continue;
    if (std::find(valid.begin(), valid.end(), raw) != valid.end()) continue;  // sin duplicados
    valid.push_back(raw);
  }
#if HAS_LIBPQ
  json::array arr;
  for (const auto &e : valid) arr.push_back(json::value(e));
  const std::string serialized = json::serialize(arr);

  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "db_connection_failed";
    return false;
  }
  const char *params[2] = {reportId.c_str(), serialized.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO report_document_settings (report_id, pdf_share_recipients_json) "
      "VALUES ($1, $2::jsonb) "
      "ON CONFLICT (report_id) DO UPDATE SET pdf_share_recipients_json = EXCLUDED.pdf_share_recipients_json",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = "upsert_failed";
    return false;
  }
  return true;
#else
  error = "libpq_not_available";
  return false;
#endif
}

}  // namespace reports
