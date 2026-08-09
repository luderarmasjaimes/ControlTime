#include "biometric_types.hpp"

namespace biometric {

const std::string kBiometricCaptureDefaultSessionId = "_no_session_header";

std::mutex gBiometricCaptureMutex;
std::unordered_map<std::string, BiometricCaptureSessionSlot>
    gBiometricCaptureSessions;

BiometricCaptureSessionSlot &
getOrCreateBiometricCaptureSession(const std::string &sessionId) {
  const auto &key =
      sessionId.empty() ? kBiometricCaptureDefaultSessionId : sessionId;
  const auto now = std::chrono::steady_clock::now();
  constexpr auto kSessionTtl = std::chrono::minutes(10);
  if (gBiometricCaptureSessions.size() > 200) {
    for (auto it = gBiometricCaptureSessions.begin();
         it != gBiometricCaptureSessions.end();) {
      if (now - it->second.lastTouched > kSessionTtl) {
        it = gBiometricCaptureSessions.erase(it);
      } else {
        ++it;
      }
    }
  }
  auto &slot = gBiometricCaptureSessions[key];
  slot.lastTouched = now;
  return slot;
}

std::string captureStateLabel(int state) {
  switch (state) {
  case 7:
    return "Estado actual: CAPTURADO";
  case 4:
    return "Estado actual: EVALUANDO LIVENESS";
  case 2:
    return "Estado actual: ROSTRO DETECTADO";
  default:
    return "Estado actual: INICIANDO";
  }
}

} // namespace biometric
