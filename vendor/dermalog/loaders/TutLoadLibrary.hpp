#ifndef _LOADLIBRARY_HPP_
#define _LOADLIBRARY_HPP_

/* defines for system independence */
#if defined(WIN32)
#include <windows.h>
#else /*for Non-Windows OS*/
#include <dlfcn.h>
#define FreeLibrary dlclose /* for linux: compatibility with windows.h functions */
#define HMODULE void* /* for linux: compatibility with windows.h functions */
#define GetProcAddress ::dlsym /* for linux: compatibility with windows.h functions */
#define LoadLibraryA(szlib) dlopen(szlib, RTLD_LAZY) /* for linux: compatibility with windows.h functions */
#endif

HMODULE OpenLibrary(const char* szLib);
const void* GetFunction(HMODULE hLib, const char* const szFunction);
void CloseLibrary(HMODULE& hLib);

template<typename TFUNC>
inline void GetFunction(HMODULE hLib, const char* const szFunction, TFUNC& fp )
{
	fp = (TFUNC)GetFunction(hLib, szFunction);
}

#endif // _LOADLIBRARY_HPP_

