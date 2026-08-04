#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>

#include <string>
#include <unordered_map>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;

namespace http_utils {

/** @brief Parsea una lista de orígenes separados por coma (recorta espacios, ignora entradas vacías). Función pura usada por `corsAllowedOrigins()` sobre el valor del env var; separada para poder testearla sin depender de `getenv`. */
std::vector<std::string> parseCorsOriginsList(const std::string &raw);

/** @brief Lista de orígenes permitidos para CORS (env `BEEMETRY_CORS_ALLOWED_ORIGIN`, separados por coma; default local seguro). Soporta múltiples frontends (p.ej. una segunda app en otro subdominio) sin volver al wildcard `*`. */
const std::vector<std::string> &corsAllowedOrigins();

/** @brief Primer origen de `corsAllowedOrigins()` — usado como default por handlers sin contexto de request (`applyCorsHeaders()` interno) y por los 2-3 call sites que aún arman su respuesta manualmente en vez de usar make*Response(). El origen real por request se corrige después en `router::Router::dispatch()` vía `resolveCorsOrigin()`. */
const std::string &corsAllowedOrigin();

/** @brief Si `requestOrigin` coincide exactamente con una entrada de `corsAllowedOrigins()`, la retorna (reflejo seguro para CORS con credenciales); si no matchea o viene vacío, retorna cadena vacía ("no reflejar" — el caller debe dejar el header default sin tocar). */
std::string resolveCorsOrigin(const std::string &requestOrigin);

int hexToInt(char c);

std::string urlDecode(const std::string &src);

std::unordered_map<std::string, std::string>
parseQueryString(const std::string &target);

std::string routePathOnly(const std::string &target);

std::string nowIso8601();

std::string toLowerCopy(std::string value);

std::vector<std::string> splitCsvLower(const std::string &csv);

/** Identificador no secreto: 128 bits, 32 caracteres hexadecimales. */
std::string makeId();

/** Secreto criptográfico generado con OpenSSL RAND_bytes. Falla cerrado. */
std::string secureRandomHex(std::size_t bytes);

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue);

std::string hashPassword(const std::string &password);
std::string legacyHashPassword(const std::string &password);
bool verifyPassword(const std::string &password,
                    const std::string &storedHash);
bool passwordNeedsRehash(const std::string &storedHash);

/** @brief Prefijo de un hash legado ya envuelto en Argon2id. */
inline constexpr const char *kWrappedLegacyPrefix = "legacy1:";

/**
 * @brief Envuelve un hash legado en Argon2id, sin necesitar la contraseña.
 *
 * El esquema legado es `std::hash<std::string>(salt + "::" + password)` en
 * hexadecimal: 64 bits, NO criptográfico, sin estiramiento de clave y con un
 * salt FIJO compartido por todas las cuentas. Un volcado de `auth_users` con
 * hashes así equivale prácticamente a tener las contraseñas en claro — se
 * recuperan a miles de millones por segundo y el salt fijo permite reutilizar
 * la misma tabla para todos los usuarios.
 *
 * No se puede convertir a un Argon2id "real" sin la contraseña en claro, que
 * el servidor no tiene. Lo que sí se puede hacer, y de inmediato para TODAS
 * las filas, es dejar de almacenar ese valor débil: se guarda
 * `Argon2id(hash_legado)` con el prefijo `legacy1:`. En reposo ya no queda
 * nada que se pueda romper offline. Al siguiente login correcto,
 * `passwordNeedsRehash` fuerza el reemplazo por un Argon2id auténtico de la
 * contraseña, y la envoltura desaparece.
 *
 * @param legacyHash Hash legado tal cual está en la BD (hex).
 * @return Cadena `legacy1:$argon2id$...` lista para persistir.
 */
std::string wrapLegacyHash(const std::string &legacyHash);

/** @brief ¿`storedHash` es un hash legado envuelto (prefijo `legacy1:`)? */
bool isWrappedLegacyHash(const std::string &storedHash);

/** @brief ¿`storedHash` es un hash legado CRUDO (ni Argon2id ni envuelto)? */
bool isRawLegacyHash(const std::string &storedHash);

bool isValidDni(const std::string &dni);

double cosineSimilarity(const std::vector<double> &a,
                        const std::vector<double> &b);

std::string csvEscape(const std::string &v);

/** @brief PQgetvalue() de una columna NULL devuelve "" (no nullptr); std::stod
 * sobre eso lanza std::invalid_argument, reportado por el router como 500
 * genérico. Parseo defensivo con fallback — usar en vez de std::stod al leer
 * columnas nullable de Postgres. */
double safeStod(const char *value, double fallback = 0.0);

/** @brief Igual que safeStod pero para std::stoi. */
int safeStoi(const char *value, int fallback = 0);

http::response<http::string_body> makeJsonResponse(http::status status,
                                                   const json::value &value);

/** @brief Lee el valor de una cookie por nombre del header `Cookie` de la request (ADR-029, "Actualización 2026-07-19"). @return El valor, o cadena vacía si no está presente. */
std::string extractCookie(const http::request<http::string_body> &req,
                          const std::string &name);

/**
 * @brief Agrega a `res` las dos cookies de la sesión de refresh (ADR-029,
 * "Actualización 2026-07-19"): `refresh_token` (HttpOnly, ilegible por JS —
 * mitiga robo vía XSS) y `csrf_token_v2` (legible por JS a propósito — patrón
 * double-submit cookie: el cliente debe repetirlo en el header
 * `X-CSRF-Token` al llamar /api/auth/refresh o /api/auth/logout). Ambas con
 * `Secure` (según `AppConfig::gAuthCookieSecure`), `SameSite=Strict` y
 * `refresh_token` usa `Path=/api/auth`; `csrf_token_v2` usa `Path=/` para que
 * la SPA pueda leerla desde cualquier ruta y enviarla en `X-CSRF-Token`.
 */
void setAuthCookies(http::response<http::string_body> &res,
                    const std::string &refreshToken, const std::string &csrfToken,
                    int maxAgeSeconds);

/**
 * @brief Agrega a `res` la cookie `access_token` (HttpOnly, `Path=/`).
 *
 * ADR-082 (auditoría 2026-08-02): el access token deja de guardarse en
 * `localStorage`, donde cualquier XSS podía leerlo y exfiltrarlo para
 * reutilizar la sesión desde fuera. `maxAgeSeconds` debe ser el TTL del access
 * token (no el del refresh): la cookie caduca con él.
 */
void setAccessTokenCookie(http::response<http::string_body> &res,
                          const std::string &accessToken, int maxAgeSeconds);

/** @brief Vence de inmediato (`Max-Age=0`) las cookies de `setAuthCookies` y `setAccessTokenCookie` — usar en logout o cuando el refresh token resulta inválido. */
void clearAuthCookies(http::response<http::string_body> &res);

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv);

http::response<http::string_body> makeJpegResponse(std::string jpegBytes);
http::response<http::string_body> makePngResponse(std::string pngBytes);

/** @brief Respuesta 200 con Content-Type application/pdf y Content-Disposition attachment (descarga directa). Si `userPassword` no viene vacío (ADR-080: PDF cifrado por el sidecar), se agrega como header `X-Pdf-Password` — nunca en el cuerpo ni persistido. */
http::response<http::string_body> makePdfResponse(const std::string &filename,
                                                  std::string pdfBytes,
                                                  const std::string &userPassword = std::string());

/** @brief Respuesta binaria genérica (application/octet-stream) con descarga
 * directa — usada para contenedores propietarios como `.mreport` que no
 * deben tener un Content-Type reconocible/abrible por otra herramienta. */
http::response<http::string_body> makeOctetResponse(const std::string &filename,
                                                     std::string bytes);

} // namespace http_utils
