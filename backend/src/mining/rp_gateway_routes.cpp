#include "rp_gateway_routes.hpp"
#include "rp_odoo_sync.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_types.hpp"
#include "../auth/permissions.hpp"

#include <algorithm>
#include <cstdlib>
#include <string>

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using http_utils::makeJsonResponse;
using auth::resolveAuthSession;
using auth::hasPermission;

#define gDatabaseUrl AppConfig::instance().gDatabaseUrl
#define gReadUrl AppConfig::instance().readUrl()

namespace mining {
namespace rp_gateway {

namespace {

// ── Auth del webhook: API key de servicio, NUNCA JWT (ver ADR-103) ───────
bool constantTimeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (std::size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

std::string envOr(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::string(v) : def;
}

#if HAS_LIBPQ
// Peer activo de TimeTelemetry para un tenant -- una sola fila esperada por
// tenant (si hay varias, se toma la primera; ADR-103 no contempla más de un
// peer 'timetelemetry' activo por tenant en esta versión).
bool findActivePeerForTenant(const std::string& tenantId, std::string& peerIdOut) {
    storage::PgConn conn{PQconnectdb(gDatabaseUrl.c_str())};
    if (!conn.ok()) return false;
    const char* params[1] = {tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "SELECT peer_id FROM etl_sync_peer "
        "WHERE tenant_id = $1::uuid AND is_active AND auth_config->>'kind' = 'timetelemetry' "
        "LIMIT 1",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return false;
    peerIdOut = PQgetvalue(res.get(), 0, 0);
    return true;
}

json::object equipmentRowToJson(PGresult* res, int row) {
    auto col = [&](int idx) -> std::string {
        return PQgetisnull(res, row, idx) ? std::string() : std::string(PQgetvalue(res, row, idx));
    };
    json::object o;
    o["equipment_id"] = col(0);
    o["external_id"] = col(1).empty() ? json::value(nullptr) : json::value(std::stoll(col(1)));
    o["codigo"] = col(2);
    o["name"] = col(3);
    o["category_id"] = col(4).empty() ? json::value(nullptr) : json::value(std::stoll(col(4)));
    o["category_name"] = col(5);
    o["project_id"] = col(6).empty() ? json::value(nullptr) : json::value(std::stoll(col(6)));
    o["project_name"] = col(7);
    o["state"] = col(8);
    o["serial_no"] = col(9);
    o["location"] = col(10);
    o["latitude"] = col(11).empty() ? json::value(nullptr) : json::value(std::stod(col(11)));
    o["longitude"] = col(12).empty() ? json::value(nullptr) : json::value(std::stod(col(12)));
    o["assigned_user"] = col(13);
    o["odoo_write_date"] = col(14);
    o["sync_status"] = col(15);
    o["last_sync_error"] = col(16);
    o["updated_at"] = col(17);
    return o;
}

constexpr const char* kListColumns =
    "equipment_id, external_id, codigo, name, category_id, category_name, "
    "project_id, project_name, state, serial_no, location, latitude, longitude, "
    "assigned_user, odoo_write_date, sync_status, last_sync_error, updated_at";

// Lista blanca de campos escribibles hacia Odoo -- lo demás del body se
// ignora, nunca se reenvía tal cual (evita que el frontend pueda inyectar
// claves arbitrarias en el execute_kw 'create'/'write').
json::object buildWritablePayload(const json::object& body) {
    json::object payload;
    auto copyIfPresent = [&](const char* key) {
        if (const auto* v = body.if_contains(key); v) payload[key] = *v;
    };
    copyIfPresent("name");
    copyIfPresent("codigo");
    copyIfPresent("category_id");
    copyIfPresent("project_id");
    copyIfPresent("state");
    copyIfPresent("serial_no");
    copyIfPresent("location");
    copyIfPresent("latitude");
    copyIfPresent("longitude");
    return payload;
}
#endif

} // namespace

// ── GET /api/rp/equipment ──────────────────────────────────────────────
static http::response<http::string_body>
handleListEquipment(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    if (session->tenantId.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
    if (!hasPermission(session->userId, session->tenantId, session->role, "rp.equipment.view")) {
        return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}, {"need", "rp.equipment.view"}});
    }
#if HAS_LIBPQ
    int limit = 50, offset = 0;
    if (const auto it = query.find("limit"); it != query.end()) {
        try { limit = std::clamp(std::stoi(it->second), 1, 500); } catch (...) {}
    }
    if (const auto it = query.find("offset"); it != query.end()) {
        try { offset = std::max(0, std::stoi(it->second)); } catch (...) {}
    }
    const std::string codigoFilter = query.count("codigo") ? query.at("codigo") : "";
    const std::string stateFilter = query.count("state") ? query.at("state") : "";

    auto lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::service_unavailable, json::object{{"error", "replica_unavailable"}});
    }
    const std::string limitStr = std::to_string(limit);
    const std::string offsetStr = std::to_string(offset);
    const char* params[5] = {session->tenantId.c_str(), limitStr.c_str(), offsetStr.c_str(),
                             codigoFilter.empty() ? nullptr : codigoFilter.c_str(),
                             stateFilter.empty() ? nullptr : stateFilter.c_str()};
    std::string sql = std::string("SELECT ") + kListColumns +
        " FROM rp_equipment WHERE tenant_id = $1::uuid "
        " AND ($4::text IS NULL OR codigo = $4) "
        " AND ($5::text IS NULL OR state = $5) "
        " ORDER BY updated_at DESC LIMIT $2::int OFFSET $3::int";
    storage::PgResult res{PQexecParams(conn, sql.c_str(), 5, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples()) {
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
    }
    json::array items;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) items.push_back(equipmentRowToJson(res.get(), i));
    return makeJsonResponse(http::status::ok, json::object{{"items", items}, {"limit", limit}, {"offset", offset}});
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

// ── GET /api/rp/equipment/{id}[/sync-status] ───────────────────────────
static http::response<http::string_body>
handleEquipmentDetailOrSyncStatus(const http::request<http::string_body>& req,
                                  const std::unordered_map<std::string, std::string>& query) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    if (session->tenantId.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
    if (!hasPermission(session->userId, session->tenantId, session->role, "rp.equipment.view")) {
        return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}, {"need", "rp.equipment.view"}});
    }
#if HAS_LIBPQ
    static const std::string kPrefix = "/api/rp/equipment/";
    std::string tail = http_utils::routePathOnly(std::string(req.target()));
    if (tail.size() <= kPrefix.size()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_id"}});
    tail = tail.substr(kPrefix.size());
    static const std::string kSyncStatusSuffix = "/sync-status";
    bool wantSyncStatus = false;
    if (tail.size() > kSyncStatusSuffix.size() &&
        tail.compare(tail.size() - kSyncStatusSuffix.size(), kSyncStatusSuffix.size(), kSyncStatusSuffix) == 0) {
        wantSyncStatus = true;
        tail = tail.substr(0, tail.size() - kSyncStatusSuffix.size());
    }
    if (tail.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_id"}});

    auto lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::service_unavailable, json::object{{"error", "replica_unavailable"}});
    }
    const char* params[2] = {tail.c_str(), session->tenantId.c_str()};
    if (wantSyncStatus) {
        storage::PgResult res{PQexecParams(conn,
            "SELECT sync_status, last_sync_error FROM rp_equipment WHERE equipment_id = $1::uuid AND tenant_id = $2::uuid",
            2, nullptr, params, nullptr, nullptr, 0)};
        if (!res.okTuples() || PQntuples(res.get()) == 0) {
            return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
        }
        json::object o;
        o["sync_status"] = PQgetvalue(res.get(), 0, 0);
        o["last_sync_error"] = PQgetisnull(res.get(), 0, 1) ? "" : PQgetvalue(res.get(), 0, 1);
        return makeJsonResponse(http::status::ok, o);
    }
    std::string sql = std::string("SELECT ") + kListColumns + ", raw_json::text"
        " FROM rp_equipment WHERE equipment_id = $1::uuid AND tenant_id = $2::uuid";
    storage::PgResult res{PQexecParams(conn, sql.c_str(), 2, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) {
        return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
    }
    json::object o = equipmentRowToJson(res.get(), 0);
    try { o["raw"] = json::parse(PQgetvalue(res.get(), 0, 18)); } catch (...) { o["raw"] = json::object{}; }
    return makeJsonResponse(http::status::ok, o);
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

// ── POST /api/rp/equipment ─────────────────────────────────────────────
static http::response<http::string_body>
handleCreateEquipment(const http::request<http::string_body>& req,
                      const std::unordered_map<std::string, std::string>& query) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    if (session->tenantId.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
    if (!hasPermission(session->userId, session->tenantId, session->role, "rp.equipment.edit")) {
        return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}, {"need", "rp.equipment.edit"}});
    }
#if HAS_LIBPQ
    json::object body;
    try {
        const auto parsed = json::parse(req.body());
        if (!parsed.is_object()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_body"}});
        body = parsed.as_object();
    } catch (...) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
    }
    if (!body.if_contains("name") && !body.if_contains("codigo")) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "name_or_codigo_required"}});
    }

    std::string peerId;
    if (!findActivePeerForTenant(session->tenantId, peerId)) {
        return makeJsonResponse(http::status::service_unavailable,
                                json::object{{"error", "rp_not_configured"},
                                             {"detail", "No hay un peer TimeTelemetry activo para este tenant."}});
    }

    auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
    }

    const json::object writable = buildWritablePayload(body);
    const std::string writableJson = json::serialize(writable);
    const std::string codigo = writable.if_contains("codigo") ? json::value_to<std::string>(*writable.if_contains("codigo")) : "";
    const std::string name = writable.if_contains("name") ? json::value_to<std::string>(*writable.if_contains("name")) : "";

    storage::PgResult beginRes{PQexec(conn, "BEGIN")};
    const char* insertParams[5] = {session->tenantId.c_str(), peerId.c_str(),
                                   codigo.empty() ? nullptr : codigo.c_str(),
                                   name.empty() ? nullptr : name.c_str(), writableJson.c_str()};
    storage::PgResult insertRes{PQexecParams(conn,
        "INSERT INTO rp_equipment (tenant_id, peer_id, external_id, codigo, name, raw_json, sync_status) "
        "VALUES ($1::uuid, $2::uuid, NULL, $3, $4, $5::jsonb, 'pending_push') RETURNING equipment_id",
        5, nullptr, insertParams, nullptr, nullptr, 0)};
    if (!insertRes.okTuples() || PQntuples(insertRes.get()) == 0) {
        storage::PgResult rollbackRes{PQexec(conn, "ROLLBACK")};
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "insert_failed"}});
    }
    const std::string equipmentId = PQgetvalue(insertRes.get(), 0, 0);
    const char* outboxParams[5] = {session->tenantId.c_str(), peerId.c_str(), equipmentId.c_str(),
                                   writableJson.c_str(), session->userId.c_str()};
    storage::PgResult outboxRes{PQexecParams(conn,
        "INSERT INTO rp_write_outbox (tenant_id, peer_id, equipment_id, operation, payload_json, created_by_user_id) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, 'create', $4::jsonb, $5::uuid)",
        5, nullptr, outboxParams, nullptr, nullptr, 0)};
    if (!outboxRes.ok()) {
        storage::PgResult rollbackRes{PQexec(conn, "ROLLBACK")};
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "outbox_insert_failed"}});
    }
    storage::PgResult commitRes{PQexec(conn, "COMMIT")};

    return makeJsonResponse(http::status::accepted,
                            json::object{{"equipment_id", equipmentId}, {"sync_status", "pending_push"}});
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

// ── PUT /api/rp/equipment/{id} ─────────────────────────────────────────
static http::response<http::string_body>
handleUpdateEquipment(const http::request<http::string_body>& req,
                      const std::unordered_map<std::string, std::string>& query) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    if (session->tenantId.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
    if (!hasPermission(session->userId, session->tenantId, session->role, "rp.equipment.edit")) {
        return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}, {"need", "rp.equipment.edit"}});
    }
#if HAS_LIBPQ
    static const std::string kPrefix = "/api/rp/equipment/";
    std::string equipmentId = http_utils::routePathOnly(std::string(req.target()));
    if (equipmentId.size() <= kPrefix.size()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_id"}});
    equipmentId = equipmentId.substr(kPrefix.size());
    if (equipmentId.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_id"}});

    json::object body;
    try {
        const auto parsed = json::parse(req.body());
        if (!parsed.is_object()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_body"}});
        body = parsed.as_object();
    } catch (...) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
    }
    const json::object writable = buildWritablePayload(body);
    if (writable.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "no_writable_fields"}});

    auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
    }

    const char* lookupParams[2] = {equipmentId.c_str(), session->tenantId.c_str()};
    storage::PgResult lookupRes{PQexecParams(conn,
        "SELECT peer_id, external_id FROM rp_equipment WHERE equipment_id = $1::uuid AND tenant_id = $2::uuid",
        2, nullptr, lookupParams, nullptr, nullptr, 0)};
    if (!lookupRes.okTuples() || PQntuples(lookupRes.get()) == 0) {
        return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
    }
    const std::string peerId = PQgetvalue(lookupRes.get(), 0, 0);
    if (PQgetisnull(lookupRes.get(), 0, 1)) {
        // El alta todavía no fue confirmada por Odoo -- no hay external_id
        // real contra el cual hacer 'write'. El frontend debe esperar a que
        // sync_status pase a 'synced' (ver GET .../sync-status) antes de editar.
        return makeJsonResponse(http::status::conflict,
                                json::object{{"error", "not_yet_synced"},
                                             {"detail", "El alta aún no fue confirmada por TimeTelemetry."}});
    }
    const long long externalId = std::stoll(PQgetvalue(lookupRes.get(), 0, 1));

    json::object outboxPayload = writable;
    outboxPayload["__external_id"] = externalId;
    const std::string payloadJson = json::serialize(outboxPayload);

    storage::PgResult beginRes{PQexec(conn, "BEGIN")};
    const char* markParams[1] = {equipmentId.c_str()};
    storage::PgResult markRes{PQexecParams(conn,
        "UPDATE rp_equipment SET sync_status = 'pending_push', updated_at = NOW() WHERE equipment_id = $1::uuid",
        1, nullptr, markParams, nullptr, nullptr, 0)};
    const char* outboxParams[5] = {session->tenantId.c_str(), peerId.c_str(), equipmentId.c_str(),
                                   payloadJson.c_str(), session->userId.c_str()};
    storage::PgResult outboxRes{PQexecParams(conn,
        "INSERT INTO rp_write_outbox (tenant_id, peer_id, equipment_id, operation, payload_json, created_by_user_id) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, 'update', $4::jsonb, $5::uuid)",
        5, nullptr, outboxParams, nullptr, nullptr, 0)};
    if (!markRes.ok() || !outboxRes.ok()) {
        storage::PgResult rollbackRes{PQexec(conn, "ROLLBACK")};
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "outbox_insert_failed"}});
    }
    storage::PgResult commitRes{PQexec(conn, "COMMIT")};

    return makeJsonResponse(http::status::accepted, json::object{{"equipment_id", equipmentId}, {"sync_status", "pending_push"}});
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

// ── POST /api/rp/webhook/odoo ──────────────────────────────────────────
// Única ruta que NO usa resolveAuthSession -- ver justificación de API key
// de servicio en rp_odoo_sync.hpp / ADR-103. El payload nunca se aplica
// directamente: solo dispara una relectura autoritativa por XML-RPC.
static http::response<http::string_body>
handleOdooWebhook(const http::request<http::string_body>& req,
                  const std::unordered_map<std::string, std::string>& /*query*/) {
    const std::string expectedKey = envOr("BEEMETRY_RP_WEBHOOK_KEY", "");
    if (expectedKey.empty()) {
        // Sin key configurada, el webhook queda deshabilitado por defecto
        // (fail-closed) -- no hay forma segura de aceptar requests sin
        // secreto contra el que compararlas.
        return makeJsonResponse(http::status::service_unavailable, json::object{{"error", "webhook_not_configured"}});
    }
    std::string providedKey;
    if (const auto it = req.find("X-RP-Webhook-Key"); it != req.end()) providedKey = std::string(it->value());
    if (!constantTimeEquals(providedKey, expectedKey)) {
        return makeJsonResponse(http::status::unauthorized, json::object{{"error", "invalid_webhook_key"}});
    }
#if HAS_LIBPQ
    std::string peerId;
    long long odooId = 0;
    try {
        const auto parsed = json::parse(req.body());
        if (parsed.is_object()) {
            const auto& obj = parsed.as_object();
            if (const auto* p = obj.if_contains("peer_id"); p && p->is_string()) peerId = json::value_to<std::string>(*p);
            if (const auto* i = obj.if_contains("id"); i && i->is_int64()) odooId = i->as_int64();
        }
    } catch (...) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
    }
    if (peerId.empty() || odooId <= 0) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_peer_id_or_id"}});
    }
    const bool ok = mining::rpsync::handleWebhookNudge(gDatabaseUrl, peerId, odooId);
    return makeJsonResponse(ok ? http::status::ok : http::status::internal_server_error,
                            json::object{{"ok", ok}});
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

void registerRoutes(router::Router& r) {
    r.get("/api/rp/equipment", handleListEquipment);
    r.get("/api/rp/equipment/", handleEquipmentDetailOrSyncStatus);  // prefix: {id} y {id}/sync-status
    r.post("/api/rp/equipment", handleCreateEquipment);
    r.put("/api/rp/equipment/", handleUpdateEquipment);              // prefix: {id}
    r.post("/api/rp/webhook/odoo", handleOdooWebhook);
}

} // namespace rp_gateway
} // namespace mining
