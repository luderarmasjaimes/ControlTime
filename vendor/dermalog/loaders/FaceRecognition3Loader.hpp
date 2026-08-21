#pragma once
#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceRecognition3.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FACERECOGNITION3_LIBNAME "DermalogFaceRecognition3.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FACERECOGNITION3_LIBNAME "libdermalogfacerecognition3.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)

class ClFaceRecognition3Loader
{
public:
	ClFaceRecognition3Loader();
	~ClFaceRecognition3Loader();
	void CheckError(DrmErrorCode_t nErrorCode);
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* CreateFaceEncoderHandle)(FR3FaceEncoderHandle_t* const pFaceEncoderHandle);
	DrmErrorCode_t(DRMAPI* CreateSpecificFaceEncoderHandle)(FR3FaceEncoderHandle_t* const pFaceEncoderHandle, FR3FaceEncoderType eEncoderType);
	DrmErrorCode_t(DRMAPI* CreateSpecificFaceEncoderHandleWithInferencePlatform)(FR3FaceEncoderHandle_t* const pFaceEncoderHandle, FR3FaceEncoderType eEncoderType, DIPInferencePlatform_t eInferencePlatform);
	DrmErrorCode_t(DRMAPI* CreateFaceTemplateHandle)(FR3FaceTemplateHandle_t* const pFaceTemplateHandle);
	DrmErrorCode_t(DRMAPI* CreateFaceMatcherHandle)(FR3FaceMatcherHandle_t* const pFaceMatcherHandle);
	DrmErrorCode_t(DRMAPI* SaveFaceTemplateToFile)(const FR3FaceTemplateHandle_t hFaceTemplateHandle, const char* szOutputFileName);
	DrmErrorCode_t(DRMAPI* GetFaceTemplateData)(const FR3FaceTemplateHandle_t hFaceTemplateHandle, void* const pOutputTemplateData, size_t* const pnOutputTemplateDataSize);
	DrmErrorCode_t(DRMAPI* LoadFaceTemplateFromFile)(const FR3FaceTemplateHandle_t hFaceTemplateHandle, const char* szFileName);
	DrmErrorCode_t(DRMAPI* LoadFaceTemplateFromMemory)(const FR3FaceTemplateHandle_t hFaceTemplateHandle, const void* pTemplateData, size_t nTemplateSize);
	DrmErrorCode_t(DRMAPI* EncodeFace)(const FR3FaceEncoderHandle_t hFaceEncoderHandle, const DIEHandleImage_t hImageHandle, const DDEKeyPoint_t* stKeyPointArray, const FR3FaceTemplateHandle_t hFaceTemplateHandle);
	DrmErrorCode_t(DRMAPI* VerifyTemplates)(const FR3FaceMatcherHandle_t hFaceMatcherHandle, const FR3FaceTemplateHandle_t hFaceTemplateHandle1, const FR3FaceTemplateHandle_t hFaceTemplateHandle2, float* pVerificationScore);
	DrmErrorCode_t(DRMAPI* ConvertScore)(const FR3FaceMatcherHandle_t hFaceMatcherHandle, float fInputScore, FR3MatchingScoreType nInputScoreType, FR3MatchingScoreType nOutputScoreType, float* pOutputScore);
	DrmErrorCode_t(DRMAPI* GetPropertyA)(const FR3Handle_t hHandle, const char* const szProperty, char* const szValue, size_t* const pnSize);
	DrmErrorCode_t(DRMAPI* GetPropertyLongA)(const FR3Handle_t hHandle, const char* const szProperty, long* const pnValue);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const FR3Handle_t hHandle, const char* const szProperty, double* const pdValue);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const FR3Handle_t hHandle, const char* const szProperty, long nValue);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FR3Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* Value, size_t* Valuesize);
	const char* (DRMAPI* GetLastErrorMessageA)(void);

protected:
	HMODULE m_hDll;
};

