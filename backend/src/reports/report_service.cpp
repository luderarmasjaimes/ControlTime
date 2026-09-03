#include "report_service.hpp"
#include "../config/app_config.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/permissions.hpp"
#include "report_workflow.hpp"

#include <cstdlib>

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

std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &tenantId, std::string &error) {
  std::vector<Report> reps;
  // ADR-039 (migración completa): sin tenant real no hay nada que listar —
  // evita un roundtrip a Postgres solo para que el cast ::uuid de '' falle.
  if (tenantId.empty()) return reps;
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
  const char *listParams[1] = {tenantId.c_str()};
  // created_by/reviewed_by/last_modified_by (columnas de
  // db_scripts/05_reports_admin.sql) resueltas a nombre completo vía LEFT
  // JOIN — antes esta consulta las ignoraba por completo, por lo que el
  // frontend nunca recibía `createdBy` y `ReportsAdminModal.tsx::canEdit()`
  // (que compara `report.createdBy === session.username`) quedaba siempre en
  // false para el propio autor de un borrador (solo quien tenía
  // 'informes.sign' podía reabrir el informe para editar).
  static const char *kListReportsSql =
      "SELECT r.id, r.project_id, r.title, r.status, r.created_at, r.updated_at, "
      "COALESCE(r.company_name,''), COALESCE(r.signed_by_name,''), "
      "COALESCE(r.signed_by_role,''), COALESCE(r.signed_at::text,''), "
      "COALESCE(r.tenant_id::text,''), "
      "COALESCE(r.created_by::text,''), COALESCE(NULLIF(TRIM(cu.first_name || ' ' || cu.last_name), ''), cu.username, ''), "
      "COALESCE(r.reviewed_by::text,''), COALESCE(NULLIF(TRIM(ru.first_name || ' ' || ru.last_name), ''), ru.username, ''), "
      "COALESCE(r.reviewed_at::text,''), "
      "COALESCE(r.last_modified_by::text,''), COALESCE(NULLIF(TRIM(mu.first_name || ' ' || mu.last_name), ''), mu.username, ''), "
      // Conteo de páginas y tipo de documento (Word/PowerPoint) leídos
      // directo del jsonb con operadores nativos -- evita traer y parsear
      // content_json completo (puede ser varios MB) solo para poblar dos
      // columnas de la tabla de administración (ver Report::pageCount).
      "COALESCE(jsonb_array_length(r.content_json->'pages'), 0), "
      "COALESCE(r.content_json->'meta'->>'layoutMode', 'document') "
      "FROM reports r "
      "LEFT JOIN auth_users cu ON cu.id = r.created_by "
      "LEFT JOIN auth_users ru ON ru.id = r.reviewed_by "
      "LEFT JOIN auth_users mu ON mu.id = r.last_modified_by "
      "WHERE r.deleted_at IS NULL AND r.tenant_id = $1::uuid "
      "ORDER BY r.created_at DESC";
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
          r.tenantId = PQgetvalue(res.get(), i, 10);
          r.createdBy = PQgetvalue(res.get(), i, 11);
          r.createdByName = PQgetvalue(res.get(), i, 12);
          r.reviewedBy = PQgetvalue(res.get(), i, 13);
          r.reviewedByName = PQgetvalue(res.get(), i, 14);
          r.reviewedAt = PQgetvalue(res.get(), i, 15);
          r.lastModifiedBy = PQgetvalue(res.get(), i, 16);
          r.lastModifiedByName = PQgetvalue(res.get(), i, 17);
          r.pageCount = std::atoi(PQgetvalue(res.get(), i, 18));
          r.layoutMode = PQgetvalue(res.get(), i, 19);
          reps.push_back(std::move(r));
      }
  } else {
    error = PQerrorMessage(conn);
  }
#endif
  return reps;
}

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &tenantId, Report &out,
                     std::string &error) {
  if (tenantId.empty()) {
    error = "report_not_found";
    return false;
  }
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
  const char *getParams[2] = {id.c_str(), tenantId.c_str()};
  // ADR-021: version_number viene de MAX(...) sobre report_content_revision
  // (ADR-015) — la tabla `reports` no tiene columna propia de versión; es la
  // única fuente de verdad para "qué versión es esta" que el cliente debe
  // mostrar, en vez de su contador local de ediciones (document.meta.version).
  static const char *kGetReportSql =
      "SELECT r.id, r.project_id::text, r.title, r.content_json::text, r.status, "
      "r.created_at::text, r.updated_at::text, COALESCE(r.company_name,''), "
      "COALESCE(r.signed_by_name,''), COALESCE(r.signed_by_role,''), "
      "COALESCE(r.signed_at::text,''), "
      "COALESCE((SELECT MAX(version_number) FROM report_content_revision "
      "WHERE report_id = r.id), 1), "
      "COALESCE(r.tenant_id::text,''), "
      "COALESCE(r.created_by::text,''), COALESCE(NULLIF(TRIM(cu.first_name || ' ' || cu.last_name), ''), cu.username, ''), "
      "COALESCE(r.reviewed_by::text,''), COALESCE(NULLIF(TRIM(ru.first_name || ' ' || ru.last_name), ''), ru.username, ''), "
      "COALESCE(r.reviewed_at::text,''), "
      "COALESCE(r.last_modified_by::text,''), COALESCE(NULLIF(TRIM(mu.first_name || ' ' || mu.last_name), ''), mu.username, '') "
      "FROM reports r "
      "LEFT JOIN auth_users cu ON cu.id = r.created_by "
      "LEFT JOIN auth_users ru ON ru.id = r.reviewed_by "
      "LEFT JOIN auth_users mu ON mu.id = r.last_modified_by "
      "WHERE r.id = $1 AND r.tenant_id = $2::uuid "
      "AND r.deleted_at IS NULL";
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
  out.versionNumber = std::atoi(PQgetvalue(res.get(), 0, 11));
  out.tenantId = PQgetvalue(res.get(), 0, 12);
  out.createdBy = PQgetvalue(res.get(), 0, 13);
  out.createdByName = PQgetvalue(res.get(), 0, 14);
  out.reviewedBy = PQgetvalue(res.get(), 0, 15);
  out.reviewedByName = PQgetvalue(res.get(), 0, 16);
  out.reviewedAt = PQgetvalue(res.get(), 0, 17);
  out.lastModifiedBy = PQgetvalue(res.get(), 0, 18);
  out.lastModifiedByName = PQgetvalue(res.get(), 0, 19);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken, int &outVersionNumber) {
  outVersionNumber = 0;
  // ADR-039 (migración completa, 2026-07-13): tenant_id ya no es opcional —
  // la columna es NOT NULL en BD; se valida aquí primero para devolver un
  // error de negocio claro ("tenant_required") en vez de un fallo genérico
  // de constraint de Postgres.
  if (r.tenantId.empty()) {
    error = "tenant_required";
    return false;
  }
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
  // company_name se conserva solo como campo de display legacy (ya validado
  // arriba que tenant_id es real y obligatorio — ADR-039).
  std::string contentStr = json::serialize(r.contentJson);
  // created_by/last_modified_by (db_scripts/05_reports_admin.sql) resueltos
  // al mismo auth_users que ya resuelve la revisión inicial de abajo —
  // ANTES de este fix quedaban NULL para siempre porque el INSERT ni
  // siquiera los mencionaba, así que ReportsAdminModal.tsx::canEdit() jamás
  // veía coincidir `report.createdBy === session.username` (bug reportado:
  // el dueño de un informe recién creado no podía volver a editarlo).
  const char *paramValues[8] = {
      r.projectId.empty() ? nullptr : r.projectId.c_str(),
      r.title.c_str(),
      contentStr.c_str(),
      r.status.c_str(),
      r.company.c_str(),
      r.tenantId.c_str(),
      auditUsername.c_str(),
      auditCompany.c_str()};
  static const char *kInsertReportSql =
      "INSERT INTO reports (project_id, title, content_json, status, company_name, "
      "tenant_id, created_by, last_modified_by) "
      "VALUES ($1, $2, $3, $4, $5, $6::uuid, "
      "(SELECT id FROM auth_users WHERE username = $7 AND company_name = $8 LIMIT 1), "
      "(SELECT id FROM auth_users WHERE username = $7 AND company_name = $8 LIMIT 1)) "
      "RETURNING id::text";
  storage::PgResult res{PQexecParams(conn, kInsertReportSql, 8, nullptr, paramValues,
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
  // auditoría de workflow más abajo). auditCompany (empresa propia de la
  // sesión) resuelve el auth_users.id del creador — independiente del
  // tenant_id del informe (ADR-039).
  {
    const char *revParams[4] = {outNewId.c_str(), contentStr.c_str(),
                                auditUsername.c_str(), auditCompany.c_str()};
    storage::PgResult revRes{PQexecParams(
        conn,
        "INSERT INTO report_content_revision "
        "(report_id, version_number, content_json, created_by, change_summary) "
        "VALUES ($1::uuid, 1, $2::jsonb, "
        "(SELECT id FROM auth_users WHERE username = $3 AND company_name = $4 LIMIT 1), "
        "'creacion_inicial')",
        4, nullptr, revParams, nullptr, nullptr, 0)};
  }
  outVersionNumber = 1;  // primera revisión, hardcodeada arriba (version_number=1)

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
                    const std::string &tenantId, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken, int &outVersionNumber,
                    const std::string &userId,
                    const std::string &signerRole,
                    const std::string &workflowComment,
                    const std::string &expectedVersion) {
  outVersionNumber = 0;
  if (tenantId.empty()) {
    error = "tenant_required";
    return false;
  }
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
  // validar la transición antes de aplicar cualquier cambio. ADR-039: el
  // filtro de aislamiento es tenant_id (UUID), no company_name.
  const char *lockParams[2] = {id.c_str(), tenantId.c_str()};
  storage::PgResult lockRes{PQexecParams(
      conn,
      "SELECT status, "
      "COALESCE((SELECT MAX(version_number) FROM report_content_revision "
      "WHERE report_id = reports.id), 1) "
      "FROM reports WHERE id = $1 AND tenant_id = $2::uuid "
      "AND deleted_at IS NULL FOR UPDATE",
      2, nullptr, lockParams, nullptr, nullptr, 0)};
  if (!lockRes.okTuples() || PQntuples(lockRes.get()) < 1) {
    pgExecOk(conn, "ROLLBACK");
    error = "report_not_found";
    return false;
  }
  const std::string currentStatus = PQgetvalue(lockRes.get(), 0, 0);
  const std::string currentVersionStr = PQgetvalue(lockRes.get(), 0, 1);
  // ADR-022: concurrencia optimista — se compara DENTRO del mismo lock de
  // fila (nadie más puede colar un UPDATE entre este SELECT y el de abajo),
  // así que esta comparación es la garantía real, no solo una verificación
  // de cortesía del lado del cliente.
  if (!expectedVersion.empty() && expectedVersion != currentVersionStr) {
    pgExecOk(conn, "ROLLBACK");
    error = "version_conflict:" + currentVersionStr;
    return false;
  }
  const bool statusChanged = currentStatus != r.status;

  // ADR-079: un informe firmado o archivado es inmutable — ni un PUT de
  // "mismo estado" (solo contenido) ni una transición pueden alterarlo,
  // sin excepción de rol (ni siquiera admin). Corregir un informe firmado
  // exige un informe nuevo, no editar el existente — cierra un hueco real:
  // antes, `from == to` siempre pasaba `isValidReportTransition` (regla
  // "sin cambio de estado siempre se permite"), así que cualquier miembro
  // del tenant podía reescribir silenciosamente el contenido de un informe
  // ya firmado con un PUT que repitiera status="signed".
  if (currentStatus == "signed" || currentStatus == "archived") {
    pgExecOk(conn, "ROLLBACK");
    error = "report_immutable:" + currentStatus;
    return false;
  }

  if (!isValidReportTransition(currentStatus, r.status)) {
    pgExecOk(conn, "ROLLBACK");
    error = "invalid_workflow_transition:" + currentStatus + "->" + r.status;
    return false;
  }

  // ADR-079: la máquina de estados (arriba) solo valida que el par
  // from->to sea geométricamente válido; esto valida que el ROL de quien
  // pide el cambio tenga autoridad real para pedirlo. Antes de este fix no
  // existía ningún chequeo de rol/permiso en todo el módulo de informes —
  // solo se verificaba pertenencia al tenant — así que cualquier usuario
  // autenticado (operator/geologist/safety/viewer) podía aprobar y firmar
  // cualquier informe (hallazgo de auditoría 2026-08-02). El permiso
  // requerido depende únicamente del estado ACTUAL (ya que signed/archived
  // quedaron bloqueados arriba, sin excepción):
  //   - draft/rejected: 'informes.edit' — el autor edita y envía a revisión,
  //     o retoma un informe rechazado.
  //   - in_review/approved: 'informes.sign' — solo quien puede aprobar/
  //     firmar puede tocar el contenido o mover el workflow desde aquí
  //     (evita que el autor original edite su informe después de
  //     enviarlo a revisión).
  const std::string requiredPermission =
      (currentStatus == "draft" || currentStatus == "rejected")
          ? "informes.edit"
          : "informes.sign";
  if (!auth::hasPermission(userId, tenantId, signerRole, requiredPermission)) {
    pgExecOk(conn, "ROLLBACK");
    error = "forbidden:" + requiredPermission;
    return false;
  }

  // ADR-018: 'signed' exige una firma documental registrada (nombre, cargo,
  // fecha) — no basta el hash de integridad. Se captura SOLO en el momento
  // exacto de la transición approved->signed (nunca se re-sobreescribe en
  // transiciones posteriores como signed->archived, que preservan la firma
  // original). El nombre se resuelve del lado servidor (auth_users, vía
  // auditCompany — la empresa propia de la sesión que firma, independiente
  // del tenant_id del informe), nunca se confía en el cliente para "quién firmó".
  const bool isSigningNow = statusChanged && r.status == "signed";
  std::string signerName;
  if (isSigningNow) {
    const char *signerParams[2] = {auditUsername.c_str(), auditCompany.c_str()};
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

  // UPDATE parametrizado; company_name YA NO se toca aquí (ADR-039: es solo
  // display legacy, inmutable después de creado) — el filtro de aislamiento
  // es tenant_id. Cuando la transición es la firma real, se añaden las
  // columnas de firma documental (ADR-018) al mismo UPDATE atómico.
  //
  // last_modified_by/reviewed_by/reviewed_at (db_scripts/05_reports_admin.sql):
  // ANTES de este fix el UPDATE ni las mencionaba, así que quedaban NULL para
  // siempre — el mismo bug de fondo que en createReportPg (ver comentario ahí),
  // y ADEMÁS la columna "Revisado por" de ReportsAdminModal.tsx mostraba
  // "Sin revisar" incluso en informes ya aprobados/firmados. `reviewingNow`
  // marca una transición ejercida bajo autoridad de revisión (mismo criterio
  // que `requiredPermission == "informes.sign"` un poco más arriba: solo
  // in_review→approved/rejected y approved→signed/in_review) — un simple
  // resave de contenido sin cambio de estado NO debe pisar quién revisó por
  // última vez.
  const bool reviewingNow = statusChanged && requiredPermission == "informes.sign";
  const std::string reviewingNowStr = reviewingNow ? "true" : "false";
  std::string contentStr = json::serialize(r.contentJson);
  bool ok;
  if (isSigningNow) {
    // signed_by (FK UUID) se resuelve por subquery de username+auditCompany
    // dentro del mismo UPDATE atómico; signed_by_name/signed_by_role quedan
    // desnormalizados para que la firma siga siendo legible aunque el
    // usuario cambie de nombre/rol o sea desactivado después. La firma
    // siempre ocurre bajo 'informes.sign' (approved→signed), así que
    // reviewed_by/reviewed_at se fijan sin condicional aquí.
    static const char *kUpdateReportSignedSql =
        "UPDATE reports SET title = $1, content_json = $2, status = $3, "
        "signed_by = (SELECT id FROM auth_users WHERE username = $4 "
        "AND company_name = $5 LIMIT 1), "
        "signed_by_name = $6, signed_by_role = $7, signed_at = NOW(), "
        "last_modified_by = $10::uuid, reviewed_by = $10::uuid, reviewed_at = NOW() "
        "WHERE id = $8 AND tenant_id = $9::uuid AND deleted_at IS NULL";
    const char *updParams[10] = {r.title.c_str(),        contentStr.c_str(),
                                 r.status.c_str(),        auditUsername.c_str(),
                                 auditCompany.c_str(),    signerName.c_str(),
                                 signerRole.c_str(),      id.c_str(),
                                 tenantId.c_str(),        userId.c_str()};
    storage::PgResult updRes{PQexecParams(conn, kUpdateReportSignedSql, 10, nullptr,
                                          updParams, nullptr, nullptr, 0)};
    ok = updRes.okCommand();
  } else {
    static const char *kUpdateReportSql =
        "UPDATE reports SET title = $1, content_json = $2, status = $3, "
        "last_modified_by = $6::uuid, "
        "reviewed_by = CASE WHEN $7::boolean THEN $6::uuid ELSE reviewed_by END, "
        "reviewed_at = CASE WHEN $7::boolean THEN NOW() ELSE reviewed_at END "
        "WHERE id = $4 AND tenant_id = $5::uuid AND deleted_at IS NULL";
    const char *updParams[7] = {r.title.c_str(), contentStr.c_str(),
                                r.status.c_str(), id.c_str(), tenantId.c_str(),
                                userId.c_str(), reviewingNowStr.c_str()};
    storage::PgResult updRes{PQexecParams(conn, kUpdateReportSql, 7, nullptr,
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
                                auditUsername.c_str(), auditCompany.c_str()};
    storage::PgResult revRes{PQexecParams(
        conn,
        "INSERT INTO report_content_revision "
        "(report_id, version_number, content_json, created_by, change_summary) "
        "VALUES ($1::uuid, "
        "COALESCE((SELECT MAX(version_number) FROM report_content_revision "
        "WHERE report_id = $1::uuid), 0) + 1, "
        "$2::jsonb, "
        "(SELECT id FROM auth_users WHERE username = $3 AND company_name = $4 LIMIT 1), "
        "'autosave') RETURNING version_number",
        4, nullptr, revParams, nullptr, nullptr, 0)};
    // ADR-021: el cliente necesita el version_number real para no depender de
    // su propio contador local (document.meta.version, que cuenta ediciones,
    // no revisiones confirmadas). Best-effort: si por algún motivo no viene
    // (no debería, dado que `ok` ya es true), outVersionNumber queda en 0 y el
    // cliente cae a su fallback local — no bloquea el guardado ya confirmado.
    if (revRes.okTuples() && PQntuples(revRes.get()) > 0) {
      outVersionNumber = std::atoi(PQgetvalue(revRes.get(), 0, 0));
    }
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
                    const std::string &tenantId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken) {
  if (tenantId.empty()) {
    error = "tenant_required";
    return false;
  }
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
  // ADR-079: un informe firmado es inmutable — ni admin puede eliminarlo
  // (solo archivarlo ya fue posible vía workflow). Mismo criterio de
  // integridad documental que la inmutabilidad aplicada en updateReportPg.
  {
    const char *statusParams[2] = {id.c_str(), tenantId.c_str()};
    storage::PgResult statusRes{PQexecParams(conn,
        "SELECT status FROM reports WHERE id = $1 AND tenant_id = $2::uuid "
        "AND deleted_at IS NULL",
        2, nullptr, statusParams, nullptr, nullptr, 0)};
    if (!statusRes.okTuples() || PQntuples(statusRes.get()) < 1) {
      if (useAudit) pgExecOk(conn, "ROLLBACK");
      error = "report_not_found";
      return false;
    }
    if (std::string(PQgetvalue(statusRes.get(), 0, 0)) == "signed") {
      if (useAudit) pgExecOk(conn, "ROLLBACK");
      error = "report_immutable:signed";
      return false;
    }
  }
  // Soft-delete parametrizado; el filtro por tenant_id (ADR-039) preserva el
  // aislamiento.
  const char *delParams[2] = {id.c_str(), tenantId.c_str()};
  static const char *kDeleteReportSql =
      "UPDATE reports SET deleted_at = NOW() "
      "WHERE id = $1 AND tenant_id = $2::uuid AND deleted_at IS NULL";
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
                                  const std::string &tenantId, std::string &error) {
  json::array revisions;
  if (tenantId.empty()) return revisions;
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return revisions;
  }
  // El join contra reports por (id, tenant_id) es el filtro de tenant
  // (ADR-039): si el informe no existe o pertenece a otro tenant, no
  // devuelve filas.
  const char *params[2] = {id.c_str(), tenantId.c_str()};
  static const char *kListRevisionsSql =
      "SELECT rev.revision_id::text, rev.version_number, "
      "rev.content_json::text, rev.created_at::text, "
      "COALESCE(u.username, ''), COALESCE(rev.change_summary, '') "
      "FROM report_content_revision rev "
      "JOIN reports r ON r.id = rev.report_id "
      "LEFT JOIN auth_users u ON u.id = rev.created_by "
      "WHERE rev.report_id = $1::uuid AND r.tenant_id = $2::uuid "
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

bool createExportJobPg(const std::string &databaseUrl, const std::string &reportId,
                       const std::string &tenantId, const std::string &exportFormat,
                       const json::value &optionsJson, const std::string &createdByUserId,
                       const std::string &contentRevisionId, std::string &outJobId,
                       std::string &error) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const std::string optionsStr = json::serialize(optionsJson);
  const char *params[6] = {
      reportId.c_str(),
      tenantId.empty() ? nullptr : tenantId.c_str(),
      exportFormat.c_str(),
      optionsStr.c_str(),
      createdByUserId.empty() ? nullptr : createdByUserId.c_str(),
      contentRevisionId.empty() ? nullptr : contentRevisionId.c_str(),
  };
  static const char *kInsertJobSql =
      "INSERT INTO report_export_job "
      "(report_id, tenant_id, export_format, options, created_by, content_revision_id) "
      "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid, $6::bigint) "
      "RETURNING job_id::text";
  storage::PgResult res{PQexecParams(conn, kInsertJobSql, 6, nullptr, params,
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

bool getExportJobPg(const std::string &databaseUrl, const std::string &jobId,
                    const std::string &tenantId, ExportJob &out, std::string &error) {
  if (tenantId.empty()) {
    error = "export_job_not_found";
    return false;
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  // Filtro de tenant directo sobre report_export_job.tenant_id (copiado del
  // informe al crear el job) — mismo guard IDOR que getReportByIdPg, sin
  // necesitar un join contra reports.
  const char *params[2] = {jobId.c_str(), tenantId.c_str()};
  static const char *kGetJobSql =
      "SELECT job_id::text, report_id::text, export_format, status, "
      "COALESCE(storage_uri,''), COALESCE(error_message,''), options::text, "
      "created_at::text, COALESCE(started_at::text,''), COALESCE(completed_at::text,'') "
      "FROM report_export_job WHERE job_id = $1::uuid AND tenant_id = $2::uuid";
  storage::PgResult res{PQexecParams(conn, kGetJobSql, 2, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) < 1) {
    error = "export_job_not_found";
    return false;
  }
  out.jobId = PQgetvalue(res.get(), 0, 0);
  out.reportId = PQgetvalue(res.get(), 0, 1);
  out.exportFormat = PQgetvalue(res.get(), 0, 2);
  out.status = PQgetvalue(res.get(), 0, 3);
  out.storageUri = PQgetvalue(res.get(), 0, 4);
  out.errorMessage = PQgetvalue(res.get(), 0, 5);
  try {
    const char *opts = PQgetvalue(res.get(), 0, 6);
    out.options = (opts && opts[0]) ? json::parse(std::string(opts)) : json::object{};
  } catch (...) {
    out.options = json::object{};
  }
  out.createdAt = PQgetvalue(res.get(), 0, 7);
  out.startedAt = PQgetvalue(res.get(), 0, 8);
  out.completedAt = PQgetvalue(res.get(), 0, 9);
  return true;
#else
  error = "postgres support is not compiled";
  return false;
#endif
}

bool updateExportJobStatusPg(const std::string &databaseUrl, const std::string &jobId,
                             const std::string &status, const std::string &storageUri,
                             const std::string &errorMessage, std::string &error,
                             const json::value &mergeOptions) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  // `mergeOptions` null (default) => no tocar `options` -- se manda NULL al
  // placeholder y el CASE de abajo lo deja intacto. Un `mergeOptions` no-null
  // se serializa y se mergea vía `options || $5::jsonb` (Postgres JSONB),
  // nunca reemplaza el objeto completo.
  const std::string mergeOptionsJson = mergeOptions.is_null() ? "" : json::serialize(mergeOptions);
  const char *params[5] = {
      jobId.c_str(),
      status.c_str(),
      storageUri.empty() ? nullptr : storageUri.c_str(),
      errorMessage.empty() ? nullptr : errorMessage.c_str(),
      mergeOptionsJson.empty() ? nullptr : mergeOptionsJson.c_str(),
  };
  // started_at/completed_at se resuelven server-side a partir del status
  // destino, nunca los manda el caller: evita que un worker con reloj
  // desincronizado (o una respuesta duplicada del sidecar) pise timestamps.
  static const char *kUpdateJobSql =
      "UPDATE report_export_job SET "
      "status = $2, "
      "storage_uri = COALESCE($3, storage_uri), "
      "error_message = $4, "
      "options = CASE WHEN $5::jsonb IS NOT NULL THEN options || $5::jsonb ELSE options END, "
      "started_at = CASE WHEN $2 = 'running' AND started_at IS NULL "
      "  THEN NOW() ELSE started_at END, "
      "completed_at = CASE WHEN $2 IN ('success','failed','cancelled') "
      "  THEN NOW() ELSE completed_at END "
      "WHERE job_id = $1::uuid";
  storage::PgResult res{PQexecParams(conn, kUpdateJobSql, 5, nullptr, params,
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

bool upsertExportJobAssetPg(const std::string &databaseUrl, const std::string &jobId,
                            int pageNumber, const std::string &kind,
                            const std::string &storageUri, const std::string &speakerNotes,
                            double durationSeconds, std::string &error) {
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const std::string pageNumberStr = std::to_string(pageNumber);
  const std::string durationStr = std::to_string(durationSeconds);
  const char *params[6] = {
      jobId.c_str(),
      pageNumberStr.c_str(),
      kind.c_str(),
      storageUri.empty() ? nullptr : storageUri.c_str(),
      speakerNotes.empty() ? nullptr : speakerNotes.c_str(),
      durationStr.c_str(),
  };
  // ON CONFLICT (job_id, page_number): re-grabar/editar la narración de una
  // página ya narrada reemplaza la fila anterior en vez de acumular filas
  // huérfanas — coherente con "una narración por página por job".
  static const char *kUpsertAssetSql =
      "INSERT INTO report_export_job_asset "
      "(job_id, page_number, kind, storage_uri, speaker_notes, duration_seconds) "
      "VALUES ($1::uuid, $2::int, $3, $4, $5, $6::numeric) "
      "ON CONFLICT (job_id, page_number) DO UPDATE SET "
      "kind = EXCLUDED.kind, storage_uri = EXCLUDED.storage_uri, "
      "speaker_notes = EXCLUDED.speaker_notes, duration_seconds = EXCLUDED.duration_seconds";
  storage::PgResult res{PQexecParams(conn, kUpsertAssetSql, 6, nullptr, params,
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

std::vector<ExportJobAsset> listExportJobAssetsPg(const std::string &databaseUrl,
                                                  const std::string &jobId, std::string &error) {
  std::vector<ExportJobAsset> assets;
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return assets;
  }
  const char *params[1] = {jobId.c_str()};
  static const char *kListAssetsSql =
      "SELECT asset_id::text, job_id::text, page_number, kind, "
      "COALESCE(storage_uri,''), COALESCE(speaker_notes,''), "
      "COALESCE(duration_seconds,0)::text "
      "FROM report_export_job_asset WHERE job_id = $1::uuid ORDER BY page_number ASC";
  storage::PgResult res{PQexecParams(conn, kListAssetsSql, 1, nullptr, params,
                                     nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      ExportJobAsset a;
      a.assetId = PQgetvalue(res.get(), i, 0);
      a.jobId = PQgetvalue(res.get(), i, 1);
      a.pageNumber = std::atoi(PQgetvalue(res.get(), i, 2));
      a.kind = PQgetvalue(res.get(), i, 3);
      a.storageUri = PQgetvalue(res.get(), i, 4);
      a.speakerNotes = PQgetvalue(res.get(), i, 5);
      a.durationSeconds = std::atof(PQgetvalue(res.get(), i, 6));
      assets.push_back(std::move(a));
    }
  } else {
    error = res ? res.error() : PQerrorMessage(conn);
  }
#else
  error = "postgres support is not compiled";
#endif
  return assets;
}

} // namespace reports
