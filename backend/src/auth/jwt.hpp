#pragma once

// --------------------------------------------------------------------------
// jwt.hpp — JWT de acceso (HS256) de vida corta para el esquema híbrido de
// autenticación (ADR-029 revisado).
//
// Diseño deliberadamente mínimo: solo lo que este backend necesita (firma
// HMAC-SHA256 + verificación + claims planas). No es una librería JWT de
// propósito general — no soporta otros algoritmos, ni JWK, ni anidamiento.
// El secreto (`JWT_SECRET`) se comparte solo dentro de la red interna de
// Docker; ningún sidecar externo lo expone.
// --------------------------------------------------------------------------

#include <chrono>
#include <optional>
#include <string>

namespace auth::jwt {

struct JwtClaims {
  std::string sub;        // user id
  std::string username;
  std::string company;
  std::string role;
  std::string tenantId;
  std::string jti;        // id único del token (para revocación puntual)
  std::chrono::system_clock::time_point issuedAt;
  std::chrono::system_clock::time_point expiresAt;
};

/** @brief Firma `claims` como JWT compacto (header.payload.signature) con HS256 y `secret`. */
std::string sign(const JwtClaims &claims, const std::string &secret);

/**
 * @brief Verifica firma + expiración de un JWT compacto.
 * @return Los claims decodificados si la firma es válida (comparación en tiempo
 * constante) y `exp` no pasó; `std::nullopt` en cualquier otro caso (formato
 * inválido, algoritmo inesperado, firma incorrecta, o expirado).
 */
std::optional<JwtClaims> verify(const std::string &token, const std::string &secret);

/** @brief HMAC-SHA256 de `data` con `key`, vía OpenSSL EVP_MAC (API no deprecada en OpenSSL 3.x). */
std::string hmacSha256(const std::string &key, const std::string &data);

/** @brief SHA-256 hex de `data` (uso: hashear refresh tokens antes de persistirlos). */
std::string sha256Hex(const std::string &data);

std::string base64UrlEncode(const std::string &raw);
std::optional<std::string> base64UrlDecode(const std::string &encoded);

} // namespace auth::jwt
