-- ============================================================================
-- 57_seed_rich_sensor_telemetry_test_data.sql
-- Datos de prueba enriquecidos, variados y continuos para el wizard
-- "Gráfico de sensores" (ReportStudioV2) en TODOS los tenants.
--
-- Cobertura:
--   1. Catálogo completo de 4 zonas geográficas industriales (NOR-ESTE,
--      NOR-OESTE, SUR-ESTE, SUR-OESTE, SIN-ZONA).
--   2. 21+ tipos de sensores mineros reales organizados por disciplina:
--      - Ambiental: temperature, humidity, barometric_pressure, wind_speed,
--                   metals_analyzer (Cu, Pb, Zn), net_radiation, evaporation
--      - Hídrico/Vertimientos: conductivity, ph, turbidity, piezometer_vw,
--                              water_level, water_velocity, flow_rate
--      - Geotécnico/Estructural: inclinometer, extensometer, settlement_cell,
--                                accelerograph, seismograph, tiltmeter, crack_sensor
--   3. Telemetría sintética continua de 45 días hasta NOW():
--      - Intervalos de 1 hora en los últimos 45 días.
--      - Intervalos densos de 15 minutos en las últimas 48 horas.
--      - Curvas matemáticas con ciclos solares diurnos, derivas geotécnicas
--        reales, respuestas hidrostáticas y variaciones térmicas.
--
-- Idempotente: limpia telemetría previa obsoleta del catálogo de prueba y
-- reinserta con marcas de tiempo sincronizadas a NOW().
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '300s';

DO $$
DECLARE
  t RECORD;
  v_tid UUID;
  v_lat0 DOUBLE PRECISION := -9.5427;
  v_lng0 DOUBLE PRECISION := -77.0525;
  z_ne INT;
  z_no INT;
  z_se INT;
  z_so INT;
  z_sz INT;
  c_lat DOUBLE PRECISION;
  c_lng DOUBLE PRECISION;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    v_tid := t.tenant_id;

    -- -------------------------------------------------------------------
    -- 1. Catálogo de zonas geográficas
    -- -------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM sensor_zones WHERE tenant_id = v_tid) THEN
      INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order)
      VALUES
        (v_tid, 'NOR-ESTE', 'Nor-Este - Monitoreo Ambiental', 10),
        (v_tid, 'NOR-OESTE', 'Nor-Oeste - Geotecnia y Taludes', 20),
        (v_tid, 'SUR-ESTE', 'Sur-Este - Calidad de Agua y Vertimientos', 30),
        (v_tid, 'SUR-OESTE', 'Sur-Oeste - Hidrología y Piezometría', 40),
        (v_tid, 'SIN-ZONA', 'Sin zona asignada', 90)
      ON CONFLICT (tenant_id, code) DO NOTHING;
    END IF;

    -- -------------------------------------------------------------------
    -- 2. Sensores por disciplina y cuadrante
    -- -------------------------------------------------------------------

    -- 2.1 Ambiental — NOR-ESTE (lat > c_lat, lng > c_lng)
    INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
    VALUES
      (v_tid, 'EM-01-TEMP', 'Estación Meteorológica EM-01 (Temperatura)', 'temperature', '°C', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
      (v_tid, 'EM-01-HUM', 'Estación Meteorológica EM-01 (Humedad)', 'humidity', '%', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
      (v_tid, 'EM-01-PRES', 'Estación Meteorológica EM-01 (Presión Barométrica)', 'barometric_pressure', 'hPa', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
      (v_tid, 'EM-01-VIENTO', 'Estación Meteorológica EM-01 (Velocidad de Viento)', 'wind_speed', 'm/s', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
      (v_tid, 'EM-02-TEMP', 'Estación Meteorológica EM-02 (Temperatura Campamento)', 'temperature', '°C', 'EM-02', v_lat0 + 0.022, v_lng0 + 0.015, true, 'online'),
      (v_tid, 'AM-01-CU', 'Analizador de Metales AM-01 (Cobre)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
      (v_tid, 'AM-01-PB', 'Analizador de Metales AM-01 (Plomo)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
      (v_tid, 'AM-01-ZN', 'Analizador de Metales AM-01 (Zinc)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
      (v_tid, 'RADNET-01', 'Radiación Solar Neta RADNET-01', 'net_radiation', 'W/m2', 'RADNET-01', v_lat0 + 0.024, v_lng0 + 0.012, true, 'online')
    ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
      sensor_name = EXCLUDED.sensor_name,
      unit = EXCLUDED.unit,
      serial_number = EXCLUDED.serial_number,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_active = true,
      connection_status = 'online';

    -- 2.2 Ambiental / Vertimientos — SUR-ESTE (lat < c_lat, lng > c_lng)
    INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
    VALUES
      (v_tid, 'COND-01', 'Conductividad Efluente COND-01', 'conductivity', 'uS/cm', 'COND-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'PH-01', 'pH Poza Sedimentación PH-01', 'ph', 'pH', 'PH-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'PH-02', 'pH Canal Tratamiento PH-02', 'ph', 'pH', 'PH-02', v_lat0 - 0.025, v_lng0 + 0.023, true, 'online'),
      (v_tid, 'TURB-01', 'Turbidez Efluente Final TURB-01', 'turbidity', 'NTU', 'TURB-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'EVAP-01', 'Evaporación Poza Norte EVAP-01', 'evaporation', 'mm', 'EVAP-01', v_lat0 - 0.033, v_lng0 + 0.027, true, 'online')
    ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
      sensor_name = EXCLUDED.sensor_name,
      unit = EXCLUDED.unit,
      serial_number = EXCLUDED.serial_number,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_active = true,
      connection_status = 'online';

    -- 2.3 Hídrico y Piezometría — SUR-OESTE (lat < c_lat, lng < c_lng)
    INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
    VALUES
      (v_tid, 'PZ-VW-01', 'Piezómetro VW-01 (Tajo Abierto Banco 1)', 'piezometer_vw', 'kPa', 'PZ-VW-01', v_lat0 - 0.017, v_lng0 - 0.022, true, 'online'),
      (v_tid, 'PZ-VW-02', 'Piezómetro VW-02 (Muro Presa Relaves)', 'piezometer_vw', 'kPa', 'PZ-VW-02', v_lat0 - 0.026, v_lng0 - 0.015, true, 'online'),
      (v_tid, 'PZ-VW-03', 'Piezómetro VW-03 (Botadero Norte)', 'piezometer_vw', 'kPa', 'PZ-VW-03', v_lat0 - 0.038, v_lng0 - 0.031, true, 'online'),
      (v_tid, 'NIVEL-H2O-01', 'Nivel de Agua Laguna Clarificación', 'water_level', 'm', 'NIVEL-H2O-01', v_lat0 - 0.012, v_lng0 - 0.040, true, 'online'),
      (v_tid, 'VEL-H2O-01', 'Velocidad Canal de Desvío VEL-H2O-01', 'water_velocity', 'm/s', 'VEL-H2O-01', v_lat0 - 0.012, v_lng0 - 0.040, true, 'online'),
      (v_tid, 'CAUDAL-01', 'Caudal Vertedero Principal CAUDAL-01', 'flow_rate', 'L/s', 'CAUDAL-01', v_lat0 - 0.029, v_lng0 - 0.009, true, 'online')
    ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
      sensor_name = EXCLUDED.sensor_name,
      unit = EXCLUDED.unit,
      serial_number = EXCLUDED.serial_number,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_active = true,
      connection_status = 'online';

    -- 2.4 Geotécnico y Estructural — NOR-OESTE (lat > c_lat, lng < c_lng)
    INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
    VALUES
      (v_tid, 'INCL-01', 'Inclinómetro Fijo INCL-01 (Talud Norte)', 'inclinometer', 'mm', 'INCL-01', v_lat0 + 0.014, v_lng0 - 0.018, true, 'online'),
      (v_tid, 'INCL-02', 'Inclinómetro Fijo INCL-02 (Talud Sur)', 'inclinometer', 'mm', 'INCL-02', v_lat0 + 0.022, v_lng0 - 0.026, true, 'online'),
      (v_tid, 'INCL-03', 'Inclinómetro Fijo INCL-03 (Presa Relaves)', 'inclinometer', 'mm', 'INCL-03', v_lat0 + 0.033, v_lng0 - 0.011, true, 'online'),
      (v_tid, 'EXT-01', 'Extensómetro de Varilla EXT-01 (Banco 4)', 'extensometer', 'mm', 'EXT-01', v_lat0 + 0.019, v_lng0 - 0.033, true, 'online'),
      (v_tid, 'EXT-02', 'Extensómetro de Varilla EXT-02 (Rampa Principal)', 'extensometer', 'mm', 'EXT-02', v_lat0 + 0.027, v_lng0 - 0.041, true, 'online'),
      (v_tid, 'CELDA-AS-01', 'Celda de Asentamiento CELDA-AS-01', 'settlement_cell', 'mm', 'CELDA-AS-01', v_lat0 + 0.011, v_lng0 - 0.024, true, 'online'),
      (v_tid, 'CELDA-AS-02', 'Celda de Asentamiento CELDA-AS-02', 'settlement_cell', 'mm', 'CELDA-AS-02', v_lat0 + 0.040, v_lng0 - 0.019, true, 'online'),
      (v_tid, 'ACEL-01', 'Acelerógrafo Triaxial ACEL-01', 'accelerograph', 'g', 'ACEL-01', v_lat0 + 0.016, v_lng0 - 0.037, true, 'online'),
      (v_tid, 'ACEL-02', 'Acelerógrafo Triaxial ACEL-02', 'accelerograph', 'g', 'ACEL-02', v_lat0 + 0.030, v_lng0 - 0.014, true, 'online'),
      (v_tid, 'SISM-01', 'Sismógrafo Banda Ancha SISM-01', 'seismograph', 'Hz', 'SISM-01', v_lat0 + 0.024, v_lng0 - 0.029, true, 'online'),
      (v_tid, 'TILT-01', 'Tiltmeter Biaxial TILT-01', 'tiltmeter', 'deg', 'TILT-01', v_lat0 + 0.013, v_lng0 - 0.008, true, 'online'),
      (v_tid, 'GRIETA-01', 'Sensor de Grietas Estructural GRIETA-01', 'crack_sensor', 'mm', 'GRIETA-01', v_lat0 + 0.037, v_lng0 - 0.033, true, 'online')
    ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
      sensor_name = EXCLUDED.sensor_name,
      unit = EXCLUDED.unit,
      serial_number = EXCLUDED.serial_number,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_active = true,
      connection_status = 'online';

    -- -------------------------------------------------------------------
    -- 3. Asignación precisa de zonas por cuadrante geográfico
    -- -------------------------------------------------------------------
    SELECT AVG(lat), AVG(lng) INTO c_lat, c_lng
      FROM sensors WHERE tenant_id = v_tid AND lat IS NOT NULL AND lng IS NOT NULL;

    UPDATE sensor_zones SET centroid_lat = c_lat, centroid_lng = c_lng
      WHERE tenant_id = v_tid AND code IN ('NOR-ESTE', 'NOR-OESTE', 'SUR-ESTE', 'SUR-OESTE');

    SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-ESTE';
    SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-OESTE';
    SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-ESTE';
    SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-OESTE';
    SELECT zone_id INTO z_sz FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SIN-ZONA';

    UPDATE sensors SET zone_id = CASE
        WHEN lat >= c_lat AND lng >= c_lng THEN z_ne
        WHEN lat >= c_lat AND lng <  c_lng THEN z_no
        WHEN lat <  c_lat AND lng >= c_lng THEN z_se
        WHEN lat <  c_lat AND lng <  c_lng THEN z_so
        ELSE z_sz
      END
      WHERE tenant_id = v_tid AND lat IS NOT NULL AND lng IS NOT NULL;

  END LOOP;

  -- ---------------------------------------------------------------------
  -- 4. Inserción masiva de Telemetría Dinámica (45 días hasta NOW())
  -- ---------------------------------------------------------------------
  -- Limpiar telemetría de prueba antigua para los sensores del catálogo
  -- para que las series reflejen el rango actual exactamente.
  DELETE FROM telemetry_raw tr
  USING sensors s
  WHERE tr.sensor_id = s.sensor_id
    AND s.serial_number IN (
      'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
    );

  -- 4.1 Rango general: cada 1 hora desde hace 45 días (1080 horas)
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT
    s.tenant_id,
    s.sensor_id,
    NOW() - (g.h || ' hours')::interval AS t,
    CASE s.sensor_type
      WHEN 'temperature' THEN
        16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 8.0) / 24.0) + (random() - 0.5) * 1.2
      WHEN 'humidity' THEN
        65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 8.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'barometric_pressure' THEN
        710.0 + 3.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 3.0) / 12.0) + (random() - 0.5) * 0.8
      WHEN 'wind_speed' THEN
        greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 11.0) / 24.0) + (random() - 0.3) * 3.5)
      WHEN 'net_radiation' THEN
        greatest(0.0, 850.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 6.0) / 12.0))) + (random() - 0.5) * 15.0)
      WHEN 'evaporation' THEN
        greatest(0.1, 4.2 + 2.5 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 9.0) / 24.0) + (random() - 0.5) * 0.5)
      WHEN 'conductivity' THEN
        750.0 + 120.0 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 7.0) + (random() - 0.5) * 25.0
      WHEN 'ph' THEN
        7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 10.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'turbidity' THEN
        greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from (NOW() - (g.h || ' hours')::interval)) + extract(hour from (NOW() - (g.h || ' hours')::interval))/24.0) / 3.0) + (random() - 0.5) * 1.5)
      WHEN 'piezometer_vw' THEN
        240.0 + 35.0 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 14.0) + (random() - 0.5) * 2.0
      WHEN 'water_level' THEN
        5.8 + 1.2 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 10.0) + (random() - 0.5) * 0.05
      WHEN 'water_velocity' THEN
        1.4 + 0.4 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 6.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'flow_rate' THEN
        95.0 + 30.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 7.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'metals_analyzer' THEN
        CASE
          WHEN s.sensor_code LIKE '%-CU' THEN 0.85 + 0.45 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 5.0) + (random() - 0.5) * 0.05
          WHEN s.sensor_code LIKE '%-PB' THEN 0.08 + 0.04 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 6.0) + (random() - 0.5) * 0.006
          ELSE 1.65 + 0.80 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 4.0) + (random() - 0.5) * 0.08
        END
      WHEN 'inclinometer' THEN
        2.0 + (extract(epoch from ((NOW() - (g.h || ' hours')::interval) - (now() - interval '45 days'))) / 86400.0) * 0.04 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN
        4.5 + (extract(epoch from ((NOW() - (g.h || ' hours')::interval) - (now() - interval '45 days'))) / 86400.0) * 0.025 + (random() - 0.5) * 0.08
      WHEN 'settlement_cell' THEN
        -3.0 - (extract(epoch from ((NOW() - (g.h || ' hours')::interval) - (now() - interval '45 days'))) / 86400.0) * 0.05 + (random() - 0.5) * 0.04
      WHEN 'crack_sensor' THEN
        1.8 + (extract(epoch from ((NOW() - (g.h || ' hours')::interval) - (now() - interval '45 days'))) / 86400.0) * 0.015 + 0.2 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.h || ' hours')::interval)) - 14.0) / 24.0) + (random() - 0.5) * 0.02
      WHEN 'tiltmeter' THEN
        0.35 + 0.15 * sin(2.0 * pi() * extract(day from (NOW() - (g.h || ' hours')::interval)) / 9.0) + (random() - 0.5) * 0.02
      WHEN 'accelerograph' THEN
        greatest(0.001, 0.012 + (CASE WHEN random() > 0.98 THEN 0.08 * random() ELSE 0.003 * random() END))
      WHEN 'seismograph' THEN
        greatest(0.5, 8.0 + 4.0 * sin(2.0 * pi() * extract(hour from (NOW() - (g.h || ' hours')::interval)) / 12.0) + (CASE WHEN random() > 0.97 THEN 20.0 * random() ELSE 1.5 * random() END))
      ELSE
        50.0 + 15.0 * sin(2.0 * pi() * extract(hour from (NOW() - (g.h || ' hours')::interval)) / 24.0) + (random() - 0.5) * 2.0
    END AS val
  FROM sensors s
  CROSS JOIN generate_series(0, 1080, 1) AS g (h)
  WHERE s.serial_number IN (
    'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
    'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
    'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
    'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
  );

  -- 4.2 Alta resolución: cada 15 minutos en las últimas 48 horas (192 puntos adicionales)
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT
    s.tenant_id,
    s.sensor_id,
    NOW() - (g.m || ' minutes')::interval AS t,
    CASE s.sensor_type
      WHEN 'temperature' THEN
        16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.m || ' minutes')::interval)) + extract(minute from (NOW() - (g.m || ' minutes')::interval))/60.0 - 8.0) / 24.0) + (random() - 0.5) * 0.8
      WHEN 'humidity' THEN
        65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.m || ' minutes')::interval)) + extract(minute from (NOW() - (g.m || ' minutes')::interval))/60.0 - 8.0) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'barometric_pressure' THEN
        710.0 + 3.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.m || ' minutes')::interval)) - 3.0) / 12.0) + (random() - 0.5) * 0.5
      WHEN 'wind_speed' THEN
        greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.m || ' minutes')::interval)) - 11.0) / 24.0) + (random() - 0.3) * 2.5)
      WHEN 'net_radiation' THEN
        greatest(0.0, 850.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from (NOW() - (g.m || ' minutes')::interval)) + extract(minute from (NOW() - (g.m || ' minutes')::interval))/60.0 - 6.0) / 12.0))) + (random() - 0.5) * 10.0)
      WHEN 'ph' THEN
        7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from (NOW() - (g.m || ' minutes')::interval)) - 10.0) / 24.0) + (random() - 0.5) * 0.05
      WHEN 'turbidity' THEN
        greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from (NOW() - (g.m || ' minutes')::interval)) + extract(hour from (NOW() - (g.m || ' minutes')::interval))/24.0) / 3.0) + (random() - 0.5) * 1.0)
      ELSE
        50.0 + 15.0 * sin(2.0 * pi() * extract(hour from (NOW() - (g.m || ' minutes')::interval)) / 24.0) + (random() - 0.5) * 1.5
    END AS val
  FROM sensors s
  CROSS JOIN generate_series(15, 2880, 15) AS g (m)
  WHERE s.serial_number IN (
    'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
    'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
    'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
    'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
  )
  -- Evitar duplicar en los puntos horarios exactos ya insertados arriba
  AND (g.m % 60) <> 0;

END
$$;

COMMIT;
