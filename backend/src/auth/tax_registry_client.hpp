#pragma once

#include <string>

namespace auth {

/**
 * @brief Resultado de consultar un verificador de RUC de terceros (ADR-087).
 *
 * SUNAT no publica una API REST oficial gratuita — solo el portal HTML
 * `e-consultaruc.sunat.gob.pe`. Este cliente habla con un proveedor externo
 * configurable (peruapi.com, apis.net.pe u otro con el mismo contrato de
 * "GET con token, JSON de vuelta"), como EXCEPCIÓN explícita y acotada a
 * ADR-001 ("todo on-prem, sin dependencias externas"): apagado por defecto,
 * con timeout corto, y su resultado NUNCA bloquea un alta — ver `available`.
 */
struct TaxRegistryLookup {
  /** false si el proveedor está deshabilitado, mal configurado o no
   * respondió a tiempo — el llamador debe tratar esto como "sin dato",
   * nunca como error que bloquee el alta/edición de la empresa. */
  bool available = false;
  bool found = false;
  std::string razonSocial;
  std::string estado;
  std::string condicion;
  std::string domicilioFiscal;
  std::string error;
};

/** @brief Consulta el proveedor configurado (BEEMETRY_TAX_REGISTRY_*) para un RUC peruano de 11 dígitos. No lanza excepciones. */
TaxRegistryLookup lookupPeruRuc(const std::string &ruc);

} // namespace auth
