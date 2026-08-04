#ifndef ONNX_CARTOON_HPP
#define ONNX_CARTOON_HPP

#include <string>
#include <vector>

/** True si el binario enlazó ONNX Runtime (Docker / build con ONNXRUNTIME_ROOT). */
bool informeCartoonOnnxRuntimeLinked();

/**
 * Avatar estilo anime/cartoon 100 % local: decodifica JPEG/PNG, recorta rostro (Haar) o centro,
 * inferencia ONNX (p. ej. AnimeGANv2 512×512), post bilateral, PNG base64 sin prefijo data:.
 */
bool informeCartoonOnnxFromImageBytes(const std::vector<unsigned char> &imageBytes,
                                      const std::string &modelPath,
                                      std::string &outPngBase64,
                                      std::string &error);

#endif
