-- ============================================================================
-- 103_v_sensor_traceability.sql
-- SPEC-027 (Fase 0 remanente, CA-1) / ADR-192: vista de trazabilidad
-- sensor -> tipo -> protocolo -> modo de conexión -> canales -> fórmulas ->
-- reglas de alarma -> último dato conocido.
--
-- Filtro crítico: `device_api_key_hash IS NOT NULL` -- excluye los 78,777
-- sensores sintéticos de la prueba de carga de ADR-108 (BENCH25K-*/SYNC60-*/
-- LOADTEST-*) y las filas semilla/demo sin credencial emitida (ACEL-02 x12,
-- CO2-02). Sin este filtro el conteo de "sensores activos" queda falseado
-- por un factor de ~26,000x (ver ADR-192, Consecuencias). Hoy (2026-09-16)
-- este filtro deja exactamente 3 filas: PZ-VW-02, demo-vib-01, RT-TEST-01.
--
-- "Último dato conocido" se toma de `sensors.last_seen_at`/
-- `connection_status` (ya mantenidos por el propio flujo de ingesta, ver
-- telemetry_ingest.cpp) en vez de escanear `telemetry_fact` -- la hypertable
-- es costosa de tocar por sensor en una vista de lectura frecuente (mismo
-- criterio de plan.md §3: "prioriza que la vista sea rápida y no escanee
-- toda la hypertable").
--
-- Canales/fórmulas/reglas se agregan como json/array por sensor (un sensor
-- puede tener 0..N de cada uno) via LEFT JOIN + agregación, para devolver
-- una sola fila por sensor.
--
-- Prerrequisitos: 38 (device_api_key_hash/protocol/connection_status),
-- 93 (sensor_formula_def), 96 (sensor_input_channel_def),
-- 102 (connection_mode/gateway_label).
-- Idempotente: CREATE OR REPLACE VIEW, seguro de re-ejecutar.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_sensor_traceability AS
SELECT
    s.sensor_id,
    s.tenant_id,
    s.sensor_code,
    s.sensor_name,
    s.sensor_type,
    s.protocol,
    s.connection_mode,
    s.gateway_label,
    s.connection_status,
    s.last_seen_at,
    s.zone_id,
    COALESCE(chan.channels, '[]'::jsonb) AS channels,
    COALESCE(formulas.formulas, '[]'::jsonb) AS formulas,
    COALESCE(rules.alarm_rules, '[]'::jsonb) AS alarm_rules
FROM sensors s
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'channel_code', c.channel_code,
                   'data_type', c.data_type,
                   'is_required', c.is_required,
                   'sort_order', c.sort_order
               ) ORDER BY c.sort_order, c.channel_code
           ) AS channels
    FROM sensor_input_channel_def c
    WHERE c.sensor_id = s.sensor_id
) chan ON TRUE
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'formula_id', f.formula_id,
                   'formula_name', f.formula_name,
                   'output_channel_code', f.output_channel_code,
                   'enabled', f.enabled
               ) ORDER BY f.formula_name
           ) AS formulas
    FROM sensor_formula_def f
    WHERE f.sensor_id = s.sensor_id
) formulas ON TRUE
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               jsonb_build_object(
                   'rule_id', r.id,
                   'rule_name', r.rule_name,
                   'operator', r.operator,
                   'threshold', r.threshold,
                   'severity', r.severity,
                   'enabled', r.enabled
               ) ORDER BY r.rule_name
           ) AS alarm_rules
    FROM platform_alarm_rules r
    WHERE r.sensor_id = s.sensor_id
) rules ON TRUE
WHERE s.device_api_key_hash IS NOT NULL;

COMMENT ON VIEW v_sensor_traceability IS
    'SPEC-027/ADR-192: matriz de trazabilidad sensor -> canales -> fórmulas -> '
    'reglas de alarma -> último dato, SOLO sensores con credencial real '
    '(device_api_key_hash IS NOT NULL) -- excluye sintéticos de carga (ADR-108) '
    'y filas semilla/demo. No escanea telemetry_fact -- usa last_seen_at/'
    'connection_status ya mantenidos por el flujo de ingesta.';

COMMIT;
