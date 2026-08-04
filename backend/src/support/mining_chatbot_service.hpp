#pragma once

#include <boost/json.hpp>
#include <string>
#include <vector>

namespace json = boost::json;

namespace support {

/**
 * @brief Intencion declarada por la UI para el turno actual. La manda el
 * widget en el body como {"intent":"summarize"|"expand"|"ideas"|"chat"};
 * cualquier valor desconocido (o ausente) cae en Chat.
 *
 * Existe por una razon concreta: el presupuesto de tokens de la respuesta no
 * puede ser el mismo para todos los turnos. Un "Ampliar" pide explicitamente
 * MAS texto que la respuesta anterior, y el limite unico de 180 tokens
 * (pensado para chat corto) lo cortaba a media frase -- que es justo lo que
 * el usuario reportaba como "la ampliacion no funciona".
 */
enum class ChatIntent { Chat, Summarize, Expand, Ideas };

/** Convierte el campo "intent" del body a ChatIntent (case-insensitive). */
ChatIntent parseChatIntent(const std::string &raw);

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
  /** options.num_predict ya resuelto (intención + presencia de listado real). */
  int numPredict = 320;
  /** options.num_ctx ya resuelto. Ver chatbotNumCtx(). */
  int numCtx = 8192;
  /** true si se descartaron turnos antiguos por presupuesto (ver
   * kHistoryCharBudget en el .cpp) -- solo para logging/diagnóstico. */
  bool historyTrimmed = false;
};

ChatPromptResult buildChatPromptForStreaming(const json::object &qualifying,
                                             const json::array &messages,
                                             const std::string &tenantId = "",
                                             ChatIntent intent = ChatIntent::Chat);

/**
 * @brief Ventana de contexto (options.num_ctx) a pedirle a Ollama, de
 * BEEMETRY_OLLAMA_CHATBOT_NUM_CTX (default 8192, acotado a [2048, 32768]).
 *
 * Corrección 2026-08-03 -- causa raíz de la "pérdida de contexto" reportada:
 * el backend NUNCA enviaba num_ctx, así que Ollama aplicaba su default por
 * VRAM (verificado en vivo en este stack: `default_num_ctx=4096`). Un turno
 * con listado real de sensores ya gasta ~1.9k tokens entre prompt de sistema
 * y datos, de modo que a partir del 4º/5º intercambio el prompt superaba los
 * 4096 y el runtime de Ollama lo truncaba SOLO -- y trunca descartando el
 * PRINCIPIO, es decir el prompt de sistema y el bloque 'DATOS REALES DE
 * SENSORES'. De ahí que el asistente dejara de reconocer el tema y volviera a
 * pedir datos que el sistema ya le había dado.
 */
int chatbotNumCtx();

/**
 * @brief Opciones de /api/generate compartidas por la ruta no-streaming
 * (handleChatMessage) y la de streaming SSE (main.cpp::handleChatStreamSse),
 * para que no puedan divergir: temperature, num_ctx, num_predict y las
 * secuencias de parada.
 */
json::object buildOllamaOptions(const ChatPromptResult &promptResult);

/**
 * @brief true si `fragment` contiene al menos un carácter CJK (mismo rango
 * que stripCjkLines, U+4E00-U+9FFF / U+3400-U+4DBF) -- versión a nivel de
 * fragmento/token para el streaming (stripCjkLines opera por línea completa,
 * que no aplica cuando se reenvían fragmentos parciales token a token).
 */
bool fragmentHasCjk(const std::string &fragment);

} // namespace support
