#pragma once

#include <boost/json.hpp>

#include <string>
#include <vector>

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

/** @brief Worker de un job `report_export_job` (export_format='docx'): mismo
 * patrón que `runPptxExportJob` (POST al sidecar Chromium, endpoint
 * `/render-docx`), pero para informes en `layoutMode: 'document'` (A4/A3) en
 * vez de presentación. `layout` viaja tal cual al sidecar ('absolute',
 * default -- ADR-139, cada bloque en su propio `w:framePr` -- o 'flow',
 * pedido explícito 2026-09-18: reflowa como documento Word tradicional, ver
 * `reportDocxBuilder.js::buildPageSection`). Pensado para
 * `std::thread(...).detach()`, disparado desde
 * `POST /api/reports/{id}/export/docx`. */
void runDocxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken, const std::string &layout);

/** @brief Worker de un job `report_export_job` (export_format='pdf'): mismo
 * patrón que `runDocxExportJob`/`runPptxExportJob` (POST al sidecar
 * Chromium, endpoint DEDICADO `/render-pdf`, separado del `/render`
 * síncrono que sigue usando `exportReportPdf` sin cambios). Convertido a
 * job asíncrono porque el pipeline síncrono está acotado por el timeout
 * HTTP del cliente que originó el request -- documentos de miles de
 * páginas lo exceden aunque el render en sí termine bien. `watermarkText`
 * viaja igual que en `exportReportPdf` (resuelto server-side, ADR-080).
 * `unprotected` (default `false`, ADR-080 sigue siendo el comportamiento
 * normal): si es `true` el PDF sale SIN cifrar/sin contraseña -- el caller
 * (`report_routes.cpp`, bloque `POST /export/pdf`) es responsable de haber
 * verificado el permission code `informes.export_sin_clave` ANTES de pasar
 * `true` acá, este worker no vuelve a chequear permisos (ya corre en un
 * hilo separado, sin la `session` original a mano). `noWatermark` (ADR-204):
 * mismo criterio que `unprotected` pero para el permission code
 * `informes.export_sin_marca_agua` -- si es `true` el body al sidecar manda
 * `"watermark": false` explícito en vez del texto resuelto. Cuando SÍ cifra,
 * la contraseña generada por el sidecar se guarda en
 * `report_export_job.options` al completar (ver `updateExportJobStatusPg`),
 * y el endpoint de descarga la expone igual que el pipeline síncrono.
 * `ownerEmail`/`extraRecipients`/`reportTitle`/`username` (ADR-204): tras
 * completar con éxito, se envía el PDF (adjunto si entra bajo
 * `AppConfig::gPdfEmailMaxAttachmentMb`, si no solo el aviso) + la
 * contraseña (si corresponde) por correo a `ownerEmail` (quien exportó) y a
 * cada uno de `extraRecipients` (lista persistida en
 * `report_document_settings.pdf_share_recipients_json`) -- resueltos por el
 * CALLER antes de `std::thread(...).detach()`, mismo criterio que
 * `watermarkText`, para no tocar Postgres desde el hilo detached más de lo
 * necesario. Best-effort: un fallo de SMTP nunca marca el job como `failed`
 * (ver `sendPdfExportEmails`). Pensado para `std::thread(...).detach()`,
 * disparado desde `POST /api/reports/{id}/export/pdf`. */
void runPdfExportJob(const std::string &jobId, const std::string &reportId,
                     const std::string &sessionToken, const std::string &watermarkText,
                     bool unprotected, bool noWatermark, const std::string &ownerEmail,
                     const std::vector<std::string> &extraRecipients,
                     const std::string &reportTitle, const std::string &username);

/** @brief Envía el PDF recién exportado (bytes ya en memoria, `pdfBytes`) +
 * la contraseña (si corresponde) por correo a `ownerEmail` (quien exportó,
 * puede venir vacío si no se pudo resolver) y a cada uno de
 * `extraRecipients` (ADR-204) -- un correo por destinatario, porque
 * `sendEmailWithAttachment`/`sendPlainEmail` (`alarm_notifier.hpp`) toman un
 * solo `to`. Si `pdfBytes.size()` excede
 * `AppConfig::gPdfEmailMaxAttachmentMb` se manda el correo SIN adjunto, con
 * una nota aclaratoria en el cuerpo -- no hay deep-link real a un informe
 * puntual dentro de la SPA hoy, así que el cuerpo no intenta armar uno (ver
 * ADR-204, sección de consecuencias). Best-effort: un fallo de SMTP a un
 * destinatario se ignora (el PDF ya está generado y descargable por la vía
 * normal, esto es una notificación de conveniencia). Reutilizada tanto por
 * `runPdfExportJob` (pipeline async) como por el pipeline síncrono
 * (`report_pdf_export.cpp::exportReportPdf`, lanzada ahí en su propio
 * `std::thread(...).detach()` para no sumar latencia al request). */
void sendPdfExportEmails(const std::string &reportTitle, const std::string &username,
                         const std::string &pdfBytes, bool unprotected, bool noWatermark,
                         const std::string &userPassword, const std::string &ownerEmail,
                         const std::vector<std::string> &extraRecipients);

/** @brief Worker de un job `report_export_job` (export_format='xlsx'): mismo
 * patrón que `runDocxExportJob` (POST al sidecar Chromium, endpoint
 * `/render-xlsx`), pero sin `layout` -- el export XLSX solo toca los
 * bloques `table` del informe (ver `reportXlsxBuilder.js`), nunca pasa por
 * la fase de captura raster de chart/imagen/portada, así que no necesita
 * ningún parámetro extra. Pensado para `std::thread(...).detach()`,
 * disparado desde `POST /api/reports/{id}/export/xlsx`. */
void runXlsxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken);

}  // namespace reports
