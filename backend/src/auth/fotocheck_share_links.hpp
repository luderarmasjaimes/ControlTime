#pragma once

#include <optional>
#include <string>

namespace auth {
namespace fotocheck {

/** @brief Crea (o reutiliza, si ya existe uno para este usuario) un token
 * opaco (`http_utils::secureRandomHex`, mismo patrón que
 * `reports::createReportShareLinkPg`, ADR-138) que resuelve al fotocheck de
 * `userId` sin necesitar sesión -- pensado para mandarse por email/WhatsApp
 * y abrirse con cero pasos desde el celular. Sin expiración: es una
 * credencial personal, no una descarga puntual.
 * @return El token, o cadena vacía si falló (ver `error`). */
std::string getOrCreateFotocheckShareLinkPg(const std::string &databaseUrl,
                                            const std::string &userId,
                                            std::string &error);

/** @brief Resuelve un token a su `user_id`. `std::nullopt` si no existe. */
std::optional<std::string> resolveFotocheckShareLinkPg(const std::string &databaseUrl,
                                                        const std::string &token);

}  // namespace fotocheck
}  // namespace auth
