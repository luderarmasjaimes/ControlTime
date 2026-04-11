-- ============================================================
-- 09_formula_mining_reports.sql
-- Motor de formula minera para generacion de reportes (multi-tenant)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mineria_empresas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(200) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mineria_minas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    zona_tipo VARCHAR(20) NOT NULL DEFAULT 'sierra',
    umbral_temp_alerta DECIMAL(6,2) NOT NULL DEFAULT 8.0,
    factor_ajuste DECIMAL(6,4) NOT NULL DEFAULT 0.82,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS mineria_variables (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(30) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    unidad VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'temperatura',
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS mineria_sensores (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS mineria_lecturas (
    id BIGSERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    timestamp_lectura TIMESTAMPTZ NOT NULL,
    valor DECIMAL(12,4),
    calidad SMALLINT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlect_lookup ON mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura DESC);

CREATE OR REPLACE FUNCTION sp_proceso_temperatura(
    p_empresa_id   INTEGER,
    p_mina_id      INTEGER,
    p_variable_id  INTEGER,
    p_fecha_inicio TIMESTAMPTZ,
    p_fecha_fin    TIMESTAMPTZ
)
RETURNS TABLE (
    timestamp_lectura   TIMESTAMPTZ,
    valor_original      DECIMAL(12,4),
    calidad             SMALLINT,
    umbral_alerta       DECIMAL(6,2),
    condicion_resultado VARCHAR(2),
    valor_procesado     DECIMAL(12,4),
    descripcion         TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_umbral DECIMAL(6,2);
    v_factor DECIMAL(6,4);
BEGIN
    SELECT m.umbral_temp_alerta, m.factor_ajuste
    INTO v_umbral, v_factor
    FROM mineria_minas m
    WHERE m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina no encontrada para el tenant';
    END IF;

    RETURN QUERY
    SELECT
        l.timestamp_lectura,
        l.valor AS valor_original,
        l.calidad,
        v_umbral AS umbral_alerta,
        CASE WHEN l.valor > v_umbral THEN 'SI' ELSE 'NO' END::VARCHAR(2) AS condicion_resultado,
        CASE
            WHEN l.valor > v_umbral THEN ROUND(CAST(v_umbral + (l.valor - v_umbral) * v_factor AS NUMERIC), 4)
            ELSE ROUND(CAST(l.valor * 0.985 + 0.12 AS NUMERIC), 4)
        END AS valor_procesado,
        CASE
            WHEN l.valor > v_umbral THEN 'ALERTA: amortiguacion por umbral'
            ELSE 'NORMAL: calibracion lineal'
        END::TEXT AS descripcion
    FROM mineria_lecturas l
    WHERE l.empresa_id = p_empresa_id
      AND l.mina_id = p_mina_id
      AND l.variable_id = p_variable_id
      AND l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
      AND l.calidad >= 50
    ORDER BY l.timestamp_lectura;
END;
$$;

-- DROP evita fallos al migrar desde una vista antigua sin columnas de sensor (CREATE OR REPLACE no basta).
DROP VIEW IF EXISTS v_mineria_catalogos CASCADE;
CREATE VIEW v_mineria_catalogos AS
SELECT
    e.id AS empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
    m.id AS mina_id, m.codigo AS mina_codigo, m.nombre AS mina_nombre, m.zona_tipo, m.umbral_temp_alerta,
    s.id AS sensor_id, s.codigo AS sensor_codigo, s.nombre AS sensor_nombre,
    v.id AS variable_id, v.codigo AS variable_codigo, v.nombre AS variable_nombre, v.unidad
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id AND m.activo = TRUE
JOIN mineria_variables v ON v.empresa_id = e.id AND v.activo = TRUE AND v.tipo = 'temperatura'
JOIN mineria_sensores s ON s.empresa_id = e.id AND s.mina_id = m.id AND s.variable_id = v.id AND s.activo = TRUE;

CREATE TABLE IF NOT EXISTS formula_sessions (
    id BIGSERIAL PRIMARY KEY,
    usuario_nombre VARCHAR(200),
    accion VARCHAR(20) DEFAULT 'VISUALIZO',
    empresa_id INTEGER,
    empresa_nombre VARCHAR(200),
    mina_id INTEGER,
    mina_nombre VARCHAR(200),
    variable_id INTEGER,
    variable_nombre VARCHAR(200),
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    formula_json JSONB,
    sp_sql_text TEXT,
    total_lecturas INTEGER,
    total_si INTEGER,
    total_no INTEGER,
    pct_alertas DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fsess_empresa ON formula_sessions(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fsess_mina ON formula_sessions(mina_id);
CREATE INDEX IF NOT EXISTS idx_fsess_created ON formula_sessions(created_at DESC);

COMMIT;
