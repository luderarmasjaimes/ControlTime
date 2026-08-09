#pragma once

#include <boost/json.hpp>
#include <string>

namespace json = boost::json;

namespace mining {

/**
 * @brief Cliente HTTPS al servicio público del IGP (Instituto Geofísico del
 * Perú) / CENSIS — la fuente gubernamental oficial de sismicidad en Perú
 * (no INDECI/Defensa Civil, que solo coordinan respuesta a emergencias).
 * API real, sin autenticación, confirmada en vivo en
 * https://ultimosismo.igp.gob.pe/ultimo-sismo (DevTools):
 *   GET /api/ultimo-sismo                -> último sismo (objeto único)
 *   GET /api/ultimo-sismo/ajaxb/{anio}    -> lista de sismos del año
 *
 * No existía ningún cliente HTTPS de salida en el backend (solo TLS de
 * servidor para dispositivos IoT, ver mining_gateway.cpp) — este es el
 * primer uso de asio::ssl::stream en modo cliente. OpenSSL ya está enlazado
 * (hashing de contraseñas / TLS de servidor), no se agrega dependencia nueva.
 */

/** @brief GET {base}/api/ultimo-sismo/ajaxb/{year}. Devuelve json::array (vacío si falla/no responde). */
json::array fetchIgpYearEvents(int year);

/** @brief GET {base}/api/ultimo-sismo. Devuelve el objeto del último sismo, o std::nullopt si falla. */
json::value fetchIgpLatestEvent();

} // namespace mining
