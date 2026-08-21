-- ─────────────────────────────────────────────────────────────────────────
-- 70 — Adjuntos del widget de chat web (docx/pptx/pdf/jpg/png)
-- ─────────────────────────────────────────────────────────────────────────
-- El widget de soporte (SupportChatWidget.tsx) pedía poder adjuntar un
-- archivo a la conversación (informe, ficha técnica, foto) además de texto.
-- Se guarda en una tabla propia -- no en support_chat_message -- porque un
-- adjunto no es un turno de conversación (no tiene role 'user'/'assistant'
-- ni intent) y su contenido es binario, no encaja en la columna `content
-- text` de esa tabla (mismo criterio de "columnas nullable a medias" que
-- llevó a NO reusar whatsapp_message_log para support_chat_message, ver
-- db_scripts/63).
--
-- content_sha256 se calcula en C++ (openssl, ver support_storage_pg.cpp)
-- en vez de con sha256()/digest() de SQL: evita depender de que la
-- extensión pgcrypto esté habilitada en la instancia.
CREATE TABLE IF NOT EXISTS support_chat_attachment (
    id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id uuid, -- vacío = adjunto suelto, sin turno de chat asociado todavía
    tenant_id       uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    user_id         uuid REFERENCES auth_users(id) ON DELETE SET NULL,
    filename        text NOT NULL,
    mime_type       text NOT NULL,
    content         bytea NOT NULL,
    content_sha256  text NOT NULL,
    size_bytes      bigint NOT NULL,
    -- ADR-129: para jpg/png, lectura determinística vía ai_engine
    -- (/analyze_image -- pyzbar + pytesseract, ver image_analysis_client.cpp)
    -- ejecutada una sola vez al subir, para no repetir el costo de OCR en
    -- cada turno de chat que la referencia. NULL para docx/pptx/pdf (no
    -- aplica) o si la imagen no tenía QR/texto legible.
    ocr_text        text,
    qr_codes        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_chat_attachment_conversation
    ON support_chat_attachment (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_chat_attachment_tenant_time
    ON support_chat_attachment (tenant_id, created_at DESC);

COMMENT ON TABLE support_chat_attachment IS
    'Archivos adjuntados desde el widget de chat de soporte (SupportChatWidget.tsx) -- tipos permitidos: docx/pptx/pdf/jpg/png (validado en support_routes.cpp::handleUploadChatAttachment). Ligado a support_chat_message.conversation_id cuando existe. Descarga vía GET /api/support/chat/attachment/{id}, restringida al tenant_id de la sesión (mismo criterio anti-IDOR que tenant_assets_routes.cpp).';
COMMENT ON COLUMN support_chat_attachment.content_sha256 IS
    'SHA-256 hexadecimal calculado en C++ (openssl) sobre el binario original, no sobre el base64 -- permite detectar corrupción/duplicados sin depender de pgcrypto.';
