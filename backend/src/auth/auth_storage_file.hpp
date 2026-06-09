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

json::object authUserSessionJson(const AuthUser &u, const std::string &token);

bool jsonToAuthUser(const json::object &obj, AuthUser &out);

std::vector<AuthUser> loadAuthUsers(const std::string &dataRoot);
void saveAuthUsers(const std::string &dataRoot,
                   const std::vector<AuthUser> &users);

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
