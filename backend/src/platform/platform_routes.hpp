#pragma once

#include "../http/router.hpp"

namespace platform {

/** @brief Registra las rutas HTTP de plataforma (catálogos de países e idiomas de UI) en el router. */
void registerRoutes(router::Router &r);

} // namespace platform
