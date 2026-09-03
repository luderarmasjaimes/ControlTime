#include "security_alerts.hpp"
#include "../http/http_client.hpp"
#include "../config/app_config.hpp"

#include <boost/beast/http.hpp>
#include <boost/json.hpp>

#include <chrono>
#include <cstdio>
#include <ctime>
#include <thread>

namespace http = boost::beast::http;
namespace json = boost::json;

namespace security {

namespace {

std::string nowIso8601() {
  const auto now = std::chrono::system_clock::now();
  const auto t = std::chrono::system_clock::to_time_t(now);
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

}  // namespace

void sendSecurityAlert(const std::string &eventType, const std::string &detail) {
  const std::string url = config::getenvOr("BEEMETRY_SECURITY_ALERT_WEBHOOK_URL", "");
  if (url.empty()) {
    return;  // opt-in: sin configurar, no hace nada (comportamiento previo).
  }

  const json::object payload{
      {"source", "beemetry-backend"},
      {"event", eventType},
      {"detail", detail},
      {"timestamp", nowIso8601()},
  };
  const std::string body = json::serialize(payload);

  // Fire-and-forget en un hilo separado: un webhook lento/caído NUNCA debe
  // agregar latencia ni poder afectar la request real que disparó la
  // alerta (login, request cross-site bloqueada, etc.). El hilo se separa
  // del proceso (detach) -- no hay nada que esperar ni cancelar; el propio
  // timeout de http_client::request acota su vida.
  std::thread([url, body]() {
    (void)http_client::request(url, http::verb::post, body,
                               {{"Content-Type", "application/json"}}, 5000);
  }).detach();
}

}  // namespace security
