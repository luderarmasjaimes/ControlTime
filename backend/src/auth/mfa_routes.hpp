#pragma once

#include "../http/router.hpp"

namespace auth {
namespace mfa {

/** @brief Registra `/api/auth/mfa/*` — enrolamiento y verificación de TOTP
 * (RFC 6238, ADR-135). Todo endpoint exige sesión autenticada (opera sobre
 * la propia cuenta del caller, nunca sobre otro usuario -- no hay concepto
 * de "admin resetea el MFA de otro" en esta entrega, ver el ADR para el
 * razonamiento de ese alcance). */
void registerRoutes(router::Router &r);

}  // namespace mfa
}  // namespace auth
