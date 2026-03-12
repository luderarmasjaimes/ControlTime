-- Authentication and biometric schema
-- Compatible with PostgreSQL / TimescaleDB image used in docker-compose

CREATE TABLE IF NOT EXISTS auth_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(180) NOT NULL,
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120) NOT NULL,
    dni VARCHAR(12) NOT NULL UNIQUE,
    username VARCHAR(80) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'operator',
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_name, username)
);

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'operator';

CREATE TABLE IF NOT EXISTS auth_face_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    template_version VARCHAR(30) NOT NULL DEFAULT 'v1',
    template_vector JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_action VARCHAR(60) NOT NULL,
    company_name VARCHAR(180),
    username VARCHAR(80),
    success BOOLEAN NOT NULL,
    detail TEXT,
    source_ip VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_time ON auth_audit_logs(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_auth_face_templates_user_id ON auth_face_templates(user_id);

CREATE TRIGGER update_auth_users_modtime
BEFORE UPDATE ON auth_users
FOR EACH ROW EXECUTE FUNCTION update_modified_column();
