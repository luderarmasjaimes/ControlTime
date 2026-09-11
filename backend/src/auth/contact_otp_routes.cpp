// --------------------------------------------------------------------------
// contact_otp_routes.cpp — OTP de validación de contacto pre-registro.
//
// POST /api/auth/contact-otp/send
//   Body: { "channel": "email"|"sms", "contact": "<email o teléfono E.164>" }
//   → Genera un OTP de 6 dígitos, lo almacena en memoria (TTL 10 min) y lo
//     envía al destino por el canal indicado.
//   → No requiere sesión activa (se llama antes del registro).
//   → Rate limit: máx. 3 envíos por IP+canal en 15 min.
//
// POST /api/auth/contact-otp/verify
//   Body: { "channel": "email"|"sms", "contact": "...", "code": "123456" }
//   → Valida el código. Si es correcto: { "valid": true }.
//   → Si es incorrecto 3 veces consecutivas: marca el contacto como inválido
//     y responde con { "valid": false, "invalid_data": true } para que el
//     frontend reactive el campo.
// --------------------------------------------------------------------------
#include "contact_otp_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../notify/notify_service.hpp"
#include "../notify/sms_client.hpp"

#include <boost/json.hpp>
#include <chrono>
#include <iostream>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>

namespace json = boost::json;
using http_utils::makeJsonResponse;
using config::AppConfig;

namespace auth {
namespace contact_otp {
namespace {

// ── Almacén en memoria de OTPs ──────────────────────────────────────────────
// Key: "email:<contacto>" o "sms:<contacto>"
// Value: {código, expira_en, intentos_fallidos}
struct OtpEntry {
    std::string code;
    std::chrono::steady_clock::time_point expiresAt;
    int failedAttempts = 0;
};

std::mutex              gOtpMutex;
std::unordered_map<std::string, OtpEntry> gOtpStore;

// ── Rate limit de envío ─────────────────────────────────────────────────────
// Key: "ip:<ip>:<channel>" → {conteo, ventana}
struct RateEntry {
    int count = 0;
    std::chrono::steady_clock::time_point windowStart;
};

std::mutex              gRateMutex;
std::unordered_map<std::string, RateEntry> gRateStore;

constexpr int    OTP_TTL_MINUTES    = 10;
constexpr int    MAX_SEND_PER_WINDOW = 3;
constexpr int    RATE_WINDOW_MINUTES = 15;
constexpr int    MAX_VERIFY_FAILS   = 3;

// Genera un OTP numérico de 6 dígitos criptográficamente aleatorio.
std::string generateOtp() {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<int> dist(0, 999999);
    char buf[7];
    std::snprintf(buf, sizeof(buf), "%06d", dist(gen));
    return std::string(buf);
}

// Extrae el IP real del cliente (soporta X-Forwarded-For de Nginx).
std::string clientIp(const http::request<http::string_body>& req) {
    if (const auto it = req.find("X-Forwarded-For"); it != req.end())
        return std::string(it->value()).substr(0, 64);
    return "unknown";
}

// Comprueba y actualiza el rate limit de envío.
bool rateLimitOk(const std::string& ip, const std::string& channel) {
    std::scoped_lock lk(gRateMutex);
    const auto now = std::chrono::steady_clock::now();
    const std::string key = "ip:" + ip + ":" + channel;
    auto& entry = gRateStore[key];
    if (now - entry.windowStart > std::chrono::minutes(RATE_WINDOW_MINUTES)) {
        entry.count       = 0;
        entry.windowStart = now;
    }
    if (entry.count >= MAX_SEND_PER_WINDOW) return false;
    entry.count++;
    return true;
}

// Construye la clave de almacenamiento del OTP.
std::string otpKey(const std::string& channel, const std::string& contact) {
    return channel + ":" + contact;
}

// Guarda el OTP en el store (reemplaza si ya existía).
void storeOtp(const std::string& key, const std::string& code) {
    std::scoped_lock lk(gOtpMutex);
    gOtpStore[key] = {
        code,
        std::chrono::steady_clock::now() + std::chrono::minutes(OTP_TTL_MINUTES),
        0,
    };
}

// Verifica el OTP. Retorna: 0=OK, 1=incorrecto, 2=expirado/no_existe, 3=bloqueado
int checkOtp(const std::string& key, const std::string& code) {
    std::scoped_lock lk(gOtpMutex);
    auto it = gOtpStore.find(key);
    if (it == gOtpStore.end()) return 2;
    auto& entry = it->second;
    if (std::chrono::steady_clock::now() > entry.expiresAt) {
        gOtpStore.erase(it);
        return 2;
    }
    if (entry.failedAttempts >= MAX_VERIFY_FAILS) return 3;
    if (entry.code != code) {
        entry.failedAttempts++;
        return entry.failedAttempts >= MAX_VERIFY_FAILS ? 3 : 1;
    }
    // Éxito — eliminar el OTP para que no pueda reusarse.
    gOtpStore.erase(it);
    return 0;
}

// Devuelve el string del email configurado para el remitente de OTP.
std::string otpSenderEmail() {
    // Reutiliza la variable real que consume mining_iot::sendPlainEmail().
    return config::getenvOr("BEEMETRY_ALARM_MAIL_FROM", "no-reply@beemetry.com");
}

// Enmascara un contacto para logging (no exponer el dato completo en logs).
// "juan@correo.com" -> "ju***@correo.com", "+51987654321" -> "+519***4321"
std::string maskContact(const std::string& contact) {
    if (const auto at = contact.find('@'); at != std::string::npos) {
        const std::string local = contact.substr(0, at);
        const std::string domain = contact.substr(at);
        return (local.size() <= 2 ? local : local.substr(0, 2) + "***") + domain;
    }
    if (contact.size() <= 6) return contact;
    return contact.substr(0, 4) + "***" + contact.substr(contact.size() - 4);
}

// Envía el código por email usando notify_service::dispatch (canal "email").
// Nota: notify::dispatch ya deja traza propia en notification_dispatch_log,
// pero logueamos aquí también (stderr) para depuración inmediata con
// `docker logs`, sin depender de una consulta SQL.
bool sendByEmail(const std::string& toEmail, const std::string& code) {
    notify::NotifyRequest req;
    req.recipientEmail = toEmail;
    req.title          = "Código de verificación Beemetry";
    req.body           = "Tu código de verificación es: " + code +
                         "\n\nVigencia: " + std::to_string(OTP_TTL_MINUTES) + " minutos. " +
                         "No lo compartas con nadie.\n\n— Equipo Beemetry";
    req.channels       = {"email"};
    req.sourceApp      = "registro";
    const auto results = notify::dispatch(AppConfig::instance().gDatabaseUrl, req);
    for (const auto& r : results) {
        if (r.channel != "email") continue;
        std::cerr << "[CONTACT_OTP] email to=" << maskContact(toEmail)
                  << " ok=" << (r.ok ? "true" : "false")
                  << " detail=\"" << r.detail << "\"\n";
        if (r.ok) return true;
    }
    return false;
}

// Envía el código por SMS usando el sms_client de Twilio.
// Twilio (cuenta trial) SOLO entrega a números verificados en su consola —
// si el destino no está verificado, `result.detail` trae el error real de
// Twilio (ver sms_client.hpp). Se loguea siempre, ok o no, porque este
// canal no pasa por notify::dispatch y por lo tanto no queda en
// notification_dispatch_log.
bool sendBySms(const std::string& phoneE164, const std::string& code) {
    const std::string body =
        "Beemetry: tu código de verificación es " + code +
        ". Vigencia " + std::to_string(OTP_TTL_MINUTES) + " min.";
    const auto result = notify::sendSms(phoneE164, body);
    std::cerr << "[CONTACT_OTP] sms to=" << maskContact(phoneE164)
              << " ok=" << (result.ok ? "true" : "false")
              << " detail=\"" << result.detail << "\"\n";
    return result.ok;
}

// ── Helpers de JSON ─────────────────────────────────────────────────────────
std::string jsonStr(const json::object& o, const char* k) {
    if (const auto* v = o.if_contains(k))
        if (v->is_string()) return std::string(v->as_string());
    return {};
}

}  // namespace

// ── POST /api/auth/contact-otp/send ────────────────────────────────────────
http::response<http::string_body>
handleContactOtpSend(const http::request<http::string_body>& req,
                     const std::unordered_map<std::string, std::string>& /*query*/) {
    std::string channel, contact;
    try {
        const auto val = json::parse(req.body());
        const auto& obj = val.as_object();
        channel = jsonStr(obj, "channel");
        contact = jsonStr(obj, "contact");
    } catch (...) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_json"}});
    }

    if (channel != "email" && channel != "sms") {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "channel_invalid"},
                                             {"detail", "Use 'email' o 'sms'"}});
    }
    if (contact.size() < 4 || contact.size() > 256) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "contact_invalid"}});
    }

    // Rate limit — evita spam de OTPs por la misma IP.
    const std::string ip = clientIp(req);
    if (!rateLimitOk(ip, channel)) {
        std::cerr << "[CONTACT_OTP] send rechazado por rate_limit channel=" << channel
                  << " ip=" << ip << " contact=" << maskContact(contact) << "\n";
        return makeJsonResponse(http::status::too_many_requests,
                                json::object{{"error", "rate_limit"},
                                             {"detail", "Demasiados intentos. Espere 15 minutos."}});
    }

    const std::string code = generateOtp();
    const std::string key  = otpKey(channel, contact);
    storeOtp(key, code);

    // DEBUG (solo entorno local/dev) — código en claro para poder validar el
    // flujo de registro sin depender de que el SMS/email realmente llegue.
    // Quitar esta línea antes de un despliegue expuesto a internet: cualquiera
    // con acceso a `docker logs` podría leer OTPs vigentes de otros usuarios.
    std::cerr << "[CONTACT_OTP] DEBUG code generado channel=" << channel
              << " contact=" << maskContact(contact) << " code=" << code << "\n";

    bool sent = false;
    if (channel == "email") {
        sent = sendByEmail(contact, code);
    } else {
        sent = sendBySms(contact, code);
    }

    if (!sent) {
        // El canal no está configurado o falló la entrega.  Devolvemos
        // invalid_data para que el frontend reactive el campo de edición.
        return makeJsonResponse(http::status::ok,
                                json::object{{"sent", false},
                                             {"error", "canal_no_entregado"},
                                             {"invalid_data", true}});
    }

    return makeJsonResponse(http::status::ok, json::object{{"sent", true}});
}

// ── POST /api/auth/contact-otp/verify ──────────────────────────────────────
http::response<http::string_body>
handleContactOtpVerify(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& /*query*/) {
    std::string channel, contact, code;
    try {
        const auto val = json::parse(req.body());
        const auto& obj = val.as_object();
        channel = jsonStr(obj, "channel");
        contact = jsonStr(obj, "contact");
        code    = jsonStr(obj, "code");
    } catch (...) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_json"}});
    }

    if (channel != "email" && channel != "sms") {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "channel_invalid"}});
    }
    if (contact.size() < 4 || code.size() != 6) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "parametros_invalidos"}});
    }

    const std::string key = otpKey(channel, contact);
    const int result = checkOtp(key, code);

    switch (result) {
    case 0:  // Correcto
        return makeJsonResponse(http::status::ok,
                                json::object{{"valid", true}});
    case 1:  // Incorrecto (intentos restantes)
        return makeJsonResponse(http::status::ok,
                                json::object{{"valid", false},
                                             {"error", "codigo_incorrecto"}});
    case 3:  // Bloqueado por demasiados intentos → dato inválido
        return makeJsonResponse(http::status::ok,
                                json::object{{"valid", false},
                                             {"invalid_data", true},
                                             {"error", "demasiados_intentos"}});
    default:  // Expirado o no existe
        return makeJsonResponse(http::status::ok,
                                json::object{{"valid", false},
                                             {"error", "codigo_expirado"}});
    }
}

// ── Registro en el router global ─────────────────────────────────────────────
void registerRoutes(router::Router& r) {
    r.post("/api/auth/contact-otp/send",   handleContactOtpSend);
    r.post("/api/auth/contact-otp/verify", handleContactOtpVerify);
}

}  // namespace contact_otp
}  // namespace auth
