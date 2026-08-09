#pragma once

#include <boost/json.hpp>

#include <string>

#include "../auth/auth_types.hpp"

namespace json = boost::json;

namespace reports::portable {

struct ExportResult {
  bool ok = false;
  std::string bytes;  // contenedor binario .mreport (cifrado)
  std::string error;
};

/** @brief Exporta un informe a un contenedor `.mreport`: metadatos + documento
 * completo, con las imágenes reubicadas a una sección binaria cruda (evita el
 * ~33% de inflado que deja el base64 embebido en JSON), todo cifrado con
 * AES-256-GCM bajo una clave que solo conoce este backend
 * (`BEEMETRY_REPORT_EXPORT_KEY`). No es un ZIP estándar: no hay forma de
 * abrirlo sin pasar por `importReport` de este mismo binario. */
ExportResult exportReport(const auth::Report &report,
                          const std::string &exportedByUsername);

struct ImportResult {
  bool ok = false;
  std::string error;
  json::value document;     // documento completo (redactado o no)
  std::string title;
  std::string sourceCompany;
  bool tenantMatch = false;  // true = misma unidad minera que generó el archivo
  bool redacted = false;     // true = se redactaron imágenes/kpis/gráficos/mapas/sensores
};

/** @brief Descifra y valida un `.mreport`. Compara el tenant/empresa embebido
 * (cifrado) contra el del solicitante (mismo criterio que
 * `auth::userBelongsToTenant` / ADR-038/039: tenant_id real si ambos lo
 * tienen, si no cae a company_name — nunca trata dos vacíos de orígenes
 * distintos como coincidencia). Si coincide, devuelve el documento intacto;
 * si no, devuelve la misma estructura (posiciones/tamaños/tipos de bloque)
 * pero con imágenes, mapas, gráficos, KPIs y sensores de la otra unidad
 * reemplazados por marcadores neutros — el texto (párrafos, tablas, TOC)
 * nunca se modifica, sin importar el tenant. */
ImportResult importReport(const std::string &fileBytes,
                          const std::string &requesterTenantId,
                          const std::string &requesterCompany);

}  // namespace reports::portable
