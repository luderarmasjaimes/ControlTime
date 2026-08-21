-- ─────────────────────────────────────────────────────────────────────────
-- 71 — Postulaciones de CV desde el widget web (ADR-129) + soporte PPTX
-- ─────────────────────────────────────────────────────────────────────────
-- cv_submission (db_scripts/69) nació moldeada 100% al canal WhatsApp:
-- phone_e164/line_id NOT NULL, sin channel ni user_id. El widget de chat
-- (SupportChatWidget.tsx) ahora también permite adjuntar un CV (Word/PDF/
-- PowerPoint) para el flujo de Recursos Humanos -- un usuario autenticado
-- de la plataforma, sin número de WhatsApp que registrar. Mismo criterio ya
-- usado para support_ticket/support_chat_message (columna `channel`): en vez
-- de una tabla paralela, se relaja el esquema existente para aceptar ambos
-- orígenes sin perder ninguna fila previa (columnas nuevas, migración
-- idempotente).
ALTER TABLE cv_submission
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'web')),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth_users(id) ON DELETE SET NULL;

ALTER TABLE cv_submission ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE cv_submission ALTER COLUMN line_id DROP NOT NULL;

-- Amplía el CHECK de mime_type para aceptar PowerPoint (ADR-129,
-- /extract_cv_text ya soporta .pptx vía python-pptx en ai_engine) -- se
-- busca el nombre real de la constraint en vez de asumirlo, para no fallar
-- si Postgres la generó con un nombre distinto al esperado por convención.
DO $$
DECLARE
  existing_conname text;
BEGIN
  SELECT c.conname INTO existing_conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'cv_submission' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%mime_type%';
  IF existing_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cv_submission DROP CONSTRAINT %I', existing_conname);
  END IF;
END $$;

ALTER TABLE cv_submission ADD CONSTRAINT cv_submission_mime_type_check CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
));

COMMENT ON COLUMN cv_submission.channel IS
    'Origen de la postulación: whatsapp (bot, ver whatsapp_bot_engine.cpp) o web (widget de chat autenticado, ver support_routes.cpp::handleSubmitWebCv). phone_e164/line_id quedan NULL para channel=web.';
COMMENT ON COLUMN cv_submission.user_id IS
    'Usuario autenticado que subió el CV desde el widget web -- NULL para postulaciones de WhatsApp (sin sesión).';
