#pragma once

#include <string>

namespace auth {

/**
 * @brief Valida la FORMA matemática de un identificador tributario (dígito
 * verificador) según el país. No consulta ningún padrón real — ver
 * tax_registry_client.hpp para eso.
 *
 * Con dígito verificador real: Perú (RUC, 11 dígitos, prefijos
 * 10/15/17/20, módulo 11 pesos {5,4,3,2,7,6,5,4,3,2}), Brasil (CNPJ, 14
 * dígitos), Ecuador (RUC, 13 dígitos, algoritmo módulo 10 o módulo 11
 * según el 3er dígito — persona natural/sociedad privada/entidad
 * pública), Chile (RUT, módulo 11, dígito verificador puede ser 'K').
 * US/CA (9 dígitos, solo descarta números repetidos — no hay dígito
 * verificador real conocido en ese rango).
 *
 * Sin dígito verificador matemático confirmado: Costa Rica (cédula
 * jurídica, se valida solo longitud=10 sin cero inicial — no existe
 * fuente pública confiable de un checksum real, ver tax_id.cpp) y el
 * resto de los ~24 países del catálogo (db_scripts/16, 25): fallback
 * estructural genérico (6-15 dígitos, no todos repetidos), documentado
 * explícitamente como "sin checksum real" en vez de bloquear el
 * registro de una empresa de un país válido del catálogo (ver
 * ADR-102).
 *
 * @param taxId Identificador tal cual llega (solo dígitos; conserva una
 * 'K' final para RUT chileno, ver normalizeTaxId).
 * @param countryIso2 Código ISO2 del país declarado (p.ej. "PE", "BR",
 * "US", "CA", "EC", "CL", "CR"); cualquier otro cae al fallback genérico.
 * @return true si el dígito verificador (o la forma, donde no hay
 * checksum real) es válido.
 */
bool validateTaxIdChecksum(const std::string &taxId,
                           const std::string &countryIso2);

/** @brief Quita espacios, guiones y puntos; conserva dígitos y una 'K'/'k'
 * final (normalizada a mayúscula) para el dígito verificador del RUT
 * chileno. No valida forma. */
std::string normalizeTaxId(const std::string &raw);

} // namespace auth
