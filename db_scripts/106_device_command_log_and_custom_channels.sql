-- =============================================================================
-- 106_device_command_log_and_custom_channels.sql
-- Pedido explícito del usuario (2026-09-18): recalibración/reset remoto de
-- sensores ("enviar los comandos apropiados al sensor") + probar primero con
-- un smartphone Android (acelerómetro + GPS, sin protocolo MQTT/Modbus/OPC-UA
-- real todavía -- el teléfono llega por HTTP con API key, igual que cualquier
-- dispositivo doméstico).
--
-- Downlink real (comandos AL dispositivo) NO existía en absoluto antes de
-- esto -- confirmado por auditoría de código: protocol_adapters.cpp era
-- 100% uplink (MQTT solo se suscribe, Modbus solo lee, OPC UA solo lee).
-- Este script agrega SOLO el registro/log de comandos (transporte-agnóstico);
-- el envío real por MQTT se implementó en protocol_adapters.cpp
-- (publishMqttCommand). Modbus/OPC-UA write quedan fuera de esta pasada --
-- requieren la ficha técnica del dispositivo real (dirección de registro /
-- NodeId) que hoy no se tiene, y escribir "a ciegas" a un registro Modbus de
-- un PLC real es peligroso sin esa confirmación.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS device_command_log (
    command_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    command_type TEXT NOT NULL CHECK (command_type IN ('recalibrate', 'reset_factory', 'reconfigure')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Obligatorio: pedido explícito del usuario, "todas las acciones...
    -- incluyendo un motivo o justificación del cambio".
    reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    requested_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    -- pending: encolado, esperando entrega (HTTP poll) o falló el publish
    -- inmediato (MQTT). delivered: el dispositivo ya lo vio (HTTP poll) o el
    -- broker confirmó el publish (MQTT no tiene ack de aplicación real, así
    -- que "delivered" ahí solo significa "el broker lo aceptó", no que el
    -- dispositivo lo ejecutó -- ver `result`). completed/failed: el propio
    -- dispositivo reportó el resultado (solo posible en el camino HTTP poll,
    -- que sí tiene un endpoint de ack; MQTT es fire-and-forget salvo que el
    -- dispositivo publique su propio resultado a un tópico separado, fuera
    -- de alcance de esta pasada).
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'completed', 'failed')),
    transport TEXT NOT NULL CHECK (transport IN ('mqtt', 'http_poll', 'unsupported')),
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_command_log_sensor_pending
    ON device_command_log (sensor_id) WHERE status IN ('pending', 'delivered');
CREATE INDEX IF NOT EXISTS idx_device_command_log_tenant_time
    ON device_command_log (tenant_id, created_at DESC);

COMMIT;
