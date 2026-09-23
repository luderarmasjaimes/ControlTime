#include "auth_routes.hpp"
#include "auth_types.hpp"
#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "auth_storage_file.hpp"
#include "avatar_animation_job.hpp"
#include "avatar_animation_storage_pg.hpp"
#include "permissions.hpp"
#include "tax_id.hpp"
#include "tax_registry_client.hpp"
#include "../biometric/ai_engine_client.hpp"
#include "../biometric/avatar_animation_client.hpp"
#include "../biometric/face_analysis.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../security/validators.hpp"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using http_utils::makeOctetResponse;
using http_utils::makePngResponse;
using http_utils::routePathOnly;
using config::AppConfig;
using config::AuthStorageMode;

namespace auth {

static std::mutex gAvatarHdMutex;

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
    // Solo File-mode necesita serializarse contra gAuthMutex (ver mismo
    // comentario en main.cpp/handleRegister). Este lookup es de solo lectura,
    // se llama en cada paso de "verificar identidad" del login (alta
    // frecuencia) -- en Postgres no hay nada que proteger aquí, solo se
    // sumaba a la cola detrás de cualquier registro/login lento en curso.
    std::unique_lock<std::mutex> lk(gAuthMutex, std::defer_lock);
    if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
      lk.lock();
    }
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
    // El diagnóstico de libpq (host/IP interna de pgbouncer) solo al log;
    // al cliente un 503 genérico y reintentable.
    std::cerr << "[AUTH_CHECK_IDENTITY] BD no disponible: " << lu.diagnostic
              << std::endl;
    return makeJsonResponse(
        http::status::service_unavailable,
        json::object{
            {"ok", false},
            {"reason", "db_unavailable"},
            {"error", "El servicio no está disponible en este momento. "
                      "Intente nuevamente en unos segundos."}});
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

/**
 * Pre-chequeo de DNI disponible ANTES de la captura facial (hallazgo real
 * 2026-09-04): sin esto, un DNI duplicado recién se detectaba al final de
 * todo el flujo de registro (5 lecturas ICAO + parpadeo natural + desafío
 * activo, ~1-2 minutos) -- una restricción que no depende de nada
 * biométrico. `dni` es UNIQUE globalmente en auth_users (una persona, una
 * cuenta en toda la plataforma, sin importar la empresa), así que esto NO
 * se puede resolver reusando check-identity (que sí es por-empresa) -- ver
 * checkDniExistsPg, misma query exacta que el chequeo real de registerUserPg
 * para que este pre-chequeo nunca diverja del resultado final.
 */
static http::response<http::string_body> buildAuthRegisterCheckDniResponse(
    std::string dniRaw) {
  auto &cfg = AppConfig::instance();
  const std::string dni = trimAuthParam(std::move(dniRaw));
  if (dni.empty()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"ok", false}, {"reason", "bad_request"}, {"error", "Indique el DNI."}});
  }
  if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
    // Modo archivo: sin tabla auth_users, no hay nada que pre-chequear --
    // el registro real en este modo tampoco impone unicidad global de DNI.
    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", true}, {"exists", false}});
  }
#if HAS_LIBPQ
  bool exists = false;
  std::string error;
  if (!checkDniExistsPg(cfg.gDatabaseUrl, dni, exists, error)) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"ok", false},
                     {"reason", "server_error"},
                     {"error", error.empty() ? "No se pudo comprobar el DNI." : error}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{{"ok", true}, {"exists", exists}});
#else
  return makeJsonResponse(http::status::not_implemented,
                          json::object{{"error", "postgres_required"}});
#endif
}

/**
 * Pre-chequeo de username disponible ANTES de la captura facial (hallazgo
 * real 2026-09-04, mismo motivo que buildAuthRegisterCheckDniResponse de
 * arriba): reproducido en vivo -- un registro completo (5 lecturas ICAO +
 * parpadeo natural + desafío activo) recién terminaba rechazado al final
 * con "username already exists in this company". A diferencia del DNI
 * (UNIQUE global), el username es UNIQUE por empresa -- ver
 * checkUsernameExistsPg, misma query exacta que el chequeo real de
 * registerUserPg para que este pre-chequeo nunca diverja del resultado
 * final.
 */
static http::response<http::string_body> buildAuthRegisterCheckUsernameResponse(
    std::string companyRaw, std::string usernameRaw) {
  auto &cfg = AppConfig::instance();
  const std::string company = trimAuthParam(std::move(companyRaw));
  const std::string username = trimAuthParam(std::move(usernameRaw));
  if (company.empty() || username.empty()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"ok", false},
                     {"reason", "bad_request"},
                     {"error", "Indique la empresa y el usuario."}});
  }
  if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
    // Modo archivo: sin tabla auth_users, no hay nada que pre-chequear --
    // el registro real en este modo tampoco impone esta unicidad.
    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", true}, {"exists", false}});
  }
#if HAS_LIBPQ
  bool exists = false;
  std::string error;
  if (!checkUsernameExistsPg(cfg.gDatabaseUrl, company, username, exists, error)) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"ok", false},
                     {"reason", "server_error"},
                     {"error", error.empty() ? "No se pudo comprobar el usuario." : error}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{{"ok", true}, {"exists", exists}});
#else
  return makeJsonResponse(http::status::not_implemented,
                          json::object{{"error", "postgres_required"}});
#endif
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
            {"active", tenantId == session->tenantId},
            {"via", "membership"}});
      }
    }
    // db_scripts/72: concesiones de acceso cruzado (personal de organización
    // operando en tenants mineros) -- se listan aparte con via="org_grant"
    // para que TenantSwitcher.tsx pueda distinguirlas visualmente; nunca se
    // mezclan con auth_user_tenant (esa sigue siendo "membresía real").
    storage::PgResult orgRes{PQexecParams(
        conn,
        "SELECT t.tenant_id::text, t.tenant_name, oa.role "
        "FROM org_tenant_access oa JOIN tenants t ON t.tenant_id = oa.tenant_id "
        "WHERE oa.user_id = $1::uuid AND oa.active = TRUE AND oa.revoked_at IS NULL "
        "ORDER BY t.tenant_name",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (orgRes.okTuples()) {
      for (int i = 0; i < PQntuples(orgRes.get()); ++i) {
        const std::string tenantId = PQgetvalue(orgRes.get(), i, 0);
        items.push_back(json::object{
            {"tenant_id", tenantId},
            {"tenant_name", PQgetvalue(orgRes.get(), i, 1)},
            {"role", PQgetvalue(orgRes.get(), i, 2)},
            {"is_default", false},
            {"active", tenantId == session->tenantId},
            {"via", "org_grant"}});
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
                                 {"active", true},
                                 {"via", "membership"}});
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
    bool isMember = res.okTuples() && PQntuples(res.get()) > 0;
    if (isMember && !PQgetisnull(res.get(), 0, 0))
      tenantRole = PQgetvalue(res.get(), 0, 0);
    // db_scripts/72: sin membresía real, ¿tiene una concesión de acceso
    // cruzado activa (personal de organización operando en este tenant
    // minero)? Misma verificación anti-IDOR que arriba, solo que contra
    // org_tenant_access en vez de auth_user_tenant.
    if (!isMember) {
      storage::PgResult org{PQexecParams(
          conn,
          "SELECT role FROM org_tenant_access "
          "WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND active = TRUE "
          "AND revoked_at IS NULL",
          2, nullptr, p, nullptr, nullptr, 0)};
      if (org.okTuples() && PQntuples(org.get()) > 0) {
        isMember = true;
        tenantRole = PQgetvalue(org.get(), 0, 0);
      }
    }
    // Compatibilidad: si el usuario no tiene NINGUNA fila en auth_user_tenant
    // ni org_tenant_access (login tradicional por nombre de empresa),
    // permitir "cambiar" solo a su propio tenant actual — no abre ninguna
    // puerta nueva.
    const bool selfNoMembership =
        !isMember && targetTenant == session->tenantId;
    if (!isMember && !selfNoMembership) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "no_pertenece_al_tenant"}});
    }
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
  // ADR-082: el cambio de tenant emite un access token nuevo (con el tenant_id
  // nuevo en los claims) — la cookie tiene que actualizarse con él, o el
  // navegador seguiría mandando el token del tenant ANTERIOR.
  http_utils::setAccessTokenCookie(res, tokenPair.token,
                                   tokenPair.expiresInSeconds);
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
  if (!security::Validator::isValidDisplayName(firstName) ||
      !security::Validator::isValidDisplayName(lastName)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "first_name_o_last_name_invalido"}});
  }
  std::string email, phone, mobile;
  if (const auto *v = obj.if_contains("email"))  if (v->is_string()) email  = json::value_to<std::string>(*v);
  if (const auto *v = obj.if_contains("phone"))  if (v->is_string()) phone  = json::value_to<std::string>(*v);
  if (const auto *v = obj.if_contains("mobile")) if (v->is_string()) mobile = json::value_to<std::string>(*v);

  AuthUser created;
  created.id           = http_utils::makeCanonicalUuid();
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
  if (!registerUserPg(cfg.gDatabaseUrl, created, dbError, http_utils::getClientIp(req))) {
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
            {"is_default", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
            {"via", "membership"}});
    // db_scripts/72: concesiones de acceso cruzado del usuario objetivo (si
    // el operador que consulta es de un tenant de organización con
    // org.cross_tenant.manage, ver UserManagementView.tsx). Se listan aparte
    // con via="org_grant" -- nunca se mezclan con auth_user_tenant.
    storage::PgResult orgRes{PQexecParams(
        conn,
        "SELECT t.tenant_id::text, t.tenant_name, oa.role "
        "FROM org_tenant_access oa "
        "JOIN tenants t ON t.tenant_id = oa.tenant_id "
        "JOIN auth_users u ON u.id = oa.user_id "
        "WHERE u.username = $1 AND oa.active = TRUE AND oa.revoked_at IS NULL "
        "ORDER BY t.tenant_name",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (orgRes.okTuples())
      for (int i = 0; i < PQntuples(orgRes.get()); ++i)
        items.push_back(json::object{
            {"tenant_id", PQgetvalue(orgRes.get(), i, 0)},
            {"tenant_name", PQgetvalue(orgRes.get(), i, 1)},
            {"role", PQgetvalue(orgRes.get(), i, 2)},
            {"is_default", false},
            {"via", "org_grant"}});
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

// Rediseño de avatar (2026-09-20, ADR-203): catálogo fijo de cuerpo/
// vestimenta -- MISMA lista que el CHECK de auth_users.avatar_body_template_slug
// (db_scripts/113_avatar_body_template.sql) y que TEMPLATES en
// ai_engine/avatar_body_templates.py. Si se agrega/renombra una plantilla,
// las tres deben cambiar juntas.
// Catálogo reducido a solo fotos reales (pedido explícito del usuario,
// 2026-09-21: "eliminar todas las camisetas y solo se quede amarilla con
// brazos... añadir las siguientes vestimentas"). Se elimina TODO el catálogo
// anterior (procedural + fotos reales previas) salvo camiseta_amarilla_brazos_real,
// y se agregan 8 prendas nuevas de foto real -- ver
// ai_engine/avatar_body_templates.py::REAL_GARMENT_ASSETS para la extracción
// (GrabCut) y el detalle de cada una.
static constexpr std::array<const char *, 9> kAvatarBodyTemplateSlugs = {
    "camiseta_amarilla_brazos_real",
    "camiseta_diagonal_roja_real", "camiseta_amarilla_verde_real",
    "camiseta_celeste_rayas_real", "camiseta_crema_marron_real",
    "camiseta_marino_rayas_real", "camiseta_celeste_real",
    "chaqueta_electronica_real", "chaleco_geologo_real"};

static bool isValidAvatarBodyTemplateSlug(const std::string &slug) {
  return std::any_of(kAvatarBodyTemplateSlugs.begin(),
                     kAvatarBodyTemplateSlugs.end(),
                     [&](const char *s) { return slug == s; });
}

static bool isSafeAvatarUserId(const std::string &userId) {
  return !userId.empty() && userId.size() <= 128 &&
         std::all_of(userId.begin(), userId.end(), [](unsigned char c) {
           return std::isalnum(c) || c == '-' || c == '_';
         });
}

static std::optional<AuthUser> findCurrentAvatarUser(
    const AppConfig &cfg, const std::string &dataRoot,
    const std::string &userId) {
  if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    return findUserByIdPg(cfg.gDatabaseUrl, userId);
#else
    return std::nullopt;
#endif
  }

  const auto users = loadAuthUsers(dataRoot);
  const auto it = std::find_if(users.begin(), users.end(),
                               [&](const AuthUser &u) {
                                 return u.id == userId;
                               });
  return it == users.end() ? std::nullopt
                           : std::optional<AuthUser>(*it);
}

/** GET /api/auth/avatar/thumb
 * Miniatura (base64) del avatar del usuario de la sesión, o `pending` si
 * todavía no existe.
 *
 * Existe por un problema real reportado tras un registro (2026-09-04): el
 * avatar se genera en un hilo detached posterior al alta
 * (AUTH_REGISTER_CARTOON_BG en main.cpp, 15-40 s entre los 3 niveles de
 * fallback y las 3 seeds de difusión), así que la respuesta de
 * /api/auth/register sale SIN avatar a propósito -- para no bloquear el
 * alta. Pero el frontend guardaba esa sesión en localStorage y no volvía a
 * consultar nunca: el usuario recién registrado veía el placeholder de
 * iniciales durante toda su primera sesión, y el avatar recién aparecía
 * tras cerrar sesión y volver a entrar (el login sí lee la fila ya
 * actualizada). Este endpoint permite al cliente completar la sesión en
 * cuanto el avatar está listo, sin re-login.
 *
 * Mismas garantías que /api/auth/avatar/hd: resuelve por sesión, nunca por
 * un user_id del cliente (evita IDOR), y revalida que el usuario siga
 * activo antes de devolver nada.
 */
static http::response<http::string_body> handleMyAvatarThumb(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!isSafeAvatarUserId(session->userId)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_user_id"}});
  }
  auto &cfg = AppConfig::instance();
  const std::string dataRoot =
      config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const auto user = findCurrentAvatarUser(cfg, dataRoot, session->userId);
  if (!user) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "avatar_not_available"}});
  }
  if (user->avatarCartoonBase64.empty()) {
    // 200 + "pending", no 404: la ausencia es un estado legítimo y esperado
    // durante los primeros segundos de vida de la cuenta, no un error que
    // el cliente deba tratar como fallo.
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "pending"}});
  }
  return makeJsonResponse(
      http::status::ok,
      json::object{{"status", "ready"},
                   {"avatar_cartoon_base64", user->avatarCartoonBase64},
                   // Rediseño de avatar (2026-09-20, ADR-203): permite al
                   // selector de vestimenta del frontend marcar la plantilla
                   // ACTUAL sin una llamada aparte. Vacío en cuentas
                   // anteriores a este cambio.
                   {"avatar_body_template_slug", user->avatarBodyTemplateSlug}});
}

/** GET /api/auth/avatar/hd
 * Devuelve exclusivamente el avatar del usuario de la sesión. Nunca acepta
 * un user_id del cliente: evita IDOR y mantiene el derivado biométrico privado.
 * Los registros nuevos ya dejan un máster local 2880x3840; para usuarios
 * anteriores se crea una única vez una ampliación Lanczos desde su miniatura.
 */
static http::response<http::string_body> handleMyAvatarHd(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!isSafeAvatarUserId(session->userId)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_user_id"}});
  }

  auto &cfg = AppConfig::instance();
  const std::string dataRoot =
      config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const std::filesystem::path hdDir =
      std::filesystem::path(dataRoot) / "auth" / "avatars_hd";
  const std::filesystem::path hdPath = hdDir / (session->userId + ".png");

  try {
    std::scoped_lock lk(gAvatarHdMutex);
    // Revalidar que el usuario siga activo antes de servir incluso un archivo
    // ya cacheado; un JWT aún no expirado no debe recuperar la foto después
    // de una baja administrativa.
    const auto user =
        findCurrentAvatarUser(cfg, dataRoot, session->userId);
    if (!user) {
      return makeJsonResponse(
          http::status::not_found,
          json::object{{"error", "avatar_not_available"}});
    }
    if (std::filesystem::is_regular_file(hdPath)) {
      const auto fileSize = std::filesystem::file_size(hdPath);
      if (fileSize > 0 && fileSize <= 32U * 1024U * 1024U) {
        std::ifstream in(hdPath, std::ios::binary);
        std::string png((std::istreambuf_iterator<char>(in)),
                        std::istreambuf_iterator<char>());
        if (!png.empty()) return makePngResponse(std::move(png));
      }
    }

    if (user->avatarCartoonBase64.empty()) {
      return makeJsonResponse(
          http::status::not_found,
          json::object{{"error", "avatar_not_available"}});
    }

    std::vector<unsigned char> encodedThumb;
    if (!biometric::decodeBase64(user->avatarCartoonBase64, encodedThumb)) {
      return makeJsonResponse(
          http::status::unprocessable_entity,
          json::object{{"error", "avatar_thumbnail_invalid"}});
    }
    const cv::Mat thumb =
        cv::imdecode(encodedThumb, cv::IMREAD_COLOR);
    if (thumb.empty()) {
      return makeJsonResponse(
          http::status::unprocessable_entity,
          json::object{{"error", "avatar_thumbnail_invalid"}});
    }

    cv::Mat hd;
    cv::resize(thumb, hd, cv::Size(2880, 3840), 0.0, 0.0,
               cv::INTER_LANCZOS4);
    cv::Mat softened;
    cv::GaussianBlur(hd, softened, cv::Size(), 1.1);
    cv::addWeighted(hd, 1.08, softened, -0.08, 0.0, hd);

    std::vector<unsigned char> encodedHd;
    const std::vector<int> pngParams = {
        cv::IMWRITE_PNG_COMPRESSION, 5};
    if (!cv::imencode(".png", hd, encodedHd, pngParams)) {
      throw std::runtime_error("No se pudo codificar el avatar HD.");
    }

    std::filesystem::create_directories(hdDir);
    const auto tempPath = hdPath.string() + ".tmp";
    {
      std::ofstream out(tempPath, std::ios::binary | std::ios::trunc);
      out.write(reinterpret_cast<const char *>(encodedHd.data()),
                static_cast<std::streamsize>(encodedHd.size()));
      if (!out) {
        throw std::runtime_error("No se pudo persistir el avatar HD.");
      }
    }
    if (std::filesystem::exists(hdPath)) {
      std::filesystem::remove(hdPath);
    }
    std::filesystem::rename(tempPath, hdPath);
    std::filesystem::permissions(
        hdPath,
        std::filesystem::perms::owner_read |
            std::filesystem::perms::owner_write,
        std::filesystem::perm_options::replace);
    return makePngResponse(std::string(
        reinterpret_cast<const char *>(encodedHd.data()), encodedHd.size()));
  } catch (const std::exception &ex) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"error", "avatar_hd_generation_failed"},
                     {"detail", ex.what()}});
  }
}

// ── Cuerpo/vestimenta del avatar (rediseño 2026-09-20, ADR-203) ────────────
// El avatar recorta solo la cabeza; el resto viene de un catálogo fijo de
// plantillas pre-hechas (ai_engine/avatar_body_templates.py) en vez de los
// hombros/torso fotografiados -- ver el módulo Python para el razonamiento
// completo (evitar depender de segmentar hombros/ropa reales).

/** GET /api/avatar/body-templates
 * Catálogo de cuerpo/vestimenta -- requiere sesión válida (evita scraping
 * anónimo) pero el catálogo en sí es el mismo para cualquier cuenta; la
 * sesión solo sirve para marcar cuál es la plantilla ACTUAL del usuario. */
static http::response<http::string_body> handleListAvatarBodyTemplates(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  auto &cfg = AppConfig::instance();
  const std::string dataRoot =
      config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const auto user = findCurrentAvatarUser(cfg, dataRoot, session->userId);
  const std::string currentSlug = user ? user->avatarBodyTemplateSlug : std::string();
  const bool headAvailable = isSafeAvatarUserId(session->userId) &&
      std::filesystem::is_regular_file(std::filesystem::path(dataRoot) /
                                       "auth" / "avatar_heads" /
                                       (session->userId + ".png"));

  const auto templates = biometric::listAvatarBodyTemplatesFromAiEngine();
  json::array arr;
  for (const auto &t : templates) {
    arr.push_back(json::object{
        {"slug", t.slug},
        {"display_name", t.displayName},
        {"thumbnail_base64", t.thumbnailBase64},
        {"current", !currentSlug.empty() && t.slug == currentSlug},
    });
  }
  return makeJsonResponse(http::status::ok,
                          json::object{{"ok", true},
                                       {"avatar_head_available", headAvailable},
                                       {"templates", arr}});
}

/** POST /api/auth/avatar/body-template  body: {"slug": "..."}
 * "Cambiar de vestimenta": recompone el avatar contra otra plantilla SIN
 * volver a correr difusión ni detección de rostro -- reusa el recorte de
 * cabeza ya persistido en el registro
 * (/data/auth/avatar_heads/{userId}.png, ver main.cpp). 409 si esa cuenta
 * todavía no tiene ese recorte (avatar generado antes de este cambio, o los
 * 3 niveles de fallback cayeron al lienzo blanco clásico sin cabeza
 * aislable) -- requiere regenerar el avatar (reenrolarse) antes de poder
 * usar esta función. */
static http::response<http::string_body> handleUpdateAvatarBodyTemplate(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!isSafeAvatarUserId(session->userId)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_user_id"}});
  }

  std::string slug;
  try {
    auto payload = json::parse(req.body());
    if (payload.is_object()) {
      const auto &obj = payload.as_object();
      if (obj.if_contains("slug") && obj.at("slug").is_string()) {
        slug = json::value_to<std::string>(obj.at("slug"));
      }
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!isValidAvatarBodyTemplateSlug(slug)) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "invalid_body_template_slug"}});
  }

  auto &cfg = AppConfig::instance();
  const std::string dataRoot =
      config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const std::filesystem::path headPath = std::filesystem::path(dataRoot) /
                                         "auth" / "avatar_heads" /
                                         (session->userId + ".png");

  std::scoped_lock lk(gAvatarHdMutex);

  std::ifstream headIn(headPath, std::ios::binary);
  if (!headIn.is_open()) {
    return makeJsonResponse(
        http::status::conflict,
        json::object{{"error", "avatar_head_not_available"}});
  }
  std::vector<unsigned char> headBytes(
      (std::istreambuf_iterator<char>(headIn)),
      std::istreambuf_iterator<char>());
  headIn.close();
  if (headBytes.empty()) {
    return makeJsonResponse(
        http::status::conflict,
        json::object{{"error", "avatar_head_not_available"}});
  }

  auto recomposed =
      biometric::recomposeAvatarBodyTemplateOnAiEngine(headBytes, slug);
  if (!recomposed.ok()) {
    return makeJsonResponse(
        http::status::service_unavailable,
        json::object{{"error", "avatar_recompose_failed"},
                     {"detail", recomposed.error}});
  }

  std::vector<unsigned char> hdBytes;
  if (!recomposed.imageHdBase64.empty() &&
      biometric::decodeBase64(recomposed.imageHdBase64, hdBytes) &&
      !hdBytes.empty()) {
    try {
      const std::filesystem::path hdDir =
          std::filesystem::path(dataRoot) / "auth" / "avatars_hd";
      std::filesystem::create_directories(hdDir);
      const std::filesystem::path finalPath = hdDir / (session->userId + ".png");
      const std::filesystem::path tmpPath = hdDir / (session->userId + ".png.tmp");
      {
        std::ofstream out(tmpPath, std::ios::binary | std::ios::trunc);
        out.write(reinterpret_cast<const char *>(hdBytes.data()),
                  static_cast<std::streamsize>(hdBytes.size()));
        if (!out.good()) {
          throw std::runtime_error("avatar_hd_write_failed");
        }
      }
      if (std::filesystem::exists(finalPath)) {
        std::filesystem::remove(finalPath);
      }
      std::filesystem::rename(tmpPath, finalPath);
      std::filesystem::permissions(
          finalPath,
          std::filesystem::perms::owner_read |
              std::filesystem::perms::owner_write,
          std::filesystem::perm_options::replace);
    } catch (const std::exception &ex) {
      std::cerr << "[AVATAR_BODY_TEMPLATE] hd: " << ex.what() << std::endl;
    }
  }

  std::string storeErr;
  bool stored = false;
  if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    stored = updateUserAvatarBodyTemplatePg(cfg.gDatabaseUrl, session->userId,
                                            slug, recomposed.imageBase64,
                                            storeErr);
#else
    storeErr = "postgres_not_linked";
#endif
  } else {
    stored = updateUserAvatarBodyTemplateFile(dataRoot, session->userId, slug,
                                              recomposed.imageBase64);
  }
  if (!stored) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"error", "avatar_body_template_store_failed"},
                     {"detail", storeErr}});
  }

  return makeJsonResponse(
      http::status::ok,
      json::object{{"status", "ok"},
                   {"avatar_body_template_slug", slug},
                   {"avatar_cartoon_base64", recomposed.imageBase64}});
}

/** POST /api/auth/avatar/re-enroll  body: {"image_base64": "..."}
 * "Actualizar mi foto de avatar": permite a una cuenta YA registrada volver a
 * generar su avatar caricaturizado a partir de una foto nueva, sin pasar por
 * todo el registro de nuevo. Pedido real del usuario (2026-09-20): tras el
 * rediseño de avatar (ADR-203, recorte de cabeza + plantilla de cuerpo), TODA
 * cuenta creada antes de ese cambio quedó sin recorte de cabeza persistido
 * (/data/auth/avatar_heads/{userId}.png nunca existió para ellas) porque solo
 * el registro corre /cartoon_avatar -- el selector de "cambiar vestimenta"
 * les devuelve 409 avatar_head_not_available para siempre si no hay una vía
 * para regenerar. Solo pide una foto (getUserMedia + captura simple, sin el
 * reto de vivacidad del login/registro): esto es puramente cosmético, no
 * reemplaza ni reverifica la identidad biométrica de la cuenta, así que no
 * necesita el mismo rigor anti-spoofing que login/registro.
 * Reusa fetchCartoonAvatarBestEffort (misma función que el registro) y el
 * mismo patrón tmp+rename para avatars_hd/avatar_heads que main.cpp. */
static http::response<http::string_body> handleReEnrollAvatar(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!isSafeAvatarUserId(session->userId)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_user_id"}});
  }

  std::string imagePayload;
  try {
    auto payload = json::parse(req.body());
    if (payload.is_object()) {
      const auto &obj = payload.as_object();
      if (obj.if_contains("image_base64") && obj.at("image_base64").is_string()) {
        imagePayload = biometric::stripDataUrlBase64(
            json::value_to<std::string>(obj.at("image_base64")));
      }
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  std::vector<unsigned char> imageBytes;
  if (imagePayload.empty() ||
      !biometric::decodeBase64(imagePayload, imageBytes) ||
      imageBytes.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_image"}});
  }

  auto &cfg = AppConfig::instance();
  const std::string dataRoot =
      config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const bool avatarForceClassic = !cfg.isAvatarDiffusionQaUser(session->username);

  std::scoped_lock lk(gAvatarHdMutex);

  auto cartoon = biometric::fetchCartoonAvatarBestEffort(imageBytes, avatarForceClassic, "fast");
  if (!cartoon.ok()) {
    return makeJsonResponse(
        http::status::service_unavailable,
        json::object{{"error", "avatar_generation_failed"},
                     {"detail", cartoon.error}});
  }

  if (!cartoon.imageHdBase64.empty()) {
    std::vector<unsigned char> hdBytes;
    if (biometric::decodeBase64(cartoon.imageHdBase64, hdBytes) && !hdBytes.empty()) {
      try {
        const std::filesystem::path hdDir =
            std::filesystem::path(dataRoot) / "auth" / "avatars_hd";
        std::filesystem::create_directories(hdDir);
        const std::filesystem::path finalPath = hdDir / (session->userId + ".png");
        const std::filesystem::path tmpPath = hdDir / (session->userId + ".png.tmp");
        {
          std::ofstream out(tmpPath, std::ios::binary | std::ios::trunc);
          out.write(reinterpret_cast<const char *>(hdBytes.data()),
                    static_cast<std::streamsize>(hdBytes.size()));
          if (!out.good()) {
            throw std::runtime_error("avatar_hd_write_failed");
          }
        }
        if (std::filesystem::exists(finalPath)) {
          std::filesystem::remove(finalPath);
        }
        std::filesystem::rename(tmpPath, finalPath);
        std::filesystem::permissions(
            finalPath,
            std::filesystem::perms::owner_read |
                std::filesystem::perms::owner_write,
            std::filesystem::perm_options::replace);
      } catch (const std::exception &ex) {
        std::cerr << "[AVATAR_RE_ENROLL] hd: " << ex.what() << std::endl;
      }
    }
  }

  if (!cartoon.headCutoutBase64.empty()) {
    std::vector<unsigned char> headBytes;
    if (biometric::decodeBase64(cartoon.headCutoutBase64, headBytes) && !headBytes.empty()) {
      try {
        const std::filesystem::path headDir =
            std::filesystem::path(dataRoot) / "auth" / "avatar_heads";
        std::filesystem::create_directories(headDir);
        const std::filesystem::path finalPath = headDir / (session->userId + ".png");
        const std::filesystem::path tmpPath = headDir / (session->userId + ".png.tmp");
        {
          std::ofstream out(tmpPath, std::ios::binary | std::ios::trunc);
          out.write(reinterpret_cast<const char *>(headBytes.data()),
                    static_cast<std::streamsize>(headBytes.size()));
          if (!out.good()) {
            throw std::runtime_error("avatar_head_write_failed");
          }
        }
        if (std::filesystem::exists(finalPath)) {
          std::filesystem::remove(finalPath);
        }
        std::filesystem::rename(tmpPath, finalPath);
        std::filesystem::permissions(
            finalPath,
            std::filesystem::perms::owner_read |
                std::filesystem::perms::owner_write,
            std::filesystem::perm_options::replace);
      } catch (const std::exception &ex) {
        std::cerr << "[AVATAR_RE_ENROLL] head: " << ex.what() << std::endl;
      }
    }
  }

  std::string storeErr;
  bool stored = false;
  if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    stored = updateUserAvatarCartoonPg(cfg.gDatabaseUrl, session->userId,
                                       cartoon.imageBase64, session->username,
                                       session->company, session->token,
                                       storeErr);
#else
    storeErr = "postgres_not_linked";
#endif
  } else {
    stored = updateUserAvatarCartoonFile(dataRoot, session->userId,
                                         cartoon.imageBase64);
  }
  if (!stored) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"error", "avatar_store_failed"}, {"detail", storeErr}});
  }

  return makeJsonResponse(
      http::status::ok,
      json::object{{"status", "ok"}, {"avatar_cartoon_base64", cartoon.imageBase64}});
}

// ── Avatar ANIMADO (ADR-150, integración a producto) ───────────────────────
// Job async (nunca corre SadTalker dentro del request -- 200-300s reales
// medidos, mismo razonamiento ADR-023 ya aplicado a report_export_jobs.cpp).

/** POST /api/auth/avatar/animation
 * Crea el job en 'queued' y dispara el worker en un hilo de fondo. Body JSON
 * opcional: {"kind": "welcome"|"onboarding"|"report"|"kpi"|"alarm_loop"}
 * (default "welcome"; welcome/onboarding/report/alarm_loop cableados a
 * producto desde ADR-164, "kpi" sigue sin disparador real en la UI -- ver
 * defaultScriptForKind en avatar_animation_job.cpp),
 * {"text": "..."} (guion para TTS local; si se omite, guion por defecto
 * según kind), {"transparent_bg": bool} (default true). */
static http::response<http::string_body> handleCreateAvatarAnimation(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (!isSafeAvatarUserId(session->userId)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_user_id"}});
  }
  if (AppConfig::instance().gAvatarAnimationEngineUrl.empty()) {
    return makeJsonResponse(http::status::service_unavailable,
                            json::object{{"error", "avatar_animation_disabled"}});
  }

  std::string kind = "welcome";
  std::string text;
  bool transparentBg = true;
  try {
    if (!req.body().empty()) {
      auto payload = json::parse(req.body());
      if (payload.is_object()) {
        const auto &obj = payload.as_object();
        if (obj.if_contains("kind") && obj.at("kind").is_string()) {
          kind = json::value_to<std::string>(obj.at("kind"));
        }
        if (obj.if_contains("text") && obj.at("text").is_string()) {
          text = json::value_to<std::string>(obj.at("text"));
        }
        if (obj.if_contains("transparent_bg") && obj.at("transparent_bg").is_bool()) {
          transparentBg = obj.at("transparent_bg").as_bool();
        }
      }
    }
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_body"}});
  }
  static const std::set<std::string> kValidKinds = {
      "welcome", "onboarding", "report", "kpi", "alarm_loop"};
  if (!kValidKinds.count(kind)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_kind"}});
  }

  // Guard anti-duplicado real (hallazgo sesión 2026-09-09, ver comentario en
  // avatar_animation_storage_pg.hpp): pase lo que pase del lado del cliente
  // (remonte del widget, doble click, lo que sea), nunca lanzar un segundo
  // SadTalker real mientras uno para el mismo (userId, kind) ya está
  // 'queued'/'running' -- se devuelve el job existente en vez de crear otro.
  {
    AvatarAnimationJob inProgress;
    if (findInProgressAvatarAnimationJobPg(AppConfig::instance().gDatabaseUrl,
                                           session->userId, kind, inProgress)) {
      return makeJsonResponse(
          http::status::accepted,
          json::object{{"job_id", inProgress.jobId}, {"status", inProgress.status}});
    }
  }

  // Cache de video (hallazgo real, sesión 2026-09-09: usuario reportó ~4 min
  // de espera en CADA login para el mismo saludo). El guion por defecto de
  // cada kind es fijo (defaultScriptForKind, avatar_animation_job.cpp) --
  // sin `text` custom, el resultado es el mismo mientras no cambie el
  // avatar HD fuente. Reusar el último job exitoso evita pagar los ~227s
  // reales de SadTalker+matting otra vez; el archivo de video se compara
  // contra la fecha del avatar HD en disco para invalidar el cache
  // automáticamente si el usuario regeneró su avatar después.
  if (text.empty()) {
    AvatarAnimationJob cached;
    if (findLatestSuccessfulAvatarAnimationJobPg(AppConfig::instance().gDatabaseUrl,
                                                  session->userId, kind, cached)) {
      try {
        const std::string dataRoot =
            config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
        const std::filesystem::path videoPath(cached.storageUri);
        const std::filesystem::path avatarHdPath =
            std::filesystem::path(dataRoot) / "auth" / "avatars_hd" /
            (session->userId + ".png");
        if (std::filesystem::is_regular_file(videoPath)) {
          const auto videoTime = std::filesystem::last_write_time(videoPath);
          bool stillFresh = true;
          if (std::filesystem::is_regular_file(avatarHdPath)) {
            stillFresh = std::filesystem::last_write_time(avatarHdPath) <= videoTime;
          }
          if (stillFresh) {
            return makeJsonResponse(
                http::status::accepted,
                json::object{{"job_id", cached.jobId}, {"status", "success"}, {"cached", true}});
          }
        }
      } catch (const std::exception &) {
        // Cualquier error de filesystem (permisos, path raro) -- degrada a
        // generar uno nuevo, nunca bloquea al usuario por el cache.
      }
    }
  }

  std::string jobId, error;
  if (!createAvatarAnimationJobPg(AppConfig::instance().gDatabaseUrl, session->userId,
                                  session->tenantId, kind, jobId, error)) {
    // Diagnóstico real (hallazgo sesión 2026-09-08): este 500 se reproducía
    // en vivo (3 intentos reales en el log de nginx) sin ningún rastro en
    // los logs del backend -- el detalle solo viajaba al cliente en el JSON
    // de error, nunca a stderr. Logueado acá para no repetir esa
    // investigación a ciegas la próxima vez.
    std::cerr << "[AVATAR_ANIMATION] createAvatarAnimationJobPg falló userId="
              << session->userId << " tenantId='" << session->tenantId
              << "' kind=" << kind << " error=" << error << std::endl;
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{{"error", "avatar_animation_job_create_failed"}, {"detail", error}});
  }

  std::thread(runAvatarAnimationJob, jobId, session->userId, kind, text, transparentBg)
      .detach();

  return makeJsonResponse(http::status::accepted,
                          json::object{{"job_id", jobId}, {"status", "queued"}});
}

/** GET /api/auth/avatar/animation/{jobId}[/download]
 * Polling (shape pending/ready, mismo criterio que handleMyAvatarThumb) y
 * descarga del video/WebM final. Job SIEMPRE filtrado por el userId de la
 * sesión (guard IDOR, mismo criterio que handleMyAvatarHd) -- nunca por un
 * user_id del cliente. */
static http::response<http::string_body> handleGetAvatarAnimation(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }

  const std::string path = routePathOnly(std::string(req.target()));
  static const std::string kPrefix = "/api/auth/avatar/animation/";
  if (path.size() <= kPrefix.size() || path.compare(0, kPrefix.size(), kPrefix) != 0) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "missing_job_id"}});
  }
  std::string rest = path.substr(kPrefix.size());
  static const std::string kDownloadSuffix = "/download";
  bool wantsDownload = false;
  if (rest.size() > kDownloadSuffix.size() &&
      rest.compare(rest.size() - kDownloadSuffix.size(), kDownloadSuffix.size(),
                  kDownloadSuffix) == 0) {
    wantsDownload = true;
    rest = rest.substr(0, rest.size() - kDownloadSuffix.size());
  }
  if (rest.empty() || rest.find('/') != std::string::npos) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "missing_job_id"}});
  }

  AvatarAnimationJob job;
  std::string error;
  if (!getAvatarAnimationJobPg(AppConfig::instance().gDatabaseUrl, rest, session->userId, job,
                               error)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
  }

  if (!wantsDownload) {
    return makeJsonResponse(
        http::status::ok,
        json::object{{"job_id", job.jobId},   {"kind", job.kind},
                     {"status", job.status},   {"error_message", job.errorMessage},
                     {"created_at", job.createdAt}, {"started_at", job.startedAt},
                     {"completed_at", job.completedAt}});
  }

  if (job.status != "success" || job.storageUri.empty()) {
    return makeJsonResponse(http::status::conflict,
                            json::object{{"error", "avatar_animation_job_not_ready"}});
  }
  std::ifstream ifs(job.storageUri, std::ios::binary);
  if (!ifs) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "avatar_animation_file_missing"}});
  }
  std::string bytes((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  const bool isWebm = job.storageUri.size() >= 5 &&
      job.storageUri.compare(job.storageUri.size() - 5, 5, ".webm") == 0;
  // NO usar makeOctetResponse acá (hallazgo real, sesión 2026-09-09): pone
  // Content-Type: application/octet-stream a propósito para descargas
  // genéricas (informes/exports, ver report_routes.cpp) -- pero
  // fetchAvatarAnimationVideo() en el frontend (authApi.ts) valida
  // `blob.type.startsWith('video/')` antes de aceptar la respuesta, así que
  // CADA descarga fallaba esa validación pese a que el archivo bajaba
  // perfectamente bien (200 OK, bytes reales) -- el widget nunca podía
  // mostrar un video ya generado con éxito, reintentando en un bucle hasta
  // agotar el sondeo. Respuesta propia con el Content-Type real del video.
  http::response<http::string_body> res{http::status::ok, 11};
  res.set(http::field::content_type, isWebm ? "video/webm" : "video/mp4");
  res.set(http::field::content_disposition,
         "inline; filename=\"avatar_animado" + std::string(isWebm ? ".webm" : ".mp4") + "\"");
  res.set("X-Content-Type-Options", "nosniff");
  res.body() = std::move(bytes);
  res.prepare_payload();
  return res;
}

// /api/auth/companies/{company_id} — mismo patrón que usernameFromTenantsPath:
// corta el prefijo y descarta query string. No valida forma de UUID aquí; un
// id inválido simplemente no matchea el ::uuid cast en SQL y la función de
// storage devuelve "company_not_found" — la ruta de error queda igual de
// clara sin duplicar la validación.
// ADR-121: mismo motivo que jsonToDoubleSafe en device_alarm_routes.cpp -- un
// número JSON sin parte decimal (p.ej. "latitude": -17) llega como
// is_int64(), no is_double(); json::value_to<double> directo lanzaría.
static bool jsonToDoubleSafe(const json::value &v, double &out) {
  if (v.is_double()) { out = v.as_double(); return true; }
  if (v.is_int64()) { out = static_cast<double>(v.as_int64()); return true; }
  if (v.is_uint64()) { out = static_cast<double>(v.as_uint64()); return true; }
  return false;
}

std::string companyIdFromPath(const std::string &target) {
  static const std::string kPrefix = "/api/auth/companies/";
  if (target.rfind(kPrefix, 0) != 0) return "";
  std::string rest = target.substr(kPrefix.size());
  const auto q = rest.find('?');
  if (q != std::string::npos) rest = rest.substr(0, q);
  return rest;
}

json::object companyRecordToJsonValue(const AuthCompanyRecord &c) {
  return json::object{{"company_id", c.companyId},
                      {"name", c.name},
                      {"ruc", c.ruc},
                      {"country_code", c.countryCode},
                      {"domicilio_fiscal", c.domicilioFiscal},
                      {"tenant_id", c.tenantId},
                      {"active", c.active},
                      {"demo_data", c.demoData},
                      {"created_at", c.createdAt},
                      {"updated_at", c.updatedAt},
                      {"updated_by", c.updatedBy},
                      {"latitude", c.latitude ? json::value(*c.latitude) : json::value(nullptr)},
                      {"longitude", c.longitude ? json::value(*c.longitude) : json::value(nullptr)},
                      {"location_zoom", c.locationZoom ? json::value(*c.locationZoom) : json::value(nullptr)},
                      {"company_type", c.companyType}};
}

void registerRoutes(router::Router &r) {
  auto &cfg = AppConfig::instance();

  // GET /api/auth/companies[?country=EC] — el filtro por país es opcional y
  // aditivo: sin el query param el comportamiento es idéntico al de antes
  // (todas las empresas activas), para no romper el frontend actual que ya
  // consume este endpoint. Con el filtro, soporta el selector país+empresa
  // multitenant/multiregión (ver docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md).
  r.get("/api/auth/companies",
        [&cfg](const http::request<http::string_body> &,
               const std::unordered_map<std::string, std::string> &query) {
          json::array companies;
          bool loadedFromDb = false;
          std::string countryFilter;
          if (query.count("country")) {
            countryFilter = trimAuthParam(query.at("country"));
            std::transform(countryFilter.begin(), countryFilter.end(),
                           countryFilter.begin(), ::toupper);
          }
          if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
            auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
            PGconn *conn = __pg_lease.get();
            if (PQstatus(conn) == CONNECTION_OK) {
              (void)ensureAuthSchemaPg(conn);
              PGresult *res = nullptr;
              if (!countryFilter.empty()) {
                const char *p[1] = {countryFilter.c_str()};
                res = PQexecParams(
                    conn,
                    "SELECT name FROM auth_companies "
                    "WHERE active=true AND country_code=$1 ORDER BY name ASC",
                    1, nullptr, p, nullptr, nullptr, 0);
              } else {
                res = PQexec(
                    conn,
                    "SELECT name FROM auth_companies WHERE active=true "
                    "ORDER BY name ASC");
              }
              if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
                for (int i = 0; i < PQntuples(res); ++i) {
                  companies.push_back(
                      json::value(std::string(PQgetvalue(res, i, 0))));
                }
                loadedFromDb = PQntuples(res) > 0 || !countryFilter.empty();
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

  // POST /api/auth/companies — catálogo administrado y tenant real (ADR-078,
  // extendido por ADR-085/086: RUC opcional + gate por permiso granular en
  // vez del `role=="admin"` hardcodeado original).
  // La deduplicación case-insensitive evita duplicados de razón social por
  // mayúsculas/espacios — ahora respaldada por un índice único
  // (ux_auth_companies_name_norm, db_scripts/50) que cierra la condición de
  // carrera que tenía el SELECT+INSERT original.
  r.post("/api/auth/companies",
         [&cfg](const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
           const auto session = resolveAuthSession(req, query);
           if (!session) {
             return makeJsonResponse(http::status::unauthorized,
                                     json::object{{"error", "unauthorized"}});
           }
           if (!hasPermission(session->userId, session->tenantId,
                              session->role, "empresas.manage")) {
             return makeJsonResponse(
                 http::status::forbidden,
                 json::object{{"error", "forbidden"}, {"need", "empresas.manage"}});
           }
           if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
             return makeJsonResponse(
                 http::status::not_implemented,
                 json::object{{"error", "postgres_required"}});
           }
#if HAS_LIBPQ
           try {
             const auto parsed = json::parse(req.body());
             if (!parsed.is_object()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"error", "invalid_company_payload"}});
             }
             const auto &obj = parsed.as_object();
             const auto *nameValue = obj.if_contains("name");
             if (!nameValue || !nameValue->is_string()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"error", "company_name_required"}});
             }
             const std::string name =
                 trimAuthParam(json::value_to<std::string>(*nameValue));
             if (name.size() < 2 || name.size() > 180 ||
                 !security::Validator::isValidDisplayName(name, 180)) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"error", "company_name_invalid"}});
             }
             std::string country = "PE";
             if (const auto *v = obj.if_contains("country"))
               if (v->is_string()) country = json::value_to<std::string>(*v);
             std::string ruc;
             if (const auto *v = obj.if_contains("ruc"))
               if (v->is_string()) ruc = normalizeTaxId(json::value_to<std::string>(*v));
             if (!ruc.empty() && !validateTaxIdChecksum(ruc, country)) {
               return makeJsonResponse(http::status::bad_request,
                                       json::object{{"error", "ruc_invalido"}});
             }
             std::string domicilioFiscal;
             if (const auto *v = obj.if_contains("domicilio_fiscal"))
               if (v->is_string()) domicilioFiscal = json::value_to<std::string>(*v);

             // db_scripts/72: clasificación minera/organización -- default
             // 'mining_client' si no viene o viene con un valor no reconocido
             // (nunca se rechaza el alta por esto, es un dato de clasificación,
             // no un campo de seguridad en sí mismo).
             std::string companyType = "mining_client";
             if (const auto *v = obj.if_contains("company_type"))
               if (v->is_string()) {
                 const std::string ct = json::value_to<std::string>(*v);
                 if (ct == "organization") companyType = "organization";
               }

             // ADR-121: latitude/longitude viajan juntas o ninguna -- no tiene
             // sentido persistir solo una mitad de una coordenada.
             std::optional<double> latitude, longitude;
             std::optional<int> locationZoom;
             {
               double latVal = 0, lonVal = 0;
               const bool hasLat = obj.if_contains("latitude") &&
                                   jsonToDoubleSafe(*obj.if_contains("latitude"), latVal);
               const bool hasLon = obj.if_contains("longitude") &&
                                   jsonToDoubleSafe(*obj.if_contains("longitude"), lonVal);
               if (obj.if_contains("latitude") || obj.if_contains("longitude")) {
                 if (!hasLat || !hasLon) {
                   return makeJsonResponse(
                       http::status::bad_request,
                       json::object{{"error", "latitude_longitude_pair_required"}});
                 }
                 if (latVal < -90 || latVal > 90 || lonVal < -180 || lonVal > 180) {
                   return makeJsonResponse(
                       http::status::bad_request,
                       json::object{{"error", "coordinates_out_of_range"}});
                 }
                 latitude = latVal;
                 longitude = lonVal;
                 if (const auto *v = obj.if_contains("location_zoom")) {
                   double z = 0;
                   if (jsonToDoubleSafe(*v, z) && z >= 0 && z <= 22)
                     locationZoom = static_cast<int>(z);
                 }
               }
             }

             AuthCompanyRecord created;
             std::string createError;
             if (!createCompanyPg(cfg.gDatabaseUrl, name, ruc, country,
                                  domicilioFiscal, latitude, longitude,
                                  locationZoom, session->userId,
                                  session->role, created, createError,
                                  companyType)) {
               if (createError == "company_already_exists" ||
                   createError == "ruc_already_exists") {
                 return makeJsonResponse(
                     http::status::conflict,
                     json::object{{"error", createError}});
               }
               return makeJsonResponse(
                   http::status::internal_server_error,
                   json::object{{"error", "company_create_failed"},
                                {"detail", createError}});
             }

             auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
             PGconn *conn = lease.get();
             if (PQstatus(conn) == CONNECTION_OK) {
               appendAuthAuditLogPg(conn, "company_create", session->company,
                                    session->username, true, name,
                                    std::nullopt, std::nullopt, std::nullopt,
                                    http_utils::getClientIp(req));
             }
             return makeJsonResponse(http::status::created,
                                     json::object{{"company", created.name},
                                                  {"tenant_id", created.tenantId},
                                                  {"active", created.active},
                                                  {"company_type", created.companyType}});
           } catch (const std::exception &) {
             return makeJsonResponse(
                 http::status::bad_request,
                 json::object{{"error", "invalid_company_payload"}});
           }
#else
           return makeJsonResponse(http::status::not_implemented,
                                   json::object{{"error", "postgres_required"}});
#endif
         });

  // GET /api/auth/companies/manage — catálogo administrativo (ADR-085/086):
  // a diferencia del GET público de arriba, incluye inactivas (opcional) y
  // expone RUC/tenant. Requiere `empresas.view`; el RUC se enmascara si el
  // solicitante no tiene además `empresas.manage`.
  r.get("/api/auth/companies/manage",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          }
          if (!hasPermission(session->userId, session->tenantId,
                             session->role, "empresas.view")) {
            return makeJsonResponse(
                http::status::forbidden,
                json::object{{"error", "forbidden"}, {"need", "empresas.view"}});
          }
          if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
            return makeJsonResponse(http::status::not_implemented,
                                    json::object{{"error", "postgres_required"}});
          }
#if HAS_LIBPQ
          const bool includeInactive =
              query.count("include_inactive") && query.at("include_inactive") == "true";
          const bool canManage = hasPermission(session->userId, session->tenantId,
                                               session->role, "empresas.manage");
          const auto companies = listCompaniesAdminPg(
              cfg.gDatabaseUrl, includeInactive, /*maskRuc=*/!canManage);
          return makeJsonResponse(
              http::status::ok,
              json::object{{"companies", companies}, {"can_manage", canManage}});
#else
          return makeJsonResponse(http::status::not_implemented,
                                  json::object{{"error", "postgres_required"}});
#endif
        });

  // PUT/DELETE /api/auth/companies/{company_id} (ADR-085): editar
  // RUC/país/domicilio (nunca `name` — ver comentario en updateCompanyPg) o
  // dar de baja (soft delete: `active=false`, nunca borrado físico — hay
  // informes/telemetría/usuarios enlazados por nombre de empresa).
  r.put("/api/auth/companies/",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          }
          if (!hasPermission(session->userId, session->tenantId,
                             session->role, "empresas.manage")) {
            return makeJsonResponse(
                http::status::forbidden,
                json::object{{"error", "forbidden"}, {"need", "empresas.manage"}});
          }
          const std::string companyId = companyIdFromPath(std::string(req.target()));
          if (companyId.empty()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "company_id_required"}});
          }
#if HAS_LIBPQ
          AuthCompanyRecord current;
          if (!getCompanyByIdPg(cfg.gDatabaseUrl, companyId, current)) {
            return makeJsonResponse(http::status::not_found,
                                    json::object{{"error", "company_not_found"}});
          }
          try {
            const auto parsed = json::parse(req.body());
            if (!parsed.is_object()) {
              return makeJsonResponse(http::status::bad_request,
                                      json::object{{"error", "invalid_company_payload"}});
            }
            const auto &obj = parsed.as_object();
            std::string country = current.countryCode;
            if (const auto *v = obj.if_contains("country"))
              if (v->is_string()) country = json::value_to<std::string>(*v);
            std::string ruc = current.ruc;
            if (const auto *v = obj.if_contains("ruc")) {
              if (v->is_string()) ruc = normalizeTaxId(json::value_to<std::string>(*v));
            }
            if (!ruc.empty() && !validateTaxIdChecksum(ruc, country)) {
              return makeJsonResponse(http::status::bad_request,
                                      json::object{{"error", "ruc_invalido"}});
            }
            std::string domicilioFiscal = current.domicilioFiscal;
            if (const auto *v = obj.if_contains("domicilio_fiscal"))
              if (v->is_string()) domicilioFiscal = json::value_to<std::string>(*v);

            // db_scripts/72: vacío == "no cambiar" (preserva el valor actual
            // del tenant vinculado, ver updateCompanyPg).
            std::string companyType;
            if (const auto *v = obj.if_contains("company_type"))
              if (v->is_string()) {
                const std::string ct = json::value_to<std::string>(*v);
                if (ct == "organization" || ct == "mining_client") companyType = ct;
              }

            // ADR-121: si no vienen en el body, se preserva el valor actual
            // (mismo criterio que ruc/country/domicilio_fiscal arriba).
            std::optional<double> latitude = current.latitude;
            std::optional<double> longitude = current.longitude;
            std::optional<int> locationZoom = current.locationZoom;
            if (obj.if_contains("latitude") || obj.if_contains("longitude")) {
              double latVal = 0, lonVal = 0;
              const bool hasLat = obj.if_contains("latitude") &&
                                  jsonToDoubleSafe(*obj.if_contains("latitude"), latVal);
              const bool hasLon = obj.if_contains("longitude") &&
                                  jsonToDoubleSafe(*obj.if_contains("longitude"), lonVal);
              if (!hasLat || !hasLon) {
                return makeJsonResponse(
                    http::status::bad_request,
                    json::object{{"error", "latitude_longitude_pair_required"}});
              }
              if (latVal < -90 || latVal > 90 || lonVal < -180 || lonVal > 180) {
                return makeJsonResponse(
                    http::status::bad_request,
                    json::object{{"error", "coordinates_out_of_range"}});
              }
              latitude = latVal;
              longitude = lonVal;
              if (const auto *v = obj.if_contains("location_zoom")) {
                double z = 0;
                if (jsonToDoubleSafe(*v, z) && z >= 0 && z <= 22)
                  locationZoom = static_cast<int>(z);
              }
            }

            AuthCompanyRecord updated;
            std::string updateError;
            if (!updateCompanyPg(cfg.gDatabaseUrl, companyId, ruc, country,
                                 domicilioFiscal, latitude, longitude,
                                 locationZoom, session->userId, updated,
                                 updateError, companyType)) {
              return makeJsonResponse(
                  updateError == "company_not_found" ? http::status::not_found
                                                      : http::status::internal_server_error,
                  json::object{{"error", updateError}});
            }
            auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
            PGconn *conn = lease.get();
            if (PQstatus(conn) == CONNECTION_OK) {
              appendAuthAuditLogPg(conn, "company_update", session->company,
                                   session->username, true, updated.name,
                                   std::nullopt, std::nullopt, std::nullopt,
                                   http_utils::getClientIp(req));
            }
            return makeJsonResponse(http::status::ok, companyRecordToJsonValue(updated));
          } catch (const std::exception &) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid_company_payload"}});
          }
#else
          return makeJsonResponse(http::status::not_implemented,
                                  json::object{{"error", "postgres_required"}});
#endif
        });

  r.del("/api/auth/companies/",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          }
          if (!hasPermission(session->userId, session->tenantId,
                             session->role, "empresas.manage")) {
            return makeJsonResponse(
                http::status::forbidden,
                json::object{{"error", "forbidden"}, {"need", "empresas.manage"}});
          }
          const std::string companyId = companyIdFromPath(std::string(req.target()));
          if (companyId.empty()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "company_id_required"}});
          }
#if HAS_LIBPQ
          // ?reactivate=true reactiva en vez de dar de baja — mismo endpoint,
          // evita un quinto verbo para el caso inverso.
          const bool reactivate =
              query.count("reactivate") && query.at("reactivate") == "true";
          int activeUsersAffected = 0;
          std::string toggleError;
          if (!setCompanyActivePg(cfg.gDatabaseUrl, companyId, reactivate,
                                  session->userId, activeUsersAffected,
                                  toggleError)) {
            return makeJsonResponse(
                toggleError == "company_not_found" ? http::status::not_found
                                                    : http::status::internal_server_error,
                json::object{{"error", toggleError}});
          }
          auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
          PGconn *conn = lease.get();
          if (PQstatus(conn) == CONNECTION_OK) {
            appendAuthAuditLogPg(conn,
                                 reactivate ? "company_reactivate" : "company_deactivate",
                                 session->company, session->username, true, companyId,
                                 std::nullopt, std::nullopt, std::nullopt,
                                 http_utils::getClientIp(req));
          }
          return makeJsonResponse(
              http::status::ok,
              json::object{{"ok", true},
                           {"active", reactivate},
                           {"active_users_affected", activeUsersAffected}});
#else
          return makeJsonResponse(http::status::not_implemented,
                                  json::object{{"error", "postgres_required"}});
#endif
        });

  // POST /api/auth/register/check-dni — pre-chequeo de DNI, sin sesión (se
  // usa ANTES de crear la cuenta), ver buildAuthRegisterCheckDniResponse.
  r.post("/api/auth/register/check-dni",
         [](const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &) {
           try {
             auto val = json::parse(req.body());
             if (!val.is_object()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"ok", false}, {"reason", "bad_request"}, {"error", "invalid JSON body"}});
             }
             const auto &obj = val.as_object();
             std::string dni = obj.if_contains("dni") && obj.at("dni").is_string()
                                    ? json::value_to<std::string>(obj.at("dni"))
                                    : std::string();
             return buildAuthRegisterCheckDniResponse(std::move(dni));
           } catch (const std::exception &ex) {
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"ok", false}, {"reason", "bad_request"}, {"error", ex.what()}});
           }
         });

  // POST /api/auth/register/check-username — pre-chequeo de username, sin
  // sesión (se usa ANTES de crear la cuenta), ver
  // buildAuthRegisterCheckUsernameResponse.
  r.post("/api/auth/register/check-username",
         [](const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &) {
           try {
             auto val = json::parse(req.body());
             if (!val.is_object()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"ok", false}, {"reason", "bad_request"}, {"error", "invalid JSON body"}});
             }
             const auto &obj = val.as_object();
             std::string company = obj.if_contains("company") && obj.at("company").is_string()
                                        ? json::value_to<std::string>(obj.at("company"))
                                        : std::string();
             std::string username = obj.if_contains("username") && obj.at("username").is_string()
                                         ? json::value_to<std::string>(obj.at("username"))
                                         : std::string();
             return buildAuthRegisterCheckUsernameResponse(std::move(company), std::move(username));
           } catch (const std::exception &ex) {
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"ok", false}, {"reason", "bad_request"}, {"error", ex.what()}});
           }
         });

  // POST /api/client-incident — beacon de diagnóstico, hallazgo real
  // 2026-09-04: `log.info/warn` del frontend (frontend/src/lib/logger.ts)
  // SOLO imprime en la consola del NAVEGADOR, gateado a DEV/VITE_DEBUG --
  // nunca llega al servidor. Cada vez que un usuario reportaba "la captura
  // se cerró sola" sin ningún rastro en `docker logs`, eso NO era evidencia
  // de que el fallo fuera puramente del cliente: era que el único logging
  // que hubiera podido explicarlo nunca podía aparecer ahí. Este endpoint
  // no reemplaza esos logs -- les da un canal real hacia el servidor
  // específicamente para el evento que hace falta diagnosticar (un aborto
  // inesperado de la captura biométrica), sin depender de que alguien
  // tenga la consola del navegador abierta en el momento exacto en que
  // ocurre. Público a propósito (puede dispararse en la pantalla de
  // registro, antes de tener sesión); nunca debe poder tumbar el request
  // del cliente, así que cualquier error acá se traga y responde 204 igual.
  r.post("/api/client-incident",
         [](const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &) {
           try {
             const std::string ip = http_utils::getClientIp(req);
             // Límite generoso pero acotado -- este endpoint es de
             // diagnóstico, no debe poder usarse para llenar el log del
             // servidor con payloads arbitrariamente grandes.
             std::string body = req.body();
             if (body.size() > 4096) {
               body.resize(4096);
             }
             std::cout << "[CLIENT_INCIDENT] ip=" << ip << " body=" << body
                       << std::endl;
           } catch (...) {
             // Nunca debe fallar por esto -- es puramente diagnóstico.
           }
           return makeJsonResponse(http::status::ok, json::object{{"ok", true}});
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
  // ADR-087: antes solo validaba el dígito verificador del RUC y nunca
  // comparaba `company` contra nada (bug documentado en
  // docs_/01_Planificacion/Auditoria_Registro_RUC_Tenant_2026-07-21.md,
  // Hallazgo A). El algoritmo de checksum es el mismo de siempre —solo se
  // extrajo a tax_id.cpp (auth::validateTaxIdChecksum), sin tocar la
  // matemática— y se agrega `company_known`/`ruc_matches_company` sin romper
  // al consumidor actual (frontend/src/auth/authApi.ts:587 solo lee
  // `payload.valid`).
  r.get("/api/auth/validate-company",
        [&cfg](const http::request<http::string_body> &,
               const std::unordered_map<std::string, std::string> &query) {
          std::string company =
              query.count("company") ? query.at("company") : "";
          std::string ruc = query.count("ruc") ? query.at("ruc") : "";
          std::string country =
              query.count("country") ? query.at("country") : "PE";

          const bool valid = validateTaxIdChecksum(ruc, country);

          json::object result{{"valid", valid}};

          // ADR-087: consulta opcional y no bloqueante contra un verificador
          // de terceros (apagada por defecto — BEEMETRY_TAX_REGISTRY_ENABLED).
          // Solo se intenta si el checksum local ya dio válido: no tiene
          // sentido gastar la llamada externa en un RUC con forma incorrecta.
          if (valid && country == "PE") {
            const auto lookup = lookupPeruRuc(ruc);
            if (!lookup.available) {
              result["registry"] = lookup.error.empty() ? "disabled" : "unavailable";
            } else if (!lookup.found) {
              result["registry"] = "not_found";
            } else {
              result["registry"] = "confirmed";
              result["registry_razon_social"] = lookup.razonSocial;
              if (!lookup.estado.empty()) result["registry_estado"] = lookup.estado;
              if (!lookup.condicion.empty()) result["registry_condicion"] = lookup.condicion;
              // ADR-190: expone el domicilio fiscal ya traído por
              // lookupPeruRuc (antes se descartaba) -- lo necesita
              // "Administración de empresas" para llenar domicilio_fiscal
              // con el dato real de SUNAT en vez de texto libre inventado.
              if (!lookup.domicilioFiscal.empty()) result["registry_domicilio_fiscal"] = lookup.domicilioFiscal;
            }
          }
          const std::string trimmedCompany = trimAuthParam(company);
          if (!trimmedCompany.empty() &&
              cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
            auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
            PGconn *conn = lease.get();
            if (PQstatus(conn) == CONNECTION_OK && ensureAuthSchemaPg(conn)) {
              const char *p[1] = {trimmedCompany.c_str()};
              storage::PgResult res{PQexecParams(
                  conn,
                  "SELECT ruc FROM auth_companies "
                  "WHERE lower(btrim(name))=lower(btrim($1)) LIMIT 1",
                  1, nullptr, p, nullptr, nullptr, 0)};
              if (res.okTuples() && PQntuples(res.get()) > 0) {
                result["company_known"] = true;
                const std::string knownRuc = PQgetvalue(res.get(), 0, 0);
                result["ruc_matches_company"] =
                    !ruc.empty() && !knownRuc.empty() && ruc == knownRuc;
              } else {
                result["company_known"] = false;
              }
            }
#endif
          }
          return makeJsonResponse(http::status::ok, json::value(result));
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
  r.get("/api/auth/avatar/hd", handleMyAvatarHd);
  r.get("/api/auth/avatar/thumb", handleMyAvatarThumb);
  // Rediseño de avatar (2026-09-20, ADR-203): catálogo y selección de
  // cuerpo/vestimenta pre-hechos.
  r.get("/api/avatar/body-templates", handleListAvatarBodyTemplates);
  r.post("/api/auth/avatar/body-template", handleUpdateAvatarBodyTemplate);
  r.post("/api/auth/avatar/re-enroll", handleReEnrollAvatar);
  r.post("/api/auth/avatar/animation", handleCreateAvatarAnimation);
  r.get("/api/auth/avatar/animation/", handleGetAvatarAnimation);  // prefix match for /{jobId}[/download]
  r.get("/api/auth/tenants", handleListMyTenants);
  r.post("/api/auth/tenants/switch", handleSwitchTenant);

  // Alta de usuarios admin-driven + gestión de accesos multitenant de terceros.
  r.post("/api/auth/users/create", handleAdminCreateUser);
  r.get("/api/auth/users/", handleListUserTenants);
  r.post("/api/auth/users/", handleUserTenantPost);
}

} // namespace auth
