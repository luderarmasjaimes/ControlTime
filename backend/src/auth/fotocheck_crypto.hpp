#pragma once

#include <boost/json.hpp>

#include <optional>
#include <string>

namespace json = boost::json;

namespace auth {
namespace fotocheck {

/** @brief Cifra `payload` con AES-256-GCM usando la clave del servidor
 * (`AppConfig::gFotocheckQrKeyRaw`, 32 bytes, nunca sale del backend). El
 * resultado (base64 de `nonce(12) || ciphertext || tag(16)`) es justamente
 * lo que se codifica en el QR del fotocheck -- un lector de QR genérico solo
 * ve ese string, ilegible sin la clave. Pensado ÚNICAMENTE para precargar
 * campos de formulario al escanearse de vuelta (ver `decryptFotocheckPayload`),
 * nunca para autenticar por sí solo.
 * @return Cadena vacía si la clave del servidor no está configurada. */
std::string encryptFotocheckPayload(const json::object &payload);

/** @brief Descifra un string generado por `encryptFotocheckPayload`. Falla
 * (retorna `std::nullopt`) si el formato es inválido, el tag de
 * autenticación GCM no valida (dato manipulado o cifrado con otra clave), o
 * la clave del servidor no está configurada -- nunca lanza. */
std::optional<json::object> decryptFotocheckPayload(const std::string &base64Ciphertext);

}  // namespace fotocheck
}  // namespace auth
