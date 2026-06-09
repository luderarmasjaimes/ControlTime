#include "opencv_raii.hpp"
#include <iostream>
#include <stdexcept>

namespace vision {

// Variables estáticas
std::atomic<size_t> OpenCVResourceGuard::active_resources_{0};
std::atomic<size_t> OpenCVResourceGuard::total_allocated_{0};
std::mutex OpenCVResourceGuard::stats_mutex_;

OpenCVResourceGuard::OpenCVResourceGuard() 
    : resource_id_(total_allocated_.fetch_add(1)), released_(false) {
    active_resources_.fetch_add(1);
}

OpenCVResourceGuard::~OpenCVResourceGuard() {
    release();
}

void OpenCVResourceGuard::release() {
    if (!released_) {
        released_ = true;
        active_resources_.fetch_sub(1);
    }
}

size_t OpenCVResourceGuard::get_active_resources() {
    return active_resources_.load();
}

size_t OpenCVResourceGuard::get_total_allocated() {
    return total_allocated_.load();
}

void OpenCVResourceGuard::log_stats() {
    std::lock_guard<std::mutex> lock(stats_mutex_);
    std::cout << "[OpenCV RAII] Active resources: " << get_active_resources() 
              << ", Total allocated: " << get_total_allocated() << std::endl;
}

// Implementación de MatGuard
MatGuard::MatGuard() : guard_() {}

MatGuard::MatGuard(const cv::Mat& mat) : mat_(mat), guard_() {}

MatGuard::MatGuard(int rows, int cols, int type) : mat_(rows, cols, type), guard_() {}

MatGuard::MatGuard(cv::Size size, int type) : mat_(size, type), guard_() {}

void MatGuard::release() {
    mat_.release();
    guard_.release();
}

MatGuard::MatGuard(MatGuard&& other) noexcept 
    : mat_(std::move(other.mat_)), guard_(std::move(other.guard_)) {}

MatGuard& MatGuard::operator=(MatGuard&& other) noexcept {
    if (this != &other) {
        mat_ = std::move(other.mat_);
        guard_ = std::move(other.guard_);
    }
    return *this;
}

// Implementación de VideoCaptureGuard
VideoCaptureGuard::VideoCaptureGuard(const std::string& filename) : cap_(filename), guard_() {
    if (!cap_.isOpened()) {
        throw ResourceAllocationError("Failed to open video file: " + filename);
    }
}

VideoCaptureGuard::VideoCaptureGuard(int device) : cap_(device), guard_() {
    if (!cap_.isOpened()) {
        throw ResourceAllocationError("Failed to open video device: " + std::to_string(device));
    }
}

bool VideoCaptureGuard::read(cv::Mat& frame) {
    return cap_.read(frame);
}

bool VideoCaptureGuard::grab() {
    return cap_.grab();
}

bool VideoCaptureGuard::retrieve(cv::Mat& frame) {
    return cap_.retrieve(frame);
}

void VideoCaptureGuard::release() {
    if (cap_.isOpened()) {
        cap_.release();
    }
    guard_.release();
}

VideoCaptureGuard::VideoCaptureGuard(VideoCaptureGuard&& other) noexcept 
    : cap_(std::move(other.cap_)), guard_(std::move(other.guard_)) {}

VideoCaptureGuard& VideoCaptureGuard::operator=(VideoCaptureGuard&& other) noexcept {
    if (this != &other) {
        if (cap_.isOpened()) {
            cap_.release();
        }
        cap_ = std::move(other.cap_);
        guard_ = std::move(other.guard_);
    }
    return *this;
}

// Implementación de VisionResourceManager
std::atomic<size_t> VisionResourceManager::max_resources_{10000};

void VisionResourceManager::set_max_resources(size_t max) {
    max_resources_.store(max);
}

size_t VisionResourceManager::get_max_resources() {
    return max_resources_.load();
}

bool VisionResourceManager::can_allocate_resource() {
    return OpenCVResourceGuard::get_active_resources() < max_resources_.load();
}

MatGuard VisionResourceManager::create_mat(int rows, int cols, int type) {
    if (!can_allocate_resource()) {
        throw ResourceAllocationError("Maximum resource limit reached");
    }
    return MatGuard(rows, cols, type);
}

MatGuard VisionResourceManager::create_mat(cv::Size size, int type) {
    if (!can_allocate_resource()) {
        throw ResourceAllocationError("Maximum resource limit reached");
    }
    return MatGuard(size, type);
}

MatGuard VisionResourceManager::load_image(const std::string& path, int flags) {
    if (!can_allocate_resource()) {
        throw ResourceAllocationError("Maximum resource limit reached");
    }
    
    cv::Mat img = cv::imread(path, flags);
    if (img.empty()) {
        throw ResourceAllocationError("Failed to load image: " + path);
    }
    
    return MatGuard(img);
}

VideoCaptureGuard VisionResourceManager::create_video_capture(const std::string& filename) {
    if (!can_allocate_resource()) {
        throw ResourceAllocationError("Maximum resource limit reached");
    }
    return VideoCaptureGuard(filename);
}

VideoCaptureGuard VisionResourceManager::create_video_capture(int device) {
    if (!can_allocate_resource()) {
        throw ResourceAllocationError("Maximum resource limit reached");
    }
    return VideoCaptureGuard(device);
}

void VisionResourceManager::cleanup_resources() {
    // OpenCV debería manejar la limpieza automática mediante RAII
    // Este método es principalmente para logging y verificación
    OpenCVResourceGuard::log_stats();
}

void VisionResourceManager::log_resource_usage() {
    std::cout << "[VisionResourceManager] Max resources: " << get_max_resources() 
              << ", Active: " << OpenCVResourceGuard::get_active_resources() << std::endl;
}

} // namespace vision