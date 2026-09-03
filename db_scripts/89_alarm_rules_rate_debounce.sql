-- ============================================================================
-- 89_alarm_rules_rate_debounce.sql
-- SPEC-016 T1/T4/T5/T9 -- extiende platform_alarm_rules (db_scripts/38,
-- ADR-034) con lo que el motor de alarmas por umbral todavía no tenía:
-- condición por TASA de cambio (no solo valor absoluto) y una ventana de
-- debounce configurable POR REGLA (antes solo existía el mecanismo distinto
-- "una alarma abierta por regla" -- idx_alarms_one_open_per_rule, que sigue
-- sin tocarse, ver ADR-016-1..5 para la distinción completa entre ambos).
-- ============================================================================
BEGIN;

ALTER TABLE platform_alarm_rules
    ADD COLUMN IF NOT EXISTS condition_type TEXT NOT NULL DEFAULT 'value';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_alarm_rules_condition_type_check'
    ) THEN
        ALTER TABLE platform_alarm_rules
            ADD CONSTRAINT platform_alarm_rules_condition_type_check
            CHECK (condition_type IN ('value', 'rate'));
    END IF;
END $$;

-- Ventana de debounce en segundos; 0 = desactivado (comportamiento anterior
-- a este script, ver evaluateRulesOnce/isWithinDebounceWindow).
ALTER TABLE platform_alarm_rules
    ADD COLUMN IF NOT EXISTS debounce_secs INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_alarm_rules_debounce_secs_check'
    ) THEN
        ALTER TABLE platform_alarm_rules
            ADD CONSTRAINT platform_alarm_rules_debounce_secs_check
            CHECK (debounce_secs >= 0);
    END IF;
END $$;

COMMENT ON COLUMN platform_alarm_rules.condition_type IS
    'value = compara observed_value directo contra threshold (comportamiento original, ADR-034). rate = compara la tasa de cambio en unidades/minuto contra threshold -- requiere al menos 2 lecturas para evaluar, ver computeRatePerMinute en alarm_rule_evaluator.cpp.';
COMMENT ON COLUMN platform_alarm_rules.debounce_secs IS
    'Ventana mínima entre disparos consecutivos de esta regla, independiente de si la alarma anterior ya se auto-resolvió. 0 = sin debounce (default, compatible con reglas creadas antes de este script). No reemplaza idx_alarms_one_open_per_rule (que evita alarmas ABIERTAS duplicadas); este debounce evita RE-notificar en ráfaga tras una resolución rápida.';

COMMIT;
