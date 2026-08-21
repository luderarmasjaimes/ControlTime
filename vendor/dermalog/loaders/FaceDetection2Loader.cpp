#include "FaceDetection2Loader.hpp"
#include <iostream>

ClFaceDetection2Loader::ClFaceDetection2Loader()
{
	m_hDll = OpenLibrary(DERMALOG_FD2_LIBNAME);

	GetFunction(m_hDll, "FD2Initialize", Initialize);
	GetFunction(m_hDll, "FD2Uninitialize", Uninitialize);
	GetFunction(m_hDll, "FD2GetVersionA", GetVersionA);
	GetFunction(m_hDll, "FD2CreateFaceDetector", CreateFaceDetector);
	GetFunction(m_hDll, "FD2CreateFaceDetectorWithInferencePlatform", CreateFaceDetectorWithInferencePlatform);
	GetFunction(m_hDll, "FD2DestroyHandle", DestroyHandle);
	GetFunction(m_hDll, "FD2FindFaceBoundingBoxes", FindFaceBoundingBoxes);
	GetFunction(m_hDll, "FD2FindFaceBoundingBoxesWithMinSize", FindFaceBoundingBoxesWithMinSize);
	GetFunction(m_hDll, "FD2GetFaces", GetFaces);
	GetFunction(m_hDll, "FD2FindKeyPoints", FindKeyPoints);
	GetFunction(m_hDll, "FD2GetKeyPoints", GetKeyPoints);
	GetFunction(m_hDll, "FD2GetPortraitImage", GetPortraitImage);
	GetFunction(m_hDll, "FD2FindFacePose", FindFacePose);
	GetFunction(m_hDll, "FD2CheckFaceQuality", CheckFaceQuality);
	//GetFunction(m_hDll, "FD2CheckVisualFaceQuality", CheckVisualFaceQuality);
	GetFunction(m_hDll, "FD2CalculateInterEyeDistance", CalculateInterEyeDistance);
	GetFunction(m_hDll, "FD2CloneDetector", CloneDetector);
	GetFunction(m_hDll, "FD2SetPropertyA", SetPropertyA);
	GetFunction(m_hDll, "FD2SetPropertyLongA", SetPropertyLongA);
	GetFunction(m_hDll, "FD2SetPropertyDoubleA", SetPropertyDoubleA);
	GetFunction(m_hDll, "FD2SetContext", SetContext);
	GetFunction(m_hDll, "FD2SetLicense", SetLicense);
	GetFunction(m_hDll, "FD2GetPropertyA", GetPropertyA);
	GetFunction(m_hDll, "FD2GetPropertyLongA", GetPropertyLongA);
	GetFunction(m_hDll, "FD2GetPropertyDoubleA", GetPropertyDoubleA);
	GetFunction(m_hDll, "FD2GetErrorDescriptionA", GetErrorDescriptionA);
	GetFunction(m_hDll, "FD2GetLastErrorMessageA", GetLastErrorMessageA);
}

ClFaceDetection2Loader::~ClFaceDetection2Loader()
{
	CloseLibrary(m_hDll);
}

void ClFaceDetection2Loader::CheckError(DrmErrorCode_t nErrorCode)
{
	if (nErrorCode != FPC_SUCCESS) {
		std::cerr << GetLastErrorMessageA() << std::endl;
		return;
	}
}
