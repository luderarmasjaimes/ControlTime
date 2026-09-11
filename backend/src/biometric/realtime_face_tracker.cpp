#include "realtime_face_tracker.hpp"

#include "face_analysis.hpp"

#include <algorithm>
#include <cmath>
#include <mutex>
#include <unordered_map>

namespace biometric {
namespace {

struct TrackerState {
  bool hasBox = false;
  cv::Rect2f box;
  cv::Point2f velocity{0.0f, 0.0f};
  int framesSinceDetect = 0;
  std::chrono::steady_clock::time_point lastUpdate = std::chrono::steady_clock::now();
};

std::mutex gRealtimeTrackerMutex;
std::unordered_map<std::string, TrackerState> gRealtimeTrackers;

cv::Rect2f clampRect(const cv::Rect2f &r, int w, int h) {
  const float maxW = static_cast<float>(std::max(1, w));
  const float maxH = static_cast<float>(std::max(1, h));
  const float x = std::clamp(r.x, 0.0f, maxW - 1.0f);
  const float y = std::clamp(r.y, 0.0f, maxH - 1.0f);
  const float rw = std::clamp(r.width, 1.0f, maxW - x);
  const float rh = std::clamp(r.height, 1.0f, maxH - y);
  return {x, y, rw, rh};
}

cv::Rect expandedRoi(const cv::Rect2f &box, int w, int h) {
  const float padX = box.width * 0.70f;
  const float padY = box.height * 0.65f;
  const cv::Rect2f expanded(box.x - padX, box.y - padY,
                            box.width + padX * 2.0f,
                            box.height + padY * 2.0f);
  const auto c = clampRect(expanded, w, h);
  return cv::Rect(static_cast<int>(std::floor(c.x)),
                  static_cast<int>(std::floor(c.y)),
                  static_cast<int>(std::ceil(c.width)),
                  static_cast<int>(std::ceil(c.height))) &
         cv::Rect(0, 0, w, h);
}

double centerDistanceRatio(const cv::Rect2f &a, const cv::Rect2f &b) {
  const cv::Point2f ca(a.x + a.width * 0.5f, a.y + a.height * 0.5f);
  const cv::Point2f cb(b.x + b.width * 0.5f, b.y + b.height * 0.5f);
  const double dx = static_cast<double>(ca.x - cb.x);
  const double dy = static_cast<double>(ca.y - cb.y);
  const double ref = std::max(1.0f, std::max(b.width, b.height));
  return std::sqrt(dx * dx + dy * dy) / ref;
}

cv::Rect2f chooseDetection(const std::vector<cv::Rect> &rects,
                           const cv::Point2f &offset,
                           const TrackerState &state) {
  if (rects.empty()) {
    return {};
  }

  const auto score = [&](const cv::Rect &r) {
    const cv::Rect2f rf(static_cast<float>(r.x) + offset.x,
                        static_cast<float>(r.y) + offset.y,
                        static_cast<float>(r.width),
                        static_cast<float>(r.height));
    double s = static_cast<double>(r.area());
    if (state.hasBox) {
      s *= 1.0 / (1.0 + centerDistanceRatio(rf, state.box) * 2.5);
    }
    return s;
  };

  const auto best = std::max_element(rects.begin(), rects.end(),
                                     [&](const cv::Rect &a, const cv::Rect &b) {
                                       return score(a) < score(b);
                                     });
  return {static_cast<float>(best->x) + offset.x,
          static_cast<float>(best->y) + offset.y,
          static_cast<float>(best->width),
          static_cast<float>(best->height)};
}

cv::RotatedRect ovalFromFaceBox(const cv::Rect2f &box) {
  const float cx = box.x + box.width * 0.5f;
  const float cy = box.y + box.height * 0.5f - box.height * 0.13f;
  const float ow = box.width * 1.14f;
  const float oh = box.height * 1.34f;
  return cv::RotatedRect(cv::Point2f(cx, cy), cv::Size2f(ow, oh), 0.0f);
}

}  // namespace

RealtimeFaceTrackResult updateRealtimeFaceTracker(
    const std::string &sessionId,
    const cv::Mat &bgr,
    std::chrono::steady_clock::time_point now) {
  RealtimeFaceTrackResult out;
  if (bgr.empty() || bgr.cols < 80 || bgr.rows < 80) {
    return out;
  }

  auto &cascade = getCascadeBundle();
  if (!cascade.faceLoaded) {
    return out;
  }

  std::scoped_lock lk(gRealtimeTrackerMutex);
  auto &state = gRealtimeTrackers[sessionId];
  const double dtMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                          now - state.lastUpdate)
                          .count();
  const float dtScale = static_cast<float>(std::clamp(dtMs / 33.0, 0.0, 4.0));

  cv::Rect roi(0, 0, bgr.cols, bgr.rows);
  const bool useRoi = state.hasBox && state.framesSinceDetect < 8;
  if (useRoi) {
    roi = expandedRoi(state.box, bgr.cols, bgr.rows);
  }

  cv::Mat gray;
  cv::cvtColor(bgr(roi), gray, cv::COLOR_BGR2GRAY);
  const int targetW = useRoi ? 300 : 420;
  const double scale = gray.cols > targetW ? static_cast<double>(targetW) / gray.cols : 1.0;
  cv::Mat small;
  if (scale < 0.999) {
    cv::resize(gray, small, cv::Size(), scale, scale, cv::INTER_AREA);
  } else {
    small = gray;
  }
  cv::equalizeHist(small, small);

  std::vector<cv::Rect> detections;
  const int minFace = std::max(34, static_cast<int>(small.cols * (useRoi ? 0.18 : 0.12)));
  cascade.face.detectMultiScale(small, detections, 1.08, 3, 0,
                                cv::Size(minFace, minFace));

  bool detected = false;
  cv::Rect2f measured;
  if (!detections.empty()) {
    cv::Point2f offset(static_cast<float>(roi.x), static_cast<float>(roi.y));
    if (scale < 0.999) {
      for (auto &r : detections) {
        r.x = static_cast<int>(std::round(r.x / scale));
        r.y = static_cast<int>(std::round(r.y / scale));
        r.width = static_cast<int>(std::round(r.width / scale));
        r.height = static_cast<int>(std::round(r.height / scale));
      }
    }
    measured = chooseDetection(detections, offset, state);
    measured = clampRect(measured, bgr.cols, bgr.rows);
    detected = measured.width > 10 && measured.height > 10;
  }

  if (detected) {
    if (state.hasBox) {
      const auto prevCenter =
          cv::Point2f(state.box.x + state.box.width * 0.5f,
                      state.box.y + state.box.height * 0.5f);
      const auto measuredCenter =
          cv::Point2f(measured.x + measured.width * 0.5f,
                      measured.y + measured.height * 0.5f);
      const double jump = centerDistanceRatio(measured, state.box);
      const float alpha = jump > 0.42 ? 0.46f : 0.76f;
      state.box.x += alpha * (measured.x - state.box.x);
      state.box.y += alpha * (measured.y - state.box.y);
      state.box.width += alpha * (measured.width - state.box.width);
      state.box.height += alpha * (measured.height - state.box.height);
      const auto newCenter =
          cv::Point2f(state.box.x + state.box.width * 0.5f,
                      state.box.y + state.box.height * 0.5f);
      if (dtScale > 0.01f) {
        state.velocity = (newCenter - prevCenter) * (1.0f / dtScale);
      } else {
        state.velocity = measuredCenter - prevCenter;
      }
    } else {
      state.box = measured;
      state.velocity = {0.0f, 0.0f};
      state.hasBox = true;
    }
    state.box = clampRect(state.box, bgr.cols, bgr.rows);
    state.framesSinceDetect = 0;
    out.detected = true;
    out.confidence = useRoi ? 0.86 : 0.82;
  } else if (state.hasBox && state.framesSinceDetect < 6) {
    state.box.x += state.velocity.x * dtScale;
    state.box.y += state.velocity.y * dtScale;
    state.box = clampRect(state.box, bgr.cols, bgr.rows);
    state.framesSinceDetect += 1;
    out.detected = true;
    out.predicted = true;
    out.confidence = std::max(0.30, 0.68 - state.framesSinceDetect * 0.07);
  } else {
    state.hasBox = false;
    state.velocity = {0.0f, 0.0f};
    state.framesSinceDetect = 0;
  }

  state.lastUpdate = now;
  if (out.detected && state.hasBox) {
    out.faceBox = state.box;
    out.oval = ovalFromFaceBox(state.box);
  }
  return out;
}

void resetRealtimeFaceTracker(const std::string &sessionId) {
  std::scoped_lock lk(gRealtimeTrackerMutex);
  gRealtimeTrackers.erase(sessionId);
}

}  // namespace biometric
