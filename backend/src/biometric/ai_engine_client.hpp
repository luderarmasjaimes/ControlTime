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

AiEngineCartoonResult
fetchCartoonAvatarFromAiEngine(const std::vector<unsigned char> &imageBytes);

AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes);

} // namespace biometric
