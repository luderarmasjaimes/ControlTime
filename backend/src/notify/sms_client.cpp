#include "sms_client.hpp"
#include "../http/http_client.hpp"

#include <cstdlib>
#include <sstream>

namespace http = boost::beast::http;

namespace notify {

namespace {

std::string envOr(const char *k, const std::string &def) {
  const char *v = std::getenv(k);
  return (v && *v) ? std::string(v) : def;
}

// Base64 estándar de una sola línea (sin saltos MIME) -- para la cabecera
// `Authorization: Basic ...`, que no admite CRLF embebido. Self-contained a
// propósito, mismo criterio que base64EncodeMime en alarm_notifier.cpp
// (evitar acoplar este archivo pequeño a otro módulo por una función de
// pocas líneas sin estado).
std::string base64Encode(const std::string &data) {
  static const char *kTable =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((data.size() + 2) / 3) * 4);
  std::size_t i = 0;
  while (i + 2 < data.size()) {
    const unsigned int n = (static_cast<unsigned char>(data[i]) << 16) |
                           (static_cast<unsigned char>(data[i + 1]) << 8) |
                           static_cast<unsigned char>(data[i + 2]);
    out += kTable[(n >> 18) & 0x3F];
    out += kTable[(n >> 12) & 0x3F];
    out += kTable[(n >> 6) & 0x3F];
    out += kTable[n & 0x3F];
    i += 3;
  }
  const std::size_t rem = data.size() - i;
  if (rem == 1) {
    const unsigned int n = static_cast<unsigned char>(data[i]) << 16;
    out += kTable[(n >> 18) & 0x3F];
    out += kTable[(n >> 12) & 0x3F];
    out += "==";
  } else if (rem == 2) {
    const unsigned int n = (static_cast<unsigned char>(data[i]) << 16) |
                           (static_cast<unsigned char>(data[i + 1]) << 8);
    out += kTable[(n >> 18) & 0x3F];
    out += kTable[(n >> 12) & 0x3F];
    out += kTable[(n >> 6) & 0x3F];
    out += "=";
  }
  return out;
}

// application/x-www-form-urlencoded -- Twilio exige el cuerpo así, no JSON.
std::string urlEncode(const std::string &s) {
  static const char *kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(s.size() * 3);
  for (unsigned char c : s) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out += static_cast<char>(c);
    } else if (c == ' ') {
      out += '+';
    } else {
      out += '%';
      out += kHex[(c >> 4) & 0xF];
      out += kHex[c & 0xF];
    }
  }
  return out;
}

} // namespace

SmsResult sendSms(const std::string &toE164, const std::string &body) {
  SmsResult result;
  const std::string accountSid = envOr("BEEMETRY_TWILIO_ACCOUNT_SID", "");
  const std::string authToken = envOr("BEEMETRY_TWILIO_AUTH_TOKEN", "");
  const std::string fromNumber = envOr("BEEMETRY_TWILIO_FROM_NUMBER", "");
  if (accountSid.empty() || authToken.empty() || fromNumber.empty()) {
    result.detail = "sms_no_configurado";
    return result;
  }
  if (toE164.empty() || toE164[0] != '+') {
    result.detail = "numero_destino_invalido";
    return result;
  }

  const std::string url =
      "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Messages.json";
  const std::string formBody = "To=" + urlEncode(toE164) +
                               "&From=" + urlEncode(fromNumber) +
                               "&Body=" + urlEncode(body);
  const std::string authHeader = "Basic " + base64Encode(accountSid + ":" + authToken);

  const auto res = http_client::request(
      url, http::verb::post, formBody,
      {{"Authorization", authHeader},
       {"Content-Type", "application/x-www-form-urlencoded"}},
      /*timeoutMs=*/8000);

  result.ok = res.ok;
  result.detail = res.ok ? "twilio 2xx"
                         : (res.error.empty()
                                ? ("twilio http " + std::to_string(res.status) + " " +
                                  res.body.substr(0, 200))
                                : res.error);
  return result;
}

} // namespace notify
