-- ============================================================================
-- 38_adr034_device_management_alarm_engine.sql
-- Cierra parcialmente ADR-034: gestión de dispositivos (identidad/credenciales,
-- más allá de metadatos de sensor) + motor de alarmas event-driven.
--
-- Alcance deliberado (ver nota de "Futuro (por demanda)" en el propio
-- ADR-034): NO incluye adaptadores de protocolo nuevos (Modbus/OPC-UA/MQTT/
-- CoAP) — el ADR mismo scopea eso fuera de v0.1 ("los protocolos en uso hoy
-- + motor de fórmulas + ingesta básica"). Esta migración cubre las otras dos
-- capacidades explícitamente listadas como faltantes: gestión de
-- dispositivos y alarmas.
--
-- Prerrequisitos: 04 (tabla sensors), 16 (fn_platform_audit_insert).
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Gestión de dispositivos: identidad/credenciales sobre la tabla `sensors`
--    ya existente (NO se crea una tercera tabla de sensores paralela —
--    ya hay `mining_sensors` y `sensors`; fragmentar más el modelo sería
--    peor que extender la que ya es la ingesta real, ADR-007/008).
-- ---------------------------------------------------------------------------
ALTER TABLE sensors
    ADD COLUMN IF NOT EXISTS device_api_key_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'legacy_tls',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN sensors.device_api_key_hash IS
    'SHA-256 (hex) de la API key del dispositivo. La key cruda solo se '
    'devuelve una vez, al registrar (mismo patrón que auth_refresh_tokens).';
COMMENT ON COLUMN sensors.protocol IS
    'Protocolo de ingesta del dispositivo: legacy_tls (mining_gateway actual, '
    'ADR-007/008) | mqtt | modbus | opcua | coap (adaptadores futuros, '
    'ver ADR-034 "Futuro (por demanda)").';
COMMENT ON COLUMN sensors.connection_status IS
    'unknown | online | offline — derivado de last_seen_at por la API de '
    'lectura (sin heartbeat activo propio en esta primera versión).';

CREATE INDEX IF NOT EXISTS idx_sensors_device_api_key_hash
    ON sensors(device_api_key_hash) WHERE device_api_key_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Motor de alarmas: reglas + eventos generados.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_alarm_rules (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    sensor_id UUID REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    mining_sensor_id INT REFERENCES mining_sensors(id) ON DELETE CASCADE,
    rule_name TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
    threshold DOUBLE PRECISION NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Una regla apunta a exactamente un origen (sensor real O mining_sensor de dashboard), no ambos ni ninguno.
    CHECK ((sensor_id IS NOT NULL)::int + (mining_sensor_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_alarm_rules_tenant_enabled
    ON platform_alarm_rules(tenant_id) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS platform_alarms (
    id BIGSERIAL PRIMARY KEY,
    rule_id BIGINT NOT NULL REFERENCES platform_alarm_rules(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observed_value DOUBLE PRECISION NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    -- Evita reinsertar la misma alarma en cada ciclo del evaluador mientras
    -- la condición se mantiene activa: una fila "abierta" (no reconocida) por
    -- regla a la vez. Índice único parcial hace de deduplicador natural.
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alarms_one_open_per_rule
    ON platform_alarms(rule_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alarms_tenant_time
    ON platform_alarms(tenant_id, triggered_at DESC);

COMMIT;
