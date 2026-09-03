#include "notify_service.hpp"
#include "sms_client.hpp"
#include "../config/app_config.hpp"
#include "../mining/alarm_notifier.hpp"
#include "../support/whatsapp_client.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <cstdlib>

namespace notify {

namespace {

std::string envOr(const char *k, const std::string &def) {
  const char *v = std::getenv(k);
  return (v && *v) ? std::string(v) : def;
}

#if HAS_LIBPQ
// Trazabilidad genérica de cada intento (todo canal, todo caller) --
// separada de `notification_log` (mining/alarm_notifier.cpp), que está
// modelada específicamente para eventos de alarma (`alarm_id bigint NOT
// NULL` no aplica aquí: un envío de este módulo puede no tener ninguna
// alarma detrás, p.ej. "te compartieron un informe").
void logAttempt(PGconn *conn, const std::string &sourceApp, const std::string &channel,
                const std::string &recipient, bool ok, const std::string &detail,
                const std::string &relatedType, const std::string &relatedId) {
  const char *p[7] = {sourceApp.c_str(), channel.c_str(), recipient.c_str(),
                      ok ? "sent" : "failed", detail.c_str(),
                      relatedType.empty() ? nullptr : relatedType.c_str(),
                      relatedId.empty() ? nullptr : relatedId.c_str()};
  storage::PgResult r{PQexecParams(conn,
      "INSERT INTO notification_dispatch_log "
      "(source_app, channel, recipient, status, detail, related_type, related_id) "
      "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      7, nullptr, p, nullptr, nullptr, 0)};
  (void)r;  // best-effort: un fallo al loguear no debe afectar el resultado ya calculado
}
#endif

} // namespace

std::vector<ChannelResult> dispatch(const std::string &databaseUrl, const NotifyRequest &req) {
  std::vector<ChannelResult> results;
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  const bool haveConn = PQstatus(conn) == CONNECTION_OK;
#endif

  for (const auto &channel : req.channels) {
    ChannelResult r;
    r.channel = channel;

    if (channel == "in_app") {
#if HAS_LIBPQ
      if (haveConn && !req.recipientUserId.empty()) {
        json::object payload{{"title", req.title},
                             {"body", req.body},
                             {"source_app", req.sourceApp},
                             {"related_type", req.relatedType},
                             {"related_id", req.relatedId}};
        const std::string payloadStr = json::serialize(payload);
        const std::string type = req.relatedType.empty() ? "generic" : req.relatedType;
        const char *p[3] = {req.recipientUserId.c_str(), type.c_str(), payloadStr.c_str()};
        storage::PgResult ins{PQexecParams(conn,
            "INSERT INTO notifications (user_id, type, payload) "
            "VALUES ($1::uuid, $2, $3::jsonb)",
            3, nullptr, p, nullptr, nullptr, 0)};
        r.ok = ins.okCommand();
        r.detail = r.ok ? "" : "insert_fallo";
      } else {
        r.detail = haveConn ? "sin_usuario_destino" : "sin_conexion_bd";
      }
#else
      r.detail = "postgres_no_compilado";
#endif
    } else if (channel == "email") {
      if (req.recipientEmail.empty()) {
        r.detail = "sin_email";
      } else {
        std::string detail;
        r.ok = mining_iot::sendPlainEmail(req.recipientEmail, req.title, req.body, detail);
        r.detail = detail;
      }
    } else if (channel == "whatsapp") {
      // Solo se puede enviar texto libre dentro de la ventana de 24h abierta
      // por un mensaje ENTRANTE del usuario (política de Meta, ver
      // whatsapp_client.hpp) -- una notificación iniciada por el negocio
      // (este caso) exige sí o sí una plantilla PRE-APROBADA en la cuenta de
      // WhatsApp Business. Sin BEEMETRY_WHATSAPP_NOTIFY_TEMPLATE configurado
      // (nombre de esa plantilla), este canal se omite en vez de fallar en
      // silencio con un envío que Meta rechazaría igual.
      const std::string templateName = envOr("BEEMETRY_WHATSAPP_NOTIFY_TEMPLATE", "");
      const auto *line = config::AppConfig::instance().defaultWhatsappLine();
      if (req.recipientPhoneE164.empty()) {
        r.detail = "sin_telefono";
      } else if (!line) {
        r.detail = "whatsapp_sin_linea_configurada";
      } else if (templateName.empty()) {
        r.detail = "whatsapp_sin_plantilla_configurada";
      } else {
        const auto sendRes = support::sendWhatsappTemplateMessage(
            *line, req.recipientPhoneE164, templateName, "es",
            {req.title, req.body});
        r.ok = sendRes.ok;
        r.detail = sendRes.ok ? "" : (!sendRes.error.empty() ? sendRes.error
                                                              : sendRes.rawResponse.substr(0, 200));
      }
    } else if (channel == "sms") {
      if (req.recipientMobileE164.empty()) {
        r.detail = "sin_movil";
      } else {
        const auto smsRes = sendSms(req.recipientMobileE164, req.title + ": " + req.body);
        r.ok = smsRes.ok;
        r.detail = smsRes.detail;
      }
    } else {
      r.detail = "canal_desconocido";
    }

#if HAS_LIBPQ
    if (haveConn) {
      const std::string recipient =
          channel == "email"    ? req.recipientEmail
          : channel == "whatsapp" ? req.recipientPhoneE164
          : channel == "sms"      ? req.recipientMobileE164
                                  : req.recipientUserId;
      logAttempt(conn, req.sourceApp, channel, recipient, r.ok, r.detail,
                req.relatedType, req.relatedId);
    }
#endif
    results.push_back(std::move(r));
  }
  return results;
}

} // namespace notify
