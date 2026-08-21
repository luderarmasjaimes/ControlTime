cmake_minimum_required(VERSION 3.16)
project(seetaface6_face_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(seetaface6-face-cli main.cpp)
target_include_directories(seetaface6-face-cli PRIVATE
  ${SEETAFACE_ROOT}/include)
target_link_directories(seetaface6-face-cli PRIVATE
  ${SEETAFACE_ROOT}/lib
  ${SEETAFACE_ROOT}/lib64)
target_link_libraries(seetaface6-face-cli PRIVATE
  SeetaFaceDetector600
  SeetaFaceLandmarker600
  SeetaFaceAntiSpoofingX600
  SeetaFaceRecognizer610
  tennis
  SeetaAuthorize)

install(TARGETS seetaface6-face-cli RUNTIME DESTINATION bin)
