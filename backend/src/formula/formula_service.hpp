#pragma once

#include <string>

#if __has_include(<libpq-fe.h>)
#define HAS_LIBPQ 1
#include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#define HAS_LIBPQ 1
#include <postgresql/libpq-fe.h>
#else
#define HAS_LIBPQ 0
#endif

namespace formula {

#if HAS_LIBPQ
bool ensureFormulaCatalogViewPg(PGconn *conn);

bool ensureFormulaSchemaPg(PGconn *conn, const std::string &companyName);
#endif

} // namespace formula
