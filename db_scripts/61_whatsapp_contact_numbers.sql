-- ─────────────────────────────────────────────────────────────────────────
-- Números de contacto editables del bot de WhatsApp (ADR-114)
-- ─────────────────────────────────────────────────────────────────────────
-- Los números de escalamiento humano (soporte/comercial, ver
-- whatsapp_bot_engine.cpp) vivían solo en variables de entorno
-- (BEEMETRY_WHATSAPP_SUPPORT_TO_E164/_COMERCIAL_TO_E164) -- cambiarlos
-- requería editar el .env y reiniciar el backend. Esta tabla los vuelve
-- editables en caliente, desde la opción "Administración" del propio bot de
-- WhatsApp o desde el endpoint REST equivalente (RBAC soporte.manage). Las
-- variables de entorno siguen siendo el valor "de fábrica": si no hay fila
-- para una clave, el backend cae a ellas (ver getContactNumberPg en
-- support_storage_pg.cpp) -- ningún despliegue existente se rompe por esta
-- migración.
CREATE TABLE IF NOT EXISTS whatsapp_contact_number (
    contact_key text PRIMARY KEY,      -- 'soporte' | 'comercial'
    label       text NOT NULL,
    phone_e164  text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text NOT NULL          -- 'wa:<telefono_admin>' (bot) o username (API web)
);

COMMENT ON TABLE whatsapp_contact_number IS
    'Números de escalamiento humano del bot de WhatsApp, editables en caliente desde la opción "Administración" del bot (whatsapp_bot_engine.cpp, ADR-114) o desde PUT /api/support/whatsapp/contact-numbers/{key} (RBAC soporte.manage). Sin fila para una clave = se usa la variable de entorno correspondiente.';
COMMENT ON COLUMN whatsapp_contact_number.updated_by IS
    'Quién hizo el último cambio: "wa:<telefono>" si vino del bot (ver AppConfig::isWhatsappAdminPhone), o el username si vino de la API web.';
