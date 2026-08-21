#pragma once

// --------------------------------------------------------------------------
// cv_storage_pg.hpp — Persistencia Postgres de postulaciones de CV (ADR-122)
// --------------------------------------------------------------------------
// Dos tablas (ver db_scripts/69_cv_postulaciones_rrhh.sql), mismo criterio
// de agrupación en un solo archivo que support_storage_pg.hpp:
//   - cv_submission: el CV recibido por WhatsApp (archivo + texto crudo +
//     estado del pipeline). Se inserta apenas se descarga el documento --
//     existe SIEMPRE, incluso si la extracción/scoring falla después.
//   - cv_candidate_profile: los campos que Ollama extrajo de esa postulación
//     (1:1 con cv_submission), más score/score_rationale/extraction_warnings.
//
// Llamado desde whatsapp_bot_engine.cpp (flujo RRHH_CV_UPLOAD) y desde los
// endpoints admin de cv_routes.cpp -- misma fuente de verdad para no
// duplicar el acceso a estas tablas (mismo criterio que support_storage_pg).
// --------------------------------------------------------------------------

#include <boost/json.hpp>
#include <optional>
#include <string>
#include <vector>

namespace json = boost::json;

namespace support {

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

/** @brief Fila de cv_submission recién insertada -- lo mínimo que necesita
 * el llamador para seguir el pipeline (actualizar estado, insertar el
 * perfil extraído). */
struct CvSubmissionRecord {
  std::string id;
  std::string phoneE164;
  std::string lineId;
  std::string tenantId;
  std::string originalFilename;
  std::string mimeType;
  int fileSizeBytes = 0;
  std::string status;
  std::string createdAt;
};

/** @brief Campos extraídos por Ollama de un CV (ver cv_extraction_client.hpp
 * para el tipo que produce esta extracción antes de persistirse). */
struct CvCandidateProfile {
  std::string nombres;
  std::string apellidos;
  std::string telefonoFijo;
  std::string celular;
  std::string whatsapp;
  std::string centroEstudios;
  std::optional<int> edad;
  std::string lugarResidencia;
  std::string pretensionesEconomicas;
  std::optional<double> aniosExperiencia;
  std::string cargoPostulado;
  json::array experienciaLaboral;  // [{"empresa":..., "funciones":...}]
  json::array cursosCapacitacion;  // [string]
  std::string inglesLectura;
  std::string inglesEscritura;
  std::string inglesConversacion;
  std::string otraInformacion;
  json::object extraFields;
  std::optional<int> score;
  std::string scoreRationale;
  std::string llmModel;
  json::array extractionWarnings;
};

#if HAS_LIBPQ

/** @brief Inserta la fila de cv_submission apenas se descarga el documento
 * (status='received'). @return true si el INSERT tuvo éxito (ver
 * `out`/`error`). */
bool insertCvSubmissionPg(const std::string &databaseUrl, const std::string &phoneE164,
                          const std::string &lineId, const std::string &tenantId,
                          const std::string &waMediaId, const std::string &originalFilename,
                          const std::string &mimeType, int fileSizeBytes,
                          const std::vector<unsigned char> &fileBytes, CvSubmissionRecord &out,
                          std::string &error);

/** @brief Igual que insertCvSubmissionPg pero para el canal web (ADR-129,
 * widget de chat autenticado, sin número de WhatsApp): channel='web',
 * phone_e164/line_id quedan NULL, se guarda `userId` de la sesión en su
 * lugar (ver db_scripts/71). @return true si el INSERT tuvo éxito. */
bool insertWebCvSubmissionPg(const std::string &databaseUrl, const std::string &tenantId,
                             const std::string &userId, const std::string &originalFilename,
                             const std::string &mimeType, int fileSizeBytes,
                             const std::vector<unsigned char> &fileBytes, CvSubmissionRecord &out,
                             std::string &error);

/** @brief Actualiza raw_text + status tras la extracción de texto (ai_engine).
 * `status` es 'extracted' si hubo texto, 'extraction_failed' si no. */
bool updateCvSubmissionTextPg(const std::string &databaseUrl, const std::string &submissionId,
                              const std::string &rawText, const std::string &status);

/** @brief Actualiza solo `status` (p.ej. 'notified'/'notify_failed' tras el
 * fan-out de notificaciones). Best-effort: no bloquea el flujo si falla. */
void updateCvSubmissionStatusPg(const std::string &databaseUrl, const std::string &submissionId,
                                const std::string &status);

/** @brief Inserta el perfil extraído (1:1 con submissionId) -- se llama una
 * sola vez por postulación, tras validar la respuesta de Ollama (ver
 * cv_extraction_client.cpp). @return true si el INSERT tuvo éxito. */
bool insertCvCandidateProfilePg(const std::string &databaseUrl, const std::string &submissionId,
                                const CvCandidateProfile &profile, std::string &error);

/** @brief Filtros de `GET /api/support/admin/candidates` (panel RRHH). */
struct CvCandidateSearchFilter {
  std::optional<std::string> q; // busca en nombres/apellidos/cargo_postulado/phone_e164
  std::optional<int> scoreMin;
  std::optional<int> scoreMax;
  std::optional<std::string> status;
  std::optional<std::string> dateFrom; // YYYY-MM-DD, inclusive
  std::optional<std::string> dateTo;   // YYYY-MM-DD, inclusive
  int limit = 20;
  int offset = 0;
};

struct CvCandidateSearchPageResult {
  json::array items; // resumen por fila (sin file_bytes/raw_text -- ver cv_routes.cpp)
  long total = 0;
};

CvCandidateSearchPageResult searchCvCandidatesPg(const std::string &databaseUrl,
                                                 const CvCandidateSearchFilter &filter);

/** @brief Detalle completo de una postulación (submission + profile, sin
 * file_bytes -- ver getCvSubmissionFilePg para el archivo). @return true si
 * existe. */
bool getCvCandidateDetailPg(const std::string &databaseUrl, const std::string &submissionId,
                            json::object &out);

/** @brief Bytes originales del CV + su mime/nombre, para el endpoint de
 * descarga (`GET /api/support/admin/candidates/{id}/file`). @return true si
 * existe y tiene archivo. */
bool getCvSubmissionFilePg(const std::string &databaseUrl, const std::string &submissionId,
                          std::vector<unsigned char> &fileBytes, std::string &mimeType,
                          std::string &filename);

#endif // HAS_LIBPQ

} // namespace support
