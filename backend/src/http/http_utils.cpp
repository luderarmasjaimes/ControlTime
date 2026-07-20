#include "http_utils.hpp"
#include "../config/app_config.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <random>
#include <sstream>

namespace http_utils {

// CORS (auditoría de seguridad 2026-07-13): antes hardcodeado a "*" en las 4
// respuestas de abajo, en todas las respuestas de la API (incluidas las
// autenticadas) — sin capacidad de restringirlo. La app real es same-origin
// (nginx proxifica /api al backend, ver ADR-033/backendBaseUrl()), así que el
// wildcard no beneficia al frontend legítimo, solo abre la puerta a que un
// sitio de terceros lea respuestas de endpoints sin auth desde el navegador
// de una víctima. Configurable por entorno para poder acotarlo en producción
// sin adivinar el dominio real desde aquí; default "*" preserva el
// comportamiento actual hasta que se fije un valor explícito.
const std::string &corsAllowedOrigin() {
    static const std::string origin =
        config::getenvOr("BEEMETRY_CORS_ALLOWED_ORIGIN", "*");
    return origin;
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
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    std::uniform_int_distribution<unsigned long long> dist;
    std::ostringstream oss;
    oss << std::hex << dist(rng) << dist(rng);
    return oss.str();
}

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue) {
    if (std::find(issues.begin(), issues.end(), issue) == issues.end()) {
        issues.push_back(issue);
    }
}

std::string hashPassword(const std::string &password) {
    static const std::string salt =
        config::getenvOr("BEEMETRY_AUTH_PASSWORD_SALT", "mining_local_salt_change_me");
    const auto mixed = salt + "::" + password;
    const auto hashed = std::hash<std::string>{}(mixed);
    std::ostringstream oss;
    oss << std::hex << hashed;
    return oss.str();
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
std::string buildCookieHeader(const std::string &name, const std::string &value,
                              int maxAgeSeconds, bool httpOnly) {
    std::ostringstream oss;
    oss << name << "=" << value << "; Path=/api/auth; Max-Age=" << maxAgeSeconds
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

void setAuthCookies(http::response<http::string_body> &res,
                    const std::string &refreshToken, const std::string &csrfToken,
                    int maxAgeSeconds) {
    res.insert(http::field::set_cookie,
              buildCookieHeader("refresh_token", refreshToken, maxAgeSeconds, true));
    res.insert(http::field::set_cookie,
              buildCookieHeader("csrf_token", csrfToken, maxAgeSeconds, false));
}

void clearAuthCookies(http::response<http::string_body> &res) {
    res.insert(http::field::set_cookie, buildCookieHeader("refresh_token", "", 0, true));
    res.insert(http::field::set_cookie, buildCookieHeader("csrf_token", "", 0, false));
}

http::response<http::string_body> makeJsonResponse(http::status status,
                                                   const json::value &value) {
    http::response<http::string_body> res{status, 11};
    res.set(http::field::content_type, "application/json");
    res.set(http::field::access_control_allow_origin, corsAllowedOrigin());
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.body() = json::serialize(value);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "text/csv; charset=utf-8");
    res.set(http::field::access_control_allow_origin, corsAllowedOrigin());
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.set(http::field::content_disposition,
            "attachment; filename=\"" + filename + "\"");
    res.body() = csv;
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makePdfResponse(const std::string &filename,
                                                  std::string pdfBytes) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "application/pdf");
    res.set(http::field::access_control_allow_origin, corsAllowedOrigin());
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.set(http::field::content_disposition,
            "attachment; filename=\"" + filename + "\"");
    res.body() = std::move(pdfBytes);
    res.prepare_payload();
    return res;
}

http::response<http::string_body> makeOctetResponse(const std::string &filename,
                                                     std::string bytes) {
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "application/octet-stream");
    res.set(http::field::access_control_allow_origin, corsAllowedOrigin());
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
    res.set(http::field::access_control_allow_origin, corsAllowedOrigin());
    res.set(http::field::access_control_allow_headers,
            "content-type,authorization");
    res.set(http::field::access_control_allow_methods,
            "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.body() = std::move(jpegBytes);
    res.prepare_payload();
    return res;
}

} // namespace http_utils
