#pragma once

#include <boost/json.hpp>
#include <string>

namespace json = boost::json;

namespace support {

/**
 * @brief Asistente de IA con contexto minero (Ollama, local). Recibe
 * {qualifying:{...}, messages:[{role,content},...]} y responde
 * {reply:"..."} o {error:"..."} si Ollama no está configurado/disponible.
 * `qualifying` (nombre, unidad, motivo, urgencia, descripción) se inyecta en
 * el prompt de sistema para que la primera respuesta ya tenga contexto, sin
 * que el usuario deba repetirlo.
 */
/** `tenantId` (de la sesión autenticada, nunca del body del cliente -- evita
 * IDOR) acota la búsqueda de sensores reales en la base de datos que se
 * inyecta como contexto cuando el usuario pregunta por sensores/piezómetros/
 * inclinómetros/etc. Vacío desactiva la búsqueda (el chat sigue funcionando,
 * solo sin datos reales de sensores). */
json::object handleChatMessage(const json::value &body, const std::string &tenantId = "");

/**
 * @brief Escala la conversación a soporte humano por WhatsApp Business Cloud
 * API: envía una plantilla al número del equipo de soporte (configurado en
 * BEEMETRY_WHATSAPP_SUPPORT_TO_E164). Recibe {qualifying:{...}} opcional
 * para incluir contexto en logs; responde {status:"sent"} o
 * {error:"whatsapp_not_configured"|...}.
 */
json::object handleEscalateToWhatsapp(const json::value &body);

/**
 * @brief Arma el prompt completo (sistema con contexto minero + historial)
 * para /api/generate de Ollama -- misma lógica que handleChatMessage, pero
 * expuesta para el handler de streaming SSE (main.cpp::handleChatStreamSse),
 * que necesita el prompt para abrir su propia conexión streaming a Ollama en
 * vez de esperar la respuesta completa como handleChatMessage.
 */
struct ChatPromptResult {
  std::string prompt;
  /** true si se inyectaron >=1 filas reales de sensores (ver
   * fetchMatchingSensors) -- las llamadas a Ollama deben pedir más tokens
   * en ese caso: un listado real puede ser más largo que una respuesta
   * conversacional corta, y el límite corto (pensado para chit-chat) estaba
   * truncando listados reales a mitad de camino. */
  bool hasSensorRows = false;
};

ChatPromptResult buildChatPromptForStreaming(const json::object &qualifying,
                                             const json::array &messages,
                                             const std::string &tenantId = "");

/**
 * @brief true si `fragment` contiene al menos un carácter CJK (mismo rango
 * que stripCjkLines, U+4E00-U+9FFF / U+3400-U+4DBF) -- versión a nivel de
 * fragmento/token para el streaming (stripCjkLines opera por línea completa,
 * que no aplica cuando se reenvían fragmentos parciales token a token).
 */
bool fragmentHasCjk(const std::string &fragment);

} // namespace support
