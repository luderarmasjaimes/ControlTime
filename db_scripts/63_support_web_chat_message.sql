-- ─────────────────────────────────────────────────────────────────────────
-- 63 — Persistencia del chat web (widget SupportChatWidget) + canal (ADR-116/117)
-- ─────────────────────────────────────────────────────────────────────────
-- El chatbot IA del widget web (mining_chatbot_service.cpp) nunca persistió
-- nada: el historial vivía solo en memoria del navegador, se perdía al
-- recargar y no había forma de auditarlo ni buscarlo. A diferencia del bot de
-- WhatsApp (whatsapp_message_log), acá el interlocutor es un usuario
-- AUTENTICADO de un tenant real -- no un teléfono. Se usa una tabla nueva en
-- vez de generalizar whatsapp_message_log porque esa tabla tiene
-- phone_e164/direction/line_id como identidad obligatoria (NOT NULL) sin
-- tenant_id/user_id, y su payload jsonb guarda el formato crudo de Meta
-- (interactive/template) -- forzar el mismo esquema hubiera significado
-- columnas nullable a medias en una tabla que hoy es un log de auditoría
-- estricto. Ver ADR-116.
--
-- `channel` (ADR-117): de qué app vino el mensaje -- 'HomeMinero' (la propia
-- plataforma web, valor por defecto) o 'MovilMinero' (terminal de campo,
-- app futura fuera de este repo). El backend ya valida y persiste el valor
-- aunque hoy solo HomeMinero lo use en producción.
CREATE TABLE IF NOT EXISTS support_chat_message (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL,
    tenant_id       uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    user_id         uuid REFERENCES auth_users(id) ON DELETE SET NULL,
    channel         text NOT NULL DEFAULT 'HomeMinero' CHECK (channel IN ('HomeMinero', 'MovilMinero')),
    role            text NOT NULL CHECK (role IN ('user', 'assistant')),
    content         text NOT NULL,
    intent          text, -- chat | summarize | expand | ideas (ver ChatIntent, mining_chatbot_service.hpp)
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_chat_message_conversation
    ON support_chat_message (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_chat_message_tenant_time
    ON support_chat_message (tenant_id, created_at DESC);

COMMENT ON TABLE support_chat_message IS
    'Historial persistente del chatbot web (SupportChatWidget.tsx) por conversación/tenant/usuario -- antes solo vivía en memoria del navegador. Separada de whatsapp_message_log a propósito (ver ADR-116): esa tabla es un log crudo de auditoría anónimo por teléfono (sin tenant_id/user_id), esta es un historial de conversación por tenant/usuario autenticado. Buscable desde GET /api/support/admin/chat-messages (RBAC soporte.view/soporte.manage).';
COMMENT ON COLUMN support_chat_message.conversation_id IS
    'Agrupa los turnos de una misma sesión de widget -- generado server-side en el primer turno si el cliente no manda uno, devuelto en la respuesta para que el frontend lo reenvíe en turnos siguientes.';
COMMENT ON COLUMN support_chat_message.channel IS
    'Canal de origen del mensaje: HomeMinero (plataforma web actual) o MovilMinero (terminal de campo, app futura). Ver docs/decisions/117.';
