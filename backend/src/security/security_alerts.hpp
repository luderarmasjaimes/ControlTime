#pragma once

#include <string>

namespace security {

/**
 * @brief Envía una alerta de seguridad a un webhook externo (Slack/Discord/
 * Telegram vía un bridge, o cualquier receptor HTTP genérico), si
 * `BEEMETRY_SECURITY_ALERT_WEBHOOK_URL` está configurada.
 *
 * Contexto (ADR-135): el endurecimiento post red-team (ADR-133/134) agregó
 * varios puntos de detección real ([CSP_VIOLATION],
 * [CROSS_SITE_COOKIE_BLOCKED], [AUTH_REGISTER_ROLE_DOWNGRADED]) que solo
 * escribían a stdout/docker logs -- si nadie los mira, un ataque real pasa
 * desapercibido indefinidamente. Esta función es el punto único que esos 3
 * (y cualquier detección futura) llaman para que, además del log, alguien se
 * entere en el momento.
 *
 * No-op silencioso si la variable de entorno no está configurada (opt-in;
 * no requiere credenciales para desplegar el resto del endurecimiento). El
 * envío ocurre en un hilo separado (fire-and-forget): un webhook lento o
 * caído nunca debe agregar latencia ni poder fallar la request real que
 * disparó la alerta.
 *
 * @param eventType Tipo de evento corto (ej. "csp_violation",
 *        "cross_site_cookie_blocked", "auth_register_role_downgraded").
 * @param detail Texto libre con el contexto (IP, usuario, empresa, etc.).
 */
void sendSecurityAlert(const std::string &eventType, const std::string &detail);

}  // namespace security
