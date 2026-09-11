#include "auth_storage_pg.hpp"
#include "auth_session.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <atomic>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "../biometric/face_analysis.hpp"
#include "../biometric/ai_engine_client.hpp"
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using biometric::buildFaceLoginProbe;
using biometric::verifyFaceDermalogCli;
using biometric::fetchDeepFaceSilentAnalysisFromAiEngine;

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
  storage::PgResult res{PQexec(conn, sql.c_str())};
  return res.ok();
}

/** GUC transaccional para triggers → platform_audit_log (mig. 20–21). */
bool pgExecAuditContextFromLogin(PGconn *conn, const std::string &username,
                                 const std::string &companyName,
                                 const std::string &sessionToken) {
  if (username.empty()) {
    return true;
  }
  // $3 nullable (nullptr = SQL NULL) para el token de sesión opcional.
  const char *params[3] = {username.c_str(), companyName.c_str(),
                           sessionToken.empty() ? nullptr : sessionToken.c_str()};
  storage::PgResult r{PQexecParams(
      conn, "SELECT fn_audit_context_from_login($1, $2, $3::text)", 3, nullptr,
      params, nullptr, nullptr, 0)};
  return r.ok();
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
-- Espejo obligatorio de db_scripts/50_companies_crud_rbac.sql (bloques A/B):
-- un despliegue limpio solo monta 01-29 via docker-entrypoint-initdb.d, así
-- que estas columnas/índices deben crearse también aquí o el CRUD de
-- empresas (ADR-085) arranca contra una auth_companies desactualizada.
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS company_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS ruc VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'PE';
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS domicilio_fiscal TEXT;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(tenant_id);
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS deactivated_by TEXT;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS demo_data BOOLEAN NOT NULL DEFAULT FALSE;
-- ADR-121 (db_scripts/68): coordenadas de la mina, nullable -- mismo espejo
-- obligatorio que el resto de columnas de auth_companies de esta sección.
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS location_zoom INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_company_id ON auth_companies (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_name_norm ON auth_companies (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_ruc ON auth_companies (ruc) WHERE ruc <> '';
-- Espejo obligatorio de db_scripts/72 (company_type/region en tenants +
-- org_tenant_access + permiso org.cross_tenant.manage): un despliegue limpio
-- solo monta 01-29, así que esto también debe crearse aquí -- mismo criterio
-- que el bloque de auth_companies de arriba (ADR-086/072).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_type TEXT NOT NULL DEFAULT 'mining_client';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_company_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_company_type_check
    CHECK (company_type IN ('mining_client', 'organization'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_region_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_region_check
    CHECK (region IS NULL OR region IN ('north_america', 'central_america', 'south_america'));
UPDATE tenants SET company_type = 'organization'
WHERE tenant_name IN ('Beemetry', 'TimeTelemetry') AND company_type <> 'organization';
CREATE TABLE IF NOT EXISTS org_tenant_access (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    granted_by UUID NOT NULL REFERENCES auth_users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth_users(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, tenant_id)
);
ALTER TABLE org_tenant_access DROP CONSTRAINT IF EXISTS org_tenant_access_role_check;
ALTER TABLE org_tenant_access ADD CONSTRAINT org_tenant_access_role_check
    CHECK (role IN ('admin', 'manager', 'supervisor', 'geologist', 'safety', 'operator', 'viewer'));
CREATE INDEX IF NOT EXISTS idx_org_tenant_access_user_active ON org_tenant_access (user_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_org_tenant_access_tenant_active ON org_tenant_access (tenant_id) WHERE active = TRUE;
INSERT INTO platform_permissions (code, module, description) VALUES
    ('org.cross_tenant.manage', 'organizacion', 'Otorgar/revocar acceso cruzado de personal de organización a empresas mineras clientes')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'admin', 'org.cross_tenant.manage' ON CONFLICT DO NOTHING;
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
-- db_scripts/81: MFA/TOTP (ver ese archivo para el razonamiento completo).
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;
-- db_scripts/91: foto real (no caricaturizada) tomada en el registro
-- biométrico, usada por el fotocheck (ver fotocheck_routes.cpp). Igual
-- criterio de sensibilidad que avatar_cartoon_base64, pero es la cara real
-- de la persona, no un avatar estilizado.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS id_photo_base64 TEXT;
-- db_scripts/92: link opaco por usuario para ver/descargar su fotocheck sin
-- sesión (se manda por email/WhatsApp) -- mismo patrón que
-- report_pdf_share_links (ADR-138), sin expiración porque es una credencial
-- personal, no una descarga puntual.
CREATE TABLE IF NOT EXISTS fotocheck_share_links (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fotocheck_share_links_user ON fotocheck_share_links(user_id);

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

-- ADR-029 (revisado): refresh tokens del esquema híbrido JWT. El token crudo
-- nunca se persiste, solo su hash SHA-256 (jwt::sha256Hex) — si la tabla se
-- filtra, no hay tokens utilizables. Identidad (username/company/role/tenant)
-- se duplica aquí para poder rotar/reautorizar sin una segunda consulta a
-- auth_users; no son datos sensibles.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    username VARCHAR(80) NOT NULL,
    company_name VARCHAR(180) NOT NULL,
    role VARCHAR(32) NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '',
    token_hash CHAR(64) NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    replaced_by CHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash ON auth_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user ON auth_refresh_tokens(user_id) WHERE revoked_at IS NULL;
)SQL";
  const bool ok = pgExecOk(conn, sql);
  if (ok) {
    for (const auto &company : config::kMiningCompanies) {
      const char *p[1] = {company.c_str()};
      storage::PgResult r{PQexecParams(
          conn,
          "INSERT INTO auth_companies(name, active) VALUES($1, true) "
          "ON CONFLICT (name) DO NOTHING",
          1, nullptr, p, nullptr, nullptr, 0)};
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
                          const std::string &detail,
                          std::optional<double> latitude,
                          std::optional<double> longitude,
                          std::optional<double> accuracyMeters,
                          const std::string &sourceIp) {
  // Formatear a std::string ANTES de armar el arreglo de params: PQexecParams
  // guarda punteros crudos, así que el buffer detrás de cada puntero debe
  // seguir vivo hasta la llamada -- si se formateara dentro del inicializador
  // del arreglo, el std::string temporal moriría antes de PQexecParams.
  const std::string latStr = latitude ? std::to_string(*latitude) : "";
  const std::string lonStr = longitude ? std::to_string(*longitude) : "";
  const std::string accStr = accuracyMeters ? std::to_string(*accuracyMeters) : "";
  const char *params[9] = {action.c_str(), company.c_str(), username.c_str(),
                           ok ? "true" : "false", detail.c_str(),
                           latitude ? latStr.c_str() : nullptr,
                           longitude ? lonStr.c_str() : nullptr,
                           accuracyMeters ? accStr.c_str() : nullptr,
                           sourceIp.empty() ? nullptr : sourceIp.c_str()};
  storage::PgResult r{PQexecParams(
      conn,
      "INSERT INTO auth_audit_logs(event_action, company_name, username, "
      "success, detail, latitude, longitude, accuracy_m, source_ip) "
      "VALUES($1, $2, $3, $4::boolean, $5, $6::double precision, "
      "$7::double precision, $8::double precision, $9)",
      9, nullptr, params, nullptr, nullptr, 0)};
}

bool validateCompanyPg(const std::string &databaseUrl, const std::string &companyName, const std::string &ruc, std::string &error) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  // $2 vacío ('') se ignora vía cortocircuito, evitando dos variantes de SQL.
  const char *params[2] = {companyName.c_str(), ruc.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT 1 FROM auth_users WHERE company_name = $1 "
      "AND ($2 = '' OR ruc = $2)",
      2, nullptr, params, nullptr, nullptr, 0)};
  bool exists = res.okTuples() && PQntuples(res.get()) > 0;
  return exists;
}

/**
 * Pre-chequeo de disponibilidad de DNI ANTES de pedir la captura facial
 * (hallazgo real 2026-09-04): sin esto, un DNI duplicado recién se detectaba
 * al final de todo el flujo de captura (5 lecturas ICAO + parpadeo natural +
 * desafío activo, ~1-2 minutos), un tiempo desperdiciado en algo que no
 * depende de nada biométrico. Misma query EXACTA que el chequeo real de
 * registerUserPg (dni UNIQUE global, sin importar la empresa -- un DNI
 * identifica una sola cuenta en toda la plataforma) para que este
 * pre-chequeo nunca diverja del resultado real del registro.
 */
bool checkDniExistsPg(const std::string &databaseUrl, const std::string &dni,
                      bool &outExists, std::string &error) {
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
  const char *params[1] = {dni.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT 1 FROM auth_users WHERE dni = $1 LIMIT 1", 1, nullptr,
      params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    error = "failed to validate dni";
    return false;
  }
  outExists = PQntuples(res.get()) > 0;
  return true;
}

/**
 * Pre-chequeo de disponibilidad de username ANTES de pedir la captura
 * facial (hallazgo real 2026-09-04, mismo motivo que checkDniExistsPg de
 * arriba): un registro completo -- 5 lecturas ICAO + parpadeo natural +
 * desafío activo, ~1-2 minutos -- terminaba rechazado recién al final con
 * "username already exists in this company", una restricción que tampoco
 * depende de nada biométrico. Misma query EXACTA que el chequeo real de
 * registerUserPg (username UNIQUE por empresa, a diferencia del DNI que es
 * global) para que este pre-chequeo nunca diverja del resultado real.
 */
bool checkUsernameExistsPg(const std::string &databaseUrl,
                           const std::string &company,
                           const std::string &username, bool &outExists,
                           std::string &error) {
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
  const char *params[2] = {company.c_str(), username.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT 1 FROM auth_users WHERE company_name = $1 AND username = $2 LIMIT 1",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    error = "failed to validate username";
    return false;
  }
  outExists = PQntuples(res.get()) > 0;
  return true;
}

bool setPendingTotpSecretPg(const std::string &databaseUrl, const std::string &userId,
                           const std::string &base32Secret, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const char *params[2] = {base32Secret.c_str(), userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_users SET totp_secret=$1, totp_enabled=false, totp_enrolled_at=NULL "
      "WHERE id=$2::uuid",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = PQresultErrorMessage(res.get());
    return false;
  }
  return std::string(PQcmdTuples(res.get())) != "0";
}

std::optional<std::pair<std::string, bool>> getTotpStatusPg(const std::string &databaseUrl,
                                                             const std::string &userId,
                                                             std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return std::nullopt;
  }
  const char *params[1] = {userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT totp_secret, totp_enabled FROM auth_users WHERE id=$1::uuid",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = res.okTuples() ? "user not found" : PQresultErrorMessage(res.get());
    return std::nullopt;
  }
  const std::string secret = PQgetisnull(res.get(), 0, 0) ? "" : PQgetvalue(res.get(), 0, 0);
  const bool enabled = !PQgetisnull(res.get(), 0, 1) &&
                        std::string(PQgetvalue(res.get(), 0, 1)) == "t";
  return std::make_pair(secret, enabled);
}

bool enableTotpPg(const std::string &databaseUrl, const std::string &userId, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const char *params[1] = {userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_users SET totp_enabled=true, totp_enrolled_at=NOW() "
      "WHERE id=$1::uuid AND totp_secret IS NOT NULL",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = PQresultErrorMessage(res.get());
    return false;
  }
  return std::string(PQcmdTuples(res.get())) != "0";
}

bool disableTotpPg(const std::string &databaseUrl, const std::string &userId, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return false;
  }
  const char *params[1] = {userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_users SET totp_secret=NULL, totp_enabled=false, totp_enrolled_at=NULL "
      "WHERE id=$1::uuid",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = PQresultErrorMessage(res.get());
    return false;
  }
  return std::string(PQcmdTuples(res.get())) != "0";
}

bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error, const std::string &sourceIp) {
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

  std::ostringstream tpl;
  tpl << '[';
  for (size_t i = 0; i < user.faceTemplate.size(); ++i) {
    if (i > 0) tpl << ',';
    tpl << user.faceTemplate[i];
  }
  tpl << ']';

  const char *dniParam[1] = {user.dni.c_str()};
  storage::PgResult checkRes{
      PQexecParams(conn, "SELECT 1 FROM auth_users WHERE dni = $1 LIMIT 1", 1,
                   nullptr, dniParam, nullptr, nullptr, 0)};
  if (!checkRes.okTuples()) {
    error = "failed to validate dni";
    return false;
  }
  if (PQntuples(checkRes.get()) > 0) {
    error = "dni already exists";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "dni_exists", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    return false;
  }

  // Corrección 2026-08-13: sin este chequeo, un choque en la constraint
  // UNIQUE(company_name, username) caía directo al INSERT y devolvía el
  // mensaje generico "failed to insert user" -- sin decir POR QUE fallo,
  // a diferencia de la ruta de archivos (loadAuthUsers/saveAuthUsers en
  // main.cpp) que ya distinguía "username already exists in this company"
  // desde antes. Reproducido en vivo 2026-08-13 registrando dos cuentas
  // con el mismo username en la misma empresa.
  const char *companyUserParams[2] = {user.company.c_str(),
                                      user.username.c_str()};
  storage::PgResult usernameCheckRes{PQexecParams(
      conn,
      "SELECT 1 FROM auth_users WHERE company_name = $1 AND username = $2 LIMIT 1",
      2, nullptr, companyUserParams, nullptr, nullptr, 0)};
  if (!usernameCheckRes.okTuples()) {
    error = "failed to validate username";
    return false;
  }
  if (PQntuples(usernameCheckRes.get()) > 0) {
    error = "username already exists in this company";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "username_exists", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    return false;
  }

  // INSERT parametrizado de 15 columnas: face_template castea a jsonb;
  // avatar nullable → nullptr = SQL NULL. tplStr vive hasta el exec.
  // face_template_provider (db_scripts/53) registra explícitamente qué
  // motor generó el template en ESTE registro -- login/face lo usa para
  // decidir cómo comparar (nunca se vuelve a inferir por tamaño).
  const std::string tplStr = tpl.str();
  const std::string providerStr =
      user.faceTemplateProvider.empty() ? "unknown" : user.faceTemplateProvider;
  const char *insParams[16] = {
      user.id.c_str(),
      user.company.c_str(),
      user.firstName.c_str(),
      user.lastName.c_str(),
      user.dni.c_str(),
      user.username.c_str(),
      user.role.c_str(),
      user.passwordHash.c_str(),
      tplStr.c_str(),
      user.ruc.c_str(),
      user.phone.c_str(),
      user.mobile.c_str(),
      user.email.c_str(),
      user.avatarCartoonBase64.empty() ? nullptr
                                       : user.avatarCartoonBase64.c_str(),
      providerStr.c_str(),
      user.idPhotoBase64.empty() ? nullptr : user.idPhotoBase64.c_str()};
  static const char *kInsertUserSql =
      "INSERT INTO auth_users(id,company_name,first_name,last_name,dni,"
      "username,role,password_hash,face_template,ruc,phone,mobile,email,"
      "avatar_cartoon_base64,face_template_provider,id_photo_base64) "
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)";
  storage::PgResult insRes{PQexecParams(conn, kInsertUserSql, 16, nullptr, insParams,
                                        nullptr, nullptr, 0)};
  const bool insOk = insRes.okCommand();
  if (!insOk) {
    error = "failed to insert user";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "insert_failed", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    return false;
  }

  appendAuthAuditLogPg(conn, "register", user.company, user.username, true,
                       "ok", std::nullopt, std::nullopt, std::nullopt, sourceIp);
  return true;
}

bool updateUserAvatarCartoonPg(const std::string &databaseUrl,
                               const std::string &userId,
                               const std::string &avatarBase64,
                               const std::string &actorUsername,
                               const std::string &actorCompany,
                               const std::string &sessionToken,
                               std::string &error) {
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
  const bool useAudit = !actorUsername.empty();
  if (useAudit) {
    if (!pgExecOk(conn, "BEGIN")) {
      error = PQerrorMessage(conn);
      return false;
    }
    if (!pgExecAuditContextFromLogin(conn, actorUsername, actorCompany, sessionToken)) {
      pgExecOk(conn, "ROLLBACK");
      error = "audit_context_failed";
      return false;
    }
  }
  const char *avatarParams[2] = {avatarBase64.c_str(), userId.c_str()};
  storage::PgResult avRes{PQexecParams(
      conn, "UPDATE auth_users SET avatar_cartoon_base64=$1 WHERE id=$2", 2,
      nullptr, avatarParams, nullptr, nullptr, 0)};
  const bool ok = avRes.okCommand();
  if (!ok) {
    error = PQerrorMessage(conn);
  }
  if (useAudit) {
    if (ok) {
      if (!pgExecOk(conn, "COMMIT")) {
        error = PQerrorMessage(conn);
        return false;
      }
    } else {
      pgExecOk(conn, "ROLLBACK");
    }
  }
  return ok;
}

/** Condición SQL: usuario, DNI o RUC literal; si identity es solo dígitos, también DNI = valor bigint (ceros a la izquierda). */
std::string pgSqlAuthIdentityMatch(const std::string &identityKey,
                                   int paramIndex) {
  const std::string p = "$" + std::to_string(paramIndex);
  std::string clause = "(username=" + p + " OR dni=" + p + " OR ruc=" + p;
  if (authIdentityKeyIsAllDigits(identityKey) && identityKey.size() <= 15) {
    clause +=
        " OR (dni ~ '^[0-9]+$' AND btrim(dni) <> '' AND "
        "btrim(dni)::bigint = " +
        p + "::bigint)";
  }
  clause += ")";
  return clause;
}

AuthLoginIdentityLookupResult authLookupIdentityForCompanyPg(
    const std::string &databaseUrl, const std::string &company,
    const std::string &identityKey) {
  AuthLoginIdentityLookupResult out;
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    out.diagnostic = PQerrorMessage(conn);
    return out;
  }
  (void)ensureAuthSchemaPg(conn);
  const std::string sql =
      "SELECT username FROM auth_users WHERE company_name=$1 AND " +
      pgSqlAuthIdentityMatch(identityKey, 2) + " LIMIT 4";
  const char *params[2] = {company.c_str(), identityKey.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    out.diagnostic = res ? PQresultErrorMessage(res.get()) : PQerrorMessage(conn);
    if (out.diagnostic.empty()) {
      out.diagnostic = "query failed";
    }
    return out;
  }
  const int rows = PQntuples(res.get());
  if (rows == 0) {
    out.kind = AuthLoginIdentityLookupResult::Kind::NotFound;
    return out;
  }
  if (rows > 1) {
    out.kind = AuthLoginIdentityLookupResult::Kind::Ambiguous;
    return out;
  }
  out.kind = AuthLoginIdentityLookupResult::Kind::Ok;
  out.resolvedUsername = PQgetvalue(res.get(), 0, 0);
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
    const char *p[1] = {companyName.c_str()};
    storage::PgResult r{PQexecParams(
        conn,
        "SELECT me.tenant_id::text FROM mineria_empresas me "
        "WHERE TRIM(me.nombre) = TRIM($1) AND me.tenant_id IS NOT NULL LIMIT 1",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (r.okTuples() && PQntuples(r.get()) > 0 &&
        !PQgetisnull(r.get(), 0, 0)) {
      const char *v = PQgetvalue(r.get(), 0, 0);
      if (v != nullptr && v[0] != '\0') {
        return std::string(v);
      }
    }
  }
  if (!userId.empty()) {
    const char *p[1] = {userId.c_str()};
    storage::PgResult r{PQexecParams(
        conn,
        "SELECT aut.tenant_id::text FROM auth_user_tenant aut "
        "WHERE aut.user_id = $1::uuid AND aut.is_default IS TRUE LIMIT 1",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (r.okTuples() && PQntuples(r.get()) > 0 &&
        !PQgetisnull(r.get(), 0, 0)) {
      const char *v = PQgetvalue(r.get(), 0, 0);
      if (v != nullptr && v[0] != '\0') {
        return std::string(v);
      }
    }
  }
  return fallback;
}

std::string findOrCreateTenantForCompanyPg(const std::string &databaseUrl,
                                           const std::string &companyName,
                                           const std::string &userId,
                                           const std::string &role,
                                           std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return "";
  }

  std::string tenantId;
  const char *nameP[1] = {companyName.c_str()};

  {
    storage::PgResult sel{PQexecParams(
        conn, "SELECT tenant_id::text FROM tenants WHERE tenant_name = $1",
        1, nullptr, nameP, nullptr, nullptr, 0)};
    if (sel.okTuples() && PQntuples(sel.get()) > 0) {
      tenantId = PQgetvalue(sel.get(), 0, 0);
    }
  }

  if (tenantId.empty()) {
    storage::PgResult ins{PQexecParams(
        conn,
        "INSERT INTO tenants (tenant_name) VALUES ($1) "
        "ON CONFLICT (tenant_name) DO NOTHING RETURNING tenant_id::text",
        1, nullptr, nameP, nullptr, nullptr, 0)};
    if (ins.okTuples() && PQntuples(ins.get()) > 0) {
      tenantId = PQgetvalue(ins.get(), 0, 0);
    } else {
      // ON CONFLICT DO NOTHING no devuelve fila si otra request concurrente
      // ya creó el mismo tenant primero -- releer.
      storage::PgResult sel2{PQexecParams(
          conn, "SELECT tenant_id::text FROM tenants WHERE tenant_name = $1",
          1, nullptr, nameP, nullptr, nullptr, 0)};
      if (sel2.okTuples() && PQntuples(sel2.get()) > 0) {
        tenantId = PQgetvalue(sel2.get(), 0, 0);
      }
    }
  }

  if (tenantId.empty()) {
    error = "no se pudo crear ni resolver el tenant para la empresa '" + companyName + "'";
    return "";
  }

  // ADR-121 (bug real, QA 2026-08-20): esta función resuelve/crea el tenant y
  // vincula al usuario, pero nunca enlazaba auth_companies.tenant_id -- el
  // catálogo administrativo (CompanyManagementView, GET /api/map/company-location)
  // quedaba con tenant_id NULL para TODA empresa que se diera de alta por
  // autoregistro (no por el CRUD de administración, que sí lo hace en
  // createCompanyPg). Efecto observable: Mapas nunca encontraba la ubicación
  // de la empresa recién registrada aunque el login resolviera el tenant
  // correcto -- confirmado en vivo con "Alpayana" y "El Brocal". Solo toca
  // filas con tenant_id IS NULL: nunca pisa un enlace ya correcto.
  {
    const char *backfillP[2] = {tenantId.c_str(), companyName.c_str()};
    storage::PgResult backfill{PQexecParams(
        conn,
        "UPDATE auth_companies SET tenant_id = $1::uuid "
        "WHERE lower(btrim(name)) = lower(btrim($2)) AND tenant_id IS NULL",
        2, nullptr, backfillP, nullptr, nullptr, 0)};
    (void)backfill;
  }

  const char *linkP[3] = {userId.c_str(), tenantId.c_str(), role.c_str()};
  storage::PgResult link{PQexecParams(
      conn,
      "INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role) "
      "VALUES ($1::uuid, $2::uuid, true, $3) ON CONFLICT (user_id, tenant_id) DO NOTHING",
      3, nullptr, linkP, nullptr, nullptr, 0)};
  if (!link.okCommand()) {
    error = "tenant resuelto pero fallo el vinculo auth_user_tenant";
  }

  return tenantId;
}

std::optional<AuthUser> findUserByIdPg(const std::string &databaseUrl,
                                       const std::string &userId) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return std::nullopt;
  (void)ensureAuthSchemaPg(conn);

  const char *params[1] = {userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "avatar_cartoon_base64, account_status, email, mobile, phone, id_photo_base64 "
      "FROM auth_users WHERE id = $1::uuid LIMIT 1",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) != 1) return std::nullopt;

  const std::string status = PQgetvalue(res.get(), 0, 8);
  if (status != "active" && !status.empty()) return std::nullopt;

  AuthUser u;
  u.id = PQgetvalue(res.get(), 0, 0);
  u.company = PQgetvalue(res.get(), 0, 1);
  u.firstName = PQgetvalue(res.get(), 0, 2);
  u.lastName = PQgetvalue(res.get(), 0, 3);
  u.dni = PQgetvalue(res.get(), 0, 4);
  u.username = PQgetvalue(res.get(), 0, 5);
  u.role = PQgetvalue(res.get(), 0, 6);
  if (!PQgetisnull(res.get(), 0, 7)) u.avatarCartoonBase64 = PQgetvalue(res.get(), 0, 7);
  if (!PQgetisnull(res.get(), 0, 9)) u.email = PQgetvalue(res.get(), 0, 9);
  if (!PQgetisnull(res.get(), 0, 10)) u.mobile = PQgetvalue(res.get(), 0, 10);
  if (!PQgetisnull(res.get(), 0, 11)) u.phone = PQgetvalue(res.get(), 0, 11);
  if (!PQgetisnull(res.get(), 0, 12)) u.idPhotoBase64 = PQgetvalue(res.get(), 0, 12);
  return u;
}

std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &identityKey,
                                        const std::string &password,
                                        std::string &error,
                                        std::string *errorCodeOut,
                                        const std::string &auditDetailSuffix,
                                        std::optional<double> latitude,
                                        std::optional<double> longitude,
                                        std::optional<double> accuracyMeters,
                                        const std::string &sourceIp) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, avatar_cartoon_base64, account_status, suspension_until::text, "
      "totp_secret, totp_enabled "
      "FROM auth_users WHERE company_name=$1 AND " +
      pgSqlAuthIdentityMatch(identityKey, 2) + " LIMIT 4";
  const char *params[2] = {company.c_str(), identityKey.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    error = res ? PQresultErrorMessage(res.get()) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    return std::nullopt;
  }

  const int rowCount = PQntuples(res.get());
  if (rowCount == 0) {
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "user_not_found", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = kAuthUserNotFoundMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "user_not_found";
    }
    return std::nullopt;
  }
  if (rowCount > 1) {
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "ambiguous_identity", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = kAuthAmbiguousIdentityMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "ambiguous_identity";
    }
    return std::nullopt;
  }

  const std::string status = PQgetvalue(res.get(), 0, 11);
  if (status != "active" && !status.empty()) {
    if (status == "blocked") error = "Usuario bloqueado. Contacte a soporte.";
    else if (status == "deleted") error = "La cuenta ha sido eliminada.";
    else if (status == "suspended") {
        std::string until = PQgetisnull(res.get(), 0, 12) ? "" : PQgetvalue(res.get(), 0, 12);
        error = "Cuenta suspendida temporalmente" + (until.empty() ? "" : " hasta " + until) + ".";
    } else error = "Cuenta en estado: " + status;
    return std::nullopt;
  }

  AuthUser u;
  u.id = PQgetvalue(res.get(), 0, 0);
  u.company = PQgetvalue(res.get(), 0, 1);
  u.firstName = PQgetvalue(res.get(), 0, 2);
  u.lastName = PQgetvalue(res.get(), 0, 3);
  u.dni = PQgetvalue(res.get(), 0, 4);
  u.username = PQgetvalue(res.get(), 0, 5);
  u.role = PQgetvalue(res.get(), 0, 6);
  u.passwordHash = PQgetvalue(res.get(), 0, 7);
  u.createdAt = PQgetvalue(res.get(), 0, 9);
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res.get(), 0, 10)) {
    u.avatarCartoonBase64 = PQgetvalue(res.get(), 0, 10);
  }
  if (!PQgetisnull(res.get(), 0, 13)) {
    u.totpSecret = PQgetvalue(res.get(), 0, 13);
  }
  u.totpEnabled = !PQgetisnull(res.get(), 0, 14) &&
                  std::string(PQgetvalue(res.get(), 0, 14)) == "t";

  if (!http_utils::verifyPassword(password, u.passwordHash)) {
    appendAuthAuditLogPg(conn, "login_password", company, u.username, false,
                         "invalid_password", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = kAuthWrongPasswordMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "wrong_password";
    }
    return std::nullopt;
  }

  if (http_utils::passwordNeedsRehash(u.passwordHash)) {
    try {
      const std::string upgradedHash = http_utils::hashPassword(password);
      const char *upgradeParams[3] = {
          upgradedHash.c_str(), u.id.c_str(), u.passwordHash.c_str()};
      storage::PgResult upgraded{PQexecParams(
          conn,
          "UPDATE auth_users SET password_hash=$1 "
          "WHERE id=$2::uuid AND password_hash=$3",
          3, nullptr, upgradeParams, nullptr, nullptr, 0)};
      if (upgraded.okCommand() && PQcmdTuples(upgraded.get()) != nullptr &&
          std::string(PQcmdTuples(upgraded.get())) == "1") {
        u.passwordHash = upgradedHash;
      } else {
        std::cerr << "[AUTH_PASSWORD] rehash Argon2id no persistido para user_id="
                  << u.id << std::endl;
      }
    } catch (const std::exception &ex) {
      // No bloquear un login legacy válido por una falla de migración; queda
      // visible y se reintentará en el próximo acceso.
      std::cerr << "[AUTH_PASSWORD] rehash Argon2id falló para user_id="
                << u.id << ": " << ex.what() << std::endl;
    }
  }

  u.tenantId = resolveTelemetryTenantIdPg(static_cast<void *>(conn), u.id, u.company);
  appendAuthAuditLogPg(conn, "login_password", company, u.username, true,
                       "ok" + auditDetailSuffix, latitude, longitude, accuracyMeters, sourceIp);
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
                    std::string &error, std::string *probeProviderOut,
                    const std::string &auditDetailSuffix,
                    std::optional<double> latitude,
                    std::optional<double> longitude,
                    std::optional<double> accuracyMeters,
                    const std::string &sourceIp) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, ruc, phone, mobile, email, "
      "avatar_cartoon_base64, account_status, suspension_until::text, face_template_provider, "
      "totp_secret, totp_enabled "
      "FROM auth_users WHERE company_name=$1 AND " +
      pgSqlAuthIdentityMatch(identityKey, 2) + " LIMIT 4";
  const char *params[2] = {company.c_str(), identityKey.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    error = res ? PQresultErrorMessage(res.get()) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    return std::nullopt;
  }

  const int rows = PQntuples(res.get());
  if (rows == 0) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "no_user_for_identity", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = kAuthUserNotFoundMsg;
    return std::nullopt;
  }
  if (rows > 1) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "ambiguous_identity", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = "El identificador coincide con más de un registro en esa empresa. "
            "Use un dato único (por ejemplo el DNI) e intente de nuevo.";
    return std::nullopt;
  }

  const std::string status = PQgetvalue(res.get(), 0, 15);
  if (!status.empty() && status != "active") {
    if (status == "blocked") error = "Usuario bloqueado. Contacte a soporte.";
    else if (status == "deleted") error = "La cuenta ha sido eliminada.";
    else if (status == "suspended") {
        std::string until = PQgetisnull(res.get(), 0, 16) ? "" : PQgetvalue(res.get(), 0, 16);
        error = "Cuenta suspendida temporalmente" + (until.empty() ? "" : " hasta " + until) + ".";
    } else error = "Cuenta en estado: " + status;
    return std::nullopt;
  }

  AuthUser u;
  u.id = PQgetvalue(res.get(), 0, 0);
  u.company = PQgetvalue(res.get(), 0, 1);
  u.firstName = PQgetvalue(res.get(), 0, 2);
  u.lastName = PQgetvalue(res.get(), 0, 3);
  u.dni = PQgetvalue(res.get(), 0, 4);
  u.username = PQgetvalue(res.get(), 0, 5);
  u.role = PQgetvalue(res.get(), 0, 6);
  u.passwordHash = PQgetvalue(res.get(), 0, 7);
  u.createdAt = PQgetvalue(res.get(), 0, 9);
  u.ruc = PQgetvalue(res.get(), 0, 10);
  u.phone = PQgetvalue(res.get(), 0, 11);
  u.mobile = PQgetvalue(res.get(), 0, 12);
  u.email = PQgetvalue(res.get(), 0, 13);
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res.get(), 0, 14)) {
    u.avatarCartoonBase64 = PQgetvalue(res.get(), 0, 14);
  }
  u.faceTemplateProvider = PQgetisnull(res.get(), 0, 17)
                               ? "unknown"
                               : PQgetvalue(res.get(), 0, 17);
  if (!PQgetisnull(res.get(), 0, 18)) {
    u.totpSecret = PQgetvalue(res.get(), 0, 18);
  }
  u.totpEnabled = !PQgetisnull(res.get(), 0, 19) &&
                  std::string(PQgetvalue(res.get(), 0, 19)) == "t";

  std::vector<double> tpl;
  try {
    auto parsed = json::parse(PQgetvalue(res.get(), 0, 8));
    if (!parsed.is_array()) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "invalid_template", std::nullopt, std::nullopt, std::nullopt, sourceIp);
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
                         "template_parse_failed", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = "El usuario indicado no tiene una plantilla facial válida "
            "registrada. Complete el registro biométrico e intente de nuevo.";
    return std::nullopt;
  }

  if (tpl.size() < 100) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "template_too_short", std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = "El usuario indicado no tiene biometría facial registrada de forma "
            "completa. Registre el rostro e intente de nuevo.";
    return std::nullopt;
  }

  // Hallazgo de seguridad 2026-08-10: antes de esto, CUALQUIER
  // face_template guardado se comparaba con similitud coseno genérica sin
  // mirar qué motor lo generó. Con la miniatura 24x24 del fallback legacy
  // (no es un embedding biométrico real, ver extractLegacyTemplateFromMat)
  // eso daba falsos positivos sistemáticos entre personas distintas
  // (medido en producción: 0.86-0.98 de "similitud" entre cuentas
  // diferentes, muy por encima del umbral 0.80-0.82). Ahora el despacho
  // depende de qué motor generó el template guardado (db_scripts/53), no
  // de su tamaño ni de lo que mande el cliente.
  double bestScore = 0.0;
  std::string probeProvider;
  if (u.faceTemplateProvider == "insightface_onnx") {
    double useThreshold = legacyThreshold;
    std::vector<double> probe;
    if (!buildFaceLoginProbe(clientProbeTemplate, rawImageBytes, base64ForLegacy,
                               tpl, probe, probeProvider, useThreshold,
                               legacyThreshold, embeddingThreshold, error)) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "probe_build_failed", std::nullopt, std::nullopt, std::nullopt, sourceIp);
      return std::nullopt;
    }
    bestScore = cosineSimilarity(probe, tpl);
    if (bestScore < useThreshold) {
      std::cout << "[AUTH_FACE] no_match_pg company=" << company
                << " user=" << u.username << " provider=insightface_onnx"
                << " score=" << bestScore << " threshold=" << useThreshold
                << std::endl;
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "no_match score=" + std::to_string(bestScore),
                           std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "La biometría facial no coincide con el usuario indicado. "
              "Verifique su identidad y vuelva a intentar.";
      return std::nullopt;
    }
  } else if (u.faceTemplateProvider == "deepface_silentface") {
    // Proveedor biométrico local por defecto (DeepFace/Facenet512 +
    // Silent-Face-Anti-Spoofing). Igual que dermalog_cli, exige imagen real
    // de cámara -- nunca un face_template mandado por el cliente, porque el
    // liveness (MiniFASNet) debe reevaluarse en cada login, no solo en el
    // registro. Ver hallazgo de seguridad 2026-08-10 (arriba) y la ausencia
    // de rama para seetaface6_local que este proveedor reemplaza.
    if (!rawImageBytes.has_value() || rawImageBytes->empty()) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "deepface_silentface_requires_image", std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "Esta cuenta requiere una imagen de cámara real para la "
              "verificación facial.";
      return std::nullopt;
    }
    probeProvider = "deepface_silentface";
    auto probeFace = fetchDeepFaceSilentAnalysisFromAiEngine(*rawImageBytes, "verify");
    if (!probeFace.ok || probeFace.faceTemplate.size() != tpl.size()) {
      std::cout << "[AUTH_FACE] deepface_silentface_verify_failed company=" << company
                << " user=" << u.username
                << " issue=" << (probeFace.issues.empty() ? "unknown" : probeFace.issues.front())
                << std::endl;
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "deepface_silentface_verify_failed: " +
                               (probeFace.issues.empty() ? "unknown" : probeFace.issues.front()),
                           std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "No se pudo validar el rostro. Intente de nuevo con mejor "
              "iluminación y encuadre.";
      return std::nullopt;
    }
    bestScore = cosineSimilarity(probeFace.faceTemplate, tpl);
    const double useThreshold = config::AppConfig::instance().gFaceDeepfaceCosineThreshold;
    if (bestScore < useThreshold) {
      std::cout << "[AUTH_FACE] no_match_pg company=" << company
                << " user=" << u.username << " provider=deepface_silentface"
                << " score=" << bestScore << " threshold=" << useThreshold
                << std::endl;
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "no_match score=" + std::to_string(bestScore),
                           std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "La biometría facial no coincide con el usuario indicado. "
              "Verifique su identidad y vuelva a intentar.";
      return std::nullopt;
    }
  } else if (u.faceTemplateProvider == "dermalog_cli") {
    // El comparador nativo de Dermalog exige una imagen real de la cámara
    // -- nunca un face_template mandado directo por el cliente (ese es
    // justo el otro hallazgo de seguridad: un arreglo arbitrario sin
    // ningún análisis facial real detrás).
    if (!rawImageBytes.has_value() || rawImageBytes->empty()) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "dermalog_requires_image", std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "Esta cuenta requiere una imagen de cámara real para la "
              "verificación facial.";
      return std::nullopt;
    }
    probeProvider = "dermalog_cli";
    std::string dermalogError;
    if (!verifyFaceDermalogCli(*rawImageBytes, tpl, bestScore, dermalogError)) {
      std::cout << "[AUTH_FACE] dermalog_verify_failed company=" << company
                << " user=" << u.username << " reason=" << dermalogError
                << std::endl;
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "dermalog_verify_failed: " + dermalogError,
                           std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = dermalogError == "no_license"
                  ? "La verificación biométrica de alta seguridad no está "
                    "disponible temporalmente (licencia pendiente). "
                    "Contacte a soporte."
                  : "No se pudo validar el rostro. Intente de nuevo con "
                    "mejor iluminación y encuadre.";
      return std::nullopt;
    }
    // Escala Dermalog: 0-100 (ver manual del SDK, umbral recomendado 75
    // para FMR 1/1000) -- gFaceEmbeddingCosineThreshold/gFaceLegacyCosineThreshold
    // son escalas 0-1 de otros motores, no aplican aquí.
    constexpr double kDermalogThreshold = 75.0;
    if (bestScore < kDermalogThreshold) {
      std::cout << "[AUTH_FACE] no_match_pg company=" << company
                << " user=" << u.username << " provider=dermalog_cli"
                << " score=" << bestScore << " threshold=" << kDermalogThreshold
                << std::endl;
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "no_match score=" + std::to_string(bestScore),
                           std::nullopt, std::nullopt, std::nullopt, sourceIp);
      error = "La biometría facial no coincide con el usuario indicado. "
              "Verifique su identidad y vuelva a intentar.";
      return std::nullopt;
    }
  } else {
    // legacy / unknown_client_supplied / none / cualquier valor no
    // reconocido: se rechaza explícitamente en vez de caer a una
    // comparación que no discrimina identidad de verdad. La cuenta debe
    // reinscribir su biometría con un motor fuerte (InsightFace o
    // Dermalog) -- login por contraseña sigue disponible mientras tanto.
    std::cout << "[AUTH_FACE] rejected_weak_provider company=" << company
              << " user=" << u.username
              << " provider=" << u.faceTemplateProvider << std::endl;
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "rejected_weak_provider:" + u.faceTemplateProvider,
                         std::nullopt, std::nullopt, std::nullopt, sourceIp);
    error = "Esta cuenta tiene una biometría facial registrada con un método "
            "que ya no se considera seguro. Vuelva a registrar su rostro "
            "para reactivar el login facial, o use su contraseña mientras "
            "tanto.";
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_face", company, u.username, true,
                       "ok score=" + std::to_string(bestScore) + " probe=" +
                           probeProvider + auditDetailSuffix,
                       latitude, longitude, accuracyMeters, sourceIp);
  if (probeProviderOut != nullptr) {
    *probeProviderOut = probeProvider;
  }
  u.tenantId = resolveTelemetryTenantIdPg(static_cast<void *>(conn), u.id, u.company);
  return std::make_pair(u, bestScore);
}

json::array listCompanyUsersPg(const std::string &databaseUrl, const std::string &company) {
  json::array users;
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return users;
  }
  const char *params[1] = {company.c_str()};
  // avatar_cartoon_base64 (db_scripts/13_auth_avatar_cartoon_reset_users.sql):
  // agregado para que ShareReportModal.tsx pueda mostrar el avatar real del
  // destinatario en vez de leer una lista mock de localStorage con solo
  // iniciales como "avatar".
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "ruc, phone, mobile, email, account_status, suspension_until::text, "
      "avatar_cartoon_base64 "
      "FROM auth_users WHERE company_name = $1 "
      "ORDER BY first_name, last_name",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      users.push_back(json::object{
        {"id", PQgetvalue(res.get(), i, 0)},
        {"company", PQgetvalue(res.get(), i, 1)},
        {"firstName", PQgetvalue(res.get(), i, 2)},
        {"lastName", PQgetvalue(res.get(), i, 3)},
        {"dni", PQgetvalue(res.get(), i, 4)},
        {"username", PQgetvalue(res.get(), i, 5)},
        {"role", PQgetvalue(res.get(), i, 6)},
        {"ruc", PQgetvalue(res.get(), i, 7)},
        {"phone", PQgetvalue(res.get(), i, 8)},
        {"mobile", PQgetvalue(res.get(), i, 9)},
        {"email", PQgetvalue(res.get(), i, 10)},
        {"account_status", PQgetvalue(res.get(), i, 11)},
        {"suspension_until", PQgetisnull(res.get(), i, 12) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 12))},
        {"avatar_base64", PQgetisnull(res.get(), i, 13) ? json::value("") : json::value(PQgetvalue(res.get(), i, 13))}
      });
    }
  }
  return users;
}

json::array listUserMaintenanceAuditPg(const std::string &databaseUrl, const std::string &company, int page, int pageSize) {
  json::array logs;
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return logs;
  }
  int offset = (page - 1) * pageSize;
  const std::string pageSizeStr = std::to_string(pageSize);
  const std::string offsetStr = std::to_string(offset);
  const char *pageParams[3] = {company.c_str(), pageSizeStr.c_str(),
                               offsetStr.c_str()};
  static const char *kSelectMaintAuditSql =
      "SELECT id, event_time::text, company_name, success, action, "
      "operator_username, target_username, security_method, detail, additional "
      "FROM auth_user_maintenance_audit WHERE company_name = $1 "
      "ORDER BY event_time DESC LIMIT $2::bigint OFFSET $3::bigint";
  storage::PgResult res{PQexecParams(conn, kSelectMaintAuditSql, 3, nullptr,
                                     pageParams, nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      logs.push_back(json::object{
        {"id", PQgetvalue(res.get(), i, 0)},
        {"timestamp", PQgetvalue(res.get(), i, 1)},
        {"company", PQgetvalue(res.get(), i, 2)},
        {"success", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
        {"action", PQgetvalue(res.get(), i, 4)},
        {"operatorUsername", PQgetvalue(res.get(), i, 5)},
        {"targetUsername", PQgetvalue(res.get(), i, 6)},
        {"securityMethod", PQgetvalue(res.get(), i, 7)},
        {"detail", PQgetvalue(res.get(), i, 8)},
        {"additional", json::parse(PQgetvalue(res.get(), i, 9))}
      });
    }
  }
  return logs;
}

bool executeUserMaintenancePg(const std::string &databaseUrl, const json::object &payload, json::object &outAudit, std::string &error) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
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

    // Cada acción define SQL con placeholders y sus valores en orden $1..$N.
    // Los valores viven en `updateParams` (std::string) hasta el exec.
    std::string updateSql;
    std::vector<std::string> updateParams;
    std::string detail;
    bool success = false;

    if (action == "block") {
      updateSql = "UPDATE auth_users SET account_status = 'blocked' "
                  "WHERE username = $1 AND company_name = $2";
      updateParams = {targetUsername, company};
      detail = "Usuario bloqueado. Motivo: " + (details.contains("reason") ? json::value_to<std::string>(details.at("reason")) : "N/A");
    } else if (action == "unblock") {
      updateSql = "UPDATE auth_users SET account_status = 'active', "
                  "suspension_until = NULL "
                  "WHERE username = $1 AND company_name = $2";
      updateParams = {targetUsername, company};
      detail = "Usuario desbloqueado / reactivado.";
    } else if (action == "suspend") {
      std::string until = details.contains("suspensionUntil") ? json::value_to<std::string>(details.at("suspensionUntil")) : "";
      // NULLIF($1,'') → cadena vacía se vuelve NULL (suspensión indefinida).
      updateSql = "UPDATE auth_users SET account_status = 'suspended', "
                  "suspension_until = NULLIF($1, '')::timestamptz "
                  "WHERE username = $2 AND company_name = $3";
      updateParams = {until, targetUsername, company};
      detail = "Usuario suspendido hasta " + (until.empty() ? "indefinido" : until);
    } else if (action == "delete") {
      // Corrección 2026-09-04 (hallazgo real, pedido explícito del usuario:
      // "asegúrate que se esté borrando... el avatar... y las capturas de
      // cámara"): la baja lógica solo marcaba account_status='deleted' --
      // avatar_cartoon_base64 quedaba en la fila para siempre (visible a
      // quien tenga acceso a la tabla, y servible vía GET
      // /api/auth/avatar/hd mientras el master 2880x3840 siguiera en disco,
      // ver limpieza de archivo más abajo). "Eliminar usuario" debe borrar
      // también el derivado biométrico, no solo desactivar la cuenta -- son
      // dos cosas distintas (retener el registro administrativo/de
      // auditoría de que existió, vs. seguir guardando su rostro
      // estilizado). RETURNING id para poder borrar el master HD del
      // filesystem, que vive fuera de la fila (auth/avatars_hd/{id}.png).
      // face_template (jsonb) es el embedding real que usa el login facial
      // -- más sensible todavía que el avatar caricaturizado, y tampoco se
      // limpiaba. auth_face_templates (historial versionado por captura) se
      // revisó aparte: existe la tabla con ON DELETE CASCADE pero está
      // vacía en este entorno (no hay código que le escriba todavía), así
      // que no hace falta tocarla acá -- si en el futuro se empieza a
      // poblar, un DELETE explícito por user_id debería agregarse acá
      // también en vez de confiar en la cascada (la baja sigue siendo
      // lógica, nunca hace DELETE de la fila en auth_users).
      updateSql = "UPDATE auth_users SET account_status = 'deleted', "
                  "avatar_cartoon_base64 = NULL, "
                  "face_template = '[]'::jsonb "
                  "WHERE username = $1 AND company_name = $2 "
                  "RETURNING id";
      updateParams = {targetUsername, company};
      detail = "Baja lógica de usuario (incluye borrado del avatar y la plantilla biométrica).";
    } else if (action == "change_profile") {
      std::string role = json::value_to<std::string>(details.at("newRole"));
      updateSql = "UPDATE auth_users SET role = $1 "
                  "WHERE username = $2 AND company_name = $3";
      updateParams = {role, targetUsername, company};
      detail = "Cambio de perfil a: " + role;
    } else if (action == "edit_data") {
      std::string fName = json::value_to<std::string>(details.at("firstName"));
      std::string lName = json::value_to<std::string>(details.at("lastName"));
      std::string email = details.contains("email") ? json::value_to<std::string>(details.at("email")) : "";
      std::string phone = details.contains("phone") ? json::value_to<std::string>(details.at("phone")) : "";
      std::string mobile = details.contains("mobile") ? json::value_to<std::string>(details.at("mobile")) : "";
      // dni es opcional en el payload (a diferencia de email/phone/mobile):
      // un cliente que no lo envíe no debe borrar el DNI existente. $8 vacío
      // -> COALESCE/NULLIF deja el valor actual intacto (mismo criterio que
      // suspension_until arriba con NULLIF). Habilita el "Escanear DNI" de
      // esta misma acción sin afectar clientes viejos que no mandan `dni`.
      std::string dni = details.contains("dni") ? json::value_to<std::string>(details.at("dni")) : "";
      updateSql = "UPDATE auth_users SET first_name = $1, last_name = $2, "
                  "email = $3, phone = $4, mobile = $5, "
                  "dni = COALESCE(NULLIF($8, ''), dni) "
                  "WHERE username = $6 AND company_name = $7";
      updateParams = {fName, lName, email, phone, mobile, targetUsername, company, dni};
      detail = "Actualización de datos personales.";
    } else if (action == "reset_password") {
      std::string pass = json::value_to<std::string>(details.at("newPassword"));
      std::string hashed = http_utils::hashPassword(pass);
      updateSql = "UPDATE auth_users SET password_hash = $1 "
                  "WHERE username = $2 AND company_name = $3";
      updateParams = {hashed, targetUsername, company};
      detail = "Reseteo de contraseña.";
    }

    if (!updateSql.empty()) {
      std::vector<const char *> pv;
      pv.reserve(updateParams.size());
      for (const auto &p : updateParams) pv.push_back(p.c_str());
      storage::PgResult uRes{
          PQexecParams(conn, updateSql.c_str(), static_cast<int>(pv.size()),
                       nullptr, pv.data(), nullptr, nullptr, 0)};
      // "delete" agrega RETURNING id (ver arriba) -- Postgres responde
      // PGRES_TUPLES_OK para eso, no PGRES_COMMAND_OK, así que el chequeo de
      // éxito para esa acción puntual mira okTuples()+ntuples en vez de
      // PQcmdTuples (que da vacío/0 cuando hay RETURNING).
      const bool deletedRow =
          action == "delete" && uRes.okTuples() && PQntuples(uRes.get()) > 0;
      if (deletedRow || (uRes.okCommand() && std::atoi(PQcmdTuples(uRes.get())) > 0)) {
        success = true;
        if (deletedRow) {
          // Master HD 2880x3840 vive en el filesystem, fuera de la fila
          // (auth/avatars_hd/{id}.png, ver handleMyAvatarHd) -- borrar solo
          // avatar_cartoon_base64 en la UPDATE de arriba no alcanza, o el
          // archivo viejo sigue ahí (y seguiría sirviéndose si alguna vez se
          // reutiliza el mismo id, aunque hoy los id son UUID nuevos por
          // registro). Best-effort: un error acá no debe revertir la baja
          // lógica ya confirmada en la fila.
          try {
            const std::string deletedId = PQgetvalue(uRes.get(), 0, 0);
            const std::string dataRoot =
                config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
            const std::filesystem::path hdPath =
                std::filesystem::path(dataRoot) / "auth" / "avatars_hd" /
                (deletedId + ".png");
            std::error_code ec;
            std::filesystem::remove(hdPath, ec);
          } catch (...) {
            // best-effort, ver comentario arriba
          }
        }
      } else if (!uRes) {
          error = PQerrorMessage(conn);
      } else {
          error = "No se encontro el usuario o no pertenece a la empresa.";
      }
    }

    const std::string detailsJson = json::serialize(details);
    const char *auditParams[8] = {company.c_str(),
                                  success ? "true" : "false",
                                  action.c_str(),
                                  opUsername.c_str(),
                                  targetUsername.c_str(),
                                  securityMethod.c_str(),
                                  detail.c_str(),
                                  detailsJson.c_str()};
    static const char *kInsertMaintAuditSql =
        "INSERT INTO auth_user_maintenance_audit(company_name, success, "
        "action, operator_username, target_username, security_method, "
        "detail, additional) "
        "VALUES($1, $2::boolean, $3, $4, $5, $6, $7, $8::jsonb) "
        "RETURNING id, event_time::text";
    storage::PgResult aRes{PQexecParams(conn, kInsertMaintAuditSql, 8, nullptr,
                                        auditParams, nullptr, nullptr, 0)};
    if (aRes.okTuples()) {
      outAudit = json::object{
        {"id", PQgetvalue(aRes.get(), 0, 0)},
        {"timestamp", PQgetvalue(aRes.get(), 0, 1)},
        {"success", success},
        {"action", action},
        {"detail", detail}
      };
    }
    return success;
  } catch (const std::exception &ex) {
    error = ex.what();
    return false;
  }
}

AuditPageResult readAuthAuditPg(const std::string &databaseUrl,
                                const AuditFilter &filter) {
  AuditPageResult out;
  out.limit = filter.limit;
  out.offset = filter.offset;
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return out;
  }
  (void)ensureAuthSchemaPg(conn);

  // WHERE dinámico PARAMETRIZADO: cada filtro presente añade "col=$N" y su
  // valor a `params`; el mismo WHERE se reutiliza en count y en data.
  std::ostringstream where;
  where << " WHERE 1=1";
  std::vector<std::string> params;
  if (filter.company.has_value()) {
    params.push_back(*filter.company);
    where << " AND company_name=$" << params.size();
  }
  if (filter.username.has_value()) {
    params.push_back(*filter.username);
    where << " AND username=$" << params.size();
  }
  if (filter.action.has_value()) {
    params.push_back(*filter.action);
    where << " AND event_action=$" << params.size();
  }
  if (filter.success.has_value()) {
    params.push_back(*filter.success ? "true" : "false");
    where << " AND success=$" << params.size() << "::boolean";
  }

  const auto toPtrs = [](const std::vector<std::string> &v) {
    std::vector<const char *> pv;
    pv.reserve(v.size());
    for (const auto &s : v) pv.push_back(s.c_str());
    return pv;
  };

  const std::string countSql =
      "SELECT COUNT(*) FROM auth_audit_logs" + where.str();
  {
    std::vector<const char *> pv = toPtrs(params);
    storage::PgResult countRes{
        PQexecParams(conn, countSql.c_str(), static_cast<int>(pv.size()),
                     nullptr, pv.empty() ? nullptr : pv.data(), nullptr,
                     nullptr, 0)};
    if (!countRes.okTuples() || PQntuples(countRes.get()) == 0) {
      return out;
    }
    out.total = static_cast<size_t>(std::stoull(PQgetvalue(countRes.get(), 0, 0)));
  }

  // data: reutiliza los filtros y añade LIMIT/OFFSET como parámetros finales.
  std::vector<std::string> dataParams = params;
  dataParams.push_back(std::to_string(filter.limit));
  const std::size_t limitIdx = dataParams.size();
  dataParams.push_back(std::to_string(filter.offset));
  const std::size_t offsetIdx = dataParams.size();

  // ADR-130: source_ip/latitude/longitude/accuracy_m existían en el esquema
  // desde db_scripts/03/58 pero esta consulta -- la que alimenta el Centro de
  // Auditoría del frontend -- nunca las seleccionaba; quedaban invisibles
  // para cualquier revisión de seguridad aunque el backend ya las escribiera
  // (login/registro) o recién empezara a hacerlo (empresas/acceso cruzado).
  std::ostringstream sql;
  sql << "SELECT event_time::text,event_action,company_name,username,success,detail,"
      << "COALESCE(source_ip,''),latitude,longitude,accuracy_m "
      << "FROM auth_audit_logs" << where.str()
      << " ORDER BY event_time DESC LIMIT $" << limitIdx << "::bigint"
      << " OFFSET $" << offsetIdx << "::bigint";

  std::vector<const char *> dpv = toPtrs(dataParams);
  storage::PgResult res{PQexecParams(conn, sql.str().c_str(),
                                     static_cast<int>(dpv.size()), nullptr,
                                     dpv.data(), nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    return out;
  }

  const int rows = PQntuples(res.get());
  for (int i = 0; i < rows; ++i) {
    out.logs.push_back(json::object{
        {"event_time", PQgetvalue(res.get(), i, 0)},
        {"event_action", PQgetvalue(res.get(), i, 1)},
        {"company_name", PQgetvalue(res.get(), i, 2)},
        {"username", PQgetvalue(res.get(), i, 3)},
        {"success", std::string(PQgetvalue(res.get(), i, 4)) == "t"},
        {"detail", PQgetvalue(res.get(), i, 5)},
        {"source_ip", PQgetvalue(res.get(), i, 6)},
        {"latitude", PQgetisnull(res.get(), i, 7) ? json::value(nullptr) : json::value(http_utils::safeStod(PQgetvalue(res.get(), i, 7)))},
        {"longitude", PQgetisnull(res.get(), i, 8) ? json::value(nullptr) : json::value(http_utils::safeStod(PQgetvalue(res.get(), i, 8)))},
        {"accuracy_m", PQgetisnull(res.get(), i, 9) ? json::value(nullptr) : json::value(http_utils::safeStod(PQgetvalue(res.get(), i, 9)))}});
  }

  return out;
}

// ── ADR-029 (revisado): refresh tokens del esquema híbrido JWT ────────────

bool insertRefreshTokenPg(const std::string &databaseUrl, const AuthUser &user,
                          const std::string &tokenHash,
                          const std::string &expiresAtIso) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return false;
  }
  (void)ensureAuthSchemaPg(conn);
  const std::string tid = user.tenantId.empty()
                              ? std::string(kMiningTelemetryDemoTenantId)
                              : user.tenantId;
  const char *params[7] = {user.id.c_str(),       user.username.c_str(),
                           user.company.c_str(),  user.role.c_str(),
                           tid.c_str(),            tokenHash.c_str(),
                           expiresAtIso.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO auth_refresh_tokens(user_id, username, company_name, "
      "role, tenant_id, token_hash, expires_at) VALUES "
      "($1, $2, $3, $4, $5, $6, $7::timestamptz)",
      7, nullptr, params, nullptr, nullptr, 0)};
  return res.okCommand();
}

/** @brief Rehidrata un `AuthUser` mínimo (sin credenciales) a partir de una fila de auth_refresh_tokens vigente. */
std::optional<AuthUser> findValidRefreshTokenUserPg(const std::string &databaseUrl,
                                                    const std::string &tokenHash) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);
  // Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA, reproducido
  // en vivo con un navegador propio): esta consulta nunca verificaba que
  // `user_id` siguiera existiendo en `auth_users`. Cuenta eliminada y
  // recreada con un id nuevo -> el refresh token de la cuenta VIEJA seguía
  // vigente (rotándose sin parar, `revokeAllSessionsForUser` existe pero
  // nada la invoca al eliminar una cuenta) -- cada POST /api/auth/refresh
  // seguía emitiendo access tokens firmados y válidos para un user_id
  // fantasma. El JWT resultante pasaba `resolveAuthSession` sin problema
  // (solo valida firma/expiración, no existencia del usuario), así que la
  // sesión SE VEÍA activa en el dashboard -- hasta que cualquier escritura
  // real con FK a auth_users (ej. INSERT en avatar_animation_job) fallaba
  // con "violates foreign key constraint", un 500 silencioso que el
  // frontend trata como "no disponible" sin mostrar nada al usuario. Repetir
  // login en la UI no lo arregla: el navegador nunca vuelve a pedir
  // credenciales mientras la cookie de refresh HttpOnly siga viva, así que
  // sigue renovando la identidad fantasma en vez de autenticar la cuenta
  // nueva. `is_active` (no solo existencia) para que además una baja lógica
  // corte el refresh de inmediato, no solo un DELETE físico.
  const char *params[1] = {tokenHash.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      // u.id::text = rt.user_id (no rt.user_id::uuid): algunas filas viejas
      // de esta tabla tienen user_id sin guiones (dato legado, ya inválido
      // como uuid) -- castear el lado de rt haría fallar la query ENTERA con
      // un error de Postgres para esas filas en vez de simplemente no
      // matchear. Comparar como texto es seguro en ambas direcciones.
      "SELECT rt.user_id, rt.username, rt.company_name, rt.role, rt.tenant_id "
      "FROM auth_refresh_tokens rt "
      "JOIN auth_users u ON u.id::text = rt.user_id "
      "WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND "
      "rt.expires_at > NOW() AND u.is_active = true",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return std::nullopt;
  }
  AuthUser user;
  user.id = PQgetvalue(res.get(), 0, 0);
  user.username = PQgetvalue(res.get(), 0, 1);
  user.company = PQgetvalue(res.get(), 0, 2);
  user.role = PQgetvalue(res.get(), 0, 3);
  user.tenantId = PQgetvalue(res.get(), 0, 4);
  return user;
}

bool revokeRefreshTokenPg(const std::string &databaseUrl,
                          const std::string &tokenHash,
                          const std::string &replacedByHash) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return false;
  }
  const char *params[2] = {tokenHash.c_str(), replacedByHash.empty()
                                                  ? nullptr
                                                  : replacedByHash.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_refresh_tokens SET revoked_at = NOW(), replaced_by = $2 "
      "WHERE token_hash = $1 AND revoked_at IS NULL",
      2, nullptr, params, nullptr, nullptr, 0)};
  return res.okCommand();
}

/** @brief Revoca todos los refresh tokens vigentes de un usuario ("logout everywhere" / incidente de seguridad). */
bool revokeAllRefreshTokensForUserPg(const std::string &databaseUrl,
                                     const std::string &userId) {
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return false;
  }
  const char *params[1] = {userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 "
      "AND revoked_at IS NULL",
      1, nullptr, params, nullptr, nullptr, 0)};
  return res.okCommand();
}

// ── Migración de credenciales a Argon2id (auditoría 2026-08-02) ───────────

namespace {

/** @brief Cuenta filas de auth_users que cumplen una condición sobre password_hash. */
int countPasswordHashes(PGconn *conn, const char *predicate) {
  const std::string sql =
      std::string("SELECT COUNT(*)::int FROM auth_users WHERE ") + predicate;
  storage::PgResult res{PQexec(conn, sql.c_str())};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return -1;
  try {
    return std::stoi(PQgetvalue(res.get(), 0, 0));
  } catch (...) {
    return -1;
  }
}

}  // namespace

PasswordMigrationResult migrateLegacyPasswordHashesPg(const std::string &databaseUrl) {
  PasswordMigrationResult out;
  auto __pg_lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    out.error = "db_unavailable";
    return out;
  }
  if (!ensureAuthSchemaPg(conn)) {
    out.error = "schema_unavailable";
    return out;
  }

  // Solo hashes legados CRUDOS: ni Argon2id auténtico ni ya envuelto.
  static const char kSelectLegacy[] =
      "SELECT id::text, password_hash FROM auth_users "
      "WHERE password_hash NOT LIKE '$argon2id$%' "
      "  AND password_hash NOT LIKE 'legacy1:%'";
  storage::PgResult rows{PQexec(conn, kSelectLegacy)};
  if (!rows.okTuples()) {
    out.error = PQresultErrorMessage(rows.get());
    return out;
  }

  out.scanned = PQntuples(rows.get());
  if (out.scanned == 0) {
    out.ran = true;
    out.remainingRaw = 0;
    out.remainingWrapped =
        countPasswordHashes(conn, "password_hash LIKE 'legacy1:%'");
    return out;
  }

  for (int i = 0; i < out.scanned; ++i) {
    const std::string userId = PQgetvalue(rows.get(), i, 0);
    const std::string legacyHash = PQgetvalue(rows.get(), i, 1);
    try {
      const std::string wrapped = http_utils::wrapLegacyHash(legacyHash);
      // Condicionado al hash antiguo: si entre el SELECT y el UPDATE el usuario
      // inició sesión y su fila ya se rehashó a Argon2id auténtico, este UPDATE
      // no afecta ninguna fila y se deja el hash bueno intacto.
      const char *params[3] = {wrapped.c_str(), userId.c_str(),
                               legacyHash.c_str()};
      storage::PgResult upd{PQexecParams(
          conn,
          "UPDATE auth_users SET password_hash=$1 "
          "WHERE id=$2::uuid AND password_hash=$3",
          3, nullptr, params, nullptr, nullptr, 0)};
      if (upd.okCommand() && PQcmdTuples(upd.get()) != nullptr &&
          std::string(PQcmdTuples(upd.get())) == "1") {
        ++out.migrated;
      } else {
        ++out.failed;
        std::cerr << "[AUTH_PASSWORD] migracion: UPDATE sin efecto para user_id="
                  << userId << std::endl;
      }
    } catch (const std::exception &ex) {
      ++out.failed;
      std::cerr << "[AUTH_PASSWORD] migracion fallo para user_id=" << userId
                << ": " << ex.what() << std::endl;
    }
  }

  out.ran = true;
  out.remainingRaw = countPasswordHashes(
      conn,
      "password_hash NOT LIKE '$argon2id$%' AND password_hash NOT LIKE 'legacy1:%'");
  out.remainingWrapped =
      countPasswordHashes(conn, "password_hash LIKE 'legacy1:%'");
  return out;
}

// ── ADR-085: CRUD administrado de empresas (db_scripts/50) ─────────────────

namespace {

/** Arma un AuthCompanyRecord desde una fila de la SELECT canónica (17 columnas, ver kCompanySelectCols). */
AuthCompanyRecord companyRecordFromRow(PGresult *res, int row, bool maskRuc) {
  AuthCompanyRecord c;
  c.companyId = PQgetvalue(res, row, 0);
  c.name = PQgetvalue(res, row, 1);
  c.ruc = maskRuc ? "" : PQgetvalue(res, row, 2);
  c.countryCode = PQgetvalue(res, row, 3);
  c.domicilioFiscal = PQgetvalue(res, row, 4);
  c.tenantId = PQgetvalue(res, row, 5);
  c.active = std::string(PQgetvalue(res, row, 6)) == "t";
  c.demoData = std::string(PQgetvalue(res, row, 7)) == "t";
  c.createdAt = PQgetvalue(res, row, 8);
  c.updatedAt = PQgetvalue(res, row, 9);
  c.updatedBy = PQgetvalue(res, row, 10);
  c.deactivatedAt = PQgetvalue(res, row, 11);
  c.deactivatedBy = PQgetvalue(res, row, 12);
  // ADR-121: sin COALESCE en kCompanySelectCols -- PQgetisnull refleja el
  // NULL real de la columna ("sin coordenadas todavía" vs. 0,0).
  if (!PQgetisnull(res, row, 13)) c.latitude = std::stod(PQgetvalue(res, row, 13));
  if (!PQgetisnull(res, row, 14)) c.longitude = std::stod(PQgetvalue(res, row, 14));
  if (!PQgetisnull(res, row, 15)) c.locationZoom = std::stoi(PQgetvalue(res, row, 15));
  // db_scripts/72: subquery correlacionada a tenants.company_type (columna 16)
  // -- ya viene con COALESCE a 'mining_client' en kCompanySelectCols.
  c.companyType = PQgetvalue(res, row, 16);
  return c;
}

const char kCompanySelectCols[] =
    "company_id::text, name, ruc, country_code, COALESCE(domicilio_fiscal,''), "
    "COALESCE(tenant_id::text,''), active, demo_data, created_at::text, "
    "COALESCE(updated_at::text,''), COALESCE(updated_by,''), "
    "COALESCE(deactivated_at::text,''), COALESCE(deactivated_by,''), "
    "latitude, longitude, location_zoom, "
    // db_scripts/72: company_type vive en tenants, no en auth_companies --
    // subquery correlacionada (funciona igual en SELECT/INSERT..RETURNING/
    // UPDATE..RETURNING porque auth_companies es siempre el nombre de la
    // tabla objetivo en las tres formas, ver kCompanySelectCols call sites).
    "COALESCE((SELECT t.company_type FROM tenants t "
    "WHERE t.tenant_id = auth_companies.tenant_id), 'mining_client')";

json::object companyRecordToJson(const AuthCompanyRecord &c) {
  return json::object{
      {"company_id", c.companyId},   {"name", c.name},
      {"ruc", c.ruc},                {"country_code", c.countryCode},
      {"domicilio_fiscal", c.domicilioFiscal},
      {"tenant_id", c.tenantId},     {"active", c.active},
      {"demo_data", c.demoData},     {"created_at", c.createdAt},
      {"updated_at", c.updatedAt},   {"updated_by", c.updatedBy},
      {"deactivated_at", c.deactivatedAt},
      {"deactivated_by", c.deactivatedBy},
      {"latitude", c.latitude ? json::value(*c.latitude) : json::value(nullptr)},
      {"longitude", c.longitude ? json::value(*c.longitude) : json::value(nullptr)},
      {"location_zoom", c.locationZoom ? json::value(*c.locationZoom) : json::value(nullptr)},
      {"company_type", c.companyType}};
}

} // namespace

json::array listCompaniesAdminPg(const std::string &databaseUrl,
                                 bool includeInactive, bool maskRuc) {
  json::array out;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK || !ensureAuthSchemaPg(conn)) {
    return out;
  }
  const std::string sql = std::string("SELECT ") + kCompanySelectCols +
                          " FROM auth_companies WHERE ($1::boolean OR active = true) "
                          "ORDER BY name ASC";
  const char *p[1] = {includeInactive ? "true" : "false"};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      out.push_back(companyRecordToJson(
          companyRecordFromRow(res.get(), i, maskRuc)));
    }
  }
  return out;
}

bool getCompanyByIdPg(const std::string &databaseUrl,
                      const std::string &companyId, AuthCompanyRecord &out) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK || !ensureAuthSchemaPg(conn)) {
    return false;
  }
  const std::string sql = std::string("SELECT ") + kCompanySelectCols +
                          " FROM auth_companies WHERE company_id = $1::uuid LIMIT 1";
  const char *p[1] = {companyId.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) != 1) {
    return false;
  }
  out = companyRecordFromRow(res.get(), 0, /*maskRuc=*/false);
  return true;
}

bool createCompanyPg(const std::string &databaseUrl, const std::string &name,
                     const std::string &ruc, const std::string &countryCode,
                     const std::string &domicilioFiscal,
                     std::optional<double> latitude,
                     std::optional<double> longitude,
                     std::optional<int> locationZoom,
                     const std::string &actorUserId,
                     const std::string &actorRole, AuthCompanyRecord &out,
                     std::string &error,
                     const std::string &companyType) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK || !ensureAuthSchemaPg(conn)) {
    error = "database_unavailable";
    return false;
  }

  // Se apoya en ux_auth_companies_name_norm (db_scripts/50) para resolver la
  // condición de carrera que tenía el POST original (SELECT + INSERT sin
  // índice único de respaldo): ON CONFLICT DO NOTHING sin fila devuelta ==
  // ya existía, sin ninguna ventana entre el chequeo y el insert.
  //
  // Formatear a std::string ANTES de armar el arreglo de params (mismo
  // motivo que appendAuthAuditLogPg): PQexecParams guarda punteros crudos.
  const std::string latStr = latitude ? std::to_string(*latitude) : "";
  const std::string lonStr = longitude ? std::to_string(*longitude) : "";
  const std::string zoomStr = locationZoom ? std::to_string(*locationZoom) : "";
  const std::string insSql = std::string(
      "INSERT INTO auth_companies(name, ruc, country_code, domicilio_fiscal, "
      "active, updated_at, updated_by, latitude, longitude, location_zoom) "
      "VALUES($1,$2,$3,$4,true,NOW(),$5,$6::double precision,"
      "$7::double precision,$8::int) "
      "ON CONFLICT (lower(btrim(name))) DO NOTHING "
      "RETURNING ") + kCompanySelectCols;
  const char *insParams[8] = {
      name.c_str(), ruc.c_str(), countryCode.c_str(), domicilioFiscal.c_str(),
      actorUserId.c_str(),
      latitude ? latStr.c_str() : nullptr,
      longitude ? lonStr.c_str() : nullptr,
      locationZoom ? zoomStr.c_str() : nullptr};
  storage::PgResult ins{PQexecParams(conn, insSql.c_str(), 8, nullptr,
                                     insParams, nullptr, nullptr, 0)};
  if (!ins.okTuples()) {
    const std::string pgError = PQresultErrorMessage(ins.get());
    // El ON CONFLICT solo cubre el índice de nombre; un RUC duplicado entre
    // dos empresas distintas viola ux_auth_companies_ruc y llega aquí como
    // error real (no como "0 filas") — se traduce a un código legible en
    // vez de burbujear el mensaje crudo de Postgres.
    if (pgError.find("ux_auth_companies_ruc") != std::string::npos) {
      error = "ruc_already_exists";
    } else {
      error = "company_create_failed: " + pgError;
    }
    return false;
  }
  if (PQntuples(ins.get()) == 0) {
    error = "company_already_exists";
    return false;
  }
  out = companyRecordFromRow(ins.get(), 0, /*maskRuc=*/false);

  std::string tenantError;
  const std::string tenantId = findOrCreateTenantForCompanyPg(
      databaseUrl, name, actorUserId, actorRole, tenantError);
  if (tenantId.empty()) {
    error = "tenant_provision_failed: " + tenantError;
    return false;
  }
  const char *linkParams[2] = {tenantId.c_str(), out.companyId.c_str()};
  storage::PgResult linked{PQexecParams(
      conn,
      "UPDATE auth_companies SET tenant_id=$1::uuid WHERE company_id=$2::uuid",
      2, nullptr, linkParams, nullptr, nullptr, 0)};
  if (linked.okCommand()) {
    out.tenantId = tenantId;
  }
  // db_scripts/72: company_type vive en tenants, no en auth_companies -- se
  // aplica recién ahora que el tenant existe. 'mining_client' (el default) no
  // necesita UPDATE (ya es el valor por defecto de la columna).
  if (companyType == "organization") {
    const char *typeParams[1] = {tenantId.c_str()};
    storage::PgResult typed{PQexecParams(
        conn, "UPDATE tenants SET company_type='organization' WHERE tenant_id=$1::uuid",
        1, nullptr, typeParams, nullptr, nullptr, 0)};
    if (typed.okCommand()) out.companyType = "organization";
  }
  return true;
}

bool updateCompanyPg(const std::string &databaseUrl,
                     const std::string &companyId, const std::string &ruc,
                     const std::string &countryCode,
                     const std::string &domicilioFiscal,
                     std::optional<double> latitude,
                     std::optional<double> longitude,
                     std::optional<int> locationZoom,
                     const std::string &actorUserId, AuthCompanyRecord &out,
                     std::string &error,
                     const std::string &companyType) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK || !ensureAuthSchemaPg(conn)) {
    error = "database_unavailable";
    return false;
  }
  // `name` nunca se toca aquí a propósito — ver comentario en el header.
  const std::string latStr = latitude ? std::to_string(*latitude) : "";
  const std::string lonStr = longitude ? std::to_string(*longitude) : "";
  const std::string zoomStr = locationZoom ? std::to_string(*locationZoom) : "";
  const std::string sql = std::string(
      "UPDATE auth_companies SET ruc=$2, country_code=$3, "
      "domicilio_fiscal=$4, latitude=$6::double precision, "
      "longitude=$7::double precision, location_zoom=$8::int, "
      "updated_at=NOW(), updated_by=$5 "
      "WHERE company_id=$1::uuid RETURNING ") + kCompanySelectCols;
  const char *p[8] = {
      companyId.c_str(), ruc.c_str(), countryCode.c_str(), domicilioFiscal.c_str(),
      actorUserId.c_str(),
      latitude ? latStr.c_str() : nullptr,
      longitude ? lonStr.c_str() : nullptr,
      locationZoom ? zoomStr.c_str() : nullptr};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 8, nullptr, p, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    error = "company_update_failed: " +
            std::string(PQresultErrorMessage(res.get()));
    return false;
  }
  if (PQntuples(res.get()) == 0) {
    error = "company_not_found";
    return false;
  }
  out = companyRecordFromRow(res.get(), 0, /*maskRuc=*/false);
  // db_scripts/72: company_type vive en tenants -- solo se toca si el caller
  // mandó un valor explícito (companyType vacío == "no cambiar", mismo
  // criterio de "solo lo que viene en el body" que el resto de esta función).
  if ((companyType == "organization" || companyType == "mining_client") &&
      !out.tenantId.empty()) {
    const char *typeParams[2] = {companyType.c_str(), out.tenantId.c_str()};
    storage::PgResult typed{PQexecParams(
        conn, "UPDATE tenants SET company_type=$1 WHERE tenant_id=$2::uuid",
        2, nullptr, typeParams, nullptr, nullptr, 0)};
    if (typed.okCommand()) out.companyType = companyType;
  }
  return true;
}

bool setCompanyActivePg(const std::string &databaseUrl,
                        const std::string &companyId, bool active,
                        const std::string &actorUserId,
                        int &activeUsersAffected, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK || !ensureAuthSchemaPg(conn)) {
    error = "database_unavailable";
    return false;
  }
  const char *activeStr = active ? "true" : "false";
  const char *p[3] = {companyId.c_str(), activeStr, actorUserId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE auth_companies SET active=$2::boolean, "
      "deactivated_at = CASE WHEN $2::boolean THEN NULL ELSE NOW() END, "
      "deactivated_by = CASE WHEN $2::boolean THEN NULL ELSE $3 END, "
      "updated_at = NOW(), updated_by = $3 "
      "WHERE company_id=$1::uuid RETURNING name",
      3, nullptr, p, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "company_not_found";
    return false;
  }
  const std::string name = PQgetvalue(res.get(), 0, 0);
  activeUsersAffected = 0;
  const char *cp[1] = {name.c_str()};
  storage::PgResult cnt{PQexecParams(
      conn,
      "SELECT COUNT(*)::int FROM auth_users WHERE company_name=$1 AND account_status='active'",
      1, nullptr, cp, nullptr, nullptr, 0)};
  if (cnt.okTuples() && PQntuples(cnt.get()) > 0) {
    try {
      activeUsersAffected = std::stoi(PQgetvalue(cnt.get(), 0, 0));
    } catch (...) {
      activeUsersAffected = 0;
    }
  }
  return true;
}

} // namespace auth

#endif // HAS_LIBPQ
