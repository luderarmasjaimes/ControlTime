-- =============================================================================
-- 94_sensor_type_parameter_catalog.sql
-- ADR-188 -- catálogo gobernado de "tipo de sensor -> parámetros disponibles",
-- administrable por un admin de plataforma (permiso `formula.edit`, ya
-- sembrado en platform_permissions desde db_scripts/42, nunca usado hasta
-- ahora). No reemplaza sensor_input_parameter_def/_value (ADR-187, valor real
-- por sensor) -- este catálogo es la PLANTILLA por tipo que decide qué claves
-- están habilitadas para ofrecerse al configurar un sensor de ese tipo.
--
-- `sensors.sensor_type` sigue siendo TEXT libre (sin FK todavía) -- este
-- catálogo es aditivo: un sensor con un tipo no catalogado simplemente no
-- tiene plantilla de parámetros (sigue funcionando como hoy, texto libre).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sensor_type_def (
    type_code    TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_type_parameter_def (
    type_code   TEXT NOT NULL REFERENCES sensor_type_def (type_code) ON DELETE CASCADE,
    param_key   TEXT NOT NULL,
    data_type   TEXT NOT NULL DEFAULT 'numeric'
        CHECK (data_type IN ('numeric', 'text', 'boolean', 'json', 'timestamp')),
    is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INT NOT NULL DEFAULT 0,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES auth_users (id) ON DELETE SET NULL,
    PRIMARY KEY (type_code, param_key)
);

CREATE INDEX IF NOT EXISTS idx_sensor_type_param_type ON sensor_type_parameter_def (type_code);

-- Backfill: un sensor_type_def por cada valor distinto ya usado en `sensors`,
-- para que el catálogo arranque poblado en vez de vacío (sin parámetros
-- sembrados -- el admin decide cuáles habilitar por tipo).
INSERT INTO sensor_type_def (type_code, display_name)
SELECT DISTINCT sensor_type, sensor_type
FROM sensors
WHERE sensor_type IS NOT NULL AND sensor_type <> ''
ON CONFLICT (type_code) DO NOTHING;

COMMIT;
