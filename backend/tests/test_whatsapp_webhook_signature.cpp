// ADR-112 — verifyMetaWebhookSignature es lógica pura (HMAC-SHA256 vía
// auth::jwt::hmacSha256 + comparación en tiempo constante, sin I/O). Cubre el
// único control de autenticación real del webhook de entrada: sin esto,
// cualquiera que adivine la URL podría inyectar mensajes falsos en el bot
// (crear reclamos falsos, gastar cupo de Ollama, etc.).

#include <catch2/catch_test_macros.hpp>

#include "auth/jwt.hpp"
#include "support/whatsapp_signature.hpp"

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
} // namespace

TEST_CASE("verifyMetaWebhookSignature acepta una firma HMAC valida", "[whatsapp][webhook][security]") {
  const std::string secret = "test-app-secret";
  const std::string body = R"({"object":"whatsapp_business_account","entry":[]})";
  const std::string validHeader =
      "sha256=" + toLowerHex(auth::jwt::hmacSha256(secret, body));

  REQUIRE(support::verifyMetaWebhookSignature(body, validHeader, secret));
}

TEST_CASE("verifyMetaWebhookSignature rechaza un body alterado", "[whatsapp][webhook][security]") {
  const std::string secret = "test-app-secret";
  const std::string originalBody = R"({"entry":[{"id":"1"}]})";
  const std::string tamperedBody = R"({"entry":[{"id":"2"}]})";
  const std::string headerForOriginal =
      "sha256=" + toLowerHex(auth::jwt::hmacSha256(secret, originalBody));

  REQUIRE_FALSE(support::verifyMetaWebhookSignature(tamperedBody, headerForOriginal, secret));
}

TEST_CASE("verifyMetaWebhookSignature rechaza el secreto equivocado", "[whatsapp][webhook][security]") {
  const std::string body = R"({"entry":[]})";
  const std::string headerWithWrongSecret =
      "sha256=" + toLowerHex(auth::jwt::hmacSha256("otro-secreto", body));

  REQUIRE_FALSE(support::verifyMetaWebhookSignature(body, headerWithWrongSecret, "test-app-secret"));
}

TEST_CASE("verifyMetaWebhookSignature rechaza header sin el prefijo sha256=", "[whatsapp][webhook][security]") {
  const std::string secret = "test-app-secret";
  const std::string body = R"({"entry":[]})";
  const std::string rawHex = toLowerHex(auth::jwt::hmacSha256(secret, body));

  REQUIRE_FALSE(support::verifyMetaWebhookSignature(body, rawHex, secret));
  REQUIRE_FALSE(support::verifyMetaWebhookSignature(body, "", secret));
}

TEST_CASE("verifyMetaWebhookSignature rechaza si el app secret esta vacio", "[whatsapp][webhook][security]") {
  const std::string body = R"({"entry":[]})";
  const std::string header = "sha256=" + toLowerHex(auth::jwt::hmacSha256("", body));

  REQUIRE_FALSE(support::verifyMetaWebhookSignature(body, header, ""));
}
