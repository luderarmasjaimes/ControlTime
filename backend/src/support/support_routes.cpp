#include "support_routes.hpp"
#include "mining_chatbot_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <cstdlib>

using http_utils::makeJsonResponse;

namespace support_mod {

// GET /api/support/chat/config -- indica al frontend si el chatbot (Ollama)
// y el escalamiento (WhatsApp) estan configurados, sin exponer secretos.
static http::response<http::string_body>
handleChatConfig(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{
                              {"ollama_url_set", std::getenv("BEEMETRY_OLLAMA_URL") != nullptr},
                              {"whatsapp_configured",
                               !config::AppConfig::instance().gWhatsappAccessToken.empty() &&
                                   !config::AppConfig::instance().gWhatsappPhoneNumberId.empty()},
                          });
}

static http::response<http::string_body>
handleChatMessage(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  try {
    auto val = json::parse(req.body());
    auto out = support::handleChatMessage(val, session->tenantId);
    if (out.contains("error")) {
      const std::string e = json::value_to<std::string>(out.at("error"));
      if (e == "ollama_not_configured" || e == "ollama_unavailable") {
        return makeJsonResponse(http::status::service_unavailable, out);
      }
      return makeJsonResponse(http::status::bad_request, out);
    }
    return makeJsonResponse(http::status::ok, out);
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

static http::response<http::string_body>
handleEscalate(const http::request<http::string_body> &req,
              const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  try {
    json::value val = json::object{};
    if (!req.body().empty()) {
      val = json::parse(req.body());
    }
    auto out = support::handleEscalateToWhatsapp(val);
    if (out.contains("error")) {
      const std::string e = json::value_to<std::string>(out.at("error"));
      if (e == "whatsapp_not_configured" || e == "support_number_not_configured") {
        return makeJsonResponse(http::status::service_unavailable, out);
      }
      return makeJsonResponse(http::status::bad_gateway, out);
    }
    return makeJsonResponse(http::status::ok, out);
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

void registerRoutes(router::Router &r) {
  r.get("/api/support/chat/config", handleChatConfig);
  r.post("/api/support/chat/message", handleChatMessage);
  r.post("/api/support/whatsapp/escalate", handleEscalate);
}

} // namespace support_mod
