#include "auth_storage_pg.hpp"
#include "auth_session.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <atomic>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "../biometric/face_analysis.hpp"
using biometric::buildFaceLoginProbe;

#if HAS_LIBPQ

namespace auth {

static std::atomic<bool> gAuthSchemaReady{false};
static std::mutex gAuthSchemaInitMutex;

static constexpr char kMiningTelemetryDemoTenantId[] =
    "a0000001-0000-4000-8000-000000000001";

static const char kAuthUserNotFoundMsg[] = "USUARIO NO EXISTE";
static const char kAuthWrongPasswordMsg[] = "La contraseña no es correcta.";
static const char kAuthAmbiguousIdentityMsg[] =
    "El identificador coincide con más de un registro en esa empresa. Use un "
    "dato único (por ejemplo el DNI) e intente de nuevo.";

std::string pqEscapeLiteral(PGconn *conn, const std::string &value) {
  char *escaped = PQescapeLiteral(conn, value.c_str(), value.size());
  if (!escaped) {
    throw std::runtime_error("failed to escape sql literal");
  }
  std::string out(escaped);
  PQfreemem(escaped);
  return out;
}

bool pgExecOk(PGconn *conn, const std::string &sql) {
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res) {
    return false;
  }
  const auto status = PQresultStatus(res);
  const bool ok = (status == PGRES_COMMAND_OK || status == PGRES_TUPLES_OK);
  PQclear(res);
  return ok;
}

/** GUC transaccional para triggers → platform_audit_log (mig. 20–21). */
bool pgExecAuditContextFromLogin(PGconn *conn, const std::string &username,
                                 const std::string &companyName,
                                 const std::string &sessionToken) {
  if (username.empty()) {
    return true;
  }
  const std::string tok =
      sessionToken.empty() ? "NULL::TEXT" : pqEscapeLiteral(conn, sessionToken);
  const std::string sql = "SELECT fn_audit_context_from_login(" +
                           pqEscapeLiteral(conn, username) + ", " +
                           pqEscapeLiteral(conn, companyName) + ", " + tok + ")";
  return pgExecOk(conn, sql);
}

bool ensureAuthSchemaPg(PGconn *conn) {
  if (gAuthSchemaReady.load(std::memory_order_acquire)) {
    return true;
  }
  std::lock_guard<std::mutex> lk(gAuthSchemaInitMutex);
  if (gAuthSchemaReady.load(std::memory_order_relaxed)) {
    return true;
  }
  const char *sql = R"SQL(
CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    company_name VARCHAR(180) NOT NULL,
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120) NOT NULL,
    dni VARCHAR(12) NOT NULL UNIQUE,
    username VARCHAR(80) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'operator',
    password_hash TEXT NOT NULL,
    face_template JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_name, username)
);
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_action VARCHAR(60) NOT NULL,
    company_name VARCHAR(180),
    username VARCHAR(80),
    success BOOLEAN NOT NULL,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS auth_companies (
    name VARCHAR(180) PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_time ON auth_audit_logs(event_time DESC);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'operator';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS ruc VARCHAR(20) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mobile VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(120) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS suspension_until TIMESTAMPTZ;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS face_template JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_cartoon_base64 TEXT;

CREATE TABLE IF NOT EXISTS auth_user_maintenance_audit (
    id BIGSERIAL PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    company_name VARCHAR(180) NOT NULL,
    success BOOLEAN NOT NULL,
    action VARCHAR(60) NOT NULL,
    operator_username VARCHAR(80) NOT NULL,
    target_username VARCHAR(80) NOT NULL,
    security_method VARCHAR(40),
    detail TEXT,
    additional JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_auth_user_maint_audit_time ON auth_user_maintenance_audit(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_auth_user_maint_audit_company ON auth_user_maintenance_audit(company_name);
)SQL";
  const bool ok = pgExecOk(conn, sql);
  if (ok) {
    for (const auto &company : config::kMiningCompanies) {
      const std::string seedSql =
          "INSERT INTO auth_companies(name, active) VALUES(" +
          pqEscapeLiteral(conn, company) +
          ", true) ON CONFLICT (name) DO NOTHING";
      (void)pgExecOk(conn, seedSql);
    }
  }
  if (ok) {
    (void)pgExecOk(conn, "UPDATE auth_users SET account_status = 'active', suspension_until = NULL WHERE username IN ('JUANP', 'JUAN@gmail.com')");
    gAuthSchemaReady.store(true, std::memory_order_release);
  }
  return ok;
}

std::string trimCompanyName(const std::string &s) {
  size_t start = 0;
  while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
    ++start;
  }
  size_t end = s.size();
  while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
    --end;
  }
  return s.substr(start, end - start);
}

void appendAuthAuditLogPg(PGconn *conn, const std::string &action,
                          const std::string &company,
                          const std::string &username, bool ok,
                          const std::string &detail) {
  const std::string sql =
      "INSERT INTO auth_audit_logs(event_action, company_name, username, success, detail) VALUES(" +
      pqEscapeLiteral(conn, action) + "," + pqEscapeLiteral(conn, company) + "," +
      pqEscapeLiteral(conn, username) + "," + (ok ? "true" : "false") + "," +
      pqEscapeLiteral(conn, detail) + ")";
  (void)pgExecOk(conn, sql);
}

bool validateCompanyPg(const std::string &databaseUrl, const std::string &companyName, const std::string &ruc, std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  std::string sql = "SELECT 1 FROM auth_users WHERE company_name = " + pqEscapeLiteral(conn, companyName);
  if (!ruc.empty()) {
    sql += " AND ruc = " + pqEscapeLiteral(conn, ruc);
  }
  PGresult *res = PQexec(conn, sql.c_str());
  bool exists = (res && PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0);
  if (res) PQclear(res);
  PQfinish(conn);
  return exists;
}

bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error) {
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

  std::ostringstream tpl;
  tpl << '[';
  for (size_t i = 0; i < user.faceTemplate.size(); ++i) {
    if (i > 0) tpl << ',';
    tpl << user.faceTemplate[i];
  }
  tpl << ']';

  const std::string checkSql = "SELECT 1 FROM auth_users WHERE dni=" +
                               pqEscapeLiteral(conn, user.dni) + " LIMIT 1";
  PGresult *checkRes = PQexec(conn, checkSql.c_str());
  if (!checkRes || PQresultStatus(checkRes) != PGRES_TUPLES_OK) {
    error = "failed to validate dni";
    if (checkRes) PQclear(checkRes);
    PQfinish(conn);
    return false;
  }
  if (PQntuples(checkRes) > 0) {
    PQclear(checkRes);
    error = "dni already exists";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "dni_exists");
    PQfinish(conn);
    return false;
  }
  PQclear(checkRes);

  const std::string avatarSql =
      user.avatarCartoonBase64.empty()
          ? "NULL"
          : pqEscapeLiteral(conn, user.avatarCartoonBase64);
  const std::string insertSql =
      "INSERT INTO auth_users(id,company_name,first_name,last_name,dni,username,role,password_hash,face_template,ruc,phone,mobile,email,avatar_cartoon_base64) VALUES(" +
      pqEscapeLiteral(conn, user.id) + "," + pqEscapeLiteral(conn, user.company) +
      "," + pqEscapeLiteral(conn, user.firstName) + "," +
      pqEscapeLiteral(conn, user.lastName) + "," + pqEscapeLiteral(conn, user.dni) +
      "," + pqEscapeLiteral(conn, user.username) + "," +
      pqEscapeLiteral(conn, user.role) + "," +
      pqEscapeLiteral(conn, user.passwordHash) + "," +
      pqEscapeLiteral(conn, tpl.str()) + "::jsonb," +
      pqEscapeLiteral(conn, user.ruc) + "," +
      pqEscapeLiteral(conn, user.phone) + "," +
      pqEscapeLiteral(conn, user.mobile) + "," +
      pqEscapeLiteral(conn, user.email) + "," + avatarSql + ")";

  if (!pgExecOk(conn, insertSql)) {
    error = "failed to insert user";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "insert_failed");
    PQfinish(conn);
    return false;
  }

  appendAuthAuditLogPg(conn, "register", user.company, user.username, true,
                       "ok");
  PQfinish(conn);
  return true;
}

bool updateUserAvatarCartoonPg(const std::string &databaseUrl,
                               const std::string &userId,
                               const std::string &avatarBase64,
                               const std::string &actorUsername,
                               const std::string &actorCompany,
                               const std::string &sessionToken,
                               std::string &error) {
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
  const bool useAudit = !actorUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, actorUsername, actorCompany, sessionToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      PQfinish(conn);
      return false;
    }
  }
  const std::string sql = "UPDATE auth_users SET avatar_cartoon_base64=" +
                          pqEscapeLiteral(conn, avatarBase64) + " WHERE id=" +
                          pqEscapeLiteral(conn, userId);
  const bool ok = pgExecOk(conn, sql);
  if (!ok) {
    error = PQerrorMessage(conn);
  }
  if (useAudit) {
    if (ok) {
      if (!pgExecOk(conn, "COMMIT")) {
        error = PQerrorMessage(conn);
        PQfinish(conn);
        return false;
      }
    } else {
      pgExecOk(conn, "ROLLBACK");
    }
  }
  PQfinish(conn);
  return ok;
}

/** Condición SQL: usuario, DNI o RUC literal; si identity es solo dígitos, también DNI = valor bigint (ceros a la izquierda). */
std::string pgSqlAuthIdentityMatch(PGconn *conn,
                                   const std::string &identityKey) {
  const std::string e = pqEscapeLiteral(conn, identityKey);
  std::string clause =
      "(username=" + e + " OR dni=" + e + " OR ruc=" + e;
  if (authIdentityKeyIsAllDigits(identityKey) && identityKey.size() <= 15) {
    clause +=
        " OR (dni ~ '^[0-9]+$' AND btrim(dni) <> '' AND "
        "btrim(dni)::bigint = " +
        e + "::bigint)";
  }
  clause += ")";
  return clause;
}

AuthLoginIdentityLookupResult authLookupIdentityForCompanyPg(
    const std::string &databaseUrl, const std::string &company,
    const std::string &identityKey) {
  AuthLoginIdentityLookupResult out;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    out.diagnostic = PQerrorMessage(conn);
    PQfinish(conn);
    return out;
  }
  (void)ensureAuthSchemaPg(conn);
  const std::string sql =
      "SELECT username FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    out.diagnostic = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (out.diagnostic.empty()) {
      out.diagnostic = "query failed";
    }
    if (res) {
      PQclear(res);
    }
    PQfinish(conn);
    return out;
  }
  const int rows = PQntuples(res);
  if (rows == 0) {
    PQclear(res);
    PQfinish(conn);
    out.kind = AuthLoginIdentityLookupResult::Kind::NotFound;
    return out;
  }
  if (rows > 1) {
    PQclear(res);
    PQfinish(conn);
    out.kind = AuthLoginIdentityLookupResult::Kind::Ambiguous;
    return out;
  }
  out.kind = AuthLoginIdentityLookupResult::Kind::Ok;
  out.resolvedUsername = PQgetvalue(res, 0, 0);
  PQclear(res);
  PQfinish(conn);
  return out;
}

std::string resolveTelemetryTenantIdPg(void *connV, const std::string &userId,
                                       const std::string &companyName) {
  auto *conn = static_cast<PGconn *>(connV);
  const std::string fallback(kMiningTelemetryDemoTenantId);
  if (PQstatus(conn) != CONNECTION_OK) {
    return fallback;
  }
  {
    const std::string q =
        std::string("SELECT me.tenant_id::text FROM mineria_empresas me WHERE "
                    "TRIM(me.nombre) = TRIM(") +
        pqEscapeLiteral(conn, companyName) +
        ") AND me.tenant_id IS NOT NULL LIMIT 1";
    PGresult *r = PQexec(conn, q.c_str());
    if (r && PQresultStatus(r) == PGRES_TUPLES_OK && PQntuples(r) > 0 &&
        !PQgetisnull(r, 0, 0)) {
      const char *v = PQgetvalue(r, 0, 0);
      if (v != nullptr && v[0] != '\0') {
        std::string tid(v);
        PQclear(r);
        return tid;
      }
    }
    if (r) {
      PQclear(r);
    }
  }
  if (!userId.empty()) {
    const std::string q =
        std::string("SELECT aut.tenant_id::text FROM auth_user_tenant aut WHERE "
                    "aut.user_id = ") +
        pqEscapeLiteral(conn, userId) +
        "::uuid AND aut.is_default IS TRUE LIMIT 1";
    PGresult *r = PQexec(conn, q.c_str());
    if (r && PQresultStatus(r) == PGRES_TUPLES_OK && PQntuples(r) > 0 &&
        !PQgetisnull(r, 0, 0)) {
      const char *v = PQgetvalue(r, 0, 0);
      if (v != nullptr && v[0] != '\0') {
        std::string tid(v);
        PQclear(r);
        return tid;
      }
    }
    if (r) {
      PQclear(r);
    }
  }
  return fallback;
}

std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &identityKey,
                                        const std::string &passwordHash,
                                        std::string &error,
                                        std::string *errorCodeOut) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, avatar_cartoon_base64, account_status, suspension_until::text "
      "FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";

  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    error = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    if (res) PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  const int rowCount = PQntuples(res);
  if (rowCount == 0) {
    PQclear(res);
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "user_not_found");
    PQfinish(conn);
    error = kAuthUserNotFoundMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "user_not_found";
    }
    return std::nullopt;
  }
  if (rowCount > 1) {
    PQclear(res);
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "ambiguous_identity");
    PQfinish(conn);
    error = kAuthAmbiguousIdentityMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "ambiguous_identity";
    }
    return std::nullopt;
  }

  const std::string status = PQgetvalue(res, 0, 11);
  if (status != "active" && !status.empty()) {
    if (status == "blocked") error = "Usuario bloqueado. Contacte a soporte.";
    else if (status == "deleted") error = "La cuenta ha sido eliminada.";
    else if (status == "suspended") {
        std::string until = PQgetisnull(res, 0, 12) ? "" : PQgetvalue(res, 0, 12);
        error = "Cuenta suspendida temporalmente" + (until.empty() ? "" : " hasta " + until) + ".";
    } else error = "Cuenta en estado: " + status;
    PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  AuthUser u;
  u.id = PQgetvalue(res, 0, 0);
  u.company = PQgetvalue(res, 0, 1);
  u.firstName = PQgetvalue(res, 0, 2);
  u.lastName = PQgetvalue(res, 0, 3);
  u.dni = PQgetvalue(res, 0, 4);
  u.username = PQgetvalue(res, 0, 5);
  u.role = PQgetvalue(res, 0, 6);
  u.passwordHash = PQgetvalue(res, 0, 7);
  u.createdAt = PQgetvalue(res, 0, 9);
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res, 0, 10)) {
    u.avatarCartoonBase64 = PQgetvalue(res, 0, 10);
  }

  if (u.passwordHash != passwordHash) {
    appendAuthAuditLogPg(conn, "login_password", company, u.username, false,
                         "invalid_password");
    PQclear(res);
    PQfinish(conn);
    error = kAuthWrongPasswordMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "wrong_password";
    }
    return std::nullopt;
  }

  u.tenantId = resolveTelemetryTenantIdPg(static_cast<void *>(conn), u.id, u.company);
  appendAuthAuditLogPg(conn, "login_password", company, u.username, true, "ok");
  PQclear(res);
  PQfinish(conn);
  return u;
}

static double cosineSimilarity(const std::vector<double> &a,
                               const std::vector<double> &b) {
  if (a.empty() || a.size() != b.size()) {
    return -1.0;
  }
  double dot = 0.0;
  double normA = 0.0;
  double normB = 0.0;
  for (size_t i = 0; i < a.size(); ++i) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA == 0.0 || normB == 0.0) {
    return -1.0;
  }
  return dot / (std::sqrt(normA) * std::sqrt(normB));
}

std::optional<std::pair<AuthUser, double>>
loginFaceTargetedPg(const std::string &databaseUrl, const std::string &company,
                    const std::string &identityKey,
                    const std::vector<double> &clientProbeTemplate,
                    const std::optional<std::vector<unsigned char>> &rawImageBytes,
                    const std::optional<std::string> &base64ForLegacy,
                    double legacyThreshold, double embeddingThreshold,
                    std::string &error, std::string *probeProviderOut) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, ruc, phone, mobile, email, "
      "avatar_cartoon_base64, account_status, suspension_until::text "
      "FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    error = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    if (res) PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  const int rows = PQntuples(res);
  if (rows == 0) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "no_user_for_identity");
    PQclear(res);
    PQfinish(conn);
    error = kAuthUserNotFoundMsg;
    return std::nullopt;
  }
  if (rows > 1) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "ambiguous_identity");
    PQclear(res);
    PQfinish(conn);
    error = "El identificador coincide con más de un registro en esa empresa. "
            "Use un dato único (por ejemplo el DNI) e intente de nuevo.";
    return std::nullopt;
  }

  const std::string status = PQgetvalue(res, 0, 15);
  if (!status.empty() && status != "active") {
    if (status == "blocked") error = "Usuario bloqueado. Contacte a soporte.";
    else if (status == "deleted") error = "La cuenta ha sido eliminada.";
    else if (status == "suspended") {
        std::string until = PQgetisnull(res, 0, 16) ? "" : PQgetvalue(res, 0, 16);
        error = "Cuenta suspendida temporalmente" + (until.empty() ? "" : " hasta " + until) + ".";
    } else error = "Cuenta en estado: " + status;
    PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  AuthUser u;
  u.id = PQgetvalue(res, 0, 0);
  u.company = PQgetvalue(res, 0, 1);
  u.firstName = PQgetvalue(res, 0, 2);
  u.lastName = PQgetvalue(res, 0, 3);
  u.dni = PQgetvalue(res, 0, 4);
  u.username = PQgetvalue(res, 0, 5);
  u.role = PQgetvalue(res, 0, 6);
  u.passwordHash = PQgetvalue(res, 0, 7);
  u.createdAt = PQgetvalue(res, 0, 9);
  u.ruc = PQgetvalue(res, 0, 10);
  u.phone = PQgetvalue(res, 0, 11);
  u.mobile = PQgetvalue(res, 0, 12);
  u.email = PQgetvalue(res, 0, 13);
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res, 0, 14)) {
    u.avatarCartoonBase64 = PQgetvalue(res, 0, 14);
  }

  std::vector<double> tpl;
  try {
    auto parsed = json::parse(PQgetvalue(res, 0, 8));
    if (!parsed.is_array()) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "invalid_template");
      PQclear(res);
      PQfinish(conn);
      error = "El usuario indicado no tiene una plantilla facial válida "
              "registrada. Complete el registro biométrico e intente de nuevo.";
      return std::nullopt;
    }
    for (const auto &v : parsed.as_array()) {
      if (v.is_double()) {
        tpl.push_back(v.as_double());
      } else if (v.is_int64()) {
        tpl.push_back(static_cast<double>(v.as_int64()));
      }
    }
  } catch (...) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "template_parse_failed");
    PQclear(res);
    PQfinish(conn);
    error = "El usuario indicado no tiene una plantilla facial válida "
            "registrada. Complete el registro biométrico e intente de nuevo.";
    return std::nullopt;
  }

  if (tpl.size() < 100) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "template_too_short");
    PQclear(res);
    PQfinish(conn);
    error = "El usuario indicado no tiene biometría facial registrada de forma "
            "completa. Registre el rostro e intente de nuevo.";
    return std::nullopt;
  }

  std::vector<double> probe;
  std::string probeProvider;
  double useThreshold = legacyThreshold;
  if (!buildFaceLoginProbe(clientProbeTemplate, rawImageBytes, base64ForLegacy,
                             tpl, probe, probeProvider, useThreshold,
                             legacyThreshold, embeddingThreshold, error)) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "probe_build_failed");
    PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  const double bestScore = cosineSimilarity(probe, tpl);
  if (bestScore < useThreshold) {
    std::cout << "[AUTH_FACE] no_match_pg company=" << company
              << " user=" << u.username << " stored_dim=" << tpl.size()
              << " probe_dim=" << probe.size() << " score=" << bestScore
              << " threshold=" << useThreshold << " probe_provider=" << probeProvider
              << std::endl;
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "no_match score=" + std::to_string(bestScore));
    PQclear(res);
    PQfinish(conn);
    error = "La biometría facial no coincide con el usuario indicado. "
            "Verifique su identidad y vuelva a intentar.";
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_face", company, u.username, true,
                       "ok score=" + std::to_string(bestScore) + " probe=" +
                           probeProvider);
  if (probeProviderOut != nullptr) {
    *probeProviderOut = probeProvider;
  }
  u.tenantId = resolveTelemetryTenantIdPg(static_cast<void *>(conn), u.id, u.company);
  PQclear(res);
  PQfinish(conn);
  return std::make_pair(u, bestScore);
}

json::array listCompanyUsersPg(const std::string &databaseUrl, const std::string &company) {
  json::array users;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    PQfinish(conn);
    return users;
  }
  const std::string sql = "SELECT id, company_name, first_name, last_name, dni, username, role, ruc, phone, mobile, email, account_status, suspension_until::text FROM auth_users WHERE company_name = " + pqEscapeLiteral(conn, company) + " ORDER BY first_name, last_name";
  PGresult *res = PQexec(conn, sql.c_str());
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
    for (int i = 0; i < PQntuples(res); ++i) {
      users.push_back(json::object{
        {"id", PQgetvalue(res, i, 0)},
        {"company", PQgetvalue(res, i, 1)},
        {"firstName", PQgetvalue(res, i, 2)},
        {"lastName", PQgetvalue(res, i, 3)},
        {"dni", PQgetvalue(res, i, 4)},
        {"username", PQgetvalue(res, i, 5)},
        {"role", PQgetvalue(res, i, 6)},
        {"ruc", PQgetvalue(res, i, 7)},
        {"phone", PQgetvalue(res, i, 8)},
        {"mobile", PQgetvalue(res, i, 9)},
        {"email", PQgetvalue(res, i, 10)},
        {"account_status", PQgetvalue(res, i, 11)},
        {"suspension_until", PQgetisnull(res, i, 12) ? json::value(nullptr) : json::value(PQgetvalue(res, i, 12))}
      });
    }
  }
  if (res) PQclear(res);
  PQfinish(conn);
  return users;
}

json::array listUserMaintenanceAuditPg(const std::string &databaseUrl, const std::string &company, int page, int pageSize) {
  json::array logs;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    PQfinish(conn);
    return logs;
  }
  int offset = (page - 1) * pageSize;
  const std::string sql = "SELECT id, event_time::text, company_name, success, action, operator_username, target_username, security_method, detail, additional FROM auth_user_maintenance_audit WHERE company_name = " + pqEscapeLiteral(conn, company) + " ORDER BY event_time DESC LIMIT " + std::to_string(pageSize) + " OFFSET " + std::to_string(offset);
  PGresult *res = PQexec(conn, sql.c_str());
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
    for (int i = 0; i < PQntuples(res); ++i) {
      logs.push_back(json::object{
        {"id", PQgetvalue(res, i, 0)},
        {"timestamp", PQgetvalue(res, i, 1)},
        {"company", PQgetvalue(res, i, 2)},
        {"success", std::string(PQgetvalue(res, i, 3)) == "t"},
        {"action", PQgetvalue(res, i, 4)},
        {"operatorUsername", PQgetvalue(res, i, 5)},
        {"targetUsername", PQgetvalue(res, i, 6)},
        {"securityMethod", PQgetvalue(res, i, 7)},
        {"detail", PQgetvalue(res, i, 8)},
        {"additional", json::parse(PQgetvalue(res, i, 9))}
      });
    }
  }
  if (res) PQclear(res);
  PQfinish(conn);
  return logs;
}

bool executeUserMaintenancePg(const std::string &databaseUrl, const json::object &payload, json::object &outAudit, std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }

  try {
    const std::string company = json::value_to<std::string>(payload.at("company"));
    const std::string targetUsername = json::value_to<std::string>(payload.at("targetUsername"));
    const std::string action = json::value_to<std::string>(payload.at("action"));
    const auto &details = payload.at("details").as_object();
    const std::string securityMethod = payload.contains("securityMethod") ? json::value_to<std::string>(payload.at("securityMethod")) : "password";

    const auto &op = payload.at("operator").as_object();
    const std::string opUsername = json::value_to<std::string>(op.at("username"));

    std::cout << "[AUTH_MAINTENANCE] request: op=" << opUsername << " target=" << targetUsername << " company=" << company << " action=" << action << std::endl;

    std::string updateSql;
    std::string detail;
    bool success = false;

    if (action == "block") {
      updateSql = "UPDATE auth_users SET account_status = 'blocked' WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Usuario bloqueado. Motivo: " + (details.contains("reason") ? json::value_to<std::string>(details.at("reason")) : "N/A");
    } else if (action == "unblock") {
      updateSql = "UPDATE auth_users SET account_status = 'active', suspension_until = NULL WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Usuario desbloqueado / reactivado.";
    } else if (action == "suspend") {
      std::string until = details.contains("suspensionUntil") ? json::value_to<std::string>(details.at("suspensionUntil")) : "";
      updateSql = "UPDATE auth_users SET account_status = 'suspended', suspension_until = " + (until.empty() ? "NULL" : pqEscapeLiteral(conn, until)) + " WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Usuario suspendido hasta " + (until.empty() ? "indefinido" : until);
    } else if (action == "delete") {
      updateSql = "UPDATE auth_users SET account_status = 'deleted' WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Baja lógica de usuario.";
    } else if (action == "change_profile") {
      std::string role = json::value_to<std::string>(details.at("newRole"));
      updateSql = "UPDATE auth_users SET role = " + pqEscapeLiteral(conn, role) + " WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Cambio de perfil a: " + role;
    } else if (action == "edit_data") {
      std::string fName = json::value_to<std::string>(details.at("firstName"));
      std::string lName = json::value_to<std::string>(details.at("lastName"));
      std::string email = details.contains("email") ? json::value_to<std::string>(details.at("email")) : "";
      std::string phone = details.contains("phone") ? json::value_to<std::string>(details.at("phone")) : "";
      std::string mobile = details.contains("mobile") ? json::value_to<std::string>(details.at("mobile")) : "";
      updateSql = "UPDATE auth_users SET first_name = " + pqEscapeLiteral(conn, fName) +
                  ", last_name = " + pqEscapeLiteral(conn, lName) +
                  ", email = " + pqEscapeLiteral(conn, email) +
                  ", phone = " + pqEscapeLiteral(conn, phone) +
                  ", mobile = " + pqEscapeLiteral(conn, mobile) +
                  " WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Actualización de datos personales.";
    } else if (action == "reset_password") {
      std::string pass = json::value_to<std::string>(details.at("newPassword"));
      std::string hashed = http_utils::hashPassword(pass);
      updateSql = "UPDATE auth_users SET password_hash = " + pqEscapeLiteral(conn, hashed) + " WHERE username = " + pqEscapeLiteral(conn, targetUsername) + " AND company_name = " + pqEscapeLiteral(conn, company);
      detail = "Reseteo de contraseña.";
    }

    if (!updateSql.empty()) {
      PGresult *uRes = PQexec(conn, updateSql.c_str());
      if (uRes && PQresultStatus(uRes) == PGRES_COMMAND_OK && std::atoi(PQcmdTuples(uRes)) > 0) {
        success = true;
      } else if (!uRes) {
          error = PQerrorMessage(conn);
      } else {
          error = "No se encontro el usuario o no pertenece a la empresa.";
      }
      if (uRes) PQclear(uRes);
    }

    std::string auditSql = "INSERT INTO auth_user_maintenance_audit(company_name, success, action, operator_username, target_username, security_method, detail, additional) VALUES(" +
      pqEscapeLiteral(conn, company) + ", " + (success ? "true" : "false") + ", " + pqEscapeLiteral(conn, action) + ", " +
      pqEscapeLiteral(conn, opUsername) + ", " + pqEscapeLiteral(conn, targetUsername) + ", " + pqEscapeLiteral(conn, securityMethod) + ", " +
      pqEscapeLiteral(conn, detail) + ", " + pqEscapeLiteral(conn, json::serialize(details)) + ") RETURNING id, event_time::text";

    PGresult *aRes = PQexec(conn, auditSql.c_str());
    if (aRes && PQresultStatus(aRes) == PGRES_TUPLES_OK) {
      outAudit = json::object{
        {"id", PQgetvalue(aRes, 0, 0)},
        {"timestamp", PQgetvalue(aRes, 0, 1)},
        {"success", success},
        {"action", action},
        {"detail", detail}
      };
    }
    if (aRes) PQclear(aRes);
    PQfinish(conn);
    return success;
  } catch (const std::exception &ex) {
    error = ex.what();
    PQfinish(conn);
    return false;
  }
}

AuditPageResult readAuthAuditPg(const std::string &databaseUrl,
                                const AuditFilter &filter) {
  AuditPageResult out;
  out.limit = filter.limit;
  out.offset = filter.offset;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    PQfinish(conn);
    return out;
  }
  (void)ensureAuthSchemaPg(conn);

  std::ostringstream where;
  where << " WHERE 1=1";
  if (filter.company.has_value()) {
    where << " AND company_name=" << pqEscapeLiteral(conn, *filter.company);
  }
  if (filter.username.has_value()) {
    where << " AND username=" << pqEscapeLiteral(conn, *filter.username);
  }
  if (filter.action.has_value()) {
    where << " AND event_action=" << pqEscapeLiteral(conn, *filter.action);
  }
  if (filter.success.has_value()) {
    where << " AND success=" << (*filter.success ? "true" : "false");
  }

  const std::string countSql = "SELECT COUNT(*) FROM auth_audit_logs" + where.str();
  PGresult *countRes = PQexec(conn, countSql.c_str());
  if (!countRes || PQresultStatus(countRes) != PGRES_TUPLES_OK ||
      PQntuples(countRes) == 0) {
    if (countRes) PQclear(countRes);
    PQfinish(conn);
    return out;
  }
  out.total = static_cast<size_t>(std::stoull(PQgetvalue(countRes, 0, 0)));
  PQclear(countRes);

  std::ostringstream sql;
  sql << "SELECT event_time::text,event_action,company_name,username,success,detail "
      << "FROM auth_audit_logs" << where.str()
      << " ORDER BY event_time DESC LIMIT " << filter.limit
      << " OFFSET " << filter.offset;

  PGresult *res = PQexec(conn, sql.str().c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    if (res) PQclear(res);
    PQfinish(conn);
    return out;
  }

  const int rows = PQntuples(res);
  for (int i = 0; i < rows; ++i) {
    out.logs.push_back(json::object{{"event_time", PQgetvalue(res, i, 0)},
                                    {"event_action", PQgetvalue(res, i, 1)},
                                    {"company_name", PQgetvalue(res, i, 2)},
                                    {"username", PQgetvalue(res, i, 3)},
                                    {"success", std::string(PQgetvalue(res, i, 4)) == "t"},
                                    {"detail", PQgetvalue(res, i, 5)}});
  }

  PQclear(res);
  PQfinish(conn);
  return out;
}

} // namespace auth

#endif // HAS_LIBPQ
