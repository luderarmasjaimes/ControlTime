#include "auth_routes.hpp"
#include "auth_types.hpp"
#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "auth_storage_file.hpp"
#include "permissions.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <cctype>
#include <cstdlib>
#include <mutex>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using http_utils::routePathOnly;
using config::AppConfig;
using config::AuthStorageMode;

namespace auth {

static std::string trimAuthParam(std::string s) {
  const char *ws = " \t\n\r";
  const auto a = s.find_first_not_of(ws);
  if (a == std::string::npos) return {};
  const auto b = s.find_last_not_of(ws);
  return s.substr(a, b - a + 1);
}

static http::response<http::string_body> buildAuthLoginCheckIdentityResponse(
    std::string companyRaw, std::string identityRaw) {
  auto &cfg = AppConfig::instance();

  std::string company = trimAuthParam(std::move(companyRaw));
  std::string identity = trimAuthParam(std::move(identityRaw));
  if (company.empty() || identity.empty()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{
            {"ok", false},
            {"reason", "bad_request"},
            {"error",
             "Indique empresa e identificador (Usuario, DNI o RUC)."}});
  }

  AuthLoginIdentityLookupResult lu;
  {
    std::scoped_lock lk(gAuthMutex);
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      lu = authLookupIdentityForCompanyPg(cfg.gDatabaseUrl, company, identity);
#else
      lu.kind = AuthLoginIdentityLookupResult::Kind::DbError;
      lu.diagnostic = "postgres support is not compiled";
#endif
    } else {
      const std::string dataRoot =
          config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
      lu = authLookupIdentityForCompanyFs(dataRoot, company, identity);
    }
  }

  using ILKind = AuthLoginIdentityLookupResult::Kind;
  if (lu.kind == ILKind::DbError) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{
            {"ok", false},
            {"reason", "server_error"},
            {"error", lu.diagnostic.empty()
                          ? "No se pudo comprobar el usuario."
                          : lu.diagnostic}});
  }
  if (lu.kind == ILKind::NotFound) {
    return makeJsonResponse(
        http::status::ok,
        json::object{{"ok", false},
                     {"reason", "not_found"},
                     {"error", std::string(AppConfig::kAuthUserNotFoundMsg)}});
  }
  if (lu.kind == ILKind::Ambiguous) {
    return makeJsonResponse(
        http::status::ok,
        json::object{
            {"ok", false},
            {"reason", "ambiguous"},
            {"error", std::string(AppConfig::kAuthAmbiguousIdentityMsg)}});
  }
  return makeJsonResponse(
      http::status::ok,
      json::object{{"ok", true}, {"username", lu.resolvedUsername}});
}

// ---------------------------------------------------------------------------
// Multi-tenant: un usuario puede pertenecer a varias unidades mineras
// (auth_user_tenant). El login inicial resuelve el tenant desde la empresa
// elegida en el dropdown (resolveTelemetryTenantIdPg), pero un usuario que
// pertenece a VARIAS ya no necesita cerrar sesión para cambiar de unidad:
// lista sus tenants y reemite un token de sesión con el nuevo tenant activo.
// ---------------------------------------------------------------------------

/** @brief GET /api/auth/tenants — unidades mineras a las que pertenece el usuario autenticado, con su rol efectivo en cada una y cuál es la activa. */
http::response<http::string_body>
handleListMyTenants(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const char *p[1] = {session->userId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT t.tenant_id::text, t.tenant_name, ut.role, ut.is_default "
        "FROM auth_user_tenant ut JOIN tenants t ON t.tenant_id = ut.tenant_id "
        "WHERE ut.user_id = $1::uuid ORDER BY ut.is_default DESC, t.tenant_name",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        const std::string tenantId = PQgetvalue(res.get(), i, 0);
        const std::string role = PQgetisnull(res.get(), i, 2)
                                      ? session->role
                                      : std::string(PQgetvalue(res.get(), i, 2));
        items.push_back(json::object{
            {"tenant_id", tenantId},
            {"tenant_name", PQgetvalue(res.get(), i, 1)},
            {"role", role},
            {"is_default", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
            {"active", tenantId == session->tenantId}});
      }
    }
  }
  // Compatibilidad: si el usuario no tiene filas en auth_user_tenant (caso
  // común hoy — el login resuelve el tenant por nombre de empresa, no por
  // esta tabla), devolver igual su tenant activo para que el selector nunca
  // quede vacío.
  if (items.empty() && !session->tenantId.empty()) {
    items.push_back(json::object{{"tenant_id", session->tenantId},
                                 {"tenant_name", session->company},
                                 {"role", session->role},
                                 {"is_default", true},
                                 {"active", true}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"tenants", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"tenants", json::array()}});
#endif
}

/** @brief POST /api/auth/tenants/switch {tenant_id} — reemite la sesión (access+refresh) apuntando al tenant destino, verificando membresía real en auth_user_tenant. IDOR: nunca confía en el tenant_id del body sin verificar la fila de membresía. */
http::response<http::string_body>
handleSwitchTenant(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
#if HAS_LIBPQ
  std::string targetTenant;
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("tenant_id"))
      if (v->is_string()) targetTenant = std::string(v->as_string());
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (targetTenant.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "tenant_id_requerido"}});
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }

  // Verificar membresía real (nunca confiar en el tenant_id del cliente sin
  // esto — sería un IDOR: cualquier usuario podría autoasignarse a cualquier
  // tenant simplemente pidiendo un token para él).
  std::string tenantRole;
  {
    const char *p[2] = {session->userId.c_str(), targetTenant.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT role FROM auth_user_tenant "
        "WHERE user_id = $1::uuid AND tenant_id = $2::uuid",
        2, nullptr, p, nullptr, nullptr, 0)};
    const bool isMember = res.okTuples() && PQntuples(res.get()) > 0;
    // Compatibilidad: si el usuario no tiene NINGUNA fila en auth_user_tenant
    // (login tradicional por nombre de empresa), permitir "cambiar" solo a
    // su propio tenant actual — no abre ninguna puerta nueva.
    const bool selfNoMembership =
        !isMember && targetTenant == session->tenantId;
    if (!isMember && !selfNoMembership) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "no_pertenece_al_tenant"}});
    }
    if (isMember && !PQgetisnull(res.get(), 0, 0))
      tenantRole = PQgetvalue(res.get(), 0, 0);
  }

  auto user = findUserByIdPg(cfg.gDatabaseUrl, session->userId);
  if (!user) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "usuario_no_encontrado"}});
  }
  user->tenantId = targetTenant;
  if (!tenantRole.empty()) user->role = tenantRole;  // rol efectivo del tenant destino en el JWT

  const auto tokenPair = auth::issueAuthSession(*user);
  const char *auditP[2] = {targetTenant.c_str(), session->userId.c_str()};
  storage::PgResult a{PQexecParams(
      conn,
      "SELECT fn_platform_audit_insert($1::uuid, $2::uuid, 'auth', "
      "'tenant_switched', 'user', $2::text, NULL, NULL, NULL, TRUE, NULL)",
      2, nullptr, auditP, nullptr, nullptr, 0)};
  (void)a;

  // ADR-029, "Actualización 2026-07-19": el refresh token ya no viaja en el
  // body -- va en la cookie HttpOnly (ver http_utils::setAuthCookies), igual
  // que en login/registro/refresh.
  auto res = makeJsonResponse(
      http::status::ok,
      json::object{{"ok", true},
                   {"access_token", tokenPair.token},
                   {"expires_in", tokenPair.expiresInSeconds},
                   {"tenant_id", targetTenant},
                   {"role", user->role}});
  http_utils::setAuthCookies(res, tokenPair.refreshToken, tokenPair.csrfToken,
                             cfg.gJwtRefreshTtlDays * 24 * 3600);
  return res;
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// Los 7 roles reales de la plataforma (roleConstants.ts en el frontend es la
// fuente de verdad) — ver db_scripts/43 y ADR-063. Usado para validar tanto la
// creación de usuarios como la asignación de tenant/rol.
static const std::set<std::string> kValidPlatformRoles = {
    "admin", "manager", "supervisor", "geologist", "safety", "operator", "viewer"};

// ---------------------------------------------------------------------------
// Alta de usuario admin-driven (sin biometría): a diferencia de
// /api/auth/register (autoregistro con enrolamiento facial obligatorio, ver
// handleRegister en main.cpp), esto es para que un admin cree una cuenta para
// un tercero de forma remota — el usuario completa su enrolamiento biométrico
// después, en su primer login. face_template queda vacío (registerUserPg lo
// acepta: castea "[]" a jsonb, sin requerir contenido).
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleAdminCreateUser(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!hasPermission(session->userId, session->tenantId, session->role, "usuarios.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "usuarios.manage"}});
  }
#if HAS_LIBPQ
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  const auto &obj = body.as_object();
  static const std::vector<std::string> kRequired = {
      "username", "password", "first_name", "last_name", "dni"};
  for (const auto &key : kRequired) {
    if (!obj.if_contains(key.c_str()) || !obj.at(key.c_str()).is_string() ||
        json::value_to<std::string>(obj.at(key.c_str())).empty()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", key + "_requerido"}});
    }
  }
  const std::string username  = json::value_to<std::string>(obj.at("username"));
  const std::string password  = json::value_to<std::string>(obj.at("password"));
  const std::string firstName = json::value_to<std::string>(obj.at("first_name"));
  const std::string lastName  = json::value_to<std::string>(obj.at("last_name"));
  const std::string dni       = json::value_to<std::string>(obj.at("dni"));
  std::string role = "operator";
  if (const auto *v = obj.if_contains("role"))
    if (v->is_string()) role = json::value_to<std::string>(*v);
  if (kValidPlatformRoles.find(role) == kValidPlatformRoles.end()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "rol_invalido"}});
  }
  if (password.size() < 8) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "password_minimo_8_caracteres"}});
  }
  std::string email, phone, mobile;
  if (const auto *v = obj.if_contains("email"))  if (v->is_string()) email  = json::value_to<std::string>(*v);
  if (const auto *v = obj.if_contains("phone"))  if (v->is_string()) phone  = json::value_to<std::string>(*v);
  if (const auto *v = obj.if_contains("mobile")) if (v->is_string()) mobile = json::value_to<std::string>(*v);

  AuthUser created;
  created.id           = http_utils::makeId();
  created.company       = session->company;   // misma empresa/tenant del admin que crea
  created.firstName     = firstName;
  created.lastName      = lastName;
  created.dni            = dni;
  created.username       = username;
  created.role           = role;
  created.passwordHash   = http_utils::hashPassword(password);
  created.email          = email;
  created.phone          = phone;
  created.mobile         = mobile;
  // faceTemplate queda vacío a propósito — ver comentario de la función.

  auto &cfg = AppConfig::instance();
  std::string dbError;
  if (!registerUserPg(cfg.gDatabaseUrl, created, dbError)) {
    const bool duplicate = dbError.find("exists") != std::string::npos;
    return makeJsonResponse(duplicate ? http::status::conflict : http::status::internal_server_error,
                            json::object{{"error", duplicate ? "dni_ya_existe" : "creacion_fallida"},
                                         {"detail", dbError}});
  }

  // Vínculo multitenant explícito con el tenant activo del admin (ADR
  // RBAC — ver db_scripts/42/43): el usuario recién creado ya aparece con
  // membresía real, no depende del match por nombre de empresa.
  if (!session->tenantId.empty()) {
    auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn *conn = lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      const char *p[3] = {created.id.c_str(), session->tenantId.c_str(), role.c_str()};
      storage::PgResult ins{PQexecParams(
          conn,
          "INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role) "
          "VALUES ($1::uuid, $2::uuid, true, $3) ON CONFLICT DO NOTHING",
          3, nullptr, p, nullptr, nullptr, 0)};
      (void)ins;
    }
  }

  return makeJsonResponse(http::status::ok,
      json::object{{"ok", true},
                   {"user_id", created.id},
                   {"username", created.username},
                   {"role", created.role}});
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// Gestión admin de accesos multitenant de OTROS usuarios: un admin con
// usuarios.manage puede otorgar/revocar acceso a la unidad minera ACTIVA de
// SU sesión (nunca una arbitraria del body — evita que un admin de la unidad
// A conceda acceso a la unidad B sin pertenecer él mismo a B).
// ---------------------------------------------------------------------------

std::string usernameFromTenantsPath(const std::string &target, const std::string &suffix) {
  // /api/auth/users/{username}/tenants[suffix]
  static const std::string kPrefix = "/api/auth/users/";
  if (target.rfind(kPrefix, 0) != 0) return "";
  std::string rest = target.substr(kPrefix.size());
  auto q = rest.find('?');
  if (q != std::string::npos) rest = rest.substr(0, q);
  const std::string kTenantsTag = "/tenants";
  auto pos = rest.find(kTenantsTag);
  if (pos == std::string::npos) return "";
  const std::string afterTag = rest.substr(pos + kTenantsTag.size());
  if (afterTag != suffix) return "";
  return rest.substr(0, pos);
}

http::response<http::string_body>
handleListUserTenants(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!hasPermission(session->userId, session->tenantId, session->role, "usuarios.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "usuarios.manage"}});
  }
#if HAS_LIBPQ
  const std::string targetUsername = usernameFromTenantsPath(std::string(req.target()), "");
  if (targetUsername.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "usuario_invalido"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const char *p[1] = {targetUsername.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT t.tenant_id::text, t.tenant_name, ut.role, ut.is_default "
        "FROM auth_user_tenant ut "
        "JOIN tenants t ON t.tenant_id = ut.tenant_id "
        "JOIN auth_users u ON u.id = ut.user_id "
        "WHERE u.username = $1 ORDER BY t.tenant_name",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (res.okTuples())
      for (int i = 0; i < PQntuples(res.get()); ++i)
        items.push_back(json::object{
            {"tenant_id", PQgetvalue(res.get(), i, 0)},
            {"tenant_name", PQgetvalue(res.get(), i, 1)},
            {"role", PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 2))},
            {"is_default", std::string(PQgetvalue(res.get(), i, 3)) == "t"}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"tenants", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"tenants", json::array()}});
#endif
}

namespace {
http::response<http::string_body>
handleGrantUserTenant(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!hasPermission(session->userId, session->tenantId, session->role, "usuarios.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "usuarios.manage"}});
  }
#if HAS_LIBPQ
  const std::string targetUsername = usernameFromTenantsPath(std::string(req.target()), "");
  if (targetUsername.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "usuario_invalido"}});
  }
  std::string role = "operator";
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("role"))
      if (v->is_string()) role = json::value_to<std::string>(*v);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (kValidPlatformRoles.find(role) == kValidPlatformRoles.end()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "rol_invalido"}});
  }
  if (session->tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sin_tenant_activo"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *p[3] = {targetUsername.c_str(), session->tenantId.c_str(), role.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role) "
      "SELECT u.id, $2::uuid, "
      "  NOT EXISTS (SELECT 1 FROM auth_user_tenant x WHERE x.user_id = u.id), $3 "
      "FROM auth_users u WHERE u.username = $1 "
      "ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role "
      "RETURNING user_id",
      3, nullptr, p, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "usuario_no_encontrado"}});
  }
  const char *auditP[2] = {session->tenantId.c_str(), targetUsername.c_str()};
  storage::PgResult a{PQexecParams(conn,
      "SELECT fn_platform_audit_insert($1::uuid, NULL, 'rbac', "
      "'tenant_access_granted', 'user', $2::text, NULL, NULL, NULL, TRUE, NULL)",
      2, nullptr, auditP, nullptr, nullptr, 0)};
  (void)a;
  return makeJsonResponse(http::status::ok, json::object{{"ok", true}, {"role", role}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleRevokeUserTenant(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!hasPermission(session->userId, session->tenantId, session->role, "usuarios.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "usuarios.manage"}});
  }
#if HAS_LIBPQ
  const std::string targetUsername = usernameFromTenantsPath(std::string(req.target()), "/remove");
  if (targetUsername.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "usuario_invalido"}});
  }
  if (targetUsername == session->username) {
    // Evita que un admin se auto-revoque su única unidad y quede fuera.
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "no_puede_autorevocarse"}});
  }
  if (session->tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sin_tenant_activo"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *p[2] = {targetUsername.c_str(), session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "DELETE FROM auth_user_tenant ut USING auth_users u "
      "WHERE ut.user_id = u.id AND u.username = $1 AND ut.tenant_id = $2::uuid",
      2, nullptr, p, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  return makeJsonResponse(ok ? http::status::ok : http::status::not_found,
      json::object{{"status", ok ? "revoked" : "not_found"}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}
} // namespace

// El router solo soporta match exacto o por prefijo (no wildcards en medio de
// la ruta) — un solo prefijo POST "/api/auth/users/" debe cubrir tanto
// otorgar (.../tenants) como revocar (.../tenants/remove) acceso, así que
// este dispatcher decide según el sufijo real del target (mismo patrón que
// usernameFromTenantsPath ya usa para extraer el username).
http::response<http::string_body>
handleUserTenantPost(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const std::string target(req.target());
  if (target.size() >= 7 && target.compare(target.size() - 7, 7, "/remove") == 0) {
    return handleRevokeUserTenant(req, query);
  }
  return handleGrantUserTenant(req, query);
}

void registerRoutes(router::Router &r) {
  auto &cfg = AppConfig::instance();

  // GET /api/auth/companies
  r.get("/api/auth/companies",
        [&cfg](const http::request<http::string_body> &,
               const std::unordered_map<std::string, std::string> &) {
          json::array companies;
          bool loadedFromDb = false;
          if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
            auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
            PGconn *conn = __pg_lease.get();
            if (PQstatus(conn) == CONNECTION_OK) {
              (void)ensureAuthSchemaPg(conn);
              PGresult *res = PQexec(
                  conn,
                  "SELECT name FROM auth_companies WHERE active=true "
                  "ORDER BY name ASC");
              if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
                for (int i = 0; i < PQntuples(res); ++i) {
                  companies.push_back(
                      json::value(std::string(PQgetvalue(res, i, 0))));
                }
                loadedFromDb = PQntuples(res) > 0;
              }
              if (res) PQclear(res);
            }
#endif
          }
          if (!loadedFromDb) {
            for (const auto &c : config::kMiningCompanies) {
              companies.push_back(json::value(c));
            }
          }
          return makeJsonResponse(http::status::ok,
                                  json::object{{"companies", companies}});
        });

  // GET /api/auth/login/check-identity
  r.get("/api/auth/login/check-identity",
        [](const http::request<http::string_body> &,
           const std::unordered_map<std::string, std::string> &query) {
          const std::string company =
              query.count("company") ? query.at("company") : "";
          const std::string identity =
              query.count("identity") ? query.at("identity") : "";
          return buildAuthLoginCheckIdentityResponse(company, identity);
        });

  // POST /api/auth/login/check-identity
  r.post("/api/auth/login/check-identity",
         [](const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &) {
           try {
             auto val = json::parse(req.body());
             if (!val.is_object()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"ok", false},
                                {"reason", "bad_request"},
                                {"error", "invalid JSON body"}});
             }
             const auto &obj = val.as_object();
             std::string company;
             std::string identity;
             if (obj.if_contains("company") &&
                 obj.at("company").is_string()) {
               company = json::value_to<std::string>(obj.at("company"));
             }
             if (obj.if_contains("identity") &&
                 obj.at("identity").is_string()) {
               identity = json::value_to<std::string>(obj.at("identity"));
             } else if (obj.if_contains("username") &&
                        obj.at("username").is_string()) {
               identity = json::value_to<std::string>(obj.at("username"));
             }
             return buildAuthLoginCheckIdentityResponse(std::move(company),
                                                        std::move(identity));
           } catch (const std::exception &) {
             return makeJsonResponse(
                 http::status::bad_request,
                 json::object{{"ok", false},
                              {"reason", "bad_request"},
                              {"error", "invalid JSON body"}});
           }
         });

  // GET /api/auth/validate-company
  r.get("/api/auth/validate-company",
        [](const http::request<http::string_body> &,
           const std::unordered_map<std::string, std::string> &query) {
          std::string company =
              query.count("company") ? query.at("company") : "";
          std::string ruc = query.count("ruc") ? query.at("ruc") : "";

          bool valid = false;
          if (ruc.length() == 11) {
            bool isNumeric = true;
            for (char c : ruc) {
              if (!std::isdigit(static_cast<unsigned char>(c))) {
                isNumeric = false;
                break;
              }
            }
            if (isNumeric) {
              std::string prefix = ruc.substr(0, 2);
              if (prefix == "10" || prefix == "15" || prefix == "17" ||
                  prefix == "20") {
                int factor[] = {5, 4, 3, 2, 7, 6, 5, 4, 3, 2};
                int sum = 0;
                for (int i = 0; i < 10; ++i) {
                  sum += (ruc[i] - '0') * factor[i];
                }
                int remainder = sum % 11;
                int check_digit = 11 - remainder;
                if (check_digit == 10) check_digit = 0;
                if (check_digit == 11) check_digit = 1;
                if (check_digit == (ruc[10] - '0')) {
                  valid = true;
                }
              }
            }
          }
          return makeJsonResponse(http::status::ok,
                                  json::object{{"valid", valid}});
        });

  // GET /api/auth/users
  r.get("/api/auth/users",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session)
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          // IDOR fix: el tenant SIEMPRE viene de la sesión autenticada, nunca
          // de un query param — de lo contrario cualquier usuario podría listar
          // usuarios de otra empresa con ?company=OtraEmpresa.
          const std::string &company = session->company;
#if HAS_LIBPQ
          return makeJsonResponse(
              http::status::ok,
              json::object{
                  {"users", listCompanyUsersPg(cfg.gDatabaseUrl, company)}});
#else
          return makeJsonResponse(http::status::ok,
                                  json::object{{"users", json::array()}});
#endif
        });

  // POST /api/auth/users/maintenance
  r.post("/api/auth/users/maintenance",
         [&cfg](const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
           const auto session = resolveAuthSession(req, query);
           if (!session)
             return makeJsonResponse(http::status::unauthorized,
                                     json::object{{"error", "unauthorized"}});
           try {
             auto payload = json::parse(req.body()).as_object();
             // IDOR fix (escritura): el tenant sobre el que se actúa (bloquear,
             // resetear password, cambiar rol, dar de baja) SIEMPRE es el de la
             // sesión autenticada. Se sobreescribe cualquier "company" que el
             // cliente haya enviado en el body — de lo contrario un usuario
             // autenticado en el tenant A podría mutar usuarios del tenant B
             // con solo cambiar ese campo en el payload.
             payload["company"] = json::string(session->company);
             json::object audit;
             std::string error;
#if HAS_LIBPQ
             if (executeUserMaintenancePg(cfg.gDatabaseUrl, payload, audit,
                                          error)) {
               return makeJsonResponse(
                   http::status::ok,
                   json::object{{"status", "ok"}, {"audit", audit}});
             }
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"error", error}});
#else
             return makeJsonResponse(
                 http::status::bad_request,
                 json::object{
                     {"error", "postgres support is not compiled"}});
#endif
           } catch (const std::exception &ex) {
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"error", ex.what()}});
           }
         });

  // GET /api/auth/users/maintenance/audit
  r.get("/api/auth/users/maintenance/audit",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session)
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          // IDOR fix: mismo tenant-check que GET /api/auth/users — el log de
          // auditoría de otra empresa no debe ser visible vía query override.
          const std::string &company = session->company;
          int page = query.count("page")
                         ? std::atoi(query.at("page").c_str())
                         : 1;
          int pageSize = query.count("page_size")
                             ? std::atoi(query.at("page_size").c_str())
                             : 20;
#if HAS_LIBPQ
          return makeJsonResponse(
              http::status::ok,
              json::object{{"logs", listUserMaintenanceAuditPg(
                                        cfg.gDatabaseUrl, company, page,
                                        pageSize)}});
#else
          return makeJsonResponse(http::status::ok,
                                  json::object{{"logs", json::array()}});
#endif
        });

  // Multi-tenant: listar unidades mineras del usuario + cambiar tenant activo
  // sin reautenticar (ver handlers arriba, antes de registerRoutes).
  r.get("/api/auth/tenants", handleListMyTenants);
  r.post("/api/auth/tenants/switch", handleSwitchTenant);

  // Alta de usuarios admin-driven + gestión de accesos multitenant de terceros.
  r.post("/api/auth/users/create", handleAdminCreateUser);
  r.get("/api/auth/users/", handleListUserTenants);
  r.post("/api/auth/users/", handleUserTenantPost);
}

} // namespace auth
