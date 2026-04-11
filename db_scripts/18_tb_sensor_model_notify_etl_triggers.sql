-- =============================================================================
-- 18_tb_sensor_model_notify_etl_triggers.sql
-- Modelo de sensor al estilo ThingsBoard (perfil + atributos + credenciales),
-- notificaciones multicanal, ETL con pares externos, triggers en tablas de
-- bajo volumen: alerts, auth_audit_logs, sensor_process_alarm_queue.
--
-- Prerrequisitos: 04_telemetry_schema_v2, 16_platform_multitenant_latam_i18n_rbac_audit
-- Idempotente salvo reemplazo de funciones/triggers con DROP IF EXISTS.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ThingsBoard: device_profile → sensor_profile
-- TB: device → sensors (+ columnas identificación)
-- TB: attribute_kv (scopes) → sensor_attribute_kv
-- TB: device_credentials → sensor_ingest_credential
-- TB: ts_kv → telemetry_raw / telemetry_multivariate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_profile (
    profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device_type TEXT,
    transport_type TEXT,
    profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sensor_profile_tenant ON sensor_profile (tenant_id);

ALTER TABLE sensors ADD COLUMN IF NOT EXISTS sensor_profile_id UUID
    REFERENCES sensor_profile(profile_id) ON DELETE SET NULL;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS idx_sensors_tenant_external
    ON sensors (tenant_id, external_id)
    WHERE external_id IS NOT NULL;

COMMENT ON TABLE sensor_profile IS
    'Análogo a device_profile (ThingsBoard): tipo, transporte, defaults JSON (transport, alarmas, parsing).';
COMMENT ON COLUMN sensors.metadata IS
    'Atributos flexibles; use sensor_attribute_kv para scopes server/client/shared como TB.';
COMMENT ON COLUMN sensors.external_id IS
    'ID en SCADA/MES/externo; único lógico por tenant vía índice parcial.';

CREATE TABLE IF NOT EXISTS sensor_attribute_kv (
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    scope TEXT NOT NULL
        CHECK (scope IN ('server', 'client', 'shared')),
    attr_key TEXT NOT NULL,
    value_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sensor_id, scope, attr_key)
);

CREATE INDEX IF NOT EXISTS idx_sensor_attr_sensor ON sensor_attribute_kv (sensor_id);

COMMENT ON TABLE sensor_attribute_kv IS
    'Alineado a attribute_kv de TB: server=operador, client=reportado por borde, shared=ambos.';

CREATE TABLE IF NOT EXISTS sensor_ingest_credential (
    credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    cred_type TEXT NOT NULL,
    cred_subject TEXT,
    secret_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sensor_cred_type_subject_nn
    ON sensor_ingest_credential (sensor_id, cred_type, cred_subject)
    WHERE cred_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sensor_cred_type_nullsubj
    ON sensor_ingest_credential (sensor_id, cred_type)
    WHERE cred_subject IS NULL;

COMMENT ON TABLE sensor_ingest_credential IS
    'Análogo a device_credentials: solo hash/token opaco, nunca secreto en claro.';

-- ---------------------------------------------------------------------------
-- Clasificación de alarmas (TB: alarm.type + severity)
-- ---------------------------------------------------------------------------
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alarm_category TEXT NOT NULL DEFAULT 'process';
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_alarm_category_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_alarm_category_check
    CHECK (alarm_category IN (
        'safety', 'security', 'access', 'process', 'data_quality', 'environmental', 'general'
    ));

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alarm_type TEXT;
CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts (tenant_id, alarm_category, triggered_at DESC);

COMMENT ON COLUMN alerts.alarm_category IS
    'Seguridad minera, acceso, proceso, calidad de dato, etc.; enrutamiento a personas/grupos.';
COMMENT ON COLUMN alerts.alarm_type IS
    'Código libre (p. ej. HIGH_TEMP, UNAUTHORIZED_ZONE), comparable a alarm.type en TB.';

-- ---------------------------------------------------------------------------
-- Notificaciones: destinatarios, grupos, rutas, outbox (workers envían SMS/WA/email)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_notify_recipient (
    recipient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    display_name TEXT,
    email TEXT,
    phone_e164 TEXT,
    whatsapp_e164 TEXT,
    push_device_token TEXT,
    preferred_channels TEXT[] NOT NULL DEFAULT ARRAY['in_app', 'email']::TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_notify_recipient_tenant ON org_notify_recipient (tenant_id);

CREATE TABLE IF NOT EXISTS org_notify_group (
    group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS org_notify_group_member (
    group_id UUID NOT NULL REFERENCES org_notify_group(group_id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES org_notify_recipient(recipient_id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS org_notify_route (
    route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    alarm_category TEXT,
    match_alarm_type TEXT,
    match_severity TEXT,
    match_site_id UUID REFERENCES sites(site_id) ON DELETE CASCADE,
    group_id UUID REFERENCES org_notify_group(group_id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES org_notify_recipient(recipient_id) ON DELETE CASCADE,
    channel_override TEXT[],
    min_severity_rank SMALLINT DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (group_id IS NOT NULL OR recipient_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_org_notify_route_tenant ON org_notify_route (tenant_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS org_notification_outbox (
    outbox_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL
        CHECK (source_kind IN ('alert', 'security', 'etl', 'manual', 'data_pipeline')),
    source_ref TEXT,
    channel_kind TEXT NOT NULL
        CHECK (channel_kind IN (
            'in_app', 'email', 'sms', 'whatsapp', 'push', 'webhook', 'teams', 'slack'
        )),
    recipient_address TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_notif_outbox_pending
    ON org_notification_outbox (status, created_at)
    WHERE status = 'pending';

COMMENT ON TABLE org_notification_outbox IS
    'Outbox consumida por servicio C++/worker: Twilio, SendGrid, Meta WA Business API, FCM, etc.';

-- ---------------------------------------------------------------------------
-- ETL / sincronización con otra plataforma (masivo + incremental + reenvío near-real-time)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_sync_peer (
    peer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    direction TEXT NOT NULL DEFAULT 'bidirectional'
        CHECK (direction IN ('push', 'pull', 'bidirectional')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etl_sync_state (
    peer_id UUID NOT NULL REFERENCES etl_sync_peer(peer_id) ON DELETE CASCADE,
    stream_code TEXT NOT NULL,
    watermark_ts TIMESTAMPTZ,
    watermark_bigint BIGINT,
    cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (peer_id, stream_code)
);

CREATE TABLE IF NOT EXISTS etl_sync_run (
    run_id BIGSERIAL PRIMARY KEY,
    peer_id UUID NOT NULL REFERENCES etl_sync_peer(peer_id) ON DELETE CASCADE,
    mode TEXT NOT NULL
        CHECK (mode IN ('bulk', 'incremental', 'realtime_forward')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'failed', 'partial')),
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_etl_sync_run_peer ON etl_sync_run (peer_id, started_at DESC);

COMMENT ON TABLE etl_sync_peer IS
    'Plataforma externa (URL + credenciales en auth_config; cifrado/KMS en aplicación).';
COMMENT ON TABLE etl_sync_state IS
    'Marca de agua por stream para bulk no solapado e incremental tras conectividad.';

-- ---------------------------------------------------------------------------
-- Cola bajo volumen: anomalías en datos procesados → INSERT alerts → trigger fan-out
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_process_alarm_queue (
    q_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(site_id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    alarm_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_proc_alarm_q_sensor ON sensor_process_alarm_queue (sensor_id, created_at DESC);

COMMENT ON TABLE sensor_process_alarm_queue IS
    'Insertar desde motor C++/reglas al detectar fallo de proceso o calidad; NO usar trigger en telemetry_raw.';

-- ---------------------------------------------------------------------------
-- Funciones y triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_alarm_severity_rank(p_severity TEXT)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(coalesce(p_severity, ''))
        WHEN 'critical' THEN 100::SMALLINT
        WHEN 'high' THEN 80::SMALLINT
        WHEN 'major' THEN 60::SMALLINT
        WHEN 'medium' THEN 40::SMALLINT
        WHEN 'low' THEN 20::SMALLINT
        WHEN 'info' THEN 10::SMALLINT
        ELSE 30::SMALLINT
    END;
$$;

CREATE OR REPLACE FUNCTION fn_org_notify_fanout_for_alert(p_alert_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant UUID;
    v_site UUID;
    v_sev TEXT;
    v_cat TEXT;
    v_type TEXT;
    v_title TEXT;
    v_desc TEXT;
    v_rank SMALLINT;
    r_route RECORD;
    r_rec RECORD;
    v_count INT := 0;
    v_ch TEXT;
    v_addr TEXT;
    v_channels TEXT[];
BEGIN
    SELECT tenant_id, site_id, severity, alarm_category, alarm_type, title, COALESCE(description, '')
    INTO v_tenant, v_site, v_sev, v_cat, v_type, v_title, v_desc
    FROM alerts WHERE alert_id = p_alert_id;

    IF v_tenant IS NULL THEN
        RETURN 0;
    END IF;

    v_rank := fn_alarm_severity_rank(v_sev);

    FOR r_route IN
        SELECT *
        FROM org_notify_route r
        WHERE r.tenant_id = v_tenant
          AND r.is_active = TRUE
          AND (r.alarm_category IS NULL OR r.alarm_category = v_cat)
          AND (r.match_alarm_type IS NULL OR r.match_alarm_type = v_type)
          AND (r.match_severity IS NULL OR r.match_severity = v_sev)
          AND (r.match_site_id IS NULL OR r.match_site_id = v_site)
          AND v_rank >= COALESCE(r.min_severity_rank, 0)
    LOOP
        IF r_route.recipient_id IS NOT NULL THEN
            SELECT * INTO r_rec FROM org_notify_recipient x
            WHERE x.recipient_id = r_route.recipient_id AND x.is_active = TRUE;
            IF FOUND THEN
                v_channels := COALESCE(r_route.channel_override, r_rec.preferred_channels);
                FOREACH v_ch IN ARRAY v_channels
                LOOP
                    v_addr := NULL;
                    IF v_ch = 'email' THEN v_addr := r_rec.email;
                    ELSIF v_ch IN ('sms', 'whatsapp') THEN v_addr := COALESCE(r_rec.whatsapp_e164, r_rec.phone_e164);
                    ELSIF v_ch = 'push' THEN v_addr := r_rec.push_device_token;
                    ELSIF v_ch = 'in_app' THEN v_addr := COALESCE(r_rec.user_id::TEXT, r_rec.email, r_rec.recipient_id::TEXT);
                    END IF;
                    IF v_addr IS NOT NULL AND v_addr <> '' THEN
                        INSERT INTO org_notification_outbox (
                            tenant_id, source_kind, source_ref, channel_kind, recipient_address, payload
                        ) VALUES (
                            v_tenant, 'alert', p_alert_id::TEXT, v_ch, v_addr,
                            jsonb_build_object(
                                'alert_id', p_alert_id,
                                'title', v_title,
                                'description', v_desc,
                                'severity', v_sev,
                                'alarm_category', v_cat,
                                'alarm_type', v_type
                            )
                        );
                        v_count := v_count + 1;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        IF r_route.group_id IS NOT NULL THEN
            FOR r_rec IN
                SELECT x.*
                FROM org_notify_group_member m
                JOIN org_notify_recipient x ON x.recipient_id = m.recipient_id
                WHERE m.group_id = r_route.group_id AND x.is_active = TRUE
            LOOP
                v_channels := COALESCE(r_route.channel_override, r_rec.preferred_channels);
                FOREACH v_ch IN ARRAY v_channels
                LOOP
                    v_addr := NULL;
                    IF v_ch = 'email' THEN v_addr := r_rec.email;
                    ELSIF v_ch IN ('sms', 'whatsapp') THEN v_addr := COALESCE(r_rec.whatsapp_e164, r_rec.phone_e164);
                    ELSIF v_ch = 'push' THEN v_addr := r_rec.push_device_token;
                    ELSIF v_ch = 'in_app' THEN v_addr := COALESCE(r_rec.user_id::TEXT, r_rec.email, r_rec.recipient_id::TEXT);
                    END IF;
                    IF v_addr IS NOT NULL AND v_addr <> '' THEN
                        INSERT INTO org_notification_outbox (
                            tenant_id, source_kind, source_ref, channel_kind, recipient_address, payload
                        ) VALUES (
                            v_tenant, 'alert', p_alert_id::TEXT, v_ch, v_addr,
                            jsonb_build_object(
                                'alert_id', p_alert_id,
                                'title', v_title,
                                'description', v_desc,
                                'severity', v_sev,
                                'alarm_category', v_cat,
                                'alarm_type', v_type,
                                'group_id', r_route.group_id
                            )
                        );
                        v_count := v_count + 1;
                    END IF;
                END LOOP;
            END LOOP;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_alerts_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(current_setting('app.alert_fanout', TRUE), 'on') = 'off' THEN
        RETURN NEW;
    END IF;
    PERFORM fn_alarm_enqueue_deliveries(NEW.alert_id);
    PERFORM fn_org_notify_fanout_for_alert(NEW.alert_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alerts_after_insert_fanout ON alerts;
CREATE TRIGGER trg_alerts_after_insert_fanout
    AFTER INSERT ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_alerts_after_insert();

CREATE OR REPLACE FUNCTION fn_org_notify_fanout_for_security_audit(p_log_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant UUID;
    v_username TEXT;
    v_company TEXT;
    v_action TEXT;
    v_detail TEXT;
    r_route RECORD;
    r_rec RECORD;
    v_count INT := 0;
    v_ch TEXT;
    v_addr TEXT;
    v_channels TEXT[];
BEGIN
    SELECT username, company_name, event_action, detail
    INTO v_username, v_company, v_action, v_detail
    FROM auth_audit_logs WHERE id = p_log_id;

    IF NOT FOUND OR v_username IS NULL THEN
        RETURN 0;
    END IF;

    SELECT aut.tenant_id INTO v_tenant
    FROM auth_users u
    JOIN auth_user_tenant aut ON aut.user_id = u.id
    WHERE u.username = v_username
      AND (v_company IS NULL OR u.company_name = v_company)
    ORDER BY aut.is_default DESC NULLS LAST
    LIMIT 1;

    IF v_tenant IS NULL THEN
        RETURN 0;
    END IF;

    FOR r_route IN
        SELECT *
        FROM org_notify_route r
        WHERE r.tenant_id = v_tenant
          AND r.is_active = TRUE
          AND r.alarm_category = 'security'
    LOOP
        IF r_route.recipient_id IS NOT NULL THEN
            SELECT * INTO r_rec FROM org_notify_recipient x
            WHERE x.recipient_id = r_route.recipient_id AND x.is_active = TRUE;
            IF FOUND THEN
                v_channels := COALESCE(r_route.channel_override, r_rec.preferred_channels);
                FOREACH v_ch IN ARRAY v_channels
                LOOP
                    v_addr := NULL;
                    IF v_ch = 'email' THEN v_addr := r_rec.email;
                    ELSIF v_ch IN ('sms', 'whatsapp') THEN v_addr := COALESCE(r_rec.whatsapp_e164, r_rec.phone_e164);
                    ELSIF v_ch = 'push' THEN v_addr := r_rec.push_device_token;
                    ELSIF v_ch = 'in_app' THEN v_addr := COALESCE(r_rec.user_id::TEXT, r_rec.email, r_rec.recipient_id::TEXT);
                    END IF;
                    IF v_addr IS NOT NULL AND v_addr <> '' THEN
                        INSERT INTO org_notification_outbox (
                            tenant_id, source_kind, source_ref, channel_kind, recipient_address, payload
                        ) VALUES (
                            v_tenant, 'security', p_log_id::TEXT, v_ch, v_addr,
                            jsonb_build_object(
                                'auth_log_id', p_log_id,
                                'username', v_username,
                                'company_name', v_company,
                                'event_action', v_action,
                                'detail', v_detail
                            )
                        );
                        v_count := v_count + 1;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        IF r_route.group_id IS NOT NULL THEN
            FOR r_rec IN
                SELECT x.*
                FROM org_notify_group_member m
                JOIN org_notify_recipient x ON x.recipient_id = m.recipient_id
                WHERE m.group_id = r_route.group_id AND x.is_active = TRUE
            LOOP
                v_channels := COALESCE(r_route.channel_override, r_rec.preferred_channels);
                FOREACH v_ch IN ARRAY v_channels
                LOOP
                    v_addr := NULL;
                    IF v_ch = 'email' THEN v_addr := r_rec.email;
                    ELSIF v_ch IN ('sms', 'whatsapp') THEN v_addr := COALESCE(r_rec.whatsapp_e164, r_rec.phone_e164);
                    ELSIF v_ch = 'push' THEN v_addr := r_rec.push_device_token;
                    ELSIF v_ch = 'in_app' THEN v_addr := COALESCE(r_rec.user_id::TEXT, r_rec.email, r_rec.recipient_id::TEXT);
                    END IF;
                    IF v_addr IS NOT NULL AND v_addr <> '' THEN
                        INSERT INTO org_notification_outbox (
                            tenant_id, source_kind, source_ref, channel_kind, recipient_address, payload
                        ) VALUES (
                            v_tenant, 'security', p_log_id::TEXT, v_ch, v_addr,
                            jsonb_build_object(
                                'auth_log_id', p_log_id,
                                'username', v_username,
                                'event_action', v_action,
                                'group_id', r_route.group_id
                            )
                        );
                        v_count := v_count + 1;
                    END IF;
                END LOOP;
            END LOOP;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_auth_audit_security_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.success = TRUE THEN
        RETURN NEW;
    END IF;
    IF COALESCE(current_setting('app.security_notify_fanout', TRUE), 'on') = 'off' THEN
        RETURN NEW;
    END IF;
    IF NEW.event_action IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.event_action NOT ILIKE '%LOGIN%'
       AND NEW.event_action NOT ILIKE '%AUTH%'
       AND NEW.event_action NOT ILIKE '%ACCESS%'
       AND NEW.event_action NOT ILIKE '%BIOMET%'
    THEN
        RETURN NEW;
    END IF;
    PERFORM fn_org_notify_fanout_for_security_audit(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_audit_security_notify ON auth_audit_logs;
CREATE TRIGGER trg_auth_audit_security_notify
    AFTER INSERT ON auth_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_auth_audit_security_after_insert();

CREATE OR REPLACE FUNCTION trg_fn_sensor_process_alarm_queue_to_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO alerts (
        tenant_id, site_id, sensor_id, severity, title, description, status,
        alarm_category, alarm_type, metadata
    ) VALUES (
        NEW.tenant_id,
        NEW.site_id,
        NEW.sensor_id,
        NEW.severity,
        NEW.title,
        NEW.body,
        'open',
        'data_quality',
        NEW.alarm_type,
        jsonb_build_object('source', 'sensor_process_alarm_queue', 'q_id', NEW.q_id)
          || COALESCE(NEW.detail, '{}'::jsonb)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sensor_process_alarm_queue_ai ON sensor_process_alarm_queue;
CREATE TRIGGER trg_sensor_process_alarm_queue_ai
    AFTER INSERT ON sensor_process_alarm_queue
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_sensor_process_alarm_queue_to_alert();

INSERT INTO sec_permission (code, description_key, category)
SELECT * FROM (VALUES
    ('notify.routes.manage', 'perm.notify.routes', 'notifications'),
    ('etl.sync.manage', 'perm.etl.sync', 'integration'),
    ('sensor.profile.manage', 'perm.sensor.profile', 'telemetry')
) AS v(code, description_key, category)
WHERE NOT EXISTS (SELECT 1 FROM sec_permission p WHERE p.code = v.code);

COMMIT;
