#pragma once

#include <string>
#include <vector>

namespace biometric {

/** @brief Resultado de una llamada a avatar_animation_engine (ADR-150,
 * SadTalker). `contentType` refleja lo que el servicio realmente devolvió
 * ("video/mp4" o, si el post-proceso de fondo transparente está activo,
 * "video/webm") -- el llamador debe usarlo para el Content-Type de la
 * respuesta/almacenamiento, no asumir uno fijo. */
struct AvatarAnimationResult {
  bool ok() const { return error.empty(); }
  std::vector<unsigned char> videoBytes;
  std::string contentType;
  std::string error;
};

/** @brief POST multipart a avatar_animation_engine:/animate (imagen fuente +
 * guion de texto) -> video generado. El backend C++ no tiene proveedor TTS
 * propio (ver report_export_jobs.hpp) -- se manda "text" y
 * avatar_animation_engine sintetiza el audio localmente (espeak-ng, ver
 * sadtalker_backend.py::_synthesize_tts_wav), en vez de duplicar esa lógica
 * acá. `transparentBg=true` pide el post-proceso de fondo transparente
 * (matting.py) -- el resultado viene en WebM en vez de MP4, ver
 * `AvatarAnimationResult::contentType`. Bloqueante (puede tardar 200-300s
 * reales, ver ADR-150) -- SOLO llamar desde un hilo de fondo
 * (runAvatarAnimationJob), nunca desde el hilo que atiende un request HTTP.
 * Adquiere internamente storage::GpuInferenceMutex para serializar contra
 * avatar_engine (ver gpu_mutex.hpp) -- el llamador no necesita tomarlo aparte. */
AvatarAnimationResult fetchAnimatedAvatar(
    const std::vector<unsigned char> &sourceImageBytes,
    const std::string &drivingText, bool transparentBg);

}  // namespace biometric
