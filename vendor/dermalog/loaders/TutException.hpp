#ifndef _EXCEPTION_HPP_
#define _EXCEPTION_HPP_

#include <exception>
#include <stdio.h>
#include <stdarg.h>

class Exception : public std::exception
{
	public:
		Exception(const char* const szFmt, ...)
		{
			va_list argptr;
			va_start(argptr, szFmt);
			vsnprintf(szbuffer, 1023, szFmt, argptr);
			szbuffer[1023] = 0;
			va_end(argptr);
		}
	
		virtual const char *what( ) const throw(){ return szbuffer; };
	protected:
		char szbuffer[1024];
};

#endif // _EXCEPTION_HPP_
