#pragma once

#include <string>

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

}  // namespace reports
