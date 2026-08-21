#include "FaceTracking2Loader.hpp"
#include <iostream>

ClFaceTracking2Loader::ClFaceTracking2Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FT2_LIBNAME);
	GetFunction(m_hDll, "FT2GetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "FT2Initialize", Initialize);
	GetFunction(m_hDll, "FT2Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FT2CreateTrackerHandle", CreateTrackerHandle);
	GetFunction(m_hDll, "FT2Update", Update);
	GetFunction(m_hDll, "FT2RegisterCallback", RegisterCallback);
	GetFunction(m_hDll, "FT2Reset", Reset);
	GetFunction(m_hDll, "FT2DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FT2SetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "FT2SetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "FT2GetLastErrorMessageA", GetLastErrorMessageA);
}


ClFaceTracking2Loader::~ClFaceTracking2Loader()
{
	CloseLibrary(m_hDll);
}

void ClFaceTracking2Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA() << std::endl;
		return;
	}
}
