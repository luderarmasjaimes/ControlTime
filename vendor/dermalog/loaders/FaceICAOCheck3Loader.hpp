#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogFaceICAOCheck3.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_FACE_ICAOCHECK3_LIBNAME "DermalogFaceICAOCheck3.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_FACE_ICAOCHECK3_LIBNAME "libdermalogfaceicaocheck3.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)

class ClICAOCheck3Loader
{
public:
	ClICAOCheck3Loader();
	~ClICAOCheck3Loader();
	void CheckError(DrmErrorCode_t nErrorCode);
	const char* (DRMAPI* GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);
	DrmErrorCode_t(DRMAPI* Initialize)(const char* szReserved);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* const szVersion, size_t* pnSize);
	DrmErrorCode_t(DRMAPI* CreateCheckHandle)(FIC3CheckHandle_t* const pICAOCheckHandle);
	DrmErrorCode_t(DRMAPI* CreateResultHandle)(FIC3ResultHandle_t* const pResultHandle);
	DrmErrorCode_t(DRMAPI* DestroyHandle)(FIC3Handle_t* const pHandle);
	DrmErrorCode_t(DRMAPI* EnhanceImageForEngraver)(const FIC3CheckHandle_t hCheckHandle, const DIEHandleImage_t hInputImage, const DIEHandleImage_t hOutputImage);
	DrmErrorCode_t(DRMAPI* CheckFace)(const FIC3CheckHandle_t hICAOCHeckHandle, const DIEHandleImage_t hImage, const DDEBoundingBox_t* stBoundingBoxArray, const DDEKeyPoint_t* stKeyPoints, const FIC3ResultHandle_t hResultHandle);
	DrmErrorCode_t(DRMAPI* GetPortraitImage)(const FIC3CheckHandle_t hICAOCHeckHandle, const FIC3ResultHandle_t hResultHandle, const FIC3PortraitImageBackgroundSeparation eMethod, const DIEHandleImage_t hOutputImage);
	DrmErrorCode_t(DRMAPI* GetPropertyScore)(const FIC3ResultHandle_t hResultHandle, const char* szPropertyString, double* dScore);
	DrmErrorCode_t(DRMAPI* GetPropertyState)(const FIC3ResultHandle_t hResultHandle, const char* szPropertyString, int* bState);
	DrmErrorCode_t(DRMAPI* WriteISODataToFile)(const DIEHandleImage_t hInputImage, const FIC3ISOFormat_t eISOFormat, const int nJPEGQuality, const char* szISOFilePath);
	DrmErrorCode_t(DRMAPI* LoadISODataFromFile)(const char* szISOFilePath, const DIEHandleImage_t hOutputImage);
	DrmErrorCode_t(DRMAPI* ConfigurePropertyCheck)(const FIC3CheckHandle_t hICAOCHeckHandle, const char* const szProperty, const int nEnable);
	DrmErrorCode_t(DRMAPI* IsPropertyCheckEnabled)(const FIC3CheckHandle_t hICAOCHeckHandle, const char* const szProperty, int* const pnValue);
	DrmErrorCode_t(DRMAPI* ConfigurePropertyPriority)(const FIC3CheckHandle_t hICAOCHeckHandle, const char* const szProperty, const int nPrioritize);
	DrmErrorCode_t(DRMAPI* IsPropertyPrioritized)(const FIC3CheckHandle_t hICAOCHeckHandle, const char* const szProperty, int* const pnValue);
	DrmErrorCode_t(DRMAPI* SetPropertyA)(const FIC3Handle_t hHandle, const char* const szProperty, const char* const szValue);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const FIC3Handle_t hHandle, const char* const szProperty, const long nValue);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const FIC3Handle_t hHandle, const char* const szProperty, const double dValue);
	DrmErrorCode_t(DRMAPI* GetPropertyA)(const FIC3Handle_t hHandle, const char* const szProperty, char* const szValue, size_t* const pnSize);
	DrmErrorCode_t(DRMAPI* GetPropertyLongA)(const FIC3Handle_t hHandle, const char* const szProperty, long* const pnValue);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const FIC3Handle_t hHandle, const char* const szProperty, double* const pdValue);
	const char* (DRMAPI* GetLastErrorMessageA)(void);
protected:
	HMODULE m_hDll;

};
