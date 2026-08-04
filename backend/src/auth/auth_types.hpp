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
  // Legacy: nombre de empresa desnormalizado, solo para display. Desde la
  // migración de ADR-039 (2026-07-13) YA NO se usa para aislamiento/lectura
  // — `tenantId` es la única clave de aislamiento real de `reports`.
  std::string company;
  std::string createdAt;
  std::string updatedAt;
  // ADR-039: tenant_id real de la sesión que crea el informe — OBLIGATORIO
  // desde la migración de 2026-07-13 (antes era dual-write con fallback a
  // `company_name`; los 6 informes preexistentes sin tenant_id se borraron
  // como parte de esa migración, con autorización explícita del usuario,
  // por ser datos de prueba). `createReportPg` rechaza la creación si viene
  // vacío — ver report_routes.cpp::handleCreateReport.
  std::string tenantId;
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
  // ADR-029 (revisado): id único del JWT de acceso, usado para revocación
  // puntual antes de su expiración natural (logout, incidente de seguridad).
  std::string jti;
};

/** @brief Par de tokens emitido en login/registro/refresh (ADR-029 revisado). */
struct AuthTokenPair {
  std::string token;         // access token JWT (nombre `token` por compat con callers existentes)
  std::string refreshToken;  // opaco, de un solo uso (rotado en cada refresh) — viaja SOLO por cookie HttpOnly (ver ADR-029, "Actualización 2026-07-19"), nunca en el body JSON
  // Token de doble envío (double-submit cookie) contra CSRF: viaja en una
  // cookie NO HttpOnly (el cliente la lee) y el cliente debe repetirlo en el
  // header `X-CSRF-Token` al llamar /api/auth/refresh o /api/auth/logout —
  // un sitio de terceros puede hacer que el navegador víctima MANDE la
  // cookie de refresh_token solo, pero no puede LEER esta cookie (same-origin
  // policy) para copiarla al header.
  std::string csrfToken;
  std::string jti;
  int expiresInSeconds = 0;
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
