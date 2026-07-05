-- ============================================================================
-- 30_refactor_perf_and_procedures.sql
-- Refactor de rendimiento y desacople código↔SQL.
--
-- Objetivo: mover consultas que hoy viven hardcodeadas en el backend C++ a
-- objetos de base de datos (vistas + stored procedures) y añadir SOLO los
-- índices que faltan realmente (verificado contra scripts 04/16/19/20).
--
-- Idempotente: seguro de re-ejecutar (IF NOT EXISTS / CREATE OR REPLACE).
-- Prerrequisitos: 04 (sensors, telemetry_raw), 19 (reports.*), 16 (audit).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Caché de sensores activos
--    Antes: telemetry_ingest.cpp ejecutaba el SQL crudo:
--      "SELECT sensor_code, sensor_id::text, tenant_id::text
--       FROM sensors WHERE is_active = true"
--    Ahora: el backend llama sp_load_active_sensors(); el contrato de columnas
--    vive en la BD y puede evolucionar (joins, filtros) sin recompilar C++.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_sensors AS
SELECT s.sensor_code,
       s.sensor_id,
       s.tenant_id
FROM sensors s
WHERE s.is_active = TRUE;

COMMENT ON VIEW v_active_sensors IS
    'Sensores activos para el caché en memoria del ingestor de telemetría.';

CREATE OR REPLACE FUNCTION sp_load_active_sensors()
RETURNS TABLE (sensor_code TEXT, sensor_id UUID, tenant_id UUID)
LANGUAGE sql
STABLE
AS $$
    SELECT sensor_code, sensor_id, tenant_id FROM v_active_sensors;
$$;

COMMENT ON FUNCTION sp_load_active_sensors() IS
    'Devuelve (sensor_code, sensor_id, tenant_id) de sensores activos. '
    'Reemplaza el SELECT hardcodeado del ingestor (telemetry_ingest.cpp).';

-- Índice de apoyo: el ingestor carga TODOS los activos (seq scan aceptable),
-- pero las búsquedas por tenant de sensores activos sí se benefician.
CREATE INDEX IF NOT EXISTS idx_sensors_tenant_active
    ON sensors (tenant_id, is_active)
    WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 2) Creación de informe (parametrizada)
--    Antes: report_service.cpp construía el INSERT concatenando literales.
--    Ahora: sp_create_report() encapsula el INSERT ... RETURNING id.
--    El backend puede migrar a PQexecParams('SELECT sp_create_report($1,...)')
--    o seguir con INSERT parametrizado; el SP deja el contrato en un solo lugar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sp_create_report(
    p_project_id  UUID,
    p_title       TEXT,
    p_content     JSONB,
    p_status      TEXT,
    p_company     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_id TEXT;
BEGIN
    INSERT INTO reports (project_id, title, content_json, status, company_name)
    VALUES (p_project_id, p_title, p_content, p_status, p_company)
    RETURNING id::text INTO v_new_id;
    RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION sp_create_report(UUID, TEXT, JSONB, TEXT, TEXT) IS
    'Inserta un informe y devuelve su id. Reemplaza el INSERT concatenado '
    'de report_service.cpp::createReportPg.';

-- Índice para el listado por empresa ordenado por fecha (listReportsPg filtra
-- por company_name; el índice existente es (tenant_id, status)).
CREATE INDEX IF NOT EXISTS idx_reports_company_created
    ON reports (company_name, created_at DESC)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Vista de resumen de informes con actividad de auditoría
--    Evita el patrón N+1 (una consulta de auditoría por informe) al armar
--    listados administrativos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_reports_activity_summary AS
SELECT r.id,
       r.title,
       r.status,
       r.company_name,
       r.created_at,
       r.updated_at,
       COUNT(a.id)  AS audit_events,
       MAX(a.created_at) AS last_audit_at
FROM reports r
LEFT JOIN platform_audit_log a
       ON a.entity_type = 'report'
      AND a.entity_id = r.id::text
WHERE r.deleted_at IS NULL
GROUP BY r.id, r.title, r.status, r.company_name, r.created_at, r.updated_at;

COMMENT ON VIEW v_reports_activity_summary IS
    'Resumen de informes con conteo de eventos de auditoría; evita N+1 en '
    'listados administrativos.';

COMMIT;
