#include <cstring>
#include <fstream>
#include <iostream>
#include <cstdlib>

#include <DermalogFaceDetection2.h>
#include <DermalogImageExchange.h>
#include <DermalogFaceLiveness2.h>
#include <ErrorCodes.h>

#include <ImageExchangeLoader.hpp>
#include <FaceDetection2Loader.hpp>
#include <FaceLiveness2Loader.hpp>

#if defined(_WIN32)
typedef  const char* (__stdcall *GetLastErrorFunction)();
#else
typedef const char*(*GetLastErrorFunction)();
#endif

void CheckError(DrmErrorCode_t nErrorCode, GetLastErrorFunction GetLastErrorMessage) {
	if (nErrorCode != FPC_SUCCESS) {
		if (nErrorCode == FPC_ERROR_NO_LICENCE) {
			std::cerr << "\nFaceLiveness_CPP_Tutorial: License is missing! \n";
			std::cout << "\nFaceLiveness_CPP_Tutorial: License is missing! \n" << std::endl;
		}
		std::cerr << GetLastErrorMessage() << std::endl;
		exit(EXIT_FAILURE);
	}
}

void ShowUsage(char* sProgramName)
{
	std::cerr << "Usage: " << sProgramName << " [algorithm_type] [images] [options]\n"
		<< "  algorithm_type: yaw_rotation [minimum_yaw_image] [neutral_yaw_image] [maximum_yaw_image]\n"
		<< "  algorithm_type: seamless_liveness [neutral_yaw_image]\n"
		<< "Options:\n"
		<< "\t-h\tShow this help message\n"
		<< std::endl;
}

int main(int argc, char* argv[])
{
	// Checking the arguments
	if (argc < 2)
	{
		ShowUsage(argv[0]);
		exit(EXIT_FAILURE);
	}

	for (int i = 1; i < argc; i++)
	{
		if (strcmp(argv[i], "-h") == 0)
		{
			ShowUsage(argv[0]);
			exit(EXIT_FAILURE);
		}
	}

	bool bSeamlessLiveness = (strcmp(argv[1], "seamless_liveness") == 0);
	bool bYawRotation = (strcmp(argv[1], "yaw_rotation") == 0);

	if (!bSeamlessLiveness && !bYawRotation)
	{
		std::cerr << "Unknown algorithm type: " << argv[1] << std::endl;
		ShowUsage(argv[0]);
		exit(EXIT_FAILURE);
	}

	int nRequiredImages = bSeamlessLiveness ? 1 : 3;
	if (argc < 2 + nRequiredImages)
	{
		ShowUsage(argv[0]);
		exit(EXIT_FAILURE);
	}

	for (int i = 0; i < nRequiredImages; i++)
	{
		std::ifstream sImageFile(argv[2 + i]);
		if (!sImageFile)
		{
			std::cerr << "The specified image " << argv[2 + i] << " does not exist!" << std::endl;
			exit(EXIT_FAILURE);
		}
	}

	// load SDK functions
	ClImageExchangeLoader oImageExchangeLoader;
	ClFaceDetection2Loader oFaceDetectionLoader;
	ClFaceLiveness2Loader oFaceLivenessLoader;

	DrmErrorCode_t nReturnCode;

	// initialize face and liveness detectors
	nReturnCode = oImageExchangeLoader.Initialize(NULL);
	if (nReturnCode != FPC_SUCCESS)
	{
		std::cerr << "DermalogImageExchange library could not be loaded" << std::endl;
		CheckError(nReturnCode, oImageExchangeLoader.GetLastErrorMessageA);
		exit(EXIT_FAILURE);
	}
	nReturnCode = oFaceDetectionLoader.Initialize(NULL);
	if (nReturnCode != FPC_SUCCESS)
	{
		std::cerr << "DermalogFaceDetection library could not be loaded" << std::endl;
		CheckError(nReturnCode, oFaceDetectionLoader.GetLastErrorMessageA);
		exit(EXIT_FAILURE);
	}
	nReturnCode = oFaceLivenessLoader.Initialize(NULL);
	if (nReturnCode != FPC_SUCCESS)
	{
		std::cerr << "DermalogFaceLiveness library could not be loaded" << std::endl;
		CheckError(nReturnCode, oFaceLivenessLoader.GetLastErrorMessageA);
		exit(EXIT_FAILURE);
	}

	char* szVersion = NULL;
	size_t nSize = 0;
	nReturnCode = oFaceLivenessLoader.GetVersionA(szVersion, &nSize);
	if (nReturnCode == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nReturnCode = oFaceLivenessLoader.GetVersionA(szVersion, &nSize);
	}
	std::cout << "\nFaceLivenessNativeTutorial\n";
	std::cout << "DermalogFaceLiveness v" << szVersion << "\n";
	delete[] szVersion;
	nSize = 0;
	nReturnCode = oImageExchangeLoader.GetVersionA(szVersion, &nSize);
	if (nReturnCode == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nReturnCode = oImageExchangeLoader.GetVersionA(szVersion, &nSize);
	}
	std::cout << "DermalogImageExchange v" << szVersion << "\n";
	delete[] szVersion;
	nSize = 0;
	nReturnCode = oFaceDetectionLoader.GetVersionA(szVersion, &nSize);
	if (nReturnCode == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nReturnCode = oFaceDetectionLoader.GetVersionA(szVersion, &nSize);
	}
	std::cout << "DermalogFaceDetection v" << szVersion << "\n";
	delete[] szVersion;
	// create handle to liveness detector
	FL2Handle_t hLivenessDetector;
	FL2AlgorithmType_t eAlgorithmType = bSeamlessLiveness ? FL2_ALGORITHM_SEAMLESS_LIVENESS : FL2_ALGORITHM_YAW_ROTATION;
	CheckError(oFaceLivenessLoader.CreateLivenessDetector(&hLivenessDetector, eAlgorithmType), oFaceDetectionLoader.GetLastErrorMessageA);

	// create handle to face detector
	FL2Handle_t hFaceDetector;
	CheckError(oFaceDetectionLoader.CreateFaceDetector(&hFaceDetector), oFaceDetectionLoader.GetLastErrorMessageA);

	// create image handle and load image
	DIEHandleImage_t hImageCenter;
	int nCenterImageIndex = bSeamlessLiveness ? 2 : 3;
	CheckError(oImageExchangeLoader.CreateImage(&hImageCenter), oImageExchangeLoader.GetLastErrorMessageA);
	CheckError(oImageExchangeLoader.LoadImageFromFile(hImageCenter, argv[nCenterImageIndex]), oImageExchangeLoader.GetLastErrorMessageA);

	// detect faces
	uint16_t nNumberOfFaces = 0;
	CheckError(oFaceDetectionLoader.FindFaceBoundingBoxes(hFaceDetector, hImageCenter, &nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);
	DDEBoundingBox* stBoundingBoxesCenter = new DDEBoundingBox[nNumberOfFaces];
	CheckError(oFaceDetectionLoader.GetFaces(hFaceDetector, stBoundingBoxesCenter, nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);

	// use the largest face, defined to be the first one found
	DDEBoundingBox stBBCenter = stBoundingBoxesCenter[0];

	// find face points
	uint16_t nNumberOfKeyPoints = 0;
	CheckError(oFaceDetectionLoader.FindKeyPoints(hFaceDetector, hImageCenter, stBBCenter, &nNumberOfKeyPoints), oFaceDetectionLoader.GetLastErrorMessageA);
	DDEKeyPoint_t* stKeypointsCenter = new DDEKeyPoint[nNumberOfKeyPoints];
	CheckError(oFaceDetectionLoader.GetKeyPoints(hFaceDetector, stKeypointsCenter), oFaceDetectionLoader.GetLastErrorMessageA);

	DIEHandleImage_t hImageMin, hImageMax;
	DDEBoundingBox* stBoundingBoxesMin = nullptr;
	DDEBoundingBox* stBoundingBoxesMax = nullptr;
	DDEKeyPoint_t* stKeypointsMin = nullptr;
	DDEKeyPoint_t* stKeypointsMax = nullptr;

	if (bYawRotation)
	{
		CheckError(oImageExchangeLoader.CreateImage(&hImageMin), oImageExchangeLoader.GetLastErrorMessageA);
		CheckError(oImageExchangeLoader.CreateImage(&hImageMax), oImageExchangeLoader.GetLastErrorMessageA);
		CheckError(oImageExchangeLoader.LoadImageFromFile(hImageMin, argv[2]), oImageExchangeLoader.GetLastErrorMessageA);
		CheckError(oImageExchangeLoader.LoadImageFromFile(hImageMax, argv[4]), oImageExchangeLoader.GetLastErrorMessageA);

		CheckError(oFaceDetectionLoader.FindFaceBoundingBoxes(hFaceDetector, hImageMin, &nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);
		stBoundingBoxesMin = new DDEBoundingBox[nNumberOfFaces];
		CheckError(oFaceDetectionLoader.GetFaces(hFaceDetector, stBoundingBoxesMin, nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);
		CheckError(oFaceDetectionLoader.FindFaceBoundingBoxes(hFaceDetector, hImageMax, &nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);
		stBoundingBoxesMax = new DDEBoundingBox[nNumberOfFaces];
		CheckError(oFaceDetectionLoader.GetFaces(hFaceDetector, stBoundingBoxesMax, nNumberOfFaces), oFaceDetectionLoader.GetLastErrorMessageA);

		DDEBoundingBox stBBMin = stBoundingBoxesMin[0];
		DDEBoundingBox stBBMax = stBoundingBoxesMax[0];

		CheckError(oFaceDetectionLoader.FindKeyPoints(hFaceDetector, hImageMin, stBBMin, &nNumberOfKeyPoints), oFaceDetectionLoader.GetLastErrorMessageA);
		stKeypointsMin = new DDEKeyPoint[nNumberOfKeyPoints];
		CheckError(oFaceDetectionLoader.GetKeyPoints(hFaceDetector, stKeypointsMin), oFaceDetectionLoader.GetLastErrorMessageA);

		CheckError(oFaceDetectionLoader.FindKeyPoints(hFaceDetector, hImageMax, stBBMax, &nNumberOfKeyPoints), oFaceDetectionLoader.GetLastErrorMessageA);
		stKeypointsMax = new DDEKeyPoint[nNumberOfKeyPoints];
		CheckError(oFaceDetectionLoader.GetKeyPoints(hFaceDetector, stKeypointsMax), oFaceDetectionLoader.GetLastErrorMessageA);
	}

	// calculate liveness score -1 (spoof) <= x <= 1 (genuine)
	double dFaceLivenessScore = 0;
	if (bYawRotation)
	{
		DDEBoundingBox stBBMin = stBoundingBoxesMin[0];
		DDEBoundingBox stBBMax = stBoundingBoxesMax[0];
		CheckError(oFaceLivenessLoader.SetImage(hLivenessDetector, hImageMin, stBBMin, stKeypointsMin, FL2_IMAGE_LEFT_ROTATED_FACE), oFaceLivenessLoader.GetLastErrorMessageA);
		CheckError(oFaceLivenessLoader.SetImage(hLivenessDetector, hImageCenter, stBBCenter, stKeypointsCenter, FL2_IMAGE_CENTER_FACE), oFaceLivenessLoader.GetLastErrorMessageA);
		CheckError(oFaceLivenessLoader.SetImage(hLivenessDetector, hImageMax, stBBMax, stKeypointsMax, FL2_IMAGE_RIGHT_ROTATED_FACE), oFaceLivenessLoader.GetLastErrorMessageA);
	}
	else
	{
		CheckError(oFaceLivenessLoader.SetImage(hLivenessDetector, hImageCenter, stBBCenter, stKeypointsCenter, FL2_IMAGE_CENTER_FACE), oFaceLivenessLoader.GetLastErrorMessageA);
	}
	CheckError(oFaceLivenessLoader.GetLivenessScore(hLivenessDetector, &dFaceLivenessScore), oFaceLivenessLoader.GetLastErrorMessageA);

	delete[] stKeypointsMax;
	delete[] stKeypointsCenter;
	delete[] stKeypointsMin;
	delete[] stBoundingBoxesMin;
	delete[] stBoundingBoxesMax;
	delete[] stBoundingBoxesCenter;

	// destroy handles
	CheckError(oImageExchangeLoader.DestroyHandle(&hImageCenter), oFaceLivenessLoader.GetLastErrorMessageA);
	if (bYawRotation)
	{
		CheckError(oImageExchangeLoader.DestroyHandle(&hImageMin), oFaceLivenessLoader.GetLastErrorMessageA);
		CheckError(oImageExchangeLoader.DestroyHandle(&hImageMax), oFaceLivenessLoader.GetLastErrorMessageA);
	}
	CheckError(oFaceDetectionLoader.DestroyHandle(&hFaceDetector), oFaceDetectionLoader.GetLastErrorMessageA);
	CheckError(oFaceLivenessLoader.DestroyHandle(&hLivenessDetector), oFaceLivenessLoader.GetLastErrorMessageA);

	// uninitialize face and liveness detectors
	CheckError(oFaceLivenessLoader.Uninitialize(), oFaceLivenessLoader.GetLastErrorMessageA);
	CheckError(oFaceDetectionLoader.Uninitialize(), oFaceDetectionLoader.GetLastErrorMessageA);
	CheckError(oImageExchangeLoader.Uninitialize(), oImageExchangeLoader.GetLastErrorMessageA);

	std::cout << "Liveness score for " << argv[nCenterImageIndex] << ": " << dFaceLivenessScore << std::endl;

	return 0;
}
