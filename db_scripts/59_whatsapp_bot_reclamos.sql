-- ============================================================================
-- 59 — Chatbot conversacional de WhatsApp Business (Meta) + gestión de reclamos
-- ============================================================================
-- Hasta ahora el backend solo sabía ENVIAR una plantilla fija de WhatsApp
-- (escalamiento de soporte, ver whatsapp_client.cpp) -- no existía webhook de
-- entrada ni ningún estado de conversación. Este script agrega el esquema
-- para el bot real: estado por número (menú/sub-flujo), log crudo de cada
-- mensaje entrante/saliente (auditoría, mismo espíritu que platform_audit_log
-- -- "nada debe quedar al aire") y el registro de reclamos/solicitudes con
-- código de seguimiento consultable después, desde WhatsApp o desde
-- GET /api/support/tickets/{code}.

-- ─────────────────────── Conversación de WhatsApp (estado) ──────────────────
-- Un número de teléfono E.164 (sin '+') = una conversación con estado propio.
-- No hay sesión autenticada del lado del usuario de WhatsApp -- tenant_id es
-- opcional y solo se llena si el flujo llegó a identificar una empresa real.
CREATE TABLE IF NOT EXISTS whatsapp_conversation (
    phone_e164      text PRIMARY KEY,
    state           text NOT NULL DEFAULT 'MENU_ROOT',
    context         jsonb NOT NULL DEFAULT '{}'::jsonb,
    tenant_id       uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_last_message
    ON whatsapp_conversation (last_message_at);

COMMENT ON TABLE whatsapp_conversation IS
    'Estado del menú/sub-flujo del bot de WhatsApp por número E.164. Se resetea a MENU_ROOT cuando last_message_at excede el timeout de inactividad (ver whatsapp_bot_engine).';
COMMENT ON COLUMN whatsapp_conversation.context IS
    'Respuestas parciales del sub-flujo actual (p.ej. {"nombre":"...","empresa":"..."}) -- se limpia al volver a MENU_ROOT.';

-- ───────────────────────── Auditoría cruda de mensajes ──────────────────────
-- Cada mensaje entrante y cada respuesta saliente del bot, sin excepción --
-- esto es lo que garantiza que "nada quede al aire": cualquier conversación
-- completa se puede reconstruir leyendo esta tabla.
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_e164    text NOT NULL,
    direction     text NOT NULL CHECK (direction IN ('in', 'out')),
    message_type  text NOT NULL, -- text | interactive_list | interactive_buttons | template
    payload       jsonb NOT NULL,
    wa_message_id text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_phone_time
    ON whatsapp_message_log (phone_e164, created_at DESC);

COMMENT ON TABLE whatsapp_message_log IS
    'Log crudo (auditoría) de cada mensaje entrante/saliente del bot de WhatsApp -- entrante desde el webhook, saliente desde whatsapp_client.';

-- ───────────────────────────── Reclamos / tickets ────────────────────────────
-- Cubre las 4 categorías del menú que terminan en un registro accionable:
-- soporte, comercial, reclamo y agenda (visita técnica) -- una sola tabla,
-- sin duplicar esquema por categoría (se distinguen por `category`).
CREATE TABLE IF NOT EXISTS support_ticket (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL,
    channel      text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'web')),
    category     text NOT NULL CHECK (category IN ('soporte', 'comercial', 'reclamo', 'agenda')),
    phone_e164   text,
    contact_name text,
    tenant_id    uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    subject      text,
    description  text NOT NULL,
    status       text NOT NULL DEFAULT 'abierto'
                 CHECK (status IN ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
    priority     text NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_ticket_code ON support_ticket (code);
CREATE INDEX IF NOT EXISTS idx_support_ticket_phone ON support_ticket (phone_e164);
CREATE INDEX IF NOT EXISTS idx_support_ticket_tenant_created
    ON support_ticket (tenant_id, created_at DESC);

COMMENT ON TABLE support_ticket IS
    'Registro accionable de soporte/comercial/reclamo/agenda, con código de seguimiento legible (ver generate_support_ticket_code). Consultable sin autenticación por código vía GET /api/support/tickets/{code}.';

-- Línea de tiempo de cada ticket (creación + cada cambio de estado) -- mismo
-- espíritu que platform_audit_log, acotado a este dominio.
CREATE TABLE IF NOT EXISTS support_ticket_event (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id  uuid NOT NULL REFERENCES support_ticket(id) ON DELETE CASCADE,
    event_type text NOT NULL, -- created | status_changed | note
    detail     text,
    actor      text, -- 'bot' | username del agente que actualizó el estado
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_event_ticket
    ON support_ticket_event (ticket_id, created_at);

-- ───────────────────────── Generador de código de ticket ────────────────────
-- Formato: {PREFIJO}-{YYYYMMDD}-{correlativo de 4 dígitos}. Un solo contador
-- global (no por categoría/día) para no requerir partición dinámica de
-- secuencia -- la fecha en el propio código ya da unicidad legible por día.
CREATE SEQUENCE IF NOT EXISTS support_ticket_code_seq;

CREATE OR REPLACE FUNCTION generate_support_ticket_code(p_category text)
RETURNS text AS $$
DECLARE
    v_prefix text;
BEGIN
    v_prefix := CASE p_category
        WHEN 'soporte'   THEN 'SOP'
        WHEN 'comercial' THEN 'COM'
        WHEN 'reclamo'   THEN 'RCL'
        WHEN 'agenda'    THEN 'AGE'
        ELSE 'TCK'
    END;
    RETURN v_prefix || '-' || to_char(now(), 'YYYYMMDD') || '-' ||
           lpad(nextval('support_ticket_code_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────── RBAC ────────────────────────────────────────
-- Gestión interna de tickets (PATCH .../status): mismo catálogo/matriz que
-- db_scripts/42-43 -- se agrega un permiso nuevo, sin tocar los existentes.
INSERT INTO platform_permissions (code, module, description) VALUES
    ('soporte.manage', 'soporte', 'Gestionar tickets de soporte/comercial/reclamos/agenda (cambiar estado)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, 'soporte.manage' FROM unnest(ARRAY['admin', 'manager', 'supervisor']) AS r(role)
ON CONFLICT DO NOTHING;
