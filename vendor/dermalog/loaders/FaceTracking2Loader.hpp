#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceTracking2.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FT2_LIBNAME "DermalogFaceTracking2.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FT2_LIBNAME "libdermalogfacetracking2.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)

class ClFaceTracking2Loader
{
public:
	ClFaceTracking2Loader();
	~ClFaceTracking2Loader();
	void CheckError(DrmErrorCode_t nErrorCode);
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* CreateTrackerHandle)(FT2TrackerHandle_t* const hTrackerHandle, const FT2AlgorithmType_t eProfile, const FD2HandleFaceDetector_t hFaceDetectorHandle, const int nPoolSize);
	DrmErrorCode_t(DRMAPI* Update)(const FT2TrackerHandle_t hTrackerHandle, const DIEHandleImage_t hSourceImageHandle, int nFrameNr, long long lTimestamp);
	DrmErrorCode_t(DRMAPI* Reset)(const FT2TrackerHandle_t hTrackerHandle, const FT2ResetMethod_t eMethod);
	DrmErrorCode_t(DRMAPI* RegisterCallback)(const FT2TrackerHandle_t hTrackerHandle, const FT2CallbackTracksReady_t pFnCallback, void* pContext);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FT2Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const FT2Handle_t hHandle, const char* const szProperty, const long nValue);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const FT2Handle_t hHandle, const char* const szProperty, const double nValue);
	const char* (DRMAPI* GetLastErrorMessageA)(void);
protected:
	HMODULE m_hDll;
};

