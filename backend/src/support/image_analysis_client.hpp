#pragma once

// --------------------------------------------------------------------------
// image_analysis_client.hpp — Lectura determinística de una imagen adjuntada
// desde el widget de chat de soporte (ADR-129)
// --------------------------------------------------------------------------
// El modelo del chatbot (Ollama, ver mining_chatbot_service.cpp) es de solo
// texto -- no puede "ver" una imagen. Este cliente resuelve eso llamando a
// ai_engine (/analyze_image, eye_analyzer.py) para extraer, de forma
// determinística y sin LLM: (1) contenido de cualquier código QR/barra
// (pyzbar) y (2) texto visible vía OCR (pytesseract, español+inglés). El
// resultado se incrusta como contexto en el prompt del chat (mismo patrón
// que los chips Resumir/Ampliar/Ideas de SupportChatWidget.tsx) para que el
// usuario pueda "preguntar sobre la imagen" pese a que el modelo no la vea
// directamente. Mismo patrón de cliente HTTP minimalista que
// cv_extraction_client.cpp (duplicado a propósito, ver convención de
// "cada archivo mantiene su propio helper mínimo autocontenido" ya
// establecida en este codebase).
// --------------------------------------------------------------------------

#include <string>
#include <vector>

namespace support {

struct ImageAnalysisResult {
  bool ok = false;
  std::vector<std::string> qrCodes;
  std::string ocrText;
  std::string error; // vacío si ok
};

/** @brief Nunca lanza; `error` queda vacío si todo bien. `ok=true` con ambos
 * campos vacíos es un resultado legítimo (imagen sin QR ni texto legible),
 * no un fallo. */
ImageAnalysisResult analyzeImageWithAiEngine(const std::vector<unsigned char> &imageBytes,
                                             const std::string &filename,
                                             const std::string &mimeType);

} // namespace support
