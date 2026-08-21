#pragma once

// --------------------------------------------------------------------------
// whatsapp_signature.hpp — Verificación de X-Hub-Signature-256 (Meta)
// --------------------------------------------------------------------------
// Extraído de whatsapp_webhook_routes.cpp a su propio archivo puro (solo
// depende de auth::jwt::hmacSha256, sin DB/red) para poder cubrirlo con un
// test unitario real en el target `beemetry_backend_tests` (ADR-060), que
// deliberadamente no linkea libpq/red -- ver el comentario de ese target en
// CMakeLists.txt.
// --------------------------------------------------------------------------

#include <string>

namespace support {

/**
 * @brief Valida el header `X-Hub-Signature-256: sha256=<hex>` que Meta agrega a
 * cada POST del webhook, recalculando el HMAC-SHA256 del body crudo con el app
 * secret y comparando en tiempo constante. Debe llamarse sobre el body EXACTO
 * recibido, antes de cualquier parseo/normalización (parsear primero pierde el
 * byte-a-byte que Meta realmente firmó).
 * @return true si `headerValue` tiene el prefijo esperado y el HMAC coincide.
 */
bool verifyMetaWebhookSignature(const std::string &rawBody, const std::string &headerValue,
                                const std::string &appSecret);

} // namespace support
