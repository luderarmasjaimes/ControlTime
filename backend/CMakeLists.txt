cmake_minimum_required(VERSION 3.22)
project(mapas_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost 1.83 REQUIRED COMPONENTS system json)
find_package(OpenCV REQUIRED)
find_package(Threads REQUIRED)

find_path(GDAL_INCLUDE_DIR gdal/gdal.h)
find_library(GDAL_LIBRARY NAMES gdal)

if(NOT GDAL_INCLUDE_DIR OR NOT GDAL_LIBRARY)
  message(FATAL_ERROR "GDAL not found. Install libgdal-dev (Linux) or set GDAL paths (Windows).")
endif()

add_executable(mapas_backend
  src/main.cpp
  src/websocket_session.hpp
  src/vision_pipeline.hpp
)

target_include_directories(mapas_backend PRIVATE
  ${GDAL_INCLUDE_DIR}
  ${GDAL_INCLUDE_DIR}/gdal
)

target_link_libraries(mapas_backend PRIVATE
  Boost::system
  Boost::json
  ${OpenCV_LIBS}
  ${GDAL_LIBRARY}
  Threads::Threads
)

if(WIN32)
  target_compile_definitions(mapas_backend PRIVATE _WIN32_WINNT=0x0A00)
endif()
