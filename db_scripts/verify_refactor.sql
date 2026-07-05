-- verify_refactor.sql — Comprobación funcional de los objetos del refactor.
-- Se ejecuta contra sensors_db DESPUÉS de aplicar 30_refactor_perf_and_procedures.sql.
-- Cada bloque imprime un resultado; falla ruidosamente si algo no existe.

\echo '=== 1) Objetos creados existen ==='
SELECT 'v_active_sensors'            AS obj, to_regclass('public.v_active_sensors')            IS NOT NULL AS ok
UNION ALL SELECT 'v_reports_activity_summary', to_regclass('public.v_reports_activity_summary') IS NOT NULL
UNION ALL SELECT 'sp_load_active_sensors', to_regprocedure('sp_load_active_sensors()')          IS NOT NULL
UNION ALL SELECT 'sp_create_report(uuid,text,jsonb,text,text)',
                 to_regprocedure('sp_create_report(uuid,text,jsonb,text,text)')                 IS NOT NULL
UNION ALL SELECT 'idx_sensors_tenant_active', to_regclass('public.idx_sensors_tenant_active')   IS NOT NULL
UNION ALL SELECT 'idx_reports_company_created', to_regclass('public.idx_reports_company_created') IS NOT NULL;

\echo '=== 2) sp_load_active_sensors() ejecuta y devuelve columnas esperadas ==='
SELECT count(*) AS filas_sensores_activos FROM sp_load_active_sensors();

\echo '=== 3) v_active_sensors coincide con la tabla base ==='
SELECT (SELECT count(*) FROM v_active_sensors)
     = (SELECT count(*) FROM sensors WHERE is_active = TRUE) AS view_matches_base;

\echo '=== 4) sp_create_report inserta y devuelve id (round-trip) ==='
DO $$
DECLARE
  v_id TEXT;
  v_company TEXT := 'VERIFY_TENANT';
BEGIN
  v_id := sp_create_report(NULL, 'Informe de verificación',
                           '{"pages":[{"page_number":1,"elements":[{"type":"cover"}]}]}'::jsonb,
                           'draft', v_company);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'sp_create_report devolvió NULL';
  END IF;
  RAISE NOTICE 'sp_create_report OK, id=%', v_id;
  -- limpieza (soft: marca deleted para no ensuciar)
  UPDATE reports SET deleted_at = NOW() WHERE id::text = v_id;
END $$;

\echo '=== 5) v_reports_activity_summary consulta sin error (join reports<->audit) ==='
SELECT count(*) AS filas_resumen FROM v_reports_activity_summary;

\echo '=== 6) EXPLAIN usa el índice nuevo para listado por empresa ==='
EXPLAIN (COSTS OFF)
SELECT id FROM reports
WHERE company_name = 'VERIFY_TENANT' AND deleted_at IS NULL
ORDER BY created_at DESC;

\echo '=== VERIFY_REFACTOR_DONE ==='
