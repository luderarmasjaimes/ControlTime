#include <cstring>
#include <iostream>
#include <sstream>
#include <fstream>
#include <vector>
#include <chrono>

#include <DermalogImageExchange.h>
#include <DermalogFaceDetection2.h>
#include <DermalogFaceRecognition3.h>

#include <ImageExchangeLoader.hpp>
#include <FaceDetection2Loader.hpp>
#include <FaceRecognition3Loader.hpp>
#include <cstdlib>

#if defined(_WIN32)
typedef  const char* (__stdcall *GetLastErrorFunction)();
#else
typedef const char*(*GetLastErrorFunction)();
#endif

void CheckError(DrmErrorCode_t nErrorCode, GetLastErrorFunction GetLastErrorMessage) {
	if (nErrorCode != FPC_SUCCESS) {
		if (nErrorCode == FPC_ERROR_NO_LICENCE) {
			std::cerr << "\nFaceRecognition_CPP_Tutorial: License is missing! \n";
			std::cout << "\nFaceRecognition_CPP_Tutorial: License is missing! \n" << std::endl;
		}
		std::cerr << GetLastErrorMessage() << std::endl;
		exit(EXIT_FAILURE);
	}
}

static void ShowUsage(std::string sProgramName)
{
	std::cerr << "Usage: " << sProgramName.c_str() << " [image_path_1] [image_path_2] [options]\n"
		<< "Options:\n"
		<< "\t-h\tShow this help message\n"
		<< "\t-fs\tMininum face size: [0, 1] relative to larger image dimension; default=0.1\n"
		<< "\t-st\tSave templates: 0=Don't save; 1=Save; default=0\n"
		<< std::endl;
}

// entry point for DermalogFaceRecognition2NativeTutorial
int main(int argc, char* argv[])
{
	// Checking the arguments
	if (argc < 3)
	{
		ShowUsage(argv[0]);
		exit(EXIT_FAILURE);
	}

	double dMinFaceSize = 0.1;
	bool bSaveTemplates = false;


	std::ifstream sImageFile1(argv[1]);
	if (!sImageFile1)
	{
		std::cerr << "The first file doesn't exist" << std::endl;
		exit(EXIT_FAILURE);
	}

	std::ifstream sImageFile2(argv[2]);
	if (!sImageFile2)
	{
		std::cerr << "The second file doesn't exist" << std::endl;
		exit(EXIT_FAILURE);
	}

	std::vector<std::string> vImagePaths { argv[1], argv[2] };

	for (int i = 3; i < argc; i++)
	{
		if (i + 1 < argc)
		{
			if (strcmp(argv[i], "-fs") == 0)
			{
				std::istringstream ss(argv[i + 1]);
				ss >> dMinFaceSize;
				if (dMinFaceSize < 0 || dMinFaceSize > 1)
				{
					std::cerr << "Invalid number " << argv[i + 1] << std::endl;
					exit(EXIT_FAILURE);
				}
			}
			else if (strcmp(argv[i], "-st") == 0)
			{
				std::istringstream ss(argv[i + 1]);
				ss >> bSaveTemplates;
				if (bSaveTemplates != false && bSaveTemplates != true)
				{
					std::cerr << "Not a boolean " << argv[i + 1] << std::endl;
					exit(EXIT_FAILURE);
				}
			}
			else if (strcmp(argv[i], "-h") == 0)
			{
				ShowUsage(argv[0]);
				exit(EXIT_FAILURE);
			}
		}
	}


	//load SDK functions
	ClImageExchangeLoader oExchangeSDK;
	ClFaceDetection2Loader oDetectionSDK;
	ClFaceRecognition3Loader oRecognitionSDK;

	//initialize face detection and image exchange
	DrmErrorCode_t nError = oExchangeSDK.Initialize(NULL);
	CheckError(nError, oExchangeSDK.GetLastErrorMessageA);
	if (nError != FPC_SUCCESS)
	{
		std::cerr << "The DermalogImageExchange.dll could not be loaded" << std::endl;
		exit(EXIT_FAILURE);
	}
	nError = oDetectionSDK.Initialize(NULL);
	CheckError(nError, oDetectionSDK.GetLastErrorMessageA);
	if (nError != FPC_SUCCESS)
	{
		std::cerr << "The DermalogFaceDetection2.dll could not be loaded" << std::endl;
		exit(EXIT_FAILURE);
	}
	nError = oRecognitionSDK.Initialize(NULL);
	CheckError(nError, oRecognitionSDK.GetLastErrorMessageA);
	if (nError != FPC_SUCCESS)
	{
		std::cerr << "The DermalogFaceRecognition3.dll could not be loaded" << std::endl;
		exit(EXIT_FAILURE);
	}


	char* szVersion = NULL;
	size_t nSize = 0;
	nError = oDetectionSDK.GetVersionA(szVersion, &nSize);
	if (nError == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nError = oDetectionSDK.GetVersionA(szVersion, &nSize);
	}
	std::cout << "\nFaceRecognition3CPPTutorial\n";
	std::cout << "DermalogFaceDetection2 v" << szVersion << "\n";
	delete[] szVersion;
	nSize = 0;
	nError = oExchangeSDK.GetVersionA(szVersion, &nSize);
	if (nError == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nError = oExchangeSDK.GetVersionA(szVersion, &nSize);
	}
	std::cout << "DermalogImageExchange v" << szVersion << "\n";
	delete[] szVersion;
	nSize = 0;
	nError = oRecognitionSDK.GetVersionA(szVersion, &nSize);
	if (nError == FPC_ERROR_TEMPLATE_SIZE)
	{
		szVersion = new char[nSize];
		nError = oRecognitionSDK.GetVersionA(szVersion, &nSize);
	}
	std::cout << "DermalogFaceRecognition3 v" << szVersion << "\n";
	delete[] szVersion;

	FD2HandleFaceDetector_t hDetector;
	CheckError(oDetectionSDK.CreateFaceDetector(&hDetector), oDetectionSDK.GetLastErrorMessageA);
	FR3FaceEncoderHandle_t hEncoder;
	CheckError(oRecognitionSDK.CreateFaceEncoderHandle(&hEncoder), oRecognitionSDK.GetLastErrorMessageA);
	FR3FaceMatcherHandle_t hMatcher;
	CheckError(oRecognitionSDK.CreateFaceMatcherHandle(&hMatcher), oRecognitionSDK.GetLastErrorMessageA);

	//set min face size
	CheckError(oDetectionSDK.SetPropertyDoubleA(hDetector, FD2_PR_MIN_FACE_WIDTH, dMinFaceSize), oDetectionSDK.GetLastErrorMessageA);

	//Create necessary handles
	DIEHandleImage_t hImage1 = nullptr;
	DIEHandleImage_t hImage2 = nullptr;
	std::vector<DIEHandleImage_t> vImages { hImage1, hImage2 };
	std::vector<FR3FaceTemplateHandle_t> vTemplates;
	std::vector<std::string> vTemplateFileNames { "Template1.dat", "Template2.dat"};
	for (size_t i = 0; i < vImages.size(); i++)
	{
		CheckError(oExchangeSDK.CreateImage(&vImages[i]), oExchangeSDK.GetLastErrorMessageA);
		DrmErrorCode_t nError = oExchangeSDK.LoadImageFromFile(vImages[i], vImagePaths[i].c_str());
		if (nError == FPC_SUCCESS)
		{
			// Find all faces in each image
			uint16_t nNumberOfFaces = 0;
			DrmErrorCode_t nError1 = oDetectionSDK.FindFaceBoundingBoxes(hDetector, vImages[i], &nNumberOfFaces);
			if (nError1 == FPC_SUCCESS && nNumberOfFaces > 0)
			{
				// get the largest (=first) face
				DDEBoundingBox stBoundingBox;
				DrmErrorCode_t nReturnCode = oDetectionSDK.GetFaces(hDetector, &stBoundingBox, 1);
				CheckError(nReturnCode, oDetectionSDK.GetLastErrorMessageA);

				//Fine the landmarks for the face
				uint16_t nNumberOfKeyPoints = 0;
				nReturnCode = oDetectionSDK.FindKeyPoints(hDetector, vImages[i], stBoundingBox, &nNumberOfKeyPoints);
				CheckError(nReturnCode, oDetectionSDK.GetLastErrorMessageA);
				DDEKeyPoint_t* stKeypoints = new DDEKeyPoint[nNumberOfKeyPoints];
				nReturnCode = oDetectionSDK.GetKeyPoints(hDetector, stKeypoints);
				CheckError(nReturnCode, oDetectionSDK.GetLastErrorMessageA);

				//Encode the face (create a face template)
				FR3FaceTemplateHandle_t hTemplate;
				CheckError(oRecognitionSDK.CreateFaceTemplateHandle(&hTemplate), oRecognitionSDK.GetLastErrorMessageA);
				auto start = std::chrono::system_clock::now();
				CheckError(oRecognitionSDK.EncodeFace(hEncoder, vImages[i], stKeypoints, hTemplate), oRecognitionSDK.GetLastErrorMessageA);
				auto end = std::chrono::system_clock::now();
				auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
				std::cout << "Coding time: " << elapsed.count() << "ms" << std::endl;
				if (bSaveTemplates)
				{
					CheckError(oRecognitionSDK.SaveFaceTemplateToFile(hTemplate, vTemplateFileNames[i].c_str()), oRecognitionSDK.GetLastErrorMessageA);
				}
				vTemplates.push_back(hTemplate);

				delete[] stKeypoints;
			}
			else
			{
				std::cout << "No face found in " << vImagePaths[i] << std::endl;
				exit(EXIT_FAILURE);
			}
		}
		else
		{
			std::cout << "The following image could not be loaded: " << vImagePaths[i] << std::endl;
		}
		CheckError(oExchangeSDK.DestroyHandle(&vImages[i]), oExchangeSDK.GetLastErrorMessageA);
	}
	if (vTemplates.size() == 2)
	{
		float fScore = -1;
		CheckError(oRecognitionSDK.VerifyTemplates(hMatcher, vTemplates[0], vTemplates[1], &fScore), oRecognitionSDK.GetLastErrorMessageA);
		std::cout << "Verification score: " << fScore << std::endl;

		// Convert Score to LFAR score
		float fConvertedScore = -1;
		CheckError(oRecognitionSDK.ConvertScore(hMatcher, fScore, FR3_NATIVE, FR3_LFAR, &fConvertedScore), oRecognitionSDK.GetLastErrorMessageA);
		std::cout << "Verification score LFAR: " << fConvertedScore << std::endl;
	}
	//destroy handles
	CheckError(oRecognitionSDK.DestroyHandle(&vTemplates[0]), oRecognitionSDK.GetLastErrorMessageA);
	CheckError(oRecognitionSDK.DestroyHandle(&vTemplates[1]), oRecognitionSDK.GetLastErrorMessageA);
	CheckError(oRecognitionSDK.DestroyHandle(&hEncoder), oRecognitionSDK.GetLastErrorMessageA);
	CheckError(oRecognitionSDK.DestroyHandle(&hMatcher), oRecognitionSDK.GetLastErrorMessageA);
	CheckError(oDetectionSDK.DestroyHandle(&hDetector), oDetectionSDK.GetLastErrorMessageA);
	//uninitialize
	oRecognitionSDK.Uninitialize();
	oDetectionSDK.Uninitialize();
	oExchangeSDK.Uninitialize();
	return EXIT_SUCCESS;
}
