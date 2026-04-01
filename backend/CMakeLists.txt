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

add_executable(mapas_backend
  src/main.cpp
)

target_include_directories(mapas_backend PRIVATE
  ${OpenCV_INCLUDE_DIRS}
)

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
