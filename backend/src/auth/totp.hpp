// --------------------------------------------------------------------------
// totp.hpp — TOTP (RFC 6238) sobre HOTP (RFC 4226), HMAC-SHA1, 6 dígitos.
// --------------------------------------------------------------------------
// MFA para cuentas (ADR-135). HMAC-SHA1/30s/6-dígitos es el estándar de facto
// que TODO authenticator app (Google Authenticator, Authy, Microsoft
// Authenticator, 1Password, Bitwarden...) soporta -- variantes con SHA256/
// SHA512 o más dígitos existen en el RFC pero no son universalmente
// soportadas por esas apps, así que usarlas rompería la interoperabilidad
// que es todo el punto de MFA estándar en vez de un esquema propio.
#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace auth::totp {

/**
 * @brief Genera un secreto aleatorio criptográficamente seguro, codificado en
 *        Base32 (RFC 4648, sin relleno) -- el formato que todo authenticator
 *        app espera para el ingreso manual o el QR (`otpauth://...?secret=`).
 * @param numBytes Longitud del secreto crudo antes de codificar (160 bits/20
 *        bytes es el tamaño recomendado por RFC 4226 §4, el mismo que usan
 *        Google Authenticator/Authy por defecto).
 */
std::string generateBase32Secret(std::size_t numBytes = 20);

/**
 * @brief Verifica un código de 6 dígitos contra un secreto Base32, tolerando
 *        desfase de reloj de ±`toleranceSteps` ventanas de 30s (por defecto
 *        1 -- ±30s, suficiente para relojes de celular no perfectamente
 *        sincronizados sin abrir una ventana de repetición demasiado amplia).
 * @param base32Secret Secreto tal como se guardó en `auth_users.totp_secret`.
 * @param code Código ingresado por el usuario (se acepta con o sin espacios).
 * @return true si el código coincide con alguna ventana dentro de la tolerancia.
 */
bool verifyCode(const std::string &base32Secret, const std::string &code,
                int toleranceSteps = 1);

/**
 * @brief Construye la URI `otpauth://totp/...` estándar para que el usuario
 *        la ingrese manualmente en su authenticator app (o se codifique como
 *        QR en el frontend). Formato: RFC de facto de Google Authenticator,
 *        el mismo que usan todas las apps compatibles.
 * @param base32Secret Secreto ya generado.
 * @param accountLabel Identifica la cuenta en el authenticator (ej.
 *        "usuario@Minera Raura").
 * @param issuer Nombre de la plataforma mostrado junto al label (ej. "Beemetry").
 */
std::string buildOtpAuthUri(const std::string &base32Secret,
                            const std::string &accountLabel,
                            const std::string &issuer = "Beemetry");

}  // namespace auth::totp
