-- ============================================================
-- 05_reports_admin.sql
-- Extensión del esquema para Administración de Informes
-- Sistema Minero ReportStudio v2.0
-- Fecha: 2026-03-19
-- ============================================================

-- Asegurarse que la función update_modified_column existe
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Extender tabla reports existente con campos de autoría y ciclo de vida
ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    created_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    reviewed_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    reviewed_at TIMESTAMPTZ;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    deleted_at TIMESTAMPTZ;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    version_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    last_modified_by UUID REFERENCES auth_users(id) ON DELETE SET NULL;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
    company_name VARCHAR(180);

-- Tabla para envío de informes entre usuarios de la misma empresa
CREATE TABLE IF NOT EXISTS report_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    sent_by UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    sent_to UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

-- Tabla de notificaciones internas
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    type VARCHAR(60) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_reports_created_by  ON reports(created_by);
CREATE INDEX IF NOT EXISTS idx_reports_company     ON reports(company_name);
CREATE INDEX IF NOT EXISTS idx_reports_created_at  ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status      ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_active      ON reports(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_report_shares_to    ON report_shares(sent_to);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, is_read);
