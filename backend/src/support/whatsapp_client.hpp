#pragma once

#include "../config/app_config.hpp"

#include <string>
#include <vector>

namespace support {

struct WhatsappSendResult {
  bool ok = false;
  int httpStatus = 0;
  std::string error;
  std::string rawResponse;
};

/**
 * @brief Envía un mensaje de plantilla vía WhatsApp Business Cloud API (Meta
 * Graph API) al número `toE164` (sin '+', p. ej. "51945095575"), usando el
 * `phone_number_id`/`access token` de `line` (ADR-113: una WABA/App de Meta
 * puede tener varias líneas -- soporte, comercial, etc. -- cada una emite
 * desde su propio número). Solo se pueden enviar mensajes de PLANTILLA (no
 * texto libre) fuera de la ventana de 24h de una conversación iniciada por
 * el cliente -- esa es la razón de que este cliente solo exponga el envío
 * de plantillas, no texto libre. `bodyParams` son los parámetros
 * posicionales del cuerpo de la plantilla (vacío para plantillas sin
 * parámetros, p. ej. "hello_world").
 */
WhatsappSendResult sendWhatsappTemplateMessage(const config::WhatsappLine &line,
                                                const std::string &toE164,
                                                const std::string &templateName,
                                                const std::string &languageCode,
                                                const std::vector<std::string> &bodyParams = {});

/**
 * @brief Envía texto libre (sin plantilla) desde `line`. Solo válido dentro
 * de la ventana de 24h abierta por un mensaje ENTRANTE del usuario (ver
 * whatsapp_bot_engine -- todo su uso nace de responder a un webhook, nunca
 * de un contacto iniciado por el negocio, que es el caso que sí requiere
 * plantilla).
 */
WhatsappSendResult sendWhatsappTextMessage(const config::WhatsappLine &line,
                                            const std::string &toE164,
                                            const std::string &body);

/** @brief Una fila seleccionable de un mensaje interactivo tipo "list". */
struct WhatsappListRow {
  std::string id;          ///< vuelve en el webhook como interactive.list_reply.id
  std::string title;       ///< máx. 24 caracteres (límite de Meta)
  std::string description; ///< máx. 72 caracteres, opcional (puede ir vacío)
};

/** @brief Un grupo de filas dentro de la lista (Meta permite varias secciones). */
struct WhatsappListSection {
  std::string title;
  std::vector<WhatsappListRow> rows;
};

/**
 * @brief Envía un menú nativo de WhatsApp (mensaje interactivo tipo "list",
 * hasta 10 filas en total entre todas las secciones -- límite de Meta). Es
 * la forma "amigable" del menú del bot: emoji+título+descripción por fila,
 * en vez de que el usuario tenga que escribir un número a mano.
 * `headerText`/`footerText` vacíos = sin esa sección del mensaje.
 */
WhatsappSendResult sendWhatsappInteractiveListMessage(
    const config::WhatsappLine &line,
    const std::string &toE164, const std::string &headerText,
    const std::string &bodyText, const std::string &footerText,
    const std::string &buttonLabel,
    const std::vector<WhatsappListSection> &sections);

/** @brief Un botón de respuesta rápida de un mensaje interactivo tipo "button". */
struct WhatsappButton {
  std::string id;    ///< vuelve en el webhook como interactive.button_reply.id
  std::string title; ///< máx. 20 caracteres (límite de Meta)
};

/**
 * @brief Envía hasta 3 botones de respuesta rápida (límite duro de Meta --
 * `buttons` se trunca en silencio si trae más). Se usa para confirmaciones
 * cortas (sí/no, volver al menú) donde una lista completa sería excesiva.
 */
WhatsappSendResult
sendWhatsappInteractiveButtonsMessage(const config::WhatsappLine &line,
                                      const std::string &toE164,
                                      const std::string &bodyText,
                                      const std::vector<WhatsappButton> &buttons);

} // namespace support
