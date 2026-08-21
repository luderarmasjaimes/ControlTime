#include "FaceLiveness2Loader.hpp"
#include <iostream>

ClFaceLiveness2Loader::ClFaceLiveness2Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FL2_LIBNAME);
	GetFunction(m_hDll, "FL2Initialize", Initialize);
	GetFunction(m_hDll, "FL2Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FL2GetVersionA", GetVersionA);
	GetFunction(m_hDll, "FL2CreateLivenessDetector", CreateLivenessDetector);
	GetFunction(m_hDll, "FL2Update", Update);
	GetFunction(m_hDll, "FL2Reset", Reset);
	GetFunction(m_hDll, "FL2RegisterCallbackUpdate", RegisterCallbackUpdate);
	GetFunction(m_hDll, "FL2RegisterCallbackLivenessScoreReady", RegisterCallbackLivenessScoreReady);
	GetFunction(m_hDll, "FL2RegisterCallbackStatusChange", RegisterCallbackStatusChange);
	GetFunction(m_hDll, "FL2RegisterCallbackLivenessError", RegisterCallbackLivenessError);
	GetFunction(m_hDll, "FL2SetImage", SetImage);
	GetFunction(m_hDll, "FL2GetLivenessScore", GetLivenessScore);
	GetFunction(m_hDll, "FL2DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FL2SetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "FL2GetPropertyLongA", GetPropertyLongA);
	GetFunction(m_hDll, "FL2GetPropertyDoubleA", GetPropertyDoubleA);
	GetFunction(m_hDll, "FL2SetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "FL2SetLicense", SetLicense);
	GetFunction(m_hDll, "FL2GetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "FL2GetLastErrorMessageA", GetLastErrorMessageA);
}

ClFaceLiveness2Loader::~ClFaceLiveness2Loader()
{
	CloseLibrary(m_hDll);
}

void ClFaceLiveness2Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA() << std::endl;
		return;
	}
}
