-- Aplica corrección a sp_proceso_temperatura en la BD del motor FORMULA:
-- 1) Ámbito por diagram_id = emp{id}_mina{id} (multitenant).
-- 2) Bloque INICIO reconocido aunque meta no tenga clave "formula" (solo blockType/label INICIO).
--
-- Ejecutar contra la base `formula` (contenedor formula_db), p. ej.:
--   docker exec -i <formula_db_container> psql -U formula -d formula -f /path/12_sp_proceso_temperatura_inicio_fix.sql

BEGIN;

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

COMMIT;
