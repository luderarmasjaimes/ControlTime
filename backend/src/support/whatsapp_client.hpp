#pragma once

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
 * Graph API) al número `toE164` (sin '+', p. ej. "51945095575"). Solo se
 * pueden enviar mensajes de PLANTILLA (no texto libre) fuera de la ventana
 * de 24h de una conversación iniciada por el cliente -- esa es la razón de
 * que este cliente solo exponga el envío de plantillas, no texto libre.
 * `bodyParams` son los parámetros posicionales del cuerpo de la plantilla
 * (vacío para plantillas sin parámetros, p. ej. "hello_world").
 */
WhatsappSendResult sendWhatsappTemplateMessage(const std::string &toE164,
                                                const std::string &templateName,
                                                const std::string &languageCode,
                                                const std::vector<std::string> &bodyParams = {});

} // namespace support
