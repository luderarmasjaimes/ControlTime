-- ============================================================================
-- 34_report_signature.sql
-- ADR-018: la transición a `signed` (ADR-017) requiere una firma documental
-- registrada (nombre, cargo/rol, fecha) — "no basta el hash". Antes de este
-- script, `updateReportPg` solo cambiaba el string de `status`, sin capturar
-- quién firmó ni con qué cargo: la "regla dura" de ADR-018 no se cumplía.
--
-- Diseño: columnas en `reports` (mismo patrón que `reviewed_by`/`reviewed_at`,
-- ya existentes desde 19_report_technical_mining_enterprise.sql), pobladas
-- por el servidor en el momento exacto de la transición a `signed` — nunca
-- por el cliente. `signed_by_name`/`signed_by_role` quedan desnormalizados
-- (además de `signed_by` como FK) para que la firma sobreviva legible aunque
-- el usuario cambie de nombre/rol después, o sea desactivado.
-- ============================================================================

ALTER TABLE reports ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS signed_by_name TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS signed_by_role TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

COMMENT ON COLUMN reports.signed_by IS 'FK a auth_users: quién firmó (ADR-018). NULL si el informe nunca llegó a signed.';
COMMENT ON COLUMN reports.signed_by_name IS 'Nombre completo desnormalizado al momento de firmar (sobrevive a cambios/baja del usuario).';
COMMENT ON COLUMN reports.signed_by_role IS 'Cargo/rol RBAC (ADR-029) del firmante al momento de firmar.';
COMMENT ON COLUMN reports.signed_at IS 'Timestamp servidor de la transición approved->signed (ADR-015: autoritativo en servidor).';
