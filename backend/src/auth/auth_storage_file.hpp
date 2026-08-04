#pragma once

#include "auth_types.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace auth {

fs::path authDirPath(const std::string &dataRoot);
fs::path authUsersFile(const std::string &dataRoot);
fs::path authAuditFile(const std::string &dataRoot);
fs::path legacyFacialUsersFile(const std::string &dataRoot);

json::object authUserToJson(const AuthUser &u);

/** @brief Construye el JSON "user" devuelto en login/registro/refresh: solo el access_token JWT (ADR-029, "Actualización 2026-07-19" -- el refresh_token ya no viaja acá, ver http_utils::setAuthCookies). */
json::object authUserSessionJson(const AuthUser &u, const AuthTokenPair &tokens);

bool jsonToAuthUser(const json::object &obj, AuthUser &out);

std::vector<AuthUser> loadAuthUsers(const std::string &dataRoot);
void saveAuthUsers(const std::string &dataRoot,
                   const std::vector<AuthUser> &users);

/**
 * @brief Envuelve en Argon2id los hashes legados del almacén de archivo.
 *
 * Equivalente en modo File de `migrateLegacyPasswordHashesPg`. El modo File es
 * de desarrollo/offline, pero `users.json` es un archivo en disco igual de
 * volcable que una tabla, así que no tiene sentido dejar ahí hashes de 64 bits
 * con salt fijo mientras se limpia Postgres.
 *
 * @return Número de credenciales envueltas (0 si no había ninguna legada).
 */
int migrateLegacyPasswordHashesFile(const std::string &dataRoot);

bool updateUserAvatarCartoonFile(const std::string &dataRoot,
                                 const std::string &userId,
                                 const std::string &avatarBase64);

std::vector<LegacyFacialUserRecord>
loadLegacyFacialUsers(const std::string &dataRoot);
void saveLegacyFacialUsers(const std::string &dataRoot,
                           const std::vector<LegacyFacialUserRecord> &users);

void appendAuthAuditLog(const std::string &dataRoot, const std::string &action,
                        const std::string &company,
                        const std::string &username, bool ok,
                        const std::string &detail);

json::object parseAuditLine(const std::string &line);
bool matchAuditFilter(const json::object &entry, const AuditFilter &filter);
AuditPageResult readAuthAuditTail(const std::string &dataRoot,
                                  const AuditFilter &filter);

std::string auditRowsToCsv(const json::array &logs);

bool authIdentityKeyIsAllDigits(const std::string &s);
bool authIdentityKeyMatchesFsUser(const std::string &identityKey,
                                  const AuthUser &u);
AuthLoginIdentityLookupResult authLookupIdentityForCompanyFs(
    const std::string &dataRoot, const std::string &company,
    const std::string &identityKey);

} // namespace auth
