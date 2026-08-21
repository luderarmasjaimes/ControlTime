-- ============================================================================
-- 55_seed_realistic_sensor_catalog.sql
-- Datos de prueba realistas para el wizard de gráfico multi-sensor
-- (ReportStudioV2 + db_scripts/54_sensor_zones_and_grouping.sql). Motivo:
-- verificado en vivo que HOY ningún sensor de `sensors` (tabla real de
-- ingesta) tiene lat/lng, así que el árbol zona→dispositivo→unidad del
-- wizard solo mostraba un único grupo "Sin zona asignada" — imposible probar
-- la selección por zona o el agrupamiento de dispositivos multi-magnitud.
--
-- Catálogo de tipos/unidades tomado de la presentación comercial real
-- "1._Presentación_TMT.pdf" (Telemetry/Beemetry — instrumentación minera):
-- Ambiental (estación meteorológica, analizador de metales, conductividad,
-- pH, turbidez, radiación neta), Hídrico (piezómetros VW, nivel/velocidad de
-- agua, caudal) y Geotécnico (inclinómetros, extensómetros, celdas de
-- asentamiento, acelerógrafos, sismógrafos, tiltmeter, sensor de grietas).
--
-- Dos dispositivos multi-magnitud reales (misma `serial_number`, varias
-- filas con distinto sensor_type/unit) para probar el agrupamiento por
-- device_key pedido explícitamente ("un sensor puede reportar más de una
-- unidad"): la estación meteorológica EM-01 (temperatura+humedad+presión+
-- viento) y el analizador de metales AM-01 (Cu/Pb/Zn).
--
-- Coordenadas centradas en la unidad minera Antamina (Ancash, Perú, la
-- unidad real del tenant demo a0000001, ver tenants.tenant_name) con
-- offsets deliberados en los 4 cuadrantes para que la asignación de zona
-- por cuadrante (migración 54) produzca los 4 grupos reales, no solo
-- SIN-ZONA.
--
-- Prerrequisitos: 04 (sensors/telemetry_raw), 39 (lat/lng), 54 (sensor_zones).
-- Idempotente: los INSERT usan ON CONFLICT (tenant_id, sensor_code) DO NOTHING.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tid UUID := 'a0000001-0000-4000-8000-000000000001'::uuid;
  -- Centroide real aproximado de Antamina (Ancash, Perú).
  v_lat0 DOUBLE PRECISION := -9.5427;
  v_lng0 DOUBLE PRECISION := -77.0525;
BEGIN
  -- ---------------------------------------------------------------------
  -- Ambiental — NOR-ESTE (lat/lng > centroide)
  -- ---------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
  VALUES
    (v_tid, 'EM-01-TEMP', 'Estación Meteorológica EM-01 (Temperatura)', 'temperature', '°C', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
    (v_tid, 'EM-01-HUM', 'Estación Meteorológica EM-01 (Humedad)', 'humidity', '%', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
    (v_tid, 'EM-01-PRES', 'Estación Meteorológica EM-01 (Presión Barométrica)', 'barometric_pressure', 'hPa', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
    (v_tid, 'EM-01-VIENTO', 'Estación Meteorológica EM-01 (Velocidad de Viento)', 'wind_speed', 'm/s', 'EM-01', v_lat0 + 0.031, v_lng0 + 0.028, true, 'online'),
    (v_tid, 'AM-01-CU', 'Analizador de Metales AM-01 (Cobre)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
    (v_tid, 'AM-01-PB', 'Analizador de Metales AM-01 (Plomo)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
    (v_tid, 'AM-01-ZN', 'Analizador de Metales AM-01 (Zinc)', 'metals_analyzer', 'mg/L', 'AM-01', v_lat0 + 0.018, v_lng0 + 0.041, true, 'online'),
    (v_tid, 'RADNET-01', 'Radiación Neta RADNET-01', 'net_radiation', 'W/m2', 'RADNET-01', v_lat0 + 0.024, v_lng0 + 0.012, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO NOTHING;

  -- ---------------------------------------------------------------------
  -- Ambiental (vertimientos) — SUR-ESTE (lat < centroide, lng > centroide)
  -- ---------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
  VALUES
    (v_tid, 'COND-01', 'Conductividad COND-01', 'conductivity', 'uS/cm', 'COND-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
    (v_tid, 'PH-01', 'pH PH-01', 'ph', 'pH', 'PH-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
    (v_tid, 'TURB-01', 'Turbidez TURB-01', 'turbidity', 'NTU', 'TURB-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
    (v_tid, 'EVAP-01', 'Evaporación EVAP-01', 'evaporation', 'mm', 'EVAP-01', v_lat0 - 0.033, v_lng0 + 0.027, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO NOTHING;

  -- ---------------------------------------------------------------------
  -- Hídrico — SUR-OESTE (lat/lng < centroide)
  -- ---------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
  VALUES
    (v_tid, 'PZ-VW-01', 'Piezómetro VW-01', 'piezometer_vw', 'kPa', 'PZ-VW-01', v_lat0 - 0.017, v_lng0 - 0.022, true, 'online'),
    (v_tid, 'PZ-VW-02', 'Piezómetro VW-02', 'piezometer_vw', 'kPa', 'PZ-VW-02', v_lat0 - 0.026, v_lng0 - 0.015, true, 'online'),
    (v_tid, 'PZ-VW-03', 'Piezómetro VW-03', 'piezometer_vw', 'kPa', 'PZ-VW-03', v_lat0 - 0.038, v_lng0 - 0.031, true, 'online'),
    (v_tid, 'NIVEL-H2O-01', 'Nivel de Agua NIVEL-H2O-01', 'water_level', 'm', 'NIVEL-H2O-01', v_lat0 - 0.012, v_lng0 - 0.040, true, 'online'),
    (v_tid, 'VEL-H2O-01', 'Velocidad de Agua VEL-H2O-01', 'water_velocity', 'm/s', 'VEL-H2O-01', v_lat0 - 0.012, v_lng0 - 0.040, true, 'online'),
    (v_tid, 'CAUDAL-01', 'Caudal CAUDAL-01', 'flow_rate', 'L/s', 'CAUDAL-01', v_lat0 - 0.029, v_lng0 - 0.009, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO NOTHING;

  -- ---------------------------------------------------------------------
  -- Geotécnico — NOR-OESTE (lat > centroide, lng < centroide)
  -- ---------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
  VALUES
    (v_tid, 'INCL-01', 'Inclinómetro Fijo INCL-01', 'inclinometer', 'mm', 'INCL-01', v_lat0 + 0.014, v_lng0 - 0.018, true, 'online'),
    (v_tid, 'INCL-02', 'Inclinómetro Fijo INCL-02', 'inclinometer', 'mm', 'INCL-02', v_lat0 + 0.022, v_lng0 - 0.026, true, 'online'),
    (v_tid, 'INCL-03', 'Inclinómetro Fijo INCL-03', 'inclinometer', 'mm', 'INCL-03', v_lat0 + 0.033, v_lng0 - 0.011, true, 'online'),
    (v_tid, 'EXT-01', 'Extensómetro EXT-01', 'extensometer', 'mm', 'EXT-01', v_lat0 + 0.019, v_lng0 - 0.033, true, 'online'),
    (v_tid, 'EXT-02', 'Extensómetro EXT-02', 'extensometer', 'mm', 'EXT-02', v_lat0 + 0.027, v_lng0 - 0.041, true, 'online'),
    (v_tid, 'CELDA-AS-01', 'Celda de Asentamiento CELDA-AS-01', 'settlement_cell', 'mm', 'CELDA-AS-01', v_lat0 + 0.011, v_lng0 - 0.024, true, 'online'),
    (v_tid, 'CELDA-AS-02', 'Celda de Asentamiento CELDA-AS-02', 'settlement_cell', 'mm', 'CELDA-AS-02', v_lat0 + 0.040, v_lng0 - 0.019, true, 'online'),
    (v_tid, 'ACEL-01', 'Acelerógrafo ACEL-01', 'accelerograph', 'g', 'ACEL-01', v_lat0 + 0.016, v_lng0 - 0.037, true, 'online'),
    (v_tid, 'ACEL-02', 'Acelerógrafo ACEL-02', 'accelerograph', 'g', 'ACEL-02', v_lat0 + 0.030, v_lng0 - 0.014, true, 'online'),
    (v_tid, 'SISM-01', 'Sismógrafo SISM-01', 'seismograph', 'Hz', 'SISM-01', v_lat0 + 0.024, v_lng0 - 0.029, true, 'online'),
    (v_tid, 'TILT-01', 'Tiltmeter Triaxial TILT-01', 'tiltmeter', 'deg', 'TILT-01', v_lat0 + 0.013, v_lng0 - 0.008, true, 'online'),
    (v_tid, 'GRIETA-01', 'Sensor de Grietas GRIETA-01', 'crack_sensor', 'mm', 'GRIETA-01', v_lat0 + 0.037, v_lng0 - 0.033, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO NOTHING;

  -- ---------------------------------------------------------------------
  -- Telemetría sintética: últimos 7 días, cada 3 horas, para que el
  -- gráfico del wizard tenga algo que dibujar en el rango por defecto.
  -- Valor base determinístico por sensor (hash del código) + variación
  -- pequeña — mismo espíritu que el seed de mining_sensor_history en
  -- 28_mining_telemetry_uuid_tenant.sql.
  -- ---------------------------------------------------------------------
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT
    v_tid,
    s.sensor_id,
    NOW() - (g.h || ' hours')::interval,
    -- Base determinística por sensor (hashtext nativo de Postgres, acotada a
    -- 20-80) + variación pequeña — solo para tener algo visualmente
    -- razonable que graficar en el rango por defecto del wizard.
    (20 + (abs(hashtext(s.sensor_code)) % 60)) * (1 + (random() - 0.5) * 0.15)
  FROM sensors s
  CROSS JOIN generate_series(0, 168, 3) AS g (h)
  WHERE s.tenant_id = v_tid
    AND s.serial_number IN (
      'EM-01', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01'
    )
    -- Idempotente: no duplicar si esta migración ya corrió antes.
    AND NOT EXISTS (
      SELECT 1 FROM telemetry_raw tr
      WHERE tr.sensor_id = s.sensor_id AND tr.captured_at = NOW() - (g.h || ' hours')::interval
    );

  -- ---------------------------------------------------------------------
  -- Recalcular centroide y reasignar zona por cuadrante SOLO para los
  -- sensores recién insertados (los preexistentes sin lat/lng se quedan en
  -- SIN-ZONA, correcto: seguimos sin inventarles coordenadas).
  -- ---------------------------------------------------------------------
  DECLARE
    c_lat DOUBLE PRECISION;
    c_lng DOUBLE PRECISION;
    z_ne INT;
    z_no INT;
    z_se INT;
    z_so INT;
  BEGIN
    SELECT AVG(lat), AVG(lng) INTO c_lat, c_lng
      FROM sensors WHERE tenant_id = v_tid AND lat IS NOT NULL AND lng IS NOT NULL;

    UPDATE sensor_zones SET centroid_lat = c_lat, centroid_lng = c_lng
      WHERE tenant_id = v_tid AND code IN ('NOR-ESTE', 'NOR-OESTE', 'SUR-ESTE', 'SUR-OESTE');

    SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-ESTE';
    SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-OESTE';
    SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-ESTE';
    SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-OESTE';

    UPDATE sensors SET zone_id = CASE
        WHEN lat >= c_lat AND lng >= c_lng THEN z_ne
        WHEN lat >= c_lat AND lng <  c_lng THEN z_no
        WHEN lat <  c_lat AND lng >= c_lng THEN z_se
        ELSE z_so
      END
      WHERE tenant_id = v_tid AND lat IS NOT NULL AND lng IS NOT NULL;
  END;
END
$$;

COMMIT;
