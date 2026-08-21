#include "whatsapp_webhook_routes.hpp"
#include "whatsapp_bot_engine.hpp"
#include "whatsapp_signature.hpp"
#include "support_storage_pg.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <boost/json.hpp>
#include <iostream>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace support_mod {

namespace {

/** @brief Resuelve a qué línea configurada pertenece este `value` de webhook
 * a partir de `value.metadata.phone_number_id` (ADR-113 -- así el motor del
 * bot sabe por cuál número de WhatsApp responder cuando hay varias líneas
 * conectadas). Si el id no coincide con ninguna línea conocida (línea nueva
 * sin desplegar todavía, o webhook mal configurado) cae a la línea por
 * defecto en vez de descartar el mensaje -- mismo criterio de "nunca dejar
 * al usuario sin respuesta" que el resto del bot. */
std::string resolveLineId(const json::object &value) {
  auto &cfg = AppConfig::instance();
  std::string phoneNumberId;
  if (value.contains("metadata") && value.at("metadata").is_object()) {
    const auto &metadata = value.at("metadata").as_object();
    if (metadata.contains("phone_number_id")) {
      phoneNumberId = json::value_to<std::string>(metadata.at("phone_number_id"));
    }
  }
  if (!phoneNumberId.empty()) {
    if (const auto *line = cfg.whatsappLineByPhoneNumberId(phoneNumberId)) return line->id;
    std::cerr << "[WHATSAPP] webhook: phone_number_id '" << phoneNumberId
              << "' no coincide con ninguna linea configurada -- usando la linea por defecto"
              << std::endl;
  }
  const auto *def = cfg.defaultWhatsappLine();
  return def ? def->id : "default";
}

/** @brief Extrae los mensajes entrantes de `entry[].changes[].value.messages[]` y los
 * despacha uno a uno al motor del bot. Ignora silenciosamente cualquier forma
 * inesperada (p.ej. eventos `statuses` de acuse de recibo, que Meta también manda por
 * el mismo webhook y no son mensajes de un usuario). */
void dispatchInboundMessages(const json::value &body) {
  if (!body.is_object() || !body.as_object().contains("entry")) return;
  const auto &entries = body.as_object().at("entry");
  if (!entries.is_array()) return;

  for (const auto &entryVal : entries.as_array()) {
    if (!entryVal.is_object() || !entryVal.as_object().contains("changes")) continue;
    const auto &changes = entryVal.as_object().at("changes");
    if (!changes.is_array()) continue;

    for (const auto &changeVal : changes.as_array()) {
      if (!changeVal.is_object() || !changeVal.as_object().contains("value")) continue;
      const auto &valueVal = changeVal.as_object().at("value");
      if (!valueVal.is_object() || !valueVal.as_object().contains("messages")) continue;
      const auto &valueObj = valueVal.as_object();
      const auto &messages = valueObj.at("messages");
      if (!messages.is_array()) continue;

      const std::string lineId = resolveLineId(valueObj);

      for (const auto &msgVal : messages.as_array()) {
        if (!msgVal.is_object()) continue;
        const auto &m = msgVal.as_object();

        support::InboundWhatsappMessage inbound;
        inbound.fromE164 = m.contains("from") ? json::value_to<std::string>(m.at("from")) : "";
        inbound.waMessageId = m.contains("id") ? json::value_to<std::string>(m.at("id")) : "";
        inbound.type = m.contains("type") ? json::value_to<std::string>(m.at("type")) : "";
        inbound.lineId = lineId;
        inbound.rawPayload = m;

        if (inbound.type == "text" && m.contains("text") && m.at("text").is_object()) {
          const auto &t = m.at("text").as_object();
          inbound.textBody = t.contains("body") ? json::value_to<std::string>(t.at("body")) : "";
        } else if (inbound.type == "document" && m.contains("document") &&
                  m.at("document").is_object()) {
          // ADR-122: CV enviado como documento adjunto (rrhh). Solo se
          // extraen los campos -- la validación real de mime/tamaño ocurre
          // en whatsapp_bot_engine.cpp (nunca se confía en lo que reporta
          // el webhook sin volver a chequearlo contra la Graph API).
          const auto &d = m.at("document").as_object();
          inbound.mediaId = d.contains("id") ? json::value_to<std::string>(d.at("id")) : "";
          inbound.mediaFilename =
              d.contains("filename") ? json::value_to<std::string>(d.at("filename")) : "";
          inbound.mediaMimeType =
              d.contains("mime_type") ? json::value_to<std::string>(d.at("mime_type")) : "";
        } else if (inbound.type == "interactive" && m.contains("interactive") &&
                  m.at("interactive").is_object()) {
          const auto &interactive = m.at("interactive").as_object();
          const std::string itype =
              interactive.contains("type") ? json::value_to<std::string>(interactive.at("type"))
                                            : "";
          if (itype == "list_reply" && interactive.contains("list_reply") &&
              interactive.at("list_reply").is_object()) {
            const auto &lr = interactive.at("list_reply").as_object();
            inbound.interactiveReplyId =
                lr.contains("id") ? json::value_to<std::string>(lr.at("id")) : "";
          } else if (itype == "button_reply" && interactive.contains("button_reply") &&
                    interactive.at("button_reply").is_object()) {
            const auto &br = interactive.at("button_reply").as_object();
            inbound.interactiveReplyId =
                br.contains("id") ? json::value_to<std::string>(br.at("id")) : "";
          }
        }

        if (!inbound.fromE164.empty()) {
          support::handleInboundMessage(inbound);
        }
      }
    }
  }
}

/** @brief Extrae `entry[].changes[].value.statuses[]` (acuses de entrega: sent/
 * delivered/read/failed) y los deja en `whatsapp_message_log` (direction 'status')
 * -- diagnóstico real de por qué un mensaje saliente no llegó al destinatario,
 * en vez de tener que adivinar a partir de un 200 de la Graph API (que solo
 * confirma que Meta ACEPTÓ encolarlo, no que el teléfono lo recibió). Nunca se
 * mandaban a handleInboundMessage -- no son mensajes de un usuario. */
void dispatchStatusUpdates(const json::value &body) {
#if HAS_LIBPQ
  if (!body.is_object() || !body.as_object().contains("entry")) return;
  const auto &entries = body.as_object().at("entry");
  if (!entries.is_array()) return;

  for (const auto &entryVal : entries.as_array()) {
    if (!entryVal.is_object() || !entryVal.as_object().contains("changes")) continue;
    const auto &changes = entryVal.as_object().at("changes");
    if (!changes.is_array()) continue;

    for (const auto &changeVal : changes.as_array()) {
      if (!changeVal.is_object() || !changeVal.as_object().contains("value")) continue;
      const auto &valueObj = changeVal.as_object().at("value");
      if (!valueObj.is_object() || !valueObj.as_object().contains("statuses")) continue;
      const auto &statuses = valueObj.as_object().at("statuses");
      if (!statuses.is_array()) continue;

      const std::string lineId = resolveLineId(valueObj.as_object());

      for (const auto &stVal : statuses.as_array()) {
        if (!stVal.is_object()) continue;
        const auto &st = stVal.as_object();
        const std::string recipientId =
            st.contains("recipient_id") ? json::value_to<std::string>(st.at("recipient_id")) : "";
        const std::string statusText =
            st.contains("status") ? json::value_to<std::string>(st.at("status")) : "";
        const std::string waMessageId =
            st.contains("id") ? json::value_to<std::string>(st.at("id")) : "";
        std::cerr << "[WHATSAPP] acuse de entrega: to=" << recipientId << " status=" << statusText
                  << " wamid=" << waMessageId << std::endl;
        // direction='out': es un acuse SOBRE un mensaje que nosotros mandamos (el
        // CHECK de whatsapp_message_log solo admite 'in'/'out', ver db_scripts/59)
        // -- message_type='delivery_status' es lo que distingue este acuse de un
        // mensaje saliente real.
        support::appendMessageLogPg(AppConfig::instance().gDatabaseUrl, recipientId, lineId,
                                    "out", "delivery_status", stVal, waMessageId);
      }
    }
  }
#else
  (void)body;
#endif
}

// GET /api/support/whatsapp/webhook -- handshake de verificación de Meta:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started
http::response<http::string_body>
handleWebhookVerify(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> &query) {
  auto &cfg = AppConfig::instance();
  if (cfg.gWhatsappWebhookVerifyToken.empty()) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "webhook_not_configured"}});
  }
  const auto modeIt = query.find("hub.mode");
  const auto tokenIt = query.find("hub.verify_token");
  const auto challengeIt = query.find("hub.challenge");
  if (modeIt != query.end() && modeIt->second == "subscribe" && tokenIt != query.end() &&
      tokenIt->second == cfg.gWhatsappWebhookVerifyToken && challengeIt != query.end()) {
    http::response<http::string_body> res{http::status::ok, req.version()};
    res.set(http::field::content_type, "text/plain");
    res.body() = challengeIt->second;
    res.prepare_payload();
    return res;
  }
  return makeJsonResponse(http::status::forbidden,
                          json::object{{"error", "verification_failed"}});
}

// POST /api/support/whatsapp/webhook -- recepción real de mensajes. Siempre
// responde 200 una vez autenticada la firma (incluso ante payload
// malformado) -- Meta reintenta indefinidamente cualquier respuesta != 2xx,
// y un payload roto no se arregla reintentando el mismo evento.
http::response<http::string_body>
handleWebhookReceive(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &) {
  auto &cfg = AppConfig::instance();
  if (cfg.gWhatsappAppSecret.empty()) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "webhook_not_configured"}});
  }

  std::string signatureHeader;
  if (const auto it = req.find("X-Hub-Signature-256"); it != req.end()) {
    signatureHeader = std::string(it->value());
  }
  if (!support::verifyMetaWebhookSignature(req.body(), signatureHeader, cfg.gWhatsappAppSecret)) {
    std::cerr << "[WHATSAPP] webhook: firma invalida o ausente, request rechazada" << std::endl;
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "invalid_signature"}});
  }

  try {
    const auto parsed = json::parse(req.body());
    dispatchInboundMessages(parsed);
    dispatchStatusUpdates(parsed);
  } catch (const std::exception &ex) {
    std::cerr << "[WHATSAPP] webhook: payload invalido: " << ex.what() << std::endl;
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "received"}});
}

} // namespace

void registerWebhookRoutes(router::Router &r) {
  r.get("/api/support/whatsapp/webhook", handleWebhookVerify);
  r.post("/api/support/whatsapp/webhook", handleWebhookReceive);
}

} // namespace support_mod
