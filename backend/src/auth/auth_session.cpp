#include "auth_session.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <vector>

namespace auth {

std::mutex gAuthSessionMutex;
std::unordered_map<std::string, AuthSession> gAuthSessions;

std::mutex gGlassesEmaMutex;
std::unordered_map<std::string, GlassesEmaState> gGlassesEmaBySession;

std::mutex gAuthMutex;

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
  const auto configured = splitCsvLower(config::getenvOr("AUTH_ADMIN_USERS", "admin"));
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

AuthSession issueAuthSession(const AuthUser &user) {
  auto& cfg = config::AppConfig::instance();
  AuthSession session;
  session.token = makeSessionToken();
  session.userId = user.id;
  session.username = user.username;
  session.company = user.company;
  session.role = user.role;
  session.tenantId = user.tenantId;
  session.expiresAt = std::chrono::system_clock::now() +
                      std::chrono::minutes(cfg.gSessionTtlMinutes);

  std::scoped_lock lk(gAuthSessionMutex);
  gAuthSessions[session.token] = session;
  return session;
}

void revokeAuthSession(const std::string &token) {
  std::scoped_lock lk(gAuthSessionMutex);
  gAuthSessions.erase(token);
  // también limpia estado EMA de gafas asociado a este token
  {
    std::scoped_lock g(gGlassesEmaMutex);
    gGlassesEmaBySession.erase(token);
  }
}

void pruneExpiredAuthSessions() {
  std::vector<std::string> expiredTokens;
  {
    std::scoped_lock lk(gAuthSessionMutex);
    const auto now = std::chrono::system_clock::now();
    for (auto it = gAuthSessions.begin(); it != gAuthSessions.end();) {
      if (it->second.expiresAt <= now) {
        expiredTokens.push_back(it->first);
        it = gAuthSessions.erase(it);
      } else {
        ++it;
      }
    }
  }
  if (!expiredTokens.empty()) {
    std::scoped_lock g(gGlassesEmaMutex);
    for (const auto &t : expiredTokens) {
      gGlassesEmaBySession.erase(t);
    }
  }
}

std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  std::string token;
  if (auto it = query.find("auth_token"); it != query.end()) {
    token = it->second;
  }

  if (token.empty()) {
    if (auto auth = req.find(http::field::authorization); auth != req.end()) {
      const std::string value(auth->value());
      static const std::string kBearer = "Bearer ";
      if (value.rfind(kBearer, 0) == 0) {
        token = value.substr(kBearer.size());
      }
    }
  }

  if (token.empty()) {
    return std::nullopt;
  }

  pruneExpiredAuthSessions();
  std::scoped_lock lk(gAuthSessionMutex);
  const auto it = gAuthSessions.find(token);
  if (it == gAuthSessions.end()) {
    return std::nullopt;
  }
  return it->second;
}

} // namespace auth
