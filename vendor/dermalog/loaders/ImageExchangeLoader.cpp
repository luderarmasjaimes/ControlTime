#include "ImageExchangeLoader.hpp"
#include <iostream>

ClImageExchangeLoader::ClImageExchangeLoader()
{
	m_hDll = OpenLibrary(DERMALOG_DIE_LIBNAME);
	GetFunction(m_hDll, "DIEGetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "DIEInitialize", Initialize);
	GetFunction(m_hDll, "DIEUninitialize", Uninitialize);
	GetFunction(m_hDll, "DIEGetVersionA", GetVersionA);
	GetFunction(m_hDll, "DIECreateImage", CreateImage);
	GetFunction(m_hDll, "DIELoadImageFromBuffer", LoadImageFromBuffer);
	GetFunction(m_hDll, "DIELoadImageFromFile", LoadImageFromFile);
	GetFunction(m_hDll, "DIELoadImageFromRawData", LoadImageFromRawData);
	GetFunction(m_hDll, "DIEGetBuffer", GetBuffer);
	GetFunction(m_hDll, "DIEGetBufferWithSpecifiedEncoding", GetBufferWithSpecifiedEncoding);
	GetFunction(m_hDll, "DIEGetImageRawData", GetImageRawData);
	GetFunction(m_hDll, "DIEDestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "DIESetPropertyA", SetPropertyA);
	GetFunction(m_hDll, "DIEGetPropertyA", GetPropertyA);
	GetFunction(m_hDll, "DIESetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "DIEGetPropertyLongA", GetPropertyLongA);
	GetFunction(m_hDll, "DIESetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "DIEGetPropertyDoubleA", GetPropertyDoubleA);
	GetFunction(m_hDll, "DIESaveImageToFile", SaveImageToFile);
	GetFunction(m_hDll, "DIECloneImage", CloneImage);
	GetFunction(m_hDll, "DIECorrectImageOrientation", CorrectImageOrientation);
	GetFunction(m_hDll, "DIEGetLastErrorMessageA", GetLastErrorMessageA);
}



ClImageExchangeLoader::~ClImageExchangeLoader()
{
	CloseLibrary(m_hDll);
}

void ClImageExchangeLoader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA << std::endl;
		return;
	}
}
