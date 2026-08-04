-- ============================================================
-- FORMULA - Módulo de Análisis: Temperaturas Mineras Perú
-- Multitenant · Data histórica 2025-2026 · Muestreo 30 min
-- Diagrama: Sensor Entrada → Condición → (SI) Bloque Alerta
--                                      → (NO) Bloque Normal
-- ============================================================

-- ─── TABLAS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mineria_empresas (
    id         SERIAL PRIMARY KEY,
    codigo     VARCHAR(20)  UNIQUE NOT NULL,
    nombre     VARCHAR(200) NOT NULL,
    ruc        VARCHAR(11),
    activo     BOOLEAN      DEFAULT TRUE,
    created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mineria_minas (
    id                 SERIAL       PRIMARY KEY,
    empresa_id         INTEGER      NOT NULL REFERENCES mineria_empresas(id),
    codigo             VARCHAR(30)  NOT NULL,
    nombre             VARCHAR(200) NOT NULL,
    region             VARCHAR(100),
    departamento       VARCHAR(100),
    zona_tipo          VARCHAR(10)  NOT NULL,  -- 'sierra' | 'selva'
    altitud_msnm       INTEGER,
    latitud            DECIMAL(10,7),
    longitud           DECIMAL(10,7),
    umbral_temp_alerta DECIMAL(6,2) NOT NULL,  -- °C — umbral condición SI/NO
    factor_ajuste      DECIMAL(6,4) NOT NULL DEFAULT 0.82, -- dampening SI-path
    activo             BOOLEAN      DEFAULT TRUE,
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS mineria_variables (
    id          SERIAL       PRIMARY KEY,
    empresa_id  INTEGER      NOT NULL REFERENCES mineria_empresas(id),
    codigo      VARCHAR(30)  NOT NULL,
    nombre      VARCHAR(200) NOT NULL,
    unidad      VARCHAR(20),
    rango_min   DECIMAL(10,4),
    rango_max   DECIMAL(10,4),
    tipo        VARCHAR(50),
    activo      BOOLEAN      DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);

-- Tabla principal multitenant (discriminador: empresa_id)
CREATE TABLE IF NOT EXISTS mineria_lecturas (
    id                BIGSERIAL    PRIMARY KEY,
    empresa_id        INTEGER      NOT NULL REFERENCES mineria_empresas(id),
    mina_id           INTEGER      NOT NULL REFERENCES mineria_minas(id),
    variable_id       INTEGER      NOT NULL REFERENCES mineria_variables(id),
    timestamp_lectura TIMESTAMPTZ  NOT NULL,
    valor             DECIMAL(12,4),
    calidad           SMALLINT     DEFAULT 100,  -- 0-100
    created_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlect_lookup
    ON mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura DESC);
CREATE INDEX IF NOT EXISTS idx_mlect_ts
    ON mineria_lecturas(timestamp_lectura DESC);

-- ─── DATOS DE REFERENCIA ──────────────────────────────────

INSERT INTO mineria_empresas (codigo, nombre, ruc) VALUES
    ('ANTAMINA', 'Compañia Minera Antamina S.A.',        '20257423271'),
    ('VOLCAN',   'Volcan Compañia Minera S.A.A.',        '20100413818'),
    ('MINSUR',   'Minsur S.A.',                          '20100130204'),
    ('ACTIVOS_MINEROS', 'Activos Mineros',               '20512345678')
ON CONFLICT (codigo) DO NOTHING;

-- Minas: 4 sierra + 2 selva
-- umbral_temp_alerta ajustado para que ~20% de lecturas activen condición SI
INSERT INTO mineria_minas
    (empresa_id, codigo, nombre, region, departamento, zona_tipo,
     altitud_msnm, latitud, longitud, umbral_temp_alerta, factor_ajuste)
SELECT e.id, m.codigo, m.nombre, m.region, m.dep, m.zona,
       m.alt, m.lat, m.lon, m.umbral, m.factor
FROM (VALUES
    ('ACTIVOS_MINEROS','ACT-001','Unidad Activos Principal',    'Lima',         'Lima',            'sierra',4100,-11.9500,-76.9000, 8.0, 0.82),
    ('ANTAMINA','ANT-001','Mina Antamina Unidad Norte',   'Ancash',       'Ancash',         'sierra',4300,-9.5353, -77.0394, 7.0, 0.80),
    ('ANTAMINA','ANT-002','Unidad Coroccohuain',          'Cusco',        'Cusco',           'sierra',3800,-14.0875,-71.0186,11.0, 0.82),
    ('VOLCAN',  'VOL-001','Unidad Chungar',               'Pasco',        'Pasco',           'sierra',4620,-10.7167,-76.2833, 5.0, 0.78),
    ('VOLCAN',  'VOL-002','Unidad Carahuacra',            'Junin',        'Junín',           'sierra',4200,-11.5833,-75.9000, 8.0, 0.81),
    ('MINSUR',  'MIN-001','Mina San Rafael',              'Puno',         'Puno',            'sierra',4500,-14.2167,-70.3833, 6.0, 0.79),
    ('MINSUR',  'MIN-002','Proyecto Beta TW Inambari',   'Madre de Dios','Madre de Dios',   'selva',  600,-12.5931,-69.1886,34.0, 0.88)
) AS m(emp_cod, codigo, nombre, region, dep, zona, alt, lat, lon, umbral, factor)
JOIN mineria_empresas e ON e.codigo = m.emp_cod
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Una variable de temperatura por empresa
INSERT INTO mineria_variables (empresa_id, codigo, nombre, unidad, rango_min, rango_max, tipo)
SELECT e.id, 'TEMP-001', 'Temperatura Ambiente', '°C', -15.0, 55.0, 'temperatura'
FROM mineria_empresas e
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- ─── GENERACIÓN DE LECTURAS HISTÓRICAS ───────────────────
-- 2 años: 2025-01-01 al 2026-12-31
-- Intervalo: 30 minutos → 48 lecturas/día × 730 días = 35 040 por mina
-- Total ~210 240 registros multiempresa
-- Temperatura modelada con variación estacional + diurna + ruido aleatorio
-- Base por cota altimétrica (tasa de lapso 6.5°C / 1000 m)

INSERT INTO mineria_lecturas (empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad)
SELECT
    m.empresa_id,
    m.id                           AS mina_id,
    v.id                           AS variable_id,
    ts,
    -- ── Modelo de temperatura ──────────────────────────────────────────────
    ROUND(CAST(
        GREATEST(-20.0, LEAST(55.0,
            CASE m.zona_tipo
              WHEN 'selva' THEN
                -- Selva baja: base 28 °C, variación estacional ±3.5, diurna ±4
                28.0
                + 3.5 * SIN(2*PI()*(EXTRACT(DOY  FROM ts AT TIME ZONE 'America/Lima') - 15.0) / 365.0)
                + 4.0 * SIN(2*PI()* EXTRACT(HOUR FROM ts AT TIME ZONE 'America/Lima') / 24.0 - PI()/2.0)
                + (random()*4.0 - 2.0)
              ELSE
                -- Sierra: base por altitud (lapse rate 0.65°C/100 m desde 25°C @ 0 m)
                (25.0 - (m.altitud_msnm / 100.0) * 0.65)
                + 5.0 * SIN(2*PI()*(EXTRACT(DOY  FROM ts AT TIME ZONE 'America/Lima') - 15.0) / 365.0)
                + 6.0 * SIN(2*PI()* EXTRACT(HOUR FROM ts AT TIME ZONE 'America/Lima') / 24.0 - PI()/2.0)
                + (random()*3.0 - 1.5)
            END
        ))
    AS NUMERIC), 2)                AS valor,
    -- Calidad: 97% lecturas perfectas, 3% degradadas (sensor drift / ruido)
    CASE WHEN random() < 0.03
         THEN (40 + random()*55)::SMALLINT
         ELSE 100::SMALLINT
    END                            AS calidad
FROM
    mineria_minas m
    JOIN mineria_variables v
        ON  v.empresa_id = m.empresa_id
        AND v.codigo     = 'TEMP-001'
    CROSS JOIN generate_series(
        '2025-01-01 00:00:00+00'::TIMESTAMPTZ,
        '2026-12-31 23:30:00+00'::TIMESTAMPTZ,
        INTERVAL '30 minutes'
    ) AS ts
WHERE m.activo = TRUE;

-- ─── STORED PROCEDURE ─────────────────────────────────────
-- Refleja el diagrama de bloques FORMULA:
--
--   [Sensor Entrada] ──► [Condición: valor > umbral?]
--                              │ SI                │ NO
--                              ▼                   ▼
--                    [Bloque Alerta:      [Bloque Normal:
--                     amortiguación]      calibración]
--
-- Parámetros:
--   p_empresa_id   INTEGER      — tenant discriminator
--   p_mina_id      INTEGER      — id de la mina
--   p_variable_id  INTEGER      — id de la variable (temperatura)
--   p_fecha_inicio TIMESTAMPTZ  — inicio del rango
--   p_fecha_fin    TIMESTAMPTZ  — fin del rango (inclusive)
--
-- Retorna por fila:
--   timestamp_lectura, valor_original, calidad, umbral_alerta,
--   condicion_resultado (SI/NO), valor_procesado, descripcion
-- ──────────────────────────────────────────────────────────

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
    condicion_resultado VARCHAR(2),    -- 'SI' | 'NO'
    valor_procesado     DECIMAL(12,4),
    descripcion         TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_umbral  DECIMAL(6,2);
    v_factor  DECIMAL(6,4);
    v_zona    VARCHAR(10);
    v_nombre  VARCHAR(200);
BEGIN
    -- ── BLOQUE: Sensor Entrada – validaciones y carga de config ─────────
    IF p_empresa_id IS NULL OR p_mina_id IS NULL OR p_variable_id IS NULL THEN
        RAISE EXCEPTION 'Parámetros requeridos: empresa_id, mina_id, variable_id';
    END IF;
    IF p_fecha_inicio IS NULL OR p_fecha_fin IS NULL THEN
        RAISE EXCEPTION 'Parámetros requeridos: fecha_inicio, fecha_fin';
    END IF;
    IF p_fecha_inicio >= p_fecha_fin THEN
        RAISE EXCEPTION 'fecha_inicio debe ser anterior a fecha_fin';
    END IF;

    SELECT m.umbral_temp_alerta, m.factor_ajuste, m.zona_tipo, m.nombre
    INTO   v_umbral, v_factor, v_zona, v_nombre
    FROM   mineria_minas m
    WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina id=% no encontrada para empresa_id=%', p_mina_id, p_empresa_id;
    END IF;

    -- ── Verificar que la variable existe para este tenant ────────────────
    IF NOT EXISTS (
        SELECT 1 FROM mineria_variables
        WHERE  id = p_variable_id AND empresa_id = p_empresa_id AND activo = TRUE
    ) THEN
        RAISE EXCEPTION 'Variable id=% no encontrada para empresa_id=%', p_variable_id, p_empresa_id;
    END IF;

    -- ── BLOQUE: Proceso principal – aplicar diagrama de flujo ───────────
    RETURN QUERY
    SELECT
        l.timestamp_lectura,
        l.valor                                              AS valor_original,
        l.calidad,
        v_umbral                                             AS umbral_alerta,

        -- ── CONDICIÓN: valor > umbral_temp_alerta? ──────────────────────
        CASE WHEN l.valor > v_umbral THEN 'SI' ELSE 'NO' END::VARCHAR(2)
                                                             AS condicion_resultado,

        -- ── SI  → Bloque Alerta: amortiguación lineal de pico ──────────────
        --         procesado = umbral + (valor − umbral) × factor_ajuste
        -- ── NO  → Bloque Normal: calibración lineal mínima ───────────────
        --         procesado = valor × 0.985 + 0.12
        CASE
            WHEN l.valor > v_umbral THEN
                ROUND(CAST(
                    v_umbral + (l.valor - v_umbral) * v_factor
                AS NUMERIC), 4)
            ELSE
                ROUND(CAST(
                    l.valor * 0.985 + 0.12
                AS NUMERIC), 4)
        END                                                  AS valor_procesado,

        CASE
            WHEN l.valor > v_umbral THEN
                'ALERTA (' || v_zona || '): ' || l.valor || ' °C > umbral ' ||
                v_umbral || ' °C → amortiguado (×' || v_factor || ')'
            ELSE
                'NORMAL (' || v_zona || '): ' || l.valor || ' °C ≤ umbral ' ||
                v_umbral || ' °C → calibración lineal'
        END::TEXT                                            AS descripcion

    FROM  mineria_lecturas l
    WHERE l.empresa_id        = p_empresa_id
      AND l.mina_id           = p_mina_id
      AND l.variable_id       = p_variable_id
      AND l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
      AND l.calidad           >= 50  -- filtrar lecturas de muy baja calidad
    ORDER BY l.timestamp_lectura;
END;
$$;

-- Vista resumen por mina (útil para los selectores de la UI)
CREATE OR REPLACE VIEW v_mineria_catalogos AS
SELECT
    e.id   AS empresa_id,
    e.codigo AS empresa_codigo,
    e.nombre AS empresa_nombre,
    m.id   AS mina_id,
    m.codigo AS mina_codigo,
    m.nombre AS mina_nombre,
    m.zona_tipo,
    m.altitud_msnm,
    m.umbral_temp_alerta,
    v.id   AS variable_id,
    v.codigo AS variable_codigo,
    v.nombre AS variable_nombre,
    v.unidad
FROM mineria_empresas e
JOIN mineria_minas     m ON m.empresa_id = e.id AND m.activo = TRUE
JOIN mineria_variables v ON v.empresa_id = e.id AND v.activo = TRUE AND v.tipo = 'temperatura'
ORDER BY e.codigo, m.codigo;

-- ═══════════════════════════════════════════════════════════════════════════
-- FORMULA BLOCK EXECUTION ENGINE
-- Lee el diagrama de bloques desde blocks/connections y lo ejecuta para
-- cada lectura de minería. Los cálculos reales provienen del JSON del bloque.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: evalúa expresión aritmética con sustitución de variables ─────
-- p_expr : la parte derecha de una asignación, p.ej. "temperatura + 1"
-- p_vars : JSONB {"temperatura": 5.5, "humedad": 80}
-- Retorna el resultado numérico
CREATE OR REPLACE FUNCTION fn_eval_expr_numeric(
    p_expr TEXT,
    p_vars JSONB
) RETURNS NUMERIC AS $$
DECLARE
    v_sql    TEXT    := p_expr;
    v_key    TEXT;
    v_val    NUMERIC;
    v_result NUMERIC;
BEGIN
    -- Sustituir cada variable por su valor numérico actual
    -- Solo permite nombres seguros: letras, dígitos y guión bajo
    FOR v_key IN
        SELECT k FROM jsonb_object_keys(p_vars) AS k
        WHERE  k ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    LOOP
        v_val := (p_vars ->> v_key)::NUMERIC;
        -- Reemplazar ocurrencias completas (word-boundary \m … \M)
        v_sql := regexp_replace(v_sql, '\m' || v_key || '\M', v_val::TEXT, 'g');
    END LOOP;
    EXECUTE 'SELECT (' || v_sql || ')::NUMERIC' INTO v_result;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_eval_expr_numeric: error en expr "%" → %', p_expr, SQLERRM;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── Helper: evalúa condición booleana con sustitución de variables ────────
-- p_expr : condición completa, p.ej. "temperatura > 4"
-- p_vars : JSONB {"temperatura": 5.5}
-- Retorna TRUE / FALSE
CREATE OR REPLACE FUNCTION fn_eval_expr_bool(
    p_expr TEXT,
    p_vars JSONB
) RETURNS BOOLEAN AS $$
DECLARE
    v_sql    TEXT    := p_expr;
    v_key    TEXT;
    v_val    NUMERIC;
    v_result BOOLEAN;
BEGIN
    FOR v_key IN
        SELECT k FROM jsonb_object_keys(p_vars) AS k
        WHERE  k ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    LOOP
        v_val := (p_vars ->> v_key)::NUMERIC;
        v_sql := regexp_replace(v_sql, '\m' || v_key || '\M', v_val::TEXT, 'g');
    END LOOP;
    EXECUTE 'SELECT (' || v_sql || ')::BOOLEAN' INTO v_result;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_eval_expr_bool: error en condición "%" → %', p_expr, SQLERRM;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── SP principal: ejecuta el diagrama de bloques FORMULA ─────────────────
-- Para cada lectura de minería, recorre el grafo de bloques definido en las
-- tablas blocks / connections y aplica las fórmulas JSON de cada bloque.
--
-- Flujo hardcoded del diagrama FORMULA del usuario:
--   [BLOQUE INICIO]  paso1: temperatura = temperatura + 1
--                    paso2: temperatura = temperatura - 1   ← neto: sin cambio
--   [CONDICIÓN]      temperatura > 4
--       SI →  [Bloque b21301]  temperatura = temperatura * 2
--       NO →  [Bloque b78399]  temperatura = temperatura * 3
--   [RESULTADO]      valor_procesado, condicion_SI_NO, descripcion
--
-- Parámetros y retorno idénticos al SP anterior (API compatible).
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
LANGUAGE plpgsql AS $$
DECLARE
    rec               RECORD;
    -- Config de mina (solo para umbral_alerta como referencia visual del chart)
    v_umbral          DECIMAL(6,2);
    v_zona            VARCHAR(10);
    v_nombre          VARCHAR(200);
    -- Ejecución del diagrama
    v_inicio_id       TEXT;
    v_cur_id          TEXT;
    v_bloque          RECORD;
    v_vars            JSONB;
    v_steps           JSONB;
    v_step            JSONB;
    v_expr            TEXT;
    v_matched         TEXT[];
    v_val_nuevo       NUMERIC;
    v_cond_bool       BOOLEAN;
    v_cond_txt        VARCHAR(2);
    v_desc_parts      TEXT[];
    v_visited         TEXT[];
    v_iter            INT;
    v_max_iter        CONSTANT INT := 50;
    i                 INT;
    v_diagram_id      TEXT;   -- emp{id}_mina{id}: mismo criterio que el editor FORMULA
BEGIN
    -- ── Validaciones de parámetros ─────────────────────────────────────────
    IF p_empresa_id IS NULL OR p_mina_id IS NULL OR p_variable_id IS NULL THEN
        RAISE EXCEPTION 'Requeridos: empresa_id, mina_id, variable_id';
    END IF;
    IF p_fecha_inicio IS NULL OR p_fecha_fin IS NULL THEN
        RAISE EXCEPTION 'Requeridos: fecha_inicio, fecha_fin';
    END IF;
    IF p_fecha_inicio >= p_fecha_fin THEN
        RAISE EXCEPTION 'fecha_inicio debe ser anterior a fecha_fin';
    END IF;

    -- ── Cargar config de mina ──────────────────────────────────────────────
    SELECT m.umbral_temp_alerta, m.zona_tipo, m.nombre
    INTO   v_umbral, v_zona, v_nombre
    FROM   mineria_minas m
    WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina id=% no encontrada para empresa_id=%', p_mina_id, p_empresa_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM mineria_variables
        WHERE  id = p_variable_id AND empresa_id = p_empresa_id AND activo = TRUE
    ) THEN
        RAISE EXCEPTION 'Variable id=% no encontrada para empresa_id=%', p_variable_id, p_empresa_id;
    END IF;

    v_diagram_id := 'emp' || p_empresa_id::TEXT || '_mina' || p_mina_id::TEXT;

    -- ── Detectar bloque INICIO: sin aristas entrantes en ESTE diagrama.
    --    El editor suele guardar INICIO solo con blockType o etiqueta (sin meta.formula).
    SELECT b.id INTO v_inicio_id
    FROM   blocks b
    LEFT  JOIN connections cin
           ON cin.to_id = b.id AND cin.diagram_id = b.diagram_id
    WHERE  b.diagram_id = v_diagram_id
      AND  cin.id IS NULL
      AND  (
            (b.meta ? 'formula')
         OR upper(trim(COALESCE(b.meta->>'blockType',''))) = 'INICIO'
         OR upper(trim(COALESCE(b.label,''))) = 'INICIO'
      )
    ORDER  BY
      CASE WHEN upper(trim(COALESCE(b.meta->>'blockType',''))) = 'INICIO' THEN 0 ELSE 1 END,
      CASE WHEN (b.meta ? 'formula') THEN 0 ELSE 1 END,
      b.created_at
    LIMIT  1;

    IF v_inicio_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró bloque INICIO en el diagrama % (sin entradas; requiere tipo/etiqueta INICIO o meta.formula)', v_diagram_id;
    END IF;

    -- ── Iterar sobre cada lectura y ejecutar el diagrama ──────────────────
    FOR rec IN
        SELECT l.timestamp_lectura, l.valor, l.calidad
        FROM   mineria_lecturas l
        WHERE  l.empresa_id        = p_empresa_id
          AND  l.mina_id           = p_mina_id
          AND  l.variable_id       = p_variable_id
          AND  l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
          AND  l.calidad           >= 50
        ORDER  BY l.timestamp_lectura
    LOOP
        -- Inicializar estado para esta lectura
        v_vars       := jsonb_build_object('temperatura', rec.valor);
        v_cur_id     := v_inicio_id;
        v_cond_txt   := NULL;
        v_desc_parts := '{}';
        v_visited    := '{}';
        v_iter       := 0;

        -- ── Recorrer el grafo de bloques ─────────────────────────────────
        WHILE v_cur_id IS NOT NULL AND v_iter < v_max_iter LOOP
            EXIT WHEN v_cur_id = ANY(v_visited);          -- anti-ciclo
            v_visited := array_append(v_visited, v_cur_id);
            v_iter    := v_iter + 1;

            SELECT b.id, b.label, b.meta INTO v_bloque
            FROM   blocks b
            WHERE  b.id = v_cur_id AND b.diagram_id = v_diagram_id;
            EXIT WHEN NOT FOUND;

            IF (v_bloque.meta ->> 'blockType') = 'decision' THEN
                -- ── BLOQUE CONDICIÓN ──────────────────────────────────────
                v_expr      := v_bloque.meta -> 'formula' ->> 'expression';
                v_cond_bool := fn_eval_expr_bool(v_expr, v_vars);
                v_cond_txt  := CASE WHEN v_cond_bool THEN 'SI' ELSE 'NO' END;
                v_desc_parts := array_append(v_desc_parts,
                    COALESCE(v_bloque.label,'COND') || ': ' || v_expr || ' → ' || v_cond_txt);

                -- Seguir la conexión etiquetada con backwardLabel = SI o NO
                SELECT c.to_id INTO v_cur_id
                FROM   connections c
                WHERE  c.from_id = v_bloque.id
                  AND  c.diagram_id = v_diagram_id
                  AND  upper(c.meta ->> 'backwardLabel') = v_cond_txt
                LIMIT  1;

                -- Fallback: primera conexión = SI, segunda = NO
                IF v_cur_id IS NULL THEN
                    SELECT c.to_id INTO v_cur_id
                    FROM   connections c
                    WHERE  c.from_id = v_bloque.id
                      AND  c.diagram_id = v_diagram_id
                    ORDER  BY c.id
                    OFFSET (CASE WHEN v_cond_bool THEN 0 ELSE 1 END)
                    LIMIT  1;
                END IF;

            ELSE
                -- ── BLOQUE PROCESO: ejecutar steps secuenciales ───────────
                v_steps := v_bloque.meta -> 'formula' -> 'steps';
                IF v_steps IS NOT NULL AND jsonb_array_length(v_steps) > 0 THEN
                    FOR i IN 0 .. jsonb_array_length(v_steps) - 1 LOOP
                        v_step  := v_steps -> i;
                        v_expr  := trim(v_step ->> 'expression');

                        -- Detectar asignación LHS = RHS (excluye >=, <=, !=, ==)
                        v_matched := regexp_match(v_expr,
                            '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+?)\s*$');

                        IF v_matched IS NOT NULL THEN
                            -- Evaluar RHS con valores actuales de variables
                            v_val_nuevo  := fn_eval_expr_numeric(v_matched[2], v_vars);
                            v_vars       := jsonb_set(v_vars,
                                                ARRAY[v_matched[1]],
                                                to_jsonb(v_val_nuevo));
                            v_desc_parts := array_append(v_desc_parts,
                                v_matched[1] || ':=' || round(v_val_nuevo::NUMERIC, 4));
                        END IF;
                    END LOOP;
                END IF;

                -- Avanzar al bloque siguiente (única salida de proceso)
                SELECT c.to_id INTO v_cur_id
                FROM   connections c
                WHERE  c.from_id = v_bloque.id
                  AND  c.diagram_id = v_diagram_id
                LIMIT  1;
            END IF;
        END LOOP;

        -- ── Emitir fila de resultado ───────────────────────────────────────
        timestamp_lectura   := rec.timestamp_lectura;
        valor_original      := rec.valor;
        calidad             := rec.calidad;
        umbral_alerta       := v_umbral;   -- umbral de mina: referencia visual del chart
        condicion_resultado := COALESCE(v_cond_txt, '?');
        valor_procesado     := COALESCE((v_vars ->> 'temperatura')::DECIMAL(12,4), rec.valor);
        descripcion         := array_to_string(v_desc_parts, ' | ');
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FORMULA SESSIONS — auditoría completa de guardado de fórmulas
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS formula_sessions (
    id               BIGSERIAL PRIMARY KEY,
    -- Identidad del usuario
    usuario_nombre   VARCHAR(200),
    accion           VARCHAR(20) DEFAULT 'VISUALIZO',   -- CREO | MODIFICO | VISUALIZO
    -- Parámetros de la consulta
    empresa_id       INTEGER,
    empresa_nombre   VARCHAR(200),
    mina_id          INTEGER,
    mina_nombre      VARCHAR(200),
    variable_id      INTEGER,
    variable_nombre  VARCHAR(200),
    fecha_inicio     TIMESTAMPTZ,
    fecha_fin        TIMESTAMPTZ,
    -- Snapshot de la fórmula (bloques + conexiones completos, para reconstrucción)
    formula_json     JSONB,
    sp_sql_text      TEXT,
    -- Resumen de resultados
    total_lecturas   INTEGER,
    total_si         INTEGER,
    total_no         INTEGER,
    pct_alertas      DECIMAL(5,2),
    -- Ubicación GPS (puede ser NULL si el navegador no la proporcionó)
    gps_lat          DECIMAL(10,7),
    gps_lon          DECIMAL(10,7),
    gps_accuracy     DECIMAL(8,2),
    gps_lugar        TEXT,
    -- Metadata de red
    ip_cliente       VARCHAR(45),
    user_agent       TEXT,
    -- Auditoría
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda avanzada
CREATE INDEX IF NOT EXISTS idx_fsess_empresa   ON formula_sessions(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fsess_mina      ON formula_sessions(mina_id);
CREATE INDEX IF NOT EXISTS idx_fsess_variable  ON formula_sessions(variable_id);
CREATE INDEX IF NOT EXISTS idx_fsess_usuario   ON formula_sessions(usuario_nombre);
CREATE INDEX IF NOT EXISTS idx_fsess_accion    ON formula_sessions(accion);
CREATE INDEX IF NOT EXISTS idx_fsess_created   ON formula_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsess_pct       ON formula_sessions(pct_alertas DESC);
CREATE INDEX IF NOT EXISTS idx_fsess_formula   ON formula_sessions USING GIN (formula_json);
