#pragma once

#include <string>
#include <vector>

namespace reports {

/** @brief Resuelve el texto de marca de agua a aplicar en el export PDF de
 * `reportId` (ADR-080): lee `report_document_settings.watermark_json` (si
 * existe una fila y trae `text` no vacío, lo usa tal cual); si no hay fila o
 * el campo viene vacío, arma un texto por defecto
 * "CONFIDENCIAL — {tenantId} — Generado para {username} — {fecha}". Nunca
 * falla — ante cualquier error de BD, devuelve el texto por defecto (el
 * watermark es una capa de trazabilidad visual, no un control de acceso: no
 * debe bloquear el export si la fila de settings no está disponible). */
std::string resolveWatermarkText(const std::string &databaseUrl, const std::string &reportId,
                                 const std::string &tenantId, const std::string &username);

/** @brief Lee la lista de correos adicionales a quienes enviar automáticamente
 * el PDF exportado de `reportId` (ADR-204, `pdf_share_recipients_json`).
 * Nunca falla — ante cualquier error de BD, fila ausente, o JSON corruto,
 * devuelve lista vacía (mismo criterio que `resolveWatermarkText`: esto es
 * una lista de conveniencia, no debe bloquear el export). */
std::vector<std::string> resolvePdfShareRecipients(const std::string &databaseUrl,
                                                    const std::string &reportId);

/** @brief Reemplaza por completo la lista de correos adicionales de
 * `reportId` (UPSERT — primer INSERT/UPSERT real de `report_document_settings`,
 * ADR-204). Valida cada email con un regex mínimo propio (se duplica a
 * propósito en vez de exportar `isSafeEmail` de `mining_iot::alarm_notifier`
 * — no se acopla el dominio `reports` al de `mining_iot`), descarta en
 * silencio los inválidos y trunca a 10 destinatarios. El caller
 * (`report_routes.cpp`) debe verificar tenant/permiso `informes.share` ANTES
 * de llamar — esta función no vuelve a chequear nada de eso.
 * @return true si el UPSERT tuvo éxito (ver `error` si no). */
bool savePdfShareRecipients(const std::string &databaseUrl, const std::string &reportId,
                            const std::vector<std::string> &emails, std::string &error);

}  // namespace reports
