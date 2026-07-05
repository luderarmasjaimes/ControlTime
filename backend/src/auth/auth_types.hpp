#pragma once

#include <boost/json.hpp>

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace json = boost::json;

namespace auth {

struct AuthUser {
  std::string id;
  std::string company;
  std::string firstName;
  std::string lastName;
  std::string dni;
  std::string username;
  std::string role = "operator";
  std::string passwordHash;
  std::vector<double> faceTemplate;
  std::string createdAt;
  std::string ruc;
  std::string phone;
  std::string mobile;
  std::string email;
  /** PNG/JPEG en base64 (sin prefijo data:), generado en registro desde recorte óvalo. */
  std::string avatarCartoonBase64;
  /** UUID tenants(tenant_id) para telemetría minera / informes (Postgres). */
  std::string tenantId;
};

struct Project {
  std::string id;
  std::string name;
  std::string description;
  std::string companyName;
};

struct Report {
  std::string id;
  std::string projectId;
  std::string title;
  json::value contentJson;
  std::string status = "draft";
  std::string createdBy;
  int versionNumber = 1;
  std::string company;
  std::string createdAt;
  std::string updatedAt;
  // Firma documental (ADR-018): poblados por el servidor solo al transicionar
  // a 'signed' (ver reports::updateReportPg). Vacíos si nunca se firmó.
  std::string signedByName;
  std::string signedByRole;
  std::string signedAt;
};

struct AuthSession {
  std::string token;
  std::string userId;
  std::string username;
  std::string company;
  std::string role;
  std::string tenantId;  // mirrors AuthUser::tenantId (UUID); empty for file-mode
  std::chrono::system_clock::time_point expiresAt;
};

/** EMA + histéresis lentes (ICAO/FACIAL) por sesión — no compartido entre usuarios. */
struct GlassesEmaState {
  double emaLikelihood = 0.0;
  bool emaInit = false;
  bool lastNoGlassesState = true;
  bool lastNoGlassesInit = false;
};

struct AuditFilter {
  size_t limit = 50;
  size_t offset = 0;
  std::optional<std::string> company;
  std::optional<std::string> username;
  std::optional<std::string> action;
  std::optional<bool> success;
};

struct AuditPageResult {
  json::array logs;
  size_t total = 0;
  size_t limit = 50;
  size_t offset = 0;
};

struct LegacyFacialUserRecord {
  std::string id;
  std::string name;
  std::int64_t timestamp = 0;
  double confidence = 0.0;
};

struct AuthLoginIdentityLookupResult {
  enum class Kind { Ok, NotFound, Ambiguous, DbError };
  Kind kind = Kind::DbError;
  std::string resolvedUsername;
  std::string diagnostic;
};

} // namespace auth
