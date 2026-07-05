#include "report_service.hpp"
#include "../config/app_config.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "report_workflow.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using auth::pgExecOk;
using auth::ensureAuthSchemaPg;
using auth::pgExecAuditContextFromLogin;

namespace reports {

std::vector<Project> listProjectsPg(const std::string &databaseUrl, std::string &error) {
  std::vector<Project> projects;
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      return projects;
  }
  storage::PgResult res{PQexec(conn, "SELECT id, name, description FROM projects ORDER BY name ASC")};
  if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
          projects.push_back({PQgetvalue(res.get(), i, 0), PQgetvalue(res.get(), i, 1), PQgetvalue(res.get(), i, 2), ""});
      }
  } else {
      error = PQerrorMessage(conn);
  }
#endif
  return projects;
}

std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &company, std::string &error) {
  std::vector<Report> reps;
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      return reps;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    return reps;
  }
  const char *listParams[1] = {company.c_str()};
  static const char *kListReportsSql =
      "SELECT id, project_id, title, status, created_at, updated_at, "
      "COALESCE(company_name,''), COALESCE(signed_by_name,''), "
      "COALESCE(signed_by_role,''), COALESCE(signed_at::text,'') "
      "FROM reports WHERE deleted_at IS NULL AND company_name = $1 "
      "ORDER BY created_at DESC";
  storage::PgResult res{PQexecParams(conn, kListReportsSql, 1, nullptr, listParams,
                                     nullptr, nullptr, 0)};
  if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
          Report r;
          r.id = PQgetvalue(res.get(), i, 0);
          r.projectId = PQgetvalue(res.get(), i, 1);
          r.title = PQgetvalue(res.get(), i, 2);
          r.status = PQgetvalue(res.get(), i, 3);
          r.createdAt = PQgetvalue(res.get(), i, 4);
          r.updatedAt = PQgetvalue(res.get(), i, 5);
          r.company = PQgetisnull(res.get(), i, 6) ? "" : std::string(PQgetvalue(res.get(), i, 6));
          r.signedByName = PQgetvalue(res.get(), i, 7);
          r.signedByRole = PQgetvalue(res.get(), i, 8);
          r.signedAt = PQgetvalue(res.get(), i, 9);
          reps.push_back(std::move(r));
      }
  }
#endif
  return reps;
}

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &company, Report &out,
                     std::string &error) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    return false;
  }
  const char *getParams[2] = {id.c_str(), company.c_str()};
  static const char *kGetReportSql =
      "SELECT id, project_id::text, title, content_json::text, status, "
      "created_at::text, updated_at::text, COALESCE(company_name,''), "
      "COALESCE(signed_by_name,''), COALESCE(signed_by_role,''), "
      "COALESCE(signed_at::text,'') "
      "FROM reports WHERE id = $1 AND company_name = $2 "
      "AND deleted_at IS NULL";
  storage::PgResult res{PQexecParams(conn, kGetReportSql, 2, nullptr, getParams,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    error = "report_not_found";
    return false;
  }
  out.id = PQgetvalue(res.get(), 0, 0);
  out.projectId =
      PQgetisnull(res.get(), 0, 1) ? "" : std::string(PQgetvalue(res.get(), 0, 1));
  out.title = PQgetvalue(res.get(), 0, 2);
  const char *cj = PQgetvalue(res.get(), 0, 3);
  try {
    out.contentJson =
        (cj && cj[0]) ? json::parse(std::string(cj)) : json::object{};
  } catch (...) {
    out.contentJson = json::object{};
  }
  out.status = PQgetvalue(res.get(), 0, 4);
  out.createdAt = PQgetvalue(res.get(), 0, 5);
  out.updatedAt = PQgetvalue(res.get(), 0, 6);
  out.company = PQgetisnull(res.get(), 0, 7) ? "" : std::string(PQgetvalue(res.get(), 0, 7));
  out.signedByName = PQgetvalue(res.get(), 0, 8);
  out.signedByRole = PQgetvalue(res.get(), 0, 9);
  out.signedAt = PQgetvalue(res.get(), 0, 10);
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
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    return false;
  }
  // ADR-017: un informe siempre nace en 'draft'. Sin este chequeo, un
  // cliente podría crear directamente un informe en 'signed'/'archived',
  // saltándose por completo la cadena de aprobación.
  if (!r.status.empty() && r.status != "draft") {
    error = "invalid_workflow_transition: new reports must start as draft";
    return false;
  }
  const bool useAudit = !auditUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      return false;
    }
  }
  // Consulta parametrizada (PQexecParams): sin concatenar literales. Postgres
  // castea cada parámetro de texto al tipo de columna (uuid, jsonb, text).
  // project_id nullable → nullptr en el arreglo de parámetros = SQL NULL.
  std::string contentStr = json::serialize(r.contentJson);
  const char *paramValues[5] = {
      r.projectId.empty() ? nullptr : r.projectId.c_str(),
      r.title.c_str(),
      contentStr.c_str(),
      r.status.c_str(),
      r.company.c_str()};
  static const char *kInsertReportSql =
      "INSERT INTO reports (project_id, title, content_json, status, company_name) "
      "VALUES ($1, $2, $3, $4, $5) RETURNING id::text";
  storage::PgResult res{PQexecParams(conn, kInsertReportSql, 5, nullptr, paramValues,
                                     nullptr, nullptr, 0)};
  if (!res) {
    error = PQerrorMessage(conn);
    if (useAudit) {
      pgExecOk(conn, "ROLLBACK");
    }
    return false;
  }
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    error = PQerrorMessage(conn);
    if (useAudit) {
      pgExecOk(conn, "ROLLBACK");
    }
    return false;
  }
  outNewId = PQgetvalue(res.get(), 0, 0);

  // ADR-015: el versionado es autoritativo en el servidor — la primera
  // revisión (version_number=1) se crea en el mismo momento que el informe,
  // no queda "viviendo solo en el cliente". Best-effort: un fallo aquí no
  // debe bloquear la creación del informe en sí (mismo criterio que la
  // auditoría de workflow más abajo).
  {
    const char *revParams[4] = {outNewId.c_str(), contentStr.c_str(),
                                auditUsername.c_str(), r.company.c_str()};
    storage::PgResult revRes{PQexecParams(
        conn,
        "INSERT INTO report_content_revision "
        "(report_id, version_number, content_json, created_by, change_summary) "
        "VALUES ($1::uuid, 1, $2::jsonb, "
        "(SELECT id FROM auth_users WHERE username = $3 AND company_name = $4 LIMIT 1), "
        "'creacion_inicial')",
        4, nullptr, revParams, nullptr, nullptr, 0)};
  }

  if (useAudit) {
    if (!pgExecOk(conn, "COMMIT")) {
      error = PQerrorMessage(conn);
      return false;
    }
  }
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool updateReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken,
                    const std::string &signerRole,
                    const std::string &workflowComment) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    return false;
  }
  const bool useAudit = !auditUsername.empty();

  // Transacción SIEMPRE explícita (no solo cuando useAudit): la validación de
  // workflow exige leer el status actual y decidir el UPDATE de forma
  // atómica (SELECT ... FOR UPDATE bloquea la fila contra otra transición
  // concurrente sobre el mismo informe).
  if (!pgExecOk(conn, "BEGIN")) {
    error = PQerrorMessage(conn);
    return false;
  }
  if (useAudit &&
      !pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
    pgExecOk(conn, "ROLLBACK");
    error = "audit_context_failed";
    return false;
  }

  // ADR-017: el servidor es la autoridad de la máquina de estados; el
  // cliente solo propone. Se lee el status ACTUAL (con lock de fila) para
  // validar la transición antes de aplicar cualquier cambio.
  const char *lockParams[2] = {id.c_str(), company.c_str()};
  storage::PgResult lockRes{PQexecParams(
      conn,
      "SELECT status FROM reports WHERE id = $1 AND company_name = $2 "
      "AND deleted_at IS NULL FOR UPDATE",
      2, nullptr, lockParams, nullptr, nullptr, 0)};
  if (!lockRes.okTuples() || PQntuples(lockRes.get()) < 1) {
    pgExecOk(conn, "ROLLBACK");
    error = "report_not_found";
    return false;
  }
  const std::string currentStatus = PQgetvalue(lockRes.get(), 0, 0);
  const bool statusChanged = currentStatus != r.status;
  if (!isValidReportTransition(currentStatus, r.status)) {
    pgExecOk(conn, "ROLLBACK");
    error = "invalid_workflow_transition:" + currentStatus + "->" + r.status;
    return false;
  }

  // ADR-018: 'signed' exige una firma documental registrada (nombre, cargo,
  // fecha) — no basta el hash de integridad. Se captura SOLO en el momento
  // exacto de la transición approved->signed (nunca se re-sobreescribe en
  // transiciones posteriores como signed->archived, que preservan la firma
  // original). El nombre se resuelve del lado servidor (auth_users), nunca
  // se confía en el cliente para "quién firmó".
  const bool isSigningNow = statusChanged && r.status == "signed";
  std::string signerName;
  if (isSigningNow) {
    const char *signerParams[2] = {auditUsername.c_str(), company.c_str()};
    storage::PgResult signerRes{PQexecParams(
        conn,
        "SELECT TRIM(first_name || ' ' || last_name) FROM auth_users "
        "WHERE username = $1 AND company_name = $2 LIMIT 1",
        2, nullptr, signerParams, nullptr, nullptr, 0)};
    if (signerRes.okTuples() && PQntuples(signerRes.get()) > 0) {
      signerName = PQgetvalue(signerRes.get(), 0, 0);
    }
    if (signerName.empty()) {
      signerName = auditUsername;  // fallback: username si no hay nombre completo
    }
  }

  // UPDATE parametrizado; company aparece dos veces (SET y filtro tenant).
  // Cuando la transición es la firma real, se añaden las columnas de firma
  // documental (ADR-018) al mismo UPDATE atómico.
  std::string contentStr = json::serialize(r.contentJson);
  bool ok;
  if (isSigningNow) {
    // signed_by (FK UUID) se resuelve por subquery de username+company dentro
    // del mismo UPDATE atómico; signed_by_name/signed_by_role quedan
    // desnormalizados para que la firma siga siendo legible aunque el
    // usuario cambie de nombre/rol o sea desactivado después.
    static const char *kUpdateReportSignedSql =
        "UPDATE reports SET title = $1, content_json = $2, status = $3, "
        "company_name = $4, "
        "signed_by = (SELECT id FROM auth_users WHERE username = $8 "
        "AND company_name = $4 LIMIT 1), "
        "signed_by_name = $6, signed_by_role = $7, signed_at = NOW() "
        "WHERE id = $5 AND company_name = $4 AND deleted_at IS NULL";
    const char *updParams[8] = {r.title.c_str(),   contentStr.c_str(),
                                r.status.c_str(),  company.c_str(),
                                id.c_str(),         signerName.c_str(),
                                signerRole.c_str(), auditUsername.c_str()};
    storage::PgResult updRes{PQexecParams(conn, kUpdateReportSignedSql, 8, nullptr,
                                          updParams, nullptr, nullptr, 0)};
    ok = updRes.okCommand();
  } else {
    const char *updParams[5] = {r.title.c_str(), contentStr.c_str(),
                                r.status.c_str(), company.c_str(), id.c_str()};
    static const char *kUpdateReportSql =
        "UPDATE reports SET title = $1, content_json = $2, status = $3, "
        "company_name = $4 "
        "WHERE id = $5 AND company_name = $4 AND deleted_at IS NULL";
    storage::PgResult updRes{PQexecParams(conn, kUpdateReportSql, 5, nullptr,
                                          updParams, nullptr, nullptr, 0)};
    ok = updRes.okCommand();
  }
  if (!ok) {
    error = PQerrorMessage(conn);
  }

  // Auditoría server-side de la transición de workflow (ADR-015/ADR-030):
  // solo si hubo un cambio REAL de estado (no en cada guardado de contenido).
  // Incluye el comentario del usuario (p.ej. motivo de rechazo) y, si es la
  // firma, el nombre/cargo del firmante — todo queda encadenado por hash.
  if (ok && statusChanged) {
    json::object detailObj{{"from", currentStatus}, {"to", r.status}};
    if (!workflowComment.empty()) {
      detailObj["comment"] = workflowComment;
    }
    if (isSigningNow) {
      detailObj["signed_by_name"] = signerName;
      detailObj["signed_by_role"] = signerRole;
    }
    const std::string detail = json::serialize(detailObj);
    // p_tenant_id/p_user_id quedan NULL (literal en el SQL): no hay UUID de
    // tenant/usuario resuelto en este punto, solo el username de auditoría.
    const char *auditParams[3] = {auditUsername.c_str(), id.c_str(), detail.c_str()};
    storage::PgResult auditRes{PQexecParams(
        conn,
        "SELECT fn_platform_audit_insert(NULL, NULL, $1, 'workflow_transition', "
        "'report', $2, NULL, NULL, $3::jsonb, TRUE, NULL)",
        3, nullptr, auditParams, nullptr, nullptr, 0)};
    (void)auditRes;  // best-effort: no bloquear el update si la auditoría falla
  }

  // ADR-015: versionado autoritativo en servidor — cada guardado confirmado
  // (autosave o manual) genera una revisión nueva en report_content_revision,
  // nunca solo en el cliente. El número de versión se calcula con el lock de
  // fila ya tomado sobre `reports` (SELECT...FOR UPDATE más arriba), que
  // serializa cualquier otra transición/guardado concurrente sobre el mismo
  // informe — evita colisiones en la UNIQUE(report_id, version_number).
  // Best-effort: un fallo aquí no debe revertir el guardado del contenido.
  if (ok) {
    const char *revParams[4] = {id.c_str(), contentStr.c_str(),
                                auditUsername.c_str(), company.c_str()};
    storage::PgResult revRes{PQexecParams(
        conn,
        "INSERT INTO report_content_revision "
        "(report_id, version_number, content_json, created_by, change_summary) "
        "VALUES ($1::uuid, "
        "COALESCE((SELECT MAX(version_number) FROM report_content_revision "
        "WHERE report_id = $1::uuid), 0) + 1, "
        "$2::jsonb, "
        "(SELECT id FROM auth_users WHERE username = $3 AND company_name = $4 LIMIT 1), "
        "'autosave')",
        4, nullptr, revParams, nullptr, nullptr, 0)};
  }

  if (ok) {
    if (!pgExecOk(conn, "COMMIT")) {
      error = PQerrorMessage(conn);
      ok = false;
    }
  } else {
    pgExecOk(conn, "ROLLBACK");
  }
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
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    return false;
  }
  const bool useAudit = !auditUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      return false;
    }
  }
  // Soft-delete parametrizado; el filtro por company preserva el tenant check.
  const char *delParams[2] = {id.c_str(), company.c_str()};
  static const char *kDeleteReportSql =
      "UPDATE reports SET deleted_at = NOW() "
      "WHERE id = $1 AND company_name = $2 AND deleted_at IS NULL";
  storage::PgResult delRes{PQexecParams(conn, kDeleteReportSql, 2, nullptr,
                                        delParams, nullptr, nullptr, 0)};
  bool ok = delRes.okCommand();
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
  return ok;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

json::array listReportRevisionsPg(const std::string &databaseUrl, const std::string &id,
                                  const std::string &company, std::string &error) {
  json::array revisions;
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return revisions;
  }
  // El join contra reports por (id, company_name) es el filtro de tenant:
  // si el informe no existe o pertenece a otra empresa, no devuelve filas.
  const char *params[2] = {id.c_str(), company.c_str()};
  static const char *kListRevisionsSql =
      "SELECT rev.revision_id::text, rev.version_number, "
      "rev.content_json::text, rev.created_at::text, "
      "COALESCE(u.username, ''), COALESCE(rev.change_summary, '') "
      "FROM report_content_revision rev "
      "JOIN reports r ON r.id = rev.report_id "
      "LEFT JOIN auth_users u ON u.id = rev.created_by "
      "WHERE rev.report_id = $1::uuid AND r.company_name = $2 "
      "ORDER BY rev.version_number DESC";
  storage::PgResult res{PQexecParams(conn, kListRevisionsSql, 2, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      json::value content;
      try {
        const char *cj = PQgetvalue(res.get(), i, 2);
        content = (cj && cj[0]) ? json::parse(std::string(cj)) : json::object{};
      } catch (...) {
        content = json::object{};
      }
      revisions.push_back(json::object{
          {"revision_id", PQgetvalue(res.get(), i, 0)},
          {"version_number", std::atoi(PQgetvalue(res.get(), i, 1))},
          {"content_json", content},
          {"created_at", PQgetvalue(res.get(), i, 3)},
          {"created_by", PQgetvalue(res.get(), i, 4)},
          {"change_summary", PQgetvalue(res.get(), i, 5)}});
    }
  } else {
    error = PQerrorMessage(conn);
  }
#else
  error = "postgres support is not compiled";
#endif
  return revisions;
}

} // namespace reports
