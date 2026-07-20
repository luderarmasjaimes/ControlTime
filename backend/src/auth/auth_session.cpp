#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "jwt.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <algorithm>
#include <cctype>
#include <ctime>
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

std::string extractAuthTokenFromRequest(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
  if (auto it = query.find("auth_token"); it != query.end()) {
    return it->second;
  }
  if (auto auth = req.find(http::field::authorization); auth != req.end()) {
    const std::string value(auth->value());
    static const std::string kBearer = "Bearer ";
    if (value.rfind(kBearer, 0) == 0) {
      return value.substr(kBearer.size());
    }
  }
  return {};
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
  return http_utils::makeId() + http_utils::makeId();
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
