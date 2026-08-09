#pragma once

#include <string>

namespace auth {

/**
 * @brief Valida la FORMA matemática de un identificador tributario (dígito
 * verificador) según el país. No consulta ningún padrón real — ver
 * tax_registry_client.hpp para eso. Extraído tal cual de
 * GET /api/auth/validate-company (auth_routes.cpp) sin cambiar el algoritmo:
 * Perú (RUC, 11 dígitos, prefijos 10/15/17/20, módulo 11 pesos
 * {5,4,3,2,7,6,5,4,3,2}), Brasil (CNPJ, 14 dígitos), US/CA (9 dígitos, solo
 * descarta números repetidos — no hay dígito verificador real en ese rango).
 * @param taxId Identificador tal cual llega (solo dígitos, sin guiones).
 * @param countryIso2 "PE" (default), "BR", "US" o "CA".
 * @return true si el dígito verificador (o la forma, para US/CA) es válido.
 */
bool validateTaxIdChecksum(const std::string &taxId,
                           const std::string &countryIso2);

/** @brief Quita espacios, guiones y puntos. No valida forma. */
std::string normalizeTaxId(const std::string &raw);

} // namespace auth
