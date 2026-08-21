#include "TutException.hpp"
#include "TutLoadLibrary.hpp"

HMODULE OpenLibrary(const char* szLib)
{
	HMODULE hLib = LoadLibraryA(szLib);
	if (!hLib) // TODO make a simple system exception
#ifdef WIN32
		throw Exception("Fail to open library \"%s\" with error 0x%08x.", szLib, GetLastError());
#else
		throw Exception("Fail to open library \"%s\" with error %s.", szLib, dlerror());
#endif //WIN32
	return hLib;
}

/* helper function to load a function from the dynamic library */
const void* GetFunction(HMODULE hLib, const char* const szFunction)
{
	const void* fpFunction = GetProcAddress(hLib, szFunction);
	if (fpFunction==NULL)
		throw Exception("Function \"%s\" in 0x%p not found.", szFunction, hLib);
	return fpFunction;
}

void CloseLibrary(HMODULE& hLib)
{
	if (hLib)
	{
		FreeLibrary(hLib);
		hLib = NULL;
	}
}

