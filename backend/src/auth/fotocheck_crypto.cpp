#include "fotocheck_crypto.hpp"
#include "../config/app_config.hpp"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <array>
#include <vector>

namespace auth {
namespace fotocheck {
namespace {

constexpr std::size_t kIvLen = 12;
constexpr std::size_t kTagLen = 16;
constexpr std::size_t kKeyLen = 32;

// Base64 estándar autocontenido -- mismo criterio ya establecido en este
// codebase de no acoplar un archivo chico a un helper de otro módulo (ver
// whatsapp_media_client.cpp/sms_client.cpp, que duplican el suyo a propósito).
const char kB64Table[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64Encode(const unsigned char *data, std::size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  std::size_t i = 0;
  while (i + 2 < len) {
    const unsigned int n = (static_cast<unsigned int>(data[i]) << 16) |
                           (static_cast<unsigned int>(data[i + 1]) << 8) |
                           static_cast<unsigned int>(data[i + 2]);
    out += kB64Table[(n >> 18) & 0x3F];
    out += kB64Table[(n >> 12) & 0x3F];
    out += kB64Table[(n >> 6) & 0x3F];
    out += kB64Table[n & 0x3F];
    i += 3;
  }
  const std::size_t rem = len - i;
  if (rem == 1) {
    const unsigned int n = static_cast<unsigned int>(data[i]) << 16;
    out += kB64Table[(n >> 18) & 0x3F];
    out += kB64Table[(n >> 12) & 0x3F];
    out += "==";
  } else if (rem == 2) {
    const unsigned int n = (static_cast<unsigned int>(data[i]) << 16) |
                           (static_cast<unsigned int>(data[i + 1]) << 8);
    out += kB64Table[(n >> 18) & 0x3F];
    out += kB64Table[(n >> 12) & 0x3F];
    out += kB64Table[(n >> 6) & 0x3F];
    out += "=";
  }
  return out;
}

int b64CharValue(unsigned char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

bool b64Decode(const std::string &in, std::vector<unsigned char> &out) {
  out.clear();
  int vals[4];
  std::size_t vi = 0;
  for (char c : in) {
    if (c == '=' || c == '\n' || c == '\r') continue;
    const int v = b64CharValue(static_cast<unsigned char>(c));
    if (v < 0) return false;
    vals[vi++] = v;
    if (vi == 4) {
      out.push_back(static_cast<unsigned char>((vals[0] << 2) | (vals[1] >> 4)));
      out.push_back(static_cast<unsigned char>((vals[1] << 4) | (vals[2] >> 2)));
      out.push_back(static_cast<unsigned char>((vals[2] << 6) | vals[3]));
      vi = 0;
    }
  }
  if (vi == 2) {
    out.push_back(static_cast<unsigned char>((vals[0] << 2) | (vals[1] >> 4)));
  } else if (vi == 3) {
    out.push_back(static_cast<unsigned char>((vals[0] << 2) | (vals[1] >> 4)));
    out.push_back(static_cast<unsigned char>((vals[1] << 4) | (vals[2] >> 2)));
  } else if (vi != 0) {
    return false;
  }
  return true;
}

/** Clave cruda de 32 bytes, o vacío si `BEEMETRY_FOTOCHECK_QR_KEY` no está
 * configurada / no decodifica a exactamente 32 bytes. */
std::vector<unsigned char> serverKey() {
  const std::string &b64Key = config::AppConfig::instance().gFotocheckQrKeyBase64;
  if (b64Key.empty()) return {};
  std::vector<unsigned char> key;
  if (!b64Decode(b64Key, key) || key.size() != kKeyLen) return {};
  return key;
}

}  // namespace

std::string encryptFotocheckPayload(const json::object &payload) {
  const std::vector<unsigned char> key = serverKey();
  if (key.empty()) return "";

  const std::string plaintext = json::serialize(payload);

  std::array<unsigned char, kIvLen> iv{};
  if (RAND_bytes(iv.data(), static_cast<int>(iv.size())) != 1) return "";

  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) return "";

  std::vector<unsigned char> ciphertext(plaintext.size());
  std::array<unsigned char, kTagLen> tag{};
  int outLen = 0;
  int totalLen = 0;
  bool ok = true;

  ok = ok && EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN,
                                 static_cast<int>(iv.size()), nullptr) == 1;
  ok = ok && EVP_EncryptInit_ex(ctx, nullptr, nullptr, key.data(), iv.data()) == 1;
  ok = ok && EVP_EncryptUpdate(ctx, ciphertext.data(), &outLen,
                               reinterpret_cast<const unsigned char *>(plaintext.data()),
                               static_cast<int>(plaintext.size())) == 1;
  if (ok) totalLen = outLen;
  ok = ok && EVP_EncryptFinal_ex(ctx, ciphertext.data() + totalLen, &outLen) == 1;
  if (ok) totalLen += outLen;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, static_cast<int>(tag.size()),
                                 tag.data()) == 1;

  EVP_CIPHER_CTX_free(ctx);
  if (!ok) return "";

  std::vector<unsigned char> blob;
  blob.reserve(iv.size() + static_cast<std::size_t>(totalLen) + tag.size());
  blob.insert(blob.end(), iv.begin(), iv.end());
  blob.insert(blob.end(), ciphertext.begin(), ciphertext.begin() + totalLen);
  blob.insert(blob.end(), tag.begin(), tag.end());
  return b64Encode(blob.data(), blob.size());
}

std::optional<json::object> decryptFotocheckPayload(const std::string &base64Ciphertext) {
  const std::vector<unsigned char> key = serverKey();
  if (key.empty()) return std::nullopt;

  std::vector<unsigned char> blob;
  if (!b64Decode(base64Ciphertext, blob)) return std::nullopt;
  if (blob.size() < kIvLen + kTagLen) return std::nullopt;

  const unsigned char *iv = blob.data();
  const unsigned char *ciphertext = blob.data() + kIvLen;
  const std::size_t ciphertextLen = blob.size() - kIvLen - kTagLen;
  const unsigned char *tag = blob.data() + kIvLen + ciphertextLen;

  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) return std::nullopt;

  std::vector<unsigned char> plaintext(ciphertextLen);
  int outLen = 0;
  int totalLen = 0;
  bool ok = true;

  ok = ok && EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(kIvLen),
                                 nullptr) == 1;
  ok = ok && EVP_DecryptInit_ex(ctx, nullptr, nullptr, key.data(), iv) == 1;
  ok = ok && EVP_DecryptUpdate(ctx, plaintext.data(), &outLen, ciphertext,
                               static_cast<int>(ciphertextLen)) == 1;
  if (ok) totalLen = outLen;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, static_cast<int>(kTagLen),
                                 const_cast<unsigned char *>(tag)) == 1;
  // EVP_DecryptFinal_ex devuelve 0 si el tag GCM no valida -- dato
  // manipulado o cifrado con otra clave. Es la comprobación de integridad
  // real, no un detalle cosmético: sin esto, un QR alterado igual
  // "descifraría" a basura sin que nadie lo note.
  const bool tagValid = ok && EVP_DecryptFinal_ex(ctx, plaintext.data() + totalLen, &outLen) == 1;
  if (tagValid) totalLen += outLen;

  EVP_CIPHER_CTX_free(ctx);
  if (!tagValid) return std::nullopt;

  try {
    const auto parsed = json::parse(
        std::string(reinterpret_cast<const char *>(plaintext.data()),
                    static_cast<std::size_t>(totalLen)));
    if (!parsed.is_object()) return std::nullopt;
    return parsed.as_object();
  } catch (...) {
    return std::nullopt;
  }
}

}  // namespace fotocheck
}  // namespace auth
