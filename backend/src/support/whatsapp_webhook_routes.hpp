#pragma once

#include "../http/router.hpp"

namespace support_mod {

/** @brief Registra el webhook de entrada de WhatsApp (handshake de
 * verificación + recepción de mensajes). Separado de `registerRoutes`
 * (support_routes.hpp) porque este es el único endpoint del backend
 * pensado para ser llamado por Meta, no por el frontend -- distinta
 * superficie de confianza (autenticación por firma HMAC, no por sesión). */
void registerWebhookRoutes(router::Router &r);

} // namespace support_mod
