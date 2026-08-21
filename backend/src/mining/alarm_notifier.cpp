// --------------------------------------------------------------------------
// alarm_notifier.cpp — despacho multi-canal de eventos de alarma (ver .hpp)
// --------------------------------------------------------------------------
#include "alarm_notifier.hpp"
#include "../config/app_config.hpp"
#include "../ws_broadcast.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <boost/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <iostream>
#include <regex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace json = boost::json;
using config::AppConfig;

namespace mining_iot {

namespace {

int severityRank(const std::string& s) {
    if (s == "info") return 0;
    if (s == "warning") return 1;
    if (s == "high") return 2;
    if (s == "critical") return 3;
    return 1;  // desconocida → tratar como warning
}

std::string envOr(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::string(v) : def;
}

// Los valores de config vienen de la BD (los configura un admin del tenant),
// pero igual se validan con allowlist estricta antes de tocar una línea de
// comando — defensa en profundidad contra inyección de shell.
bool isSafeEmail(const std::string& s) {
    static const std::regex re(R"(^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$)");
    return std::regex_match(s, re);
}
/**
 * @brief Extrae el host (sin userinfo ni puerto) de una URL http(s), en minúsculas.
 * @return Host, o cadena vacía si no se puede aislar.
 */
std::string urlHost(const std::string& url) {
    const auto schemeEnd = url.find("://");
    if (schemeEnd == std::string::npos) return {};
    std::string rest = url.substr(schemeEnd + 3);
    // Cortar en el primer delimitador de path/query/fragment.
    const auto pathEnd = rest.find_first_of("/?#");
    if (pathEnd != std::string::npos) rest = rest.substr(0, pathEnd);
    // Descartar userinfo (user:pass@host) — el host real es lo que va DESPUÉS
    // de la última '@'; si no se hiciera, "http://169.254.169.254@ok.com" y
    // "http://ok.com@169.254.169.254" se confundirían entre sí.
    const auto at = rest.rfind('@');
    if (at != std::string::npos) rest = rest.substr(at + 1);
    // IPv6 literal: [::1]:8080 → ::1
    if (!rest.empty() && rest.front() == '[') {
        const auto close = rest.find(']');
        if (close == std::string::npos) return {};
        rest = rest.substr(1, close - 1);
    } else {
        const auto colon = rest.find(':');
        if (colon != std::string::npos) rest = rest.substr(0, colon);
    }
    std::transform(rest.begin(), rest.end(), rest.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return rest;
}

/**
 * @brief ¿El host apunta a la propia infraestructura (loopback, red privada,
 *        link-local o nombre interno de Docker)?
 *
 * Un admin de tenant configura libremente la URL de un canal webhook, así que
 * es entrada semi-confiable que el backend va a solicitar por su cuenta: sin
 * este filtro, la URL puede apuntar al endpoint de metadatos del proveedor
 * cloud (169.254.169.254 → credenciales IAM de la instancia), a servicios de
 * la red Docker no publicados (db:5432, minio, el propio :8081) o a loopback.
 * Es el patrón SSRF clásico y convierte "configurar una notificación" en un
 * escáner/proxy de la red interna. Se filtra por literal de IP y por nombre.
 */
bool isBlockedSsrfHost(const std::string& host) {
    if (host.empty()) return true;
    if (host == "localhost" || host == "localhost.localdomain") return true;
    // Sufijos de descubrimiento interno (Docker/K8s/mDNS).
    for (const char* suffix : {".local", ".internal", ".localdomain", ".cluster.local"}) {
        const std::string s(suffix);
        if (host.size() > s.size() &&
            host.compare(host.size() - s.size(), s.size(), s) == 0) {
            return true;
        }
    }
    // Nombre sin punto = hostname corto resoluble solo dentro de la red Docker
    // (p.ej. "db", "web", "minio"). Un webhook legítimo siempre es un FQDN.
    if (host.find('.') == std::string::npos && host.find(':') == std::string::npos) {
        return true;
    }

    // IPv6: bloquear loopback (::1), unique-local (fc00::/7) y link-local (fe80::/10).
    if (host.find(':') != std::string::npos) {
        if (host == "::1" || host == "::") return true;
        if (host.rfind("fc", 0) == 0 || host.rfind("fd", 0) == 0) return true;
        if (host.rfind("fe8", 0) == 0 || host.rfind("fe9", 0) == 0 ||
            host.rfind("fea", 0) == 0 || host.rfind("feb", 0) == 0) return true;
        // IPv4 mapeada (::ffff:169.254.169.254) — se evalúa la parte IPv4.
        const auto lastColon = host.rfind(':');
        if (lastColon != std::string::npos && host.find('.') != std::string::npos) {
            return isBlockedSsrfHost(host.substr(lastColon + 1));
        }
        return true;  // cualquier otro literal IPv6: fuera, por prudencia.
    }

    // IPv4 literal en notación decimal con puntos.
    unsigned int a = 0, b = 0, c = 0, d = 0;
    char extra = 0;
    if (std::sscanf(host.c_str(), "%u.%u.%u.%u%c", &a, &b, &c, &d, &extra) == 4 &&
        a <= 255 && b <= 255 && c <= 255 && d <= 255) {
        if (a == 0 || a == 127) return true;                    // this-host / loopback
        if (a == 10) return true;                               // RFC1918
        if (a == 172 && b >= 16 && b <= 31) return true;        // RFC1918
        if (a == 192 && b == 168) return true;                  // RFC1918
        if (a == 169 && b == 254) return true;                  // link-local (metadatos cloud)
        if (a == 100 && b >= 64 && b <= 127) return true;       // CGNAT RFC6598
        if (a >= 224) return true;                              // multicast / reservado
        return false;
    }
    return false;  // FQDN público: permitido.
}

bool isSafeUrl(const std::string& s) {
    static const std::regex re(R"(^https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]+$)");
    if (!std::regex_match(s, re) || s.find('\'') != std::string::npos) return false;
    return !isBlockedSsrfHost(urlHost(s));
}

void logAttempt(PGconn* conn, const std::string& alarmId, const std::string& tenantId,
                const std::string& channelId, const std::string& channelType,
                const std::string& eventType, bool ok, const std::string& detail) {
    const char* p[7] = {alarmId.c_str(), tenantId.c_str(),
                        channelId.empty() ? nullptr : channelId.c_str(),
                        channelType.c_str(), eventType.c_str(),
                        ok ? "sent" : "failed", detail.c_str()};
    storage::PgResult r{PQexecParams(conn,
        "INSERT INTO notification_log (alarm_id, tenant_id, channel_id, "
        "channel_type, event_type, status, detail) "
        "VALUES ($1::bigint, $2::uuid, $3::uuid, $4, $5, $6, $7)",
        7, nullptr, p, nullptr, nullptr, 0)};
    if (!r.okCommand())
        std::cerr << "[NOTIFIER] log falló: " << PQresultErrorMessage(r.get()) << "\n";
}

// Ejecuta un comando ya validado y devuelve su salida (popen, patrón que el
// proyecto ya usa para gdal_translate en conversion_service.cpp).
int runCommand(const std::string& cmd, std::string& output) {
    output.clear();
    FILE* pipe = popen((cmd + " 2>&1").c_str(), "r");
    if (!pipe) return -1;
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe)) output += buf;
    return pclose(pipe);
}

bool sendEmail(const std::string& to, const std::string& subject,
               const std::string& body, std::string& detail) {
    if (!isSafeEmail(to)) { detail = "email_invalido"; return false; }
    const std::string host = envOr("BEEMETRY_SMTP_HOST", "mailpit");
    const std::string port = envOr("BEEMETRY_SMTP_PORT", "1025");
    const std::string from = envOr("BEEMETRY_ALARM_MAIL_FROM", "alarmas@beemetry.local");
    if (!isSafeEmail(from)) { detail = "mail_from_invalido"; return false; }

    // Cuerpo RFC822 en archivo temporal (evita pasar contenido por argv).
    char tmpl[] = "/tmp/beemetry_mail_XXXXXX";
    const int fd = mkstemp(tmpl);
    if (fd < 0) { detail = "mkstemp_fallo"; return false; }
    {
        std::ofstream f(tmpl);
        f << "From: Beemetry Alarmas <" << from << ">\r\n"
          << "To: <" << to << ">\r\n"
          << "Subject: " << subject << "\r\n"
          << "Content-Type: text/plain; charset=utf-8\r\n\r\n"
          << body << "\r\n";
    }
    close(fd);

    std::ostringstream cmd;
    cmd << "curl -s -m 8 --url 'smtp://" << host << ":" << port << "' "
        << "--mail-from '" << from << "' --mail-rcpt '" << to << "' "
        << "-T " << tmpl;
    std::string out;
    const int rc = runCommand(cmd.str(), out);
    std::remove(tmpl);
    detail = (rc == 0) ? ("smtp " + host + ":" + port) : ("curl rc=" + std::to_string(rc) + " " + out.substr(0, 200));
    return rc == 0;
}

// Base64 estándar (RFC 2045, líneas de 76 caracteres -- el límite que exige
// el formato MIME para el cuerpo de un adjunto) -- self-contained a
// propósito, mismo criterio que el resto de este archivo (evitar traer una
// dependencia de otro módulo -- p.ej. biometric::encodeBase64 -- solo para
// una función de 15 líneas sin estado).
std::string base64EncodeMime(const std::vector<unsigned char>& data) {
    static const char* kTable =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4 + data.size() / 57 + 8);
    std::size_t i = 0;
    int lineLen = 0;
    while (i + 2 < data.size()) {
        const unsigned int n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        out += kTable[(n >> 18) & 0x3F];
        out += kTable[(n >> 12) & 0x3F];
        out += kTable[(n >> 6) & 0x3F];
        out += kTable[n & 0x3F];
        i += 3;
        lineLen += 4;
        if (lineLen >= 76) { out += "\r\n"; lineLen = 0; }
    }
    const std::size_t rem = data.size() - i;
    if (rem == 1) {
        const unsigned int n = data[i] << 16;
        out += kTable[(n >> 18) & 0x3F];
        out += kTable[(n >> 12) & 0x3F];
        out += "==";
    } else if (rem == 2) {
        const unsigned int n = (data[i] << 16) | (data[i + 1] << 8);
        out += kTable[(n >> 18) & 0x3F];
        out += kTable[(n >> 12) & 0x3F];
        out += kTable[(n >> 6) & 0x3F];
        out += "=";
    }
    return out;
}

// Un nombre de archivo de WhatsApp es entrada NO confiable metida en una
// cabecera MIME (Content-Disposition) -- sin sanitizar, "\r\n" ahí sería
// inyección de cabeceras de correo (mismo tipo de riesgo que isSafeEmail
// mitiga para la dirección). Se permite un set conservador de caracteres y
// se recorta a una longitud razonable; nunca se deja vacío (usa "cv" si
// todo se filtra).
std::string sanitizeMimeFilename(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (char c : raw) {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (std::isalnum(uc) || c == '.' || c == '_' || c == '-' || c == ' ') {
            out += c;
        }
    }
    while (!out.empty() && (out.front() == ' ' || out.front() == '.')) out.erase(out.begin());
    if (out.size() > 120) out.resize(120);
    return out.empty() ? "cv" : out;
}

bool sendWebhook(const std::string& url, const std::string& payloadJson, std::string& detail) {
    if (!isSafeUrl(url)) { detail = "url_invalida"; return false; }
    char tmpl[] = "/tmp/beemetry_hook_XXXXXX";
    const int fd = mkstemp(tmpl);
    if (fd < 0) { detail = "mkstemp_fallo"; return false; }
    {
        std::ofstream f(tmpl);
        f << payloadJson;
    }
    close(fd);
    std::ostringstream cmd;
    cmd << "curl -s -o /dev/null -w '%{http_code}' -m 6 -X POST "
        << "-H 'Content-Type: application/json' --data @" << tmpl << " '" << url << "'";
    std::string out;
    const int rc = runCommand(cmd.str(), out);
    std::remove(tmpl);
    detail = "http " + out.substr(0, 3);
    return rc == 0 && !out.empty() && out[0] == '2';
}

void dispatch(std::string tenantId, std::string alarmId, std::string eventType,
              std::string severity, std::string message, double observedValue) {
#if HAS_LIBPQ
    // Payload canónico del evento (mismo JSON para WS y webhooks).
    json::object payload{
        {"type", "alarm"},
        {"event", eventType},
        {"alarm_id", alarmId},
        {"severity", severity},
        {"message", message},
        {"observed_value", observedValue},
        {"ts", static_cast<std::int64_t>(std::time(nullptr))}};
    const std::string payloadStr = json::serialize(payload);

    auto& cfg = AppConfig::instance();
    auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        std::cerr << "[NOTIFIER] sin conexión BD, solo WS\n";
        WsRegistry::instance().broadcastToTenant(tenantId, payloadStr);
        return;
    }

    // 1) WebSocket — siempre, a todas las sesiones vivas del tenant.
    const std::size_t wsSent = WsRegistry::instance().broadcastToTenant(tenantId, payloadStr);
    logAttempt(conn, alarmId, tenantId, "", "websocket", eventType, true,
               "sesiones=" + std::to_string(wsSent));

    // 2) Canales configurados del tenant (email/webhook), filtrados por severidad.
    const char* p[1] = {tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT channel_id, channel_type, config::text, min_severity, label "
        "FROM notification_channels WHERE tenant_id = $1::uuid AND enabled",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) return;

    const int evRank = severityRank(severity);
    for (int i = 0; i < PQntuples(res.get()); ++i) {
        const std::string channelId = PQgetvalue(res.get(), i, 0);
        const std::string type      = PQgetvalue(res.get(), i, 1);
        const std::string minSev    = PQgetvalue(res.get(), i, 3);
        if (evRank < severityRank(minSev)) continue;

        json::value confV;
        try { confV = json::parse(PQgetvalue(res.get(), i, 2)); } catch (...) { continue; }
        const auto* conf = confV.if_object();
        if (!conf) continue;

        bool ok = false;
        std::string detail;
        if (type == "email") {
            std::string to;
            if (const auto* t = conf->if_contains("to"))
                if (t->is_string()) to = std::string(t->as_string());
            const std::string subject =
                std::string("[Beemetry] Alarma ") + (eventType == "resolved" ? "RESUELTA" : "ACTIVA") +
                " (" + severity + ")";
            std::ostringstream body;
            body << message << "\n\nValor observado: " << observedValue
                 << "\nSeveridad: " << severity << "\nEvento: " << eventType
                 << "\nAlarma ID: " << alarmId
                 << "\n\n-- Plataforma Beemetry (notificación automática)";
            ok = sendEmail(to, subject, body.str(), detail);
        } else if (type == "webhook") {
            std::string url;
            if (const auto* u = conf->if_contains("url"))
                if (u->is_string()) url = std::string(u->as_string());
            ok = sendWebhook(url, payloadStr, detail);
        }
        logAttempt(conn, alarmId, tenantId, channelId, type, eventType, ok, detail);
        if (!ok)
            std::cerr << "[NOTIFIER] canal " << type << " (" << PQgetvalue(res.get(), i, 4)
                      << ") falló: " << detail << "\n";
    }
#endif
}

} // namespace

bool sendEmailWithAttachment(const std::string &to, const std::string &subject,
                             const std::string &bodyText, const std::string &attachmentFilename,
                             const std::string &attachmentMimeType,
                             const std::vector<unsigned char> &attachmentBytes,
                             std::string &detail) {
    if (!isSafeEmail(to)) { detail = "email_invalido"; return false; }
    const std::string host = envOr("BEEMETRY_SMTP_HOST", "mailpit");
    const std::string port = envOr("BEEMETRY_SMTP_PORT", "1025");
    const std::string from = envOr("BEEMETRY_ALARM_MAIL_FROM", "alarmas@beemetry.local");
    if (!isSafeEmail(from)) { detail = "mail_from_invalido"; return false; }
    if (attachmentBytes.empty()) { detail = "adjunto_vacio"; return false; }

    const std::string safeFilename = sanitizeMimeFilename(attachmentFilename);
    const std::string mime = attachmentMimeType.empty() ? "application/octet-stream" : attachmentMimeType;
    const std::string boundary = "----beemetry-" + std::to_string(std::time(nullptr));

    // Mismo transporte que sendEmail() (curl en modo SMTP crudo sobre un
    // archivo temporal) -- acá el cuerpo es multipart/mixed en vez de
    // text/plain: una parte de texto (resumen) + una parte con el adjunto
    // en base64 (Content-Disposition: attachment).
    char tmpl[] = "/tmp/beemetry_mail_att_XXXXXX";
    const int fd = mkstemp(tmpl);
    if (fd < 0) { detail = "mkstemp_fallo"; return false; }
    {
        std::ofstream f(tmpl);
        f << "From: Beemetry RRHH <" << from << ">\r\n"
          << "To: <" << to << ">\r\n"
          << "Subject: " << subject << "\r\n"
          << "MIME-Version: 1.0\r\n"
          << "Content-Type: multipart/mixed; boundary=\"" << boundary << "\"\r\n\r\n"
          << "--" << boundary << "\r\n"
          << "Content-Type: text/plain; charset=utf-8\r\n\r\n"
          << bodyText << "\r\n\r\n"
          << "--" << boundary << "\r\n"
          << "Content-Type: " << mime << "; name=\"" << safeFilename << "\"\r\n"
          << "Content-Transfer-Encoding: base64\r\n"
          << "Content-Disposition: attachment; filename=\"" << safeFilename << "\"\r\n\r\n"
          << base64EncodeMime(attachmentBytes) << "\r\n\r\n"
          << "--" << boundary << "--\r\n";
    }
    close(fd);

    std::ostringstream cmd;
    cmd << "curl -s -m 20 --url 'smtp://" << host << ":" << port << "' "
        << "--mail-from '" << from << "' --mail-rcpt '" << to << "' "
        << "-T " << tmpl;
    std::string out;
    const int rc = runCommand(cmd.str(), out);
    std::remove(tmpl);
    detail = (rc == 0) ? ("smtp " + host + ":" + port) : ("curl rc=" + std::to_string(rc) + " " + out.substr(0, 200));
    return rc == 0;
}

bool validateChannelTarget(const std::string& channelType,
                           const std::string& configJson,
                           std::string& error) {
    json::value confV;
    try {
        confV = json::parse(configJson);
    } catch (...) {
        error = "config_json_invalido";
        return false;
    }
    const auto* conf = confV.if_object();
    if (!conf) {
        error = "config_debe_ser_objeto";
        return false;
    }

    const auto readStr = [&conf](const char* key) -> std::string {
        if (const auto* v = conf->if_contains(key))
            if (v->is_string()) return std::string(v->as_string());
        return {};
    };

    if (channelType == "email") {
        const std::string to = readStr("to");
        if (to.empty()) { error = "config.to_requerido"; return false; }
        if (!isSafeEmail(to)) { error = "config.to_email_invalido"; return false; }
        return true;
    }
    if (channelType == "webhook") {
        const std::string url = readStr("url");
        if (url.empty()) { error = "config.url_requerida"; return false; }
        if (isBlockedSsrfHost(urlHost(url))) {
            error = "config.url_destino_interno_no_permitido";
            return false;
        }
        if (!isSafeUrl(url)) { error = "config.url_invalida"; return false; }
        return true;
    }
    error = "channel_type_invalido";
    return false;
}

void notifyAlarmEvent(const std::string& tenantId, const std::string& alarmId,
                      const std::string& eventType, const std::string& severity,
                      const std::string& message, double observedValue) {
    // Hilo desprendido: el AlarmEngine no espera SMTP/HTTP lentos.
    std::thread(dispatch, tenantId, alarmId, eventType, severity, message,
                observedValue)
        .detach();
}

} // namespace mining_iot
