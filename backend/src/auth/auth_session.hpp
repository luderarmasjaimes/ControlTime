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

/** @brief Extrae el token de sesión: header `Authorization: Bearer <token>` o query param `auth_token` (mismo criterio que resolveAuthSession). @return El token, o cadena vacía si no está presente. */
std::string extractAuthTokenFromRequest(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query);

/** @brief Reinicia el estado EMA de detección de lentes (ICAO) a sus valores iniciales. */
void resetGlassesEmaState(GlassesEmaState &s);

/** @brief Aplica suavizado EMA + histéresis a la probabilidad cruda de "sin lentes" de un frame, para evitar parpadeo del indicador cuadro a cuadro. @return true si el estado suavizado indica ausencia de lentes; `outEma` queda con la señal suavizada (0–100). */
bool applyIcaoGlassesEma(GlassesEmaState &s, double rawLikelihood,
                         bool faceDetected, double &outEma);

/** @brief Resuelve el rol RBAC asociado a un username (reglas hardcodeadas de bootstrap, p.ej. administradores conocidos). @return El rol resuelto, o el rol por defecto si no hay regla especial. */
std::string resolveRoleForUsername(const std::string &username);

/** @brief Genera un token de sesión aleatorio criptográficamente no predecible. */
std::string makeSessionToken();

/** @brief Crea y registra una nueva `AuthSession` en `gAuthSessions` para el usuario autenticado, con expiración estándar. @return La sesión creada (incluye el token nuevo). */
AuthSession issueAuthSession(const AuthUser &user);

/** @brief Elimina inmediatamente el token de sesión (logout explícito). */
void revokeAuthSession(const std::string &token);

/** @brief Recorre `gAuthSessions` y elimina las sesiones cuyo `expiresAt` ya pasó. Debe llamarse periódicamente (no hay expiración perezosa por acceso). */
void pruneExpiredAuthSessions();

/** @brief Resuelve la sesión activa a partir del token de la request (ver `extractAuthTokenFromRequest`), purgando sesiones expiradas antes de buscar. @return La sesión si el token es válido y no expiró; `std::nullopt` en otro caso. */
std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query);

} // namespace auth
