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

/** @brief Lista los informes activos (no eliminados) de `tenantId` (UUID, ADR-039 — aislamiento real, ya no `company_name`), ordenados por fecha de creación descendente. Incluye metadatos de firma documental (ADR-018) pero no `content_json`. `tenantId` vacío devuelve lista vacía sin consultar la BD (sesión sin tenant real). @return Vector de informes; vacío en error (ver `error`). */
std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &tenantId, std::string &error);

/** @brief Obtiene un informe completo (incluye `content_json` y firma documental) por `id`, filtrado por `tenantId` (UUID). `tenantId` vacío devuelve `error="report_not_found"` sin consultar la BD. @return true si se encontró; false con `error="report_not_found"` en otro caso. */
bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &tenantId, Report &out,
                     std::string &error);

/** @brief Crea un informe nuevo. Por ADR-017 solo puede nacer en `draft` — cualquier otro `status` en `r` es rechazado (`error` empieza con "invalid_workflow_transition:"). Por ADR-039 (migración completa), `r.tenantId` es OBLIGATORIO — `error="tenant_required"` si viene vacío, sin tocar la BD. @return true y `outNewId`/`outVersionNumber` poblados (siempre 1, ADR-015) si el INSERT tuvo éxito. */
bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken, int &outVersionNumber);

/** @brief Actualiza título/contenido/estado de un informe dentro de una transacción con lock de fila (`SELECT ... FOR UPDATE`), filtrado por `tenantId` (UUID, ADR-039). Valida la transición de estado contra la máquina canónica (ADR-017, `report_workflow.hpp`) antes de aplicar cualquier cambio — un salto inválido aborta TODO el update (ni el contenido se guarda). Si la transición es a `signed`, captura la firma documental (ADR-018: nombre/cargo/fecha resueltos server-side desde `signerRole` + `auditUsername`, buscado en `auth_users` por `auditCompany` — la empresa propia de la sesión, no el tenant filtrado) en la misma sentencia; transiciones posteriores (p.ej. `signed`→`archived`) no la sobreescriben. Toda transición real genera una entrada de auditoría con hash encadenado, incluyendo `workflowComment` (p.ej. motivo de rechazo) cuando se provee.
 *
 * ADR-022 (resolución de conflictos, 2026-07-13): `expectedVersion` es la
 * concurrencia optimista que cierra la regla dura "prohibido last-write-wins
 * silencioso" — si no viene vacío, se compara (dentro del mismo lock de
 * fila, antes de aplicar cualquier cambio) contra el `version_number` REAL
 * actual del informe. Si no coincide (otra terminal ya guardó una versión
 * más nueva mientras esta editaba, típicamente sin conexión), el update se
 * aborta por completo — `error="version_conflict:<versionActual>"` — sin
 * tocar ni un byte de la fila. Vacío (`""`) preserva el comportamiento
 * anterior sin chequeo (autosave/guardado normal en línea, donde el cliente
 * siempre parte de la versión recién confirmada, sin riesgo real de
 * conflicto).
 *
 * ADR-079 (RBAC de workflow, 2026-08-02): `userId` habilita el chequeo de
 * autorización vía `auth::hasPermission` (`informes.edit` si el estado
 * ACTUAL es `draft`/`rejected`, `informes.sign` si es `in_review`/
 * `approved`) — antes de este fix, el único chequeo era pertenencia al
 * tenant, así que cualquier rol podía aprobar/firmar cualquier informe.
 * Además, `signed`/`archived` quedan inmutables sin excepción de rol (ni
 * admin): ni un PUT de "mismo estado" ni una transición pueden alterarlos.
 * @return true si el update tuvo éxito; false con
 * `error="invalid_workflow_transition:<from>-><to>"`,
 * `error="version_conflict:<versionActual>"`, `error="report_not_found"`,
 * `error="forbidden:<permissionCode>"` o `error="report_immutable:<status>"`
 * en los rechazos de negocio. */
/** @brief `outVersionNumber` (ADR-021/ADR-015): número de versión server-autoritativo recién confirmado en `report_content_revision` — el cliente lo usa para mostrar la versión real del informe en vez de su propio contador local de ediciones (`document.meta.version`, que no representa lo mismo). */
bool updateReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &tenantId, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken, int &outVersionNumber,
                    const std::string &userId,
                    const std::string &signerRole = std::string(),
                    const std::string &workflowComment = std::string(),
                    const std::string &expectedVersion = std::string());

/** @brief Soft-delete de un informe (`deleted_at = NOW()`), filtrado por `tenantId` (UUID, ADR-039). ADR-079: rechaza con `error="report_immutable:signed"` si el informe está firmado (inmutable sin excepción de rol). @return true si la fila existía, pertenecía al tenant y no estaba firmada. */
bool deleteReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &tenantId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

/** @brief Lista las revisiones server-side (ADR-015) de un informe, más recientes primero, filtrado por `tenantId` (UUID, join contra `reports` por `tenant_id`, ADR-039). Incluye `content_json` completo de cada revisión — aceptable para el volumen actual; si los informes crecen mucho, paginar/perezoso queda como trabajo futuro. @return Vector de revisiones; vacío si el informe no existe, no pertenece al tenant, o no tiene revisiones aún. */
json::array listReportRevisionsPg(const std::string &databaseUrl, const std::string &id,
                                  const std::string &tenantId, std::string &error);

// ── Export asíncrono a PPTX/MP4 (job queue sobre report_export_job) ───────

/** @brief Fila de `report_export_job` — job de exportación asíncrona (pptx/mp4). */
struct ExportJob {
  std::string jobId;
  std::string reportId;
  std::string exportFormat;   // 'pptx' | 'mp4' (también admite docx/pdf/html/odt por el CHECK de la tabla, sin uso aún)
  std::string status;         // 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  std::string storageUri;
  std::string errorMessage;
  json::value options = json::object{};
  std::string createdAt;
  std::string startedAt;
  std::string completedAt;
};

/** @brief Crea un job de exportación en estado `queued`. `contentRevisionId` puede venir vacío (sin asociar a una revisión puntual). @return true y `outJobId` poblado si el INSERT tuvo éxito. */
bool createExportJobPg(const std::string &databaseUrl, const std::string &reportId,
                       const std::string &tenantId, const std::string &exportFormat,
                       const json::value &optionsJson, const std::string &createdByUserId,
                       const std::string &contentRevisionId, std::string &outJobId,
                       std::string &error);

/** @brief Obtiene un job de exportación por id, filtrado por `tenantId` (mismo guard IDOR que `getReportByIdPg`). @return true si se encontró; false con `error="export_job_not_found"` en otro caso. */
bool getExportJobPg(const std::string &databaseUrl, const std::string &jobId,
                    const std::string &tenantId, ExportJob &out, std::string &error);

/** @brief Actualiza el estado de un job desde el worker (hilo detached de `report_export_jobs.cpp`). `storageUri`/`errorMessage` vacíos no sobreescriben el valor previo (COALESCE para storage_uri; error_message se limpia solo al pasar a un estado no-`failed`). `started_at`/`completed_at` se resuelven server-side según el `status` destino. */
bool updateExportJobStatusPg(const std::string &databaseUrl, const std::string &jobId,
                             const std::string &status, const std::string &storageUri,
                             const std::string &errorMessage, std::string &error);

// ── Narración por diapositiva (report_export_job_asset, Stage 4) ──────────

/** @brief Fila de `report_export_job_asset` — narración (audio grabado o notas para TTS futuro) de UNA página de un job `pptx`. */
struct ExportJobAsset {
  std::string assetId;
  std::string jobId;
  int pageNumber = 0;
  std::string kind;          // 'recorded_audio' | 'tts_from_notes'
  std::string storageUri;    // solo si kind='recorded_audio'
  std::string speakerNotes;  // texto fuente si kind='tts_from_notes' (o notas junto al audio)
  double durationSeconds = 0;
};

/** @brief Crea o reemplaza (por `(job_id, page_number)`, UNIQUE en la tabla) la narración de una página. @return true si el upsert tuvo éxito. */
bool upsertExportJobAssetPg(const std::string &databaseUrl, const std::string &jobId,
                            int pageNumber, const std::string &kind,
                            const std::string &storageUri, const std::string &speakerNotes,
                            double durationSeconds, std::string &error);

/** @brief Lista las narraciones de un job, ordenadas por `page_number`. @return Vector vacío si el job no tiene narración o no existe. */
std::vector<ExportJobAsset> listExportJobAssetsPg(const std::string &databaseUrl,
                                                  const std::string &jobId, std::string &error);

} // namespace reports
