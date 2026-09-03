#pragma once

#include <string>

namespace notify {

struct SmsResult {
  bool ok = false;
  std::string detail;
};

/**
 * @brief Envía un SMS vía la REST API de Twilio.
 *
 * Proveedor elegido para el piloto (2026-08-29, a pedido del usuario:
 * "investigacion de una que sea free sin costo o brinde paquetes de
 * mensajes sin costo para efectos de pruebas piloto") tras comparar las
 * alternativas realmente disponibles:
 *   - Twilio: sin costo inicial, ~US$15.50 de crédito de prueba (suficientes
 *     para varios cientos de SMS de piloto), API REST estándar y estable,
 *     sin hardware propio. Limitación de cuenta trial: SOLO se puede enviar
 *     a números ya verificados en la consola de Twilio, y el texto lleva un
 *     prefijo "Sent from your Twilio trial account -" que Twilio agrega
 *     automáticamente. Para este caso de uso (notificar a personal interno
 *     de la propia empresa) esa limitación no es un problema real: los
 *     destinatarios son conocidos de antemano y se pueden verificar una vez.
 *   - Textbelt: 1 SMS gratis por día por IP -- alcanza para probar la
 *     integración, no para un piloto real con varios usuarios.
 *   - Textbee: 300 SMS/mes reales gratis, pero requiere un teléfono Android
 *     físico con SIM como gateway -- descartado por depender de hardware
 *     dedicado que este proyecto no tiene.
 * Se eligió Twilio como proveedor piloto por ser el que no requiere
 * hardware ni tarjeta de crédito para arrancar y tiene el crédito más
 * amplio; migrar a otro proveedor más adelante solo implica cambiar este
 * archivo (la interfaz `sendSms` no depende de Twilio en el resto del
 * backend).
 *
 * Configurado por variables de entorno — ver `.env.example`:
 *   BEEMETRY_TWILIO_ACCOUNT_SID, BEEMETRY_TWILIO_AUTH_TOKEN,
 *   BEEMETRY_TWILIO_FROM_NUMBER (E.164, el número emisor de Twilio).
 * Si falta cualquiera de las tres, devuelve `ok=false` con
 * `detail="sms_no_configurado"` sin intentar red — mismo criterio de
 * "canal no configurado, no bloquea el resto" que el resto de
 * notify_service.cpp.
 *
 * @param toE164 Número destino en formato E.164 (p.ej. "+51987654321").
 * @param body Texto del mensaje (Twilio lo trunca/segmenta según GSM-7/UCS-2,
 *        fuera del control de este cliente).
 */
SmsResult sendSms(const std::string &toE164, const std::string &body);

} // namespace notify
