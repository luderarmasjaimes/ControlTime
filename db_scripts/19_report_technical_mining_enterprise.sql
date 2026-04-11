-- =============================================================================
-- 19_report_technical_mining_enterprise.sql
-- Informe técnico minero (ReportStudio / editor rico): permisos por perfil/ACL,
-- grupos, envío a revisión/aprobación, exportaciones (Word/PDF/PPT/MP4),
-- asistentes IA, auditoría biométrica / autorización remota en acciones de riesgo.
--
-- Prerrequisitos: 01_init, 03_auth_biometric, 05_reports_admin, 16 (tenants, authz_case),
--                 18 (org_notification_outbox opcional para trazabilidad manual)
-- =============================================================================

BEGIN;

-- Columnas de 05_reports_admin requeridas para índices y API (idempotente)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS company_name VARCHAR(180);

-- ---------------------------------------------------------------------------
-- reports: política de riesgo, clasificación, coherencia multitenant
-- ---------------------------------------------------------------------------
ALTER TABLE reports ADD COLUMN IF NOT EXISTS subtitle TEXT;
-- tenant_id en reports: ya añadido en migración 16 si aplica
ALTER TABLE reports ADD COLUMN IF NOT EXISTS tenant_id UUID
    REFERENCES tenants(tenant_id) ON DELETE SET NULL;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS security_classification TEXT
    DEFAULT 'internal';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS editor_format TEXT NOT NULL DEFAULT 'reportstudio_v2';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS sharing_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (sharing_visibility IN ('private', 'tenant', 'custom_acl'));

ALTER TABLE reports ADD COLUMN IF NOT EXISTS risk_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN reports.risk_policy IS
    'JSON: p.ej. {"modify_requires_biometric":true,"delete_requires_biometric":true,"delete_requires_remote_auth":"required"}';

ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_assist_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN reports.ai_assist_prefs IS
    'Preferencias: ortografía, voz, modelo genérico vs fine-tuned (ids), idioma revisión.';

ALTER TABLE reports ADD COLUMN IF NOT EXISTS layout_template_key TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS last_sensitive_action_at TIMESTAMPTZ;

COMMENT ON COLUMN reports.tenant_id IS
    'Alinear con company_name y sec_*; obligatorio en despliegue multitenant estricto.';

CREATE INDEX IF NOT EXISTS idx_reports_tenant_status ON reports (tenant_id, status)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Ajustes de documento: cabeceras, pies, carátula, marcas de agua, márgenes
-- (contenido sigue en content_json; aquí metadatos estructurados para export)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_document_settings (
    report_id UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    header_footer_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    cover_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    watermark_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    page_setup_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trg_report_document_settings_touch()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_document_settings_touch ON report_document_settings;
CREATE TRIGGER trg_report_document_settings_touch
    BEFORE UPDATE ON report_document_settings
    FOR EACH ROW
    EXECUTE FUNCTION trg_report_document_settings_touch();

-- ---------------------------------------------------------------------------
-- Versiones de contenido completas (historial al guardar)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_content_revision (
    revision_id BIGSERIAL PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    content_json JSONB NOT NULL,
    editor_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_summary TEXT,
    UNIQUE (report_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_report_revision_report_time
    ON report_content_revision (report_id, created_at DESC);

COMMENT ON TABLE report_content_revision IS
    'Snapshot del documento al guardar; la versión vigente sigue en reports.content_json.';

-- ---------------------------------------------------------------------------
-- Activos embebidos (imágenes, mapas, diagramas) — URI + hash, no BLOB en fila por defecto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_embedded_asset (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    asset_kind TEXT NOT NULL
        CHECK (asset_kind IN (
            'image', 'photo', 'diagram', 'map', 'dashboard_snapshot', 'chart', 'other'
        )),
    storage_uri TEXT NOT NULL,
    content_sha256 TEXT,
    mime_type TEXT,
    width_px INT,
    height_px INT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_asset_report ON report_embedded_asset (report_id);

-- ---------------------------------------------------------------------------
-- Grupos de colaboración del informe (minera); miembros = auth_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_share_group (
    group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS report_share_group_member (
    group_id UUID NOT NULL REFERENCES report_share_group(group_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_report_share_group_tenant ON report_share_group (tenant_id);

-- ---------------------------------------------------------------------------
-- ACL explícita por informe (custom_acl); si sharing_visibility = tenant, app puede ignorar filas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_acl (
    acl_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES report_share_group(group_id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    can_share BOOLEAN NOT NULL DEFAULT FALSE,
    can_export BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    can_comment BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    CHECK (
        (user_id IS NOT NULL AND group_id IS NULL)
        OR (user_id IS NULL AND group_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_acl_user ON report_acl (report_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_acl_group ON report_acl (report_id, group_id)
    WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_acl_report ON report_acl (report_id);

COMMENT ON TABLE report_acl IS
    'Permisos finos por usuario o grupo; combinar con sec_permission y roles en middleware C++.';

-- ---------------------------------------------------------------------------
-- Envío a revisión / aprobación / aviso (personas o grupos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_submission (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('for_review', 'for_approval', 'announcement', 'legal_notice')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'completed', 'cancelled', 'expired')),
    instructions TEXT,
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    authz_case_id UUID REFERENCES authz_case(case_id) ON DELETE SET NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_report_submission_report ON report_submission (report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_submission_recipient (
    id BIGSERIAL PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES report_submission(submission_id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES report_share_group(group_id) ON DELETE CASCADE,
    role TEXT NOT NULL
        CHECK (role IN ('reviewer', 'approver', 'cc', 'notify_only')),
    decision TEXT NOT NULL DEFAULT 'pending'
        CHECK (decision IN ('pending', 'approved', 'rejected', 'delegated', 'skipped')),
    decided_at TIMESTAMPTZ,
    comment TEXT,
    notify_channel_prefs TEXT[],
    last_notified_at TIMESTAMPTZ,
    CHECK (
        (user_id IS NOT NULL AND group_id IS NULL)
        OR (user_id IS NULL AND group_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_report_submission_rec_sub ON report_submission_recipient (submission_id);

-- ---------------------------------------------------------------------------
-- Exportaciones: Word, PDF, PowerPoint, vídeo MP4
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_export_job (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    export_format TEXT NOT NULL
        CHECK (export_format IN ('docx', 'pdf', 'pptx', 'mp4', 'html', 'odt')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    storage_uri TEXT,
    error_message TEXT,
    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    content_revision_id BIGINT REFERENCES report_content_revision(revision_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_report_export_report ON report_export_job (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_export_status ON report_export_job (status) WHERE status IN ('queued', 'running');

-- ---------------------------------------------------------------------------
-- IA: ortografía, voz a texto, revisión, recomendaciones (genérico / modelo propio)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_ai_run (
    run_id BIGSERIAL PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    run_type TEXT NOT NULL
        CHECK (run_type IN (
            'spellcheck',
            'voice_to_text',
            'doc_review',
            'generic_recommend',
            'fine_tuned_recommend',
            'other'
        )),
    model_id TEXT,
    provider TEXT,
    input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    tokens_prompt INT,
    tokens_completion INT
);

CREATE INDEX IF NOT EXISTS idx_report_ai_report ON report_ai_run (report_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Auditoría: biométrica + autorización remota antes de modificar/eliminar/etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_sensitive_action_log (
    log_id BIGSERIAL PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    action TEXT NOT NULL
        CHECK (action IN ('modify', 'delete', 'export_critical', 'approve', 'acl_change')),
    biometric_verified BOOLEAN NOT NULL DEFAULT FALSE,
    biometric_method TEXT,
    biometric_at TIMESTAMPTZ,
    remote_authz_case_id UUID REFERENCES authz_case(case_id) ON DELETE SET NULL,
    remote_authz_granted BOOLEAN,
    client_ip INET,
    user_agent TEXT,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_sensitive_report ON report_sensitive_action_log (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_sensitive_user ON report_sensitive_action_log (user_id, created_at DESC);

COMMENT ON TABLE report_sensitive_action_log IS
    'Registro de desafío biométrico y flujo authz_case para operaciones de riesgo; la app debe insertar antes/después de la acción.';

-- ---------------------------------------------------------------------------
-- Permisos de catálogo (combinar con report_acl y roles)
-- ---------------------------------------------------------------------------
INSERT INTO sec_permission (code, description_key, category)
SELECT * FROM (VALUES
    ('reports.acl.manage', 'perm.reports.acl', 'reports'),
    ('reports.submit.workflow', 'perm.reports.workflow', 'reports'),
    ('reports.export', 'perm.reports.export', 'reports'),
    ('reports.ai.use', 'perm.reports.ai', 'reports'),
    ('reports.delete.protected', 'perm.reports.delete.protected', 'reports')
) AS v(code, description_key, category)
WHERE NOT EXISTS (SELECT 1 FROM sec_permission p WHERE p.code = v.code);

COMMIT;
