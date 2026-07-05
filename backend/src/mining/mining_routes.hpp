#pragma once

#include "../http/router.hpp"

namespace mining {

/** @brief Registra las rutas HTTP del dominio de minería (dashboard, KPIs, sensores, cámaras) en el router. */
void registerRoutes(router::Router& r);

} // namespace mining
