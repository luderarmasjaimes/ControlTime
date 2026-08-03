// --------------------------------------------------------------------------
// alarm_notifier.hpp — Notificación de alarmas en tiempo real, multi-canal
// --------------------------------------------------------------------------
// Canales:
//   - WebSocket (implícito, siempre): push inmediato a toda sesión WS viva
//     del tenant vía WsRegistry (la misma infraestructura del mapa en vivo).
//   - email: SMTP saliente vía curl (relay configurable con
//     BEEMETRY_SMTP_HOST/PORT — por defecto el sidecar mailpit del compose;
//     en producción se apunta al SMTP corporativo de la minera).
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

namespace mining_iot {

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
