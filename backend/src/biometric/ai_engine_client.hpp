#pragma once

#include <optional>
#include <string>
#include <vector>

#include "biometric_types.hpp"

namespace biometric {

std::optional<AiEngineFrameResult>
analyzeFrameWithAiEngine(
    const std::vector<unsigned char> &imageBytes,
    const std::optional<std::string> &glassesSessionKey = std::nullopt);

AiEngineEmbeddingResult
fetchFaceEmbeddingFromAiEngine(const std::vector<unsigned char> &imageBytes);

/** Registro/verificación local con SeetaFace6 + anti-spoofing. */
FaceAnalysis fetchSeetaFaceAnalysisFromAiEngine(
    const std::vector<unsigned char> &imageBytes, const std::string &mode);

/** Registro/verificación local con DeepFace (Facenet512) + Silent-Face-Anti-
 * Spoofing (MiniFASNet) -- proveedor biométrico local por defecto. Igual
 * contrato que fetchSeetaFaceAnalysisFromAiEngine, apunta a /deepface_analyze. */
FaceAnalysis fetchDeepFaceSilentAnalysisFromAiEngine(
    const std::vector<unsigned char> &imageBytes, const std::string &mode);

AiEngineCartoonResult
fetchCartoonAvatarFromAiEngine(const std::vector<unsigned char> &imageBytes);

AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes);

/** @brief Lectura de DNI por cámara (PDF417/MRZ, ver ai_engine/dni_scan.py).
 * No consulta RENIEC/SUNAT — solo decodifica lo ya impreso en el documento. */
AiEngineDniScanResult
scanDocumentWithAiEngine(const std::vector<unsigned char> &imageBytes);

} // namespace biometric
