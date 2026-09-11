// --------------------------------------------------------------------------
// fotocheck_routes.hpp — credencial (foto real + QR cifrado) por usuario.
//
// GET /api/fotocheck/{token} — público (mismo criterio que
//   report_pdf_share_links/ADR-138): resuelve el token a un usuario y
//   devuelve la tarjeta PNG generada al vuelo (foto real + QR + campos),
//   sin sesión -- pensado para abrirse con cero pasos desde un link de
//   email/WhatsApp.
//
// POST /api/fotocheck/scan-qr — público: recibe un frame de cámara, lee
//   cualquier QR visible y, si descifra con la clave del servidor, devuelve
//   los campos en claro para PRECARGAR un formulario de login/registro.
//   Nunca autentica por sí solo -- ver fotocheck_crypto.hpp.
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"

namespace auth {
namespace fotocheck {

void registerRoutes(router::Router &r);

}  // namespace fotocheck
}  // namespace auth
