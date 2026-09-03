-- ============================================================================
-- 86 — Envío de informes + API de notificaciones multi-canal (2026-08-29)
-- ============================================================================
-- Contexto (reporte del usuario): el dueño de un informe no podía reabrirlo
-- para editar aunque fuera el autor -- causa raíz: reports.created_by
-- (agregada en 05_reports_admin.sql) nunca se llenaba ni se leía, así que
-- ReportsAdminModal.tsx::canEdit() (que compara report.createdBy contra el
-- usuario de sesión) siempre daba falso para el propio autor. Ya corregido
-- en report_service.cpp (createReportPg/updateReportPg ahora sí escriben
-- created_by/last_modified_by/reviewed_by). Esta migración cubre lo que
-- necesitaba cambios de esquema: el backfill de informes preexistentes, la
-- trazabilidad de la nueva API de notificaciones, y los permisos nuevos.

-- ── 1) Backfill: informes creados ANTES de este fix quedaron con
--    created_by/last_modified_by en NULL para siempre (el INSERT nunca los
--    llenó). Se reconstruye el autor real a partir de quién generó la
--    PRIMERA revisión de contenido (report_content_revision.created_by,
--    version_number=1) -- la única fuente que sí registró autoría desde el
--    principio. Sin este backfill, los informes existentes seguirían
--    bloqueados para su dueño real después de desplegar el fix.
UPDATE reports r
SET created_by = sub.created_by,
    last_modified_by = COALESCE(r.last_modified_by, sub.created_by)
FROM (
    SELECT DISTINCT ON (report_id) report_id, created_by
    FROM report_content_revision
    WHERE version_number = 1 AND created_by IS NOT NULL
    ORDER BY report_id, revision_id
) sub
WHERE r.id = sub.report_id AND r.created_by IS NULL;

-- ── 2) Trazabilidad de la API de notificaciones (notify/notify_service.cpp).
-- Separada de `notification_log` (db_scripts/42, mining/alarm_notifier.cpp):
-- esa tabla exige `alarm_id` y está modelada específicamente para eventos de
-- alarma; un envío de este módulo (p.ej. "te compartieron un informe") no
-- tiene ninguna alarma detrás. `source_app` es lo que hace esta API
-- reutilizable para cualquier app de la empresa (otro frontend, una app de
-- smartphone, etc.) -- cada caller se identifica ahí.
CREATE TABLE IF NOT EXISTS notification_dispatch_log (
    log_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_app   text NOT NULL,
    channel      text NOT NULL,   -- in_app | email | whatsapp | sms
    recipient    text,            -- user_id (in_app) o email/teléfono (los demás canales)
    status       text NOT NULL CHECK (status IN ('sent', 'failed')),
    detail       text,
    related_type text,            -- p.ej. 'report'
    related_id   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_time
    ON notification_dispatch_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_related
    ON notification_dispatch_log (related_type, related_id);

COMMENT ON TABLE notification_dispatch_log IS
    'Trazabilidad de cada intento de POST /api/notifications/send y POST /api/reports/{id}/share, canal por canal. Ver notify/notify_service.cpp.';

-- ── 3) Permisos nuevos ────────────────────────────────────────────────────
INSERT INTO platform_permissions (code, module, description) VALUES
    ('informes.share',      'informes',       'Enviar informes a otros usuarios de la unidad (crea report_shares + notifica)'),
    ('notificaciones.send', 'notificaciones', 'Disparar notificaciones multi-canal a otros usuarios vía POST /api/notifications/send')
ON CONFLICT (code) DO NOTHING;

-- Mismo criterio que informes.view/informes.edit (db_scripts/16 y 43): todo
-- rol que puede VER informes puede compartirlos y notificar, salvo 'viewer'
-- (rol de solo lectura, p.ej. auditores externos -- no debe poder iniciar
-- notificaciones hacia otros usuarios).
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, p.code
FROM unnest(ARRAY['admin', 'manager', 'supervisor', 'geologist', 'safety', 'operator']) AS r(role)
CROSS JOIN unnest(ARRAY['informes.share', 'notificaciones.send']) AS p(code)
ON CONFLICT DO NOTHING;
