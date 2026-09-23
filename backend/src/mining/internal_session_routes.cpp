#include "internal_session_routes.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"

#include <cstdlib>
#include <cstring>
#include <string>

using http_utils::makeJsonResponse;

namespace mining_iot {

namespace {

// Comparación en tiempo constante, mismo motivo que cualquier comparación de
// secreto/token (evita timing attack de un atacante en la misma red interna
// midiendo cuántos bytes coinciden antes de fallar).
bool constantTimeEquals(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) return false;
  unsigned char diff = 0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

http::response<http::string_body>
handleResolveSession(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const char *expected = std::getenv("BEEMETRY_FORMULA_AUTH_TOKEN");
  if (!expected || std::strlen(expected) == 0) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "internal_token_not_configured"}});
  }
  const auto it = req.find("X-Internal-Token");
  if (it == req.end() || !constantTimeEquals(std::string(it->value()), std::string(expected))) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}});
  }

  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  return makeJsonResponse(http::status::ok, json::object{
      {"user_id", session->userId},
      {"username", session->username},
      {"tenant_id", session->tenantId},
      {"role", session->role},
      {"company", session->company},
      {"can_manage_formulas",
       auth::hasPermission(session->userId, session->tenantId, session->role, "formula.edit")},
  });
}

} // namespace

void registerInternalSessionRoutes(router::Router &r) {
  r.get("/api/internal/resolve-session", handleResolveSession);
}

} // namespace mining_iot
