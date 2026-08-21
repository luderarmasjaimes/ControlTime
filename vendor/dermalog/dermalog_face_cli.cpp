// dermalog_face_cli — puente CLI entre el backend C++ (que shell-ea este
// binario, ver backend/src/biometric/face_analysis.cpp) y el SDK real de
// Dermalog (librerías .so cargadas dinámicamente vía las clases "Loader"
// oficiales del propio SDK, ver vendor/dermalog/loaders/).
//
// Dos modos, porque son dos operaciones distintas del SDK:
//
//   --mode enroll --input <img.jpg> --output-json <out.json>
//       Detecta el rostro, genera el template real (FR3EncodeFace) y lo
//       vuelca como bytes crudos -- se usa en el registro.
//
//   --mode verify --input <img.jpg> --compare-template <stored.json>
//                 --output-json <out.json>
//       Carga el template guardado (mismo formato de bytes que --mode
//       enroll produjo), genera el template de la imagen nueva, y compara
//       ambos con el matcher NATIVO del SDK (VerifyTemplates) -- nunca con
//       similitud coseno genérica, que no tiene sentido sobre un blob
//       opaco de Dermalog. Se usa en login/face.
//
// Formato de "template" en el JSON (tanto el que este binario escribe en
// enroll como el que espera leer en verify vía --compare-template): array
// JSON de enteros 0-255, un elemento por byte del blob real que devuelve
// GetFaceTemplateData/espera LoadFaceTemplateFromMemory. Se eligió ese
// formato -- no base64 -- porque el backend ya sabe parsear "un array JSON
// de números" para face_template (mismo camino que usa hoy para
// embeddings InsightFace), así no hace falta tocar ese parser.
//
// Salida: siempre JSON válido en --output-json si el proceso llega a
// terminar (incluso en error, con "issues"/"error"); código de salida 0
// solo si la operación pedida se completó con éxito. Sin licencia WIBU
// válida, el SDK devuelve FPC_ERROR_NO_LICENCE en el primer Initialize()
// que lo requiera -- se reporta como {"error":"no_license", ...} y exit 2,
// nunca se inventa un resultado.

#include <cstring>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include <DermalogImageExchange.h>
#include <DermalogFaceDetection2.h>
#include <DermalogFaceRecognition3.h>

#include "ImageExchangeLoader.hpp"
#include "FaceDetection2Loader.hpp"
#include "FaceRecognition3Loader.hpp"

namespace {

struct Args {
  std::string mode;
  std::string input;
  std::string outputJson;
  std::string compareTemplate;  // solo --mode verify
};

bool ParseArgs(int argc, char *argv[], Args &out, std::string &err) {
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    auto next = [&](std::string &dst) -> bool {
      if (i + 1 >= argc) return false;
      dst = argv[++i];
      return true;
    };
    if (a == "--mode") { if (!next(out.mode)) { err = "--mode requiere valor"; return false; } }
    else if (a == "--input") { if (!next(out.input)) { err = "--input requiere valor"; return false; } }
    else if (a == "--output-json") { if (!next(out.outputJson)) { err = "--output-json requiere valor"; return false; } }
    else if (a == "--compare-template") { if (!next(out.compareTemplate)) { err = "--compare-template requiere valor"; return false; } }
  }
  if (out.mode.empty() || out.input.empty() || out.outputJson.empty()) {
    err = "faltan argumentos requeridos: --mode --input --output-json";
    return false;
  }
  if (out.mode == "verify" && out.compareTemplate.empty()) {
    err = "--mode verify requiere --compare-template";
    return false;
  }
  return true;
}

// Serialización JSON mínima a mano (sin depender de boost::json aquí -- este
// binario se compila standalone contra el SDK, no contra el árbol del
// backend) -- suficiente para el shape fijo que se necesita.
std::string JsonEscape(const std::string &s) {
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out;
}

void WriteResultJson(const std::string &path, bool ok, const std::string &errorCode,
                     const std::string &errorDetail, double qualityScore,
                     const std::vector<uint8_t> *templateBytes, const float *score) {
  std::ostringstream j;
  j << "{";
  j << "\"ok\":" << (ok ? "true" : "false");
  if (!errorCode.empty()) {
    j << ",\"error\":\"" << JsonEscape(errorCode) << "\"";
  }
  if (!errorDetail.empty()) {
    j << ",\"error_detail\":\"" << JsonEscape(errorDetail) << "\"";
  }
  j << ",\"quality\":{\"score\":" << qualityScore << ",\"issues\":[]}";
  if (templateBytes) {
    j << ",\"template\":[";
    for (size_t i = 0; i < templateBytes->size(); ++i) {
      if (i) j << ",";
      j << static_cast<int>((*templateBytes)[i]);
    }
    j << "]";
  }
  if (score) {
    j << ",\"score\":" << *score;
  }
  j << "}";
  std::ofstream ofs(path, std::ios::trunc);
  ofs << j.str();
}

bool ReadTemplateBytesFromJsonFile(const std::string &path, std::vector<uint8_t> &out,
                                   std::string &err) {
  std::ifstream ifs(path);
  if (!ifs) {
    err = "no se pudo abrir --compare-template";
    return false;
  }
  std::string content((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  // Parser deliberadamente trivial: espera exactamente `[n,n,n,...]` (el
  // formato que este mismo binario produce en --mode enroll bajo
  // "template"). No es un parser JSON general a propósito.
  out.clear();
  std::string num;
  for (char c : content) {
    if (c == '[' || c == ']' || c == '"') continue;
    if (c == ',') {
      if (!num.empty()) { out.push_back(static_cast<uint8_t>(std::stoi(num))); num.clear(); }
    } else if (std::isdigit(static_cast<unsigned char>(c))) {
      num += c;
    }
  }
  if (!num.empty()) out.push_back(static_cast<uint8_t>(std::stoi(num)));
  if (out.empty()) {
    err = "--compare-template no contenía bytes válidos";
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char *argv[]) {
  Args args;
  std::string argErr;
  if (!ParseArgs(argc, argv, args, argErr)) {
    std::cerr << argErr << std::endl;
    return 1;
  }

  ClImageExchangeLoader oExchange;
  ClFaceDetection2Loader oDetection;
  ClFaceRecognition3Loader oRecognition;

  DrmErrorCode_t nErr = oExchange.Initialize(nullptr);
  if (nErr == FPC_ERROR_NO_LICENCE) {
    WriteResultJson(args.outputJson, false, "no_license",
                    "DermalogImageExchange: falta licencia WIBU", 0.0, nullptr, nullptr);
    return 2;
  }
  if (nErr != FPC_SUCCESS) {
    WriteResultJson(args.outputJson, false, "init_failed", "ImageExchange", 0.0, nullptr, nullptr);
    return 1;
  }
  nErr = oDetection.Initialize(nullptr);
  if (nErr == FPC_ERROR_NO_LICENCE) {
    WriteResultJson(args.outputJson, false, "no_license",
                    "DermalogFaceDetection2: falta licencia WIBU", 0.0, nullptr, nullptr);
    return 2;
  }
  if (nErr != FPC_SUCCESS) {
    WriteResultJson(args.outputJson, false, "init_failed", "FaceDetection2", 0.0, nullptr, nullptr);
    return 1;
  }
  nErr = oRecognition.Initialize(nullptr);
  if (nErr == FPC_ERROR_NO_LICENCE) {
    WriteResultJson(args.outputJson, false, "no_license",
                    "DermalogFaceRecognition3: falta licencia WIBU", 0.0, nullptr, nullptr);
    return 2;
  }
  if (nErr != FPC_SUCCESS) {
    WriteResultJson(args.outputJson, false, "init_failed", "FaceRecognition3", 0.0, nullptr, nullptr);
    return 1;
  }

  FD2HandleFaceDetector_t hDetector = nullptr;
  oDetection.CreateFaceDetector(&hDetector);
  FR3FaceEncoderHandle_t hEncoder = nullptr;
  oRecognition.CreateFaceEncoderHandle(&hEncoder);

  // Encodea UNA imagen a template -- común a enroll (la única imagen) y a
  // verify (la imagen de prueba a comparar contra el template guardado).
  auto EncodeImageToTemplate = [&](const std::string &imagePath,
                                   FR3FaceTemplateHandle_t &hOutTemplate,
                                   std::string &err) -> bool {
    DIEHandleImage_t hImage = nullptr;
    if (oExchange.CreateImage(&hImage) != FPC_SUCCESS) {
      err = "create_image_failed";
      return false;
    }
    if (oExchange.LoadImageFromFile(hImage, imagePath.c_str()) != FPC_SUCCESS) {
      err = "image_load_failed";
      oExchange.DestroyHandle(&hImage);
      return false;
    }
    uint16_t nFaces = 0;
    if (oDetection.FindFaceBoundingBoxes(hDetector, hImage, &nFaces) != FPC_SUCCESS ||
        nFaces == 0) {
      err = "face_not_detected";
      oExchange.DestroyHandle(&hImage);
      return false;
    }
    DDEBoundingBox stBox;
    oDetection.GetFaces(hDetector, &stBox, 1);
    uint16_t nPoints = 0;
    if (oDetection.FindKeyPoints(hDetector, hImage, stBox, &nPoints) != FPC_SUCCESS) {
      err = "keypoints_failed";
      oExchange.DestroyHandle(&hImage);
      return false;
    }
    std::vector<DDEKeyPoint_t> points(nPoints);
    oDetection.GetKeyPoints(hDetector, points.data());

    oRecognition.CreateFaceTemplateHandle(&hOutTemplate);
    if (oRecognition.EncodeFace(hEncoder, hImage, points.data(), hOutTemplate) != FPC_SUCCESS) {
      err = "encode_failed";
      oRecognition.DestroyHandle(reinterpret_cast<FR3Handle_t *>(&hOutTemplate));
      oExchange.DestroyHandle(&hImage);
      return false;
    }
    oExchange.DestroyHandle(&hImage);
    return true;
  };

  int rc = 1;
  if (args.mode == "enroll") {
    FR3FaceTemplateHandle_t hTemplate = nullptr;
    std::string encErr;
    if (!EncodeImageToTemplate(args.input, hTemplate, encErr)) {
      WriteResultJson(args.outputJson, false, encErr, "", 0.0, nullptr, nullptr);
      rc = 1;
    } else {
      size_t nSize = 0;
      oRecognition.GetFaceTemplateData(hTemplate, nullptr, &nSize);
      std::vector<uint8_t> bytes(nSize);
      if (oRecognition.GetFaceTemplateData(hTemplate, bytes.data(), &nSize) == FPC_SUCCESS) {
        WriteResultJson(args.outputJson, true, "", "", 1.0, &bytes, nullptr);
        rc = 0;
      } else {
        WriteResultJson(args.outputJson, false, "template_export_failed", "", 0.0, nullptr, nullptr);
        rc = 1;
      }
      FR3Handle_t hGeneric = hTemplate;
      oRecognition.DestroyHandle(&hGeneric);
    }
  } else if (args.mode == "verify") {
    std::vector<uint8_t> storedBytes;
    std::string readErr;
    if (!ReadTemplateBytesFromJsonFile(args.compareTemplate, storedBytes, readErr)) {
      WriteResultJson(args.outputJson, false, "stored_template_read_failed", readErr, 0.0, nullptr, nullptr);
      rc = 1;
    } else {
      FR3FaceTemplateHandle_t hStored = nullptr;
      oRecognition.CreateFaceTemplateHandle(&hStored);
      if (oRecognition.LoadFaceTemplateFromMemory(hStored, storedBytes.data(), storedBytes.size()) !=
          FPC_SUCCESS) {
        WriteResultJson(args.outputJson, false, "stored_template_invalid", "", 0.0, nullptr, nullptr);
        rc = 1;
      } else {
        FR3FaceTemplateHandle_t hProbe = nullptr;
        std::string encErr;
        if (!EncodeImageToTemplate(args.input, hProbe, encErr)) {
          WriteResultJson(args.outputJson, false, encErr, "", 0.0, nullptr, nullptr);
          rc = 1;
        } else {
          FR3FaceMatcherHandle_t hMatcher = nullptr;
          oRecognition.CreateFaceMatcherHandle(&hMatcher);
          float fScore = -1.f;
          if (oRecognition.VerifyTemplates(hMatcher, hStored, hProbe, &fScore) == FPC_SUCCESS) {
            WriteResultJson(args.outputJson, true, "", "", 1.0, nullptr, &fScore);
            rc = 0;
          } else {
            WriteResultJson(args.outputJson, false, "verify_failed", "", 0.0, nullptr, nullptr);
            rc = 1;
          }
          FR3Handle_t hMatcherGeneric = hMatcher;
          oRecognition.DestroyHandle(&hMatcherGeneric);
          FR3Handle_t hProbeGeneric = hProbe;
          oRecognition.DestroyHandle(&hProbeGeneric);
        }
      }
      FR3Handle_t hStoredGeneric = hStored;
      oRecognition.DestroyHandle(&hStoredGeneric);
    }
  } else {
    WriteResultJson(args.outputJson, false, "unknown_mode", args.mode, 0.0, nullptr, nullptr);
    rc = 1;
  }

  FD2Handle_t hDetectorGeneric = hDetector;
  oDetection.DestroyHandle(&hDetectorGeneric);
  FR3Handle_t hEncoderGeneric = hEncoder;
  oRecognition.DestroyHandle(&hEncoderGeneric);
  oRecognition.Uninitialize();
  oDetection.Uninitialize();
  oExchange.Uninitialize();
  return rc;
}
