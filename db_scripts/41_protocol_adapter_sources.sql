-- ============================================================================
-- 41 — ADR-034: fuentes de adaptadores de protocolo (Modbus TCP / OPC UA)
-- ============================================================================
-- MQTT y HTTP son protocolos "push" (el dispositivo inicia la conexión) y no
-- necesitan configuración de origen: MQTT llega por el broker Mosquitto y
-- HTTP por POST /api/mining/telemetry con API key de dispositivo (ADR-034).
-- Modbus TCP y OPC UA son "pull": la plataforma actúa como maestro/cliente y
-- sondea PLCs / servidores OPC UA remotos — esta tabla define QUÉ sondear.
--
-- connection (jsonb):
--   modbus_tcp: {"host": "10.0.0.5", "port": 502, "unit_id": 1}
--   opcua:      {"endpoint": "opc.tcp://10.0.0.9:4840"}
-- mappings (jsonb, array):
--   modbus_tcp: [{"address": 0, "reg_type": "holding"|"input",
--                 "data_type": "u16"|"s16"|"u32"|"s32"|"f32",
--                 "scale": 0.1, "sensor_code": "TEMP-PLC-01"}]
--   opcua:      [{"node_id": "ns=2;i=42", "sensor_code": "TEMP-OPC-01"}]
--
-- El sensor_code de cada mapping debe existir en `sensors` (ADR-034 device
-- management); el adaptador descarta lecturas de códigos no registrados
-- exactamente igual que el resto del pipeline (dropped_unknown en métricas).

CREATE TABLE IF NOT EXISTS protocol_adapter_sources (
    source_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    protocol         text NOT NULL CHECK (protocol IN ('modbus_tcp', 'opcua')),
    label            text NOT NULL,
    enabled          boolean NOT NULL DEFAULT true,
    connection       jsonb NOT NULL,
    mappings         jsonb NOT NULL DEFAULT '[]'::jsonb,
    poll_interval_ms integer NOT NULL DEFAULT 5000
                     CHECK (poll_interval_ms BETWEEN 250 AND 3600000),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protocol_sources_enabled
    ON protocol_adapter_sources (protocol) WHERE enabled;

COMMENT ON TABLE protocol_adapter_sources IS
    'ADR-034: orígenes de sondeo para adaptadores pull (Modbus TCP maestro, cliente OPC UA). Los adaptadores releen esta tabla periódicamente — agregar/deshabilitar fuentes no requiere reiniciar el backend.';
