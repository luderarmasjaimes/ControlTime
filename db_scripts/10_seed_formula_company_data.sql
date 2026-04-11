-- Seed de datos formula minera por empresa registrada (multitenant)

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT TRIM(company_name) AS company_name
    FROM auth_users
    WHERE COALESCE(TRIM(company_name), '') <> ''
  LOOP
    INSERT INTO mineria_empresas(codigo, nombre, activo)
    VALUES (
      regexp_replace(upper(rec.company_name), '[^A-Z0-9]+', '_', 'g'),
      rec.company_name,
      TRUE
    )
    ON CONFLICT (nombre) DO NOTHING;

    INSERT INTO mineria_minas(empresa_id, codigo, nombre, zona_tipo, umbral_temp_alerta, factor_ajuste, activo)
    SELECT e.id, 'UNI-001', 'Unidad Minera Principal', 'sierra', 8.0, 0.82, TRUE
    FROM mineria_empresas e
    WHERE e.nombre = rec.company_name
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    INSERT INTO mineria_variables(empresa_id, codigo, nombre, unidad, tipo, activo)
    SELECT e.id, 'TEMP-001', 'Temperatura Ambiente', 'C', 'temperatura', TRUE
    FROM mineria_empresas e
    WHERE e.nombre = rec.company_name
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    INSERT INTO mineria_sensores(empresa_id, mina_id, variable_id, codigo, nombre, activo)
    SELECT e.id, m.id, v.id, 'SEN-001', 'Sensor Temperatura Principal', TRUE
    FROM mineria_empresas e
    JOIN mineria_minas m ON m.empresa_id = e.id AND m.codigo = 'UNI-001'
    JOIN mineria_variables v ON v.empresa_id = e.id AND v.codigo = 'TEMP-001'
    WHERE e.nombre = rec.company_name
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    INSERT INTO mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad)
    SELECT e.id, m.id, v.id, ts,
           ROUND(CAST(9.8 + 4.4 * SIN(EXTRACT(EPOCH FROM ts) / 86400.0 * 2 * PI()) + (random() * 2.6 - 1.3) AS NUMERIC), 2),
           100
    FROM mineria_empresas e
    JOIN mineria_minas m ON m.empresa_id = e.id AND m.codigo = 'UNI-001'
    JOIN mineria_variables v ON v.empresa_id = e.id AND v.codigo = 'TEMP-001'
    CROSS JOIN generate_series(NOW() - INTERVAL '45 days', NOW(), INTERVAL '30 minutes') ts
    WHERE e.nombre = rec.company_name
      AND NOT EXISTS (
        SELECT 1 FROM mineria_lecturas l
        WHERE l.empresa_id = e.id AND l.mina_id = m.id AND l.variable_id = v.id
      );
  END LOOP;
END$$;
