-- ============================================================================
-- 82_seed_alpayana_multi_zone_diversification.sql
-- Corrige un problema de usabilidad detectado probando el wizard "Gráfico de
-- sensores": al elegir un tipo (p. ej. inclinometer), el paso 2 mostraba
-- TODOS los equipos concentrados en una sola zona (Nor-Oeste), sin poder
-- ejercitar la selección "por zona" real (varias zonas físicas, selección
-- individual y grupal cruzando zonas). Los scripts 80/81 ya habían sembrado
-- 108 sensores / 56 tipos / 7 zonas para Alpayana, pero varios tipos
-- geotécnicos e hídricos quedaron con TODAS sus unidades en una única zona.
--
-- Este script:
--   A. Agrega 3 zonas físicas de instalación reales de una operación minera
--      (antes solo había cuadrantes geográficos + disciplinas de planta):
--        - TAJO: Tajo Abierto
--        - BOTADERO: Botadero de Desmonte
--        - RELAVES: Presa de Relaves
--   B. Agrega 34 sensores nuevos repartiendo unidades adicionales de tipos
--      ya existentes (inclinometer, extensometer, piezometer_vw,
--      settlement_cell, crack_sensor, accelerograph, seismograph,
--      tiltmeter, gnss_displacement, radar_displacement, ph, turbidity,
--      conductivity, water_level, dissolved_oxygen, + estación meteo) en
--      estas 3 zonas nuevas -- así cada tipo aparece en 2-4 zonas distintas
--      en vez de 1.
--   C. Telemetría de 180 días + 30 días densos (mismo patrón que 81) para
--      los sensores nuevos.
--   D. Propaga a telemetry_fact (acotado a Alpayana).
--
-- Idempotente: ON CONFLICT DO UPDATE/NOTHING en A/B; C es aditivo sobre
-- sensores recién creados (no hay overlap posible).
-- Prerrequisitos: 80, 81 (catálogo base de 108 sensores / 7 zonas).
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

DO $$
DECLARE
  v_tid UUID := 'c7dacc61-ccf5-449b-842f-8a5f15b4a48e'; -- Alpayana
  v_lat0 DOUBLE PRECISION := -9.5427;
  v_lng0 DOUBLE PRECISION := -77.0525;
  z_tajo INT;
  z_bota INT;
  z_relaves INT;
BEGIN
  -- -------------------------------------------------------------------
  -- A. Zonas físicas nuevas
  -- -------------------------------------------------------------------
  INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order)
  VALUES
    (v_tid, 'TAJO', 'Tajo Abierto', 15),
    (v_tid, 'BOTADERO', 'Botadero de Desmonte', 25),
    (v_tid, 'RELAVES', 'Presa de Relaves', 45)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT zone_id INTO z_tajo FROM sensor_zones WHERE tenant_id = v_tid AND code = 'TAJO';
  SELECT zone_id INTO z_bota FROM sensor_zones WHERE tenant_id = v_tid AND code = 'BOTADERO';
  SELECT zone_id INTO z_relaves FROM sensor_zones WHERE tenant_id = v_tid AND code = 'RELAVES';

  -- -------------------------------------------------------------------
  -- B. 34 sensores nuevos, repartiendo tipos ya existentes en varias zonas
  -- -------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, zone_id, is_active, connection_status)
  VALUES
    -- Tajo Abierto
    (v_tid, 'INCL-07', 'Inclinómetro Fijo INCL-07 (Talud Este Tajo)', 'inclinometer', 'mm', 'INCL-07', v_lat0 + 0.015, v_lng0 + 0.002, z_tajo, true, 'online'),
    (v_tid, 'INCL-08', 'Inclinómetro Fijo INCL-08 (Talud Oeste Tajo)', 'inclinometer', 'mm', 'INCL-08', v_lat0 + 0.013, v_lng0 - 0.001, z_tajo, true, 'online'),
    (v_tid, 'EXT-05', 'Extensómetro de Varilla EXT-05 (Banco 2 Tajo)', 'extensometer', 'mm', 'EXT-05', v_lat0 + 0.016, v_lng0 + 0.001, z_tajo, true, 'online'),
    (v_tid, 'EXT-06', 'Extensómetro de Varilla EXT-06 (Banco 5 Tajo)', 'extensometer', 'mm', 'EXT-06', v_lat0 + 0.014, v_lng0 + 0.003, z_tajo, true, 'online'),
    (v_tid, 'PZ-VW-09', 'Piezómetro VW-09 (Tajo Abierto Banco 6)', 'piezometer_vw', 'kPa', 'PZ-VW-09', v_lat0 + 0.017, v_lng0 - 0.002, z_tajo, true, 'online'),
    (v_tid, 'PZ-VW-10', 'Piezómetro VW-10 (Tajo Abierto Banco 8)', 'piezometer_vw', 'kPa', 'PZ-VW-10', v_lat0 + 0.012, v_lng0 + 0.004, z_tajo, true, 'online'),
    (v_tid, 'CRACK-02', 'Sensor de Grietas Estructural CRACK-02 (Cresta Tajo)', 'crack_sensor', 'mm', 'CRACK-02', v_lat0 + 0.015, v_lng0 + 0.000, z_tajo, true, 'online'),
    (v_tid, 'ACEL-03', 'Acelerógrafo Triaxial ACEL-03 (Tajo)', 'accelerograph', 'g', 'ACEL-03', v_lat0 + 0.014, v_lng0 - 0.003, z_tajo, true, 'online'),
    (v_tid, 'TILT-02', 'Tiltmeter Biaxial TILT-02 (Berma Tajo)', 'tiltmeter', 'deg', 'TILT-02', v_lat0 + 0.016, v_lng0 + 0.002, z_tajo, true, 'online'),
    (v_tid, 'NIVEL-H2O-03', 'Nivel de Agua Fondo de Tajo NIVEL-H2O-03', 'water_level', 'm', 'NIVEL-H2O-03', v_lat0 + 0.011, v_lng0 - 0.004, z_tajo, true, 'online'),
    (v_tid, 'EM-03-TEMP', 'Estación Meteorológica EM-03 (Tajo, Temperatura)', 'temperature', '°C', 'EM-03', v_lat0 + 0.018, v_lng0 - 0.001, z_tajo, true, 'online'),
    -- Botadero de Desmonte
    (v_tid, 'INCL-09', 'Inclinómetro Fijo INCL-09 (Botadero Este)', 'inclinometer', 'mm', 'INCL-09', v_lat0 - 0.006, v_lng0 - 0.010, z_bota, true, 'online'),
    (v_tid, 'INCL-10', 'Inclinómetro Fijo INCL-10 (Botadero Oeste)', 'inclinometer', 'mm', 'INCL-10', v_lat0 - 0.008, v_lng0 - 0.013, z_bota, true, 'online'),
    (v_tid, 'EXT-07', 'Extensómetro de Varilla EXT-07 (Corona Botadero Sur)', 'extensometer', 'mm', 'EXT-07', v_lat0 - 0.007, v_lng0 - 0.011, z_bota, true, 'online'),
    (v_tid, 'EXT-08', 'Extensómetro de Varilla EXT-08 (Pie de Talud Botadero)', 'extensometer', 'mm', 'EXT-08', v_lat0 - 0.009, v_lng0 - 0.009, z_bota, true, 'online'),
    (v_tid, 'CRACK-03', 'Sensor de Grietas Estructural CRACK-03 (Botadero)', 'crack_sensor', 'mm', 'CRACK-03', v_lat0 - 0.006, v_lng0 - 0.012, z_bota, true, 'online'),
    (v_tid, 'GNSS-03', 'Estación GNSS Botadero GNSS-03', 'gnss_displacement', 'mm', 'GNSS-03', v_lat0 - 0.008, v_lng0 - 0.010, z_bota, true, 'online'),
    (v_tid, 'RADAR-03', 'Radar de Talud GB-SAR RADAR-03 (Botadero Sur)', 'radar_displacement', 'mm/dia', 'RADAR-03', v_lat0 - 0.007, v_lng0 - 0.013, z_bota, true, 'online'),
    (v_tid, 'EM-04-HUM', 'Estación Meteorológica EM-04 (Botadero, Humedad)', 'humidity', '%', 'EM-04', v_lat0 - 0.009, v_lng0 - 0.011, z_bota, true, 'online'),
    -- Presa de Relaves
    (v_tid, 'INCL-11', 'Inclinómetro Fijo INCL-11 (Muro Relaves Norte)', 'inclinometer', 'mm', 'INCL-11', v_lat0 - 0.030, v_lng0 - 0.017, z_relaves, true, 'online'),
    (v_tid, 'INCL-12', 'Inclinómetro Fijo INCL-12 (Muro Relaves Sur)', 'inclinometer', 'mm', 'INCL-12', v_lat0 - 0.033, v_lng0 - 0.014, z_relaves, true, 'online'),
    (v_tid, 'PZ-VW-11', 'Piezómetro VW-11 (Muro Relaves Corona)', 'piezometer_vw', 'kPa', 'PZ-VW-11', v_lat0 - 0.032, v_lng0 - 0.016, z_relaves, true, 'online'),
    (v_tid, 'PZ-VW-12', 'Piezómetro VW-12 (Muro Relaves Pie de Talud)', 'piezometer_vw', 'kPa', 'PZ-VW-12', v_lat0 - 0.034, v_lng0 - 0.013, z_relaves, true, 'online'),
    (v_tid, 'CELDA-AS-03', 'Celda de Asentamiento CELDA-AS-03 (Muro Relaves)', 'settlement_cell', 'mm', 'CELDA-AS-03', v_lat0 - 0.031, v_lng0 - 0.018, z_relaves, true, 'online'),
    (v_tid, 'CELDA-AS-04', 'Celda de Asentamiento CELDA-AS-04 (Dique Auxiliar)', 'settlement_cell', 'mm', 'CELDA-AS-04', v_lat0 - 0.035, v_lng0 - 0.012, z_relaves, true, 'online'),
    (v_tid, 'ACEL-04', 'Acelerógrafo Triaxial ACEL-04 (Presa de Relaves)', 'accelerograph', 'g', 'ACEL-04', v_lat0 - 0.033, v_lng0 - 0.015, z_relaves, true, 'online'),
    (v_tid, 'SISM-02', 'Sismógrafo Banda Ancha SISM-02 (Presa de Relaves)', 'seismograph', 'Hz', 'SISM-02', v_lat0 - 0.032, v_lng0 - 0.017, z_relaves, true, 'online'),
    (v_tid, 'TILT-03', 'Tiltmeter Biaxial TILT-03 (Muro Relaves)', 'tiltmeter', 'deg', 'TILT-03', v_lat0 - 0.030, v_lng0 - 0.014, z_relaves, true, 'online'),
    (v_tid, 'GNSS-04', 'Estación GNSS Presa de Relaves GNSS-04', 'gnss_displacement', 'mm', 'GNSS-04', v_lat0 - 0.034, v_lng0 - 0.016, z_relaves, true, 'online'),
    (v_tid, 'PH-03', 'pH Poza de Contacto Relaves PH-03', 'ph', 'pH', 'PH-03', v_lat0 - 0.031, v_lng0 - 0.013, z_relaves, true, 'online'),
    (v_tid, 'TURB-02', 'Turbidez Decantado Relaves TURB-02', 'turbidity', 'NTU', 'TURB-02', v_lat0 - 0.032, v_lng0 - 0.015, z_relaves, true, 'online'),
    (v_tid, 'COND-02', 'Conductividad Decantado Relaves COND-02', 'conductivity', 'uS/cm', 'COND-02', v_lat0 - 0.033, v_lng0 - 0.017, z_relaves, true, 'online'),
    (v_tid, 'OD-02', 'Oxígeno Disuelto Poza Relaves OD-02', 'dissolved_oxygen', 'mg/L', 'OD-02', v_lat0 - 0.030, v_lng0 - 0.012, z_relaves, true, 'online'),
    (v_tid, 'EM-05-VIENTO', 'Estación Meteorológica EM-05 (Relaves, Viento)', 'wind_speed', 'm/s', 'EM-05', v_lat0 - 0.035, v_lng0 - 0.018, z_relaves, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
    sensor_name = EXCLUDED.sensor_name,
    unit = EXCLUDED.unit,
    zone_id = EXCLUDED.zone_id,
    is_active = true,
    connection_status = 'online';

  INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, site_id_sk, sensor_code, sensor_type, unit, is_active)
  SELECT 'iot_v2', s.sensor_id, dt.tenant_id_sk, dsite.site_id_sk, s.sensor_code, s.sensor_type, s.unit, s.is_active
  FROM sensors s
  JOIN dim_tenant dt ON dt.tenant_id = s.tenant_id
  LEFT JOIN dim_site dsite ON dsite.site_id = s.site_id
  WHERE s.tenant_id = v_tid AND s.sensor_code IN (
    'INCL-07','INCL-08','EXT-05','EXT-06','PZ-VW-09','PZ-VW-10','CRACK-02','ACEL-03','TILT-02','NIVEL-H2O-03','EM-03-TEMP',
    'INCL-09','INCL-10','EXT-07','EXT-08','CRACK-03','GNSS-03','RADAR-03','EM-04-HUM',
    'INCL-11','INCL-12','PZ-VW-11','PZ-VW-12','CELDA-AS-03','CELDA-AS-04','ACEL-04','SISM-02','TILT-03','GNSS-04',
    'PH-03','TURB-02','COND-02','OD-02','EM-05-VIENTO'
  )
  ON CONFLICT (sensor_id) DO NOTHING;

  -- -------------------------------------------------------------------
  -- C.1 Telemetría de los 34 sensores nuevos: 180 días cada 1 hora
  -- -------------------------------------------------------------------
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'inclinometer' THEN 2.0 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN 4.5 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.006 + (random() - 0.5) * 0.08
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 2.0
      WHEN 'settlement_cell' THEN -3.0 - (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.012 + (random() - 0.5) * 0.04
      WHEN 'crack_sensor' THEN 1.8 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.004 + 0.2 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 0.02
      WHEN 'accelerograph' THEN greatest(0.001, 0.012 + (CASE WHEN random() > 0.98 THEN 0.08 * random() ELSE 0.003 * random() END))
      WHEN 'seismograph' THEN greatest(0.5, 8.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 12.0) + (CASE WHEN random() > 0.97 THEN 20.0 * random() ELSE 1.5 * random() END))
      WHEN 'tiltmeter' THEN 0.35 + 0.15 * sin(2.0 * pi() * extract(day from t) / 9.0) + (random() - 0.5) * 0.02
      WHEN 'gnss_displacement' THEN 1.0 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.05
      WHEN 'radar_displacement' THEN 0.5 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.05
      WHEN 'water_level' THEN 5.8 + 1.2 * sin(2.0 * pi() * extract(day from t) / 10.0) + (random() - 0.5) * 0.05
      WHEN 'temperature' THEN 16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from t) - 8.0) / 24.0) + (random() - 0.5) * 1.2
      WHEN 'humidity' THEN 65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from t) - 8.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'wind_speed' THEN greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from t) - 11.0) / 24.0) + (random() - 0.3) * 3.5)
      WHEN 'ph' THEN 7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'turbidity' THEN greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from t) + extract(hour from t) / 24.0) / 3.0) + (random() - 0.5) * 1.5)
      WHEN 'conductivity' THEN 750.0 + 120.0 * sin(2.0 * pi() * extract(day from t) / 7.0) + (random() - 0.5) * 25.0
      WHEN 'dissolved_oxygen' THEN 6.5 + 0.8 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.3
      ELSE 50.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.h || ' hours')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(0, 4320, 1) AS g(h)
    WHERE s.tenant_id = v_tid AND s.sensor_code IN (
      'INCL-07','INCL-08','EXT-05','EXT-06','PZ-VW-09','PZ-VW-10','CRACK-02','ACEL-03','TILT-02','NIVEL-H2O-03','EM-03-TEMP',
      'INCL-09','INCL-10','EXT-07','EXT-08','CRACK-03','GNSS-03','RADAR-03','EM-04-HUM',
      'INCL-11','INCL-12','PZ-VW-11','PZ-VW-12','CELDA-AS-03','CELDA-AS-04','ACEL-04','SISM-02','TILT-03','GNSS-04',
      'PH-03','TURB-02','COND-02','OD-02','EM-05-VIENTO'
    )
  ) base;

  -- -------------------------------------------------------------------
  -- C.2 Alta resolución: 30 días cada 15 minutos (evita duplicar los
  -- puntos horarios exactos de C.1)
  -- -------------------------------------------------------------------
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 1.5
      WHEN 'temperature' THEN 16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 0.8
      WHEN 'humidity' THEN 65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'ph' THEN 7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.05
      WHEN 'turbidity' THEN greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from t) + extract(hour from t) / 24.0) / 3.0) + (random() - 0.5) * 1.0)
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 1.5
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.m || ' minutes')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(15, 43200, 15) AS g(m)  -- 30 días
    WHERE s.tenant_id = v_tid AND s.sensor_code IN (
      'INCL-07','INCL-08','EXT-05','EXT-06','PZ-VW-09','PZ-VW-10','CRACK-02','ACEL-03','TILT-02','NIVEL-H2O-03','EM-03-TEMP',
      'INCL-09','INCL-10','EXT-07','EXT-08','CRACK-03','GNSS-03','RADAR-03','EM-04-HUM',
      'INCL-11','INCL-12','PZ-VW-11','PZ-VW-12','CELDA-AS-03','CELDA-AS-04','ACEL-04','SISM-02','TILT-03','GNSS-04',
      'PH-03','TURB-02','COND-02','OD-02','EM-05-VIENTO'
    )
    AND (g.m % 60) <> 0
  ) base;

  -- -------------------------------------------------------------------
  -- D. Propagación a telemetry_fact acotada a Alpayana
  -- -------------------------------------------------------------------
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
