#pragma once

#include "../http/router.hpp"

namespace tenant_assets {

/** @brief Registra las rutas HTTP de activos de imagen por tenant: logotipo
 * corporativo (SVG, ADR-046) y galería de fotos de la unidad minera (JPEG,
 * ADR-047) — GET de lectura (autenticado) + POST de carga (admin-only). */
void registerRoutes(router::Router &r);

} // namespace tenant_assets
