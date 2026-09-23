-- ============================================================================
-- 104_alarm_rule_inactivity.sql
-- ADR-193: agrega condition_type='inactivity' a platform_alarm_rules (db_scripts/38,
-- extendida por db_scripts/89 con 'value'/'rate'). No agrega columnas nuevas --
-- una regla de inactividad reutiliza `operator`/`threshold` con un significado
-- distinto: `threshold` = segundos de silencio tolerados, `operator` debe ser
-- 'gt' (alarma cuando el tiempo sin reportar es MAYOR al umbral). La sanidad
-- de `operator` la valida el backend (handleCreateAlarmRule/handleUpdateAlarmRule
-- en device_alarm_routes.cpp), no un CHECK nuevo -- el CHECK existente de
-- operator (gt/gte/lt/lte/eq) ya lo acepta sin cambios.
-- ============================================================================
BEGIN;

ALTER TABLE platform_alarm_rules
    DROP CONSTRAINT IF EXISTS platform_alarm_rules_condition_type_check;

ALTER TABLE platform_alarm_rules
    ADD CONSTRAINT platform_alarm_rules_condition_type_check
    CHECK (condition_type IN ('value', 'rate', 'inactivity'));

COMMENT ON COLUMN platform_alarm_rules.condition_type IS
    'value = compara observed_value directo contra threshold (comportamiento original, ADR-034). rate = compara la tasa de cambio en unidades/minuto contra threshold (SPEC-016). inactivity = compara segundos transcurridos desde sensors.last_seen_at contra threshold -- requiere sensor_id real (no aplica a mining_sensor_id, que no tiene conexión de dispositivo detrás) y operator=''gt'' por convención (ver ADR-193, evaluateRulesOnce en device_alarm_routes.cpp).';

COMMIT;
