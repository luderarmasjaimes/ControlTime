#include <seeta/FaceAntiSpoofing.h>
#include <seeta/FaceDetector.h>
#include <seeta/FaceLandmarker.h>
#include <seeta/FaceRecognizer.h>
#include <seeta/Common/Struct.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

struct Args {
  fs::path input;
  fs::path output;
  fs::path models;
  std::string mode = "verify";
};

static std::string jsonEscape(const std::string &value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char c : value) {
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c >= 0x20) out.push_back(static_cast<char>(c));
    }
  }
  return out;
}

static Args parseArgs(int argc, char **argv) {
  Args args;
  for (int i = 1; i + 1 < argc; i += 2) {
    const std::string key = argv[i];
    const std::string value = argv[i + 1];
    if (key == "--input") args.input = value;
    else if (key == "--output-json") args.output = value;
    else if (key == "--model-dir") args.models = value;
    else if (key == "--mode") args.mode = value;
    else throw std::runtime_error("unknown_argument:" + key);
  }
  if (args.input.empty() || args.output.empty() || args.models.empty()) {
    throw std::runtime_error("missing_required_argument");
  }
  if (args.mode != "register" && args.mode != "verify") {
    throw std::runtime_error("invalid_mode");
  }
  return args;
}

static void writeResult(const fs::path &path, bool pass, double quality,
                        const std::string &liveness, double clarity,
                        double reality, const std::vector<std::string> &issues,
                        const std::vector<float> &feature) {
  std::ofstream out(path, std::ios::trunc);
  if (!out) throw std::runtime_error("cannot_write_output");
  out << std::setprecision(9)
      << "{\"provider\":\"seetaface6_local\","
      << "\"engine_version\":\"seetaface6-open-a32e2faa\","
      << "\"pass\":" << (pass ? "true" : "false") << ','
      << "\"liveness\":{\"status\":\"" << jsonEscape(liveness)
      << "\",\"clarity\":" << clarity << ",\"reality\":" << reality << "},"
      << "\"quality\":{\"score\":" << quality << ",\"issues\":[";
  for (std::size_t i = 0; i < issues.size(); ++i) {
    if (i) out << ',';
    out << '"' << jsonEscape(issues[i]) << '"';
  }
  out << "]},\"dim\":" << feature.size() << ",\"template\":[";
  for (std::size_t i = 0; i < feature.size(); ++i) {
    if (i) out << ',';
    out << feature[i];
  }
  out << "]}";
}

static fs::path model(const Args &args, const char *name) {
  const auto path = args.models / name;
  if (!fs::is_regular_file(path)) throw std::runtime_error(std::string("missing_model:") + name);
  return path;
}

struct PpmImage {
  int width = 0;
  int height = 0;
  std::vector<unsigned char> rgb;
};

static std::string ppmToken(std::istream &input) {
  std::string token;
  char c = 0;
  while (input.get(c)) {
    if (c == '#') {
      input.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
      continue;
    }
    if (!std::isspace(static_cast<unsigned char>(c))) {
      token.push_back(c);
      break;
    }
  }
  while (input.get(c)) {
    if (std::isspace(static_cast<unsigned char>(c))) break;
    token.push_back(c);
  }
  return token;
}

static PpmImage readPpm(const fs::path &path) {
  std::ifstream input(path, std::ios::binary);
  if (!input || ppmToken(input) != "P6") throw std::runtime_error("invalid_image");
  PpmImage image;
  image.width = std::stoi(ppmToken(input));
  image.height = std::stoi(ppmToken(input));
  const int maxValue = std::stoi(ppmToken(input));
  if (image.width <= 0 || image.height <= 0 || maxValue != 255 ||
      image.width > 8192 || image.height > 8192) {
    throw std::runtime_error("invalid_image_dimensions");
  }
  const auto byteCount = static_cast<std::size_t>(image.width) *
                         static_cast<std::size_t>(image.height) * 3U;
  image.rgb.resize(byteCount);
  input.read(reinterpret_cast<char *>(image.rgb.data()),
             static_cast<std::streamsize>(byteCount));
  if (input.gcount() != static_cast<std::streamsize>(byteCount)) {
    throw std::runtime_error("truncated_image");
  }
  return image;
}

int main(int argc, char **argv) {
  fs::path output;
  try {
    const Args args = parseArgs(argc, argv);
    output = args.output;
    PpmImage ppm = readPpm(args.input);
    SeetaImageData image{ppm.width, ppm.height, 3, ppm.rgb.data()};

    seeta::ModelSetting detectorSetting(model(args, "face_detector.csta").string(),
                                        seeta::ModelSetting::CPU);
    seeta::FaceDetector detector(detectorSetting);
    detector.set(seeta::FaceDetector::PROPERTY_MIN_FACE_SIZE, 80);
    const auto faces = detector.detect(image);
    if (faces.size == 0) {
      writeResult(args.output, false, 0.0, "not_evaluated", 0.0, 0.0,
                  {"face_not_detected"}, {});
      return 0;
    }
    if (faces.size != 1) {
      writeResult(args.output, false, 0.0, "not_evaluated", 0.0, 0.0,
                  {"multiple_faces_detected"}, {});
      return 0;
    }

    seeta::ModelSetting landmarkSetting(model(args, "face_landmarker_pts5.csta").string(),
                                        seeta::ModelSetting::CPU);
    seeta::FaceLandmarker landmarker(landmarkSetting);
    const auto points = landmarker.mark(image, faces.data[0].pos);

    seeta::ModelSetting antiSetting(seeta::ModelSetting::CPU);
    antiSetting.append(model(args, "fas_first.csta").string());
    antiSetting.append(model(args, "fas_second.csta").string());
    seeta::FaceAntiSpoofing anti(antiSetting);
    anti.SetThreshold(0.30f, 0.80f);
    const auto status = anti.Predict(image, faces.data[0].pos, points.data());
    float clarity = 0.0f;
    float reality = 0.0f;
    anti.GetPreFrameScore(&clarity, &reality);
    std::string liveness = "fuzzy";
    std::vector<std::string> issues;
    if (status == seeta::FaceAntiSpoofing::REAL) liveness = "real";
    else if (status == seeta::FaceAntiSpoofing::SPOOF) {
      liveness = "spoof";
      issues.push_back("seetaface_liveness_spoof");
    } else {
      issues.push_back("seetaface_liveness_fuzzy");
    }
    if (ppm.width < 420 || ppm.height < 420) issues.push_back("image_resolution_below_icao_target");

    std::vector<float> feature;
    if (status == seeta::FaceAntiSpoofing::REAL) {
      seeta::ModelSetting recognizerSetting(model(args, "face_recognizer.csta").string(),
                                            seeta::ModelSetting::CPU);
      seeta::FaceRecognizer recognizer(recognizerSetting);
      feature.resize(static_cast<std::size_t>(recognizer.GetExtractFeatureSize()));
      if (!recognizer.Extract(image, points.data(), feature.data())) {
        feature.clear();
        issues.push_back("template_extraction_failed");
      } else {
        double norm = 0.0;
        for (float value : feature) norm += static_cast<double>(value) * value;
        norm = std::sqrt(norm);
        if (!std::isfinite(norm) || norm <= 1e-12) {
          feature.clear();
          issues.push_back("template_invalid_norm");
        } else {
          for (float &value : feature) value = static_cast<float>(value / norm);
        }
      }
    }
    // Una captura que no cumple el mínimo de calidad no puede producir una
    // plantilla aceptable, aunque el clasificador PAD la marque como REAL.
    const bool pass = status == seeta::FaceAntiSpoofing::REAL &&
                      !feature.empty() && issues.empty();
    const double quality = std::clamp((static_cast<double>(clarity) + reality) / 2.0, 0.0, 1.0);
    writeResult(args.output, pass, quality, liveness, clarity, reality, issues, feature);
    return 0;
  } catch (const std::exception &ex) {
    if (!output.empty()) {
      try { writeResult(output, false, 0.0, "error", 0.0, 0.0, {ex.what()}, {}); }
      catch (...) {}
    }
    std::cerr << ex.what() << '\n';
    return 3;
  }
}
