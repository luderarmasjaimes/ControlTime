# DermalogTutorialLibraryLoaders/CMakeLists.txt

cmake_minimum_required(VERSION 3.5)
project(DermalogTutorialLibraryLoaders)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# add library
add_library(${PROJECT_NAME} STATIC
    FaceDetection2Loader.cpp
    FaceExpression2Loader.cpp
    FaceICAOCheck3Loader.cpp
    FaceLiveness2Loader.cpp
    FaceRecognition3Loader.cpp
    FaceTracking2Loader.cpp
    ImageExchangeLoader.cpp
    TutLoadLibrary.cpp
)

target_include_directories(${PROJECT_NAME} SYSTEM PRIVATE "../include" "../DermalogTutorialLibraryLoaders" ${CMAKE_CURRENT_SOURCE_DIR})

if (UNIX)   
    target_link_libraries(${PROJECT_NAME} PRIVATE dl)
endif()


