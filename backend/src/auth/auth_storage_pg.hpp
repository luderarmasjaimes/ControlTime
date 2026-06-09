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
std::string pqEscapeLiteral(PGconn *conn, const std::string &value);
bool pgExecOk(PGconn *conn, const std::string &sql);
bool pgExecAuditContextFromLogin(PGconn *conn, const std::string &username,
                                 const std::string &companyName,
                                 const std::string &sessionToken);
bool ensureAuthSchemaPg(PGconn *conn);
#endif

std::string trimCompanyName(const std::string &s);

#if HAS_LIBPQ
void appendAuthAuditLogPg(PGconn *conn, const std::string &action,
                          const std::string &company,
                          const std::string &username, bool ok,
                          const std::string &detail);

bool validateCompanyPg(const std::string &databaseUrl,
                       const std::string &companyName,
                       const std::string &ruc, std::string &error);

bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error);

bool updateUserAvatarCartoonPg(const std::string &databaseUrl,
                               const std::string &userId,
                               const std::string &avatarBase64,
                               const std::string &actorUsername,
                               const std::string &actorCompany,
                               const std::string &sessionToken,
                               std::string &error);

std::string pgSqlAuthIdentityMatch(PGconn *conn,
                                   const std::string &identityKey);

AuthLoginIdentityLookupResult authLookupIdentityForCompanyPg(
    const std::string &databaseUrl, const std::string &company,
    const std::string &identityKey);

std::string resolveTelemetryTenantIdPg(void *connV, const std::string &userId,
                                       const std::string &companyName);

std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &identityKey,
                                        const std::string &passwordHash,
                                        std::string &error,
                                        std::string *errorCodeOut = nullptr);

std::optional<std::pair<AuthUser, double>>
loginFaceTargetedPg(const std::string &databaseUrl, const std::string &company,
                    const std::string &identityKey,
                    const std::vector<double> &clientProbeTemplate,
                    const std::optional<std::vector<unsigned char>> &rawImageBytes,
                    const std::optional<std::string> &base64ForLegacy,
                    double legacyThreshold, double embeddingThreshold,
                    std::string &error, std::string *probeProviderOut = nullptr);

json::array listCompanyUsersPg(const std::string &databaseUrl,
                               const std::string &company);

json::array listUserMaintenanceAuditPg(const std::string &databaseUrl,
                                       const std::string &company,
                                       int page, int pageSize);

bool executeUserMaintenancePg(const std::string &databaseUrl,
                              const json::object &payload,
                              json::object &outAudit, std::string &error);

AuditPageResult readAuthAuditPg(const std::string &databaseUrl,
                                const AuditFilter &filter);
#endif

} // namespace auth
