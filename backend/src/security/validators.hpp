// --------------------------------------------------------------------------
// validators.hpp — Validadores de entrada reutilizables (header-only)
// --------------------------------------------------------------------------
// Centraliza la validación de datos que entran desde la red o el usuario antes
// de tocar la BD o el sistema de archivos. Complementa (no reemplaza) el
// escapado SQL: validar formato temprano da errores claros y reduce superficie
// de ataque (inyección, valores NaN/Inf, paths con metacaracteres de shell).
//
// Todas las funciones son puras, sin estado y `noexcept` salvo las que parsean
// JSON. Pensadas para usarse en el borde (route handlers) antes de la lógica.
// --------------------------------------------------------------------------
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>

#include "../config/constants.hpp"

namespace security {

/// @brief Colección de validadores estáticos de entrada.
class Validator {
public:
  /**
   * @brief Valida un nombre de usuario.
   *
   * Longitud en [kUsernameMinLength, kUsernameMaxLength] y solo caracteres
   * alfanuméricos, punto, guion, guion bajo o arroba (para logins tipo email).
   *
   * @param u Nombre de usuario candidato.
   * @return true si cumple el formato, false en caso contrario.
   */
  static bool isValidUsername(const std::string& u) noexcept {
    if (u.length() < config::auth::kUsernameMinLength ||
        u.length() > config::auth::kUsernameMaxLength) {
      return false;
    }
    return std::all_of(u.begin(), u.end(), [](unsigned char c) {
      return std::isalnum(c) || c == '_' || c == '.' || c == '-' || c == '@';
    });
  }

  /**
   * @brief Valida longitud mínima de contraseña.
   * @param pwd Contraseña en claro (previo al hash).
   * @return true si alcanza la longitud mínima.
   */
  static bool isValidPassword(const std::string& pwd) noexcept {
    return pwd.length() >= config::auth::kPasswordMinLength;
  }

  /**
   * @brief Valida un email de forma pragmática (una sola '@', con texto a
   *        ambos lados y al menos un punto en el dominio).
   * @param email Cadena candidata.
   * @return true si tiene forma de email plausible.
   */
  static bool isValidEmail(const std::string& email) noexcept {
    const auto at = email.find('@');
    if (at == std::string::npos || at == 0 || at + 1 >= email.size()) {
      return false;
    }
    if (email.find('@', at + 1) != std::string::npos) return false;  // doble @
    const auto dot = email.find('.', at);
    return dot != std::string::npos && dot + 1 < email.size();
  }

  /**
   * @brief Valida un campo de nombre libre (first_name, last_name, company de
   *        registro): longitud acotada y sin los caracteres que habilitan
   *        inyección HTML/script (`<`, `>`) ni control chars.
   *
   * Hallazgo de un ejercicio de red-team real (2026-08-26): la API aceptaba
   * `<img src=x onerror=...>` / `"><script>...` sin ningún rechazo en estos
   * campos. El panel de administración (React) los escapa al renderizar, así
   * que no había XSS explotable hoy -- pero validar en el borde es defensa en
   * profundidad barata ante cualquier futura vista que renderice estos campos
   * sin ese mismo cuidado (export a PDF/CSV, un nuevo panel, etc.), y evita
   * que nombres con marcado HTML lleguen a quedar guardados en la BD/auditoría.
   * No se prohíbe `'`/acentos: son parte normal de nombres reales (O'Higgins,
   * Muñoz, José María).
   *
   * @param s Cadena candidata.
   * @param maxLen Longitud máxima permitida (ver config::auth::kDisplayNameMaxLength).
   * @return true si no está vacía, no excede maxLen y no contiene '<', '>' ni
   *         caracteres de control.
   */
  static bool isValidDisplayName(
      const std::string& s,
      std::size_t maxLen = config::auth::kDisplayNameMaxLength) noexcept {
    if (s.empty() || s.size() > maxLen) return false;
    return std::none_of(s.begin(), s.end(), [](unsigned char c) {
      return c == '<' || c == '>' || (c < 0x20 && c != '\t');
    });
  }

  /**
   * @brief Valida un DNI peruano: exactamente 8 dígitos.
   * @param dni Cadena candidata.
   * @return true si son 8 dígitos.
   */
  static bool isValidDni(const std::string& dni) noexcept {
    return dni.size() == 8 &&
           std::all_of(dni.begin(), dni.end(),
                       [](unsigned char c) { return std::isdigit(c) != 0; });
  }

  /**
   * @brief Valida que un valor numérico de sensor sea finito (no NaN/Inf).
   * @param value Lectura de sensor.
   * @return true si es un número finito representable.
   */
  static bool isValidSensorValue(double value) noexcept {
    return std::isfinite(value);
  }

  /**
   * @brief Valida una coordenada de latitud [-90, 90].
   */
  static bool isValidLatitude(double lat) noexcept {
    return std::isfinite(lat) && lat >= -90.0 && lat <= 90.0;
  }

  /**
   * @brief Valida una coordenada de longitud [-180, 180].
   */
  static bool isValidLongitude(double lng) noexcept {
    return std::isfinite(lng) && lng >= -180.0 && lng <= 180.0;
  }

  /**
   * @brief Verifica que una cadena sea segura para usarse como componente de
   *        path o argumento de proceso: sin metacaracteres de shell ni
   *        secuencias de salto de directorio.
   *
   * No sustituye a spawn sin shell, pero es una defensa en profundidad para
   * nombres derivados de entrada.
   *
   * @param s Cadena candidata (nombre de archivo, tag, etc.).
   * @return true si no contiene caracteres peligrosos.
   */
  static bool isShellSafe(const std::string& s) noexcept {
    if (s.empty()) return false;
    if (s.find("..") != std::string::npos) return false;
    static constexpr char kDangerous[] = "\"'`$;|&<>()\\\n\r*?~";
    for (const char c : s) {
      if (static_cast<unsigned char>(c) < 0x20) return false;  // control chars
      for (const char d : kDangerous) {
        if (d != '\0' && c == d) return false;
      }
    }
    return true;
  }

  /**
   * @brief Quoting robusto de un argumento para pasarlo a un shell sin abrir
   *        vector de inyección de comandos.
   *
   * POSIX: comillas simples + escape de comilla simple embebida ('\'') → el
   * shell trata TODO el contenido como literal (neutraliza $, `, \, ;, |,
   * espacios, etc). Windows (cmd): comillas dobles (las rutas provienen de
   * temp/config sin metacaracteres).
   *
   * @param s Argumento a citar (ruta, modo, etc.).
   * @return Cadena citada lista para concatenar en una línea de comando.
   */
  static std::string shellQuote(const std::string& s) {
#ifdef _WIN32
    return "\"" + s + "\"";
#else
    std::string out;
    out.reserve(s.size() + 2);
    out.push_back('\'');
    for (const char c : s) {
      if (c == '\'') {
        out += "'\\''";  // cierra comilla, escapa ', reabre
      } else {
        out.push_back(c);
      }
    }
    out.push_back('\'');
    return out;
#endif
  }

  /**
   * @brief Normaliza y valida un número de página (>= 1).
   * @param page Valor solicitado.
   * @return page si es >= 1, si no el default de configuración.
   */
  static int clampPage(int page) noexcept {
    return page >= 1 ? page : config::paging::kDefaultPage;
  }

  /**
   * @brief Normaliza y valida un tamaño de página a [1, kMaxPageSize].
   * @param size Valor solicitado.
   * @return Tamaño acotado; default si <= 0.
   */
  static int clampPageSize(int size) noexcept {
    if (size <= 0) return config::paging::kDefaultPageSize;
    return size > config::paging::kMaxPageSize ? config::paging::kMaxPageSize
                                               : size;
  }
};

}  // namespace security
