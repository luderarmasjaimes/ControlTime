#pragma once

// --------------------------------------------------------------------------
// rp_gateway_routes.hpp — ADR-103: REST para el frontend nuevo (distinto a
// InformeCliente) sobre el catálogo de equipos replicado desde TimeTelemetry.
// --------------------------------------------------------------------------
// Auth: sesión/JWT vía auth::resolveAuthSession (mismo mecanismo que el
// resto de la plataforma) para todas las rutas salvo el webhook de Odoo,
// que usa una API key de servicio de un solo propósito (ver rp_odoo_sync.hpp
// y ADR-103 para la justificación de por qué esa ruta es la única excepción).
// Lecturas SIEMPRE contra storage::PgPool::replica() (Art. 3 de la
// Constitución) -- nunca compiten con los hilos de sync de rp_odoo_sync.cpp.
// --------------------------------------------------------------------------

#include "../http/router.hpp"

namespace mining {
namespace rp_gateway {

void registerRoutes(router::Router& r);

} // namespace rp_gateway
} // namespace mining
