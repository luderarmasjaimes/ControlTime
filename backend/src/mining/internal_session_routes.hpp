// --------------------------------------------------------------------------
// internal_session_routes.hpp — ADR-188: resolución de sesión servicio-a-
// servicio para el sidecar `formula_engine`. Ese sidecar recibe las
// requests de `/formula-api/` con `Authorization` YA sobrescrito por nginx
// a un secreto fijo compartido (frontend/nginx.conf, autenticación
// servicio-a-servicio histórica) — pero la cookie de sesión del usuario real
// SÍ llega intacta. En vez de que el sidecar C++ reimplemente el parseo/
// verificación de JWT (duplicar secreto de firma + lógica de
// auth_session.cpp), reenvía esa cookie acá y este endpoint responde con el
// tenant/usuario real, reusando auth::resolveAuthSession tal cual la usa
// cualquier otro handler real del backend.
//
// Este endpoint en sí mismo exige un segundo secreto compartido
// (BEEMETRY_FORMULA_AUTH_TOKEN, el mismo que ya usa nginx para /formula-api/)
// en el header `X-Internal-Token`, para que no sea invocable por cualquiera
// que adivine la ruta -- no está pensado para ser llamado por el navegador.
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"

namespace mining_iot {

/** @brief Registra GET /api/internal/resolve-session. */
void registerInternalSessionRoutes(router::Router &r);

} // namespace mining_iot
