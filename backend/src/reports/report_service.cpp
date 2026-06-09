#include "report_service.hpp"
#include "../config/app_config.hpp"
#include "../auth/auth_storage_pg.hpp"

using auth::pgExecOk;
using auth::pqEscapeLiteral;
using auth::ensureAuthSchemaPg;
using auth::pgExecAuditContextFromLogin;

namespace reports {

std::vector<Project> listProjectsPg(const std::string &databaseUrl, std::string &error) {
  std::vector<Project> projects;
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return projects;
  }
  PGresult *res = PQexec(conn, "SELECT id, name, description FROM projects ORDER BY name ASC");
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
      for (int i = 0; i < PQntuples(res); ++i) {
          projects.push_back({PQgetvalue(res, i, 0), PQgetvalue(res, i, 1), PQgetvalue(res, i, 2), ""});
      }
  } else {
      error = PQerrorMessage(conn);
  }
  if (res) PQclear(res);
  PQfinish(conn);
#endif
  return projects;
}

std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &company, std::string &error) {
  std::vector<Report> reps;
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return reps;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return reps;
  }
  std::string sql =
      "SELECT id, project_id, title, status, created_at, updated_at, "
      "COALESCE(company_name,'') "
      "FROM reports WHERE deleted_at IS NULL AND company_name = " +
      pqEscapeLiteral(conn, company) + " ORDER BY created_at DESC";
  PGresult *res = PQexec(conn, sql.c_str());
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
      for (int i = 0; i < PQntuples(res); ++i) {
          Report r;
          r.id = PQgetvalue(res, i, 0);
          r.projectId = PQgetvalue(res, i, 1);
          r.title = PQgetvalue(res, i, 2);
          r.status = PQgetvalue(res, i, 3);
          r.createdAt = PQgetvalue(res, i, 4);
          r.updatedAt = PQgetvalue(res, i, 5);
          r.company = PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6));
          reps.push_back(std::move(r));
      }
  }
  if (res) PQclear(res);
  PQfinish(conn);
#endif
  return reps;
}

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &company, Report &out,
                     std::string &error) {
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }
  std::string sql =
      "SELECT id, project_id::text, title, content_json::text, status, "
      "created_at::text, updated_at::text, COALESCE(company_name,'') FROM reports WHERE id = " +
      pqEscapeLiteral(conn, id) + " AND company_name = " + pqEscapeLiteral(conn, company) +
      " AND deleted_at IS NULL";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) < 1) {
    error = "report_not_found";
    if (res)
      PQclear(res);
    PQfinish(conn);
    return false;
  }
  out.id = PQgetvalue(res, 0, 0);
  out.projectId =
      PQgetisnull(res, 0, 1) ? "" : std::string(PQgetvalue(res, 0, 1));
  out.title = PQgetvalue(res, 0, 2);
  const char *cj = PQgetvalue(res, 0, 3);
  try {
    out.contentJson =
        (cj && cj[0]) ? json::parse(std::string(cj)) : json::object{};
  } catch (...) {
    out.contentJson = json::object{};
  }
  out.status = PQgetvalue(res, 0, 4);
  out.createdAt = PQgetvalue(res, 0, 5);
  out.updatedAt = PQgetvalue(res, 0, 6);
  out.company = PQgetisnull(res, 0, 7) ? "" : std::string(PQgetvalue(res, 0, 7));
  PQclear(res);
  PQfinish(conn);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken) {
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }
  const bool useAudit = !auditUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      PQfinish(conn);
      return false;
    }
  }
  std::string contentStr = json::serialize(r.contentJson);
  std::string sql = "INSERT INTO reports (project_id, title, content_json, status, company_name) VALUES (" +
      (r.projectId.empty() ? "NULL" : pqEscapeLiteral(conn, r.projectId)) + "," +
      pqEscapeLiteral(conn, r.title) + "," +
      pqEscapeLiteral(conn, contentStr) + "," +
      pqEscapeLiteral(conn, r.status) + "," +
      pqEscapeLiteral(conn, r.company) + ") RETURNING id::text";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res) {
    error = PQerrorMessage(conn);
    if (useAudit) {
      pgExecOk(conn, "ROLLBACK");
    }
    PQfinish(conn);
    return false;
  }
  if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) < 1) {
    error = PQerrorMessage(conn);
    PQclear(res);
    if (useAudit) {
      pgExecOk(conn, "ROLLBACK");
    }
    PQfinish(conn);
    return false;
  }
  outNewId = PQgetvalue(res, 0, 0);
  PQclear(res);
  if (useAudit) {
    if (!pgExecOk(conn, "COMMIT")) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return false;
    }
  }
  PQfinish(conn);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool updateReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken) {
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }
  const bool useAudit = !auditUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      PQfinish(conn);
      return false;
    }
  }
  std::string contentStr = json::serialize(r.contentJson);
  std::string sql = "UPDATE reports SET title = " + pqEscapeLiteral(conn, r.title) +
      ", content_json = " + pqEscapeLiteral(conn, contentStr) +
      ", status = " + pqEscapeLiteral(conn, r.status) +
      ", company_name = " + pqEscapeLiteral(conn, company) +
      " WHERE id = " + pqEscapeLiteral(conn, id) + " AND company_name = " +
      pqEscapeLiteral(conn, company) + " AND deleted_at IS NULL";
  bool ok = pgExecOk(conn, sql);
  if (!ok) {
    error = PQerrorMessage(conn);
  }
  if (useAudit) {
    if (ok) {
      if (!pgExecOk(conn, "COMMIT")) {
        error = PQerrorMessage(conn);
        ok = false;
      }
    } else {
      pgExecOk(conn, "ROLLBACK");
    }
  }
  PQfinish(conn);
  return ok;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool deleteReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken) {
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }
  const bool useAudit = !auditUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      PQfinish(conn);
      return false;
    }
  }
  std::string sql = "UPDATE reports SET deleted_at = NOW() WHERE id = " +
                    pqEscapeLiteral(conn, id) + " AND company_name = " +
                    pqEscapeLiteral(conn, company) + " AND deleted_at IS NULL";
  bool ok = pgExecOk(conn, sql);
  if (!ok) {
    error = PQerrorMessage(conn);
  }
  if (useAudit) {
    if (ok) {
      if (!pgExecOk(conn, "COMMIT")) {
        error = PQerrorMessage(conn);
        ok = false;
      }
    } else {
      pgExecOk(conn, "ROLLBACK");
    }
  }
  PQfinish(conn);
  return ok;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

} // namespace reports
