-- 88_report_pdf_share_links.sql — Enlaces de acceso directo a PDF (ADR-138)
--
-- Contexto: el QR de ADR-080 codifica la contraseña del PDF cifrado (qpdf) --
-- siempre requiere un paso manual (pegarla) porque ningun lector de PDF
-- estandar permite que un QR le "hable" y la escriba solo. Este script agrega
-- la contraparte "cero pasos": un token opaco que, al visitarse por URL
-- (QR -> navegador del celular), sirve el MISMO informe ya renderizado con
-- marca de agua pero SIN cifrado -- la proteccion pasa a ser el token en si
-- (largo, aleatorio, con expiracion), no una contrasena de PDF.
--
-- Idempotente (mismo patron que el resto de db_scripts/*.sql de este repo).

CREATE TABLE IF NOT EXISTS report_pdf_share_links (
    token TEXT PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL,
    created_by_username TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_pdf_share_links_report_id
    ON report_pdf_share_links(report_id);

-- Barrido de enlaces vencidos hace ratio de limpieza, no de seguridad: un
-- token expirado ya se rechaza en resolveReportShareLinkPg aunque la fila
-- siga presente (comparacion de expires_at en cada resolucion).
CREATE INDEX IF NOT EXISTS idx_report_pdf_share_links_expires_at
    ON report_pdf_share_links(expires_at);

COMMENT ON TABLE report_pdf_share_links IS
    'ADR-138: tokens de acceso directo a un PDF SIN cifrado propio -- la proteccion es el token (largo, aleatorio, expira), pensado para abrirse con cero pasos al escanear un QR desde el celular.';
COMMENT ON COLUMN report_pdf_share_links.token IS
    'Token opaco (secureRandomHex, 32 bytes -> 64 hex chars) -- no es un JWT, no autentica nada mas que este endpoint puntual.';
