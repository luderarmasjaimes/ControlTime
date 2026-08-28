// --------------------------------------------------------------------------
// thingsboard_sync.hpp — Sincronización desde ThingsBoard (plataforma legacy
// de telemetría minera, hoy en AWS) hacia nuestra plataforma.
// --------------------------------------------------------------------------
// Contexto (release R2 "Motor operacional", entregable "sync inicial con
// AWS" / "ETL programado desde AWS" del SOW): el cliente tiene una
// plataforma ThingsBoard preexistente corriendo en AWS que se está
// reemplazando por esta plataforma soberana en VPS Lima (ver ADR-034,
// "core-plataforma-iot-reemplazo-thingsboard"). Mientras dura la
// transición, ThingsBoard sigue siendo fuente de datos — este módulo la
// sincroniza en dos modos:
//
//   1) Backfill histórico/incremental (REST, `mode=bulk|incremental`):
//      pagina GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries por
//      dispositivo+key, usando una marca de agua (etl_sync_state) para no
//      re-descargar lo ya traído. Corre en background cada
//      BEEMETRY_TB_BACKFILL_INTERVAL_MS.
//   2) Tiempo real (WebSocket, `mode=realtime_forward`): se suscribe a
//      /api/ws/plugins/telemetry por dispositivo+key y reenvía cada push
//      apenas llega, sin esperar al próximo ciclo de backfill.
//
// Ambos modos normalizan al mismo evento canónico y lo entregan a
// TelemetryIngestor::enqueue() (mismo pipeline probado para 10k
// sensores/seg que usan MQTT/Modbus/OPC-UA, ver protocol_adapters.hpp) —
// con la diferencia de que aquí SÍ se preserva la fecha real de captura
// del dato (TelemetryRow::captured_at_epoch_ms), no "ahora", porque el
// backfill trae datos del pasado.
//
// Mapeo dispositivo+key de ThingsBoard → sensor_code propio: se usa la
// columna `sensors.external_id` (ya existente, pensada para esto) con la
// convención `"tb:<device_uuid>:<key_name>"`. Un dispositivo ThingsBoard
// con varias keys de telemetría se mapea a varias filas de `sensors`, una
// por key — coherente con el modelo "1 sensor = 1 métrica" ya usado por
// el resto de la plataforma.
//
// Configuración: fila(s) en `etl_sync_peer` (db_scripts/18) con
// `auth_config->>'kind' = 'thingsboard'` y `auth_config` conteniendo
// `{"username":"...","password":"..."}` — el peer se resuelve por
// `tenant_id`, así que un tenant sin peer activo simplemente no sincroniza
// (no hace falta feature-flag aparte). Fallback a variables de entorno
// (BEEMETRY_TB_URL/BEEMETRY_TB_USERNAME/BEEMETRY_TB_PASSWORD) SOLO para
// pruebas locales de un único peer sin fila en BD.
// --------------------------------------------------------------------------
#pragma once

#include <cstdint>
#include <string>

namespace mining {
namespace tbsync {

struct ThingsBoardSyncStats {
    bool          enabled{false};
    std::uint64_t peers_configured{0};
    std::uint64_t peers_authenticated{0};
    std::uint64_t login_failures{0};
    std::uint64_t backfill_runs{0};
    std::uint64_t backfill_points_ingested{0};
    std::uint64_t backfill_errors{0};
    std::uint64_t realtime_ws_connects{0};
    std::uint64_t realtime_ws_reconnects{0};
    std::uint64_t realtime_points_ingested{0};
    std::uint64_t realtime_points_dropped_unmapped{0};
    std::uint64_t realtime_errors{0};
    // Puntos descartados por captured_at fuera de rango sano (ver
    // isSaneCapturedAt() en el .cpp) — encontrado en producción: dispositivos
    // con reloj/RTC sin sincronizar o con unidad de tiempo mal escalada
    // (segundos en vez de ms) mandan ts de 1970/1990 o de décadas en el
    // futuro. Sin este filtro, esos puntos llegarían tal cual a
    // telemetry_raw con la misma fecha corrupta.
    std::uint64_t backfill_points_rejected_bad_ts{0};
    std::uint64_t realtime_points_rejected_bad_ts{0};
};

// Arranca los hilos de sync (uno de backfill + uno de tiempo real por peer
// activo). Gated por BEEMETRY_THINGSBOARD_SYNC_ENABLED (default: false —
// esto es integración con un sistema externo del cliente, no debe
// arrancar sola en un despliegue nuevo sin credenciales reales).
// Requiere que TelemetryIngestor::start() ya se haya llamado.
void startThingsBoardSync(const std::string& db_url);
void stopThingsBoardSync();

ThingsBoardSyncStats thingsBoardSyncStats();

} // namespace tbsync
} // namespace mining
