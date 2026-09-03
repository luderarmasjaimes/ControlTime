-- ============================================================================
-- 80_seed_alpayana_expanded_sensor_variety_and_refresh.sql
-- Amplía el catálogo de sensores del tenant ALPAYANA (tenant real -- ver
-- comentario en 56_seed_realistic_sensor_catalog_all_tenants.sql, que ya lo
-- menciona como una de las unidades mineras reales de esta base) y refresca
-- su telemetría de prueba, que había quedado congelada el 2026-08-14 (más de
-- 10 días de hueco respecto a NOW()) -- el wizard "Gráfico de sensores" de
-- ReportStudioV2 devolvía vacío al usar los rangos rápidos "Últimas 24h" /
-- "Últimos 7 días" para este tenant porque no había telemetría tan reciente.
--
-- Alcance deliberadamente limitado a ALPAYANA (no a los otros tenants reales
-- de esta base) -- coincide con lo solicitado, sin re-sembrar datos de
-- prueba de cuentas ajenas sin necesidad.
--
-- Contenido:
--   A. Refresca (borra + reinserta relativo a NOW()) la telemetría de los 32
--      sensores ya sembrados por 56/57 para este tenant -- mismas fórmulas,
--      mismo criterio de re-ejecución idempotente que esos scripts.
--   B. Agrega 12 sensores nuevos repartidos en las 4 zonas geográficas ya
--      existentes (Nor-Este, Nor-Oeste, Sur-Este, Sur-Oeste), incluyendo 2
--      piezómetros VW adicionales en Sur-Oeste -- para poder probar la
--      selección múltiple con más de 3 sensores del mismo tipo/zona, como
--      en la pantalla de referencia del wizard (5 piezómetros en total).
--   C. Siembra telemetría de 45 días (+ 48h en alta resolución) para los
--      sensores nuevos.
--
-- Idempotente: ON CONFLICT (tenant_id, sensor_code) DO UPDATE para B, y
-- DELETE + reinserción relativa a NOW() para A/C -- seguro de re-ejecutar.
--
-- Prerrequisitos: 04, 39, 54, 56, 57, 74-78 (arquitectura telemetry_fact).
-- IMPORTANTE: después de aplicar este script hay que correr
-- 78_telemetry_fact_backfill.sql para propagar telemetry_raw ->
-- telemetry_fact (el wizard lee de telemetry_fact / _hourly / _daily, no de
-- telemetry_raw directamente -- ADR-131), y conviene refrescar manualmente
-- los continuous aggregates telemetry_fact_hourly/_daily sobre el rango
-- recién insertado para no esperar a la próxima corrida programada de sus
-- políticas.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '300s';
-- telemetry_raw es un hypertable comprimido -- DELETE sobre chunks
-- comprimidos exige descomprimir la fila completa del chunk (no solo las
-- filas filtradas), lo que excede el límite por defecto de TimescaleDB
-- (100k) aunque el DELETE esté acotado a un solo tenant. Sin límite para
-- esta transacción puntual (igual que sugiere el HINT del error).
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

DO $$
DECLARE
  v_tid UUID := 'c7dacc61-ccf5-449b-842f-8a5f15b4a48e'; -- Alpayana
  v_lat0 DOUBLE PRECISION := -9.5427;
  v_lng0 DOUBLE PRECISION := -77.0525;
  z_ne INT;
  z_no INT;
  z_se INT;
  z_so INT;
BEGIN
  SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-ESTE';
  SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-OESTE';
  SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-ESTE';
  SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-OESTE';

  -- -------------------------------------------------------------------
  -- B. Sensores nuevos (12), con zone_id explícito por cuadrante
  -- -------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, zone_id, is_active, connection_status)
  VALUES
    -- Nor-Este (Ambiental) -- calidad de aire y ruido
    (v_tid, 'PM10-01', 'Material Particulado PM10-01', 'dust_pm10', 'ug/m3', 'PM10-01', v_lat0 + 0.020, v_lng0 + 0.033, z_ne, true, 'online'),
    (v_tid, 'RUIDO-01', 'Monitor de Ruido Ambiental RUIDO-01', 'noise_level', 'dB', 'RUIDO-01', v_lat0 + 0.035, v_lng0 + 0.020, z_ne, true, 'online'),
    (v_tid, 'CO-01', 'Detector de Gas CO-01', 'gas_co', 'ppm', 'CO-01', v_lat0 + 0.027, v_lng0 + 0.010, z_ne, true, 'online'),
    -- Nor-Oeste (Geotécnico) -- monitoreo satelital de taludes
    (v_tid, 'GNSS-01', 'Estación GNSS Talud GNSS-01', 'gnss_displacement', 'mm', 'GNSS-01', v_lat0 + 0.010, v_lng0 - 0.014, z_no, true, 'online'),
    (v_tid, 'GNSS-02', 'Estación GNSS Presa Relaves GNSS-02', 'gnss_displacement', 'mm', 'GNSS-02', v_lat0 + 0.042, v_lng0 - 0.027, z_no, true, 'online'),
    (v_tid, 'INCL-04', 'Inclinómetro Fijo INCL-04 (Botadero Este)', 'inclinometer', 'mm', 'INCL-04', v_lat0 + 0.008, v_lng0 - 0.040, z_no, true, 'online'),
    -- Sur-Este (Hídrico / Vertimientos) -- calidad de agua
    (v_tid, 'OD-01', 'Oxígeno Disuelto Poza Sedimentación OD-01', 'dissolved_oxygen', 'mg/L', 'OD-01', v_lat0 - 0.018, v_lng0 + 0.024, z_se, true, 'online'),
    (v_tid, 'ORP-01', 'Potencial Redox Canal Tratamiento ORP-01', 'orp', 'mV', 'ORP-01', v_lat0 - 0.024, v_lng0 + 0.014, z_se, true, 'online'),
    -- Sur-Oeste (Hidrología / Piezometría) -- refuerza el grupo de la captura
    (v_tid, 'PZ-VW-04', 'Piezómetro VW-04 (Muro Este Presa Relaves)', 'piezometer_vw', 'kPa', 'PZ-VW-04', v_lat0 - 0.031, v_lng0 - 0.019, z_so, true, 'online'),
    (v_tid, 'PZ-VW-05', 'Piezómetro VW-05 (Cancha de Lixiviación)', 'piezometer_vw', 'kPa', 'PZ-VW-05', v_lat0 - 0.041, v_lng0 - 0.008, z_so, true, 'online'),
    (v_tid, 'TEMP-H2O-01', 'Temperatura de Agua Laguna Clarificación', 'water_temperature', '°C', 'TEMP-H2O-01', v_lat0 - 0.014, v_lng0 - 0.036, z_so, true, 'online'),
    (v_tid, 'NIVEL-RELAVES-01', 'Nivel Presa de Relaves NIVEL-RELAVES-01', 'tailings_pond_level', 'm', 'NIVEL-RELAVES-01', v_lat0 - 0.022, v_lng0 - 0.044, z_so, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
    sensor_name = EXCLUDED.sensor_name,
    unit = EXCLUDED.unit,
    zone_id = EXCLUDED.zone_id,
    is_active = true,
    connection_status = 'online';

  -- dim_sensor no se llena por trigger (el dual-write de
  -- telemetry_ingest.cpp hacia telemetry_fact todavía no está activo, ver
  -- ADR-131 / comentario en 78_telemetry_fact_backfill.sql) -- sin esta
  -- fila, 78 no encuentra el sensor_id_sk y su telemetría nunca llega a
  -- telemetry_fact aunque exista en telemetry_raw. Mismo patrón exacto que
  -- el poblado inicial 'iot_v2' de 74_telemetry_fact_dimensions.sql.
  INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, site_id_sk, sensor_code, sensor_type, unit, is_active)
  SELECT 'iot_v2', s.sensor_id, dt.tenant_id_sk, dsite.site_id_sk, s.sensor_code, s.sensor_type, s.unit, s.is_active
  FROM sensors s
  JOIN dim_tenant dt ON dt.tenant_id = s.tenant_id
  LEFT JOIN dim_site dsite ON dsite.site_id = s.site_id
  WHERE s.tenant_id = v_tid AND s.serial_number IN (
    'PM10-01', 'RUIDO-01', 'CO-01', 'GNSS-01', 'GNSS-02', 'INCL-04',
    'OD-01', 'ORP-01', 'PZ-VW-04', 'PZ-VW-05', 'TEMP-H2O-01', 'NIVEL-RELAVES-01'
  )
  ON CONFLICT (sensor_id) DO NOTHING;

  -- -------------------------------------------------------------------
  -- A. Refresco de telemetría de los 32 sensores ya existentes -- mismas
  -- fórmulas que 57_seed_rich_sensor_telemetry_test_data.sql, acotado a
  -- Alpayana. Se borra y reinserta relativo a NOW() para cerrar el hueco.
  -- -------------------------------------------------------------------
  DELETE FROM telemetry_raw tr USING sensors s
  WHERE tr.sensor_id = s.sensor_id AND s.tenant_id = v_tid
    AND s.serial_number IN (
      'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
    );

  -- A.1 Rango general: cada 1 hora, 45 días
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'temperature' THEN 16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from t) - 8.0) / 24.0) + (random() - 0.5) * 1.2
      WHEN 'humidity' THEN 65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from t) - 8.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'barometric_pressure' THEN 710.0 + 3.0 * sin(2.0 * pi() * (extract(hour from t) - 3.0) / 12.0) + (random() - 0.5) * 0.8
      WHEN 'wind_speed' THEN greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from t) - 11.0) / 24.0) + (random() - 0.3) * 3.5)
      WHEN 'net_radiation' THEN greatest(0.0, 850.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from t) - 6.0) / 12.0))) + (random() - 0.5) * 15.0)
      WHEN 'evaporation' THEN greatest(0.1, 4.2 + 2.5 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.5)
      WHEN 'conductivity' THEN 750.0 + 120.0 * sin(2.0 * pi() * extract(day from t) / 7.0) + (random() - 0.5) * 25.0
      WHEN 'ph' THEN 7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'turbidity' THEN greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from t) + extract(hour from t) / 24.0) / 3.0) + (random() - 0.5) * 1.5)
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 2.0
      WHEN 'water_level' THEN 5.8 + 1.2 * sin(2.0 * pi() * extract(day from t) / 10.0) + (random() - 0.5) * 0.05
      WHEN 'water_velocity' THEN 1.4 + 0.4 * sin(2.0 * pi() * (extract(hour from t) - 6.0) / 24.0) + (random() - 0.5) * 0.08
      WHEN 'flow_rate' THEN 95.0 + 30.0 * sin(2.0 * pi() * (extract(hour from t) - 7.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'metals_analyzer' THEN
        CASE
          WHEN sensor_code LIKE '%-CU' THEN 0.85 + 0.45 * sin(2.0 * pi() * extract(day from t) / 5.0) + (random() - 0.5) * 0.05
          WHEN sensor_code LIKE '%-PB' THEN 0.08 + 0.04 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 0.006
          ELSE 1.65 + 0.80 * sin(2.0 * pi() * extract(day from t) / 4.0) + (random() - 0.5) * 0.08
        END
      WHEN 'inclinometer' THEN 2.0 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.04 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN 4.5 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.025 + (random() - 0.5) * 0.08
      WHEN 'settlement_cell' THEN -3.0 - (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.05 + (random() - 0.5) * 0.04
      WHEN 'crack_sensor' THEN 1.8 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.015 + 0.2 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 0.02
      WHEN 'tiltmeter' THEN 0.35 + 0.15 * sin(2.0 * pi() * extract(day from t) / 9.0) + (random() - 0.5) * 0.02
      WHEN 'accelerograph' THEN greatest(0.001, 0.012 + (CASE WHEN random() > 0.98 THEN 0.08 * random() ELSE 0.003 * random() END))
      WHEN 'seismograph' THEN greatest(0.5, 8.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 12.0) + (CASE WHEN random() > 0.97 THEN 20.0 * random() ELSE 1.5 * random() END))
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, s.sensor_code, NOW() - (g.h || ' hours')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(0, 1080, 1) AS g(h)
    WHERE s.tenant_id = v_tid AND s.serial_number IN (
      'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
    )
  ) base;

  -- A.2 Alta resolución: cada 15 minutos, últimas 48 horas
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'temperature' THEN 16.0 + 8.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 0.8
      WHEN 'humidity' THEN 65.0 - 25.0 * sin(2.0 * pi() * (extract(hour from t) + extract(minute from t) / 60.0 - 8.0) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'barometric_pressure' THEN 710.0 + 3.0 * sin(2.0 * pi() * (extract(hour from t) - 3.0) / 12.0) + (random() - 0.5) * 0.5
      WHEN 'wind_speed' THEN greatest(0.2, 4.5 + 4.0 * sin(2.0 * pi() * (extract(hour from t) - 11.0) / 24.0) + (random() - 0.3) * 2.5)
      WHEN 'net_radiation' THEN greatest(0.0, 850.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from t) + extract(minute from t) / 60.0 - 6.0) / 12.0))) + (random() - 0.5) * 10.0)
      WHEN 'ph' THEN 7.45 + 0.35 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.05
      WHEN 'turbidity' THEN greatest(1.0, 8.5 + 4.0 * sin(2.0 * pi() * (extract(day from t) + extract(hour from t) / 24.0) / 3.0) + (random() - 0.5) * 1.0)
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 1.5
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 1.5
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.m || ' minutes')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(15, 2880, 15) AS g(m)
    WHERE s.tenant_id = v_tid AND s.serial_number IN (
      'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
    )
    AND (g.m % 60) <> 0
  ) base;

  -- -------------------------------------------------------------------
  -- C. Telemetría de los 12 sensores nuevos (45 días + 48h densas)
  -- -------------------------------------------------------------------
  DELETE FROM telemetry_raw tr USING sensors s
  WHERE tr.sensor_id = s.sensor_id AND s.tenant_id = v_tid
    AND s.serial_number IN (
      'PM10-01', 'RUIDO-01', 'CO-01', 'GNSS-01', 'GNSS-02', 'INCL-04',
      'OD-01', 'ORP-01', 'PZ-VW-04', 'PZ-VW-05', 'TEMP-H2O-01', 'NIVEL-RELAVES-01'
    );

  -- C.1 Rango general: cada 1 hora, 45 días
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'dust_pm10' THEN greatest(3.0, 35.0 + 20.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 8.0)
      WHEN 'noise_level' THEN greatest(38.0, 55.0 + 15.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 13.0) / 24.0)) + (random() - 0.5) * 4.0 + (CASE WHEN random() > 0.985 THEN 25.0 * random() ELSE 0 END))
      WHEN 'gas_co' THEN greatest(0.0, 1.5 + 1.0 * random() + (CASE WHEN random() > 0.99 THEN 8.0 * random() ELSE 0 END))
      WHEN 'gnss_displacement' THEN 1.0 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.03 + (random() - 0.5) * 0.05
      WHEN 'inclinometer' THEN 2.0 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.04 + (random() - 0.5) * 0.06
      WHEN 'dissolved_oxygen' THEN 6.5 + 0.8 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.3
      WHEN 'orp' THEN 150.0 + 40.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 10.0
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 2.0
      WHEN 'water_temperature' THEN 14.0 + 1.5 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.3
      WHEN 'tailings_pond_level' THEN 3.2 + (extract(epoch from (t - (NOW() - interval '45 days'))) / 86400.0) * 0.015 + (random() - 0.5) * 0.03
      ELSE 50.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.h || ' hours')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(0, 1080, 1) AS g(h)
    WHERE s.tenant_id = v_tid AND s.serial_number IN (
      'PM10-01', 'RUIDO-01', 'CO-01', 'GNSS-01', 'GNSS-02', 'INCL-04',
      'OD-01', 'ORP-01', 'PZ-VW-04', 'PZ-VW-05', 'TEMP-H2O-01', 'NIVEL-RELAVES-01'
    )
  ) base;

  -- C.2 Alta resolución: cada 15 minutos, últimas 48 horas
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'dust_pm10' THEN greatest(3.0, 35.0 + 20.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 6.0)
      WHEN 'noise_level' THEN greatest(38.0, 55.0 + 15.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 13.0) / 24.0)) + (random() - 0.5) * 3.0 + (CASE WHEN random() > 0.99 THEN 25.0 * random() ELSE 0 END))
      WHEN 'gas_co' THEN greatest(0.0, 1.5 + 0.8 * random())
      WHEN 'dissolved_oxygen' THEN 6.5 + 0.8 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.2
      WHEN 'orp' THEN 150.0 + 40.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 6.0
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 1.5
      WHEN 'water_temperature' THEN 14.0 + 1.5 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.2
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 1.5
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.m || ' minutes')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(15, 2880, 15) AS g(m)
    WHERE s.tenant_id = v_tid AND s.serial_number IN (
      'PM10-01', 'RUIDO-01', 'CO-01', 'GNSS-01', 'GNSS-02', 'INCL-04',
      'OD-01', 'ORP-01', 'PZ-VW-04', 'PZ-VW-05', 'TEMP-H2O-01', 'NIVEL-RELAVES-01'
    )
    AND (g.m % 60) <> 0
  ) base;

END
$$;

COMMIT;
