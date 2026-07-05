#pragma once

#include "../auth/auth_types.hpp"

#include <boost/json.hpp>
#include <string>
#include <vector>

namespace json = boost::json;

namespace reports {

using auth::Project;
using auth::Report;

/** @brief Lista todos los proyectos (sin filtro de tenant). @return Vector de proyectos; vacío en error (ver `error`). */
std::vector<Project> listProjectsPg(const std::string &databaseUrl, std::string &error);

/** @brief Lista los informes activos (no eliminados) de `company`, ordenados por fecha de creación descendente. Incluye metadatos de firma documental (ADR-018) pero no `content_json`. @return Vector de informes; vacío en error (ver `error`). */
std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &company, std::string &error);

/** @brief Obtiene un informe completo (incluye `content_json` y firma documental) por `id`, filtrado por `company` (tenant). @return true si se encontró; false con `error="report_not_found"` en otro caso. */
bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &company, Report &out,
                     std::string &error);

/** @brief Crea un informe nuevo. Por ADR-017 solo puede nacer en `draft` — cualquier otro `status` en `r` es rechazado (`error` empieza con "invalid_workflow_transition:"). @return true y `outNewId` poblado si el INSERT tuvo éxito. */
bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

/** @brief Actualiza título/contenido/estado de un informe dentro de una transacción con lock de fila (`SELECT ... FOR UPDATE`). Valida la transición de estado contra la máquina canónica (ADR-017, `report_workflow.hpp`) antes de aplicar cualquier cambio — un salto inválido aborta TODO el update (ni el contenido se guarda). Si la transición es a `signed`, captura la firma documental (ADR-018: nombre/cargo/fecha resueltos server-side desde `signerRole` + `auditUsername`) en la misma sentencia; transiciones posteriores (p.ej. `signed`→`archived`) no la sobreescriben. Toda transición real genera una entrada de auditoría con hash encadenado, incluyendo `workflowComment` (p.ej. motivo de rechazo) cuando se provee. @return true si el update tuvo éxito; false con `error="invalid_workflow_transition:<from>-><to>"` o `error="report_not_found"` en los rechazos de negocio. */
bool updateReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken,
                    const std::string &signerRole = std::string(),
                    const std::string &workflowComment = std::string());

/** @brief Soft-delete de un informe (`deleted_at = NOW()`), filtrado por `company` (tenant). @return true si la fila existía y pertenecía al tenant. */
bool deleteReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

/** @brief Lista las revisiones server-side (ADR-015) de un informe, más recientes primero, filtrado por tenant (join contra `reports` por company_name). Incluye `content_json` completo de cada revisión — aceptable para el volumen actual; si los informes crecen mucho, paginar/perezoso queda como trabajo futuro. @return Vector de revisiones; vacío si el informe no existe, no pertenece al tenant, o no tiene revisiones aún. */
json::array listReportRevisionsPg(const std::string &databaseUrl, const std::string &id,
                                  const std::string &company, std::string &error);

} // namespace reports
