#include "onnx_cartoon.hpp"

bool informeCartoonOnnxRuntimeLinked() { return false; }

bool informeCartoonOnnxFromImageBytes(const std::vector<unsigned char> &imageBytes,
                                      const std::string &modelPath,
                                      std::string &outPngBase64,
                                      std::string &error) {
  (void)imageBytes;
  (void)modelPath;
  (void)outPngBase64;
  error = "onnx_runtime_not_linked";
  return false;
}
