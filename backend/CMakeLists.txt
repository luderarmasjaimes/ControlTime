cmake_minimum_required(VERSION 3.16)
project(mapas_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(WIN32)
  # User-requested local Windows paths for deterministic development builds.
  set(BOOST_ROOT "C:/boost_1_90_0" CACHE PATH "Boost root path")
  set(Boost_ROOT "C:/boost_1_90_0" CACHE PATH "Boost root path")
  set(OpenCV_DIR "C:/opencv/build" CACHE PATH "OpenCV config path")
  set(Python3_ROOT_DIR "C:/Python/Python314" CACHE PATH "Python root path")

  list(PREPEND CMAKE_PREFIX_PATH
    "C:/boost_1_90_0"
    "C:/opencv/build"
    "C:/Python/Python314"
  )
endif()

find_package(Boost REQUIRED COMPONENTS system json)
find_package(OpenCV REQUIRED)
find_package(Python3 QUIET COMPONENTS Interpreter)
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)

set(ONNXRUNTIME_ROOT "" CACHE PATH "ONNX Runtime prefix (include/ + lib/) for cartoon ONNX")
if(DEFINED ENV{ONNXRUNTIME_ROOT} AND "${ONNXRUNTIME_ROOT}" STREQUAL "")
  file(TO_CMAKE_PATH "$ENV{ONNXRUNTIME_ROOT}" _ort_from_env)
  set(ONNXRUNTIME_ROOT "${_ort_from_env}" CACHE PATH "ONNX Runtime prefix" FORCE)
endif()

set(_onnx_hdr "${ONNXRUNTIME_ROOT}/include/onnxruntime_cxx_api.h")
if(ONNXRUNTIME_ROOT AND EXISTS "${_onnx_hdr}")
  message(STATUS "ONNX Runtime cartoon: ${ONNXRUNTIME_ROOT}")
  set(_onnx_cartoon_src src/onnx_cartoon.cpp)
  set(_onnx_def INFORME_HAVE_ONNXRUNTIME=1)
else()
  message(STATUS "ONNX Runtime cartoon: disabled (set ONNXRUNTIME_ROOT to enable)")
  set(_onnx_cartoon_src src/onnx_cartoon_stub.cpp)
  set(_onnx_def "")
endif()

add_executable(mapas_backend
  src/main.cpp
  ${_onnx_cartoon_src}
)

target_include_directories(mapas_backend PRIVATE
  ${OpenCV_INCLUDE_DIRS}
)

if(ONNXRUNTIME_ROOT AND EXISTS "${_onnx_hdr}")
  target_include_directories(mapas_backend PRIVATE "${ONNXRUNTIME_ROOT}/include")
  if(WIN32)
    target_link_libraries(mapas_backend PRIVATE
      "${ONNXRUNTIME_ROOT}/lib/onnxruntime.lib")
  else()
    target_link_libraries(mapas_backend PRIVATE
      "${ONNXRUNTIME_ROOT}/lib/libonnxruntime.so")
  endif()
endif()

if(_onnx_def)
  target_compile_definitions(mapas_backend PRIVATE ${_onnx_def})
endif()

target_link_libraries(mapas_backend PRIVATE
  Boost::system
  Boost::json
  ${OpenCV_LIBS}
  Threads::Threads
  OpenSSL::SSL
  OpenSSL::Crypto
)

find_library(PQ_LIBRARY pq)
if(PQ_LIBRARY)
  target_link_libraries(mapas_backend PRIVATE ${PQ_LIBRARY})
endif()

if(Python3_Interpreter_FOUND)
  message(STATUS "Python3 interpreter: ${Python3_EXECUTABLE}")
endif()
