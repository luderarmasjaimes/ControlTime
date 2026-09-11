-- ---------------------------------------------------------------------------
-- Avatar animado (ADR-150, integración a producto): job async, mismo patrón
-- que report_export_job (db_scripts/19) -- una llamada de 200-300s a
-- avatar_animation_engine no puede vivir dentro de un request/response HTTP
-- síncrono (mismo razonamiento de ADR-023 ya aplicado a exportes de informes
-- largos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avatar_animation_job (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'welcome'
        CHECK (kind IN ('welcome', 'onboarding', 'report', 'kpi', 'alarm_loop')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    storage_uri TEXT,
    error_message TEXT,
    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_avatar_animation_job_user
    ON avatar_animation_job (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_animation_job_status
    ON avatar_animation_job (status) WHERE status IN ('queued', 'running');
