#pragma once

#if defined(_WIN32)
#include <Windows.h>

#else
#include <dlfcn.h>
#define FreeLibrary dlclose //< for linux: compatibility with windows.h functions
#endif

#include "TutLoadLibrary.hpp"
#include <DermalogImageExchange.h>

/* defines for system independence */
#if defined(_WIN32)
#define DERMALOG_DIE_LIBNAME "DermalogImageExchange.dll" /* load the .dll file when using windows*/
#else /*for Non-Windows OS*/
#define DERMALOG_DIE_LIBNAME "libdermalogimageexchange.so" /* load the .so file when using linux */
#define DRMAPI
#endif // defined(_WIN32)


class ClImageExchangeLoader
{
public:
	ClImageExchangeLoader();
	~ClImageExchangeLoader();
	void CheckError(DrmErrorCode_t nErrorCode);
	const char* (DRMAPI *GetErrorDescriptionA)(DrmErrorCode_t nErrorNr);

	DrmErrorCode_t(DRMAPI* Initialize)(const char* const);
	DrmErrorCode_t(DRMAPI* Uninitialize)(void);
	DrmErrorCode_t(DRMAPI* GetVersionA)(char* Value, size_t* Valuesize);

	DrmErrorCode_t(DRMAPI* CreateImage)(DIEHandleImage_t* const hImageHandle);

	DrmErrorCode_t(DRMAPI* LoadImageFromBuffer)(const DIEHandleImage_t hImageHandle, const void* pInImage, const size_t nInImageSize);
	DrmErrorCode_t(DRMAPI* LoadImageFromFile)(const DIEHandleImage_t hImageHandle, const char* szFileName);
	DrmErrorCode_t(DRMAPI* LoadImageFromRawData)(const DIEHandleImage_t hImageHandle, const void* pRawData, const size_t nDataLength, const size_t nHeight, const size_t nWidth, const size_t nChannels, const DIEImageDataType eDataType, const size_t nStrideInBytes, const DIEImageFormatType eDataFormat);
	DrmErrorCode_t(DRMAPI* GetBuffer)(const DIEHandleImage_t hImageHandle, void* const pOutputImageData, size_t* const pnOutputImageSize);
	DrmErrorCode_t(DRMAPI* GetBufferWithSpecifiedEncoding)(const DIEHandleImage_t hImageHandle, const DIEImageEncoding_t eTargetEncoding, const uint8_t nTargetQuality, void* const pOutputImageData, size_t* const pnOutputImageSize);
	DrmErrorCode_t(DRMAPI* GetImageRawData)(const DIEHandleImage_t hImageHandle, void** pRawData, size_t* const pHeight, size_t* const pWidth, size_t* const pChannels, DIEImageDataType* const pDataType);
	DrmErrorCode_t(DRMAPI* SaveImageToFile)(const DIEHandleImage_t hImageHandle, const char* szFileName);
	DrmErrorCode_t(DRMAPI* CloneImage)(const DIEHandleImage_t hImageToClone, const DIEHandleImage_t hImageOut);

	DrmErrorCode_t(DRMAPI* CorrectImageOrientation)(const DIEHandleImage_t hImageHandle, const DIEImageOrientation eOrientation);

	DrmErrorCode_t(DRMAPI* DestroyHandle)(DIEHandle_t* const Handle);
	DrmErrorCode_t(DRMAPI* SetPropertyA)(const DIEHandle_t Handle, const char* szProperty, const char* value);
	DrmErrorCode_t(DRMAPI* GetPropertyA)(const DIEHandle_t Handle, const char* szProperty, char* value, size_t* valuesize);
	DrmErrorCode_t(DRMAPI* SetPropertyLongA)(const DIEHandle_t Handle, const char* szProperty, long value);
	DrmErrorCode_t(DRMAPI* GetPropertyLongA)(const DIEHandle_t Handle, const char* szProperty, long* const value);
	DrmErrorCode_t(DRMAPI* SetPropertyDoubleA)(const DIEHandle_t Handle, const char* szProperty, double value);
	DrmErrorCode_t(DRMAPI* GetPropertyDoubleA)(const DIEHandle_t Handle, const char* szProperty, double* const value);
	const char* (DRMAPI* GetLastErrorMessageA)(void);
protected:
	HMODULE m_hDll;
};

