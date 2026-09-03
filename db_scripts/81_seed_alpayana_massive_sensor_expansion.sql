-- ============================================================================
-- 81_seed_alpayana_massive_sensor_expansion.sql
-- Expansión masiva del catálogo de sensores y telemetría del tenant ALPAYANA
-- para pruebas amplias de dashboards (a pedido explícito: "máxima cantidad"
-- de sensores y registros de telemetría). Continúa el trabajo de
-- 80_seed_alpayana_expanded_sensor_variety_and_refresh.sql (que llevó el
-- catálogo a 44 sensores / 29 tipos / 4 zonas y refrescó la telemetría hasta
-- NOW()) -- este script lo multiplica varias veces:
--
--   A. 3 zonas nuevas (Planta Concentradora, Ventilación Subterránea, Flota
--      de Equipos Mina) -- disciplinas de instrumentación minera que antes
--      no estaban representadas.
--   B. 64 sensores nuevos (27 tipos nuevos: proceso de planta, eléctrico,
--      ventilación/gases de mina subterránea, flota de equipos, más unidades
--      adicionales de tipos ya existentes en las 4 zonas geotécnicas/
--      hídricas/ambientales previas) -- total resultante: 108 sensores, 56
--      tipos, 7 zonas.
--   C. Telemetría de 180 días (antes 45) para TODO el catálogo de Alpayana:
--        - Sensores nuevos: histórico completo de 180 días + 30 días densos
--          a 15 minutos.
--        - Sensores ya existentes: SOLO se agrega el tramo antiguo que
--          faltaba (día 46 a 180) -- aditivo, no se toca ni se borra la
--          telemetría reciente ya sembrada por el script 80.
--   D. Propaga lo nuevo de telemetry_raw -> telemetry_fact (acotado a este
--      tenant, sin depender del backfill global 78, que es lento sobre los
--      ~2.4M de filas pendientes de TODOS los tenants).
--
-- Idempotente: ON CONFLICT (tenant_id, sensor_code) DO UPDATE para B; C usa
-- rangos de fecha disjuntos por diseño (no requiere DELETE previo) así que
-- re-ejecutar el script duplicaría esos puntos -- pensado para una sola
-- corrida de expansión, no para refresco recurrente (para eso, script 80).
--
-- Prerrequisitos: 74-78 (arquitectura telemetry_fact), 80 (catálogo base de
-- 44 sensores / 4 zonas de Alpayana).
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';
-- telemetry_raw es un hypertable comprimido -- inserciones/lecturas sobre
-- chunks comprimidos pueden exigir descomprimir más filas que el límite por
-- defecto de TimescaleDB (100k), aunque la operación esté acotada a un solo
-- tenant (la compresión agrupa filas de todos los tenants por chunk de
-- tiempo). Sin límite para esta transacción puntual.
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
  z_planta INT;
  z_vent INT;
  z_flota INT;
BEGIN
  SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-ESTE';
  SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = v_tid AND code = 'NOR-OESTE';
  SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-ESTE';
  SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = v_tid AND code = 'SUR-OESTE';

  -- -------------------------------------------------------------------
  -- A. Zonas nuevas
  -- -------------------------------------------------------------------
  INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order)
  VALUES
    (v_tid, 'PLANTA', 'Planta Concentradora', 50),
    (v_tid, 'VENTILACION', 'Ventilación Subterránea', 60),
    (v_tid, 'FLOTA', 'Flota de Equipos Mina', 70)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT zone_id INTO z_planta FROM sensor_zones WHERE tenant_id = v_tid AND code = 'PLANTA';
  SELECT zone_id INTO z_vent FROM sensor_zones WHERE tenant_id = v_tid AND code = 'VENTILACION';
  SELECT zone_id INTO z_flota FROM sensor_zones WHERE tenant_id = v_tid AND code = 'FLOTA';

  -- -------------------------------------------------------------------
  -- B. Sensores nuevos (64)
  -- -------------------------------------------------------------------
  INSERT INTO sensors (tenant_id, sensor_code, sensor_name, sensor_type, unit, serial_number, lat, lng, zone_id, is_active, connection_status)
  VALUES
    -- Nor-Este (Ambiental) -- 3 nuevos
    (v_tid, 'RAIN-01', 'Pluviómetro RAIN-01 (Campamento)', 'rain_gauge', 'mm', 'RAIN-01', v_lat0 + 0.038, v_lng0 + 0.008, z_ne, true, 'online'),
    (v_tid, 'PM25-01', 'Material Particulado Fino PM25-01', 'dust_pm25', 'ug/m3', 'PM25-01', v_lat0 + 0.017, v_lng0 + 0.036, z_ne, true, 'online'),
    (v_tid, 'UV-01', 'Índice UV Estación EM-01', 'uv_index', 'idx', 'UV-01', v_lat0 + 0.031, v_lng0 + 0.028, z_ne, true, 'online'),
    -- Nor-Oeste (Geotécnico) -- 6 nuevos
    (v_tid, 'RADAR-01', 'Radar de Talud GB-SAR RADAR-01 (Tajo Este)', 'radar_displacement', 'mm/dia', 'RADAR-01', v_lat0 + 0.021, v_lng0 - 0.021, z_no, true, 'online'),
    (v_tid, 'RADAR-02', 'Radar de Talud GB-SAR RADAR-02 (Botadero)', 'radar_displacement', 'mm/dia', 'RADAR-02', v_lat0 + 0.038, v_lng0 - 0.036, z_no, true, 'online'),
    (v_tid, 'INCL-05', 'Inclinómetro Fijo INCL-05 (Rampa 2)', 'inclinometer', 'mm', 'INCL-05', v_lat0 + 0.006, v_lng0 - 0.022, z_no, true, 'online'),
    (v_tid, 'INCL-06', 'Inclinómetro Fijo INCL-06 (Cantera Oeste)', 'inclinometer', 'mm', 'INCL-06', v_lat0 + 0.044, v_lng0 - 0.007, z_no, true, 'online'),
    (v_tid, 'EXT-03', 'Extensómetro de Varilla EXT-03 (Banco 7)', 'extensometer', 'mm', 'EXT-03', v_lat0 + 0.025, v_lng0 - 0.017, z_no, true, 'online'),
    (v_tid, 'EXT-04', 'Extensómetro de Varilla EXT-04 (Corona Botadero)', 'extensometer', 'mm', 'EXT-04', v_lat0 + 0.012, v_lng0 - 0.032, z_no, true, 'online'),
    -- Sur-Este (Hídrico / Vertimientos) -- 4 nuevos
    (v_tid, 'SST-01', 'Sólidos Suspendidos Totales SST-01 (Entrada)', 'suspended_solids', 'mg/L', 'SST-01', v_lat0 - 0.019, v_lng0 + 0.021, z_se, true, 'online'),
    (v_tid, 'SST-02', 'Sólidos Suspendidos Totales SST-02 (Salida)', 'suspended_solids', 'mg/L', 'SST-02', v_lat0 - 0.023, v_lng0 + 0.026, z_se, true, 'online'),
    (v_tid, 'DQO-01', 'Demanda Química de Oxígeno DQO-01', 'chemical_oxygen_demand', 'mg/L', 'DQO-01', v_lat0 - 0.021, v_lng0 + 0.019, z_se, true, 'online'),
    (v_tid, 'DBO-01', 'Demanda Bioquímica de Oxígeno DBO-01', 'biochemical_oxygen_demand', 'mg/L', 'DBO-01', v_lat0 - 0.021, v_lng0 + 0.019, z_se, true, 'online'),
    -- Sur-Oeste (Hidrología / Piezometría) -- 5 nuevos
    (v_tid, 'PZ-VW-06', 'Piezómetro VW-06 (Muro Oeste Presa Relaves)', 'piezometer_vw', 'kPa', 'PZ-VW-06', v_lat0 - 0.035, v_lng0 - 0.026, z_so, true, 'online'),
    (v_tid, 'PZ-VW-07', 'Piezómetro VW-07 (Tajo Abierto Banco 3)', 'piezometer_vw', 'kPa', 'PZ-VW-07', v_lat0 - 0.020, v_lng0 - 0.013, z_so, true, 'online'),
    (v_tid, 'PZ-VW-08', 'Piezómetro VW-08 (Cancha de Lixiviación Sur)', 'piezometer_vw', 'kPa', 'PZ-VW-08', v_lat0 - 0.044, v_lng0 - 0.011, z_so, true, 'online'),
    (v_tid, 'NIVEL-H2O-02', 'Nivel de Agua Poza de Contingencia', 'water_level', 'm', 'NIVEL-H2O-02', v_lat0 - 0.016, v_lng0 - 0.037, z_so, true, 'online'),
    (v_tid, 'RAIN-02', 'Pluviómetro RAIN-02 (Presa de Relaves)', 'rain_gauge', 'mm', 'RAIN-02', v_lat0 - 0.028, v_lng0 - 0.020, z_so, true, 'online'),
    -- Planta Concentradora -- 19 nuevos
    (v_tid, 'MILL-01-THR', 'Molino de Bolas MILL-01 (Throughput)', 'mill_throughput', 't/h', 'MILL-01', v_lat0 + 0.005, v_lng0 + 0.005, z_planta, true, 'online'),
    (v_tid, 'MILL-02-THR', 'Molino SAG MILL-02 (Throughput)', 'mill_throughput', 't/h', 'MILL-02', v_lat0 + 0.006, v_lng0 + 0.006, z_planta, true, 'online'),
    (v_tid, 'CRUSH-01-VIB', 'Chancadora Primaria CRUSH-01 (Vibración)', 'crusher_vibration', 'mm/s', 'CRUSH-01', v_lat0 + 0.007, v_lng0 + 0.004, z_planta, true, 'online'),
    (v_tid, 'CRUSH-02-VIB', 'Chancadora Secundaria CRUSH-02 (Vibración)', 'crusher_vibration', 'mm/s', 'CRUSH-02', v_lat0 + 0.008, v_lng0 + 0.003, z_planta, true, 'online'),
    (v_tid, 'CONV-01-VEL', 'Faja Transportadora CONV-01 (Velocidad)', 'conveyor_speed', 'm/s', 'CONV-01', v_lat0 + 0.004, v_lng0 + 0.007, z_planta, true, 'online'),
    (v_tid, 'CONV-02-VEL', 'Faja Transportadora CONV-02 (Velocidad)', 'conveyor_speed', 'm/s', 'CONV-02', v_lat0 + 0.003, v_lng0 + 0.008, z_planta, true, 'online'),
    (v_tid, 'CONV-03-VEL', 'Faja Transportadora CONV-03 (Velocidad)', 'conveyor_speed', 'm/s', 'CONV-03', v_lat0 + 0.009, v_lng0 + 0.002, z_planta, true, 'online'),
    (v_tid, 'SLURRY-01-DENS', 'Pulpa de Relaves SLURRY-01 (Densidad)', 'slurry_density', 'g/cm3', 'SLURRY-01', v_lat0 + 0.002, v_lng0 + 0.009, z_planta, true, 'online'),
    (v_tid, 'SLURRY-02-DENS', 'Pulpa de Concentrado SLURRY-02 (Densidad)', 'slurry_density', 'g/cm3', 'SLURRY-02', v_lat0 + 0.010, v_lng0 + 0.001, z_planta, true, 'online'),
    (v_tid, 'REACT-01-FLOW', 'Dosificación de Reactivos REACT-01 (Flujo)', 'reagent_flow', 'L/h', 'REACT-01', v_lat0 + 0.001, v_lng0 + 0.010, z_planta, true, 'online'),
    (v_tid, 'REACT-02-FLOW', 'Dosificación de Reactivos REACT-02 (Flujo)', 'reagent_flow', 'L/h', 'REACT-02', v_lat0 + 0.011, v_lng0 + 0.000, z_planta, true, 'online'),
    (v_tid, 'ELEC-01-VOLT', 'Subestación Eléctrica ELEC-01 (Voltaje)', 'voltage', 'V', 'ELEC-01', v_lat0 + 0.006, v_lng0 + 0.008, z_planta, true, 'online'),
    (v_tid, 'ELEC-02-VOLT', 'Subestación Eléctrica ELEC-02 (Voltaje)', 'voltage', 'V', 'ELEC-02', v_lat0 + 0.007, v_lng0 + 0.007, z_planta, true, 'online'),
    (v_tid, 'ELEC-01-CURR', 'Subestación Eléctrica ELEC-01 (Corriente)', 'current', 'A', 'ELEC-01', v_lat0 + 0.006, v_lng0 + 0.008, z_planta, true, 'online'),
    (v_tid, 'ELEC-02-CURR', 'Subestación Eléctrica ELEC-02 (Corriente)', 'current', 'A', 'ELEC-02', v_lat0 + 0.007, v_lng0 + 0.007, z_planta, true, 'online'),
    (v_tid, 'ELEC-01-PF', 'Subestación Eléctrica ELEC-01 (Factor de Potencia)', 'power_factor', 'ratio', 'ELEC-01', v_lat0 + 0.006, v_lng0 + 0.008, z_planta, true, 'online'),
    (v_tid, 'TRAFO-01-TEMP', 'Transformador de Potencia TRAFO-01 (Temperatura)', 'transformer_temp', '°C', 'TRAFO-01', v_lat0 + 0.005, v_lng0 + 0.009, z_planta, true, 'online'),
    (v_tid, 'HYD-01-PRES', 'Sistema Hidráulico Chancado HYD-01 (Presión)', 'hydraulic_pressure', 'bar', 'HYD-01', v_lat0 + 0.008, v_lng0 + 0.004, z_planta, true, 'online'),
    (v_tid, 'HYD-02-PRES', 'Sistema Hidráulico Molienda HYD-02 (Presión)', 'hydraulic_pressure', 'bar', 'HYD-02', v_lat0 + 0.004, v_lng0 + 0.006, z_planta, true, 'online'),
    -- Ventilación Subterránea -- 11 nuevos
    (v_tid, 'VENT-01-VEL', 'Ventilador Principal VENT-01 (Velocidad de Aire)', 'air_velocity', 'm/s', 'VENT-01', v_lat0 - 0.002, v_lng0 - 0.002, z_vent, true, 'online'),
    (v_tid, 'VENT-02-VEL', 'Ventilador Secundario VENT-02 (Velocidad de Aire)', 'air_velocity', 'm/s', 'VENT-02', v_lat0 - 0.003, v_lng0 - 0.003, z_vent, true, 'online'),
    (v_tid, 'VENT-03-VEL', 'Chimenea de Extracción VENT-03 (Velocidad de Aire)', 'air_velocity', 'm/s', 'VENT-03', v_lat0 - 0.004, v_lng0 - 0.004, z_vent, true, 'online'),
    (v_tid, 'CO2-01', 'Sensor de CO2 Nivel 3200 CO2-01', 'co2_level', 'ppm', 'CO2-01', v_lat0 - 0.001, v_lng0 - 0.005, z_vent, true, 'online'),
    (v_tid, 'CO2-02', 'Sensor de CO2 Nivel 3150 CO2-02', 'co2_level', 'ppm', 'CO2-02', v_lat0 - 0.005, v_lng0 - 0.001, z_vent, true, 'online'),
    (v_tid, 'CH4-01', 'Sensor de Metano Nivel 3200 CH4-01', 'methane_level', '%LEL', 'CH4-01', v_lat0 - 0.001, v_lng0 - 0.005, z_vent, true, 'online'),
    (v_tid, 'CH4-02', 'Sensor de Metano Nivel 3150 CH4-02', 'methane_level', '%LEL', 'CH4-02', v_lat0 - 0.005, v_lng0 - 0.001, z_vent, true, 'online'),
    (v_tid, 'O2-01', 'Sensor de Oxígeno Nivel 3200 O2-01', 'o2_level', '%', 'O2-01', v_lat0 - 0.001, v_lng0 - 0.005, z_vent, true, 'online'),
    (v_tid, 'O2-02', 'Sensor de Oxígeno Nivel 3150 O2-02', 'o2_level', '%', 'O2-02', v_lat0 - 0.005, v_lng0 - 0.001, z_vent, true, 'online'),
    (v_tid, 'H2S-01', 'Sensor de Ácido Sulfhídrico H2S-01', 'gas_h2s', 'ppm', 'H2S-01', v_lat0 - 0.002, v_lng0 - 0.006, z_vent, true, 'online'),
    (v_tid, 'H2S-02', 'Sensor de Ácido Sulfhídrico H2S-02', 'gas_h2s', 'ppm', 'H2S-02', v_lat0 - 0.006, v_lng0 - 0.002, z_vent, true, 'online'),
    -- Flota de Equipos Mina -- 16 nuevos
    (v_tid, 'CAM-01-FUEL', 'Camión Minero CAM-01 (Combustible)', 'fuel_level', '%', 'CAM-01', v_lat0 + 0.000, v_lng0 + 0.000, z_flota, true, 'online'),
    (v_tid, 'CAM-02-FUEL', 'Camión Minero CAM-02 (Combustible)', 'fuel_level', '%', 'CAM-02', v_lat0 + 0.001, v_lng0 + 0.001, z_flota, true, 'online'),
    (v_tid, 'CAM-03-FUEL', 'Camión Minero CAM-03 (Combustible)', 'fuel_level', '%', 'CAM-03', v_lat0 + 0.002, v_lng0 + 0.002, z_flota, true, 'online'),
    (v_tid, 'CAM-01-TEMP', 'Camión Minero CAM-01 (Temp. Motor)', 'engine_temperature', '°C', 'CAM-01', v_lat0 + 0.000, v_lng0 + 0.000, z_flota, true, 'online'),
    (v_tid, 'CAM-02-TEMP', 'Camión Minero CAM-02 (Temp. Motor)', 'engine_temperature', '°C', 'CAM-02', v_lat0 + 0.001, v_lng0 + 0.001, z_flota, true, 'online'),
    (v_tid, 'CAM-03-TEMP', 'Camión Minero CAM-03 (Temp. Motor)', 'engine_temperature', '°C', 'CAM-03', v_lat0 + 0.002, v_lng0 + 0.002, z_flota, true, 'online'),
    (v_tid, 'CAM-01-TP', 'Camión Minero CAM-01 (Presión Neumáticos)', 'tire_pressure', 'psi', 'CAM-01', v_lat0 + 0.000, v_lng0 + 0.000, z_flota, true, 'online'),
    (v_tid, 'CAM-02-TP', 'Camión Minero CAM-02 (Presión Neumáticos)', 'tire_pressure', 'psi', 'CAM-02', v_lat0 + 0.001, v_lng0 + 0.001, z_flota, true, 'online'),
    (v_tid, 'CAM-03-TP', 'Camión Minero CAM-03 (Presión Neumáticos)', 'tire_pressure', 'psi', 'CAM-03', v_lat0 + 0.002, v_lng0 + 0.002, z_flota, true, 'online'),
    (v_tid, 'CAM-04-TP', 'Camión Minero CAM-04 (Presión Neumáticos)', 'tire_pressure', 'psi', 'CAM-04', v_lat0 + 0.003, v_lng0 + 0.003, z_flota, true, 'online'),
    (v_tid, 'CAM-01-PAY', 'Camión Minero CAM-01 (Carga Útil)', 'payload_weight', 't', 'CAM-01', v_lat0 + 0.000, v_lng0 + 0.000, z_flota, true, 'online'),
    (v_tid, 'CAM-02-PAY', 'Camión Minero CAM-02 (Carga Útil)', 'payload_weight', 't', 'CAM-02', v_lat0 + 0.001, v_lng0 + 0.001, z_flota, true, 'online'),
    (v_tid, 'CAM-03-PAY', 'Camión Minero CAM-03 (Carga Útil)', 'payload_weight', 't', 'CAM-03', v_lat0 + 0.002, v_lng0 + 0.002, z_flota, true, 'online'),
    (v_tid, 'CAM-01-VIB', 'Camión Minero CAM-01 (Vibración)', 'equipment_vibration', 'mm/s', 'CAM-01', v_lat0 + 0.000, v_lng0 + 0.000, z_flota, true, 'online'),
    (v_tid, 'CAM-02-VIB', 'Camión Minero CAM-02 (Vibración)', 'equipment_vibration', 'mm/s', 'CAM-02', v_lat0 + 0.001, v_lng0 + 0.001, z_flota, true, 'online'),
    (v_tid, 'CAM-03-VIB', 'Camión Minero CAM-03 (Vibración)', 'equipment_vibration', 'mm/s', 'CAM-03', v_lat0 + 0.002, v_lng0 + 0.002, z_flota, true, 'online')
  ON CONFLICT (tenant_id, sensor_code) DO UPDATE SET
    sensor_name = EXCLUDED.sensor_name,
    unit = EXCLUDED.unit,
    zone_id = EXCLUDED.zone_id,
    is_active = true,
    connection_status = 'online';

  -- dim_sensor no se llena por trigger (dual-write todavía no activo, ver
  -- ADR-131) -- sin esta fila, 78/este script no encuentran el sensor_id_sk
  -- y su telemetría nunca llega a telemetry_fact.
  INSERT INTO dim_sensor (source_system, sensor_id, tenant_id_sk, site_id_sk, sensor_code, sensor_type, unit, is_active)
  SELECT 'iot_v2', s.sensor_id, dt.tenant_id_sk, dsite.site_id_sk, s.sensor_code, s.sensor_type, s.unit, s.is_active
  FROM sensors s
  JOIN dim_tenant dt ON dt.tenant_id = s.tenant_id
  LEFT JOIN dim_site dsite ON dsite.site_id = s.site_id
  WHERE s.tenant_id = v_tid AND s.sensor_code IN (
    'RAIN-01','PM25-01','UV-01','RADAR-01','RADAR-02','INCL-05','INCL-06','EXT-03','EXT-04',
    'SST-01','SST-02','DQO-01','DBO-01','PZ-VW-06','PZ-VW-07','PZ-VW-08','NIVEL-H2O-02','RAIN-02',
    'MILL-01-THR','MILL-02-THR','CRUSH-01-VIB','CRUSH-02-VIB','CONV-01-VEL','CONV-02-VEL','CONV-03-VEL',
    'SLURRY-01-DENS','SLURRY-02-DENS','REACT-01-FLOW','REACT-02-FLOW','ELEC-01-VOLT','ELEC-02-VOLT',
    'ELEC-01-CURR','ELEC-02-CURR','ELEC-01-PF','TRAFO-01-TEMP','HYD-01-PRES','HYD-02-PRES',
    'VENT-01-VEL','VENT-02-VEL','VENT-03-VEL','CO2-01','CO2-02','CH4-01','CH4-02','O2-01','O2-02','H2S-01','H2S-02',
    'CAM-01-FUEL','CAM-02-FUEL','CAM-03-FUEL','CAM-01-TEMP','CAM-02-TEMP','CAM-03-TEMP',
    'CAM-01-TP','CAM-02-TP','CAM-03-TP','CAM-04-TP','CAM-01-PAY','CAM-02-PAY','CAM-03-PAY',
    'CAM-01-VIB','CAM-02-VIB','CAM-03-VIB'
  )
  ON CONFLICT (sensor_id) DO NOTHING;

  -- -------------------------------------------------------------------
  -- C.1 Telemetría de los 64 sensores nuevos: 180 días cada 1 hora
  -- -------------------------------------------------------------------
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'rain_gauge' THEN greatest(0.0, CASE WHEN random() > 0.92 THEN 15.0 * random() ELSE 0.0 END)
      WHEN 'dust_pm25' THEN greatest(2.0, 18.0 + 10.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 5.0)
      WHEN 'uv_index' THEN greatest(0.0, 8.0 * sin(pi() * greatest(0.0, least(1.0, (extract(hour from t) - 6.0) / 12.0))) + (random() - 0.5) * 0.5)
      WHEN 'radar_displacement' THEN 0.5 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.05
      WHEN 'suspended_solids' THEN 25.0 + 10.0 * sin(2.0 * pi() * extract(day from t) / 5.0) + (random() - 0.5) * 4.0
      WHEN 'chemical_oxygen_demand' THEN 45.0 + 15.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 5.0
      WHEN 'biochemical_oxygen_demand' THEN 12.0 + 5.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 2.0
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 2.0
      WHEN 'water_level' THEN 5.8 + 1.2 * sin(2.0 * pi() * extract(day from t) / 10.0) + (random() - 0.5) * 0.05
      WHEN 'inclinometer' THEN 2.0 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN 4.5 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.006 + (random() - 0.5) * 0.08
      WHEN 'mill_throughput' THEN greatest(0.0, 850.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 40.0)
      WHEN 'crusher_vibration' THEN 4.5 + 2.0 * random() + (CASE WHEN random() > 0.98 THEN 6.0 * random() ELSE 0.0 END)
      WHEN 'conveyor_speed' THEN greatest(0.0, 2.8 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.15)
      WHEN 'slurry_density' THEN 1.35 + 0.08 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.03
      WHEN 'reagent_flow' THEN greatest(0.0, 120.0 + 30.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 10.0)
      WHEN 'voltage' THEN 460.0 + 8.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'current' THEN greatest(0.0, 320.0 + 60.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 20.0)
      WHEN 'power_factor' THEN least(1.0, greatest(0.0, 0.92 + 0.03 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.02))
      WHEN 'transformer_temp' THEN 55.0 + 10.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'hydraulic_pressure' THEN greatest(0.0, 180.0 + 20.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 8.0)
      WHEN 'air_velocity' THEN greatest(0.0, 2.2 + 0.6 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.3)
      WHEN 'co2_level' THEN greatest(300.0, 650.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 15.0) / 24.0) + (random() - 0.5) * 40.0)
      WHEN 'methane_level' THEN greatest(0.0, 0.4 + 0.3 * random() + (CASE WHEN random() > 0.995 THEN 3.0 * random() ELSE 0.0 END))
      WHEN 'o2_level' THEN 20.7 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.15
      WHEN 'gas_h2s' THEN greatest(0.0, 0.8 + 0.6 * random() + (CASE WHEN random() > 0.99 THEN 5.0 * random() ELSE 0.0 END))
      WHEN 'fuel_level' THEN least(100.0, greatest(5.0, 55.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 3.0) + (random() - 0.5) * 8.0))
      WHEN 'engine_temperature' THEN 88.0 + 6.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 3.0
      WHEN 'tire_pressure' THEN 95.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'payload_weight' THEN greatest(0.0, 45.0 + 40.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 12.0) / 16.0)) + (random() - 0.5) * 8.0)
      WHEN 'equipment_vibration' THEN 3.2 + 1.5 * random() + (CASE WHEN random() > 0.985 THEN 5.0 * random() ELSE 0.0 END)
      ELSE 50.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.h || ' hours')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(0, 4320, 1) AS g(h)
    WHERE s.tenant_id = v_tid AND s.sensor_code IN (
      'RAIN-01','PM25-01','UV-01','RADAR-01','RADAR-02','INCL-05','INCL-06','EXT-03','EXT-04',
      'SST-01','SST-02','DQO-01','DBO-01','PZ-VW-06','PZ-VW-07','PZ-VW-08','NIVEL-H2O-02','RAIN-02',
      'MILL-01-THR','MILL-02-THR','CRUSH-01-VIB','CRUSH-02-VIB','CONV-01-VEL','CONV-02-VEL','CONV-03-VEL',
      'SLURRY-01-DENS','SLURRY-02-DENS','REACT-01-FLOW','REACT-02-FLOW','ELEC-01-VOLT','ELEC-02-VOLT',
      'ELEC-01-CURR','ELEC-02-CURR','ELEC-01-PF','TRAFO-01-TEMP','HYD-01-PRES','HYD-02-PRES',
      'VENT-01-VEL','VENT-02-VEL','VENT-03-VEL','CO2-01','CO2-02','CH4-01','CH4-02','O2-01','O2-02','H2S-01','H2S-02',
      'CAM-01-FUEL','CAM-02-FUEL','CAM-03-FUEL','CAM-01-TEMP','CAM-02-TEMP','CAM-03-TEMP',
      'CAM-01-TP','CAM-02-TP','CAM-03-TP','CAM-04-TP','CAM-01-PAY','CAM-02-PAY','CAM-03-PAY',
      'CAM-01-VIB','CAM-02-VIB','CAM-03-VIB'
    )
  ) base;

  -- -------------------------------------------------------------------
  -- C.2 Telemetría de los 64 sensores nuevos: alta resolución, 30 días
  -- cada 15 minutos (evita duplicar los puntos horarios exactos de C.1)
  -- -------------------------------------------------------------------
  INSERT INTO telemetry_raw (tenant_id, sensor_id, captured_at, value_numeric)
  SELECT tenant_id, sensor_id, t,
    CASE sensor_type
      WHEN 'rain_gauge' THEN greatest(0.0, CASE WHEN random() > 0.97 THEN 6.0 * random() ELSE 0.0 END)
      WHEN 'dust_pm25' THEN greatest(2.0, 18.0 + 10.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 3.0)
      WHEN 'crusher_vibration' THEN 4.5 + 2.0 * random() + (CASE WHEN random() > 0.99 THEN 6.0 * random() ELSE 0.0 END)
      WHEN 'conveyor_speed' THEN greatest(0.0, 2.8 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.1)
      WHEN 'voltage' THEN 460.0 + 8.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'current' THEN greatest(0.0, 320.0 + 60.0 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 12.0)
      WHEN 'air_velocity' THEN greatest(0.0, 2.2 + 0.6 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.2)
      WHEN 'co2_level' THEN greatest(300.0, 650.0 + 150.0 * sin(2.0 * pi() * (extract(hour from t) - 15.0) / 24.0) + (random() - 0.5) * 25.0)
      WHEN 'methane_level' THEN greatest(0.0, 0.4 + 0.3 * random() + (CASE WHEN random() > 0.997 THEN 3.0 * random() ELSE 0.0 END))
      WHEN 'o2_level' THEN 20.7 + 0.3 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 0.1
      WHEN 'fuel_level' THEN least(100.0, greatest(5.0, 55.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 3.0) + (random() - 0.5) * 5.0))
      WHEN 'engine_temperature' THEN 88.0 + 6.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
      WHEN 'payload_weight' THEN greatest(0.0, 45.0 + 40.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 12.0) / 16.0)) + (random() - 0.5) * 5.0)
      WHEN 'equipment_vibration' THEN 3.2 + 1.5 * random() + (CASE WHEN random() > 0.99 THEN 5.0 * random() ELSE 0.0 END)
      WHEN 'piezometer_vw' THEN 240.0 + 35.0 * sin(2.0 * pi() * extract(day from t) / 14.0) + (random() - 0.5) * 1.5
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 1.5
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, NOW() - (g.m || ' minutes')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(15, 43200, 15) AS g(m)  -- 30 días
    WHERE s.tenant_id = v_tid AND s.sensor_code IN (
      'RAIN-01','PM25-01','UV-01','RADAR-01','RADAR-02','INCL-05','INCL-06','EXT-03','EXT-04',
      'SST-01','SST-02','DQO-01','DBO-01','PZ-VW-06','PZ-VW-07','PZ-VW-08','NIVEL-H2O-02','RAIN-02',
      'MILL-01-THR','MILL-02-THR','CRUSH-01-VIB','CRUSH-02-VIB','CONV-01-VEL','CONV-02-VEL','CONV-03-VEL',
      'SLURRY-01-DENS','SLURRY-02-DENS','REACT-01-FLOW','REACT-02-FLOW','ELEC-01-VOLT','ELEC-02-VOLT',
      'ELEC-01-CURR','ELEC-02-CURR','ELEC-01-PF','TRAFO-01-TEMP','HYD-01-PRES','HYD-02-PRES',
      'VENT-01-VEL','VENT-02-VEL','VENT-03-VEL','CO2-01','CO2-02','CH4-01','CH4-02','O2-01','O2-02','H2S-01','H2S-02',
      'CAM-01-FUEL','CAM-02-FUEL','CAM-03-FUEL','CAM-01-TEMP','CAM-02-TEMP','CAM-03-TEMP',
      'CAM-01-TP','CAM-02-TP','CAM-03-TP','CAM-04-TP','CAM-01-PAY','CAM-02-PAY','CAM-03-PAY',
      'CAM-01-VIB','CAM-02-VIB','CAM-03-VIB'
    )
    AND (g.m % 60) <> 0
  ) base;

  -- -------------------------------------------------------------------
  -- C.3 Extensión histórica de los 44 sensores ya existentes (script 80):
  -- agrega el tramo de día 46 a 180 (aditivo -- no toca los últimos 45
  -- días ni la ventana densa de 48h ya sembrados).
  -- -------------------------------------------------------------------
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
      WHEN 'inclinometer' THEN 2.0 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.06
      WHEN 'extensometer' THEN 4.5 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.006 + (random() - 0.5) * 0.08
      WHEN 'settlement_cell' THEN -3.0 - (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.012 + (random() - 0.5) * 0.04
      WHEN 'crack_sensor' THEN 1.8 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.004 + 0.2 * sin(2.0 * pi() * (extract(hour from t) - 14.0) / 24.0) + (random() - 0.5) * 0.02
      WHEN 'tiltmeter' THEN 0.35 + 0.15 * sin(2.0 * pi() * extract(day from t) / 9.0) + (random() - 0.5) * 0.02
      WHEN 'accelerograph' THEN greatest(0.001, 0.012 + (CASE WHEN random() > 0.98 THEN 0.08 * random() ELSE 0.003 * random() END))
      WHEN 'seismograph' THEN greatest(0.5, 8.0 + 4.0 * sin(2.0 * pi() * extract(hour from t) / 12.0) + (CASE WHEN random() > 0.97 THEN 20.0 * random() ELSE 1.5 * random() END))
      WHEN 'dust_pm10' THEN greatest(3.0, 35.0 + 20.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0)) + (random() - 0.3) * 8.0)
      WHEN 'noise_level' THEN greatest(38.0, 55.0 + 15.0 * greatest(0.0, sin(2.0 * pi() * (extract(hour from t) - 13.0) / 24.0)) + (random() - 0.5) * 4.0 + (CASE WHEN random() > 0.985 THEN 25.0 * random() ELSE 0 END))
      WHEN 'gas_co' THEN greatest(0.0, 1.5 + 1.0 * random() + (CASE WHEN random() > 0.99 THEN 8.0 * random() ELSE 0 END))
      WHEN 'gnss_displacement' THEN 1.0 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.01 + (random() - 0.5) * 0.05
      WHEN 'dissolved_oxygen' THEN 6.5 + 0.8 * sin(2.0 * pi() * (extract(hour from t) - 9.0) / 24.0) + (random() - 0.5) * 0.3
      WHEN 'orp' THEN 150.0 + 40.0 * sin(2.0 * pi() * extract(day from t) / 6.0) + (random() - 0.5) * 10.0
      WHEN 'water_temperature' THEN 14.0 + 1.5 * sin(2.0 * pi() * (extract(hour from t) - 10.0) / 24.0) + (random() - 0.5) * 0.3
      WHEN 'tailings_pond_level' THEN 3.2 + (extract(epoch from (t - (NOW() - interval '180 days'))) / 86400.0) * 0.006 + (random() - 0.5) * 0.03
      ELSE 50.0 + 15.0 * sin(2.0 * pi() * extract(hour from t) / 24.0) + (random() - 0.5) * 2.0
    END AS val
  FROM (
    SELECT s.tenant_id, s.sensor_id, s.sensor_type, s.sensor_code, NOW() - (g.h || ' hours')::interval AS t
    FROM sensors s
    CROSS JOIN generate_series(1081, 4320, 1) AS g(h)  -- día 46 a 180
    WHERE s.tenant_id = v_tid AND s.serial_number IN (
      'EM-01', 'EM-02', 'AM-01', 'RADNET-01', 'COND-01', 'PH-01', 'PH-02', 'TURB-01', 'EVAP-01',
      'PZ-VW-01', 'PZ-VW-02', 'PZ-VW-03', 'NIVEL-H2O-01', 'VEL-H2O-01', 'CAUDAL-01',
      'INCL-01', 'INCL-02', 'INCL-03', 'EXT-01', 'EXT-02',
      'CELDA-AS-01', 'CELDA-AS-02', 'ACEL-01', 'ACEL-02', 'SISM-01', 'TILT-01', 'GRIETA-01',
      'PM10-01', 'RUIDO-01', 'CO-01', 'GNSS-01', 'GNSS-02', 'INCL-04',
      'OD-01', 'ORP-01', 'PZ-VW-04', 'PZ-VW-05', 'TEMP-H2O-01', 'NIVEL-RELAVES-01'
    )
  ) base;

  -- -------------------------------------------------------------------
  -- D. Propagación a telemetry_fact acotada a Alpayana (evita depender del
  -- backfill global 78, lento sobre el backlog de todos los tenants).
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
