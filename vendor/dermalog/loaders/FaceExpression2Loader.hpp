#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceExpression2.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FX2_LIBNAME "DermalogFaceExpression2.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FX2_LIBNAME "libdermalogfaceexpression2.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)

class ClFaceExpression2Loader
{
public:
	ClFaceExpression2Loader();
	~ClFaceExpression2Loader();
	void CheckError(DrmErrorCode_t nErrorCode);

	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* CreateCharacteristicEstimator)(FX2CharacteristicEstimatorHandle_t* const pCharacteristicEstimatorHandle);
	DrmErrorCode_t(DRMAPI* CreateCharacteristicEstimatorWithInferencePlatform)(FX2CharacteristicEstimatorHandle_t* const pCharacteristicEstimatorHandle, const DIPInferencePlatform_t eInferencePlatform);
	DrmErrorCode_t(DRMAPI* EstimateAge)(const FX2CharacteristicEstimatorHandle_t hCharacteristicEstimatorHandle, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, float* pfAge);
	DrmErrorCode_t(DRMAPI* EstimateGender)(const FX2CharacteristicEstimatorHandle_t hCharacteristicEstimatorHandle, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, FX2Gender_t* peGender);
	DrmErrorCode_t(DRMAPI* EstimateSmile)(const FX2CharacteristicEstimatorHandle_t hCharacteristicEstimatorHandle, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, FX2Smile_t* peSmile);
	DrmErrorCode_t(DRMAPI* CreateEmotionDetector)(FX2EmotionDetector_t* const pEmotionDetector);
	DrmErrorCode_t(DRMAPI* CreateEmotionDetectorWithInferencePlatform)(FX2EmotionDetector_t* const pEmotionDetector, const DIPInferencePlatform_t eInferencePlatform);
	DrmErrorCode_t(DRMAPI* DetectEmotion)(const FX2EmotionDetector_t hEmotionDetector, const DIEHandleImage_t hImage, const DDEKeyPoint_t* stKeyPointArray, FX2EmotionResult* stEmotionResult);
	DrmErrorCode_t(DRMAPI* CreateProtectiveMaskDetector)(FX2ProtectiveMaskDetector_t* const pProtectiveMaskDetector);
	DrmErrorCode_t(DRMAPI* CreateProtectiveMaskDetectorWithInferencePlatform)(FX2ProtectiveMaskDetector_t* const pProtectiveMaskDetector, const DIPInferencePlatform_t eInferencePlatform);
	DrmErrorCode_t(DRMAPI* DetectProtectiveMask)(const FX2ProtectiveMaskDetector_t hProtectiveMaskDetector, const DIEHandleImage_t hImage, const DDEBoundingBox_t stFaceBoundingBox, FX2Mask_t* peDecision, float* pfMaskConfidence);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const FX2Handle_t hHandle, const char* const szProperty, const double dValue);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const FX2Handle_t hHandle, const char* const szProperty, double* const pdValue);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FX2Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* const szVersion, size_t* pnSize);
	DrmErrorCode_t(DRMAPI* SetContext)(void* pContext);
	DrmErrorCode_t(DRMAPI* SetLicense)(const void* pLicense, size_t nSize, void* pContext);
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	const char* (DRMAPI* GetLastErrorMessageA)(void);

protected:
	HMODULE m_hDll;
};
