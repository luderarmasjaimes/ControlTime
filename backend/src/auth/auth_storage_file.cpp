#include "auth_storage_file.hpp"
#include "auth_session.hpp"
#include "permissions.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace auth {

static constexpr char kMiningTelemetryDemoTenantId[] =
    "a0000001-0000-4000-8000-000000000001";

fs::path authDirPath(const std::string &dataRoot) {
  return fs::path(dataRoot) / "auth";
}

fs::path authUsersFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "users.json";
}

fs::path authAuditFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "auth_audit.log";
}

fs::path legacyFacialUsersFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "facial_legacy_users.json";
}

json::object authUserToJson(const AuthUser &u) {
  json::array tpl;
  for (double v : u.faceTemplate) {
    tpl.push_back(v);
  }

  json::object jo{{"id", u.id},
                  {"company", u.company},
                  {"first_name", u.firstName},
                  {"last_name", u.lastName},
                  {"dni", u.dni},
                  {"username", u.username},
                  {"role", u.role},
                  {"password_hash", u.passwordHash},
                  {"face_template", tpl},
                  {"created_at", u.createdAt}};
  if (!u.avatarCartoonBase64.empty()) {
    jo["avatar_cartoon_base64"] = u.avatarCartoonBase64;
  }
  return jo;
}

json::object authUserSessionJson(const AuthUser &u,
                                 const AuthTokenPair &tokens) {
  const std::string tid =
      u.tenantId.empty() ? std::string(kMiningTelemetryDemoTenantId) : u.tenantId;
  json::object jo{{"id", u.id},
                  {"company", u.company},
                  {"username", u.username},
                  {"role", u.role},
                  // ADR-029, "Actualización 2026-07-19": el refresh token ya
                  // NO viaja en el body JSON -- el caller debe adjuntarlo a
                  // la respuesta HTTP vía http_utils::setAuthCookies() (cookie
                  // HttpOnly). Nunca poner tokens.refreshToken/csrfToken acá.
                  {"access_token", tokens.token},
                  {"expires_in", tokens.expiresInSeconds},
                  {"token_type", "Bearer"},
                  {"full_name", u.firstName + " " + u.lastName},
                  {"tenant_id", tid}};
  if (!u.avatarCartoonBase64.empty()) {
    jo["avatar_cartoon_base64"] = u.avatarCartoonBase64;
  }
  // Departamento de soporte (auth_user_tenant.department, ADR-115) -- gatea
  // en el frontend el panel admin de tickets/conversaciones segmentado por
  // departamento. No es una credencial ni un dato sensible: nullopt = sin
  // restricción, se omite el campo (el frontend lo trata como "sin dept").
  if (auto dept = effectiveDepartment(u.id, tid)) {
    jo["department"] = *dept;
  }
  return jo;
}

bool jsonToAuthUser(const json::object &obj, AuthUser &out) {
  if (!obj.if_contains("id") || !obj.if_contains("company") ||
      !obj.if_contains("first_name") || !obj.if_contains("last_name") ||
      !obj.if_contains("dni") || !obj.if_contains("username") ||
      !obj.if_contains("password_hash") || !obj.if_contains("face_template") ||
      !obj.if_contains("created_at")) {
    return false;
  }

  if (!obj.at("id").is_string() || !obj.at("company").is_string() ||
      !obj.at("first_name").is_string() || !obj.at("last_name").is_string() ||
      !obj.at("dni").is_string() || !obj.at("username").is_string() ||
      !obj.at("password_hash").is_string() ||
      !obj.at("face_template").is_array() ||
      !obj.at("created_at").is_string()) {
    return false;
  }

  out.id = json::value_to<std::string>(obj.at("id"));
  out.company = json::value_to<std::string>(obj.at("company"));
  out.firstName = json::value_to<std::string>(obj.at("first_name"));
  out.lastName = json::value_to<std::string>(obj.at("last_name"));
  out.dni = json::value_to<std::string>(obj.at("dni"));
  out.username = json::value_to<std::string>(obj.at("username"));
  if (obj.if_contains("role") && obj.at("role").is_string()) {
    out.role = json::value_to<std::string>(obj.at("role"));
  } else {
    out.role = resolveRoleForUsername(out.username);
  }
  out.passwordHash = json::value_to<std::string>(obj.at("password_hash"));
  out.createdAt = json::value_to<std::string>(obj.at("created_at"));

  out.faceTemplate.clear();
  for (const auto &v : obj.at("face_template").as_array()) {
    if (v.is_double()) {
      out.faceTemplate.push_back(v.as_double());
    } else if (v.is_int64()) {
      out.faceTemplate.push_back(static_cast<double>(v.as_int64()));
    } else {
      return false;
    }
  }
  out.avatarCartoonBase64.clear();
  if (obj.if_contains("avatar_cartoon_base64") &&
      obj.at("avatar_cartoon_base64").is_string()) {
    out.avatarCartoonBase64 =
        json::value_to<std::string>(obj.at("avatar_cartoon_base64"));
  }
  return !out.faceTemplate.empty();
}

std::vector<AuthUser> loadAuthUsers(const std::string &dataRoot) {
  fs::create_directories(authDirPath(dataRoot));
  const auto path = authUsersFile(dataRoot);
  if (!fs::exists(path)) {
    return {};
  }

  std::ifstream ifs(path);
  if (!ifs.is_open()) {
    return {};
  }

  std::stringstream buffer;
  buffer << ifs.rdbuf();
  const auto raw = buffer.str();
  if (raw.empty()) {
    return {};
  }

  try {
    auto parsed = json::parse(raw);
    if (!parsed.is_array()) {
      return {};
    }

    std::vector<AuthUser> users;
    for (const auto &item : parsed.as_array()) {
      if (!item.is_object()) {
        continue;
      }
      AuthUser user;
      if (jsonToAuthUser(item.as_object(), user)) {
        users.push_back(std::move(user));
      }
    }
    return users;
  } catch (...) {
    return {};
  }
}

void saveAuthUsers(const std::string &dataRoot,
                   const std::vector<AuthUser> &users) {
  fs::create_directories(authDirPath(dataRoot));
  json::array arr;
  for (const auto &u : users) {
    arr.push_back(authUserToJson(u));
  }

  std::ofstream ofs(authUsersFile(dataRoot), std::ios::trunc);
  ofs << json::serialize(arr);
}

int migrateLegacyPasswordHashesFile(const std::string &dataRoot) {
  auto users = loadAuthUsers(dataRoot);
  int migrated = 0;
  for (auto &u : users) {
    if (u.passwordHash.empty() || !http_utils::isRawLegacyHash(u.passwordHash)) {
      continue;
    }
    try {
      u.passwordHash = http_utils::wrapLegacyHash(u.passwordHash);
      ++migrated;
    } catch (const std::exception &ex) {
      std::cerr << "[AUTH_PASSWORD] migracion File fallo para user_id=" << u.id
                << ": " << ex.what() << std::endl;
    }
  }
  // Una sola reescritura al final: `users.json` se serializa entero, así que
  // guardar por usuario multiplicaría la escritura sin ganar atomicidad.
  if (migrated > 0) {
    saveAuthUsers(dataRoot, users);
  }
  return migrated;
}

bool updateUserAvatarCartoonFile(const std::string &dataRoot,
                                 const std::string &userId,
                                 const std::string &avatarBase64) {
  auto users = loadAuthUsers(dataRoot);
  for (auto &u : users) {
    if (u.id == userId) {
      u.avatarCartoonBase64 = avatarBase64;
      saveAuthUsers(dataRoot, users);
      return true;
    }
  }
  return false;
}

std::vector<LegacyFacialUserRecord>
loadLegacyFacialUsers(const std::string &dataRoot) {
  fs::create_directories(authDirPath(dataRoot));
  const auto path = legacyFacialUsersFile(dataRoot);
  if (!fs::exists(path)) {
    return {};
  }
  std::ifstream ifs(path);
  if (!ifs.is_open()) {
    return {};
  }
  std::stringstream buffer;
  buffer << ifs.rdbuf();
  const auto raw = buffer.str();
  if (raw.empty()) {
    return {};
  }
  try {
    auto parsed = json::parse(raw);
    if (!parsed.is_array()) {
      return {};
    }
    std::vector<LegacyFacialUserRecord> out;
    for (const auto &it : parsed.as_array()) {
      if (!it.is_object()) {
        continue;
      }
      const auto &obj = it.as_object();
      if (!obj.if_contains("id") || !obj.if_contains("name") ||
          !obj.if_contains("timestamp")) {
        continue;
      }
      if (!obj.at("id").is_string() || !obj.at("name").is_string()) {
        continue;
      }
      LegacyFacialUserRecord u;
      u.id = json::value_to<std::string>(obj.at("id"));
      u.name = json::value_to<std::string>(obj.at("name"));
      if (obj.at("timestamp").is_int64()) {
        u.timestamp = obj.at("timestamp").as_int64();
      } else if (obj.at("timestamp").is_double()) {
        u.timestamp = static_cast<std::int64_t>(obj.at("timestamp").as_double());
      }
      if (obj.if_contains("confidence")) {
        if (obj.at("confidence").is_double()) {
          u.confidence = obj.at("confidence").as_double();
        } else if (obj.at("confidence").is_int64()) {
          u.confidence = static_cast<double>(obj.at("confidence").as_int64());
        }
      }
      out.push_back(std::move(u));
    }
    return out;
  } catch (...) {
    return {};
  }
}

void saveLegacyFacialUsers(const std::string &dataRoot,
                           const std::vector<LegacyFacialUserRecord> &users) {
  fs::create_directories(authDirPath(dataRoot));
  json::array arr;
  for (const auto &u : users) {
    arr.push_back(json::object{{"id", u.id},
                               {"name", u.name},
                               {"timestamp", u.timestamp},
                               {"confidence", u.confidence}});
  }
  std::ofstream ofs(legacyFacialUsersFile(dataRoot), std::ios::trunc);
  ofs << json::serialize(arr);
}

void appendAuthAuditLog(const std::string &dataRoot, const std::string &action,
                        const std::string &company,
                        const std::string &username, bool ok,
                        const std::string &detail) {
  fs::create_directories(authDirPath(dataRoot));
  std::ofstream ofs(authAuditFile(dataRoot), std::ios::app);
  ofs << http_utils::nowIso8601() << "|action=" << action << "|company=" << company
      << "|username=" << username << "|ok=" << (ok ? "true" : "false")
      << "|detail=" << detail << "\n";
}

json::object parseAuditLine(const std::string &line) {
  json::object out;
  std::stringstream ss(line);
  std::string token;
  bool first = true;
  while (std::getline(ss, token, '|')) {
    if (first) {
      out["event_time"] = token;
      first = false;
      continue;
    }
    const auto eq = token.find('=');
    if (eq == std::string::npos) {
      continue;
    }
    const std::string key = token.substr(0, eq);
    const std::string value = token.substr(eq + 1);
    if (key == "action") out["event_action"] = value;
    else if (key == "company") out["company_name"] = value;
    else if (key == "username") out["username"] = value;
    else if (key == "ok") out["success"] = (value == "true");
    else if (key == "detail") out["detail"] = value;
  }
  return out;
}

bool matchAuditFilter(const json::object &entry, const AuditFilter &filter) {
  if (filter.company.has_value()) {
    auto p = entry.if_contains("company_name");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.company) {
      return false;
    }
  }
  if (filter.username.has_value()) {
    auto p = entry.if_contains("username");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.username) {
      return false;
    }
  }
  if (filter.action.has_value()) {
    auto p = entry.if_contains("event_action");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.action) {
      return false;
    }
  }
  if (filter.success.has_value()) {
    auto p = entry.if_contains("success");
    if (!p || !p->is_bool() || p->as_bool() != *filter.success) {
      return false;
    }
  }
  return true;
}

AuditPageResult readAuthAuditTail(const std::string &dataRoot,
                                  const AuditFilter &filter) {
  AuditPageResult page;
  page.limit = filter.limit;
  page.offset = filter.offset;

  const auto path = authAuditFile(dataRoot);
  if (!fs::exists(path)) {
    return page;
  }

  std::ifstream ifs(path);
  std::vector<json::object> entries;
  std::string line;
  while (std::getline(ifs, line)) {
    if (!line.empty()) {
      auto parsed = parseAuditLine(line);
      if (matchAuditFilter(parsed, filter)) {
        entries.push_back(std::move(parsed));
      }
    }
  }

  page.total = entries.size();
  if (entries.empty()) {
    return page;
  }

  std::reverse(entries.begin(), entries.end());

  const size_t start = std::min(filter.offset, entries.size());
  const size_t end = std::min(start + filter.limit, entries.size());
  for (size_t i = start; i < end; ++i) {
    page.logs.push_back(entries[i]);
  }
  return page;
}

static std::string csvEscape(const std::string &v) {
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

std::string auditRowsToCsv(const json::array &logs) {
  std::ostringstream oss;
  oss << "event_time,event_action,company_name,username,success,detail\n";
  for (const auto &item : logs) {
    if (!item.is_object()) continue;
    const auto &obj = item.as_object();
    const auto getStr = [&](const char *k) {
      if (auto p = obj.if_contains(k); p && p->is_string()) {
        return json::value_to<std::string>(*p);
      }
      return std::string();
    };
    std::string success = "false";
    if (auto p = obj.if_contains("success"); p && p->is_bool()) {
      success = p->as_bool() ? "true" : "false";
    }

    oss << csvEscape(getStr("event_time")) << ','
        << csvEscape(getStr("event_action")) << ','
        << csvEscape(getStr("company_name")) << ','
        << csvEscape(getStr("username")) << ','
        << csvEscape(success) << ','
        << csvEscape(getStr("detail")) << '\n';
  }
  return oss.str();
}

bool authIdentityKeyIsAllDigits(const std::string &s) {
  return !s.empty() &&
         std::all_of(s.begin(), s.end(), [](unsigned char c) {
           return std::isdigit(c) != 0;
         });
}

/** username / dni / ruc exacto, o DNI numérico equivalente (p. ej. 9637521 vs 09637521). */
bool authIdentityKeyMatchesFsUser(const std::string &identityKey,
                                  const AuthUser &u) {
  if (u.username == identityKey || u.dni == identityKey ||
      (!u.ruc.empty() && u.ruc == identityKey)) {
    return true;
  }
  if (!authIdentityKeyIsAllDigits(identityKey) ||
      !authIdentityKeyIsAllDigits(u.dni) || u.dni.empty()) {
    return false;
  }
  try {
    return std::stoll(u.dni) == std::stoll(identityKey);
  } catch (const std::exception &) {
    return false;
  }
}

AuthLoginIdentityLookupResult authLookupIdentityForCompanyFs(
    const std::string &dataRoot, const std::string &company,
    const std::string &identityKey) {
  AuthLoginIdentityLookupResult out;
  const auto users = loadAuthUsers(dataRoot);
  const AuthUser *match = nullptr;
  size_t matchCount = 0;
  for (const auto &u : users) {
    if (u.company != company) {
      continue;
    }
    if (authIdentityKeyMatchesFsUser(identityKey, u)) {
      match = &u;
      matchCount++;
    }
  }
  if (matchCount == 0) {
    out.kind = AuthLoginIdentityLookupResult::Kind::NotFound;
    return out;
  }
  if (matchCount > 1) {
    out.kind = AuthLoginIdentityLookupResult::Kind::Ambiguous;
    return out;
  }
  out.kind = AuthLoginIdentityLookupResult::Kind::Ok;
  out.resolvedUsername = match->username;
  return out;
}

} // namespace auth
