#pragma once

// --------------------------------------------------------------------------
// cv_routes.hpp — Panel admin de postulaciones de CV (ADR-122)
// --------------------------------------------------------------------------
// GET /api/support/admin/candidates(/{id}(/file)?)? -- mismo bloque de
// autorización que handleSearchTickets en support_routes.cpp (sesión +
// soporte.view/soporte.manage, o department == 'rrhh', ADR-115), pero acá
// SIN la variante "global sin filtro": un candidato de CV es, por
// definición, siempre del dominio rrhh (a diferencia de un ticket, que
// puede ser de cualquier categoría) -- ver cv_routes.cpp.
// --------------------------------------------------------------------------

#include "../http/router.hpp"

namespace support_mod {

void registerCvRoutes(router::Router &r);

} // namespace support_mod
