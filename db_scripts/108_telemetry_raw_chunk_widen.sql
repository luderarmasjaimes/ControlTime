-- ============================================================================
-- 108_telemetry_raw_chunk_widen.sql
-- ADR-186 (bug real: chunk scan sin cota de tiempo) acotó 3 consultas contra
-- telemetry_fact/telemetry_fact_calc, pero nunca tocó telemetry_raw -- esa
-- tabla sigue con chunk_time_interval=1h
-- (67_telemetry_25k_hardening.sql, que lo achicó desde las 6h originales de
-- 64_telemetry_ingest_optimization.sql). telemetry_raw sigue viva y recibe
-- escritura real en paralelo a telemetry_fact (ADR-131, doble escritura
-- deliberada) -- no fue reemplazada. Con retención de 190 días
-- (44_adr006_alinear_retencion_archivado.sql) y chunks de 1h, se sostienen
-- en todo momento ~4.560 chunks acumulados sobre telemetry_raw -- el mismo
-- problema de fondo que documentó ADR-186 para telemetry_fact (el costo de
-- planificación/ejecución de un ORDER BY/rango amplio sin cota crece con la
-- CANTIDAD DE CHUNKS acumulados con el tiempo, no con el volumen de filas/s),
-- aplicado acá a telemetry_raw, que ADR-186 nunca auditó.
--
-- Por qué volver a 6h (el valor original de 64, antes de que 67 lo achicara):
-- reduce el overhead de chunk-scan por consulta para cualquier query futura
-- de rango amplio o sin cota contra telemetry_raw, a costa de chunks
-- individuales más grandes. set_chunk_time_interval SOLO afecta chunks
-- NUEVOS creados a partir de este momento -- los ~4.560 chunks de 1h ya
-- existentes NO se fusionan ni se ven afectados por este cambio, siguen
-- como están hasta que la política de retención de 190 días los descarte
-- naturalmente por su cuenta.
--
-- TRADE-OFF real, no gratuito -- 67 achicó a 1h por una razón de ESCRITURA,
-- no de lectura: sostener 25.000 filas/s (SPEC-020/ADR-008). A 25k/s, un
-- chunk de 6h acumularía ~540 millones de filas antes de cerrar (90M/h * 6h
-- -- el propio comentario de 67 hace ese cálculo), lo que 67 consideró que
-- degradaba el working set en memoria y el costo de índices/compresión/
-- retención/mantenimiento sobre el chunk caliente de ingesta. Ese
-- razonamiento sigue siendo válido si este entorno alguna vez sostiene 25k/s
-- reales -- hoy no los sostiene: el propio ADR-186 aclara que "el número de
-- chunks ya es alto HOY... por el tiempo transcurrido con chunk_time_interval
-- tan chico", no por volumen de filas/s real de este entorno. Este script
-- prioriza el costo de LECTURA (chunk-scan de queries de rango amplio, el
-- problema real y ya materializado que documentó ADR-186) sobre el costo de
-- ESCRITURA (working set por chunk, hoy hipotético a los volúmenes reales
-- de este entorno) -- si la ingesta real se acerca al diseño de 25k/s en el
-- futuro, este valor debería revisarse de nuevo antes de esa escala.
--
-- Guardado bajo el mismo patrón defensivo que 67 (verifica que la hypertable
-- exista antes de llamar set_chunk_time_interval, para no romper en un
-- entorno donde telemetry_raw todavía no se creó). Idempotente: re-ejecutar
-- vuelve a fijar el mismo valor sin efecto adicional.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_schema = 'public' AND hypertable_name = 'telemetry_raw'
    ) THEN
        PERFORM set_chunk_time_interval('public.telemetry_raw', INTERVAL '6 hours');
    END IF;
END $$;
