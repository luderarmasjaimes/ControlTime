#include "http_utils.hpp"
#include "../config/app_config.hpp"

#include <argon2.h>
#include <openssl/crypto.h>
#include <openssl/rand.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <limits>
#include <random>
#include <sstream>

namespace http_utils {

// CORS (auditoría de seguridad 2026-07-13): antes hardcodeado a "*" en las 4
// respuestas de abajo, en todas las respuestas de la API (incluidas las
// autenticadas) — sin capacidad de restringirlo. La app real es same-origin
// (nginx proxifica /api al backend, ver ADR-033/backendBaseUrl()), así que el
// wildcard no beneficia al frontend legítimo. Configurable por entorno; el
// default seguro permite únicamente el frontend local.
//
// ADR-081: el mismo env var ahora admite una lista separada por comas, para
// soportar una segunda app frontend (repo aparte, mismo backend) sin volver
// al wildcard. Un solo valor sigue funcionando exactamente igual que antes
// (retrocompatible). `router::Router::dispatch()` refleja, por request, cuál
// de estos orígenes coincide con el header `Origin` entrante.
std::vector<std::string> parseCorsOriginsList(const std::string &raw) {
    std::vector<std::string> parsed;
    size_t pos = 0;
    while (pos <= raw.size()) {
        const size_t comma = raw.find(',', pos);
        const std::string piece =
            raw.substr(pos, comma == std::string::npos ? std::string::npos : comma - pos);
        const size_t begin = piece.find_first_not_of(" \t");
        const size_t end = piece.find_last_not_of(" \t");
        if (begin != std::string::npos) {
            parsed.push_back(piece.substr(begin, end - begin + 1));
        }
        if (comma == std::string::npos) break;
        pos = comma + 1;
    }
    if (parsed.empty()) parsed.push_back("http://localhost:5173");
    return parsed;
}

const std::vector<std::string> &corsAllowedOrigins() {
    static const std::vector<std::string> origins = parseCorsOriginsList(
        config::getenvOr("BEEMETRY_CORS_ALLOWED_ORIGIN", "http://localhost:5173"));
    return origins;
}

const std::string &corsAllowedOrigin() {
    return corsAllowedOrigins().front();
}

std::string resolveCorsOrigin(const std::string &requestOrigin) {
    if (requestOrigin.empty()) return {};
    const auto &allowed = corsAllowedOrigins();
    if (std::find(allowed.begin(), allowed.end(), requestOrigin) != allowed.end()) {
        return requestOrigin;
    }
    return {};
}

int hexToInt(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}

std::string urlDecode(const std::string &src) {
    std::string out;
    out.reserve(src.size());
    for (size_t i = 0; i < src.size(); ++i) {
        if (src[i] == '+') {
            out.push_back(' ');
            continue;
        }
        if (src[i] == '%' && i + 2 < src.size()) {
            const int hi = hexToInt(src[i + 1]);
            const int lo = hexToInt(src[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(src[i]);
    }
    return out;
}

std::unordered_map<std::string, std::string>
parseQueryString(const std::string &target) {
    std::unordered_map<std::string, std::string> out;
    const auto qPos = target.find('?');
    if (qPos == std::string::npos || qPos + 1 >= target.size()) {
        return out;
    }

    std::string query = target.substr(qPos + 1);
    std::stringstream ss(query);
    std::string pair;
    while (std::getline(ss, pair, '&')) {
        if (pair.empty()) {
            continue;
        }
        const auto eq = pair.find('=');
        if (eq == std::string::npos) {
            out[urlDecode(pair)] = "";
            continue;
        }
        out[urlDecode(pair.substr(0, eq))] = urlDecode(pair.substr(eq + 1));
    }
    return out;
}

std::string routePathOnly(const std::string &target) {
    const auto qPos = target.find('?');
    return qPos == std::string::npos ? target : target.substr(0, qPos);
}

std::string nowIso8601() {
    auto now = std::chrono::system_clock::now();
    std::time_t tt = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &tt);
#else
    gmtime_r(&tt, &utc);
#endif
    std::ostringstream oss;
    oss << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

std::string toLowerCopy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

std::vector<std::string> splitCsvLower(const std::string &csv) {
    std::vector<std::string> out;
    std::stringstream ss(csv);
    std::string item;
    while (std::getline(ss, item, ',')) {
        auto first = item.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) {
            continue;
        }
        auto last = item.find_last_not_of(" \t\r\n");
        out.push_back(toLowerCopy(item.substr(first, last - first + 1)));
    }
    return out;
}

std::string makeId() {
    return secureRandomHex(16);
}

std::string secureRandomHex(std::size_t bytes) {
    if (bytes == 0) return {};
    if (bytes > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        throw std::invalid_argument("secureRandomHex size is too large");
    }
    std::vector<unsigned char> random(bytes);
    if (RAND_bytes(random.data(), static_cast<int>(random.size())) != 1) {
        throw std::runtime_error("OpenSSL CSPRNG unavailable");
    }
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (const auto value : random) {
        oss << std::setw(2) << static_cast<unsigned int>(value);
    }
    return oss.str();
}

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue) {
    if (std::find(issues.begin(), issues.end(), issue) == issues.end()) {
        issues.push_back(issue);
    }
}

std::string legacyHashPassword(const std::string &password) {
    static const std::string salt = config::getenvOr(
        "BEEMETRY_AUTH_LEGACY_PASSWORD_SALT",
        config::getenvOr("BEEMETRY_AUTH_PASSWORD_SALT",
                         "mining_local_salt_change_me"));
    const auto mixed = salt + "::" + password;
    const auto hashed = std::hash<std::string>{}(mixed);
    std::ostringstream oss;
    oss << std::hex << hashed;
    return oss.str();
}

namespace {

std::uint32_t passwordCost(const char *name, std::uint32_t fallback,
                           std::uint32_t minimum, std::uint32_t maximum) {
    try {
        const auto raw = config::getenvOr(name, std::to_string(fallback));
        const auto value = static_cast<std::uint32_t>(std::stoul(raw));
        return std::clamp(value, minimum, maximum);
    } catch (...) {
        return fallback;
    }
}

bool constantTimeEquals(const std::string &left, const std::string &right) {
    if (left.size() != right.size()) return false;
    return CRYPTO_memcmp(left.data(), right.data(), left.size()) == 0;
}

} // namespace

std::string hashPassword(const std::string &password) {
    const auto timeCost =
        passwordCost("BEEMETRY_ARGON2_TIME_COST", 3, 1, 10);
    const auto memoryKiB =
        passwordCost("BEEMETRY_ARGON2_MEMORY_KIB", 65536, 8192, 1048576);
    const auto parallelism =
        passwordCost("BEEMETRY_ARGON2_PARALLELISM", 1, 1, 16);
    constexpr std::size_t saltBytes = 16;
    constexpr std::size_t hashBytes = 32;
    std::vector<unsigned char> salt(saltBytes);
    if (RAND_bytes(salt.data(), static_cast<int>(salt.size())) != 1) {
        throw std::runtime_error("OpenSSL CSPRNG unavailable for password salt");
    }
    const auto encodedBytes = argon2_encodedlen(
        timeCost, memoryKiB, parallelism, saltBytes, hashBytes, Argon2_id);
    std::string encoded(encodedBytes, '\0');
    const int rc = argon2id_hash_encoded(
        timeCost, memoryKiB, parallelism, password.data(), password.size(),
        salt.data(), salt.size(), hashBytes, encoded.data(), encoded.size());
    if (rc != ARGON2_OK) {
        throw std::runtime_error(
            std::string("Argon2id password hashing failed: ") +
            argon2_error_message(rc));
    }
    encoded.resize(std::char_traits<char>::length(encoded.c_str()));
    return encoded;
}

bool isWrappedLegacyHash(const std::string &storedHash) {
    return storedHash.rfind(kWrappedLegacyPrefix, 0) == 0;
}

bool isRawLegacyHash(const std::string &storedHash) {
    return storedHash.rfind("$argon2id$", 0) != 0 && !isWrappedLegacyHash(storedHash);
}

std::string wrapLegacyHash(const std::string &legacyHash) {
    return std::string(kWrappedLegacyPrefix) + hashPassword(legacyHash);
}

bool verifyPassword(const std::string &password,
                    const std::string &storedHash) {
    if (storedHash.rfind("$argon2id$", 0) == 0) {
        return argon2id_verify(storedHash.c_str(), password.data(),
                               password.size()) == ARGON2_OK;
    }
    // Hash legado envuelto: se recalcula el hash legado de la contraseña y se
    // verifica contra la envoltura Argon2id. El resultado es idéntico al del
    // esquema legado desde el punto de vista del usuario, pero lo que está
    // almacenado ya no es material atacable offline.
    if (isWrappedLegacyHash(storedHash)) {
        const std::string inner = storedHash.substr(
            std::char_traits<char>::length(kWrappedLegacyPrefix));
        const std::string legacy = legacyHashPassword(password);
        return argon2id_verify(inner.c_str(), legacy.data(), legacy.size()) ==
               ARGON2_OK;
    }
    return constantTimeEquals(legacyHashPassword(password), storedHash);
}

bool passwordNeedsRehash(const std::string &storedHash) {
    // Tanto el legado crudo como el envuelto deben sustituirse por un Argon2id
    // auténtico de la contraseña en cuanto se disponga de ella (login correcto).
    // La envoltura protege el dato en reposo, pero sigue derivando de un hash de
    // 64 bits: solo el rehash real con la contraseña cierra el hueco del todo.
    return storedHash.rfind("$argon2id$", 0) != 0;
}

bool isValidDni(const std::string &dni) {
    if (dni.size() < 8 || dni.size() > 12) {
        return false;
    }
    return std::all_of(dni.begin(), dni.end(), [](unsigned char c) {
        return std::isdigit(c) != 0;
    });
}

double cosineSimilarity(const std::vector<double> &a,
                        const std::vector<double> &b) {
    if (a.empty() || a.size() != b.size()) {
        return -1.0;
    }

    double dot = 0.0;
    double normA = 0.0;
    double normB = 0.0;

    for (size_t i = 0; i < a.size(); ++i) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA == 0.0 || normB == 0.0) {
        return -1.0;
    }

    return dot / (std::sqrt(normA) * std::sqrt(normB));
}

double safeStod(const char *value, double fallback) {
    if (!value || !*value) return fallback;
    try {
        return std::stod(value);
    } catch (const std::exception &) {
        return fallback;
    }
}

int safeStoi(const char *value, int fallback) {
    if (!value || !*value) return fallback;
    try {
        return std::stoi(value);
    } catch (const std::exception &) {
        return fallback;
    }
}

std::string csvEscape(const std::string &v) {
    bool mustQuote = v.find(',') != std::string::npos ||
                     v.find('"') != std::string::npos ||
                     v.find('\n') != std::string::npos;
    if (!mustQuote) {
        return v;
    }
    std::string out = "\"";
    for (char c : v) {
        if (c == '"') out += "\"\"";
        else out.push_back(c);
    }
    out += "\"";
    return out;
}

std::string extractCookie(const http::request<http::string_body> &req,
                          const std::string &name) {
    const auto it = req.find(http::field::cookie);
    if (it == req.end()) {
        return {};
    }
    const std::string header(it->value());
    // Formato: "a=1; b=2; c=3" -- se busca el par cuya clave (tras recortar
    // espacios a la izquierda) coincide EXACTO con `name`, no un prefijo, así
    // "csrf_token_old=x; csrf_token=y" no matchea de más.
    std::size_t pos = 0;
    while (pos <= header.size()) {
        const auto sep = header.find(';', pos);
        const std::string pair = header.substr(
            pos, sep == std::string::npos ? std::string::npos : sep - pos);
        const auto eq = pair.find('=');
        if (eq != std::string::npos) {
            const auto keyStart = pair.find_first_not_of(' ');
            if (keyStart != std::string::npos && keyStart < eq) {
                if (pair.compare(keyStart, eq - keyStart, name) == 0) {
                    return pair.substr(eq + 1);
                }
            }
        }
        if (sep == std::string::npos) {
            break;
        }
        pos = sep + 1;
    }
    return {};
}

namespace {
template <class Body>
void applyCorsHeaders(http::response<Body> &res) {
    const auto &origin = corsAllowedOrigin();
    res.set(http::field::access_control_allow_origin, origin);
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization,x-csrf-token");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    // Sin esto, fetch/axios en el navegador NO puede leer estos headers de
    // respuesta en requests cross-origin (Content-Disposition/X-Pdf-Password
    // ya llegan igual en same-origin, pero se expone por robustez — ADR-080
    // los necesita para mostrarle la contraseña del PDF al usuario).
    res.set("Access-Control-Expose-Headers", "Content-Disposition,X-Pdf-Password");
    if (origin != "*") {
        res.set(http::field::access_control_allow_credentials, "true");
        res.set(http::field::vary, "Origin");
    }
}

std::string buildCookieHeader(const std::string &name, const std::string &value,
                              int maxAgeSeconds, bool httpOnly,
                              const std::string &path) {
    std::ostringstream oss;
    oss << name << "=" << value << "; Path=" << path << "; Max-Age=" << maxAgeSeconds
        << "; SameSite=Strict";
    if (config::AppConfig::instance().gAuthCookieSecure) {
        oss << "; Secure";
    }
    if (httpOnly) {
        oss << "; HttpOnly";
    }
    return oss.str();
}
} // namespace

void setAccessTokenCookie(http::response<http::string_body> &res,
                          const std::string &accessToken, int maxAgeSeconds) {
    // ADR-082 (auditoría de seguridad 2026-08-02): el access token pasa a
    // viajar en una cookie HttpOnly. Antes vivía en localStorage, así que
    // CUALQUIER XSS en la SPA — una celda de informe envenenada, una
    // dependencia comprometida — podía leerlo y exfiltrarlo, y con él la
    // sesión completa. Una cookie HttpOnly no es legible por `document.cookie`
    // ni por `fetch` desde el JS de la página: un XSS puede seguir haciendo
    // peticiones en nombre del usuario mientras la pestaña está abierta, pero
    // ya no puede LLEVARSE la credencial a un servidor propio y reutilizarla
    // después, que es lo que convierte un XSS puntual en una toma de cuenta
    // persistente.
    //
    // Path=/ (no /api/auth como refresh_token): la cookie tiene que
    // acompañar a TODA petición autenticada de la API, no solo a las de auth.
    res.insert(http::field::set_cookie,
               buildCookieHeader("access_token", accessToken, maxAgeSeconds, true, "/"));
}

void setAuthCookies(http::response<http::string_body> &res,
                    const std::string &refreshToken, const std::string &csrfToken,
                    int maxAgeSeconds) {
    // refresh_token es HttpOnly y solo lo necesita /api/auth/refresh -- se
    // mantiene acotado a ese path (superficie mínima). csrf_token, en
    // cambio, DEBE ser legible por `document.cookie` desde cualquier página
    // de la SPA (authStorage.ts::readCookie, ejecutado en rutas como "/" o
    // "/report", nunca "/api/auth") para poder repetirlo en el header
    // X-CSRF-Token del patrón double-submit -- con Path=/api/auth (bug
    // previo) el navegador jamás exponía la cookie a ese JS, por lo que
    // TODO refresh fallaba con 403 csrf_token_mismatch en cuanto el access
    // token de 15 min vencía, forzando un logout silencioso repetido
    // ("Sesión expirada...") pese a que el usuario seguía autenticado.
    res.insert(http::field::set_cookie,
              buildCookieHeader("refresh_token", refreshToken, maxAgeSeconds, true, "/api/auth"));
    // "csrf_token_v2": ver comentario en csrfHeaderMatchesCookie (main.cpp) --
    // nombre nuevo a propósito, no solo Path nuevo, para que sesiones activas
    // desde antes de este fix (con la cookie vieja `csrf_token` Path=/api/auth
    // aún viva hasta 7 días) se autoreparen de inmediato sin esperar a que esa
    // cookie expire ni requerir un logout manual.
    res.insert(http::field::set_cookie,
              buildCookieHeader("csrf_token_v2", csrfToken, maxAgeSeconds, false, "/"));
}

void clearAuthCookies(http::response<http::string_body> &res) {
    // El Path debe coincidir EXACTO con el usado al setear cada cookie --
    // un navegador no borra una cookie si el Path de este Set-Cookie no
    // calza con el original (son cookies "distintas" a efectos de borrado).
    res.insert(http::field::set_cookie, buildCookieHeader("access_token", "", 0, true, "/"));
    res.insert(http::field::set_cookie, buildCookieHeader("refresh_token", "", 0, true, "/api/auth"));
    res.insert(http::field::set_cookie, buildCookieHeader("csrf_token_v2", "", 0, false, "/"));
    // Limpieza de higiene del nombre/Path viejo (`csrf_token`, Path=/api/auth
    // — bug corregido hoy, ver csrfHeaderMatchesCookie): ya no lo lee nadie,
    // pero un logout es buen momento para purgarlo si aún sigue vivo en el
    // navegador de una sesión iniciada antes del fix.
    res.insert(http::field::set_cookie, buildCookieHeader("csrf_token", "", 0, false, "/api/auth"));
}

http::response<http::string_body> makeJsonResponse(http::status status,
                                                   const json::value &value) {
    http::response<http::string_body> res{status, 11};
    res.set(http::field::content_type, "application/json");
    applyCorsHeaders(res);
    res.body() = json::serialize(value);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "text/csv; charset=utf-8");
    applyCorsHeaders(res);
    res.set(http::field::content_disposition,
            "attachment; filename=\"" + filename + "\"");
    res.body() = csv;
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makePdfResponse(const std::string &filename,
                                                  std::string pdfBytes,
                                                  const std::string &userPassword) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "application/pdf");
    applyCorsHeaders(res);
    res.set(http::field::content_disposition,
            "attachment; filename=\"" + filename + "\"");
    // ADR-080: contraseña de apertura del PDF (cifrado por el sidecar con
    // qpdf) — se entrega una sola vez vía header, nunca se guarda server-side.
    if (!userPassword.empty()) {
        res.set("X-Pdf-Password", userPassword);
    }
    res.body() = std::move(pdfBytes);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makeOctetResponse(const std::string &filename,
                                                     std::string bytes) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "application/octet-stream");
    applyCorsHeaders(res);
    res.set(http::field::content_disposition,
            "attachment; filename=\"" + filename + "\"");
    res.set("X-Content-Type-Options", "nosniff");
    res.body() = std::move(bytes);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makeJpegResponse(std::string jpegBytes) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "image/jpeg");
    applyCorsHeaders(res);
    res.body() = std::move(jpegBytes);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makePngResponse(std::string pngBytes) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "image/png");
    res.set(http::field::cache_control, "private, max-age=86400");
    applyCorsHeaders(res);
    res.set("X-Content-Type-Options", "nosniff");
    res.body() = std::move(pngBytes);
    res.prepare_payload();
    return res;
}

} // namespace http_utils
