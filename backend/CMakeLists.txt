cmake_minimum_required(VERSION 3.16)
project(mapas_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost REQUIRED COMPONENTS system json)
find_package(OpenCV REQUIRED)
find_package(Threads REQUIRED)

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
)

find_library(PQ_LIBRARY pq)
if(PQ_LIBRARY)
  target_link_libraries(mapas_backend PRIVATE ${PQ_LIBRARY})
endif()
