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
/** @brief Crea (si falta) la vista `v_mineria_catalogos` usada por el motor de fórmulas. Idempotente. @return true si la vista quedó disponible. */
bool ensureFormulaCatalogViewPg(PGconn *conn);

/** @brief Garantiza que exista el esquema mínimo del motor de fórmulas (vista de catálogos + datos semilla para `companyName` si aplica). @return true si el esquema quedó listo. */
bool ensureFormulaSchemaPg(PGconn *conn, const std::string &companyName);
#endif

} // namespace formula
