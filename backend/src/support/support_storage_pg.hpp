#pragma once

// --------------------------------------------------------------------------
// support_storage_pg.hpp — Persistencia Postgres del bot de WhatsApp
// --------------------------------------------------------------------------
// Dos dominios, un solo archivo (ambos son pequeños y del mismo módulo
// `support`, ver el mismo criterio de agrupación en whatsapp_client.cpp):
//   - Conversación de WhatsApp: estado del menú/sub-flujo por número
//     (whatsapp_conversation) + log crudo de cada mensaje (whatsapp_message_log).
//   - Tickets de soporte/comercial/reclamo/agenda (support_ticket +
//     support_ticket_event), con código de seguimiento generado en SQL
//     (ver generate_support_ticket_code en db_scripts/59).
//
// Llamado tanto por whatsapp_bot_engine (motor del bot) como por los
// endpoints REST de support_routes.cpp (POST/GET/PATCH de tickets) -- una
// sola fuente de verdad para no duplicar el acceso a estas tablas.
// --------------------------------------------------------------------------

#include <boost/json.hpp>
#include <optional>
#include <string>
#include <vector>

namespace json = boost::json;

namespace support {

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

struct TicketRecord {
  std::string id;
  std::string code;
  std::string channel;
  std::string category;
  std::string phoneE164;
  std::string contactName;
  std::string tenantId;
  std::string subject;
  std::string description;
  std::string status;
  std::string priority;
  std::string createdAt;
  std::string updatedAt;
  std::string resolvedAt; // vacío si no está resuelto/cerrado

  json::object toJson() const;
};

struct ConversationRecord {
  std::string phoneE164;
  // Id corto de la línea de WhatsApp (ADR-113: "default", "soporte",
  // "comercial", ...) -- la conversación se escopa por (phone_e164, line_id)
  // porque el mismo número de cliente puede tener conversaciones
  // independientes con distintas líneas del negocio.
  std::string lineId;
  std::string state;
  json::object context;
  std::string tenantId; // vacío = sin tenant identificado
  std::string lastMessageAt;
  /** true si el último mensaje fue hace más de 30 min (ver db_scripts/59 --
   * calculado en SQL sobre el valor previo a este turno). El motor debe
   * tratar esto como "reiniciar a MENU_ROOT" salvo que `state` ya sea
   * MENU_ROOT (nada que reiniciar). */
  bool isStale = false;
};

/** @brief Un número de contacto de escalamiento editado desde la opción
 * "Administración" del bot o desde la API web (ADR-114). Solo existen filas
 * para las claves que ya se editaron alguna vez -- ver `getContactNumberPg`
 * para el valor efectivo (con fallback a la variable de entorno). */
struct ContactNumberRecord {
  std::string key; // 'soporte' | 'comercial'
  std::string label;
  std::string phoneE164;
  std::string updatedAt;
  std::string updatedBy;
};

#if HAS_LIBPQ

/** @brief Genera el código de seguimiento (generate_support_ticket_code), inserta la fila
 * en `support_ticket` y su primer `support_ticket_event` ('created'). @return true si
 * el INSERT tuvo éxito (ver `out`/`error`). */
bool createTicketPg(const std::string &databaseUrl, const std::string &channel,
                    const std::string &category, const std::string &phoneE164,
                    const std::string &contactName, const std::string &tenantId,
                    const std::string &subject, const std::string &description,
                    const std::string &priority, TicketRecord &out, std::string &error);

/** @brief Busca un ticket por su código de seguimiento (case-insensitive: el código
 * generado siempre es mayúsculas, pero el usuario puede escribirlo en minúscula por
 * WhatsApp). @return true si existe. */
bool findTicketByCodePg(const std::string &databaseUrl, const std::string &code,
                        TicketRecord &out);

/** @brief Cambia el estado de un ticket y agrega un `support_ticket_event`
 * ('status_changed'). `actor` es 'bot' (auto-resolución futura) o el username del
 * agente (gestión interna vía PATCH, gateada por RBAC `soporte.manage`). Si
 * `newStatus` es 'resuelto'/'cerrado', fija `resolved_at`. @return true si el ticket
 * existía y se actualizó. */
bool updateTicketStatusPg(const std::string &databaseUrl, const std::string &code,
                          const std::string &newStatus, const std::string &actor,
                          const std::string &detail, TicketRecord &out,
                          std::string &error);

/** @brief Devuelve el estado de conversación de `phoneE164` en la línea `lineId`
 * (ADR-113), creando la fila con `state='MENU_ROOT'` si no existía todavía
 * (primer contacto de ese número en esa línea). */
bool getOrCreateConversationPg(const std::string &databaseUrl,
                               const std::string &phoneE164, const std::string &lineId,
                               ConversationRecord &out);

/** @brief Persiste el nuevo estado/contexto/tenant tras procesar un turno del bot y
 * refresca `last_message_at`. @return true si el UPDATE/UPSERT tuvo éxito. */
bool saveConversationStatePg(const std::string &databaseUrl,
                             const std::string &phoneE164, const std::string &lineId,
                             const std::string &state,
                             const json::object &context, const std::string &tenantId);

/** @brief Inserta una fila de auditoría cruda en `whatsapp_message_log` (best-effort:
 * no propaga errores de escritura -- perder un log no debe tumbar la conversación). */
void appendMessageLogPg(const std::string &databaseUrl, const std::string &phoneE164,
                        const std::string &lineId, const std::string &direction,
                        const std::string &messageType,
                        const json::value &payload, const std::string &waMessageId);

/** @brief Consulta si un mensaje entrante (wamid) ya fue registrado previamente en
 * `whatsapp_message_log` (deduplicación para evitar procesar reintentos de webhook). */
bool isWaMessageAlreadyLoggedPg(const std::string &databaseUrl, const std::string &waMessageId);

/** @brief Fila de `whatsapp_contact_number` (db_scripts/61) para `key`
 * ('soporte'|'comercial'), si ya se editó alguna vez desde la plataforma o el bot.
 * `std::nullopt` = nunca se editó -- el llamador debe usar el número "de fábrica"
 * (la variable de entorno correspondiente, ver `outcomeForFlow` en
 * whatsapp_bot_engine.cpp y `handleGetContactNumbers` en support_routes.cpp). Esta
 * capa no conoce AppConfig a propósito -- mantiene su única responsabilidad, que el
 * llamador resuelva el fallback. */
std::optional<ContactNumberRecord> getContactNumberPg(const std::string &databaseUrl,
                                                       const std::string &key);

/** @brief Todas las filas editadas de `whatsapp_contact_number` (0, 1 o 2 -- solo
 * existen para claves que ya se cambiaron alguna vez). */
std::vector<ContactNumberRecord> listContactNumbersPg(const std::string &databaseUrl);

/** @brief Crea o actualiza (upsert) el número de contacto `key`. `updatedBy` es
 * `"wa:<telefono>"` si vino de la opción "Administración" del bot, o el username si
 * vino de `PUT /api/support/whatsapp/contact-numbers/{key}`. @return true si el
 * UPSERT tuvo éxito. */
bool setContactNumberPg(const std::string &databaseUrl, const std::string &key,
                        const std::string &label, const std::string &phoneE164,
                        const std::string &updatedBy, std::string &error);

// ─────────────────────── Chat web (ADR-116/117) ────────────────────────────

/** @brief Inserta un turno en `support_chat_message`. `conversationId` puede
 * venir vacío (primer turno de una conversación nueva): en ese caso el
 * propio INSERT genera un `gen_random_uuid()` y lo devuelve -- el llamador
 * debe reenviarlo en el turno siguiente. Best-effort (no lanza, ver
 * `appendMessageLogPg`): si falla, devuelve `conversationId` tal cual llegó
 * para que el chat no se interrumpa por un problema de persistencia. */
std::string persistChatMessagePg(const std::string &databaseUrl,
                                 const std::string &conversationId,
                                 const std::string &tenantId, const std::string &userId,
                                 const std::string &channel, const std::string &role,
                                 const std::string &content, const std::string &intent);

/** @brief Filtros de `GET /api/support/admin/tickets` (ADR-116). `category`
 * viene forzado por el llamador (support_routes.cpp) cuando el usuario está
 * limitado a un departamento -- esta capa no conoce RBAC, solo ejecuta el
 * filtro que le pasan. */
struct TicketSearchFilter {
  std::optional<std::string> tenantId;
  std::optional<std::string> category;
  std::optional<std::string> status;
  std::optional<std::string> channel;
  std::optional<std::string> priority;
  std::optional<std::string> q; // busca en code/subject/description/contact_name/phone_e164
  std::optional<std::string> dateFrom; // YYYY-MM-DD, inclusive
  std::optional<std::string> dateTo;   // YYYY-MM-DD, inclusive
  int limit = 20;
  int offset = 0;
};

struct TicketSearchPageResult {
  json::array items; // TicketRecord::toJson() de cada fila
  long total = 0;
};

TicketSearchPageResult searchTicketsPg(const std::string &databaseUrl,
                                       const TicketSearchFilter &filter);

/** @brief Filtros de `GET /api/support/admin/chat-messages` (ADR-116). */
struct ChatMessageSearchFilter {
  std::optional<std::string> tenantId;
  std::optional<std::string> conversationId;
  std::optional<std::string> q; // busca en content
  std::optional<std::string> dateFrom;
  std::optional<std::string> dateTo;
  int limit = 20;
  int offset = 0;
};

struct ChatMessageSearchPageResult {
  json::array items;
  long total = 0;
};

ChatMessageSearchPageResult searchChatMessagesPg(const std::string &databaseUrl,
                                                 const ChatMessageSearchFilter &filter);

// ─────────────────── Adjuntos del chat web (SupportChatWidget) ────────────

/** @brief Metadatos de un archivo adjuntado desde el widget de chat --
 * docx/pptx/pdf/jpg/png (ver kAllowedChatAttachmentExt en support_routes.cpp).
 * El contenido binario no viaja acá (ver getChatAttachmentPg). */
struct ChatAttachmentRecord {
  std::string id;
  std::string conversationId; // vacío = no asociado a una conversación concreta
  std::string filename;
  std::string mimeType;
  long sizeBytes = 0;
  std::string createdAt;
};

/** @brief Inserta el archivo (bytea) en `support_chat_attachment`. `conversationId`
 * puede venir vacío (adjunto suelto, p.ej. antes del primer turno persistido).
 * @return true si el INSERT tuvo éxito (ver `out`/`error`). */
bool saveChatAttachmentPg(const std::string &databaseUrl, const std::string &conversationId,
                          const std::string &tenantId, const std::string &userId,
                          const std::string &filename, const std::string &mimeType,
                          const std::vector<unsigned char> &fileBytes,
                          ChatAttachmentRecord &out, std::string &error);

/** @brief Recupera el archivo por id, restringido al `tenantId` de la sesión que
 * pide la descarga (mismo criterio anti-IDOR que tenant_assets_routes.cpp) --
 * un adjunto sin tenant_id (subida anónima futura) es visible para cualquier
 * sesión autenticada. @return true si existía y el tenant coincide. */
bool getChatAttachmentPg(const std::string &databaseUrl, const std::string &attachmentId,
                         const std::string &tenantId, std::vector<unsigned char> &fileBytes,
                         std::string &mimeType, std::string &filename);

#endif // HAS_LIBPQ

} // namespace support
