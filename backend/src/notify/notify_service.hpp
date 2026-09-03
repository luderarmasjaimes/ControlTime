#pragma once

#include <boost/json.hpp>

#include <string>
#include <vector>

namespace json = boost::json;

namespace notify {

/** @brief Resultado de UN canal para un envío (ver `dispatch`). */
struct ChannelResult {
  std::string channel;  // "in_app" | "email" | "whatsapp" | "sms"
  bool ok = false;
  std::string detail;   // motivo si !ok, o detalle de transporte si ok
};

/**
 * @brief Petición de notificación multi-canal. El destinatario SIEMPRE se
 * resuelve server-side contra `auth_users` (nunca se acepta un email/
 * teléfono arbitrario del cliente sin pasar por un `user_id` real de la
 * misma empresa) — ver el guardia IDOR en notify_routes.cpp/report_routes.cpp
 * antes de construir esto.
 */
struct NotifyRequest {
  std::string recipientUserId;      // auth_users.id (UUID) del destinatario, para el canal in_app
  std::string recipientEmail;       // canal "email"
  std::string recipientPhoneE164;   // canal "whatsapp" (columna auth_users.phone)
  std::string recipientMobileE164;  // canal "sms" (columna auth_users.mobile)
  std::string title;
  std::string body;
  std::vector<std::string> channels;  // subconjunto de "in_app"|"email"|"whatsapp"|"sms"
  std::string sourceApp;    // trazabilidad ("reports", "mining_alarms", o el nombre que declare una app externa)
  std::string relatedType;  // p.ej. "report" -- para que el cliente in-app pueda deep-linkear
  std::string relatedId;
};

/**
 * @brief Despacha la notificación por cada canal pedido. Cada canal es
 * independiente y best-effort (un canal caído/no-configurado NO bloquea ni
 * revierte los demás) — mismo criterio que `mining_iot::dispatch` para
 * alarmas. Todo intento (éxito o fallo) queda trazado en
 * `notification_dispatch_log` (db_scripts/86_...).
 * @return Un `ChannelResult` por cada canal solicitado, en el mismo orden.
 */
std::vector<ChannelResult> dispatch(const std::string &databaseUrl, const NotifyRequest &req);

} // namespace notify
