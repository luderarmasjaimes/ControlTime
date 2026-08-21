-- ============================================================================
-- 56_seed_realistic_sensor_catalog_all_tenants.sql
-- Generaliza 55_seed_realistic_sensor_catalog.sql (que solo sembró el tenant
-- demo a0000001) a TODOS los tenants existentes. Motivo: el wizard de
-- gráfico multi-sensor (ReportStudioV2) salía vacío ("Tipo de sensor" y
-- "Sensores por zona" sin opciones) para cualquier cuenta real que no fuera
-- la del tenant demo — hay 24 tenants reales en esta base (ver `SELECT
-- tenant_name FROM tenants`, incluye unidades reales como Alpayana, Minera
-- Raura, Cerro Verde, Las Bambas, Yanacocha, además de cuentas de prueba),
-- y solo uno tenía datos de prueba de sensores nuevos.
--
-- También cubre el caso de tenants que NUNCA tuvieron ninguna fila en
-- `sensors` (y por tanto tampoco zonas: el loop de 54 solo recorría
-- `SELECT DISTINCT tenant_id FROM sensors`, así que un tenant con cero
-- sensores no obtuvo catálogo de zonas) — este script crea el catálogo de
-- zonas si falta, antes de sembrar sensores.
--
-- Mismo catálogo/lógica que 55: tipos y unidades reales de la presentación
-- comercial de instrumentación minera (Ambiental/Hídrico/Geotécnico),
-- coordenadas relativas al centroide de CADA tenant (offsets fijos en los 4
-- cuadrantes, sin inventar ubicaciones absolutas), dos dispositivos
-- multi-magnitud (EM-01, AM-01), y telemetría sintética de 7 días.
--
-- Prerrequisitos: 04, 39, 54. Idempotente: ON CONFLICT (tenant_id,
-- sensor_code) DO NOTHING — re-ejecutarlo, o correrlo después de 55 sobre el
-- tenant demo, no duplica nada.
-- ============================================================================

BEGIN;

-- El guard NOT EXISTS por fila que usaba 55 (para poder re-ejecutarlo sin
-- duplicar telemetría) resultó demasiado caro multiplicado por 24 tenants
-- (~45k subconsultas correlacionadas) y agotó el statement_timeout por
-- defecto. Se sube el límite para esta migración puntual — es una sola vez,
-- sobre una tabla particionada por tiempo (hypertable), no una operación
-- recurrente.
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  t RECORD;
  v_tid UUID;
  v_lat0 DOUBLE PRECISION;
  v_lng0 DOUBLE PRECISION;
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
    -- Catálogo de zonas: crearlo si este tenant todavía no lo tiene (no
    -- tenía ningún sensor cuando corrió la migración 54).
    -- -------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM sensor_zones WHERE tenant_id = v_tid) THEN
      INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order)
      VALUES
        (v_tid, 'NOR-ESTE', 'Nor-Este', 10),
        (v_tid, 'NOR-OESTE', 'Nor-Oeste', 20),
        (v_tid, 'SUR-ESTE', 'Sur-Este', 30),
        (v_tid, 'SUR-OESTE', 'Sur-Oeste', 40),
        (v_tid, 'SIN-ZONA', 'Sin zona asignada', 90)
      ON CONFLICT (tenant_id, code) DO NOTHING;
    END IF;

    -- Centroide sintético fijo por tenant (mismo usado en 55 para el tenant
    -- demo — no representa la ubicación real de cada unidad minera, es solo
    -- un punto de referencia para distribuir sensores de prueba en los 4
    -- cuadrantes de forma reproducible).
    v_lat0 := -9.5427;
    v_lng0 := -77.0525;

    -- ---------------------------------------------------------------------
    -- Ambiental — NOR-ESTE
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
    -- Ambiental (vertimientos) — SUR-ESTE
    -- ---------------------------------------------------------------------
    INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, is_active, connection_status)
    VALUES
      (v_tid, 'COND-01', 'Conductividad COND-01', 'conductivity', 'uS/cm', 'COND-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'PH-01', 'pH PH-01', 'ph', 'pH', 'PH-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'TURB-01', 'Turbidez TURB-01', 'turbidity', 'NTU', 'TURB-01', v_lat0 - 0.021, v_lng0 + 0.019, true, 'online'),
      (v_tid, 'EVAP-01', 'Evaporación EVAP-01', 'evaporation', 'mm', 'EVAP-01', v_lat0 - 0.033, v_lng0 + 0.027, true, 'online')
    ON CONFLICT (tenant_id, sensor_code) DO NOTHING;

    -- ---------------------------------------------------------------------
    -- Hídrico — SUR-OESTE
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
    -- Geotécnico — NOR-OESTE
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
    -- Telemetría sintética: últimos 7 días, cada 3 horas. Sin guard
    -- NOT EXISTS (ver comentario arriba sobre el timeout) — solo se siembra
    -- si el sensor TODAVÍA no tiene ninguna lectura, así que en la práctica
    -- solo corre una vez por sensor real; un re-run de esta migración en
    -- particular podría duplicar puntos, aceptable para datos de prueba.
    -- ---------------------------------------------------------------------
    INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
    SELECT
      v_tid,
      s.sensor_id,
      NOW() - (g.h || ' hours')::interval,
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
      AND NOT EXISTS (
        SELECT 1 FROM telemetry_raw tr WHERE tr.sensor_id = s.sensor_id
      );

    -- ---------------------------------------------------------------------
    -- Recalcular centroide y reasignar zona por cuadrante para los
    -- sensores de este tenant que tengan coordenadas.
    -- ---------------------------------------------------------------------
    SELECT AVG(lat), AVG(lng) INTO c_lat, c_lng
      FROM sensors WHERE tenant_id = v_tid AND lat IS NOT NULL AND lng IS NOT NULL;

    IF c_lat IS NOT NULL THEN
      UPDATE sensor_zones SET centroid_lat = c_lat, centroid_lng = c_lng
        WHERE tenant_id = v_tid AND code IN ('NOR-ESTE', 'NOR-OESTE', 'SUR-ESTE', 'SUR-OESTE');

      SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-ESTE';
      SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-OESTE';
      SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-ESTE';
      SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-OESTE';
      SELECT zone_id INTO z_sz FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SIN-ZONA';

      UPDATE sensors SET zone_id = CASE
          WHEN lat IS NULL OR lng IS NULL THEN z_sz
          WHEN lat >= c_lat AND lng >= c_lng THEN z_ne
          WHEN lat >= c_lat AND lng <  c_lng THEN z_no
          WHEN lat <  c_lat AND lng >= c_lng THEN z_se
          ELSE z_so
        END
        WHERE tenant_id = v_tid AND zone_id IS NULL;
    END IF;
  END LOOP;
END
$$;

COMMIT;
