#pragma once
#include "../http/router.hpp"

namespace notify {
// Registra la API de notificaciones multi-canal:
//   POST /api/notifications/send      -- disparo genérico (cualquier app de
//                                         la empresa, reusando la sesión web
//                                         estándar de la plataforma).
//   GET  /api/notifications           -- bandeja propia (canal in_app).
//   POST /api/notifications/{id}/read -- marcar como leída.
void registerRoutes(router::Router &r);
} // namespace notify
