#include "onnx_cartoon.hpp"

#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <mutex>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect.hpp>

namespace fs = std::filesystem;

bool informeCartoonOnnxRuntimeLinked() { return true; }

namespace {

std::mutex gOrtSessionMutex;
std::string gLoadedModelPath;
std::unique_ptr<Ort::Session> gSession;
std::unique_ptr<Ort::Env> gEnv;

static std::vector<fs::path> cascadeSearchDirs() {
  std::vector<fs::path> dirs;
  auto pushUnique = [&](const fs::path &p) {
    if (p.empty()) {
      return;
    }
    for (const auto &existing : dirs) {
      if (existing == p) {
        return;
      }
    }
    dirs.push_back(p);
  };
  const char *haarDir = std::getenv("BEEMETRY_OPENCV_HAAR_DIR");
  if (haarDir && *haarDir) {
    pushUnique(fs::path(haarDir));
  }
  const char *openCvDir = std::getenv("OpenCV_DIR");
  if (openCvDir && *openCvDir) {
    pushUnique(fs::path(openCvDir) / "etc" / "haarcascades");
  }
  pushUnique(fs::path("/usr/share/opencv4/haarcascades"));
  pushUnique(fs::path("/usr/share/opencv/haarcascades"));
  pushUnique(fs::path("/usr/local/share/opencv4/haarcascades"));
  pushUnique(fs::path("C:/opencv/build/etc/haarcascades"));
  return dirs;
}

static bool loadCascadeFile(cv::CascadeClassifier &classifier,
                            const std::string &fileName) {
  for (const auto &dir : cascadeSearchDirs()) {
    const auto full = dir / fileName;
    if (!fs::exists(full)) {
      continue;
    }
    if (classifier.load(full.string())) {
      return true;
    }
  }
  return false;
}

static cv::CascadeClassifier &faceCascade() {
  static cv::CascadeClassifier face;
  static std::once_flag once;
  std::call_once(once, [] {
    (void)loadCascadeFile(face, "haarcascade_frontalface_default.xml");
  });
  return face;
}

static std::string encodeBase64(const std::vector<unsigned char> &input) {
  static const char table[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  for (size_t i = 0; i < input.size(); i += 3) {
    const unsigned int b0 = input[i];
    const unsigned int b1 = (i + 1 < input.size()) ? input[i + 1] : 0;
    const unsigned int b2 = (i + 2 < input.size()) ? input[i + 2] : 0;
    const unsigned int tri = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(table[(tri >> 18) & 0x3F]);
    out.push_back(table[(tri >> 12) & 0x3F]);
    out.push_back((i + 1 < input.size()) ? table[(tri >> 6) & 0x3F] : '=');
    out.push_back((i + 2 < input.size()) ? table[tri & 0x3F] : '=');
  }
  return out;
}

static cv::Rect largestFace(const std::vector<cv::Rect> &rects) {
  if (rects.empty()) {
    return cv::Rect();
  }
  return *std::max_element(rects.begin(), rects.end(),
                           [](const cv::Rect &a, const cv::Rect &b) {
                             return a.area() < b.area();
                           });
}

static cv::Rect bustCropFromBgr(const cv::Mat &bgr) {
  const int W = bgr.cols;
  const int H = bgr.rows;
  auto &face = faceCascade();
  if (!face.empty()) {
    cv::Mat gray;
    cv::cvtColor(bgr, gray, cv::COLOR_BGR2GRAY);
    cv::equalizeHist(gray, gray);
    std::vector<cv::Rect> faces;
    face.detectMultiScale(gray, faces, 1.08, 5, 0, cv::Size(40, 40));
    cv::Rect r = largestFace(faces);
    if (r.area() > 200) {
      const int cx = r.x + r.width / 2;
      const int cy = r.y + r.height / 2;
      int rw = static_cast<int>(std::round(r.width * 1.55));
      int rh = static_cast<int>(std::round(r.height * 2.05));
      rw = std::max(rw, static_cast<int>(r.width));
      rh = std::max(rh, static_cast<int>(r.height));
      int x0 = cx - rw / 2;
      int y0 = cy - static_cast<int>(r.height * 0.42) - rh / 3;
      x0 = std::clamp(x0, 0, W - 1);
      y0 = std::clamp(y0, 0, H - 1);
      int x1 = std::min(W, x0 + rw);
      int y1 = std::min(H, y0 + rh);
      if (x1 - x0 >= 48 && y1 - y0 >= 48) {
        return cv::Rect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
  const int side = std::max(48, std::min(W, H) * 9 / 10);
  const int x0 = (W - side) / 2;
  const int y0 = (H - side) / 2;
  return cv::Rect(x0, y0, side, side);
}

static bool ensureSession(const std::string &modelPath, std::string &error) {
  std::lock_guard<std::mutex> lock(gOrtSessionMutex);
  if (gSession && gLoadedModelPath == modelPath) {
    return true;
  }
  gSession.reset();
  gLoadedModelPath.clear();
  try {
    if (!gEnv) {
      gEnv = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "informe_cartoon");
    }
    Ort::SessionOptions opts;
    opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_EXTENDED);
    opts.SetIntraOpNumThreads(1);
    gSession = std::make_unique<Ort::Session>(*gEnv, modelPath.c_str(), opts);
    gLoadedModelPath = modelPath;
    return true;
  } catch (const std::exception &ex) {
    error = std::string("onnx_session_failed: ") + ex.what();
    return false;
  } catch (...) {
    error = "onnx_session_failed";
    return false;
  }
}

} // namespace

bool informeCartoonOnnxFromImageBytes(const std::vector<unsigned char> &imageBytes,
                                      const std::string &modelPath,
                                      std::string &outPngBase64,
                                      std::string &error) {
  outPngBase64.clear();
  error.clear();
  if (imageBytes.empty()) {
    error = "empty_image_bytes";
    return false;
  }
  if (modelPath.empty() || !fs::exists(modelPath)) {
    error = "onnx_model_missing";
    return false;
  }
  if (!ensureSession(modelPath, error)) {
    return false;
  }

  cv::Mat bgr = cv::imdecode(imageBytes, cv::IMREAD_COLOR);
  if (bgr.empty() || bgr.cols < 32 || bgr.rows < 32) {
    error = "imdecode_failed";
    return false;
  }

  cv::Rect crop = bustCropFromBgr(bgr);
  cv::Mat roi = bgr(crop).clone();

  Ort::AllocatorWithDefaultOptions alloc;
  std::vector<const char *> inNames;
  std::vector<const char *> outNames;
  std::string inNameStr;
  std::string outNameStr;

  int64_t inH = 512;
  int64_t inW = 512;
  {
    std::lock_guard<std::mutex> lock(gOrtSessionMutex);
    if (!gSession) {
      error = "onnx_session_gone";
      return false;
    }
    Ort::TypeInfo ti = gSession->GetInputTypeInfo(0);
    auto tensorInfo = ti.GetTensorTypeAndShapeInfo();
    auto sh = tensorInfo.GetShape();
    if (sh.size() >= 4) {
      if (sh[2] > 0) {
        inH = sh[2];
      }
      if (sh[3] > 0) {
        inW = sh[3];
      }
    }
    auto inAlloc = gSession->GetInputNameAllocated(0, alloc);
    auto outAlloc = gSession->GetOutputNameAllocated(0, alloc);
    inNameStr = inAlloc.get();
    outNameStr = outAlloc.get();
    inNames.push_back(inNameStr.c_str());
    outNames.push_back(outNameStr.c_str());
  }

  cv::Mat rgb;
  cv::cvtColor(roi, rgb, cv::COLOR_BGR2RGB);
  cv::resize(rgb, rgb, cv::Size(static_cast<int>(inW), static_cast<int>(inH)),
             0, 0, cv::INTER_AREA);

  cv::Mat rgbF;
  rgb.convertTo(rgbF, CV_32FC3, 1.0 / 255.0);
  rgbF = rgbF * 2.0f - 1.0f;

  const int64_t hw = inH * inW;
  std::vector<float> inputTensor(static_cast<size_t>(3 * hw));
  for (int64_t y = 0; y < inH; ++y) {
    for (int64_t x = 0; x < inW; ++x) {
      const cv::Vec3f &px = rgbF.at<cv::Vec3f>(static_cast<int>(y), static_cast<int>(x));
      const int64_t i = y * inW + x;
      inputTensor[static_cast<size_t>(0 * hw + i)] = px[0];
      inputTensor[static_cast<size_t>(1 * hw + i)] = px[1];
      inputTensor[static_cast<size_t>(2 * hw + i)] = px[2];
    }
  }

  std::vector<int64_t> shape = {1, 3, inH, inW};
  Ort::MemoryInfo mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  Ort::Value inTensor = Ort::Value::CreateTensor<float>(
      mem, inputTensor.data(), inputTensor.size(), shape.data(), shape.size());

  std::vector<Ort::Value> outputs;
  try {
    std::lock_guard<std::mutex> lock(gOrtSessionMutex);
    if (!gSession) {
      error = "onnx_session_gone";
      return false;
    }
    outputs = gSession->Run(Ort::RunOptions{nullptr}, inNames.data(), &inTensor, 1,
                            outNames.data(), 1);
  } catch (const std::exception &ex) {
    error = std::string("onnx_run_failed: ") + ex.what();
    return false;
  } catch (...) {
    error = "onnx_run_failed";
    return false;
  }

  if (outputs.empty() || !outputs[0].IsTensor()) {
    error = "onnx_bad_output";
    return false;
  }

  float *outPtr = outputs[0].GetTensorMutableData<float>();
  auto outInfo = outputs[0].GetTensorTypeAndShapeInfo();
  auto osh = outInfo.GetShape();
  int64_t oh = inH;
  int64_t ow = inW;
  if (osh.size() >= 4) {
    if (osh[2] > 0) {
      oh = osh[2];
    }
    if (osh[3] > 0) {
      ow = osh[3];
    }
  }
  const int64_t ohw = oh * ow;
  cv::Mat bChan(static_cast<int>(oh), static_cast<int>(ow), CV_32F);
  cv::Mat gChan(static_cast<int>(oh), static_cast<int>(ow), CV_32F);
  cv::Mat rChan(static_cast<int>(oh), static_cast<int>(ow), CV_32F);
  for (int64_t y = 0; y < oh; ++y) {
    for (int64_t x = 0; x < ow; ++x) {
      const int64_t i = y * ow + x;
      rChan.at<float>(static_cast<int>(y), static_cast<int>(x)) =
          outPtr[0 * ohw + i];
      gChan.at<float>(static_cast<int>(y), static_cast<int>(x)) =
          outPtr[1 * ohw + i];
      bChan.at<float>(static_cast<int>(y), static_cast<int>(x)) =
          outPtr[2 * ohw + i];
    }
  }
  std::vector<cv::Mat> mergeCh = {bChan, gChan, rChan};
  cv::Mat fBgr;
  cv::merge(mergeCh, fBgr);
  fBgr = (fBgr + 1.0f) * (127.5f);
  cv::Mat u8;
  fBgr.convertTo(u8, CV_8UC3);
  cv::Mat smoothed;
  cv::bilateralFilter(u8, smoothed, 7, 50, 50);
  u8 = std::move(smoothed);

  std::vector<unsigned char> pngBuf;
  if (!cv::imencode(".png", u8, pngBuf)) {
    error = "png_encode_failed";
    return false;
  }
  outPngBase64 = encodeBase64(pngBuf);
  return true;
}
