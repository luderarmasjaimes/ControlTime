import cv2
import sys
import numpy as np
import os
import json

def single_scale_retinex(img, sigma):
    retinex = np.log10(img.astype(np.float64) + 1.0) - np.log10(cv2.GaussianBlur(img, (0, 0), sigma).astype(np.float64) + 1.0)
    return retinex

def color_restoration(img, alpha, beta):
    img_sum = np.sum(img, axis=2, keepdims=True)
    color_restoration = beta * (np.log10(alpha * img.astype(np.float64) + 1.0) - np.log10(img_sum.astype(np.float64) + 1.0))
    return color_restoration

def msrcr(img, sigma_list=[15, 80, 250], G=192, b=-30, alpha=125, beta=46):
    img = img.astype(np.float64) + 1.0
    msr = np.zeros_like(img)
    for sigma in sigma_list:
        msr += single_scale_retinex(img, sigma)
    msr = msr / len(sigma_list)
    
    cr = color_restoration(img, alpha, beta)
    msrcr = G * (cr * msr) + b
    msrcr = np.clip(msrcr, 0, 255)
    return msrcr.astype(np.uint8)

def detect_face_edge_ai(img):
    """
    Advanced AI-like edge detection using Laplacian of Gaussian and bilateral filters.
    """
    # 1. Enhance contrast for edge detection
    enhanced = cv2.convertScaleAbs(img, alpha=1.2, beta=10)
    
    # 2. Denoise but preserve edges
    denoised = cv2.bilateralFilter(enhanced, 9, 75, 75)
    
    # 3. Laplacian of Gaussian for robust edge detection
    gray = cv2.cvtColor(denoised, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    laplacian = cv2.Laplacian(blurred, cv2.CV_64F)
    laplacian = cv2.normalize(laplacian, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)
    
    # 4. Use simple HAAR as fallback/anchor but with the ENHANCED edge image
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    faces = face_cascade.detectMultiScale(laplacian, 1.1, 4)
    
    if len(faces) > 0:
        # Return the largest face
        f = sorted(faces, key=lambda x: x[2]*x[3], reverse=True)[0]
        return {"x": int(f[0]), "y": int(f[1]), "w": int(f[2]), "h": int(f[3])}
    return None

def optimize_image_advanced(input_path, output_path):
    if not os.path.exists(input_path):
        sys.exit(1)

    img = cv2.imread(input_path)
    if img is None:
        sys.exit(1)

    # Apply Multi-Scale Retinex with Color Restoration
    enhanced = msrcr(img)
    
    # Final cleanup
    # bilateral denoising helps remove low-light sensor noise
    final = cv2.bilateralFilter(enhanced, 9, 75, 75)
    
    # AI-like edge refinement (optional info for future use, but the enhanced image is the key here)
    # The C++ engine will receive 'final' which is MSRCR-enhanced.
    cv2.imwrite(output_path, final)
    print(f"Success: Advanced Optimization complete.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)
    optimize_image_advanced(sys.argv[1], sys.argv[2])
