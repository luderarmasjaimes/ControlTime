-- ============================================================================
-- 116 — Lista de correos adicionales de envío del PDF exportado
-- ============================================================================
-- Nueva columna JSONB en report_document_settings (mismo patrón que
-- header_footer_json/cover_json/watermark_json/page_setup_json,
-- db_scripts/19): array de strings de email, reemplazado entero en cada
-- guardado -- no hay caso de uso de auditoría por-email, es una lista corta
-- (tope 10, ver report_document_settings.cpp::savePdfShareRecipients) que se
-- vuelve a mandar completa desde el modal post-export cada vez que se edita.
-- Default '[]' para que una fila ya existente (o una recién insertada solo
-- por watermark) nunca tenga NULL acá.

ALTER TABLE report_document_settings
    ADD COLUMN IF NOT EXISTS pdf_share_recipients_json JSONB NOT NULL DEFAULT '[]'::jsonb;
