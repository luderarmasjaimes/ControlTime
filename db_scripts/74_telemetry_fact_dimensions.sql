-- ============================================================================
-- 74_telemetry_fact_dimensions.sql
-- ADR-131: consolida las identidades de sensor de los 3 modelos paralelos
-- (sensors/telemetry_raw UUID multitenant real, mineria_* SERIAL "Formula",
-- mining_* SERIAL "dashboard/demo") en un catálogo dimensional único
-- (dim_tenant/dim_site/dim_sensor/dim_channel), sin fusionar las hypertables
-- de hechos en una sola (ver 75_telemetry_fact_compression_retention.sql para
-- el porqué: retención/compresión de TimescaleDB es por chunk, no por fila, y
-- mineria_lecturas tiene la decisión de negocio deliberada de NO retención).
--
-- Reduce el tamaño de la fila caliente de ~130 bytes (telemetry_raw actual,
-- 4 UUID de 16 bytes repetidas por fila) a ~60 bytes (claves surrogate INT/
-- SMALLINT), crítico para sostener 25.000 filas/s con footprint de disco
-- mínimo (ver ADR-131 para el cálculo completo de capacidad a 5-10 años).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Curaduría manual de reconciliación (Fase 1 del plan, bloqueante antes del
-- backfill): no existe FK hoy entre mineria_empresas/mineria_minas y
-- tenants/sites, y no se puede inferir por SQL sin riesgo de mezclar empresas
-- con nombres parecidos. Un humano debe poblar esta tabla revisando ambos
-- catálogos antes de que 78_telemetry_fact_backfill.sql pueda migrar datos de
-- `mineria_lecturas` con identidad de tenant/site correcta.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_tenant_reconciliation (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mineria_empresa_id    INTEGER UNIQUE REFERENCES mineria_empresas(id),
    tenant_id             UUID REFERENCES tenants(tenant_id),
    matched_by            TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'manual' | 'auto_exact_name'
    reviewed_by           TEXT,
    reviewed_at           TIMESTAMPTZ,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preseed automático SOLO para coincidencias exactas de nombre (alta confianza,
-- reduce trabajo manual) -- queda marcado 'auto_exact_name' y de todas formas
-- requiere reviewed_by/reviewed_at antes de que el backfill la use.
INSERT INTO migration_tenant_reconciliation (mineria_empresa_id, tenant_id, matched_by)
SELECT e.id, t.tenant_id, 'auto_exact_name'
FROM mineria_empresas e
JOIN tenants t ON lower(trim(t.tenant_name)) = lower(trim(e.nombre))
ON CONFLICT (mineria_empresa_id) DO NOTHING;

-- Filas pendientes de revisión humana para las empresas sin match exacto.
INSERT INTO migration_tenant_reconciliation (mineria_empresa_id, matched_by)
SELECT e.id, 'pending'
FROM mineria_empresas e
WHERE NOT EXISTS (SELECT 1 FROM migration_tenant_reconciliation r WHERE r.mineria_empresa_id = e.id);

-- ----------------------------------------------------------------------------
-- Dimensiones compartidas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dim_tenant (
    tenant_id_sk              SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                 UUID UNIQUE REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    legacy_mineria_empresa_id INTEGER UNIQUE REFERENCES mineria_empresas(id),
    display_name               TEXT NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(tenant_id, legacy_mineria_empresa_id) >= 1)
);

CREATE TABLE IF NOT EXISTS dim_site (
    site_id_sk               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id                  UUID UNIQUE REFERENCES sites(site_id) ON DELETE CASCADE,
    legacy_mineria_mina_id   INTEGER UNIQUE REFERENCES mineria_minas(id),
    legacy_mining_site_unit  TEXT,   -- normalizado (trim+upper) de mining_sensors.site_unit; texto libre, NO FK
    tenant_id_sk             SMALLINT NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    display_name             TEXT NOT NULL,
    CHECK (num_nonnulls(site_id, legacy_mineria_mina_id, legacy_mining_site_unit) >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dim_site_legacy_mining_unit
    ON dim_site (tenant_id_sk, legacy_mining_site_unit) WHERE legacy_mining_site_unit IS NOT NULL;

CREATE TABLE IF NOT EXISTS dim_channel (
    channel_id    SMALLINT PRIMARY KEY,
    channel_code  TEXT NOT NULL UNIQUE,
    description   TEXT
);
INSERT INTO dim_channel (channel_id, channel_code, description) VALUES
    (0, 'PRIMARY', 'Lectura escalar unica -- compat con telemetry_raw/mineria_lecturas/mining_sensor_history')
ON CONFLICT (channel_id) DO NOTHING;

-- Un canal por cada channel_code distinto ya definido para sensores
-- multivariados (17_telemetry_multivariate_sensor_specs.sql). No migra
-- telemetry_multivariate en esta fase (fuera de alcance de ADR-131), solo
-- reserva los codigos para no colisionar si se integra despues.
INSERT INTO dim_channel (channel_id, channel_code, description)
SELECT row_number() OVER (ORDER BY d.channel_code) + 1, d.channel_code, 'Reservado desde sensor_output_channel_def'
FROM (SELECT DISTINCT channel_code FROM sensor_output_channel_def) d
WHERE NOT EXISTS (SELECT 1 FROM dim_channel c WHERE c.channel_code = d.channel_code);

CREATE TABLE IF NOT EXISTS dim_sensor (
    sensor_id_sk              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_system             TEXT NOT NULL CHECK (source_system IN ('iot_v2', 'formula', 'demo')),
    sensor_id                 UUID UNIQUE REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    legacy_mineria_sensor_id  INTEGER UNIQUE REFERENCES mineria_sensores(id),
    legacy_mining_sensor_id   INTEGER UNIQUE REFERENCES mining_sensors(id),
    tenant_id_sk               SMALLINT NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    site_id_sk                 INTEGER REFERENCES dim_site(site_id_sk),
    sensor_code                 TEXT NOT NULL,
    sensor_type                 TEXT NOT NULL,
    unit                         TEXT,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(sensor_id, legacy_mineria_sensor_id, legacy_mining_sensor_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_dim_sensor_tenant ON dim_sensor (tenant_id_sk);
CREATE INDEX IF NOT EXISTS idx_dim_sensor_source ON dim_sensor (source_system);

-- ----------------------------------------------------------------------------
-- Poblado de dimensiones desde los 3 catalogos de origen. Solo usa filas de
-- migration_tenant_reconciliation con reviewed_by IS NOT NULL -- una empresa
-- Formula sin revision humana NO obtiene identidad de tenant todavia (queda
-- como placeholder solo con legacy_mineria_empresa_id hasta que se revise).
-- Todo con ON CONFLICT DO NOTHING: seguro de re-ejecutar cuando se agreguen
-- tenants/sensores nuevos o se revisen mas reconciliaciones.
-- ----------------------------------------------------------------------------

-- dim_tenant: tenants reales (IoT v2), con su empresa Formula adjunta si ya
-- fue revisada.
INSERT INTO dim_tenant (tenant_id, legacy_mineria_empresa_id, display_name)
SELECT t.tenant_id, r.mineria_empresa_id, t.tenant_name
FROM tenants t
LEFT JOIN migration_tenant_reconciliation r
    ON r.tenant_id = t.tenant_id AND r.reviewed_by IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

-- dim_tenant: empresas Formula sin tenant IoT v2 correspondiente (o pendientes
-- de revision) -- placeholder solo con legacy_mineria_empresa_id.
INSERT INTO dim_tenant (legacy_mineria_empresa_id, display_name)
SELECT e.id, e.nombre
FROM mineria_empresas e
WHERE NOT EXISTS (SELECT 1 FROM dim_tenant dt WHERE dt.legacy_mineria_empresa_id = e.id);

-- dim_site: sites reales (IoT v2)
INSERT INTO dim_site (site_id, tenant_id_sk, display_name)
SELECT s.site_id, dt.tenant_id_sk, s.site_name
FROM sites s
JOIN dim_tenant dt ON dt.tenant_id = s.tenant_id
ON CONFLICT (site_id) DO NOTHING;

-- dim_site: mineria_minas (Formula), resuelto via legacy_mineria_empresa_id
INSERT INTO dim_site (legacy_mineria_mina_id, tenant_id_sk, display_name)
SELECT m.id, dt.tenant_id_sk, m.nombre
FROM mineria_minas m
JOIN dim_tenant dt ON dt.legacy_mineria_empresa_id = m.empresa_id
ON CONFLICT (legacy_mineria_mina_id) DO NOTHING;

-- NOTA: mining_sensors ya NO tiene mining_company/site_unit en esta base viva
-- -- 28_mining_telemetry_uuid_tenant.sql (mas reciente que 22/23, tambien
-- montado en docker-entrypoint-initdb.d) los reemplazo por tenant_id UUID
-- real + zone_id (mining_sensor_zones). legacy_mining_site_unit queda
-- reservada en dim_site por si ese patron de texto libre vuelve a usarse en
-- otro lado, pero no se poblada desde mining_sensors -- el "sitio" de un
-- sensor demo se resuelve solo por tenant_id_sk (site_id_sk queda NULL).

-- dim_sensor: sensors (IoT v2)
INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, site_id_sk, sensor_code, sensor_type, unit, is_active)
SELECT 'iot_v2', s.sensor_id, dt.tenant_id_sk, dsite.site_id_sk, s.sensor_code, s.sensor_type, s.unit, s.is_active
FROM sensors s
JOIN dim_tenant dt ON dt.tenant_id = s.tenant_id
LEFT JOIN dim_site dsite ON dsite.site_id = s.site_id
ON CONFLICT (sensor_id) DO NOTHING;

-- dim_sensor: mineria_sensores (Formula)
INSERT INTO dim_sensor (source_system, legacy_mineria_sensor_id, tenant_id_sk, site_id_sk, sensor_code, sensor_type, unit, is_active)
SELECT 'formula', ms.id, dt.tenant_id_sk, dsite.site_id_sk, ms.codigo, v.tipo, v.unidad, ms.activo
FROM mineria_sensores ms
JOIN dim_tenant dt ON dt.legacy_mineria_empresa_id = ms.empresa_id
JOIN mineria_variables v ON v.id = ms.variable_id
LEFT JOIN dim_site dsite ON dsite.legacy_mineria_mina_id = ms.mina_id
ON CONFLICT (legacy_mineria_sensor_id) DO NOTHING;

-- dim_sensor: mining_sensors (demo) -- tenant_id ya es UUID real (28_mining_telemetry_uuid_tenant.sql)
INSERT INTO dim_sensor (source_system, legacy_mining_sensor_id, tenant_id_sk, sensor_code, sensor_type, unit, is_active)
SELECT 'demo', ms.id, dt.tenant_id_sk, ms.name, mt.name, mt.unit, (ms.status IS DISTINCT FROM 'offline')
FROM mining_sensors ms
JOIN mining_sensor_types mt ON mt.id = ms.type_id
JOIN dim_tenant dt ON dt.tenant_id = ms.tenant_id
ON CONFLICT (legacy_mining_sensor_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Tabla de hechos hot -- reemplaza telemetry_raw (la unica que corre a 25k/s)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_fact (
    tenant_id_sk    SMALLINT    NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    sensor_id_sk    INTEGER     NOT NULL REFERENCES dim_sensor(sensor_id_sk),
    channel_id      SMALLINT    NOT NULL DEFAULT 0 REFERENCES dim_channel(channel_id),
    captured_at     TIMESTAMPTZ NOT NULL,
    value_numeric   REAL,
    quality_code    SMALLINT    NOT NULL DEFAULT 0,
    kafka_partition INTEGER,
    kafka_offset    BIGINT,
    PRIMARY KEY (sensor_id_sk, channel_id, captured_at)
);

SELECT create_hypertable('telemetry_fact', 'captured_at',
    chunk_time_interval => INTERVAL '1 hour', if_not_exists => true);

CREATE UNIQUE INDEX IF NOT EXISTS ux_telemetry_fact_kafka_event
    ON telemetry_fact (captured_at, kafka_partition, kafka_offset)
    WHERE kafka_partition IS NOT NULL AND kafka_offset IS NOT NULL;

-- Payload variable (casi siempre NULL en el camino caliente) fuera de la tabla
-- de hechos para no degradar la compresion columnar del resto de columnas.
CREATE TABLE IF NOT EXISTS telemetry_fact_detail (
    sensor_id_sk  INTEGER     NOT NULL,
    channel_id    SMALLINT    NOT NULL DEFAULT 0,
    captured_at   TIMESTAMPTZ NOT NULL,
    value_text    TEXT,
    raw_payload   TEXT,
    tags          JSONB,
    PRIMARY KEY (sensor_id_sk, channel_id, captured_at)
);
SELECT create_hypertable('telemetry_fact_detail', 'captured_at',
    chunk_time_interval => INTERVAL '1 hour', if_not_exists => true);

-- ----------------------------------------------------------------------------
-- telemetry_fact_formula -- reemplaza mineria_lecturas (motor "Formula", SIN
-- retencion, decision de negocio deliberada que se preserva intacta)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_fact_formula (
    tenant_id_sk   SMALLINT    NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    sensor_id_sk   INTEGER     NOT NULL REFERENCES dim_sensor(sensor_id_sk),
    channel_id     SMALLINT    NOT NULL DEFAULT 0 REFERENCES dim_channel(channel_id),
    captured_at    TIMESTAMPTZ NOT NULL,
    value_numeric  REAL,
    quality_code   SMALLINT    NOT NULL DEFAULT 100,
    PRIMARY KEY (sensor_id_sk, channel_id, captured_at)
);
SELECT create_hypertable('telemetry_fact_formula', 'captured_at',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => true);

-- ----------------------------------------------------------------------------
-- telemetry_fact_demo -- reemplaza mining_sensor_history (dashboard/demo, 342
-- filas legacy, sin ingesta activa hoy)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_fact_demo (
    tenant_id_sk   SMALLINT    NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    sensor_id_sk   INTEGER     NOT NULL REFERENCES dim_sensor(sensor_id_sk),
    channel_id     SMALLINT    NOT NULL DEFAULT 0 REFERENCES dim_channel(channel_id),
    captured_at    TIMESTAMPTZ NOT NULL,
    value_numeric  REAL,
    quality_code   SMALLINT    NOT NULL DEFAULT 0,
    PRIMARY KEY (sensor_id_sk, channel_id, captured_at)
);
SELECT create_hypertable('telemetry_fact_demo', 'captured_at',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => true);

COMMIT;
