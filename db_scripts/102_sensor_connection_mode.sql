-- ============================================================================
-- 102_sensor_connection_mode.sql
-- SPEC-027 (Fase 1) / ADR-192: metadatos ligeros de trazabilidad para
-- distinguir un sensor que se conecta directo de uno que llega a través de
-- un gateway físico de campo -- SIN modelar "Gateway" como entidad propia
-- (decisión explícita del developer, ver ADR-192 Decisión #1: el gateway
-- sigue siendo invisible al modelo de datos, tal como opera hoy).
--
-- Aditivo, nullable, sin default obligatorio -- no rompe las 78,780 filas
-- existentes de `sensors` (mismo criterio que zone_id en
-- 54_sensor_zones_and_grouping.sql). No participa en resolveSensor() ni en
-- ningún otro camino de ingesta/autenticación -- solo trazabilidad/UI.
--
-- Prerrequisitos: 04 (tabla sensors), 38 (adr034_device_management).
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

BEGIN;

ALTER TABLE sensors
    ADD COLUMN IF NOT EXISTS connection_mode TEXT
        CHECK (connection_mode IN ('direct', 'gateway')),
    ADD COLUMN IF NOT EXISTS gateway_label TEXT;

COMMENT ON COLUMN sensors.connection_mode IS
    'direct | gateway (nullable -- dato legado/no anotado todavía). Trazabilidad '
    'únicamente: un sensor "gateway" sigue siendo, para la plataforma, un sensor '
    'individual con su propia device_api_key (ADR-192) -- no cambia el flujo de '
    'ingesta ni de autenticación.';
COMMENT ON COLUMN sensors.gateway_label IS
    'Alias/identificador libre del gateway físico de campo cuando '
    'connection_mode = gateway (p.ej. "GW-NORTE-03"). Texto libre, no FK -- '
    'no se modela una entidad Gateway (ADR-192).';

COMMIT;
