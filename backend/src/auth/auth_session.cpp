#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "jwt.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../security/security_alerts.hpp"

#include <algorithm>
#include <cctype>
#include <ctime>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace auth {

std::mutex gGlassesEmaMutex;
std::unordered_map<std::string, GlassesEmaState> gGlassesEmaBySession;

std::mutex gAuthMutex;

// ── ADR-029 (revisado): revocación puntual de access tokens ──────────────
// Solo guarda jti revocados ANTES de su expiración natural (logout,
// incidente de seguridad) — en operación normal está vacío o casi vacío,
// a diferencia del mapa de sesiones completo que reemplaza. Cada entrada se
// purga sola cuando pasa `expiresAt` (el jti ya no sería válido de todas
// formas), así que el tamaño está acotado por la ventana de TTL del access
// token, no por el número total de logins históricos.
static std::mutex gRevokedJtiMutex;
static std::unordered_map<std::string, std::chrono::system_clock::time_point>
    gRevokedJti;

// ── Modo File (sin Postgres): refresh tokens solo en memoria del proceso ──
// Igual que el resto del modo File (dev/offline), no hay persistencia real
// entre reinicios — es un fallback de desarrollo, no la ruta de producción.
namespace {
struct FileRefreshTokenEntry {
  AuthUser user;
  std::chrono::system_clock::time_point expiresAt;
  bool revoked = false;
};
std::mutex gFileRefreshTokensMutex;
std::unordered_map<std::string, FileRefreshTokenEntry> gFileRefreshTokens;
} // namespace

namespace {

/**
 * @brief ¿Es esta request el handshake de upgrade a WebSocket?
 *
 * Se comprueba `Upgrade: websocket` (case-insensitive, RFC 6455 §4.2.1) sobre
 * la request cruda, sin depender de Boost.Beast, para poder usarlo también
 * desde rutas HTTP normales.
 */
bool isWebSocketUpgrade(const http::request<http::string_body> &req) {
  const auto it = req.find(http::field::upgrade);
  if (it == req.end()) return false;
  std::string value(it->value());
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value.find("websocket") != std::string::npos;
}

/**
 * @brief ¿Esta request cruza "sites" según la cabecera Fetch Metadata
 *        `Sec-Fetch-Site` (enviada por todo navegador moderno, no
 *        falsificable desde JS -- a diferencia de `Origin`/`Referer`, que un
 *        atacante server-side sí puede fabricar en curl/etc.)?
 *
 * Hallazgo de red-team (2026-08-26): una página en http://localhost:9091
 * (otro puerto, mismo "site" que localhost:5173 -- SameSite se basa en
 * dominio registrable, el puerto NO cuenta) pudo leer datos reales de la
 * víctima desde `GET /api/auth/permissions` porque el navegador SÍ adjunta
 * una cookie `SameSite=Strict` en ese caso (es "same-site", solo distinto
 * origen/puerto). `Sec-Fetch-Site` sí distingue esto: vale "same-origin"
 * solo cuando el origen completo (esquema+host+puerto) coincide, "same-site"
 * para el caso de arriba (mismo site, distinto puerto/subdominio), y
 * "cross-site"/"none" para el resto. Se falla ABIERTO si la cabecera no
 * viene (clientes no-navegador que ya dependen del fallback de cookie,
 * p.ej. integraciones server-to-server previas) -- el objetivo es cerrar el
 * vector real de navegador, no romper compatibilidad con quien no la manda.
 */
bool isCrossSiteCookieRequest(const http::request<http::string_body> &req) {
  const auto it = req.find("Sec-Fetch-Site");
  if (it == req.end()) return false;
  const std::string value(it->value());
  return value != "same-origin" && value != "none";
}

}  // namespace

std::string extractAuthTokenFromRequest(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query,
    AuthTokenSource *sourceOut) {
  const auto emit = [sourceOut](AuthTokenSource s, std::string token) {
    if (sourceOut != nullptr) *sourceOut = s;
    return token;
  };
  if (sourceOut != nullptr) *sourceOut = AuthTokenSource::None;

  // El header Authorization es SIEMPRE la vía preferente: lo usan los clientes
  // de API/integraciones y no está sujeto a CSRF.
  if (auto auth = req.find(http::field::authorization); auth != req.end()) {
    const std::string value(auth->value());
    static const std::string kBearer = "Bearer ";
    if (value.rfind(kBearer, 0) == 0) {
      const std::string bearer = value.substr(kBearer.size());
      // Un "Bearer " vacío se ignora y se sigue con la cookie. Durante la
      // migración a cookies (ADR-082) hay clientes que arman el header a
      // partir de un token que ya no guardan; sin esta guarda, ese header
      // vacío ganaría a la cookie válida y los dejaría sin sesión.
      if (!bearer.empty()) {
        return emit(AuthTokenSource::Header, bearer);
      }
    }
  }

  // Cookie HttpOnly `beemetry_access_token` (ADR-082, renombrada en la
  // migración a Bearer-en-memoria): vía de compatibilidad -- el frontend
  // real de la plataforma ya prefiere el header Authorization (arriba), pero
  // esta cookie se sigue aceptando para integraciones que aún dependan de
  // ella. El JS de la página no puede leerla, así que un XSS no puede
  // exfiltrar la sesión a través de esta vía.
  //
  // Pero SÍ puede usarse desde OTRA aplicación en el mismo "site" (mismo
  // dominio registrable, distinto puerto/subdominio -- SameSite=Strict no
  // distingue eso, ver isCrossSiteCookieRequest arriba): confirmado en vivo
  // el 2026-08-26. Por eso la cookie solo se acepta cuando la request es
  // same-origin/same-site real; una request cross-site cae al fallback de
  // abajo (WS/query param) o directamente sin sesión -- el llamador legítimo
  // cross-app siempre tiene la opción de usar el header Authorization, que
  // no depende en absoluto de "site" y no se ve afectado por esta guarda.
  if (!isCrossSiteCookieRequest(req)) {
    if (const std::string cookieToken = http_utils::extractCookie(req, "beemetry_access_token");
        !cookieToken.empty()) {
      return emit(AuthTokenSource::Cookie, cookieToken);
    }
  } else if (!http_utils::extractCookie(req, "beemetry_access_token").empty()) {
    // Señal real de ataque, no ruido: solo se llega aquí cuando el navegador
    // SÍ tenía la cookie de sesión para adjuntar (la víctima está logueada) y
    // la request viene de otro site -- exactamente el patrón del intento de
    // lectura cross-site del red-team. Se registra para poder alertar/
    // auditar, aunque la request en sí siga su camino sin sesión (fail
    // closed) hacia el resto del handler.
    std::cerr << "[CROSS_SITE_COOKIE_BLOCKED] ip=" << http_utils::getClientIp(req)
              << " target=" << std::string(req.target()) << std::endl;
    security::sendSecurityAlert("cross_site_cookie_blocked",
                                "ip=" + http_utils::getClientIp(req) +
                                    " target=" + std::string(req.target()));
  }

  // `?auth_token=` queda restringido al handshake WebSocket (auditoría de
  // seguridad 2026-08-02). La API del navegador `new WebSocket(url)` no
  // permite headers custom, así que ahí el query param es la única opción
  // real (ver frontend/src/lib/alarmStream.ts). Pero aceptarlo en TODA ruta
  // HTTP convertía el access token en un valor que acaba escrito en claro en
  // el access log de nginx, en el historial del navegador, en la cache de
  // proxies intermedios y en el header `Referer` enviado a cualquier origen
  // externo enlazado desde esa página — un token de sesión completo filtrado
  // por cuatro canales pasivos distintos. Limitarlo al upgrade mantiene el
  // WebSocket funcionando y elimina la fuga en el resto de la superficie.
  if (isWebSocketUpgrade(req)) {
    if (auto it = query.find("auth_token"); it != query.end()) {
      return emit(AuthTokenSource::QueryParam, it->second);
    }
  }
  return {};
}

bool csrfTokenMatches(const http::request<http::string_body> &req) {
  const std::string cookie = http_utils::extractCookie(req, "beemetry_csrf_token");
  if (cookie.empty()) return false;
  const auto header = req.find("X-CSRF-Token");
  if (header == req.end()) return false;
  const std::string sent(header->value());
  if (sent.size() != cookie.size()) return false;
  unsigned char diff = 0;
  for (std::size_t i = 0; i < sent.size(); ++i) {
    diff |= static_cast<unsigned char>(sent[i]) ^ static_cast<unsigned char>(cookie[i]);
  }
  return diff == 0;
}

bool requiresCsrfRejection(const http::request<http::string_body> &req,
                           AuthTokenSource source) {
  // Solo la autenticación por cookie es CSRF-able: es la única credencial que
  // el navegador adjunta por su cuenta a una petición originada en otro sitio.
  if (source != AuthTokenSource::Cookie) return false;
  switch (req.method()) {
    case http::verb::get:
    case http::verb::head:
    case http::verb::options:
      // Métodos seguros: no mutan estado. (Los handlers de este backend
      // respetan esa semántica; si alguno dejara de hacerlo, tendría que
      // exigir CSRF explícitamente.)
      return false;
    default:
      break;
  }
  return !csrfTokenMatches(req);
}

void resetGlassesEmaState(GlassesEmaState &s) {
  s.emaLikelihood = 0.0;
  s.emaInit = false;
  s.lastNoGlassesState = true;
  s.lastNoGlassesInit = false;
}

bool applyIcaoGlassesEma(GlassesEmaState &s, double rawLikelihood,
                         bool faceDetected, double &outEma) {
  constexpr double kAlpha = 0.30;
  constexpr double kDetect = 66.0;
  constexpr double kClear = 52.0;
  if (!faceDetected) {
    resetGlassesEmaState(s);
    outEma = 0.0;
    return true;
  }
  if (!s.emaInit) {
    s.emaLikelihood = rawLikelihood;
    s.emaInit = true;
  } else {
    s.emaLikelihood =
        kAlpha * rawLikelihood + (1.0 - kAlpha) * s.emaLikelihood;
  }
  outEma = s.emaLikelihood;
  const double ema = s.emaLikelihood;
  if (!s.lastNoGlassesInit) {
    s.lastNoGlassesState = ema < 50.0;
    s.lastNoGlassesInit = true;
  } else {
    if (s.lastNoGlassesState) {
      if (ema > kDetect)
        s.lastNoGlassesState = false;
    } else {
      if (ema < kClear)
        s.lastNoGlassesState = true;
    }
  }
  return s.lastNoGlassesState;
}

static std::string toLowerCopy(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

static std::vector<std::string> splitCsvLower(const std::string &csv) {
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

std::string resolveRoleForUsername(const std::string &username) {
  const auto candidate = toLowerCopy(username);
  const auto configured = splitCsvLower(config::getenvOr("BEEMETRY_AUTH_ADMIN_USERS", "admin"));
  for (const auto &admin : configured) {
    if (candidate == admin) {
      return "admin";
    }
  }
  if (candidate.rfind("admin_", 0) == 0) {
    return "admin";
  }
  return "operator";
}

std::string makeSessionToken() {
  return http_utils::secureRandomHex(32);
}

// ── MFA/TOTP (ADR-135): tokens de login pendientes de segundo factor ──────
namespace {
struct MfaPendingEntry {
  AuthUser user;
  std::chrono::system_clock::time_point expiresAt;
};
std::mutex gMfaPendingMutex;
std::unordered_map<std::string, MfaPendingEntry> gMfaPendingTokens;
constexpr auto kMfaPendingTtl = std::chrono::minutes(5);
}  // namespace

std::string createMfaPendingToken(const AuthUser &user) {
  const std::string token = http_utils::secureRandomHex(32);
  std::scoped_lock lk(gMfaPendingMutex);
  // Purga perezosa de entradas vencidas (evita crecimiento sin límite, mismo
  // criterio que pruneExpiredAuthSessions más abajo).
  for (auto it = gMfaPendingTokens.begin(); it != gMfaPendingTokens.end();) {
    if (it->second.expiresAt <= std::chrono::system_clock::now()) {
      it = gMfaPendingTokens.erase(it);
    } else {
      ++it;
    }
  }
  gMfaPendingTokens[token] = {user, std::chrono::system_clock::now() + kMfaPendingTtl};
  return token;
}

std::optional<AuthUser> consumeMfaPendingToken(const std::string &mfaToken) {
  // Deliberadamente NO borra la entrada al leerla: un código de 6 dígitos
  // mal tipeado no debe forzar un login completo de nuevo (password/
  // biometría) -- el caller (POST /api/auth/login/mfa) es quien decide
  // cuándo invalidarla, solo tras un código correcto. La entrada igual
  // expira sola a los 5 min si nunca se usa.
  std::scoped_lock lk(gMfaPendingMutex);
  const auto it = gMfaPendingTokens.find(mfaToken);
  if (it == gMfaPendingTokens.end()) return std::nullopt;
  if (it->second.expiresAt <= std::chrono::system_clock::now()) {
    gMfaPendingTokens.erase(it);
    return std::nullopt;
  }
  return it->second.user;
}

/** @brief Invalida un `mfa_token` tras su uso exitoso (uso único real). */
void invalidateMfaPendingToken(const std::string &mfaToken) {
  std::scoped_lock lk(gMfaPendingMutex);
  gMfaPendingTokens.erase(mfaToken);
}

/** @brief Construye+firma el access token JWT para `user`, con TTL de config::AppConfig::gJwtAccessTtlMinutes. */
static std::pair<std::string, std::string> issueAccessToken(const AuthUser &user) {
  auto &cfg = config::AppConfig::instance();
  jwt::JwtClaims claims;
  claims.sub = user.id;
  claims.username = user.username;
  claims.company = user.company;
  claims.role = user.role;
  claims.tenantId = user.tenantId;
  claims.jti = makeSessionToken();
  claims.issuedAt = std::chrono::system_clock::now();
  claims.expiresAt = claims.issuedAt + std::chrono::minutes(cfg.gJwtAccessTtlMinutes);
  return {jwt::sign(claims, cfg.gJwtSecret), claims.jti};
}

std::string issueEphemeralAccessToken(const AuthUser &user) {
  return issueAccessToken(user).first;
}

std::string issueExportAccessToken(const std::string &userId, const std::string &username,
                                   const std::string &company, const std::string &role,
                                   const std::string &tenantId) {
  auto &cfg = config::AppConfig::instance();
  jwt::JwtClaims claims;
  claims.sub = userId;
  claims.username = username;
  claims.company = company;
  claims.role = role;
  claims.tenantId = tenantId;
  claims.jti = makeSessionToken();
  claims.issuedAt = std::chrono::system_clock::now();
  claims.expiresAt = claims.issuedAt + std::chrono::minutes(cfg.gJwtExportTtlMinutes);
  return jwt::sign(claims, cfg.gJwtSecret);
}

static std::string iso8601(std::chrono::system_clock::time_point tp) {
  const auto t = std::chrono::system_clock::to_time_t(tp);
  std::tm tmBuf{};
#if defined(_WIN32)
  gmtime_s(&tmBuf, &t);
#else
  gmtime_r(&t, &tmBuf);
#endif
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmBuf);
  return buf;
}

AuthTokenPair issueAuthSession(const AuthUser &user) {
  auto &cfg = config::AppConfig::instance();
  auto [accessToken, jti] = issueAccessToken(user);

  const std::string rawRefreshToken = makeSessionToken();
  const std::string refreshHash = jwt::sha256Hex(rawRefreshToken);
  const auto refreshExpiresAt =
      std::chrono::system_clock::now() + std::chrono::hours(24 * cfg.gJwtRefreshTtlDays);

  if (cfg.gAuthStorageMode == config::AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    insertRefreshTokenPg(cfg.gDatabaseUrl, user, refreshHash, iso8601(refreshExpiresAt));
#endif
  } else {
    std::scoped_lock lk(gFileRefreshTokensMutex);
    gFileRefreshTokens[refreshHash] = FileRefreshTokenEntry{user, refreshExpiresAt, false};
  }

  AuthTokenPair pair;
  pair.token = accessToken;
  pair.refreshToken = rawRefreshToken;
  // Token de doble envío CSRF (ver ADR-029, "Actualización 2026-07-19") — no
  // necesita persistirse: su única función es viajar en una cookie legible
  // por JS que el cliente debe repetir en un header en el mismo request que
  // la cookie HttpOnly de refresh_token, algo que un sitio de terceros no
  // puede falsificar sin poder leer esa cookie.
  pair.csrfToken = makeSessionToken();
  pair.jti = jti;
  pair.expiresInSeconds = cfg.gJwtAccessTtlMinutes * 60;
  return pair;
}

std::optional<AuthTokenPair> refreshWithToken(const std::string &rawRefreshToken) {
  if (rawRefreshToken.empty()) {
    return std::nullopt;
  }
  auto &cfg = config::AppConfig::instance();
  const std::string hash = jwt::sha256Hex(rawRefreshToken);

  std::optional<AuthUser> user;
  if (cfg.gAuthStorageMode == config::AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    user = findValidRefreshTokenUserPg(cfg.gDatabaseUrl, hash);
#endif
  } else {
    std::scoped_lock lk(gFileRefreshTokensMutex);
    if (auto it = gFileRefreshTokens.find(hash); it != gFileRefreshTokens.end()) {
      const auto &entry = it->second;
      if (!entry.revoked && entry.expiresAt > std::chrono::system_clock::now()) {
        user = entry.user;
      }
    }
  }

  if (!user) {
    return std::nullopt;
  }

  // Rotación estricta: el refresh token usado se revoca de inmediato, aunque
  // el nuevo falle a medio camino — mejor forzar un login nuevo que dejar un
  // refresh token reutilizable (protege contra reuso tras robo).
  if (cfg.gAuthStorageMode == config::AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    revokeRefreshTokenPg(cfg.gDatabaseUrl, hash);
#endif
  } else {
    std::scoped_lock lk(gFileRefreshTokensMutex);
    if (auto it = gFileRefreshTokens.find(hash); it != gFileRefreshTokens.end()) {
      it->second.revoked = true;
    }
  }

  return issueAuthSession(*user);
}

void revokeAuthSession(const std::string &accessToken,
                       const std::string &rawRefreshToken) {
  auto &cfg = config::AppConfig::instance();
  if (const auto claims = jwt::verify(accessToken, cfg.gJwtSecret)) {
    std::scoped_lock lk(gRevokedJtiMutex);
    gRevokedJti[claims->jti] = claims->expiresAt;
  }
  {
    std::scoped_lock g(gGlassesEmaMutex);
    gGlassesEmaBySession.erase(accessToken);
  }

  if (!rawRefreshToken.empty()) {
    const std::string hash = jwt::sha256Hex(rawRefreshToken);
    if (cfg.gAuthStorageMode == config::AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      revokeRefreshTokenPg(cfg.gDatabaseUrl, hash);
#endif
    } else {
      std::scoped_lock lk(gFileRefreshTokensMutex);
      if (auto it = gFileRefreshTokens.find(hash); it != gFileRefreshTokens.end()) {
        it->second.revoked = true;
      }
    }
  }
}

void revokeAllSessionsForUser(const std::string &userId) {
  auto &cfg = config::AppConfig::instance();
  if (cfg.gAuthStorageMode == config::AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    revokeAllRefreshTokensForUserPg(cfg.gDatabaseUrl, userId);
#endif
  } else {
    std::scoped_lock lk(gFileRefreshTokensMutex);
    for (auto &[hash, entry] : gFileRefreshTokens) {
      if (entry.user.id == userId) {
        entry.revoked = true;
      }
    }
  }
  // Nota: los access tokens ya emitidos para este usuario siguen válidos
  // hasta su expiración natural (<= gJwtAccessTtlMinutes, pocos minutos) —
  // trade-off deliberado del diseño híbrido (ver ADR-029 revisado).
}

void pruneExpiredAuthSessions() {
  const auto now = std::chrono::system_clock::now();
  {
    std::scoped_lock lk(gRevokedJtiMutex);
    for (auto it = gRevokedJti.begin(); it != gRevokedJti.end();) {
      if (it->second <= now) {
        it = gRevokedJti.erase(it);
      } else {
        ++it;
      }
    }
  }
  if (config::AppConfig::instance().gAuthStorageMode != config::AuthStorageMode::Postgres) {
    std::scoped_lock lk(gFileRefreshTokensMutex);
    for (auto it = gFileRefreshTokens.begin(); it != gFileRefreshTokens.end();) {
      if (it->second.revoked || it->second.expiresAt <= now) {
        it = gFileRefreshTokens.erase(it);
      } else {
        ++it;
      }
    }
  }
}

std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  const std::string token = extractAuthTokenFromRequest(req, query);
  if (token.empty()) {
    return std::nullopt;
  }

  pruneExpiredAuthSessions();

  auto &cfg = config::AppConfig::instance();
  const auto claims = jwt::verify(token, cfg.gJwtSecret);
  if (!claims) {
    return std::nullopt;
  }

  {
    std::scoped_lock lk(gRevokedJtiMutex);
    if (gRevokedJti.find(claims->jti) != gRevokedJti.end()) {
      return std::nullopt;
    }
  }

  AuthSession session;
  session.token = token;
  session.userId = claims->sub;
  session.username = claims->username;
  session.company = claims->company;
  session.role = claims->role;
  session.tenantId = claims->tenantId;
  session.expiresAt = claims->expiresAt;
  session.jti = claims->jti;
  return session;
}

} // namespace auth
