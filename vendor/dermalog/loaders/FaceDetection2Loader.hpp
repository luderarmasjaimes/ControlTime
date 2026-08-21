#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceDetection2.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FD2_LIBNAME "DermalogFaceDetection2.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FD2_LIBNAME "libdermalogfacedetection2.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)

class ClFaceDetection2Loader
{
public:
	ClFaceDetection2Loader();
	~ClFaceDetection2Loader();
	void CheckError(DrmErrorCode_t nErrorCode);

	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* const szVersion, size_t* pnSize);
	DrmErrorCode_t(DRMAPI* CreateFaceDetector)(FD2HandleFaceDetector_t* const pFaceDetectorHandle);
	DrmErrorCode_t(DRMAPI* CreateFaceDetectorWithInferencePlatform)(FD2HandleFaceDetector_t* const pFaceDetectorHandle, const DIPInferencePlatform_t eInferencePlugin);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FD2Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* FindFaceBoundingBoxes)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DIEHandleImage_t hRawImageHandle, uint16_t* nNumFacesFound);
	DrmErrorCode_t(DRMAPI* FindFaceBoundingBoxesWithMinSize)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DIEHandleImage_t hRawImageHandle, const double dSize, uint16_t* nNumFacesFound);
	DrmErrorCode_t(DRMAPI* GetFaces)(const FD2HandleFaceDetector_t hFaceDetectorHandle, DDEBoundingBox_t* stBoundingBoxArray, uint16_t nNumBoundingBoxes);
	DrmErrorCode_t(DRMAPI* FindKeyPoints)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DIEHandleImage_t hRawImageHandle, const DDEBoundingBox_t stBoundingBox, uint16_t* nNumKeyPoints);
	DrmErrorCode_t(DRMAPI* GetKeyPoints)(const FD2HandleFaceDetector_t hFaceDetectorHandle, DDEKeyPoint_t* stKeyPointArray);
	DrmErrorCode_t(DRMAPI* GetPortraitImage)(const FD2HandleFaceDetector_t hFaceDetector, const DIEHandleImage_t hSourceImage, const DIEHandleImage_t hDestinationImage, const DDEBoundingBox_t stBoundingBox, const DDEKeyPoint_t* stKeyPointArray, DDEKeyPoint_t* stCornerPoints, int* bPortraitImageInBounds);
	DrmErrorCode_t(DRMAPI* FindFacePose)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DIEHandleImage_t hSourceImage, const DDEKeyPoint_t* stKeyPointArray, const FD2PoseEstimationAlgorithm_t eAlgorithm, DDEPose_t* stPose);
	DrmErrorCode_t(DRMAPI* CheckFaceQuality)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, double* pFaceQuality);
//	DrmErrorCode_t(DRMAPI* CheckVisualFaceQuality)(const FD2HandleFaceDetector_t hFaceDetector, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, FD2VisualFaceQualityResult_t* stResult);
	DrmErrorCode_t(DRMAPI* CalculateInterEyeDistance)(const FD2HandleFaceDetector_t hFaceDetectorHandle, const DDEKeyPoint_t* stKeyPointArray, const DDEPose_t stPose, double* pIED);
	DrmErrorCode_t(DRMAPI* CloneDetector)(const FD2HandleFaceDetector_t hDetectorToClone, const FD2HandleFaceDetector_t hDetectorOut);
	DrmErrorCode_t(DRMAPI* SetPropertyA)(const FD2Handle_t hHandle, const char* const szProperty, const char* const szValue);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const FD2Handle_t hHandle, const char* const szProperty, const long nValue);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const FD2Handle_t hHandle, const char* const szProperty, const double dValue);
	DrmErrorCode_t(DRMAPI* SetContext)(void* pContext);
	DrmErrorCode_t(DRMAPI* SetLicense)(const void* pLicense, size_t nSize, void* pContext);
	DrmErrorCode_t(DRMAPI* GetPropertyA)(const FD2Handle_t hHandle, const char* const szProperty, char* const szValue, size_t* const pnSize);
	DrmErrorCode_t(DRMAPI* GetPropertyLongA)(const FD2Handle_t hHandle, const char* const szProperty, long* const pnValue);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const FD2Handle_t hHandle, const char* const szProperty, double* const pdValue);
	
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	const char* (DRMAPI* GetLastErrorMessageA)(void);

protected:
	HMODULE m_hDll;
};

