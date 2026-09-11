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

/** forceClassicStyle=true fuerza el estilo clásico en ai_engine (campo
 * "style"=classic) aunque AVATAR_STYLE_ENGINE=diffusion esté activo
 * globalmente -- piloto de avatar por difusión limitado a cuentas QA/
 * certificación, ver AppConfig::isAvatarDiffusionQaUser (ADR-141/143,
 * actualización 2026-09-11 de ADR-167). */
AiEngineCartoonResult
fetchCartoonAvatarFromAiEngine(const std::vector<unsigned char> &imageBytes,
                               bool forceClassicStyle = false);

AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes,
                             bool forceClassicStyle = false);

/** @brief Lectura de DNI por cámara (PDF417/MRZ, ver ai_engine/dni_scan.py).
 * No consulta RENIEC/SUNAT — solo decodifica lo ya impreso en el documento. */
AiEngineDniScanResult
scanDocumentWithAiEngine(const std::vector<unsigned char> &imageBytes);

} // namespace biometric
