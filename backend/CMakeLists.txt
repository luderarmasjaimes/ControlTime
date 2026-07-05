cmake_minimum_required(VERSION 3.16)
project(mapas_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(WIN32)
  # User-requested local Windows paths for deterministic development builds.
  if(NOT DEFINED BOOST_ROOT)
    set(BOOST_ROOT "C:/boost_1_90_0" CACHE PATH "Boost root path")
  endif()
  if(NOT DEFINED Boost_ROOT)
    set(Boost_ROOT "C:/boost_1_90_0" CACHE PATH "Boost root path")
  endif()
  if(NOT DEFINED OpenCV_DIR)
    set(OpenCV_DIR "C:/opencv/build" CACHE PATH "OpenCV config path")
  endif()
  if(NOT DEFINED OpenCV_RUNTIME)
    set(OpenCV_RUNTIME "vc16" CACHE STRING "OpenCV runtime toolset")
  endif()
  if(NOT DEFINED OPENSSL_ROOT_DIR)
    set(OPENSSL_ROOT_DIR "C:/Program Files/OpenSSL-Win64" CACHE PATH "OpenSSL root path")
  endif()
  if(NOT DEFINED Python3_ROOT_DIR)
    set(Python3_ROOT_DIR "C:/Python/Python314" CACHE PATH "Python root path")
  endif()

  list(PREPEND CMAKE_PREFIX_PATH
    "${Boost_ROOT}"
    "${OpenCV_DIR}"
    "${OPENSSL_ROOT_DIR}"
    "${Python3_ROOT_DIR}"
  )
endif()

set(_use_boost_header_only OFF)
if(WIN32)
  # If Boost binaries are not present on host, allow header-only fallback.
  if(NOT EXISTS "${Boost_ROOT}/lib" AND NOT EXISTS "${BOOST_ROOT}/lib")
    set(_use_boost_header_only ON)
  endif()
endif()

if(_use_boost_header_only)
  if(EXISTS "${Boost_ROOT}/boost")
    set(Boost_INCLUDE_DIRS "${Boost_ROOT}")
  elseif(EXISTS "${BOOST_ROOT}/boost")
    set(Boost_INCLUDE_DIRS "${BOOST_ROOT}")
  else()
    message(FATAL_ERROR "Boost headers not found in Boost_ROOT/BOOST_ROOT for header-only mode")
  endif()
else()
  find_package(Boost REQUIRED COMPONENTS system json)
endif()
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

# Módulos base (seguridad, servidor, visión)
set(BASE_MODULES
  src/security/api_auth.cpp
  src/server/connection_pool.cpp
  src/vision/opencv_raii.cpp
)

# Módulos de infraestructura
set(INFRA_MODULES
  src/config/app_config.cpp
  src/http/http_utils.cpp
  src/http/router.cpp
)

# Módulos de autenticación
set(AUTH_MODULES
  src/auth/auth_session.cpp
  src/auth/auth_storage_file.cpp
  src/auth/auth_storage_pg.cpp
  src/auth/auth_routes.cpp
)

# Módulos biométricos
set(BIOMETRIC_MODULES
  src/biometric/biometric_types.cpp
  src/biometric/face_analysis.cpp
  src/biometric/ai_engine_client.cpp
  src/biometric/biometric_routes.cpp
)

# Módulos de minería
set(MINING_MODULES
  src/mining/kpi_service.cpp
  src/mining/sensor_service.cpp
  src/mining/surveillance_service.cpp
  src/mining/mining_gateway.cpp
  src/mining/mining_routes.cpp
  src/mining/telemetry_ingest.cpp
)

# Módulos de reportes y fórmulas
set(REPORTS_MODULES
  src/reports/report_service.cpp
  src/reports/report_routes.cpp
  src/reports/report_pdf_export.cpp
  src/formula/formula_service.cpp
  src/formula/formula_routes.cpp
)

# Módulos de plataforma, mapa, GDAL, texto
set(PLATFORM_MODULES
  src/platform/platform_routes.cpp
  src/map/map_routes.cpp
  src/gdal/conversion_service.cpp
  src/gdal/gdal_routes.cpp
  src/text/text_routes.cpp
)

add_executable(mapas_backend
  src/main.cpp
  src/map_geo_intersect.cpp
  src/text_spell_service.cpp
  ${_onnx_cartoon_src}
  ${BASE_MODULES}
  ${INFRA_MODULES}
  ${AUTH_MODULES}
  ${BIOMETRIC_MODULES}
  ${MINING_MODULES}
  ${REPORTS_MODULES}
  ${PLATFORM_MODULES}
)

target_include_directories(mapas_backend PRIVATE
  ${Boost_INCLUDE_DIRS}
  ${OpenCV_INCLUDE_DIRS}
  src
  src/security
  src/server
  src/vision
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

if(_use_boost_header_only)
  target_compile_definitions(mapas_backend PRIVATE
    BOOST_ERROR_CODE_HEADER_ONLY=1
    BOOST_JSON_HEADER_ONLY=1
  )
endif()

target_link_libraries(mapas_backend PRIVATE
  ${OpenCV_LIBS}
  Threads::Threads
  OpenSSL::SSL
  OpenSSL::Crypto
)

if(TARGET Boost::system)
  target_link_libraries(mapas_backend PRIVATE Boost::system)
endif()
if(TARGET Boost::json)
  target_link_libraries(mapas_backend PRIVATE Boost::json)
endif()

find_library(PQ_LIBRARY pq)
if(PQ_LIBRARY)
  target_link_libraries(mapas_backend PRIVATE ${PQ_LIBRARY})
endif()

# librdkafka (C++ API) para ingesta durable vía Redpanda/Kafka.
find_library(RDKAFKACPP_LIBRARY rdkafka++)
find_library(RDKAFKA_LIBRARY rdkafka)
if(RDKAFKACPP_LIBRARY AND RDKAFKA_LIBRARY)
  message(STATUS "librdkafka: ${RDKAFKACPP_LIBRARY}")
  target_link_libraries(mapas_backend PRIVATE ${RDKAFKACPP_LIBRARY} ${RDKAFKA_LIBRARY})
  target_compile_definitions(mapas_backend PRIVATE HAVE_RDKAFKA=1)
else()
  message(STATUS "librdkafka: NO encontrado (ingesta Kafka deshabilitada)")
endif()

if(Python3_Interpreter_FOUND)
  message(STATUS "Python3 interpreter: ${Python3_EXECUTABLE}")
endif()

