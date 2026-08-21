#pragma once

// --------------------------------------------------------------------------
// whatsapp_bot_engine.hpp — Máquina de estado del bot conversacional
// --------------------------------------------------------------------------
// Recibe un mensaje entrante ya extraído del payload de Meta (ver
// whatsapp_webhook_routes.cpp), decide la siguiente respuesta según el
// estado guardado en `whatsapp_conversation` (support_storage_pg) y la
// envía vía whatsapp_client. Sin este motor, el webhook solo podría loguear
// mensajes -- acá vive el menú, los sub-flujos de calificación (soporte/
// comercial/reclamos/agenda/emergencia), el puente a la IA (mismo Ollama que
// SupportChatWidget) y el catálogo de documentos.
// --------------------------------------------------------------------------

#include "whatsapp_menu.hpp"

#include <boost/json.hpp>
#include <string>

namespace json = boost::json;

namespace support {

/**
 * @brief Un mensaje entrante normalizado (ya extraído de
 * `entry[].changes[].value.messages[]` por el webhook).
 */
struct InboundWhatsappMessage {
  std::string fromE164;
  std::string waMessageId;
  /** Id corto de la línea de WhatsApp que recibió este mensaje (ADR-113),
   * resuelto por el webhook a partir de `value.metadata.phone_number_id`. */
  std::string lineId;
  /** 'text' | 'interactive' | 'document' | otro tipo de Meta no soportado
   * (se trata como texto vacío). */
  std::string type;
  std::string textBody;          ///< presente si type == 'text'
  std::string interactiveReplyId; ///< list_reply.id o button_reply.id si type == 'interactive'
  // ADR-122: presentes si type == 'document' -- ver dispatchInboundMessages
  // en whatsapp_webhook_routes.cpp. mediaId es lo único imprescindible (el
  // id que se resuelve a bytes reales vía whatsapp_media_client); filename/
  // mimeType son lo que Meta reportó, pero whatsapp_bot_engine.cpp NO confía
  // ciegamente en ellos -- vuelve a validar el mime_type real que devuelve
  // la Graph API al resolver el media_id.
  std::string mediaId;
  std::string mediaFilename;
  std::string mediaMimeType;
  json::object rawPayload;        ///< el mensaje tal cual llegó -- para whatsapp_message_log
};

/**
 * @brief Procesa un turno completo: resuelve/crea la conversación, avanza el
 * estado según el menú/sub-flujo activo, envía la(s) respuesta(s) por
 * WhatsApp y persiste todo (estado nuevo + log de entrada y salida). No
 * lanza excepciones -- cualquier fallo de envío/DB se loguea y el turno
 * simplemente no deja respuesta visible, nunca tumba el webhook (Meta debe
 * recibir 200 siempre, ver whatsapp_webhook_routes.cpp).
 */
void handleInboundMessage(const InboundWhatsappMessage &msg);

} // namespace support
