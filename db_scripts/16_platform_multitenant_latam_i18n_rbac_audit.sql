-- =============================================================================
-- 16_platform_multitenant_latam_i18n_rbac_audit.sql
-- Multitenant (UUID tenants), LATAM/North America países, i18n, RBAC,
-- auditoría de plataforma (inspirado en ThingsBoard audit_log / alarm),
-- flujos de autorización local/remota, registro ETL/jobs y enlaces minería↔IoT v2.
--
-- Prerrequisitos: 01_init, 03_auth_biometric, 04_telemetry_schema_v2, 09_formula_mining_reports
-- Idempotente: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Catálogo geográfico (multi-país por tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref_country (
    iso2 CHAR(2) PRIMARY KEY,
    iso3 CHAR(3),
    region TEXT NOT NULL DEFAULT 'americas', -- americas | emea | apac ...
    name_en TEXT NOT NULL,
    name_es TEXT,
    default_locale TEXT NOT NULL DEFAULT 'en-US', -- BCP 47 sugerido
    currency_code CHAR(3),
    phone_prefix TEXT
);

CREATE TABLE IF NOT EXISTS ref_locale (
    locale_tag TEXT PRIMARY KEY, -- BCP 47: es-419, es-MX, en-US, fr-CA
    language_iso2 CHAR(2) NOT NULL,
    country_iso2 CHAR(2) REFERENCES ref_country(iso2) ON DELETE SET NULL,
    display_name_en TEXT,
    display_name_native TEXT,
    is_rtl BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tenant_country (
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    country_iso2 CHAR(2) NOT NULL REFERENCES ref_country(iso2) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    legal_entity_name TEXT,
    tax_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS idx_tenant_country_primary
    ON tenant_country (tenant_id) WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- i18n (mensajes UI / permisos / catálogos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS i18n_entry (
    id BIGSERIAL PRIMARY KEY,
    msg_namespace TEXT NOT NULL DEFAULT 'app',
    msg_key TEXT NOT NULL,
    locale TEXT NOT NULL,
    msg_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (msg_namespace, msg_key, locale)
);

CREATE INDEX IF NOT EXISTS idx_i18n_lookup ON i18n_entry (msg_namespace, msg_key);

-- ---------------------------------------------------------------------------
-- Tenants: locale por defecto y vínculo geográfico explícito
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'es-419';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_country_iso2 CHAR(2)
    REFERENCES ref_country(iso2) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.default_locale IS 'BCP 47; preferencia UI y formatos para el tenant.';
COMMENT ON COLUMN tenants.primary_country_iso2 IS 'País principal de constitución legal / facturación.';

-- ---------------------------------------------------------------------------
-- Proyectos e informes: tenant explícito (coherencia multitenant)
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id UUID
    REFERENCES tenants(tenant_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects (tenant_id);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS tenant_id UUID
    REFERENCES tenants(tenant_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_tenant ON reports (tenant_id);

COMMENT ON COLUMN reports.tenant_id IS 'Redundante respecto a company_name para consultas rápidas; mantener alineado en aplicación.';

-- ---------------------------------------------------------------------------
-- Minería FORMULA ↔ modelo IoT v2 (sin FK cruzada entre mundos distintos)
-- ---------------------------------------------------------------------------
ALTER TABLE mineria_empresas ADD COLUMN IF NOT EXISTS tenant_id UUID
    REFERENCES tenants(tenant_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mineria_empresas_tenant ON mineria_empresas (tenant_id);

ALTER TABLE mineria_minas ADD COLUMN IF NOT EXISTS site_id UUID
    REFERENCES sites(site_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mineria_minas_site ON mineria_minas (site_id);

COMMENT ON COLUMN mineria_empresas.tenant_id IS 'Enlaza empresa minera lógica con tenants.tenant_id (IoT v2).';
COMMENT ON COLUMN mineria_minas.site_id IS 'Enlaza mina con sites.site_id (telemetría v2).';

-- ---------------------------------------------------------------------------
-- Usuario ↔ tenants (un usuario puede operar varios clientes / países)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_user_tenant (
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    preferred_locale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_tenant_default
    ON auth_user_tenant (user_id) WHERE is_default = TRUE;

-- ---------------------------------------------------------------------------
-- RBAC (permisos finos + roles por tenant; NULL tenant = plantilla global)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sec_permission (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description_key TEXT,
    category TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS sec_role (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role_code TEXT NOT NULL,
    display_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sec_role_global_code
    ON sec_role (role_code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sec_role_tenant_code
    ON sec_role (tenant_id, role_code) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sec_role_permission (
    role_id UUID NOT NULL REFERENCES sec_role(role_id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES sec_permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth_user_role (
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES sec_role(role_id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, tenant_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_role_user ON auth_user_role (user_id, tenant_id);

-- ---------------------------------------------------------------------------
-- Auditoría de plataforma (todas las áreas; complementa auth_audit_logs)
-- Inspiración: ThingsBoard audit_log (tenant, usuario, acción, entidad, payload)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    username TEXT,
    session_id TEXT,
    action_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    request_path TEXT,
    source_ip INET,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    success BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_time ON platform_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_tenant_time ON platform_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_user_time ON platform_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_log (action_type, created_at DESC);

CREATE OR REPLACE FUNCTION fn_platform_audit_insert(
    p_tenant_id UUID,
    p_user_id UUID,
    p_username TEXT,
    p_action_type TEXT,
    p_entity_type TEXT,
    p_entity_id TEXT,
    p_request_path TEXT,
    p_source_ip INET,
    p_detail JSONB,
    p_success BOOLEAN DEFAULT TRUE,
    p_session_id TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO platform_audit_log (
        tenant_id, user_id, username, session_id, action_type,
        entity_type, entity_id, request_path, source_ip, detail, success
    ) VALUES (
        p_tenant_id, p_user_id, p_username, p_session_id, p_action_type,
        p_entity_type, p_entity_id, p_request_path, p_source_ip,
        COALESCE(p_detail, '{}'::jsonb), COALESCE(p_success, TRUE)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Autorización supervisada: solicitudes, pasos, ámbito local/remoto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authz_workflow (
    workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    name TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, resource_type, version)
);

CREATE TABLE IF NOT EXISTS authz_workflow_step (
    step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES authz_workflow(workflow_id) ON DELETE CASCADE,
    step_no INT NOT NULL,
    step_name TEXT NOT NULL,
    required_role_code TEXT,
    approval_scope TEXT NOT NULL DEFAULT 'either'
        CHECK (approval_scope IN ('local', 'remote', 'either')),
    sla_hours INT,
    UNIQUE (workflow_id, step_no)
);

CREATE TABLE IF NOT EXISTS authz_case (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES authz_workflow(workflow_id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
    requested_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    request_origin TEXT NOT NULL DEFAULT 'local'
        CHECK (request_origin IN ('local', 'remote', 'mobile', 'api')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_authz_case_tenant_status ON authz_case (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS authz_case_step (
    case_id UUID NOT NULL REFERENCES authz_case(case_id) ON DELETE CASCADE,
    step_no INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
    decided_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    decision_origin TEXT CHECK (decision_origin IS NULL OR decision_origin IN ('local', 'remote')),
    comment TEXT,
    PRIMARY KEY (case_id, step_no)
);

-- ---------------------------------------------------------------------------
-- Integración de alarmas hacia sistemas externos (SCADA, webhooks, etc.)
-- ---------------------------------------------------------------------------
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS external_ack_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS integration_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS alarm_integration_channel (
    channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    channel_kind TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alarm_routing_rule (
    routing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    match_severity TEXT,
    match_site_id UUID REFERENCES sites(site_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES alarm_integration_channel(channel_id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    priority SMALLINT NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS alarm_delivery_attempt (
    attempt_id BIGSERIAL PRIMARY KEY,
    alert_id BIGINT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES alarm_integration_channel(channel_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    response_code INT,
    payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alarm_delivery_alert ON alarm_delivery_attempt (alert_id);
CREATE INDEX IF NOT EXISTS idx_alarm_delivery_pending
    ON alarm_delivery_attempt (status, created_at)
    WHERE status = 'pending';

CREATE OR REPLACE FUNCTION fn_alarm_enqueue_deliveries(p_alert_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant UUID;
    v_site UUID;
    v_sev TEXT;
    v_count INT := 0;
    r RECORD;
BEGIN
    SELECT tenant_id, site_id, severity INTO v_tenant, v_site, v_sev
    FROM alerts WHERE alert_id = p_alert_id;
    IF v_tenant IS NULL THEN
        RETURN 0;
    END IF;

    FOR r IN
        SELECT rr.channel_id
        FROM alarm_routing_rule rr
        WHERE rr.tenant_id = v_tenant
          AND rr.is_active = TRUE
          AND (rr.match_site_id IS NULL OR rr.match_site_id = v_site)
          AND (rr.match_severity IS NULL OR rr.match_severity = v_sev)
        ORDER BY rr.priority ASC
    LOOP
        INSERT INTO alarm_delivery_attempt (alert_id, channel_id, status)
        VALUES (p_alert_id, r.channel_id, 'pending');
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Registro de jobs ETL / batch (workers C++ o pg_cron llaman y registran)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_job_definition (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    job_code TEXT NOT NULL,
    schedule_cron TEXT,
    handler_hint TEXT,
    sql_text TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS uq_etl_job_tenant_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_etl_job_code_global
    ON etl_job_definition (job_code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_etl_job_tenant_code_nn
    ON etl_job_definition (tenant_id, job_code) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS etl_job_run (
    run_id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES etl_job_definition(job_id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
    worker_id TEXT,
    error_message TEXT,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_etl_job_run_job_time ON etl_job_run (job_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Seeds mínimos: países LATAM + Norteamérica y permisos base
-- ---------------------------------------------------------------------------
INSERT INTO ref_country (iso2, iso3, region, name_en, name_es, default_locale, currency_code, phone_prefix) VALUES
    ('US', 'USA', 'north_america', 'United States', 'Estados Unidos', 'en-US', 'USD', '1'),
    ('CA', 'CAN', 'north_america', 'Canada', 'Canadá', 'en-CA', 'CAD', '1'),
    ('MX', 'MEX', 'north_america', 'Mexico', 'México', 'es-MX', 'MXN', '52'),
    ('PE', 'PER', 'latam', 'Peru', 'Perú', 'es-PE', 'PEN', '51'),
    ('CL', 'CHL', 'latam', 'Chile', 'Chile', 'es-CL', 'CLP', '56'),
    ('CO', 'COL', 'latam', 'Colombia', 'Colombia', 'es-CO', 'COP', '57'),
    ('BR', 'BRA', 'latam', 'Brazil', 'Brasil', 'pt-BR', 'BRL', '55'),
    ('AR', 'ARG', 'latam', 'Argentina', 'Argentina', 'es-AR', 'ARS', '54')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO ref_locale (locale_tag, language_iso2, country_iso2, display_name_en, display_name_native) VALUES
    ('en-US', 'en', 'US', 'English (United States)', 'English (United States)'),
    ('en-CA', 'en', 'CA', 'English (Canada)', 'English (Canada)'),
    ('fr-CA', 'fr', 'CA', 'French (Canada)', 'Français (Canada)'),
    ('es-MX', 'es', 'MX', 'Spanish (Mexico)', 'Español (México)'),
    ('es-419', 'es', NULL, 'Spanish (Latin America)', 'Español (Latinoamérica)'),
    ('es-PE', 'es', 'PE', 'Spanish (Peru)', 'Español (Perú)'),
    ('pt-BR', 'pt', 'BR', 'Portuguese (Brazil)', 'Português (Brasil)')
ON CONFLICT (locale_tag) DO NOTHING;

INSERT INTO sec_permission (code, description_key, category)
SELECT * FROM (VALUES
    ('tenant.admin', 'perm.tenant.admin', 'tenant'),
    ('reports.read', 'perm.reports.read', 'reports'),
    ('reports.write', 'perm.reports.write', 'reports'),
    ('telemetry.read', 'perm.telemetry.read', 'telemetry'),
    ('telemetry.ingest', 'perm.telemetry.ingest', 'telemetry'),
    ('alarms.read', 'perm.alarms.read', 'alarms'),
    ('alarms.ack', 'perm.alarms.ack', 'alarms'),
    ('alarms.route', 'perm.alarms.route', 'alarms'),
    ('authz.approve.local', 'perm.authz.approve.local', 'authz'),
    ('authz.approve.remote', 'perm.authz.approve.remote', 'authz'),
    ('formula.run', 'perm.formula.run', 'formula'),
    ('audit.read', 'perm.audit.read', 'security'),
    ('users.manage', 'perm.users.manage', 'security')
) AS v(code, description_key, category)
WHERE NOT EXISTS (SELECT 1 FROM sec_permission p WHERE p.code = v.code);

COMMIT;
