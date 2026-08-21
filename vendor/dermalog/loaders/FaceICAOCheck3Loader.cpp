#include "FaceICAOCheck3Loader.hpp"
#include <iostream>

ClICAOCheck3Loader::ClICAOCheck3Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FACE_ICAOCHECK3_LIBNAME);
	GetFunction(m_hDll, "FIC3GetErrorDescriptionA", GetErrorDescriptionA);

	GetFunction(m_hDll, "FIC3Initialize", Initialize);
	GetFunction(m_hDll, "FIC3Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FIC3GetVersionA", GetVersionA);
	GetFunction(m_hDll, "FIC3CreateCheckHandle", CreateCheckHandle);
	GetFunction(m_hDll, "FIC3CreateResultHandle", CreateResultHandle);
	GetFunction(m_hDll, "FIC3DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FIC3EnhanceImageForEngraver", EnhanceImageForEngraver);
	GetFunction(m_hDll, "FIC3CheckFace", CheckFace);
	GetFunction(m_hDll, "FIC3GetPortraitImage", GetPortraitImage);
	GetFunction(m_hDll, "FIC3GetPropertyScore", GetPropertyScore);
	GetFunction(m_hDll, "FIC3GetPropertyState", GetPropertyState);
	GetFunction(m_hDll, "FIC3WriteISODataToFile", WriteISODataToFile);
	GetFunction(m_hDll, "FIC3LoadISODataFromFile", LoadISODataFromFile);
	GetFunction(m_hDll, "FIC3ConfigurePropertyCheck", ConfigurePropertyCheck);
	GetFunction(m_hDll, "FIC3IsPropertyCheckEnabled", IsPropertyCheckEnabled);
	GetFunction(m_hDll, "FIC3ConfigurePropertyPriority", ConfigurePropertyPriority);
	GetFunction(m_hDll, "FIC3IsPropertyPrioritized", IsPropertyPrioritized);
	GetFunction(m_hDll, "FIC3SetPropertyA", SetPropertyA);
	GetFunction(m_hDll, "FIC3SetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "FIC3SetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "FIC3GetPropertyA", GetPropertyA);
	GetFunction(m_hDll, "FIC3GetPropertyLongA", GetPropertyLongA);
	GetFunction(m_hDll, "FIC3GetPropertyDoubleA", GetPropertyDoubleA);

	GetFunction(m_hDll, "FIC3GetLastErrorMessageA", GetLastErrorMessageA);
}


ClICAOCheck3Loader::~ClICAOCheck3Loader()
{
	CloseLibrary(m_hDll);
}

void ClICAOCheck3Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		const char* pErrorDescription = GetErrorDescriptionA(nErrorCode);
		std::cerr << pErrorDescription << std::endl;
		return;
	}
}
