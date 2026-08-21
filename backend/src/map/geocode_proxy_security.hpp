#pragma once
#include <string>

namespace map_mod {

/** @brief Sanea el texto libre de búsqueda de dirección antes de reenviarlo a
 *  Nominatim: recorta espacios, exige 2..200 caracteres, rechaza CR/LF (evita
 *  que texto de usuario contamine la línea de request saliente). */
bool sanitizeGeocodeQuery(const std::string &raw, std::string &out, std::string &error);

constexpr int kDefaultGeocodeResults = 5;
constexpr int kMaxGeocodeResults = 5;

/** @brief Clampa `limit` del cliente a [1, kMaxGeocodeResults], default kDefaultGeocodeResults. */
int clampGeocodeLimit(const std::string &rawLimit);

} // namespace map_mod
