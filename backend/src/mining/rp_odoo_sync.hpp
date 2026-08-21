// --------------------------------------------------------------------------
// rp_odoo_sync.hpp — ADR-103: sincronización RP (TimeTelemetry/Odoo 17) por
// XML-RPC hacia una réplica local, con escritura durable de vuelta.
// --------------------------------------------------------------------------
// Contexto: TimeTelemetry es Odoo 17 (https://sistema.timetelemetry.com,
// db "telemetry17"), fuente del catálogo de equipos mineros
// (maintenance.equipment). Antes de este módulo solo existían dos scripts
// de un solo uso, de solo lectura, con credenciales en texto plano
// (ver RP/*.py) — reemplazados aquí por un módulo productivo con:
//
//   1) Backfill/incremental (XML-RPC search_read, domain
//      [('write_date','>',watermark)]): pagina maintenance.equipment y hace
//      upsert en rp_equipment. Watermark en etl_sync_state.watermark_ts
//      (a diferencia de thingsboard_sync, que usa watermark_bigint — Odoo
//      trabaja con timestamps, no epoch ms).
//   2) Webhook de aceleración (POST /api/rp/webhook/odoo, ver
//      rp_gateway_routes.*): el payload NUNCA se trata como dato de negocio
//      confiable — solo dispara una relectura autoritativa por XML-RPC de
//      ese registro puntual (handleWebhookNudge). El polling incremental
//      sigue siendo el camino garantizado; el webhook solo baja la latencia
//      cuando llega.
//   3) Escritura (create/write) drenando rp_write_outbox — encolada por
//      rp_gateway_routes.* cuando el frontend nuevo hace POST/PUT. Nunca
//      SQL directo contra la BD de Odoo (ver ADR-103, riesgos descartados).
//      Backoff exponencial + jitter, dead-letter tras max_attempts.
//   4) Circuit breaker por peer: evita machacar a Odoo durante una caída.
//
// A diferencia de ThingsBoard, Odoo XML-RPC no tiene sesión expirable — cada
// llamada reenvía (db, uid, password), así que no hace falta refresh de
// JWT; solo re-autenticar si execute_kw devuelve fault de credenciales.
//
// Tras cada upsert/confirmación exitosa se emite un push WS real
// (WsRegistry::broadcastToTenant, mismo patrón que alarm_notifier.cpp /
// map_aggregator.cpp) — no hay LISTEN/NOTIFY de Postgres en este backend
// (confirmado por exploración), así que el broadcast se dispara desde el
// mismo punto del código que aplica el cambio.
//
// Gated por BEEMETRY_RP_SYNC_ENABLED (default: false) — integración con
// sistema externo del cliente, no debe arrancar sola en un despliegue nuevo
// sin credenciales reales (mismo criterio que BEEMETRY_THINGSBOARD_SYNC_ENABLED).
// --------------------------------------------------------------------------
#pragma once

#include <cstdint>
#include <string>

namespace mining {
namespace rpsync {

struct RpSyncStats {
    bool          enabled{false};
    std::uint64_t peers_configured{0};
    std::uint64_t peers_authenticated{0};
    std::uint64_t auth_failures{0};
    std::uint64_t backfill_runs{0};
    std::uint64_t backfill_upserted{0};
    std::uint64_t backfill_errors{0};
    std::uint64_t incremental_polls{0};
    std::uint64_t incremental_upserted{0};
    std::uint64_t incremental_errors{0};
    std::uint64_t webhook_nudges{0};
    std::uint64_t webhook_nudge_errors{0};
    std::uint64_t outbox_sent{0};
    std::uint64_t outbox_retried{0};
    std::uint64_t outbox_dead{0};
    std::uint64_t xmlrpc_errors{0};
    std::uint64_t circuit_open_events{0};
};

// Arranca los hilos de sync (backfill + incremental + drenado de outbox,
// uno de cada por peer activo con auth_config->>'kind'='timetelemetry').
// Requiere haberse llamado después de que la app tenga su db_url resuelta.
void startRpOdooSync(const std::string& db_url);
void stopRpOdooSync();

RpSyncStats rpSyncStats();

// Invocado por rp_gateway_routes.cpp al recibir un webhook válido de Odoo.
// NUNCA aplica los campos del payload — relee el registro por XML-RPC antes
// de tocar rp_equipment (ver justificación de seguridad en el header de
// este archivo y en ADR-103).
// @return true si se pudo procesar (registro leído y upsertado o
// confirmado inexistente); false solo ante error de transporte/config.
bool handleWebhookNudge(const std::string& db_url, const std::string& peer_id,
                        long long odoo_equipment_id);

} // namespace rpsync
} // namespace mining
