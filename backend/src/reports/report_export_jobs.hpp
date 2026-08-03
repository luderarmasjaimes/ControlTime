#pragma once

#include <boost/json.hpp>

#include <string>

namespace json = boost::json;

namespace reports {

/** @brief Worker de un job `report_export_job` (export_format='pptx'): marca el job `running`, pide al sidecar Chromium (mismo servicio que `exportReportPdf`, endpoint `/render-pptx`) que capture cada página del informe en modo presentación y componga el `.pptx`, y deja el job en `success` (con `storage_uri`) o `failed` (con `error_message`). Pensado para correr en un `std::thread(...).detach()` disparado desde la ruta `POST /api/reports/{id}/export/pptx` — nunca se llama de forma síncrona dentro del request HTTP (ADR-023: el render de Chromium+composición puede exceder el presupuesto de latencia de un endpoint síncrono). */
void runPptxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken);

/** @brief Worker de un job `report_export_job` (export_format='mp4'): pide al
 * sidecar (mismo servicio del PPTX, endpoint `/render-video`) que componga un
 * MP4 a partir de las imágenes de diapositiva YA generadas para un job pptx
 * exitoso (`pptxStoragePath` = su `storage_uri`) — nunca vuelve a lanzar
 * Chromium ni a navegar el informe. `narration` (Stage 4, puede ser un array
 * vacío): las filas de `report_export_job_asset` del job pptx, ya serializadas
 * a JSON (`{page_number, kind, storage_uri, speaker_notes, duration_seconds}`
 * cada una) — el sidecar usa las de `kind='recorded_audio'` con
 * `storage_uri` y silencia el resto de la diapositiva (incluidas las
 * `tts_from_notes` sin audio todavía: no hay proveedor TTS integrado, ver
 * ADR pendiente). Pensado para `std::thread(...).detach()`, igual que
 * `runPptxExportJob`. */
void runVideoExportJob(const std::string &jobId, const std::string &pptxStoragePath,
                       int slideDurationSeconds, const std::string &transition,
                       const json::array &narration);

}  // namespace reports
