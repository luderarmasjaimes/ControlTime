// --------------------------------------------------------------------------
// alarm_notifier.hpp — Notificación de alarmas en tiempo real, multi-canal
// --------------------------------------------------------------------------
// Canales:
//   - WebSocket (implícito, siempre): push inmediato a toda sesión WS viva
//     del tenant vía WsRegistry (la misma infraestructura del mapa en vivo).
//   - email: SMTP saliente vía curl (relay configurable con
//     BEEMETRY_SMTP_HOST/PORT — por defecto el sidecar mailpit del compose,
//     que NO entrega a bandejas reales, solo las atrapa para inspección en
//     http://localhost:8025; en producción, o para que un correo llegue de
//     verdad, se apunta a un relay real vía BEEMETRY_SMTP_HOST/PORT +
//     BEEMETRY_SMTP_USER/PASS + BEEMETRY_SMTP_TLS=1, p.ej. Gmail:
//     smtp.gmail.com:587 con un App Password de la cuenta -- ver 2026-08-21
//     en CLAUDE.md/notas del proyecto).
//   - webhook: POST JSON a una URL — cubre genéricamente Slack, Teams,
//     Telegram, WhatsApp Business API y cualquier integración propia.
//
// Los canales email/webhook se configuran por tenant en la tabla
// notification_channels (CRUD en /api/mining/notifications/*), con umbral
// mínimo de severidad por canal. Cada intento queda trazado en
// notification_log (sent/failed + detalle).
//
// El despacho corre en un hilo desprendido para no bloquear el ciclo del
// AlarmEngine (un SMTP lento no debe retrasar la evaluación de reglas).
// --------------------------------------------------------------------------
#pragma once

#include <string>
#include <vector>

namespace mining_iot {

/**
 * @brief Envía un correo con UN adjunto binario (multipart/mixed) -- misma
 * validación/transporte que el `sendEmail` interno de alarm_notifier.cpp
 * (curl en modo SMTP crudo vía `BEEMETRY_SMTP_HOST/PORT`), extendido para
 * llevar el CV original a RRHH (ADR-122). Expuesto fuera del namespace
 * anónimo porque, a diferencia de `sendEmail` (uso interno de
 * `notifyAlarmEvent`), este lo llama otro módulo (`support`).
 *
 * `attachmentFilename` es tratado como entrada NO confiable (viene del
 * nombre de archivo que reportó WhatsApp) -- se sanitiza antes de entrar en
 * una cabecera MIME (sin esto, un nombre de archivo con \r\n sería
 * inyección de cabeceras de correo).
 *
 * @return true si el envío tuvo éxito (ver `detail` para el motivo si no).
 */
bool sendEmailWithAttachment(const std::string &to, const std::string &subject,
                             const std::string &bodyText, const std::string &attachmentFilename,
                             const std::string &attachmentMimeType,
                             const std::vector<unsigned char> &attachmentBytes,
                             std::string &detail);

/**
 * @brief Envía un correo de texto plano (sin adjunto) -- mismo transporte y
 * validaciones (isSafeEmail, anti-inyección de cabeceras) que
 * `sendEmailWithAttachment`, expuesto igual para que otro módulo (`notify`,
 * canal "email" de POST /api/notifications/send y de
 * POST /api/reports/{id}/share) lo reutilice sin duplicar la composición
 * SMTP cruda por curl.
 */
bool sendPlainEmail(const std::string &to, const std::string &subject,
                    const std::string &body, std::string &detail);

/**
 * @brief Valida el destino de un canal de notificación antes de guardarlo.
 *
 * Los mismos criterios que se aplican justo antes de enviar (allowlist de
 * formato + bloqueo de destinos SSRF para webhooks: loopback, RFC1918,
 * link-local/metadatos cloud y nombres internos de la red Docker). Se expone
 * para poder validar también en el ALTA del canal (/api/mining/notifications/
 * channels) y rechazar la configuración con un error claro, en vez de
 * aceptarla y descubrir en silencio, alarma tras alarma, que nunca se envía.
 *
 * @param channelType "email" o "webhook".
 * @param configJson  JSON de configuración del canal (`{"to":…}` / `{"url":…}`).
 * @param error       Salida: motivo del rechazo.
 * @return true si el destino es aceptable.
 */
bool validateChannelTarget(const std::string& channelType,
                           const std::string& configJson,
                           std::string& error);

// eventType: "triggered" | "resolved"
void notifyAlarmEvent(const std::string& tenantId,
                      const std::string& alarmId,
                      const std::string& eventType,
                      const std::string& severity,
                      const std::string& message,
                      double observedValue);

} // namespace mining_iot
