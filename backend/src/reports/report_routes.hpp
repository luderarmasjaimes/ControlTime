#pragma once

#include "../http/router.hpp"

namespace reports {

/** @brief Registra las rutas HTTP CRUD de informes (proyectos, listar/leer/crear/actualizar/eliminar) en el router. */
void registerRoutes(router::Router& r);

} // namespace reports
