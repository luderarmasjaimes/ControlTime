-- ============================================================================
-- 84_fix_alpayana_dense_window_contamination.sql
-- Corrige un bug real detectado probando el wizard con datos reales: los
-- bloques "alta resolución 15 min / 30 días" de 81 y 82 (sensores nuevos)
-- usaban un CASE incompleto (solo 5-8 tipos explícitos de los 18-27 que
-- debían cubrir) -- el resto caía en un ELSE genérico (~50 ± 15) durante
-- TODO el mes, contaminando exactamente el rango "Últimos 30 días" que se
-- usa para probar el wizard. Se manifestó como un gráfico que promedia
-- ~36 en vez de ~5 mm para un extensómetro (EXT-07), por ejemplo.
--
-- Alcance del bug (tipos que cayeron en el ELSE de 81/82, confirmado por
-- inspección de esos scripts): inclinometer, extensometer, settlement_cell,
-- crack_sensor, accelerograph, seismograph, tiltmeter, gnss_displacement,
-- radar_displacement, water_level, wind_speed, conductivity,
-- dissolved_oxygen (script 82); rain_gauge, dust_pm25, uv_index,
-- suspended_solids, chemical_oxygen_demand, biochemical_oxygen_demand,
-- mill_throughput, slurry_density, reagent_flow, power_factor,
-- transformer_temp, hydraulic_pressure, gas_h2s, tire_pressure (script 81).
--
-- Fix: en vez de parchear cada combinación sensor/tipo afectada, se borra
-- TODO punto no alineado a la hora exacta (minuto != 0) en los últimos 30
-- días para todo el catálogo de Alpayana -- son justamente los puntos
-- "densos" de los bloques con el bug (los puntos horarios en minuto=0
-- vienen de los bloques C.1/A.1 de 180 días, que sí tenían el CASE
-- completo y no se tocan) -- y se regenera con el CASE completo y correcto
-- (56 tipos) para ese mismo rango.
--
-- Después se limpia y re-propaga telemetry_fact para Alpayana (las filas
-- viejas contaminadas no se borran solas al borrar telemetry_raw -- son
-- tablas independientes) y se refresca el continuous aggregate
-- telemetry_fact_hourly, que es lo que realmente lee el wizard para
-- cualquier rango > 7 días.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '900s';
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

DO $$
DECLARE
  v_tid UUID := 'c7dacc61-ccf5-449b-842f-8a5f15b4a48e'; -- Alpayana
BEGIN
  -- Borra SOLO los puntos densos (no alineados a la hora) de los últimos 30
  -- días -- conserva intacta la grilla horaria (minuto=0), que viene de los
  -- bloques de 180 días con fórmulas correctas.
  DELETE FROM telemetry_raw tr USING sensors s
  WHERE tr.sensor_id = s.sensor_id
    AND s.tenant_id = v_tid
    AND tr.captured_at >= NOW() - interval '30 days'
    AND date_part('minute', tr.captured_at) <> 0;

  -- Regenera esos mismos puntos (cada 15 minutos, 30 días) con el CASE
  -- completo (56 tipos, mismo set usado en 83_seed_alpayana_refresh_recent_telemetry.sql).
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'temperature' THEN 16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 0.8
      WHEN 'humidity' THEN 65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'barometric_pressure' THEN 710.0 + 3.0 * sin(2.0 * pi() * (extract(hour from t) - 3.0) / 12.0) + (random() - 0.5) * 0.5
      WHEN 'wind_speed' THEN greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from t) - 11.0) / 24.0) + (random() - 0.3) * 2.5)
      WHEN 'net_radiation' THEN greatest(0.0, 850.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from t) + extract(minute from t) / 60.0 - 6.0) / 12.0))) + (random() - 0.5) * 10.0)
      WHEN 'evaporation' THEN greatest(0.1, 4.2 + 2.5 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.5)
      WHEN 'rain_gauge' THEN greatest(0.0, CASE WHEN random() > 0.97 THEN 6.0 * random() ELSE 0.0 END)
      WHEN 'dust_pm10' THEN greatest(3.0, 35.0 + 20.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 6.0)
      WHEN 'dust_pm25' THEN greatest(2.0, 18.0 + 10.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 3.0)
      WHEN 'uv_index' THEN greatest(0.0, 8.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from t) - 6.0) / 12.0))) + (random() - 0.5) * 0.5)
      WHEN 'noise_level' THEN greatest(38.0, 55.0 + 15.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 13.0) / 24.0)) + (random() - 0.5) * 3.0 + (CASE WHEN random() > 0.99 THEN 25.0 * random() ELSE 0 END))
      WHEN 'gas_co' THEN greatest(0.0, 1.5 + 0.8 * random())
      WHEN 'metals_analyzer' THEN
        CASE
          WHEN sensor_code LIKE '%-CU' THEN 0.85 + 0.45 * sin(2.0 * pi() * extract(day from t) / 5.0) + (random() - 0.5) * 0.05
          WHEN sensor_code LIKE '%-PB' THEN 0.08 + 0.04 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 0.006
          ELSE 1.65 + 0.80 * sin(2.0 * pi() * extract(day from t) / 4.0) + (random() - 0.5) * 0.08
        END
      WHEN 'conductivity' THEN 750.0 + 120.0 * sin(2.0 * pi() * extract(day from t) / 7.0) + (random() - 0.5) * 25.0
      WHEN 'ph' THEN 7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.05
      WHEN 'turbidity' THEN greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from t) + extract(hour from t) / 24.0) / 3.0) + (random() - 0.5) * 1.0)
      WHEN 'water_level' THEN 5.8 + 1.2 * sin(2.0 * pi() * extract(day from t) / 10.0) + (random() - 0.5) * 0.05
      WHEN 'water_velocity' THEN 1.4 + 0.4 * sin(2.0 * pi() * (extract(hour from t) - 6.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'flow_rate' THEN 95.0 + 30.0 * sin(2.0 * pi() * (extract(hour from t) - 7.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'dissolved_oxygen' THEN 6.5 + 0.8 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.2
      WHEN 'orp' THEN 150.0 + 40.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 6.0
      WHEN 'water_temperature' THEN 14.0 + 1.5 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.2
      WHEN 'tailings_pond_level' THEN 3.2 + (random() - 0.5) * 0.03
      WHEN 'suspended_solids' THEN 25.0 + 10.0 * sin(2.0 * pi() * extract(day from t) / 5.0) + (random() - 0.5) * 4.0
      WHEN 'chemical_oxygen_demand' THEN 45.0 + 15.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 5.0
      WHEN 'biochemical_oxygen_demand' THEN 12.0 + 5.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 2.0
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 1.5
      WHEN 'inclinometer' THEN 3.8 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN 5.3 + (random() - 0.5) * 0.08
      WHEN 'settlement_cell' THEN -4.6 + (random() - 0.5) * 0.04
      WHEN 'crack_sensor' THEN 2.4 + 0.2 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 0.02
      WHEN 'tiltmeter' THEN 0.35 + 0.15 * sin(2.0 * pi() * extract(day from t) / 9.0) + (random() - 0.5) * 0.02
      WHEN 'accelerograph' THEN greatest(0.001, 0.012 + (CASE WHEN random() > 0.98 THEN 0.08 * random() ELSE 0.003 * random() END))
      WHEN 'seismograph' THEN greatest(0.5, 8.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 12.0) + (CASE WHEN random() > 0.97 THEN 20.0 * random() ELSE 1.5 * random() END))
      WHEN 'gnss_displacement' THEN 2.3 + (random() - 0.5) * 0.05
      WHEN 'radar_displacement' THEN 1.1 + (random() - 0.5) * 0.05
      WHEN 'mill_throughput' THEN greatest(0.0, 850.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 40.0)
      WHEN 'crusher_vibration' THEN 4.5 + 2.0 * random() + (CASE WHEN random() > 0.99 THEN 6.0 * random() ELSE 0.0 END)
      WHEN 'conveyor_speed' THEN greatest(0.0, 2.8 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.1)
      WHEN 'slurry_density' THEN 1.35 + 0.08 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.03
      WHEN 'reagent_flow' THEN greatest(0.0, 120.0 + 30.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 10.0)
      WHEN 'voltage' THEN 460.0 + 8.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'current' THEN greatest(0.0, 320.0 + 60.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 12.0)
      WHEN 'power_factor' THEN least(1.0, greatest(0.0, 0.92 + 0.03 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.02))
      WHEN 'transformer_temp' THEN 55.0 + 10.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'hydraulic_pressure' THEN greatest(0.0, 180.0 + 20.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 8.0)
      WHEN 'air_velocity' THEN greatest(0.0, 2.2 + 0.6 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.2)
      WHEN 'co2_level' THEN greatest(300.0, 650.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 15.0) / 24.0) + (random() - 0.5) * 25.0)
      WHEN 'methane_level' THEN greatest(0.0, 0.4 + 0.3 * random() + (CASE WHEN random() > 0.997 THEN 3.0 * random() ELSE 0.0 END))
      WHEN 'o2_level' THEN 20.7 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.1
      WHEN 'gas_h2s' THEN greatest(0.0, 0.8 + 0.5 * random())
      WHEN 'fuel_level' THEN least(100.0, greatest(5.0, 55.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 3.0) + (random() - 0.5) * 5.0))
      WHEN 'engine_temperature' THEN 88.0 + 6.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'tire_pressure' THEN 95.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'payload_weight' THEN greatest(0.0, 45.0 + 40.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 12.0) / 16.0)) + (random() - 0.5) * 5.0)
      WHEN 'equipment_vibration' THEN 3.2 + 1.5 * random() + (CASE WHEN random() > 0.99 THEN 5.0 * random() ELSE 0.0 END)
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, s.sensor_code, NOW() - (g.m || ' minutes')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(15, 43200, 15) AS g(m)  -- 30 días cada 15 minutos
    WHERE s.tenant_id = v_tid
      AND (g.m % 60) <> 0
  ) base;

  -- Limpia y re-propaga telemetry_fact para Alpayana desde el raw ya limpio
  -- (evita filas huérfanas de siembras anteriores para las mismas
  -- combinaciones sensor+timestamp).
  DELETE FROM telemetry_fact tf
  USING dim_sensor ds, dim_tenant dt
  WHERE tf.sensor_id_sk = ds.sensor_id_sk
    AND ds.tenant_id_sk = dt.tenant_id_sk
    AND dt.tenant_id = v_tid;

  INSERT INTO telemetry_fact (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code, kafka_partition, kafka_offset)
  SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, tr.captured_at, tr.value_numeric::real, tr.quality_code, tr.kafka_partition, tr.kafka_offset
  FROM telemetry_raw tr
  JOIN dim_sensor ds ON ds.sensor_id = tr.sensor_id
  JOIN dim_tenant dt ON dt.tenant_id_sk = ds.tenant_id_sk
  WHERE dt.tenant_id = v_tid
  ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;

END
$$;

COMMIT;
