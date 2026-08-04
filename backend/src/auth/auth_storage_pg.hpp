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
/** @brief Inserta una fila en `auth_audit_logs` (best-effort: no propaga errores de escritura). */
void appendAuthAuditLogPg(PGconn *conn, const std::string &action,
                          const std::string &company,
                          const std::string &username, bool ok,
                          const std::string &detail);

/** @brief Verifica que exista un usuario de `companyName` cuyo RUC coincida (o cualquier usuario de la empresa si `ruc` viene vacío). @return true si existe al menos una fila. */
bool validateCompanyPg(const std::string &databaseUrl,
                       const std::string &companyName,
                       const std::string &ruc, std::string &error);

/** @brief Inserta un nuevo `AuthUser` (con plantilla facial) tras validar que el DNI no exista ya. Registra el intento (éxito o fallo) en la auditoría. @return true si el INSERT tuvo éxito. */
bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error);

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
                                        std::string *errorCodeOut = nullptr);

/** @brief Autentica por biometría facial: resuelve la identidad, valida estado de cuenta, arma el "probe" (plantilla de cliente o imagen cruda) y compara similitud coseno contra la plantilla almacenada. Registra cada resultado en la auditoría. @return El `AuthUser` y el score de similitud si superó el umbral; `std::nullopt` en cualquier otro caso. */
std::optional<std::pair<AuthUser, double>>
loginFaceTargetedPg(const std::string &databaseUrl, const std::string &company,
                    const std::string &identityKey,
                    const std::vector<double> &clientProbeTemplate,
                    const std::optional<std::vector<unsigned char>> &rawImageBytes,
                    const std::optional<std::string> &base64ForLegacy,
                    double legacyThreshold, double embeddingThreshold,
                    std::string &error, std::string *probeProviderOut = nullptr);

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

} // namespace auth
