// --------------------------------------------------------------------------
// contact_otp_routes.hpp — OTP de validación de contacto pre-registro.
//
// Contexto: antes de que el usuario complete el registro biométrico facial,
// el sistema verifica que el email y el número de celular ingresados en el
// formulario le pertenezcan realmente, enviando un OTP de 6 dígitos por cada
// canal. Esto previene:
//   - Registros con datos de terceros (correos/teléfonos de otra persona).
//   - Acumulación de cuentas con contactos falsos o malformados.
//
// Rutas:
//   POST /api/auth/contact-otp/send   — genera y envía el OTP
//   POST /api/auth/contact-otp/verify — valida el OTP ingresado
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"

namespace auth {
namespace contact_otp {

/** @brief Registra `/api/auth/contact-otp/*`.
 *  Rutas públicas (no requieren sesión activa) — se usan durante el flujo
 *  de pre-registro para validar que el email y el teléfono le pertenecen al
 *  usuario antes de activar el paso de captura biométrica facial. */
void registerRoutes(router::Router& r);

}  // namespace contact_otp
}  // namespace auth
