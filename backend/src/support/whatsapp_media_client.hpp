#pragma once

// --------------------------------------------------------------------------
// whatsapp_media_client.hpp — Descarga de documentos adjuntos de WhatsApp
// (ADR-122)
// --------------------------------------------------------------------------
// Dos llamadas a la Graph API de Meta con el mismo bearer token que
// whatsapp_client.cpp ya usa para ENVIAR mensajes (una WABA, un token --
// recibir media no es un permiso aparte): primero se resuelve el `media_id`
// del webhook a una URL firmada de corta duración + tamaño/mime real
// (`GET /{version}/{media_id}`), luego se descarga esa URL. Separado de
// whatsapp_client.cpp porque ese archivo es POST-only (mensajes salientes);
// esto es la única ruta GET con headers custom de todo el bot.
// --------------------------------------------------------------------------

#include "../config/app_config.hpp"

#include <string>
#include <vector>

namespace support {

struct WhatsappMediaDownloadResult {
  bool ok = false;
  std::vector<unsigned char> bytes;
  std::string mimeType;
  std::string error; // vacío si ok
};

/**
 * @brief Descarga el documento `mediaId` recibido en un mensaje entrante de
 * WhatsApp. Aplica el tope `maxBytes` en dos puntos (antes de descargar,
 * usando el `file_size` que reporta la Graph API; y de nuevo sobre los
 * bytes ya descargados, por si el reporte de tamaño no fuera fiable) --
 * nunca confía en un solo chequeo (ver ADR-122, "Riesgos"). Nunca lanza.
 */
WhatsappMediaDownloadResult downloadWhatsappMedia(const config::WhatsappLine &line,
                                                   const std::string &mediaId,
                                                   std::size_t maxBytes);

} // namespace support
