-- ============================================================================
-- 33_workflow_states_migration.sql
-- Alinea `reports.status` con el vocabulario canónico de ADR-017
-- (HALLAZGO #3, ver GAP_ANALYSIS_2026-07-04.md).
--
-- Situación encontrada antes de este script:
--   - `reports.status` (VARCHAR(50), 01_init.sql) SIN CHECK constraint: el
--     backend (report_service.cpp) y el frontend (WorkflowPanel.jsx) usaban
--     cada uno un vocabulario ligeramente distinto y ninguno era forzado por
--     la BD.
--   - Datos reales en aurixa-db: solo 2 valores presentes — 'draft' y
--     'published'. 'published' no es un estado válido de ADR-017 y no lo usa
--     ningún código actual (el seed demo lo escribía directo, ver
--     02_seed_demo.sql, ya corregido a 'archived' en esta misma sesión).
--     Semánticamente 'published' (informe distribuido/cerrado) equivale al
--     estado terminal 'archived' del ADR, por eso se migra hacia allí y no
--     hacia 'signed' (que implica firma digital, algo que estos registros
--     legacy nunca tuvieron).
--
-- Vocabulario canónico (ADR-017), replicado en
-- backend/src/reports/report_workflow.hpp y en
-- frontend/.../WorkflowPanel.jsx:
--   draft → in_review → approved → signed → archived
--                ↘ rejected → draft
--
-- Idempotente: el UPDATE de datos legacy no falla si ya no quedan filas con
-- 'published', y el CHECK constraint se agrega con IF NOT EXISTS vía DO block
-- (ADD CONSTRAINT no soporta IF NOT EXISTS directo en todas las versiones).
-- ============================================================================

BEGIN;

-- 1) Migrar cualquier valor legacy fuera del vocabulario canónico. Se cubren
--    explícitamente los valores observados en datos reales ('published') y,
--    por seguridad, cualquier otro valor no reconocido cae también a
--    'archived' en vez de bloquear la migración (evita que un valor legacy
--    desconocido impida agregar el CHECK constraint más abajo).
UPDATE reports
SET status = 'archived'
WHERE status = 'published';

UPDATE reports
SET status = 'archived'
WHERE status NOT IN ('draft', 'in_review', 'approved', 'signed', 'archived', 'rejected');

-- 2) CHECK constraint: la BD pasa a ser la última línea de defensa del
--    vocabulario, incluso si algún código futuro (o un acceso directo a la
--    BD) olvida validar contra report_workflow.hpp.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_reports_status_canonical'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT chk_reports_status_canonical
            CHECK (status IN ('draft', 'in_review', 'approved', 'signed', 'archived', 'rejected'));
    END IF;
END $$;

COMMIT;
