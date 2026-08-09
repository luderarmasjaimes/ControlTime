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

extern std::mutex gGlassesEmaMutex;
extern std::unordered_map<std::string, GlassesEmaState> gGlassesEmaBySession;

extern std::mutex gAuthMutex;

/** @brief De dónde salió el access token de la request. Determina si hace falta CSRF. */
enum class AuthTokenSource {
  None,       ///< No había token.
  Header,     ///< `Authorization: Bearer <token>` — lo pone el cliente a propósito.
  Cookie,     ///< Cookie `access_token` — el navegador la adjunta sola (ADR-082).
  QueryParam, ///< `?auth_token=` — solo en el handshake WebSocket.
};

/** @brief Extrae el token de sesión y de dónde vino. @return El token (vacío si no hay) y su origen. */
std::string extractAuthTokenFromRequest(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query,
    AuthTokenSource *sourceOut = nullptr);

/**
 * @brief ¿La request trae un `X-CSRF-Token` que coincide con la cookie
 *        `csrf_token_v2`? (patrón double-submit).
 *
 * Un sitio de terceros puede lograr que el navegador ENVÍE la cookie, pero no
 * puede LEERLA (same-origin policy) para repetirla en el header.
 */
bool csrfTokenMatches(const http::request<http::string_body> &req);

/**
 * @brief ¿Debe rechazarse esta request por falta de CSRF válido?
 *
 * Solo aplica a peticiones que MUTAN estado (POST/PUT/PATCH/DELETE) y que se
 * autenticaron por COOKIE. Con `Authorization: Bearer` no hay riesgo CSRF: ese
 * header no lo adjunta el navegador solo, tiene que ponerlo el JS del propio
 * origen. Ver ADR-082.
 */
bool requiresCsrfRejection(const http::request<http::string_body> &req,
                           AuthTokenSource source);

/** @brief Reinicia el estado EMA de detección de lentes (ICAO) a sus valores iniciales. */
void resetGlassesEmaState(GlassesEmaState &s);

/** @brief Aplica suavizado EMA + histéresis a la probabilidad cruda de "sin lentes" de un frame, para evitar parpadeo del indicador cuadro a cuadro. @return true si el estado suavizado indica ausencia de lentes; `outEma` queda con la señal suavizada (0–100). */
bool applyIcaoGlassesEma(GlassesEmaState &s, double rawLikelihood,
                         bool faceDetected, double &outEma);

/** @brief Resuelve el rol RBAC asociado a un username (reglas hardcodeadas de bootstrap, p.ej. administradores conocidos). @return El rol resuelto, o el rol por defecto si no hay regla especial. */
std::string resolveRoleForUsername(const std::string &username);

/** @brief Genera un token opaco aleatorio criptográficamente no predecible (uso: refresh token crudo). */
std::string makeSessionToken();

/**
 * @brief Emite un par de tokens (ADR-029 revisado): access token JWT de vida
 * corta (claims: sub/username/company/role/tenant_id/jti) + refresh token
 * opaco de vida larga, persistido hasheado (Postgres) o en memoria (modo File).
 * @return El par de tokens emitido (el refresh token crudo solo se devuelve aquí).
 */
AuthTokenPair issueAuthSession(const AuthUser &user);

/**
 * @brief Intercambia un refresh token vigente por un par de tokens nuevo
 * (rotación estricta: el refresh token usado queda revocado de inmediato).
 * @return El par nuevo si el refresh token era válido; `std::nullopt` si no
 * existe, ya fue usado/revocado, o expiró — en ese caso el cliente debe
 * reautenticarse.
 */
std::optional<AuthTokenPair> refreshWithToken(const std::string &rawRefreshToken);

/** @brief Revoca de inmediato el access token (por su jti) y, si se provee, el refresh token asociado (logout explícito). */
void revokeAuthSession(const std::string &accessToken,
                       const std::string &rawRefreshToken = "");

/** @brief Revoca todos los refresh tokens vigentes de un usuario (logout global / incidente de seguridad, p.ej. cambio de contraseña forzado). */
void revokeAllSessionsForUser(const std::string &userId);

/** @brief Purga entradas de revocación de jti ya expiradas naturalmente (evita crecimiento sin límite) y estado EMA de lentes obsoleto. Se invoca de forma perezosa en cada `resolveAuthSession`. */
void pruneExpiredAuthSessions();

/**
 * @brief Resuelve la sesión activa a partir del access token JWT de la
 * request (ver `extractAuthTokenFromRequest`): verifica firma + expiración
 * localmente (sin I/O) y comprueba que su `jti` no esté en la lista de
 * revocación puntual.
 * @return La sesión (claims decodificados) si el token es válido, no expiró
 * y no fue revocado; `std::nullopt` en otro caso.
 */
std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query);

} // namespace auth
