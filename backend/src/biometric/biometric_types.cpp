#include "biometric_types.hpp"

namespace biometric {

std::mutex gBiometricCaptureMutex;
BiometricCaptureRuntimeState gBiometricCaptureState;
std::vector<std::string> gBiometricCapturedImages; // data:image/jpeg;base64,...

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
