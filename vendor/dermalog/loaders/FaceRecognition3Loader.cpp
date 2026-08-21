#include "FaceRecognition3Loader.hpp"
#include "DermalogFaceRecognition3.h"
#include <iostream>

ClFaceRecognition3Loader::ClFaceRecognition3Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FACERECOGNITION3_LIBNAME);
	GetFunction(m_hDll, "FR3GetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "FR3Initialize", Initialize);
	GetFunction(m_hDll, "FR3Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FR3CreateFaceEncoderHandle", CreateFaceEncoderHandle);
	GetFunction(m_hDll, "FR3CreateSpecificFaceEncoderHandle", CreateSpecificFaceEncoderHandle);
	GetFunction(m_hDll, "FR3CreateSpecificFaceEncoderHandleWithInferencePlatform", CreateSpecificFaceEncoderHandleWithInferencePlatform);
	GetFunction(m_hDll, "FR3CreateFaceTemplateHandle", CreateFaceTemplateHandle);
	GetFunction(m_hDll, "FR3CreateFaceMatcherHandle", CreateFaceMatcherHandle);
	GetFunction(m_hDll, "FR3SaveFaceTemplateToFile", SaveFaceTemplateToFile);
	GetFunction(m_hDll, "FR3GetFaceTemplateData", GetFaceTemplateData);
	GetFunction(m_hDll, "FR3LoadFaceTemplateFromFile", LoadFaceTemplateFromFile);
	GetFunction(m_hDll, "FR3LoadFaceTemplateFromMemory", LoadFaceTemplateFromMemory);
	GetFunction(m_hDll, "FR3EncodeFace", EncodeFace);
	GetFunction(m_hDll, "FR3VerifyTemplates", VerifyTemplates);
	GetFunction(m_hDll, "FR3ConvertScore", ConvertScore);
	GetFunction(m_hDll, "FR3GetPropertyA", GetPropertyA);
	GetFunction(m_hDll, "FR3GetPropertyLongA", GetPropertyLongA);
	GetFunction(m_hDll, "FR3GetPropertyDoubleA", GetPropertyDoubleA);
	GetFunction(m_hDll, "FR3SetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "FR3DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FR3GetVersionA", GetVersionA);
	GetFunction(m_hDll, "FR3GetLastErrorMessageA", GetLastErrorMessageA);
}

ClFaceRecognition3Loader::~ClFaceRecognition3Loader()
{
	CloseLibrary(m_hDll);
}

void ClFaceRecognition3Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA() << std::endl;
		return;
	}
}
