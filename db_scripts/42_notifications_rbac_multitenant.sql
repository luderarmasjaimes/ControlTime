-- ============================================================================
-- 42 — Notificaciones de alarmas multi-canal + RBAC multitenant granular
-- ============================================================================

-- ────────────────────────── Canales de notificación ─────────────────────────
-- WebSocket NO se configura aquí: es implícito (toda sesión WS del tenant
-- recibe el push de alarma siempre). email/webhook son canales salientes
-- configurables por tenant. webhook cubre genéricamente Slack/Teams/Telegram/
-- WhatsApp Business API (todos aceptan un POST JSON a una URL).
CREATE TABLE IF NOT EXISTS notification_channels (
    channel_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    channel_type text NOT NULL CHECK (channel_type IN ('email', 'webhook')),
    label        text NOT NULL,
    -- email: {"to": "guardia@minera.com"} ; webhook: {"url": "https://..."}
    config       jsonb NOT NULL,
    -- Umbral mínimo de severidad para disparar este canal (info<warning<high<critical)
    min_severity text NOT NULL DEFAULT 'warning'
                 CHECK (min_severity IN ('info', 'warning', 'high', 'critical')),
    enabled      boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_channels_tenant
    ON notification_channels (tenant_id) WHERE enabled;

-- Trazabilidad de cada intento de notificación (auditable, complementa el
-- platform_audit_log — aquí va el detalle operativo por canal/intento).
CREATE TABLE IF NOT EXISTS notification_log (
    log_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alarm_id     bigint,
    tenant_id    uuid,
    channel_id   uuid,          -- NULL = broadcast WebSocket
    channel_type text NOT NULL, -- websocket | email | webhook
    event_type   text NOT NULL, -- triggered | resolved
    status       text NOT NULL CHECK (status IN ('sent', 'failed')),
    detail       text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_tenant_time
    ON notification_log (tenant_id, created_at DESC);

-- ───────────────────────── RBAC multitenant granular ────────────────────────
-- Rol POR TENANT: hasta ahora el rol vivía solo en auth_users (global). Un
-- mismo usuario puede ser admin en una unidad minera y operador en otra.
-- NULL = hereda el rol global de auth_users.role (compatibilidad total).
ALTER TABLE auth_user_tenant ADD COLUMN IF NOT EXISTS role text
    CHECK (role IS NULL OR role IN ('admin', 'manager', 'operator', 'viewer'));

-- Catálogo de permisos de la plataforma (módulo.acción).
CREATE TABLE IF NOT EXISTS platform_permissions (
    code        text PRIMARY KEY,
    module      text NOT NULL,
    description text NOT NULL
);
INSERT INTO platform_permissions (code, module, description) VALUES
    ('mapas.view',         'mapas',        'Ver mapas operacionales y capas GIS'),
    ('informes.view',      'informes',     'Ver informes técnicos'),
    ('informes.edit',      'informes',     'Crear y editar informes'),
    ('informes.sign',      'informes',     'Firmar/aprobar informes (workflow ADR-017)'),
    ('alarmas.view',       'alarmas',      'Ver alarmas y su historial'),
    ('alarmas.manage',     'alarmas',      'Crear/editar reglas de alarma y canales de notificación'),
    ('dispositivos.view',  'dispositivos', 'Ver dispositivos/sensores registrados'),
    ('dispositivos.manage','dispositivos', 'Registrar/revocar dispositivos y fuentes de protocolo'),
    ('telemetria.view',    'telemetria',   'Ver telemetría en vivo y dashboards'),
    ('formula.view',       'formula',      'Ver diagramas del motor FORMULA'),
    ('formula.edit',       'formula',      'Editar diagramas/reglas FORMULA'),
    ('usuarios.manage',    'usuarios',     'Gestionar usuarios del tenant'),
    ('permisos.manage',    'permisos',     'Editar la matriz de permisos del tenant')
ON CONFLICT (code) DO NOTHING;

-- Matriz rol → permisos. tenant_id NULL = default global de la plataforma;
-- si un tenant tiene AL MENOS UNA fila para un rol, sus filas REEMPLAZAN el
-- default global para ese rol (override completo, no mezcla — semántica
-- simple de razonar y auditar).
CREATE TABLE IF NOT EXISTS role_permissions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       uuid REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('admin','manager','operator','viewer')),
    permission_code text NOT NULL REFERENCES platform_permissions(code) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique
    ON role_permissions (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), role, permission_code);

-- Defaults globales (tenant_id NULL). admin = todo; manager = operación
-- completa sin administración de usuarios/permisos; operator = trabajo de
-- campo (ver + editar informes); viewer = solo lectura.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, p.code FROM platform_permissions p
CROSS JOIN (VALUES ('admin')) AS r(role)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'manager', c FROM unnest(ARRAY[
    'mapas.view','informes.view','informes.edit','informes.sign',
    'alarmas.view','alarmas.manage','dispositivos.view','dispositivos.manage',
    'telemetria.view','formula.view','formula.edit'
]) AS c ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'operator', c FROM unnest(ARRAY[
    'mapas.view','informes.view','informes.edit',
    'alarmas.view','dispositivos.view','telemetria.view','formula.view'
]) AS c ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'viewer', c FROM unnest(ARRAY[
    'mapas.view','informes.view','alarmas.view','dispositivos.view',
    'telemetria.view','formula.view'
]) AS c ON CONFLICT DO NOTHING;

COMMENT ON TABLE role_permissions IS
    'Matriz RBAC. tenant_id NULL = default de plataforma; filas por tenant hacen override COMPLETO del rol para ese tenant. Editada vía /api/auth/permissions/matrix (permiso permisos.manage).';
