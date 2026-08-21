#include "whatsapp_signature.hpp"
#include "../auth/jwt.hpp"

namespace support {

namespace {

std::string toLowerHex(const std::string &raw) {
  static const char *hex = "0123456789abcdef";
  std::string out;
  out.reserve(raw.size() * 2);
  for (unsigned char b : raw) {
    out.push_back(hex[(b >> 4) & 0xF]);
    out.push_back(hex[b & 0xF]);
  }
  return out;
}

// Mismo criterio que auth::jwt::constantTimeEquals (no exportado por ese
// header) -- helper local mínimo, autocontenido, ver mismo criterio
// documentado en whatsapp_client.cpp.
bool constantTimeEquals(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) return false;
  unsigned char diff = 0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

} // namespace

bool verifyMetaWebhookSignature(const std::string &rawBody, const std::string &headerValue,
                                const std::string &appSecret) {
  constexpr const char *kPrefix = "sha256=";
  if (headerValue.rfind(kPrefix, 0) != 0) return false;
  if (appSecret.empty()) return false;
  const std::string provided = headerValue.substr(std::string(kPrefix).size());
  const std::string expected = toLowerHex(auth::jwt::hmacSha256(appSecret, rawBody));
  return constantTimeEquals(provided, expected);
}

} // namespace support
