#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceLiveness2.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FL2_LIBNAME "DermalogFaceLiveness2.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FL2_LIBNAME "libdermalogfaceliveness2.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)


class ClFaceLiveness2Loader
{
public:
	ClFaceLiveness2Loader();
	~ClFaceLiveness2Loader();
	void CheckError(DrmErrorCode_t nErrorCode);
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* const szVersion, size_t* pnSize);
	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* CreateLivenessDetector)(FL2HandleLivenessDetector_t* const hHandle, FL2AlgorithmType eAlgorithmType);
	DrmErrorCode_t(DRMAPI* Update)(const FL2HandleLivenessDetector_t hHandle, const DIEHandleImage_t hSourceImage);
	DrmErrorCode_t(DRMAPI* Reset)(const FL2Handle_t hHandle);
	DrmErrorCode_t(DRMAPI* RegisterCallbackUpdate)(FL2HandleLivenessDetector_t hLivenessDetector, FL2FnCallbackUpdate_t pFnCallback, void* pContext);
	DrmErrorCode_t(DRMAPI* RegisterCallbackLivenessScoreReady)(FL2HandleLivenessDetector_t hLivenessDetector, FL2FnCallbackLivenessScoreReady_t pFnCallback, void* pContext);
	DrmErrorCode_t(DRMAPI* RegisterCallbackStatusChange)(FL2HandleLivenessDetector_t hLivenessDetector, FL2FnCallbackStatusChange_t pFnCallback, void* pContext);
	DrmErrorCode_t(DRMAPI* RegisterCallbackLivenessError)(FL2HandleLivenessDetector_t hLivenessDetector, FL2FnCallbackLivenessError_t pFnCallback, void* pContext);
	DrmErrorCode_t(DRMAPI* SetImage)(const FL2HandleLivenessDetector_t hHandle, const DIEHandleImage_t hSourceImage, const DDEBoundingBox_t stBoundingBox, const DDEKeyPoint_t* stKeyPointArray, FL2InputImageType eInputImageType);
	DrmErrorCode_t(DRMAPI* GetLivenessScore)(const FL2HandleLivenessDetector_t hHandle, double* dLivenessScore);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const FL2Handle_t hHandle, const char* const szProperty, double const pnValue);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const FL2Handle_t hHandle, const char* const szProperty, double* const pdValue);
	DrmErrorCode_t(DRMAPI* GetPropertyLongA)(const FL2Handle_t hHandle, const char* const szProperty, long* const pnValue);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const FL2Handle_t hHandle, const char* const szProperty, long const pnValue);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FL2Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* SetLicense)(const void* pLicense, size_t nSize, void* pContext);
	const char* (DRMAPI* GetLastErrorMessageA)(void);

protected:
	HMODULE m_hDll;
};

