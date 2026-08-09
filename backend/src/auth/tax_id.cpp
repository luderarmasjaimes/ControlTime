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
  if (taxId.length() == 11) return validateRucPe(taxId);
  return false;
}

} // namespace auth
