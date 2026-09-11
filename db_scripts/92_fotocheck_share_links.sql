-- 92_fotocheck_share_links.sql — link opaco para ver/descargar el fotocheck
--
-- Mismo patrón que 88_report_pdf_share_links.sql (ADR-138): token opaco
-- (http_utils::secureRandomHex) que resuelve a un usuario SIN sesión --
-- pensado para mandarse por email/WhatsApp y abrirse con cero pasos desde
-- el celular. A diferencia del link de PDF (temporal, expira), este NO
-- expira: es una credencial personal, no una descarga puntual. Un usuario
-- solo tiene un token (se reutiliza el existente en reenvíos, ver
-- getOrCreateFotocheckShareLinkPg).
--
-- Idempotente (mismo patrón que el resto de db_scripts/*.sql de este repo).
-- Espejado también en ensureAuthSchemaPg (auth_storage_pg.cpp).

CREATE TABLE IF NOT EXISTS fotocheck_share_links (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotocheck_share_links_user ON fotocheck_share_links(user_id);
