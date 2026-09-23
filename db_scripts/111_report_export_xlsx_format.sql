-- ============================================================================
-- 111 — report_export_job.export_format acepta 'xlsx'
-- ============================================================================
-- Nuevo formato de export (no existía): las tablas ya insertadas en el
-- informe (los mismos bloques `table` que db_scripts/19 ya soporta para
-- docx/pdf/pptx/mp4/html/odt) ahora también se pueden exportar a un
-- workbook de Excel real (ver pdf-export-service/reportXlsxBuilder.js y
-- POST /api/reports/{id}/export/xlsx). Mismo patrón drop/re-add de
-- CHECK constraint que db_scripts/43 (auth_user_tenant_role_check /
-- role_permissions_role_check).

ALTER TABLE report_export_job DROP CONSTRAINT IF EXISTS report_export_job_export_format_check;
ALTER TABLE report_export_job ADD CONSTRAINT report_export_job_export_format_check
    CHECK (export_format IN ('docx', 'pdf', 'pptx', 'mp4', 'html', 'odt', 'xlsx'));
