#pragma once

#include <chrono>
#include <string>

#include <opencv2/opencv.hpp>

namespace biometric {

struct RealtimeFaceTrackResult {
  bool detected = false;
  bool predicted = false;
  double confidence = 0.0;
  cv::Rect2f faceBox;
  cv::RotatedRect oval;
};

/**
 * Detector/tracker C++ de baja latencia para el borde del rostro.
 *
 * Usa Haar/OpenCV como ruta siempre disponible, limita la busqueda a una ROI
 * expandida cuando ya hay rostro, predice unos pocos frames si el detector
 * salta y suaviza con EMA dependiente del salto. No reemplaza MediaPipe para
 * ojos/boca/lentes; solo entrega un ovalo rapido para UI/liveness/fallback.
 */
RealtimeFaceTrackResult updateRealtimeFaceTracker(
    const std::string &sessionId,
    const cv::Mat &bgr,
    std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now());

void resetRealtimeFaceTracker(const std::string &sessionId);

}  // namespace biometric
