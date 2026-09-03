-- ============================================================================
-- 83_seed_alpayana_refresh_recent_telemetry.sql
-- Refresco de telemetría "hasta ahora" para TODO el catálogo de ALPAYANA (142
-- sensores / 56 tipos / 10 zonas, sembrado por 80/81/82) -- a pedido: "data
-- actualizada para poder mostrar la información en los diagramas... con los
-- distintos tipos de diagramación". Los scripts anteriores dejaron la
-- telemetría fija en el instante en que corrieron; con el tiempo real
-- avanzando, ese punto máximo queda cada vez más atrás de NOW().
--
-- A diferencia de 80/81/82 (que sembraron catálogo + historia larga), este
-- script es DELIBERADAMENTE LIVIANO y pensado para re-ejecutarse cada vez
-- que se necesite refrescar la ventana reciente antes de una demo/prueba:
-- solo siembra los últimos 4 días a resolución de 10 minutos (densa, para
-- que "Últimas 24h"/"Últimos 7 días" y los 10 tipos de gráfico -- línea,
-- área, barras, dispersión, escalón, radar, pastel, anillo, mapa de calor,
-- caja y bigotes -- tengan datos representativos y recientes), en vez de
-- volver a generar 180 días completos.
--
-- Consolida en un único CASE las fórmulas de los 56 tipos de sensor
-- sembrados por 80 (29 tipos), 81 (27 tipos nuevos) y 82 (reutiliza tipos de
-- 80/81 en zonas nuevas) -- con ELSE genérico por si se agrega un tipo
-- nuevo más adelante sin actualizar este script.
--
-- Idempotente: borra y reinserta la ventana de los últimos 4 días para los
-- sensores de Alpayana (no toca la historia anterior sembrada por 80/81/82),
-- y propaga a telemetry_fact acotado a este tenant.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '300s';
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

DO $$
DECLARE
  v_tid UUID := 'c7dacc61-ccf5-449b-842f-8a5f15b4a48e'; -- Alpayana
BEGIN
  -- Ventana reciente a refrescar: últimos 4 días. Los chunks de telemetry_raw
  -- de los últimos días no suelen estar comprimidos todavía (la política de
  -- compresión apunta a chunks viejos), así que este DELETE es liviano.
  DELETE FROM telemetry_raw tr USING sensors s
  WHERE tr.sensor_id = s.sensor_id
    AND s.tenant_id = v_tid
    AND tr.captured_at >= NOW() - interval '4 days';

  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      -- Ambiental
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
      -- Hídrico / vertimientos
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
      -- Geotécnico / estructural (sin tendencia de largo plazo en esta ventana corta)
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
      -- Planta concentradora
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
      -- Ventilación subterránea
      WHEN 'air_velocity' THEN greatest(0.0, 2.2 + 0.6 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.2)
      WHEN 'co2_level' THEN greatest(300.0, 650.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 15.0) / 24.0) + (random() - 0.5) * 25.0)
      WHEN 'methane_level' THEN greatest(0.0, 0.4 + 0.3 * random() + (CASE WHEN random() > 0.997 THEN 3.0 * random() ELSE 0.0 END))
      WHEN 'o2_level' THEN 20.7 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.1
      WHEN 'gas_h2s' THEN greatest(0.0, 0.8 + 0.5 * random())
      -- Flota de equipos
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
    CROSS JOIN generate_series(0, 5760, 10) AS g(m)  -- 4 días cada 10 minutos
    WHERE s.tenant_id = v_tid
  ) base;

  -- Propagación a telemetry_fact acotada a Alpayana
  INSERT INTO telemetry_fact (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code, kafka_partition, kafka_offset)
  SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, tr.captured_at, tr.value_numeric::real, tr.quality_code, tr.kafka_partition, tr.kafka_offset
  FROM telemetry_raw tr
  JOIN dim_sensor ds ON ds.sensor_id = tr.sensor_id
  JOIN dim_tenant dt ON dt.tenant_id_sk = ds.tenant_id_sk
  WHERE dt.tenant_id = v_tid
    AND tr.captured_at >= NOW() - interval '4 days'
  ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO UPDATE SET value_numeric = EXCLUDED.value_numeric;

END
$$;

COMMIT;
