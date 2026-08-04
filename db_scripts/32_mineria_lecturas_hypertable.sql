-- ============================================================================
-- 32_mineria_lecturas_hypertable.sql
-- Convierte `mineria_lecturas` (tabla plana) en hypertable de TimescaleDB,
-- cerrando el HALLAZGO #5 (ver GAP_ANALYSIS_2026-07-04.md) y ADR-006.
--
-- Por qué una migración de "crear+copiar+swap" y no `create_hypertable()`
-- directo sobre la tabla existente:
--   La tabla tiene PRIMARY KEY (id) SIN incluir la columna de tiempo
--   (timestamp_lectura). TimescaleDB exige que cualquier índice UNIQUE/PK de
--   un hypertable incluya la columna de partición — create_hypertable()
--   fallaría directamente sobre el esquema actual. La única forma segura de
--   resolverlo sobre una tabla YA POBLADA es migrar a una tabla nueva con PK
--   compuesta (id, timestamp_lectura) y hacer swap, tal como ya se hizo para
--   telemetry_raw (que fue diseñada así desde el inicio).
--
-- Dependencias verificadas antes de escribir este script (GAP_ANALYSIS):
--   - 0 tablas con FK hacia mineria_lecturas.id (swap no rompe integridad ajena)
--   - 0 vistas dependientes (pg_rewrite)
--   - 1 función dependiente: sp_proceso_temperatura() — referencia la tabla
--     por NOMBRE, sigue funcionando automáticamente tras el swap sin tocarla
--   - 0 triggers propios sobre la tabla
--   - extensión timescaledb ya habilitada en esta BD (telemetry_raw ya la usa)
--
-- Política aplicada: SOLO compresión (>30 días), tal como especifica ADR-006
-- para esta tabla ("mineria_lecturas > 30 días"). NO se aplica política de
-- retención/DROP automático: el ADR habla de un "plano histórico" vía rollup
-- a Parquet/MinIO como trabajo diferido, no de borrado — aplicar un DROP aquí
-- sin ese pedido explícito borraría datos que nadie pidió eliminar.
--
-- Idempotente en su mayoría (create_hypertable/policies con if_not_exists),
-- pero el swap de tabla NO se debe re-ejecutar dos veces: el script detecta
-- si mineria_lecturas ya es hypertable y no hace nada en ese caso.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'mineria_lecturas'
    ) THEN
        RAISE NOTICE 'mineria_lecturas ya es hypertable — nada que hacer.';
        RETURN;
    END IF;

    -- 1) Tabla nueva con PK compuesta (incluye la columna de partición).
    CREATE TABLE mineria_lecturas_new (
        id                 BIGINT GENERATED ALWAYS AS IDENTITY,
        empresa_id         INTEGER NOT NULL REFERENCES mineria_empresas(id),
        mina_id            INTEGER NOT NULL REFERENCES mineria_minas(id),
        variable_id        INTEGER NOT NULL REFERENCES mineria_variables(id),
        timestamp_lectura  TIMESTAMPTZ NOT NULL,
        valor              DECIMAL(12,4),
        calidad            SMALLINT DEFAULT 100,
        created_at         TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (id, timestamp_lectura)
    );

    -- 2) Convertir a hypertable ANTES de copiar datos (más eficiente: los
    --    INSERT ya van directo a los chunks correctos).
    PERFORM create_hypertable(
        'mineria_lecturas_new', 'timestamp_lectura',
        chunk_time_interval => INTERVAL '7 days'
    );

    -- 3) Copiar todos los datos existentes, preservando los id originales
    --    (OVERRIDING SYSTEM VALUE: la columna es GENERATED ALWAYS AS IDENTITY,
    --    que por defecto rechaza valores explícitos).
    INSERT INTO mineria_lecturas_new
        (id, empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad, created_at)
    OVERRIDING SYSTEM VALUE
    SELECT id, empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad, created_at
    FROM mineria_lecturas;

    -- 4) Realinear la secuencia de identidad con el máximo id copiado, para
    --    que futuros INSERT (vía formula_service.cpp, seed, etc.) no colisionen.
    PERFORM setval(
        pg_get_serial_sequence('mineria_lecturas_new', 'id'),
        COALESCE((SELECT MAX(id) FROM mineria_lecturas_new), 0) + 1,
        false
    );

    -- 5) Swap: la tabla vieja queda como respaldo con sufijo _old (no se
    --    elimina automáticamente; queda para verificación/rollback manual).
    -- Renombrar también el índice/secuencia de la tabla vieja: RENAME TABLE
    -- no renombra los objetos que le pertenecen, y colisionarían de nombre
    -- con los que se crean a continuación sobre la tabla nueva.
    ALTER INDEX idx_mlect_lookup RENAME TO idx_mlect_lookup_old;
    ALTER TABLE mineria_lecturas RENAME TO mineria_lecturas_old;
    ALTER TABLE mineria_lecturas_new RENAME TO mineria_lecturas;
    ALTER SEQUENCE mineria_lecturas_id_seq RENAME TO mineria_lecturas_old_id_seq;

    -- 6) Índice de acceso (mismo patrón que la tabla original: filtro por
    --    tenant/mina/variable + orden temporal).
    CREATE INDEX idx_mlect_lookup
        ON mineria_lecturas (empresa_id, mina_id, variable_id, timestamp_lectura DESC);

    RAISE NOTICE 'mineria_lecturas migrada a hypertable. Tabla original conservada como mineria_lecturas_old.';
END $$;

-- ---------------------------------------------------------------------------
-- 7) Política de compresión: chunks > 30 días (ADR-006, explícito para esta
--    tabla). Sin política de retención/DROP (ver nota de cabecera).
-- ---------------------------------------------------------------------------
ALTER TABLE mineria_lecturas SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'empresa_id, mina_id, variable_id',
    timescaledb.compress_orderby = 'timestamp_lectura DESC'
);

SELECT add_compression_policy('mineria_lecturas', INTERVAL '30 days', if_not_exists => TRUE);

ANALYZE mineria_lecturas;
