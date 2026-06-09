-- =============================================================================
-- 26_mining_runtime_kpis.sql
-- KPIs dinámicos para informes técnicos mineros (runtime desde operación).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mining_runtime_kpis (
    code TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    unit TEXT NOT NULL,
    current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    target_value DOUBLE PRECISION,
    trend_direction TEXT NOT NULL DEFAULT 'flat'
        CHECK (trend_direction IN ('up', 'down', 'flat')),
    trend_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    status_color TEXT NOT NULL DEFAULT 'green'
        CHECK (status_color IN ('green', 'yellow', 'red')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 100,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_runtime_kpi_points (
    id BIGSERIAL PRIMARY KEY,
    kpi_code TEXT NOT NULL REFERENCES mining_runtime_kpis(code) ON DELETE CASCADE,
    point_label TEXT NOT NULL,
    point_value DOUBLE PRECISION NOT NULL,
    point_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mining_runtime_kpis_cat_order
    ON mining_runtime_kpis (category, sort_order, title);
CREATE INDEX IF NOT EXISTS idx_mining_runtime_kpi_points_code_ts
    ON mining_runtime_kpi_points (kpi_code, point_ts DESC);

INSERT INTO mining_runtime_kpis
    (code, category, title, description, unit, current_value, target_value, trend_direction, trend_percent, status_color, sort_order)
VALUES
    ('tonelaje_movido', 'produccion', 'Tonelaje movido', 'Total mineral + desmonte extraído', 't/día', 12480, 12000, 'up', 4.0, 'green', 10),
    ('ley_cabeza', 'produccion', 'Ley de cabeza', 'Contenido metálico en mineral alimentado', 'g/t', 2.15, 2.25, 'down', -2.8, 'yellow', 20),
    ('recuperacion_metalurgica', 'produccion', 'Recuperación metalúrgica', '% de metal recuperado en planta', '%', 90.4, 91.0, 'flat', -0.6, 'yellow', 30),
    ('factor_dilucion', 'produccion', 'Factor de dilución', 'Ingreso de material estéril al minado', '%', 8.9, 8.0, 'down', -1.2, 'yellow', 40),
    ('disponibilidad_mecanica', 'produccion', 'Disponibilidad mecánica', 'Tiempo equipo disponible vs total', '%', 87.2, 85.0, 'up', 2.1, 'green', 50),
    ('trifr', 'seguridad_ambiente', 'TRIFR', 'Tasa de lesiones registrables', 'casos/millón HH', 1.1, 1.0, 'down', -0.2, 'yellow', 110),
    ('indice_frecuencia_accidentes', 'seguridad_ambiente', 'Índice frecuencia accidentes', 'Indicador IF de seguridad', 'IF', 0.92, 0.85, 'down', -0.1, 'yellow', 120),
    ('consumo_agua_tonelada', 'seguridad_ambiente', 'Consumo de agua por tonelada', 'Consumo hídrico unitario', 'm3/t', 0.87, 0.82, 'down', -0.4, 'yellow', 130),
    ('emisiones_polvo', 'seguridad_ambiente', 'Emisiones de polvo', 'Material particulado en suspensión', 'mg/m3', 71, 65, 'down', -1.5, 'yellow', 140),
    ('aisc', 'costos_operativos', 'AISC', 'All-in sustaining cost', 'USD/t', 114.3, 108.0, 'down', -2.2, 'yellow', 210),
    ('costo_minado', 'costos_operativos', 'Costo de minado', 'Costo por tonelada movida', 'USD/t movida', 35.8, 33.5, 'down', -1.7, 'yellow', 220),
    ('costo_planta', 'costos_operativos', 'Costo de planta', 'Costo por tonelada procesada', 'USD/t procesada', 27.4, 26.0, 'down', -1.1, 'yellow', 230),
    ('cash_cost', 'costos_operativos', 'Cash Cost', 'Costo directo unitario', 'USD/oz', 84.9, 80.0, 'down', -2.9, 'yellow', 240)
ON CONFLICT (code) DO UPDATE SET
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    unit = EXCLUDED.unit,
    target_value = EXCLUDED.target_value,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

-- Serie histórica demo para mini-gráfico en informes (solo si el KPI aún no tiene puntos semilla).
INSERT INTO mining_runtime_kpi_points (kpi_code, point_label, point_value, point_ts)
SELECT k.code,
  'seed_d_' || g::text,
  GREATEST(0.0001, k.current_value * (0.92 + (g::numeric * 0.02) / 7.0)),
  NOW() - ((8 - g) * interval '6 hours')
FROM mining_runtime_kpis k
CROSS JOIN generate_series(1, 7) AS g
WHERE NOT EXISTS (
  SELECT 1 FROM mining_runtime_kpi_points p
  WHERE p.kpi_code = k.code AND p.point_label = 'seed_d_1'
);

COMMIT;
