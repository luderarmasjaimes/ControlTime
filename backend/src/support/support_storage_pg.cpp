#include "support_storage_pg.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"
#include "../biometric/face_analysis.hpp" // encodeBase64/decodeBase64 (mismo helper que cv_storage_pg.cpp)

#include <openssl/sha.h>

#include <algorithm>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>

using biometric::decodeBase64;
using biometric::encodeBase64;

namespace support {

json::object TicketRecord::toJson() const {
  return json::object{
      {"code", code},
      {"channel", channel},
      {"category", category},
      {"contact_name", contactName},
      {"subject", subject},
      {"description", description},
      {"status", status},
      {"priority", priority},
      {"created_at", createdAt},
      {"updated_at", updatedAt},
      {"resolved_at", resolvedAt.empty() ? json::value(nullptr) : json::value(resolvedAt)},
  };
}

#if HAS_LIBPQ

namespace {

// Misma cláusula RETURNING/SELECT en 3 lugares distintos (create/find/update)
// -- centralizada para que no puedan divergir los índices de columna.
constexpr const char *kTicketColumns =
    "id, code, channel, category, COALESCE(phone_e164,''), "
    "COALESCE(contact_name,''), COALESCE(tenant_id::text,''), "
    "COALESCE(subject,''), description, status, priority, "
    "created_at::text, updated_at::text, COALESCE(resolved_at::text,'')";

TicketRecord ticketFromRow(PGresult *res, int row) {
  TicketRecord t;
  t.id = PQgetvalue(res, row, 0);
  t.code = PQgetvalue(res, row, 1);
  t.channel = PQgetvalue(res, row, 2);
  t.category = PQgetvalue(res, row, 3);
  t.phoneE164 = PQgetvalue(res, row, 4);
  t.contactName = PQgetvalue(res, row, 5);
  t.tenantId = PQgetvalue(res, row, 6);
  t.subject = PQgetvalue(res, row, 7);
  t.description = PQgetvalue(res, row, 8);
  t.status = PQgetvalue(res, row, 9);
  t.priority = PQgetvalue(res, row, 10);
  t.createdAt = PQgetvalue(res, row, 11);
  t.updatedAt = PQgetvalue(res, row, 12);
  t.resolvedAt = PQgetvalue(res, row, 13);
  return t;
}

void insertTicketEvent(PGconn *conn, const std::string &ticketId,
                       const std::string &eventType, const std::string &detail,
                       const std::string &actor) {
  const char *params[4] = {ticketId.c_str(), eventType.c_str(), detail.c_str(),
                           actor.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO support_ticket_event (ticket_id, event_type, detail, actor) "
      "VALUES ($1::uuid, $2, $3, $4)",
      4, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    std::cerr << "[SUPPORT] fallo al registrar support_ticket_event: " << res.error()
              << std::endl;
  }
}

} // namespace

bool createTicketPg(const std::string &databaseUrl, const std::string &channel,
                    const std::string &category, const std::string &phoneE164,
                    const std::string &contactName, const std::string &tenantId,
                    const std::string &subject, const std::string &description,
                    const std::string &priority, TicketRecord &out,
                    std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string sql =
      std::string("WITH gen AS (SELECT generate_support_ticket_code($2) AS code) "
                   "INSERT INTO support_ticket (code, channel, category, phone_e164, "
                   "contact_name, tenant_id, subject, description, priority) "
                   "SELECT gen.code, $1, $2, NULLIF($3,''), NULLIF($4,''), "
                   "NULLIF($5,'')::uuid, NULLIF($6,''), $7, $8 FROM gen "
                   "RETURNING ") +
      kTicketColumns;

  const char *params[8] = {channel.c_str(),     category.c_str(), phoneE164.c_str(),
                           contactName.c_str(), tenantId.c_str(), subject.c_str(),
                           description.c_str(), priority.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 8, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "ticket_create_failed: " + res.error();
    return false;
  }
  out = ticketFromRow(res.get(), 0);
  insertTicketEvent(conn, out.id, "created", description,
                    channel == "whatsapp" ? "bot" : "web");
  return true;
}

bool findTicketByCodePg(const std::string &databaseUrl, const std::string &code,
                        TicketRecord &out) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const std::string sql =
      std::string("SELECT ") + kTicketColumns +
      " FROM support_ticket WHERE upper(code) = upper($1)";
  const char *params[1] = {code.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return false;
  out = ticketFromRow(res.get(), 0);
  return true;
}

bool updateTicketStatusPg(const std::string &databaseUrl, const std::string &code,
                          const std::string &newStatus, const std::string &actor,
                          const std::string &detail, TicketRecord &out,
                          std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string sql =
      std::string("UPDATE support_ticket SET status = $2, updated_at = now(), "
                   "resolved_at = CASE WHEN $2 IN ('resuelto','cerrado') THEN now() "
                   "ELSE resolved_at END "
                   "WHERE upper(code) = upper($1) RETURNING ") +
      kTicketColumns;
  const char *params[2] = {code.c_str(), newStatus.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "ticket_not_found";
    return false;
  }
  out = ticketFromRow(res.get(), 0);
  insertTicketEvent(conn, out.id, "status_changed", detail, actor);
  return true;
}

bool getOrCreateConversationPg(const std::string &databaseUrl,
                               const std::string &phoneE164, const std::string &lineId,
                               ConversationRecord &out) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  // ON CONFLICT DO UPDATE (no-op real) en vez de DO NOTHING: así RETURNING
  // siempre trae la fila, exista o no antes de este INSERT. Se escopa por
  // (phone_e164, line_id) -- ADR-113: el mismo número puede tener una
  // conversación independiente por cada línea de WhatsApp (soporte,
  // comercial, ...).
  const char *params[2] = {phoneE164.c_str(), lineId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO whatsapp_conversation (phone_e164, line_id) VALUES ($1, $2) "
      "ON CONFLICT (phone_e164, line_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164 "
      "RETURNING phone_e164, line_id, state, context::text, COALESCE(tenant_id::text,''), "
      "last_message_at::text, (now() - last_message_at) > interval '30 minutes'",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return false;

  out.phoneE164 = PQgetvalue(res.get(), 0, 0);
  out.lineId = PQgetvalue(res.get(), 0, 1);
  out.state = PQgetvalue(res.get(), 0, 2);
  try {
    auto parsed = json::parse(PQgetvalue(res.get(), 0, 3));
    out.context = parsed.is_object() ? parsed.as_object() : json::object{};
  } catch (...) {
    out.context = json::object{};
  }
  out.tenantId = PQgetvalue(res.get(), 0, 4);
  out.lastMessageAt = PQgetvalue(res.get(), 0, 5);
  out.isStale = std::string(PQgetvalue(res.get(), 0, 6)) == "t";
  return true;
}

bool saveConversationStatePg(const std::string &databaseUrl,
                             const std::string &phoneE164, const std::string &lineId,
                             const std::string &state,
                             const json::object &context, const std::string &tenantId) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const std::string contextJson = json::serialize(json::value(context));
  const char *params[5] = {phoneE164.c_str(), state.c_str(), contextJson.c_str(),
                           tenantId.c_str(), lineId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE whatsapp_conversation SET state = $2, context = $3::jsonb, "
      "tenant_id = NULLIF($4,'')::uuid, last_message_at = now() "
      "WHERE phone_e164 = $1 AND line_id = $5",
      5, nullptr, params, nullptr, nullptr, 0)};
  return res.okCommand();
}

void appendMessageLogPg(const std::string &databaseUrl, const std::string &phoneE164,
                        const std::string &lineId, const std::string &direction,
                        const std::string &messageType,
                        const json::value &payload, const std::string &waMessageId) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return;

  const std::string payloadJson = json::serialize(payload);
  const char *params[6] = {phoneE164.c_str(), lineId.c_str(), direction.c_str(),
                           messageType.c_str(), payloadJson.c_str(), waMessageId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO whatsapp_message_log (phone_e164, line_id, direction, message_type, "
      "payload, wa_message_id) VALUES ($1, $2, $3, $4, $5::jsonb, NULLIF($6,''))",
      6, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    std::cerr << "[SUPPORT] fallo al registrar whatsapp_message_log: " << res.error()
              << std::endl;
  }
}

bool isWaMessageAlreadyLoggedPg(const std::string &databaseUrl, const std::string &waMessageId) {
  if (waMessageId.empty()) return false;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const char *params[1] = {waMessageId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT 1 FROM whatsapp_message_log WHERE wa_message_id = $1 AND direction = 'in' LIMIT 1",
      1, nullptr, params, nullptr, nullptr, 0)};
  return res.okTuples() && PQntuples(res.get()) > 0;
}

namespace {

constexpr const char *kContactNumberColumns =
    "contact_key, label, phone_e164, updated_at::text, updated_by";

ContactNumberRecord contactNumberFromRow(PGresult *res, int row) {
  ContactNumberRecord c;
  c.key = PQgetvalue(res, row, 0);
  c.label = PQgetvalue(res, row, 1);
  c.phoneE164 = PQgetvalue(res, row, 2);
  c.updatedAt = PQgetvalue(res, row, 3);
  c.updatedBy = PQgetvalue(res, row, 4);
  return c;
}

} // namespace

std::optional<ContactNumberRecord> getContactNumberPg(const std::string &databaseUrl,
                                                       const std::string &key) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return std::nullopt;

  const std::string sql =
      std::string("SELECT ") + kContactNumberColumns +
      " FROM whatsapp_contact_number WHERE contact_key = $1";
  const char *params[1] = {key.c_str()};
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return std::nullopt;
  return contactNumberFromRow(res.get(), 0);
}

std::vector<ContactNumberRecord> listContactNumbersPg(const std::string &databaseUrl) {
  std::vector<ContactNumberRecord> out;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return out;

  const std::string sql =
      std::string("SELECT ") + kContactNumberColumns +
      " FROM whatsapp_contact_number ORDER BY contact_key";
  storage::PgResult res{
      PQexecParams(conn, sql.c_str(), 0, nullptr, nullptr, nullptr, nullptr, 0)};
  if (!res.okTuples()) return out;
  for (int i = 0; i < PQntuples(res.get()); ++i) {
    out.push_back(contactNumberFromRow(res.get(), i));
  }
  return out;
}

bool setContactNumberPg(const std::string &databaseUrl, const std::string &key,
                        const std::string &label, const std::string &phoneE164,
                        const std::string &updatedBy, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const char *params[4] = {key.c_str(), label.c_str(), phoneE164.c_str(), updatedBy.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO whatsapp_contact_number (contact_key, label, phone_e164, updated_by) "
      "VALUES ($1, $2, $3, $4) "
      "ON CONFLICT (contact_key) DO UPDATE SET label = EXCLUDED.label, "
      "phone_e164 = EXCLUDED.phone_e164, updated_at = now(), updated_by = EXCLUDED.updated_by",
      4, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    error = "contact_number_upsert_failed: " + res.error();
    return false;
  }
  return true;
}

std::string persistChatMessagePg(const std::string &databaseUrl,
                                 const std::string &conversationId,
                                 const std::string &tenantId, const std::string &userId,
                                 const std::string &channel, const std::string &role,
                                 const std::string &content, const std::string &intent) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return conversationId;

  const char *params[7] = {conversationId.c_str(), tenantId.c_str(), userId.c_str(),
                           channel.c_str(), role.c_str(), content.c_str(), intent.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO support_chat_message (conversation_id, tenant_id, user_id, channel, role, "
      "content, intent) VALUES (COALESCE(NULLIF($1,'')::uuid, gen_random_uuid()), "
      "NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, NULLIF($7,'')) "
      "RETURNING conversation_id::text",
      7, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    std::cerr << "[SUPPORT] fallo al registrar support_chat_message: " << res.error() << std::endl;
    return conversationId;
  }
  return PQgetvalue(res.get(), 0, 0);
}

namespace {

/** @brief Igual que TicketRecord::toJson() pero agrega id/phone_e164/tenant_id
 * -- omitidos a propósito en toJson() porque esa función también sirve la
 * consulta PÚBLICA por código (GET /api/support/tickets/{code}, sin sesión).
 * Este builder es solo para el panel admin (RBAC soporte.view/manage/
 * departamento), donde sí corresponde exponerlos. */
json::object ticketAdminJson(const TicketRecord &t) {
  json::object jo = t.toJson();
  jo["id"] = t.id;
  jo["phone_e164"] = t.phoneE164.empty() ? json::value(nullptr) : json::value(t.phoneE164);
  jo["tenant_id"] = t.tenantId.empty() ? json::value(nullptr) : json::value(t.tenantId);
  return jo;
}

/** @brief Arma una cláusula SQL dinámica sobre `paramStorage` (memoria
 * estable para PQexecParams) -- mismo helper para tickets y chat-messages,
 * ambos con el mismo problema (filtros opcionales, numeración $N variable). */
struct DynamicWhere {
  std::vector<std::string> paramStorage;
  std::vector<std::string> clauses;

  std::string addParam(const std::string &value) {
    paramStorage.push_back(value);
    return "$" + std::to_string(paramStorage.size());
  }

  std::string sql() const {
    if (clauses.empty()) return "";
    std::string out = " WHERE ";
    for (size_t i = 0; i < clauses.size(); ++i) {
      if (i > 0) out += " AND ";
      out += clauses[i];
    }
    return out;
  }

  std::vector<const char *> paramPointers() const {
    std::vector<const char *> out;
    out.reserve(paramStorage.size());
    for (auto &s : paramStorage) out.push_back(s.c_str());
    return out;
  }
};

} // namespace

TicketSearchPageResult searchTicketsPg(const std::string &databaseUrl,
                                       const TicketSearchFilter &filter) {
  TicketSearchPageResult out;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return out;

  DynamicWhere where;
  if (filter.tenantId && !filter.tenantId->empty())
    where.clauses.push_back("tenant_id = " + where.addParam(*filter.tenantId) + "::uuid");
  if (filter.category && !filter.category->empty())
    where.clauses.push_back("category = " + where.addParam(*filter.category));
  if (filter.status && !filter.status->empty())
    where.clauses.push_back("status = " + where.addParam(*filter.status));
  if (filter.channel && !filter.channel->empty())
    where.clauses.push_back("channel = " + where.addParam(*filter.channel));
  if (filter.priority && !filter.priority->empty())
    where.clauses.push_back("priority = " + where.addParam(*filter.priority));
  if (filter.q && !filter.q->empty()) {
    const std::string p = where.addParam("%" + *filter.q + "%");
    where.clauses.push_back("(code ILIKE " + p + " OR subject ILIKE " + p +
                            " OR description ILIKE " + p + " OR contact_name ILIKE " + p +
                            " OR phone_e164 ILIKE " + p + ")");
  }
  if (filter.dateFrom && !filter.dateFrom->empty())
    where.clauses.push_back("created_at >= " + where.addParam(*filter.dateFrom) + "::date");
  if (filter.dateTo && !filter.dateTo->empty())
    where.clauses.push_back("created_at < (" + where.addParam(*filter.dateTo) +
                            "::date + interval '1 day')");

  const std::string whereSql = where.sql();

  {
    const std::string sql = "SELECT count(*) FROM support_ticket" + whereSql;
    const auto params = where.paramPointers();
    storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()),
                                       nullptr, params.empty() ? nullptr : params.data(),
                                       nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) == 1) out.total = std::atol(PQgetvalue(res.get(), 0, 0));
  }

  const std::string limitParam = where.addParam(std::to_string(std::max(1, std::min(filter.limit, 100))));
  const std::string offsetParam = where.addParam(std::to_string(std::max(0, filter.offset)));
  const std::string sql = std::string("SELECT ") + kTicketColumns + " FROM support_ticket" +
                          whereSql + " ORDER BY created_at DESC LIMIT " + limitParam +
                          " OFFSET " + offsetParam;
  const auto params = where.paramPointers();
  storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()), nullptr,
                                     params.data(), nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      out.items.push_back(ticketAdminJson(ticketFromRow(res.get(), i)));
    }
  }
  return out;
}

ChatMessageSearchPageResult searchChatMessagesPg(const std::string &databaseUrl,
                                                 const ChatMessageSearchFilter &filter) {
  ChatMessageSearchPageResult out;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return out;

  DynamicWhere where;
  if (filter.tenantId && !filter.tenantId->empty())
    where.clauses.push_back("tenant_id = " + where.addParam(*filter.tenantId) + "::uuid");
  if (filter.conversationId && !filter.conversationId->empty())
    where.clauses.push_back("conversation_id = " + where.addParam(*filter.conversationId) + "::uuid");
  if (filter.q && !filter.q->empty())
    where.clauses.push_back("content ILIKE " + where.addParam("%" + *filter.q + "%"));
  if (filter.dateFrom && !filter.dateFrom->empty())
    where.clauses.push_back("created_at >= " + where.addParam(*filter.dateFrom) + "::date");
  if (filter.dateTo && !filter.dateTo->empty())
    where.clauses.push_back("created_at < (" + where.addParam(*filter.dateTo) +
                            "::date + interval '1 day')");

  const std::string whereSql = where.sql();

  {
    const std::string sql = "SELECT count(*) FROM support_chat_message" + whereSql;
    const auto params = where.paramPointers();
    storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()),
                                       nullptr, params.empty() ? nullptr : params.data(),
                                       nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) == 1) out.total = std::atol(PQgetvalue(res.get(), 0, 0));
  }

  const std::string limitParam = where.addParam(std::to_string(std::max(1, std::min(filter.limit, 100))));
  const std::string offsetParam = where.addParam(std::to_string(std::max(0, filter.offset)));
  const std::string sql =
      "SELECT id, conversation_id::text, COALESCE(tenant_id::text,''), COALESCE(user_id::text,''), "
      "channel, role, content, COALESCE(intent,''), created_at::text FROM support_chat_message" +
      whereSql + " ORDER BY created_at DESC LIMIT " + limitParam + " OFFSET " + offsetParam;
  const auto params = where.paramPointers();
  storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()), nullptr,
                                     params.data(), nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      out.items.push_back(json::object{
          {"id", PQgetvalue(res.get(), i, 0)},
          {"conversation_id", PQgetvalue(res.get(), i, 1)},
          {"tenant_id", std::string(PQgetvalue(res.get(), i, 2)).empty()
                            ? json::value(nullptr)
                            : json::value(PQgetvalue(res.get(), i, 2))},
          {"user_id", std::string(PQgetvalue(res.get(), i, 3)).empty()
                          ? json::value(nullptr)
                          : json::value(PQgetvalue(res.get(), i, 3))},
          {"channel", PQgetvalue(res.get(), i, 4)},
          {"role", PQgetvalue(res.get(), i, 5)},
          {"content", PQgetvalue(res.get(), i, 6)},
          {"intent", std::string(PQgetvalue(res.get(), i, 7)).empty()
                         ? json::value(nullptr)
                         : json::value(PQgetvalue(res.get(), i, 7))},
          {"created_at", PQgetvalue(res.get(), i, 8)},
      });
    }
  }
  return out;
}

namespace {

/** @brief Mismo criterio que sha256Hex() en tenant_assets_routes.cpp
 * (duplicado a propósito, ver convención de helper mínimo autocontenido por
 * archivo ya establecida en este codebase) -- se calcula en C++ vía openssl
 * en vez de sha256()/digest() de SQL para no depender de que la extensión
 * pgcrypto esté habilitada en la instancia. */
std::string sha256HexAttachment(const std::vector<unsigned char> &data) {
  unsigned char digest[SHA256_DIGEST_LENGTH];
  SHA256(data.data(), data.size(), digest);
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (unsigned char b : digest) oss << std::setw(2) << static_cast<int>(b);
  return oss.str();
}

} // namespace

bool saveChatAttachmentPg(const std::string &databaseUrl, const std::string &conversationId,
                          const std::string &tenantId, const std::string &userId,
                          const std::string &filename, const std::string &mimeType,
                          const std::vector<unsigned char> &fileBytes,
                          ChatAttachmentRecord &out, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string contentB64 = encodeBase64(fileBytes);
  const std::string hash = sha256HexAttachment(fileBytes);
  const std::string sizeStr = std::to_string(fileBytes.size());
  const char *params[8] = {
      conversationId.c_str(), tenantId.c_str(), userId.c_str(), filename.c_str(),
      mimeType.c_str(),       contentB64.c_str(), hash.c_str(),  sizeStr.c_str(),
  };
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO support_chat_attachment (conversation_id, tenant_id, user_id, filename, "
      "mime_type, content, content_sha256, size_bytes) VALUES (NULLIF($1,'')::uuid, "
      "NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, decode($6,'base64'), $7, $8::bigint) "
      "RETURNING id::text, filename, mime_type, size_bytes, created_at::text",
      8, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "attachment_insert_failed: " + res.error();
    return false;
  }
  out.id = PQgetvalue(res.get(), 0, 0);
  out.filename = PQgetvalue(res.get(), 0, 1);
  out.mimeType = PQgetvalue(res.get(), 0, 2);
  out.sizeBytes = std::atol(PQgetvalue(res.get(), 0, 3));
  out.createdAt = PQgetvalue(res.get(), 0, 4);
  out.conversationId = conversationId;
  return true;
}

bool getChatAttachmentPg(const std::string &databaseUrl, const std::string &attachmentId,
                         const std::string &tenantId, std::vector<unsigned char> &fileBytes,
                         std::string &mimeType, std::string &filename) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const char *params[2] = {attachmentId.c_str(), tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT encode(content,'base64'), mime_type, filename FROM support_chat_attachment "
      "WHERE id = $1::uuid AND (tenant_id = NULLIF($2,'')::uuid OR tenant_id IS NULL)",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return false;
  const std::string contentB64 = PQgetvalue(res.get(), 0, 0);
  if (!decodeBase64(contentB64, fileBytes)) return false;
  mimeType = PQgetvalue(res.get(), 0, 1);
  filename = PQgetvalue(res.get(), 0, 2);
  return true;
}

#endif // HAS_LIBPQ

} // namespace support
