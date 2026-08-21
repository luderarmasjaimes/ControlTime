#pragma once

// --------------------------------------------------------------------------
// cv_extraction_client.hpp — Extracción de texto + campos/score de un CV
// (ADR-122)
// --------------------------------------------------------------------------
// Dos llamadas de red bien separadas, cada una con su propia responsabilidad
// (mismo criterio de separación que el resto del backend: ai_engine_client.cpp
// solo habla con el sidecar Python, text_spell_service.cpp solo con Ollama):
//   1) extractCvTextFromAiEngine: multipart POST a ai_engine (/extract_cv_text,
//      patrón de scanDocumentWithAiEngine en ai_engine_client.cpp) -- SOLO
//      texto plano, sin interpretar contenido.
//   2) extractCvFieldsWithOllama: prompt de extracción+scoring sobre ese texto
//      (patrón de ollamaGenerateJsonField en text_spell_service.cpp), con
//      validación estructural + chequeo de "presencia" contra el texto fuente
//      antes de aceptar cualquier campo (mismo espíritu anti-alucinación que
//      apa7ResponseLooksValid -- ver ADR-122, distinción con ADR-121).
// --------------------------------------------------------------------------

#include "cv_storage_pg.hpp"

#include <string>
#include <vector>

namespace support {

struct CvTextExtractionResult {
  bool ok = false;
  std::string text;
  std::string error; // vacío si ok
};

/** @brief Extrae texto plano de un CV (Word/PDF) vía ai_engine. Nunca lanza;
 * `error` queda vacío si todo bien. */
CvTextExtractionResult extractCvTextFromAiEngine(const std::vector<unsigned char> &fileBytes,
                                                  const std::string &filename,
                                                  const std::string &mimeType);

struct CvFieldExtractionResult {
  bool ok = false;
  CvCandidateProfile profile;
  std::string error; // vacío si ok (aunque ok=true puede traer extraction_warnings)
};

/** @brief Extrae campos estructurados + score 0-100 de `rawText` (ya extraído
 * de un CV) vía Ollama. `ok=false` si Ollama no respondió o la respuesta no
 * pasó la validación estructural mínima -- el llamador debe persistir la
 * postulación igual con `status='extraction_failed'` (nunca se pierde el
 * archivo/texto por un fallo de scoring, ver ADR-122). Nunca lanza. */
CvFieldExtractionResult extractCvFieldsWithOllama(const std::string &rawText);

} // namespace support
