#include "FaceExpression2Loader.hpp"
#include <iostream>

ClFaceExpression2Loader::ClFaceExpression2Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FX2_LIBNAME);
	GetFunction(m_hDll, "FX2Initialize", Initialize);
	GetFunction(m_hDll, "FX2Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FX2CreateCharacteristicEstimator", CreateCharacteristicEstimator);
	GetFunction(m_hDll, "FX2CreateCharacteristicEstimatorWithInferencePlatform", CreateCharacteristicEstimatorWithInferencePlatform);
	GetFunction(m_hDll, "FX2EstimateAge", EstimateAge);
	GetFunction(m_hDll, "FX2EstimateGender", EstimateGender);
	GetFunction(m_hDll, "FX2EstimateSmile", EstimateSmile);
	GetFunction(m_hDll, "FX2CreateEmotionDetector", CreateEmotionDetector);
	GetFunction(m_hDll, "FX2CreateEmotionDetectorWithInferencePlatform", CreateEmotionDetectorWithInferencePlatform);
	GetFunction(m_hDll, "FX2DetectEmotion", DetectEmotion);
	GetFunction(m_hDll, "FX2CreateProtectiveMaskDetector", CreateProtectiveMaskDetector);
	GetFunction(m_hDll, "FX2CreateProtectiveMaskDetectorWithInferencePlatform", CreateProtectiveMaskDetectorWithInferencePlatform);
	GetFunction(m_hDll, "FX2DetectProtectiveMask", DetectProtectiveMask);
	GetFunction(m_hDll, "FX2SetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "FX2GetPropertyDoubleA", GetPropertyDoubleA);
	GetFunction(m_hDll, "FX2DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FX2GetVersionA", GetVersionA);
	GetFunction(m_hDll, "FX2SetContext", SetContext);
	GetFunction(m_hDll, "FX2SetLicense", SetLicense);
	GetFunction(m_hDll, "FX2GetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "FX2GetLastErrorMessageA", GetLastErrorMessageA);
}

ClFaceExpression2Loader::~ClFaceExpression2Loader()
{
	CloseLibrary(m_hDll);
}

void ClFaceExpression2Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA() << std::endl;
		return;
	}
}
