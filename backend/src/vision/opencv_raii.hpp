#ifndef OPENCV_RAI_HPP
#define OPENCV_RAI_HPP

#include <opencv2/opencv.hpp>
#include <memory>
#include <vector>
#include <mutex>
#include <atomic>
#include <iostream>

namespace vision {

// Clase RAII para gestión automática de recursos OpenCV
class OpenCVResourceGuard {
private:
    static std::atomic<size_t> active_resources_;
    static std::atomic<size_t> total_allocated_;
    static std::mutex stats_mutex_;
    
    size_t resource_id_;
    bool released_;
    
public:
    OpenCVResourceGuard();
    ~OpenCVResourceGuard();
    
    void release();
    bool is_released() const { return released_; }
    size_t id() const { return resource_id_; }
    
    static size_t get_active_resources();
    static size_t get_total_allocated();
    static void log_stats();
};

// Wrapper RAII para cv::Mat
class MatGuard {
private:
    cv::Mat mat_;
    OpenCVResourceGuard guard_;
    
public:
    // Constructores
    MatGuard();
    explicit MatGuard(const cv::Mat& mat);
    MatGuard(int rows, int cols, int type);
    MatGuard(cv::Size size, int type);
    
    // Operadores de acceso
    cv::Mat& get() { return mat_; }
    const cv::Mat& get() const { return mat_; }
    cv::Mat* operator->() { return &mat_; }
    const cv::Mat* operator->() const { return &mat_; }
    
    // Conversión implícita
    operator cv::Mat&() { return mat_; }
    operator const cv::Mat&() const { return mat_; }
    
    // Métodos de cv::Mat
    bool empty() const { return mat_.empty(); }
    cv::Size size() const { return mat_.size(); }
    int rows() const { return mat_.rows; }
    int cols() const { return mat_.cols; }
    
    // Liberación explícita
    void release();
    
    // Prevención de copia, permitir movimiento
    MatGuard(const MatGuard&) = delete;
    MatGuard& operator=(const MatGuard&) = delete;
    MatGuard(MatGuard&& other) noexcept;
    MatGuard& operator=(MatGuard&& other) noexcept;
};

// Wrapper RAII para video capture
class VideoCaptureGuard {
private:
    cv::VideoCapture cap_;
    OpenCVResourceGuard guard_;
    
public:
    explicit VideoCaptureGuard(const std::string& filename);
    explicit VideoCaptureGuard(int device);
    
    bool isOpened() const { return cap_.isOpened(); }
    bool read(cv::Mat& frame);
    bool grab();
    bool retrieve(cv::Mat& frame);
    
    cv::VideoCapture& get() { return cap_; }
    const cv::VideoCapture& get() const { return cap_; }
    
    void release();
    
    VideoCaptureGuard(const VideoCaptureGuard&) = delete;
    VideoCaptureGuard& operator=(const VideoCaptureGuard&) = delete;
    VideoCaptureGuard(VideoCaptureGuard&& other) noexcept;
    VideoCaptureGuard& operator=(VideoCaptureGuard&& other) noexcept;
};

// Clase de fábrica para creación segura de recursos
class VisionResourceManager {
private:
    static std::atomic<size_t> max_resources_;
    
public:
    static void set_max_resources(size_t max);
    static size_t get_max_resources();
    
    static MatGuard create_mat(int rows, int cols, int type);
    static MatGuard create_mat(cv::Size size, int type);
    static MatGuard load_image(const std::string& path, int flags = cv::IMREAD_COLOR);
    
    static VideoCaptureGuard create_video_capture(const std::string& filename);
    static VideoCaptureGuard create_video_capture(int device);
    
    static bool can_allocate_resource();
    static void cleanup_resources();
    
    static void log_resource_usage();
};

// Excepción para errores de recursos
class ResourceAllocationError : public std::runtime_error {
public:
    explicit ResourceAllocationError(const std::string& message) 
        : std::runtime_error("[OpenCV RAII] Resource allocation error: " + message) {}
};

} // namespace vision

#endif