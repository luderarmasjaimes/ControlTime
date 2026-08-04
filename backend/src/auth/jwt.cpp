#include "jwt.hpp"

#include <boost/json.hpp>

#include <openssl/hmac.h>
#include <openssl/sha.h>

#include <array>
#include <cstdint>
#include <cstring>

namespace json = boost::json;

namespace auth::jwt {

namespace {

constexpr char kB64UrlChars[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

std::int64_t toEpochSeconds(std::chrono::system_clock::time_point tp) {
  return std::chrono::duration_cast<std::chrono::seconds>(tp.time_since_epoch())
      .count();
}

std::chrono::system_clock::time_point fromEpochSeconds(std::int64_t seconds) {
  return std::chrono::system_clock::time_point(std::chrono::seconds(seconds));
}

/** @brief Comparación en tiempo constante (evita timing attacks al validar firmas). */
bool constantTimeEquals(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) {
    return false;
  }
  unsigned char diff = 0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

} // namespace

std::string base64UrlEncode(const std::string &raw) {
  std::string out;
  out.reserve(((raw.size() + 2) / 3) * 4);

  std::size_t i = 0;
  const std::size_t n = raw.size();
  while (i + 3 <= n) {
    const std::uint32_t chunk =
        (static_cast<unsigned char>(raw[i]) << 16) |
        (static_cast<unsigned char>(raw[i + 1]) << 8) |
        static_cast<unsigned char>(raw[i + 2]);
    out.push_back(kB64UrlChars[(chunk >> 18) & 0x3F]);
    out.push_back(kB64UrlChars[(chunk >> 12) & 0x3F]);
    out.push_back(kB64UrlChars[(chunk >> 6) & 0x3F]);
    out.push_back(kB64UrlChars[chunk & 0x3F]);
    i += 3;
  }

  const std::size_t rem = n - i;
  if (rem == 1) {
    const std::uint32_t chunk = static_cast<unsigned char>(raw[i]) << 16;
    out.push_back(kB64UrlChars[(chunk >> 18) & 0x3F]);
    out.push_back(kB64UrlChars[(chunk >> 12) & 0x3F]);
  } else if (rem == 2) {
    const std::uint32_t chunk = (static_cast<unsigned char>(raw[i]) << 16) |
                                (static_cast<unsigned char>(raw[i + 1]) << 8);
    out.push_back(kB64UrlChars[(chunk >> 18) & 0x3F]);
    out.push_back(kB64UrlChars[(chunk >> 12) & 0x3F]);
    out.push_back(kB64UrlChars[(chunk >> 6) & 0x3F]);
  }
  // Sin padding '=' (RFC 7515 JWS: base64url sin relleno).
  return out;
}

std::optional<std::string> base64UrlDecode(const std::string &encoded) {
  static std::array<int, 256> table = [] {
    std::array<int, 256> t{};
    t.fill(-1);
    for (int i = 0; i < 64; ++i) {
      t[static_cast<unsigned char>(kB64UrlChars[i])] = i;
    }
    return t;
  }();

  std::string out;
  out.reserve((encoded.size() * 3) / 4 + 3);

  int buffer = 0;
  int bitsCollected = 0;
  for (unsigned char c : encoded) {
    if (c == '=' || c == '\r' || c == '\n') {
      continue;
    }
    const int value = table[c];
    if (value < 0) {
      return std::nullopt;
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      out.push_back(static_cast<char>((buffer >> bitsCollected) & 0xFF));
    }
  }
  return out;
}

std::string hmacSha256(const std::string &key, const std::string &data) {
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digestLen = 0;
  HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
       reinterpret_cast<const unsigned char *>(data.data()), data.size(),
       digest, &digestLen);
  return std::string(reinterpret_cast<char *>(digest), digestLen);
}

std::string sha256Hex(const std::string &data) {
  unsigned char digest[SHA256_DIGEST_LENGTH];
  SHA256(reinterpret_cast<const unsigned char *>(data.data()), data.size(),
         digest);
  static const char *hex = "0123456789abcdef";
  std::string out;
  out.reserve(SHA256_DIGEST_LENGTH * 2);
  for (unsigned char b : digest) {
    out.push_back(hex[(b >> 4) & 0xF]);
    out.push_back(hex[b & 0xF]);
  }
  return out;
}

std::string sign(const JwtClaims &claims, const std::string &secret) {
  const json::object header{{"alg", "HS256"}, {"typ", "JWT"}};
  const json::object payload{
      {"sub", claims.sub},
      {"username", claims.username},
      {"company", claims.company},
      {"role", claims.role},
      {"tenant_id", claims.tenantId},
      {"jti", claims.jti},
      {"iat", toEpochSeconds(claims.issuedAt)},
      {"exp", toEpochSeconds(claims.expiresAt)},
  };

  const std::string encodedHeader = base64UrlEncode(json::serialize(header));
  const std::string encodedPayload = base64UrlEncode(json::serialize(payload));
  const std::string signingInput = encodedHeader + "." + encodedPayload;
  const std::string signature = base64UrlEncode(hmacSha256(secret, signingInput));

  return signingInput + "." + signature;
}

std::optional<JwtClaims> verify(const std::string &token, const std::string &secret) {
  const auto firstDot = token.find('.');
  if (firstDot == std::string::npos) {
    return std::nullopt;
  }
  const auto secondDot = token.find('.', firstDot + 1);
  if (secondDot == std::string::npos) {
    return std::nullopt;
  }

  const std::string encodedHeader = token.substr(0, firstDot);
  const std::string encodedPayload = token.substr(firstDot + 1, secondDot - firstDot - 1);
  const std::string encodedSignature = token.substr(secondDot + 1);

  const auto headerRaw = base64UrlDecode(encodedHeader);
  const auto payloadRaw = base64UrlDecode(encodedPayload);
  const auto signatureRaw = base64UrlDecode(encodedSignature);
  if (!headerRaw || !payloadRaw || !signatureRaw) {
    return std::nullopt;
  }

  try {
    const auto headerVal = json::parse(*headerRaw);
    if (!headerVal.is_object()) {
      return std::nullopt;
    }
    const auto &headerObj = headerVal.as_object();
    if (!headerObj.if_contains("alg") || !headerObj.at("alg").is_string() ||
        json::value_to<std::string>(headerObj.at("alg")) != "HS256") {
      return std::nullopt;
    }
  } catch (const std::exception &) {
    return std::nullopt;
  }

  const std::string signingInput = encodedHeader + "." + encodedPayload;
  const std::string expectedSignature = hmacSha256(secret, signingInput);
  if (!constantTimeEquals(*signatureRaw, expectedSignature)) {
    return std::nullopt;
  }

  try {
    const auto payloadVal = json::parse(*payloadRaw);
    if (!payloadVal.is_object()) {
      return std::nullopt;
    }
    const auto &obj = payloadVal.as_object();

    auto getStr = [&obj](const char *key) -> std::string {
      if (!obj.if_contains(key) || !obj.at(key).is_string()) {
        return {};
      }
      return json::value_to<std::string>(obj.at(key));
    };
    auto getInt64 = [&obj](const char *key) -> std::int64_t {
      if (!obj.if_contains(key)) {
        return 0;
      }
      const auto &v = obj.at(key);
      if (v.is_int64()) return v.as_int64();
      if (v.is_uint64()) return static_cast<std::int64_t>(v.as_uint64());
      if (v.is_double()) return static_cast<std::int64_t>(v.as_double());
      return 0;
    };

    JwtClaims claims;
    claims.sub = getStr("sub");
    claims.username = getStr("username");
    claims.company = getStr("company");
    claims.role = getStr("role");
    claims.tenantId = getStr("tenant_id");
    claims.jti = getStr("jti");
    claims.issuedAt = fromEpochSeconds(getInt64("iat"));
    claims.expiresAt = fromEpochSeconds(getInt64("exp"));

    if (claims.sub.empty() || claims.jti.empty()) {
      return std::nullopt;
    }
    if (claims.expiresAt <= std::chrono::system_clock::now()) {
      return std::nullopt;
    }

    return claims;
  } catch (const std::exception &) {
    return std::nullopt;
  }
}

} // namespace auth::jwt
