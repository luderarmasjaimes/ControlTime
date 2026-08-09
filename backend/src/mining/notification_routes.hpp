#pragma once
#include "../http/router.hpp"

namespace mining_iot {
// Registra rutas de canales de notificación (CRUD) y permisos/RBAC.
void registerNotificationRoutes(router::Router &r);
} // namespace mining_iot
