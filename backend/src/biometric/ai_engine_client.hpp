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
                               bool forceClassicStyle = false,
                               const std::string &styleOverride = {});

AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes,
                             bool forceClassicStyle = false,
                             const std::string &styleOverride = {});

/** Rediseño de avatar (2026-09-20, ADR-203): catálogo de cuerpo/vestimenta
 * pre-hechos (ai_engine GET /avatar_body_templates). Devuelve vacío si
 * ai_engine no está disponible -- best-effort, mismo criterio que el resto
 * de este archivo. */
std::vector<AvatarBodyTemplateInfo> listAvatarBodyTemplatesFromAiEngine();

/** Recompositing RÁPIDO (sin GPU/difusión/detección, ver
 * ai_engine POST /recompose_avatar_body): pega un recorte de cabeza YA
 * generado (headCutoutPngBytes, ver AiEngineCartoonResult::headCutoutBase64)
 * sobre otra plantilla de cuerpo/vestimenta. Usado por "cambiar de
 * vestimenta" -- nunca vuelve a correr la difusión ni la segmentación de
 * cabeza. El resultado no trae headCutoutBase64 (el llamador ya lo tiene). */
AiEngineCartoonResult recomposeAvatarBodyTemplateOnAiEngine(
    const std::vector<unsigned char> &headCutoutPngBytes,
    const std::string &bodyTemplateSlug);

/** @brief Lectura de DNI por cámara (PDF417/MRZ, ver ai_engine/dni_scan.py).
 * No consulta RENIEC/SUNAT — solo decodifica lo ya impreso en el documento. */
AiEngineDniScanResult
scanDocumentWithAiEngine(const std::vector<unsigned char> &imageBytes);

} // namespace biometric
