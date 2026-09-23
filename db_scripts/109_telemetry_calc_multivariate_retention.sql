-- ============================================================================
-- 109_telemetry_calc_multivariate_retention.sql
-- Gap real encontrado en auditoría de latencia (no cubierto por ADR-186):
-- a diferencia de telemetry_fact/telemetry_fact_formula/telemetry_fact_demo
-- (las 3 cubiertas por 75_telemetry_fact_compression_retention.sql),
-- telemetry_fact_calc (87_telemetry_fact_calc.sql) y telemetry_multivariate
-- (17_telemetry_multivariate_sensor_specs.sql) son hypertables sin NINGUNA
-- política de compresión ni retención -- sus chunks se acumulan para
-- siempre, sin comprimir. Mismo riesgo de fondo que motivó ADR-186 (más
-- chunks acumulados con el tiempo = peor costo de planificación/ejecución
-- para cualquier consulta de rango amplio), agravado acá porque ni siquiera
-- hay compresión columnar reduciendo el tamaño en disco de esos chunks.
--
-- Ventanas usadas: las MISMAS que 75 usa para telemetry_fact
-- (compress_after 3 horas, retention 190 días), no las de
-- telemetry_fact_formula (30 días, sin retención) ni telemetry_fact_demo
-- (7 días, sin retención). Justificación de por qué telemetry_fact y NO
-- formula/demo:
--
--   * telemetry_fact_calc: su propio header (87_telemetry_fact_calc.sql)
--     ya establece que usa chunk_time_interval=1h -- el mismo valor que
--     telemetry_fact, NO el de 7 días de telemetry_fact_formula/demo --
--     "porque telemetry_fact_calc se deriva 1:1 de telemetry_fact -- mismo
--     ritmo de llegada esperado". Si el ritmo de llegada esperado es el
--     mismo que telemetry_fact, la ventana de compresión/retención debería
--     serlo también: es una métrica derivada 1:1 de telemetry_fact, no
--     tiene sentido de negocio que sobreviva más tiempo que el dato crudo
--     del que se calculó. (87 también dice "SIN retention agresiva" en su
--     comentario original, pero esa frase describe el estado de HECHO de
--     ese momento -- no hay ninguna política, que es exactamente el bug que
--     esta migración corrige -- no una decisión de negocio documentada como
--     la de telemetry_fact_formula/mineria_lecturas, que sí declara
--     explícitamente "SIN retención, decisión de negocio deliberada".)
--   * telemetry_multivariate: no tiene ninguna nota de "decisión de negocio
--     deliberada de retención distinta" en 17_telemetry_multivariate_sensor_specs.sql
--     ni en ningún otro script -- a falta de esa señal explícita, se aplica
--     el mismo default conservador que el resto de la telemetría cruda
--     (telemetry_fact) en vez de inventar una ventana nueva sin respaldo.
--     Nota: 17 creó esta hypertable con create_hypertable(...) SIN pasar
--     chunk_time_interval, por lo que usa el default de TimescaleDB
--     (7 días), no 1h como telemetry_fact -- add_compression_policy con
--     compress_after=3h sigue siendo válido (TimescaleDB comprime por
--     chunk cuando el rango del chunk queda más viejo que ese umbral), pero
--     en la práctica el primer chunk de 7 días no se comprime hasta que ese
--     chunk completo cierra + 3h, no a las 3h de la primera fila escrita --
--     el efecto real depende del chunk_time_interval propio de la tabla,
--     que esta migración NO cambia (fuera de alcance del gap reportado).
--
-- segmentby/orderby: mismo patrón que 75 (segmentby = columna identidad del
-- sensor, orderby = discriminador restante + captured_at DESC), adaptado al
-- esquema real de cada tabla -- telemetry_fact_calc usa sensor_id_sk
-- (surrogate INTEGER, como telemetry_fact) + metric_code (su discriminador,
-- equivalente a channel_id); telemetry_multivariate usa sensor_id (UUID,
-- todavía sin migrar al catálogo dimensional de ADR-131 -- ver comentario en
-- 74_telemetry_fact_dimensions.sql: "no migra telemetry_multivariate en esta
-- fase, fuera de alcance de ADR-131") + channel_code (su discriminador,
-- equivalente a channel_id).
--
-- Idempotente: ALTER TABLE SET compress es repetible; add_compression_policy/
-- add_retention_policy con if_not_exists.
-- ============================================================================

-- telemetry_fact_calc -- misma ventana que telemetry_fact (3h/190d), ver
-- justificación arriba.
ALTER TABLE telemetry_fact_calc SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id_sk',
    timescaledb.compress_orderby   = 'metric_code, captured_at DESC'
);
SELECT add_compression_policy('telemetry_fact_calc', INTERVAL '3 hours', if_not_exists => true);
SELECT add_retention_policy('telemetry_fact_calc', INTERVAL '190 days', if_not_exists => true);

-- telemetry_multivariate -- misma ventana que telemetry_fact (3h/190d), ver
-- justificación arriba. compress_segmentby usa sensor_id (UUID) porque esta
-- tabla no tiene surrogate key (fuera de alcance de ADR-131).
ALTER TABLE telemetry_multivariate SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby   = 'channel_code, captured_at DESC'
);
SELECT add_compression_policy('telemetry_multivariate', INTERVAL '3 hours', if_not_exists => true);
SELECT add_retention_policy('telemetry_multivariate', INTERVAL '190 days', if_not_exists => true);
