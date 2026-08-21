-- ============================================================================
-- 52_rp_timetelemetry_integracion.sql
-- ADR-103 / SPEC-019 — Integración RP (TimeTelemetry/Odoo): réplica local de
-- maintenance.equipment, escritura durable vía XML-RPC, RBAC para el
-- frontend nuevo.
--
-- Reusa etl_sync_peer / etl_sync_state / etl_sync_run (db_scripts/18) —
-- misma convención que el peer de ThingsBoard (thingsboard_sync.cpp):
-- auth_config->>'kind' distingue el tipo de peer, la fila con credenciales
-- reales la carga el usuario/ops directamente en BD, NUNCA en este repo.
-- ============================================================================
BEGIN;

-- ── Bloque A — etl_sync_run: permitir el modo 'webhook_nudge' ──────────────
-- El CHECK original (db_scripts/18) solo admite 'bulk'|'incremental'|
-- 'realtime_forward' (pensado para ThingsBoard, que sí tiene WS). Odoo no
-- empuja nada — el webhook solo dispara una relectura puntual por XML-RPC,
-- que se audita como su propio modo en vez de sobrecargar 'incremental'.
ALTER TABLE etl_sync_run DROP CONSTRAINT IF EXISTS etl_sync_run_mode_check;
ALTER TABLE etl_sync_run ADD CONSTRAINT etl_sync_run_mode_check
    CHECK (mode IN ('bulk', 'incremental', 'realtime_forward', 'webhook_nudge'));

-- ── Bloque B — rp_equipment: réplica local de maintenance.equipment ────────
-- Híbrida: columnas promovidas (las que ya se sabe que se filtran/ordenan)
-- + raw_json con el registro Odoo completo, para que un campo nuevo esté
-- disponible sin migración (Art. "ampliación" del pedido original).
CREATE TABLE IF NOT EXISTS rp_equipment (
    equipment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    peer_id           UUID NOT NULL REFERENCES etl_sync_peer(peer_id) ON DELETE CASCADE,
    external_id       BIGINT,                    -- id de maintenance.equipment en Odoo; NULL
                                                   -- mientras sync_status='pending_push' en un
                                                   -- 'create' local todavía no confirmado (Postgres
                                                   -- permite múltiples NULL en UNIQUE, no colisiona)
    codigo            TEXT,                      -- campo 'codigo' (clave de negocio, ver RP/*.py)
    name              TEXT,
    category_id       BIGINT,
    category_name     TEXT,
    project_id        BIGINT,
    project_name      TEXT,
    state             TEXT,
    serial_no         TEXT,
    location          TEXT,
    latitude          DOUBLE PRECISION,
    longitude         DOUBLE PRECISION,
    assigned_user     TEXT,
    odoo_write_date   TIMESTAMPTZ,               -- watermark de origen a nivel de fila (debug/reconciliación)
    raw_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
    sync_status       TEXT NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'pending_push', 'push_failed')),
    last_sync_error   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (peer_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_rp_equipment_tenant ON rp_equipment (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rp_equipment_tenant_codigo ON rp_equipment (tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_rp_equipment_raw_json ON rp_equipment USING GIN (raw_json);

COMMENT ON TABLE rp_equipment IS
    'Réplica local de maintenance.equipment (TimeTelemetry/Odoo, ADR-103). '
    'Leída SIEMPRE desde storage::PgPool::replica() por el gateway REST — '
    'nunca proxy directo a Odoo. raw_json guarda el registro completo para '
    'extensibilidad sin migración; las columnas promovidas son las de uso '
    'frecuente (filtro/orden).';

-- ── Bloque C — rp_write_outbox: cola durable de escritura hacia Odoo ───────
-- Misma forma de columnas que org_notification_outbox (db_scripts/18), pero
-- con dueño real: org_notification_outbox no tiene consumidor en C++ (solo
-- poblada por triggers SQL, nunca leída) — no se reusa esa tabla para no
-- acoplarse a un patrón sin implementar en el otro extremo.
CREATE TABLE IF NOT EXISTS rp_write_outbox (
    outbox_id           BIGSERIAL PRIMARY KEY,
    tenant_id            UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    peer_id               UUID NOT NULL REFERENCES etl_sync_peer(peer_id) ON DELETE CASCADE,
    -- Siempre referencia la fila local (diseño "local-first": el POST/PUT del
    -- gateway inserta/actualiza rp_equipment PRIMERO -- con external_id NULL
    -- si es un alta nueva -- y recién después encola aquí; 'operation'
    -- distingue si Odoo necesita create o write, no la nulidad de esta FK).
    equipment_id          UUID NOT NULL REFERENCES rp_equipment(equipment_id) ON DELETE CASCADE,
    idempotency_key       UUID NOT NULL DEFAULT gen_random_uuid(),
    operation             TEXT NOT NULL CHECK (operation IN ('create', 'update')),
    payload_json          JSONB NOT NULL,        -- subset validado de campos escribibles
    status                TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
    attempts              SMALLINT NOT NULL DEFAULT 0,
    max_attempts          SMALLINT NOT NULL DEFAULT 8,
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error            TEXT,
    created_by_user_id    UUID,                  -- auditoría: sesión que originó el cambio
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at          TIMESTAMPTZ,
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rp_write_outbox_due
    ON rp_write_outbox (status, next_attempt_at)
    WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_rp_write_outbox_tenant ON rp_write_outbox (tenant_id);

COMMENT ON TABLE rp_write_outbox IS
    'Cola durable de escrituras pendientes de propagar a TimeTelemetry/Odoo '
    'por XML-RPC (ADR-103). Drenada por rp_odoo_sync.cpp: backoff exponencial '
    '+ jitter en next_attempt_at, dead-letter en status=''dead'' tras '
    'max_attempts. idempotency_key evita duplicar un create en reintento.';

-- ── Bloque D — RBAC: rp.equipment.view / rp.equipment.edit (patrón ADR-079) ─
INSERT INTO platform_permissions (code, module, description) VALUES
    ('rp.equipment.view', 'rp', 'Ver el catálogo de equipos replicado desde TimeTelemetry/RP'),
    ('rp.equipment.edit', 'rp', 'Crear/editar equipos, propagado a TimeTelemetry/RP por XML-RPC')
ON CONFLICT (code) DO NOTHING;

-- D.1 Default global: admin y manager ven; solo admin edita.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'admin', c FROM unnest(ARRAY['rp.equipment.view','rp.equipment.edit']) AS c
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'manager', 'rp.equipment.view'
ON CONFLICT DO NOTHING;

-- D.2 Propagación a tenants con matriz propia (mismo criterio que
-- db_scripts/50 bloque D.2 — sin esto, un tenant con override propio para
-- admin/manager nunca vería estos permisos nuevos).
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT DISTINCT rp.tenant_id, 'admin', c
FROM role_permissions rp
CROSS JOIN unnest(ARRAY['rp.equipment.view','rp.equipment.edit']) AS c
WHERE rp.tenant_id IS NOT NULL AND rp.role = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT DISTINCT rp.tenant_id, 'manager', 'rp.equipment.view'
FROM role_permissions rp
WHERE rp.tenant_id IS NOT NULL AND rp.role = 'manager'
ON CONFLICT DO NOTHING;

COMMIT;

-- ── Bloque E — cómo dar de alta el peer real (ejemplo, NO ejecutar tal cual) ─
-- La fila real la carga el usuario/ops, con la contraseña real de
-- TimeTelemetry, DIRECTO en BD — nunca en un script versionado (ver hallazgo
-- de seguridad en ADR-103: los scripts de referencia en RP/*.py tenían la
-- contraseña en texto plano).
--
-- INSERT INTO etl_sync_peer (tenant_id, name, base_url, auth_config, direction, is_active)
-- VALUES (
--     '<tenant_id real>',
--     'TimeTelemetry (Odoo 17)',
--     'https://sistema.timetelemetry.com',
--     jsonb_build_object(
--         'kind', 'timetelemetry',
--         'db', 'telemetry17',
--         'username', '<usuario real>',
--         'password', '<password real, rotada>'
--     ),
--     'bidirectional',
--     true
-- );
