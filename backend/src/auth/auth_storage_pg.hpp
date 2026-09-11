#pragma once

#include "auth_types.hpp"
#include "auth_storage_file.hpp"
#include "../config/app_config.hpp"

#if __has_include(<libpq-fe.h>)
#define HAS_LIBPQ 1
#include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#define HAS_LIBPQ 1
#include <postgresql/libpq-fe.h>
#else
#define HAS_LIBPQ 0
#endif

#include <atomic>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace auth {

#if HAS_LIBPQ
/** @brief Escapa un literal SQL vía PQescapeLiteral. @return Cadena escapada (vacía si falla). */
std::string pqEscapeLiteral(PGconn *conn, const std::string &value);

/** @brief Ejecuta `sql` sin parámetros y libera el resultado. @return true si terminó en PGRES_COMMAND_OK/PGRES_TUPLES_OK. */
bool pgExecOk(PGconn *conn, const std::string &sql);

/** @brief Fija el contexto de auditoría (usuario/empresa/token) vía GUC de sesión para que los triggers de `platform_audit_log` lo hereden. @return true si el SET tuvo éxito; no falla si `username` está vacío (contexto no aplicable). */
bool pgExecAuditContextFromLogin(PGconn *conn, const std::string &username,
                                 const std::string &companyName,
                                 const std::string &sessionToken);

/** @brief Crea (si faltan) las tablas del esquema de auth y siembra las empresas conocidas. Idempotente y cacheado tras la primera ejecución exitosa (ver gAuthSchemaReady). @return true si el esquema quedó listo. */
bool ensureAuthSchemaPg(PGconn *conn);
#endif

/** @brief Recorta espacios en ambos extremos de `s`. @return Copia recortada. */
std::string trimCompanyName(const std::string &s);

#if HAS_LIBPQ
/** @brief Inserta una fila en `auth_audit_logs` (best-effort: no propaga errores de escritura).
 * @param latitude,longitude,accuracyMeters Ubicación del dispositivo cliente (ADR-107, db_scripts/58)
 * -- columnas dedicadas para poder filtrar/agregar por coordenadas, además del texto ya presente en
 * `detail` para lectura humana. `nullopt` si no se capturó (no participa en la decisión de auditar).
 * @param sourceIp IP real del cliente (ADR-130, `http_utils::getClientIp`) -- columna `source_ip`,
 * presente en el esquema desde `db_scripts/03_auth_biometric.sql` pero que ningún caller poblaba
 * hasta esta extensión (confirmado en vivo: 0 de ~230 filas existentes la tenían). Cadena vacía si
 * no se pudo determinar (no bloquea el registro del evento). */
void appendAuthAuditLogPg(PGconn *conn, const std::string &action,
                          const std::string &company,
                          const std::string &username, bool ok,
                          const std::string &detail,
                          std::optional<double> latitude = std::nullopt,
                          std::optional<double> longitude = std::nullopt,
                          std::optional<double> accuracyMeters = std::nullopt,
                          const std::string &sourceIp = std::string());

/** @brief Verifica que exista un usuario de `companyName` cuyo RUC coincida (o cualquier usuario de la empresa si `ruc` viene vacío). @return true si existe al menos una fila. */
bool validateCompanyPg(const std::string &databaseUrl,
                       const std::string &companyName,
                       const std::string &ruc, std::string &error);

/** @brief Pre-chequeo de disponibilidad de DNI antes de la captura facial
 * (ADR pendiente 2026-09-04) -- misma query que el chequeo real de
 * registerUserPg (UNIQUE global, no por empresa). @return false sólo si la
 * consulta en sí falló (ver `error`); el resultado real va en `outExists`. */
bool checkDniExistsPg(const std::string &databaseUrl, const std::string &dni,
                      bool &outExists, std::string &error);

/** @brief Pre-chequeo de disponibilidad de username antes de la captura
 * facial (hallazgo real 2026-09-04, mismo motivo que checkDniExistsPg):
 * misma query que el chequeo real de registerUserPg (UNIQUE por empresa,
 * `company_name` + `username`). @return false sólo si la consulta en sí
 * falló (ver `error`); el resultado real va en `outExists`. */
bool checkUsernameExistsPg(const std::string &databaseUrl,
                           const std::string &company,
                           const std::string &username, bool &outExists,
                           std::string &error);

/** @brief Inserta un nuevo `AuthUser` (con plantilla facial) tras validar que el DNI no exista ya. Registra el intento (éxito o fallo) en la auditoría. @return true si el INSERT tuvo éxito. */
bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error,
                    /** IP del cliente (ADR-130) -- registrada en la auditoría de alta. */
                    const std::string &sourceIp = "");

/** @brief MFA/TOTP (ADR-135). Guarda un secreto PENDIENTE (totp_enabled sigue false hasta el primer código válido, ver enableTotpPg). Sobrescribe cualquier secreto pendiente anterior no confirmado. @return true si el UPDATE afectó una fila. */
bool setPendingTotpSecretPg(const std::string &databaseUrl, const std::string &userId,
                            const std::string &base32Secret, std::string &error);

/** @brief Lee `(totp_secret, totp_enabled)` de un usuario por `id`. @return nullopt si el usuario no existe. */
std::optional<std::pair<std::string, bool>> getTotpStatusPg(const std::string &databaseUrl,
                                                             const std::string &userId,
                                                             std::string &error);

/** @brief Marca `totp_enabled=true` (llamado tras el primer código válido post-enrolamiento). @return true si el UPDATE afectó una fila. */
bool enableTotpPg(const std::string &databaseUrl, const std::string &userId, std::string &error);

/** @brief Limpia el secreto y pone `totp_enabled=false` (deshabilita MFA por completo). @return true si el UPDATE afectó una fila. */
bool disableTotpPg(const std::string &databaseUrl, const std::string &userId, std::string &error);

/** @brief Actualiza el avatar caricaturizado (base64) de un usuario por `id`. Envuelto en transacción con contexto de auditoría cuando `actorUsername` no está vacío. @return true si el UPDATE tuvo éxito. */
bool updateUserAvatarCartoonPg(const std::string &databaseUrl,
                               const std::string &userId,
                               const std::string &avatarBase64,
                               const std::string &actorUsername,
                               const std::string &actorCompany,
                               const std::string &sessionToken,
                               std::string &error);

// Devuelve una cláusula SQL que matchea la identidad (username/dni/ruc) usando
// el placeholder $paramIndex (reutilizado en cada posición). El valor se pasa
// como parámetro en el PQexecParams del llamador; no se interpola.
std::string pgSqlAuthIdentityMatch(const std::string &identityKey,
                                   int paramIndex);

/** @brief Busca cuántos usuarios de `company` coinciden con `identityKey` (username/dni/ruc), sin validar credenciales — solo resuelve identidad. @return Kind::Ok con el username resuelto si hay exactamente una coincidencia; NotFound/Ambiguous en otro caso. */
AuthLoginIdentityLookupResult authLookupIdentityForCompanyPg(
    const std::string &databaseUrl, const std::string &company,
    const std::string &identityKey);

/** @brief Resuelve el tenant_id de telemetría de un usuario: primero por el nombre de empresa en `mineria_empresas`, luego por `auth_user_tenant` (tenant por defecto del usuario). @return El tenant_id resuelto, o `fallback` si ninguna fuente lo tiene. */
std::string resolveTelemetryTenantIdPg(void *connV, const std::string &userId,
                                       const std::string &companyName);

/**
 * @brief Encuentra (por `tenant_name` == `companyName`) o crea un tenant real
 * para una empresa, y vincula `userId` a él en `auth_user_tenant`
 * (is_default=true). Pensado para el autoregistro (`/api/auth/register`):
 * sin esto, un usuario recién registrado nunca obtiene una fila real de
 * membresía y su JWT cae permanentemente en el tenant de fallback
 * (`kMiningTelemetryDemoTenantId`, ver `resolveTelemetryTenantIdPg`) — que
 * ADR-039 vetó explícitamente para creación/edición de informes
 * (`userHasRealTenantMembership`), dejando al usuario bloqueado sin salida.
 * Idempotente ante carreras concurrentes (ON CONFLICT + relectura).
 * @return El tenant_id (nuevo o existente), o cadena vacía si falló (ver
 * `error`) — el llamador NO debe abortar el registro por esto, solo loguear.
 */
std::string findOrCreateTenantForCompanyPg(const std::string &databaseUrl,
                                           const std::string &companyName,
                                           const std::string &userId,
                                           const std::string &role,
                                           std::string &error);

/** @brief Recarga un AuthUser por id (sin verificar password) — usado para reemitir sesión al cambiar de tenant activo (ver /api/auth/tenants/switch). tenantId queda vacío; el caller lo sobreescribe con el tenant destino. @return El AuthUser si existe y está activo; `std::nullopt` en cualquier otro caso. */
std::optional<AuthUser> findUserByIdPg(const std::string &databaseUrl,
                                       const std::string &userId);

/** @brief Autentica por contraseña: resuelve la identidad, valida `account_status` (bloqueado/eliminado/suspendido) y compara el hash. Registra cada resultado en la auditoría. @return El `AuthUser` si las credenciales son válidas; `std::nullopt` en cualquier otro caso (ver `error`/`errorCodeOut`). */
std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &identityKey,
                                        const std::string &password,
                                        std::string &error,
                                        std::string *errorCodeOut = nullptr,
                                        /** Anexado tal cual al `detail` de la fila de
                                         * auditoría del login EXITOSO (p. ej. ubicación
                                         * del cliente — ADR-107); vacío por defecto. No
                                         * participa en la decisión de autenticar. */
                                        const std::string &auditDetailSuffix = "",
                                        /** Ubicación del dispositivo cliente en columnas
                                         * dedicadas (db_scripts/58) además del texto de
                                         * auditDetailSuffix. */
                                        std::optional<double> latitude = std::nullopt,
                                        std::optional<double> longitude = std::nullopt,
                                        std::optional<double> accuracyMeters = std::nullopt,
                                        /** IP del cliente (ADR-130, `http_utils::getClientIp`)
                                         * -- se registra en TODAS las filas de auditoría que
                                         * genera esta función, éxito o fallo. */
                                        const std::string &sourceIp = "");

/** @brief Autentica por biometría facial: resuelve la identidad, valida estado de cuenta, arma el "probe" (plantilla de cliente o imagen cruda) y compara similitud coseno contra la plantilla almacenada. Registra cada resultado en la auditoría. @return El `AuthUser` y el score de similitud si superó el umbral; `std::nullopt` en cualquier otro caso. */
std::optional<std::pair<AuthUser, double>>
loginFaceTargetedPg(const std::string &databaseUrl, const std::string &company,
                    const std::string &identityKey,
                    const std::vector<double> &clientProbeTemplate,
                    const std::optional<std::vector<unsigned char>> &rawImageBytes,
                    const std::optional<std::string> &base64ForLegacy,
                    double legacyThreshold, double embeddingThreshold,
                    std::string &error, std::string *probeProviderOut = nullptr,
                    /** Anexado tal cual al `detail` de la fila de auditoría del
                     * login EXITOSO (p. ej. ubicación del cliente); vacío por
                     * defecto. No participa en la decisión de autenticar. */
                    const std::string &auditDetailSuffix = "",
                    /** Ubicación del dispositivo cliente en columnas dedicadas
                     * (db_scripts/58) además del texto de auditDetailSuffix. */
                    std::optional<double> latitude = std::nullopt,
                    std::optional<double> longitude = std::nullopt,
                    std::optional<double> accuracyMeters = std::nullopt,
                    /** IP del cliente (ADR-130) -- registrada en TODAS las
                     * filas de auditoría que genera esta función. */
                    const std::string &sourceIp = "");

/** @brief Lista los usuarios de `company` (sin credenciales) para pantallas de mantenimiento. @return Array JSON, vacío si no hay conexión o no hay usuarios. */
json::array listCompanyUsersPg(const std::string &databaseUrl,
                               const std::string &company);

/** @brief Lista paginada del historial de acciones de mantenimiento de usuarios (bloqueo/suspensión/cambio de rol/etc.) de `company`. @return Array JSON de la página solicitada. */
json::array listUserMaintenanceAuditPg(const std::string &databaseUrl,
                                       const std::string &company,
                                       int page, int pageSize);

/** @brief Ejecuta una acción de mantenimiento sobre un usuario (block/unblock/suspend/delete/change_profile/edit_data/reset_password) y registra el resultado en `auth_user_maintenance_audit`. El `company` del payload debe ser el de la sesión del operador (ver fix IDOR en auth_routes.cpp) — esta función no vuelve a validar eso. @return true si la operación afectó al menos una fila. */
bool executeUserMaintenancePg(const std::string &databaseUrl,
                              const json::object &payload,
                              json::object &outAudit, std::string &error);

/** @brief Lee `auth_audit_logs` con filtros opcionales (empresa/usuario/acción/éxito) y paginación. @return Página de resultados junto con el total que matchea los filtros. */
AuditPageResult readAuthAuditPg(const std::string &databaseUrl,
                                const AuditFilter &filter);

// ── ADR-029 (revisado): refresh tokens del esquema híbrido JWT ────────────

/** @brief Persiste el hash (nunca el token crudo) de un nuevo refresh token para `user`. @return true si el INSERT tuvo éxito. */
bool insertRefreshTokenPg(const std::string &databaseUrl, const AuthUser &user,
                          const std::string &tokenHash,
                          const std::string &expiresAtIso);

/** @brief Busca un refresh token vigente (no revocado, no expirado) por su hash y rehidrata la identidad asociada. @return El `AuthUser` (sin credenciales) si el hash es válido; `std::nullopt` en otro caso. */
std::optional<AuthUser> findValidRefreshTokenUserPg(const std::string &databaseUrl,
                                                    const std::string &tokenHash);

/** @brief Marca un refresh token como revocado (logout, o rotación — `replacedByHash` referencia el token nuevo). @return true si afectó una fila. */
bool revokeRefreshTokenPg(const std::string &databaseUrl,
                          const std::string &tokenHash,
                          const std::string &replacedByHash = "");

/** @brief Revoca todos los refresh tokens vigentes de un usuario (logout global / incidente de seguridad). @return true si el UPDATE se ejecutó sin error. */
bool revokeAllRefreshTokensForUserPg(const std::string &databaseUrl,
                                     const std::string &userId);

// ── Migración de credenciales a Argon2id (auditoría 2026-08-02) ───────────

/** @brief Resultado de la migración masiva de hashes legados. */
struct PasswordMigrationResult {
  bool ran = false;        ///< false si no había nada que migrar o no hubo BD.
  int scanned = 0;         ///< filas con hash legado crudo encontradas.
  int migrated = 0;        ///< filas efectivamente envueltas en Argon2id.
  int failed = 0;          ///< filas que no se pudieron migrar.
  int remainingRaw = 0;    ///< hashes legados crudos que siguen en la tabla.
  int remainingWrapped = 0;///< envueltos, pendientes de rehash real en su login.
  std::string error;
};

/**
 * @brief Envuelve en Argon2id TODOS los hashes de contraseña legados.
 *
 * Idempotente y segura de ejecutar en cada arranque: solo toca filas cuyo
 * `password_hash` no empieza por `$argon2id$` ni por `legacy1:`. Cada fila se
 * actualiza con un UPDATE condicionado al hash antiguo, así que un login
 * concurrente que ya haya hecho el rehash real nunca se pisa.
 *
 * Elimina de la base el material débil (`std::hash` de 64 bits, salt fijo, sin
 * estiramiento) sin necesitar las contraseñas en claro y sin expulsar a nadie.
 * La conversión a un Argon2id auténtico ocurre después, por usuario, en su
 * siguiente login correcto.
 */
PasswordMigrationResult migrateLegacyPasswordHashesPg(const std::string &databaseUrl);
#endif

// ── ADR-085: CRUD administrado de empresas (db_scripts/50) ────────────────

/** @brief Fila de `auth_companies` tal como la ve la pantalla de administración (ver CompanyManagementView.tsx). */
struct AuthCompanyRecord {
  std::string companyId;
  std::string name;
  std::string ruc;             ///< vacío si no se cargó o si se enmascaró para el llamador (ver listCompaniesAdminPg).
  std::string countryCode = "PE";
  std::string domicilioFiscal;
  std::string tenantId;
  bool active = true;
  bool demoData = false;
  std::string createdAt;
  std::string updatedAt;
  std::string updatedBy;
  std::string deactivatedAt;
  std::string deactivatedBy;
  /** ADR-121: coordenadas de la mina, nullable -- std::nullopt == "sin
   *  registrar todavía", nunca (0,0) como sentinela. */
  std::optional<double> latitude;
  std::optional<double> longitude;
  std::optional<int> locationZoom;
  /** db_scripts/72: 'mining_client' (default) | 'organization'. Se lee/escribe
   *  vía `tenants.company_type` (subquery correlacionada en kCompanySelectCols)
   *  -- NO es una columna propia de auth_companies, evita un dual-write nuevo
   *  (lección de ADR-039). Vacío si la empresa todavía no tiene tenant_id. */
  std::string companyType = "mining_client";
};

#if HAS_LIBPQ
/** @brief Lista `auth_companies` para la pantalla de administración (a diferencia de GET /api/auth/companies, incluye inactivas si se pide y expone RUC/tenant). @param maskRuc Si true, el RUC vuelve vacío en cada fila (solicitante con `empresas.view` pero sin `empresas.manage`). */
json::array listCompaniesAdminPg(const std::string &databaseUrl,
                                 bool includeInactive, bool maskRuc);

/** @brief Busca una empresa por su `company_id` (uuid). @return true si existe. */
bool getCompanyByIdPg(const std::string &databaseUrl,
                      const std::string &companyId, AuthCompanyRecord &out);

/**
 * @brief Da de alta una empresa: inserta primero apoyándose en el índice
 * único `ux_auth_companies_name_norm` (ON CONFLICT DO NOTHING RETURNING) —
 * si no devuelve fila es que ya existía (error="company_already_exists"),
 * cerrando la condición de carrera que tenía el POST original (dos altas
 * concurrentes del mismo nombre normalizado). Solo entonces provisiona el
 * tenant real vía `findOrCreateTenantForCompanyPg` y lo persiste en la fila.
 * @return true si la empresa quedó creada (ver `out`); false en cualquier
 * otro caso (ver `error`: "company_already_exists" | "tenant_provision_failed"
 * | "database_unavailable" | "company_create_failed").
 * @param companyType 'mining_client' (default si vacío) | 'organization' --
 * se aplica al tenant recién provisionado (db_scripts/72), NO a auth_companies.
 */
bool createCompanyPg(const std::string &databaseUrl, const std::string &name,
                     const std::string &ruc, const std::string &countryCode,
                     const std::string &domicilioFiscal,
                     std::optional<double> latitude,
                     std::optional<double> longitude,
                     std::optional<int> locationZoom,
                     const std::string &actorUserId,
                     const std::string &actorRole, AuthCompanyRecord &out,
                     std::string &error,
                     const std::string &companyType = "mining_client");

/** @brief Edita RUC/país/domicilio de una empresa existente. NUNCA toca `name` (el nombre es referenciado por nombre en auth_users/reports/mineria_empresas — renombrar queda fuera de alcance, ver ADR-085). @param companyType Si no vacío, actualiza `tenants.company_type` (db_scripts/72) del tenant vinculado. @return true si la fila existía y se actualizó. */
bool updateCompanyPg(const std::string &databaseUrl,
                     const std::string &companyId, const std::string &ruc,
                     const std::string &countryCode,
                     const std::string &domicilioFiscal,
                     std::optional<double> latitude,
                     std::optional<double> longitude,
                     std::optional<int> locationZoom,
                     const std::string &actorUserId, AuthCompanyRecord &out,
                     std::string &error,
                     const std::string &companyType = "");

/** @brief Activa/desactiva una empresa (soft delete — nunca borra la fila: hay informes/telemetría/usuarios enlazados por nombre). @param activeUsersAffected Devuelve cuántos usuarios activos tiene la empresa, para que el frontend lo muestre en la confirmación. @return true si la fila existía y se actualizó. */
bool setCompanyActivePg(const std::string &databaseUrl,
                        const std::string &companyId, bool active,
                        const std::string &actorUserId,
                        int &activeUsersAffected, std::string &error);
#endif

} // namespace auth
