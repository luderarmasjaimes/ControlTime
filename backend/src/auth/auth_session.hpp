#pragma once

#include "auth_types.hpp"
#include "../config/app_config.hpp"

#include <boost/beast/http.hpp>

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http = beast::http;

namespace auth {

extern std::mutex gAuthSessionMutex;
extern std::unordered_map<std::string, AuthSession> gAuthSessions;

extern std::mutex gGlassesEmaMutex;
extern std::unordered_map<std::string, GlassesEmaState> gGlassesEmaBySession;

extern std::mutex gAuthMutex;

/** Token Bearer o query auth_token (mismo criterio que resolveAuthSession). */
std::string extractAuthTokenFromRequest(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query);

void resetGlassesEmaState(GlassesEmaState &s);

/** Retorna noGlasses (sin lentes). outEma = señal suavizada 0–100. */
bool applyIcaoGlassesEma(GlassesEmaState &s, double rawLikelihood,
                         bool faceDetected, double &outEma);

std::string resolveRoleForUsername(const std::string &username);

std::string makeSessionToken();

AuthSession issueAuthSession(const AuthUser &user);

void pruneExpiredAuthSessions();

std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query);

} // namespace auth
