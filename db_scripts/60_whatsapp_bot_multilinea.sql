-- ─────────────────────────────────────────────────────────────────────────
-- Multi-línea de WhatsApp (ADR-113)
-- ─────────────────────────────────────────────────────────────────────────
-- El bot conversacional (db_scripts/59_whatsapp_bot_reclamos.sql) asumía una
-- sola línea de WhatsApp conectada. Con varias líneas (soporte, comercial,
-- etc. -- ver whatsapp_webhook_routes.cpp/app_config.hpp) el mismo número de
-- cliente puede escribirle a más de una línea del negocio de forma
-- independiente, así que la conversación deja de poder identificarse solo
-- por phone_e164: se agrega line_id (id corto interno de la línea, ver
-- config::WhatsappLine) y se escopa por (phone_e164, line_id).
--
-- Idempotente (columnas con IF NOT EXISTS, constraint recreada solo si el
-- nombre por defecto de Postgres para la PK original sigue existiendo) --
-- mismo criterio de los demás scripts de este directorio.

ALTER TABLE whatsapp_conversation
    ADD COLUMN IF NOT EXISTS line_id text NOT NULL DEFAULT 'default';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'whatsapp_conversation_pkey'
          AND conrelid = 'whatsapp_conversation'::regclass
          AND array_length(conkey, 1) = 1
    ) THEN
        ALTER TABLE whatsapp_conversation DROP CONSTRAINT whatsapp_conversation_pkey;
        ALTER TABLE whatsapp_conversation ADD CONSTRAINT whatsapp_conversation_pkey
            PRIMARY KEY (phone_e164, line_id);
    END IF;
END $$;

COMMENT ON COLUMN whatsapp_conversation.line_id IS
    'Id corto de la línea de WhatsApp que sostiene esta conversación (ADR-113): "default", "soporte", "comercial", etc. -- ver config::WhatsappLine. Junto con phone_e164 forma la clave primaria: el mismo número de cliente puede tener una conversación independiente por línea.';

ALTER TABLE whatsapp_message_log
    ADD COLUMN IF NOT EXISTS line_id text NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_line
    ON whatsapp_message_log (line_id, created_at DESC);

COMMENT ON COLUMN whatsapp_message_log.line_id IS
    'Línea de WhatsApp por la que entró/salió este mensaje (ADR-113) -- auditoría de qué número atendió cada turno.';
