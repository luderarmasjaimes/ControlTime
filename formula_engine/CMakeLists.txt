cmake_minimum_required(VERSION 3.16)
project(formula_cpp_backend LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCV REQUIRED)
find_package(Boost 1.91 REQUIRED COMPONENTS thread)
message(STATUS "Boost: ${Boost_VERSION_STRING} (${Boost_INCLUDE_DIRS})")
find_package(nlohmann_json REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBPQXX libpqxx)

include_directories(${OpenCV_INCLUDE_DIRS} ${LIBPQXX_INCLUDE_DIRS})

add_executable(formula_server src/main.cpp)

target_include_directories(formula_server PRIVATE ${OpenCV_INCLUDE_DIRS} ${LIBPQXX_INCLUDE_DIRS})

target_compile_definitions(formula_server PRIVATE BOOST_ERROR_CODE_HEADER_ONLY=1)
target_link_libraries(formula_server PRIVATE ${OpenCV_LIBS} Boost::thread nlohmann_json::nlohmann_json ${LIBPQXX_LIBRARIES})
