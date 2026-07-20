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

/** @brief Origen permitido para CORS (env `BEEMETRY_CORS_ALLOWED_ORIGIN`, default "*") — reutilizado por handlers que construyen su respuesta manualmente en vez de usar make*Response(). */
const std::string &corsAllowedOrigin();

int hexToInt(char c);

std::string urlDecode(const std::string &src);

std::unordered_map<std::string, std::string>
parseQueryString(const std::string &target);

std::string routePathOnly(const std::string &target);

std::string nowIso8601();

std::string toLowerCopy(std::string value);

std::vector<std::string> splitCsvLower(const std::string &csv);

std::string makeId();

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue);

std::string hashPassword(const std::string &password);

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
 * mitiga robo vía XSS) y `csrf_token` (legible por JS a propósito — patrón
 * double-submit cookie: el cliente debe repetirlo en el header
 * `X-CSRF-Token` al llamar /api/auth/refresh o /api/auth/logout). Ambas con
 * `Secure` (según `AppConfig::gAuthCookieSecure`), `SameSite=Strict` y
 * `Path=/api/auth` (acotadas a los únicos endpoints que las consumen).
 */
void setAuthCookies(http::response<http::string_body> &res,
                    const std::string &refreshToken, const std::string &csrfToken,
                    int maxAgeSeconds);

/** @brief Vence de inmediato (`Max-Age=0`) las cookies de `setAuthCookies` — usar en logout o cuando el refresh token resulta inválido. */
void clearAuthCookies(http::response<http::string_body> &res);

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv);

http::response<http::string_body> makeJpegResponse(std::string jpegBytes);

/** @brief Respuesta 200 con Content-Type application/pdf y Content-Disposition attachment (descarga directa). */
http::response<http::string_body> makePdfResponse(const std::string &filename,
                                                  std::string pdfBytes);

/** @brief Respuesta binaria genérica (application/octet-stream) con descarga
 * directa — usada para contenedores propietarios como `.mreport` que no
 * deben tener un Content-Type reconocible/abrible por otra herramienta. */
http::response<http::string_body> makeOctetResponse(const std::string &filename,
                                                     std::string bytes);

} // namespace http_utils
