#include "tax_id.hpp"

#include <algorithm>
#include <cctype>

namespace auth {

std::string normalizeTaxId(const std::string &raw) {
  std::string out;
  out.reserve(raw.size());
  for (char c : raw) {
    if (std::isdigit(static_cast<unsigned char>(c))) {
      out.push_back(c);
    }
  }
  // RUT chileno: el digito verificador final puede ser la letra K (valor 10
  // en modulo 11), no un digito -- se preserva en mayuscula si es el ultimo
  // caracter no vacio del input crudo. Nunca aparece en PE/BR/US/CA/EC (todo
  // numerico), asi que no afecta esos paises.
  auto lastAlnum = std::find_if(raw.rbegin(), raw.rend(), [](unsigned char c) {
    return std::isalnum(c) != 0;
  });
  if (lastAlnum != raw.rend() &&
      (*lastAlnum == 'k' || *lastAlnum == 'K')) {
    out.push_back('K');
  }
  return out;
}

namespace {

bool isRepeatedNumber(const std::string &value) {
  return !value.empty() &&
         std::all_of(value.begin() + 1, value.end(),
                     [&value](char c) { return c == value.front(); });
}

bool isAllDigits(const std::string &value) {
  return std::all_of(value.begin(), value.end(), [](unsigned char c) {
    return std::isdigit(c) != 0;
  });
}

bool validateCnpjBr(const std::string &ruc) {
  if (ruc.length() != 14 || !isAllDigits(ruc) || isRepeatedNumber(ruc)) {
    return false;
  }
  const auto cnpjDigit = [&ruc](int length) {
    static const int firstWeights[] = {5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2};
    static const int secondWeights[] = {6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2};
    const int *weights = length == 12 ? firstWeights : secondWeights;
    int sum = 0;
    for (int i = 0; i < length; ++i) sum += (ruc[i] - '0') * weights[i];
    const int remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return cnpjDigit(12) == (ruc[12] - '0') && cnpjDigit(13) == (ruc[13] - '0');
}

bool validateUsCa(const std::string &ruc) {
  return ruc.length() == 9 && isAllDigits(ruc) && !isRepeatedNumber(ruc);
}

bool validateRucPe(const std::string &ruc) {
  if (ruc.length() != 11 || !isAllDigits(ruc)) {
    return false;
  }
  const std::string prefix = ruc.substr(0, 2);
  if (prefix != "10" && prefix != "15" && prefix != "17" && prefix != "20") {
    return false;
  }
  static const int factor[] = {5, 4, 3, 2, 7, 6, 5, 4, 3, 2};
  int sum = 0;
  for (int i = 0; i < 10; ++i) sum += (ruc[i] - '0') * factor[i];
  int remainder = sum % 11;
  int checkDigit = 11 - remainder;
  if (checkDigit == 10) checkDigit = 0;
  if (checkDigit == 11) checkDigit = 1;
  return checkDigit == (ruc[10] - '0');
}

/**
 * RUC Ecuador (13 digitos): 2 digitos de provincia (01-24 o 30) + tercer
 * digito que selecciona la variante (0-5 persona natural, 6 entidad
 * publica, 9 sociedad privada) + digito verificador + 3 digitos de
 * establecimiento (>=001). Formulas oficiales SRI, verificadas contra
 * fuentes publicas (ver ADR-102).
 */
bool validateRucEc(const std::string &ruc) {
  if (ruc.length() != 13 || !isAllDigits(ruc)) {
    return false;
  }
  const int province = (ruc[0] - '0') * 10 + (ruc[1] - '0');
  if (!((province >= 1 && province <= 24) || province == 30)) {
    return false;
  }
  const int thirdDigit = ruc[2] - '0';
  const std::string establishment = ruc.substr(10, 3);
  if (establishment == "000") {
    return false;
  }
  if (thirdDigit >= 0 && thirdDigit <= 5) {
    // Persona natural: mismo algoritmo que la cedula (modulo 10, tipo Luhn).
    static const int factor[] = {2, 1, 2, 1, 2, 1, 2, 1, 2};
    int sum = 0;
    for (int i = 0; i < 9; ++i) {
      int product = (ruc[i] - '0') * factor[i];
      if (product > 9) product -= 9;
      sum += product;
    }
    const int checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit == (ruc[9] - '0');
  }
  if (thirdDigit == 9) {
    // Sociedad privada/extranjera: modulo 11 sobre los primeros 9 digitos.
    static const int factor[] = {4, 3, 2, 7, 6, 5, 4, 3, 2};
    int sum = 0;
    for (int i = 0; i < 9; ++i) sum += (ruc[i] - '0') * factor[i];
    const int remainder = sum % 11;
    const int checkDigit = remainder == 0 ? 0 : 11 - remainder;
    if (checkDigit > 9) return false;
    return checkDigit == (ruc[9] - '0');
  }
  if (thirdDigit == 6) {
    // Entidad publica: modulo 11 sobre los primeros 8 digitos.
    static const int factor[] = {3, 2, 7, 6, 5, 4, 3, 2};
    int sum = 0;
    for (int i = 0; i < 8; ++i) sum += (ruc[i] - '0') * factor[i];
    const int remainder = sum % 11;
    const int checkDigit = remainder == 0 ? 0 : 11 - remainder;
    if (checkDigit > 9) return false;
    return checkDigit == (ruc[8] - '0');
  }
  return false;
}

/**
 * RUT Chile: cuerpo numerico (6-8 digitos tipicamente) + digito
 * verificador final, que puede ser 'K' (valor 10). normalizeTaxId()
 * preserva esa K si es el ultimo caracter del input crudo. Algoritmo
 * modulo 11 estandar (ver ADR-102).
 */
bool validateRutCl(const std::string &rut) {
  if (rut.size() < 2) {
    return false;
  }
  const char lastChar = rut.back();
  const std::string body = rut.substr(0, rut.size() - 1);
  if (body.size() < 6 || body.size() > 9 || !isAllDigits(body)) {
    return false;
  }
  if (lastChar != 'K' && !std::isdigit(static_cast<unsigned char>(lastChar))) {
    return false;
  }
  static const int cycle[] = {2, 3, 4, 5, 6, 7};
  int sum = 0;
  int cycleIdx = 0;
  for (auto it = body.rbegin(); it != body.rend(); ++it) {
    sum += (*it - '0') * cycle[cycleIdx];
    cycleIdx = (cycleIdx + 1) % 6;
  }
  const int remainder = 11 - (sum % 11);
  char expected;
  if (remainder == 11) expected = '0';
  else if (remainder == 10) expected = 'K';
  else expected = static_cast<char>('0' + remainder);
  return expected == lastChar;
}

/**
 * Cedula juridica Costa Rica: 10 digitos, sin cero inicial. A diferencia
 * de RUC/RUT/CNPJ, no existe un algoritmo de digito verificador publico
 * y confiable para validar matematicamente -- la verificacion real se
 * hace contra el Registro Nacional (RNPDGT), fuera de alcance aqui (ver
 * tax_registry_client.hpp). Se valida solo la FORMA (longitud + sin cero
 * inicial), documentado como tal a proposito -- no se inventa un
 * checksum sin fuente oficial confirmada.
 */
bool validateCedulaJuridicaCr(const std::string &id) {
  return id.length() == 10 && isAllDigits(id) && id[0] != '0' &&
         !isRepeatedNumber(id);
}

/**
 * Fallback estructural para los ~24 paises del catalogo (ver
 * db_scripts/16 y 25) sin algoritmo de digito verificador implementado
 * todavia: acepta una forma numerica razonable sin afirmar una
 * validacion matematica real. Documentado explicitamente como tal (ver
 * ADR-102) en vez de bloquear el registro de una empresa de un pais
 * valido del catalogo.
 */
bool validateGenericFallback(const std::string &taxId) {
  return taxId.size() >= 6 && taxId.size() <= 15 && isAllDigits(taxId) &&
         !isRepeatedNumber(taxId);
}

} // namespace

bool validateTaxIdChecksum(const std::string &taxId,
                           const std::string &countryIso2) {
  // Mismo orden y condiciones que el GET /api/auth/validate-company
  // original (auth_routes.cpp): BR y US/CA solo entran si el país declarado
  // Y el largo coinciden; si no, cae al branch de PE por largo=11 SIN
  // importar qué país se declaró — comportamiento preexistente, se preserva
  // tal cual (no es una regla nueva de este refactor).
  if (countryIso2 == "BR" && taxId.length() == 14) return validateCnpjBr(taxId);
  if ((countryIso2 == "US" || countryIso2 == "CA") && taxId.length() == 9) return validateUsCa(taxId);
  if (countryIso2 == "EC" && taxId.length() == 13) return validateRucEc(taxId);
  if (countryIso2 == "CL") return validateRutCl(taxId);
  if (countryIso2 == "CR" && taxId.length() == 10) return validateCedulaJuridicaCr(taxId);
  if (taxId.length() == 11) return validateRucPe(taxId);
  // A esta altura ninguna validación específica aplicó -- o el país no
  // tiene una (fallback genérico, ver ADR-102) o SÍ es uno de los países
  // con validación propia (BR/US/CA/EC/CR/PE) pero el largo no coincidió
  // con su formato real. En ese segundo caso se rechaza (false): el
  // fallback genérico es deliberadamente más permisivo y solo debe
  // aplicar cuando el país no tiene ninguna validación propia, nunca como
  // una vía más laxa para un país que sí la tiene pero con datos mal
  // formados.
  const bool hasOwnValidator =
      countryIso2 == "BR" || countryIso2 == "US" || countryIso2 == "CA" ||
      countryIso2 == "EC" || countryIso2 == "CL" || countryIso2 == "CR" ||
      countryIso2 == "PE";
  if (hasOwnValidator) {
    return false;
  }
  return validateGenericFallback(taxId);
}

} // namespace auth
