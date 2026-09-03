#include "totp.hpp"

#include <openssl/hmac.h>
#include <openssl/rand.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace auth::totp {

namespace {

constexpr char kBase32Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
constexpr int kDigits = 6;
constexpr int kStepSeconds = 30;

std::string base32Encode(const std::vector<unsigned char> &data) {
  std::string out;
  out.reserve((data.size() * 8 + 4) / 5);
  int buffer = 0;
  int bitsLeft = 0;
  for (unsigned char b : data) {
    buffer = (buffer << 8) | b;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out.push_back(kBase32Alphabet[(buffer >> bitsLeft) & 0x1F]);
    }
  }
  if (bitsLeft > 0) {
    out.push_back(kBase32Alphabet[(buffer << (5 - bitsLeft)) & 0x1F]);
  }
  return out;
}

std::vector<unsigned char> base32Decode(const std::string &encoded) {
  static std::array<int, 256> table = [] {
    std::array<int, 256> t{};
    t.fill(-1);
    for (int i = 0; i < 32; ++i) {
      t[static_cast<unsigned char>(kBase32Alphabet[i])] = i;
    }
    return t;
  }();

  std::vector<unsigned char> out;
  int buffer = 0;
  int bitsLeft = 0;
  for (unsigned char c : encoded) {
    // Tolera espacios/guiones (formato de despliegue en grupos de 4) y
    // minúsculas (algunos clientes las normalizan a mayúscula, otros no).
    if (c == ' ' || c == '-') continue;
    const unsigned char upper = static_cast<unsigned char>(std::toupper(c));
    const int value = table[upper];
    if (value < 0) continue;  // ignora '=' de relleno u otro ruido
    buffer = (buffer << 5) | value;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out.push_back(static_cast<unsigned char>((buffer >> bitsLeft) & 0xFF));
    }
  }
  return out;
}

/** @brief HOTP (RFC 4226): HMAC-SHA1 + truncamiento dinámico -> código de `kDigits` dígitos. */
std::uint32_t hotp(const std::vector<unsigned char> &key, std::uint64_t counter) {
  unsigned char counterBytes[8];
  for (int i = 7; i >= 0; --i) {
    counterBytes[i] = static_cast<unsigned char>(counter & 0xFF);
    counter >>= 8;
  }

  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digestLen = 0;
  HMAC(EVP_sha1(), key.data(), static_cast<int>(key.size()), counterBytes,
       sizeof(counterBytes), digest, &digestLen);

  const int offset = digest[digestLen - 1] & 0x0F;
  const std::uint32_t binCode =
      (static_cast<std::uint32_t>(digest[offset] & 0x7F) << 24) |
      (static_cast<std::uint32_t>(digest[offset + 1]) << 16) |
      (static_cast<std::uint32_t>(digest[offset + 2]) << 8) |
      static_cast<std::uint32_t>(digest[offset + 3]);

  std::uint32_t mod = 1;
  for (int i = 0; i < kDigits; ++i) mod *= 10;
  return binCode % mod;
}

std::string normalizeCode(const std::string &code) {
  std::string out;
  out.reserve(code.size());
  for (char c : code) {
    if (std::isdigit(static_cast<unsigned char>(c))) out.push_back(c);
  }
  return out;
}

std::string urlEncodeComponent(const std::string &value) {
  static const char *hex = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : value) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out.push_back(static_cast<char>(c));
    } else {
      out.push_back('%');
      out.push_back(hex[(c >> 4) & 0xF]);
      out.push_back(hex[c & 0xF]);
    }
  }
  return out;
}

}  // namespace

std::string generateBase32Secret(std::size_t numBytes) {
  std::vector<unsigned char> raw(numBytes);
  if (RAND_bytes(raw.data(), static_cast<int>(raw.size())) != 1) {
    throw std::runtime_error("RAND_bytes failed generating TOTP secret");
  }
  return base32Encode(raw);
}

bool verifyCode(const std::string &base32Secret, const std::string &code,
                int toleranceSteps) {
  const std::string digitsOnly = normalizeCode(code);
  if (digitsOnly.size() != static_cast<std::size_t>(kDigits)) {
    return false;
  }
  const std::uint32_t submitted = static_cast<std::uint32_t>(std::stoul(digitsOnly));

  const auto key = base32Decode(base32Secret);
  if (key.empty()) {
    return false;
  }

  const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                       .count();
  const std::uint64_t currentStep = static_cast<std::uint64_t>(now) / kStepSeconds;

  for (int delta = -toleranceSteps; delta <= toleranceSteps; ++delta) {
    // Evita underflow de uint64 si currentStep es pequeño (irrelevante en
    // producción, pero correcto igual para pruebas con reloj manipulado).
    if (delta < 0 && static_cast<std::uint64_t>(-delta) > currentStep) continue;
    const std::uint64_t step = currentStep + static_cast<std::uint64_t>(delta);
    if (hotp(key, step) == submitted) {
      return true;
    }
  }
  return false;
}

std::string buildOtpAuthUri(const std::string &base32Secret,
                            const std::string &accountLabel,
                            const std::string &issuer) {
  return "otpauth://totp/" + urlEncodeComponent(issuer) + ":" +
         urlEncodeComponent(accountLabel) +
         "?secret=" + base32Secret +
         "&issuer=" + urlEncodeComponent(issuer) +
         "&algorithm=SHA1&digits=6&period=30";
}

}  // namespace auth::totp
