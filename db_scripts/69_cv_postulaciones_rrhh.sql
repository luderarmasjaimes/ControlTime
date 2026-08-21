-- ============================================================================
-- 69 — Postulaciones de CV por WhatsApp (RRHH) + extracción y scoring con IA local
-- ============================================================================
-- ADR-122. El bot de WhatsApp (categoría 'rrhh', ver db_scripts/62) gana un
-- sub-flujo de subida de documento: el postulante envía su CV (Word/PDF), el
-- backend lo descarga de la Graph API, extrae el texto vía ai_engine
-- (/extract_cv_text, sin LLM) y lo procesa con Ollama (qwen2.5:7b) para sacar
-- los campos estructurados + una nota de triaje 0-100 (score). Dos tablas:
--   - cv_submission: el archivo original + texto crudo + estado del pipeline.
--     Existe SIEMPRE que llega un documento, incluso si la extracción falla
--     después (status='extraction_failed') -- ninguna postulación se pierde
--     en silencio, ver whatsapp_bot_engine.cpp.
--   - cv_candidate_profile: los campos que el LLM extrajo de esa postulación
--     (1:1 con cv_submission), más score/score_rationale/extraction_warnings.
--     El score es una señal de APOYO para priorizar revisión humana, nunca
--     una decisión automática de contratar/descartar (ver ADR-122).

-- ─────────────────────────── Postulación (archivo + texto) ──────────────────
CREATE TABLE IF NOT EXISTS cv_submission (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164         text NOT NULL,
    line_id            text NOT NULL,
    tenant_id          uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    wa_media_id        text,
    original_filename  text,
    mime_type          text NOT NULL CHECK (mime_type IN (
                           'application/pdf',
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                           'application/msword')),
    file_size_bytes    integer NOT NULL,
    file_bytes         bytea,
    raw_text           text,
    status             text NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'extracted', 'extraction_failed',
                                         'scored', 'notified', 'notify_failed')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cv_submission_phone ON cv_submission (phone_e164);
CREATE INDEX IF NOT EXISTS idx_cv_submission_created ON cv_submission (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_submission_status ON cv_submission (status);

COMMENT ON TABLE cv_submission IS
    'Una fila por CV recibido vía WhatsApp (categoría rrhh, ADR-122). Guarda el archivo original y el texto extraído -- ver cv_candidate_profile para los campos estructurados que produjo el LLM. Existe aunque falle la extracción (status=extraction_failed): ninguna postulación se pierde en silencio.';
COMMENT ON COLUMN cv_submission.file_bytes IS
    'CV original (PDF/Word), tope BEEMETRY_WHATSAPP_CV_MAX_BYTES (default 10MB) -- se guarda en Postgres (bytea) por simplicidad: no hay object storage en este stack y el volumen esperado es bajo.';

-- ─────────────────────── Perfil extraído del candidato (1:1) ────────────────
CREATE TABLE IF NOT EXISTS cv_candidate_profile (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id            uuid NOT NULL UNIQUE REFERENCES cv_submission(id) ON DELETE CASCADE,
    nombres                  text,
    apellidos                text,
    telefono_fijo            text,
    celular                  text,
    whatsapp                 text,
    centro_estudios          text,
    edad                     integer,
    lugar_residencia         text,
    pretensiones_economicas  text,
    anios_experiencia        numeric,
    cargo_postulado          text,
    experiencia_laboral      jsonb NOT NULL DEFAULT '[]'::jsonb,
    cursos_capacitacion      jsonb NOT NULL DEFAULT '[]'::jsonb,
    ingles_lectura           text,
    ingles_escritura         text,
    ingles_conversacion      text,
    otra_informacion         text,
    extra_fields             jsonb NOT NULL DEFAULT '{}'::jsonb,
    score                    integer CHECK (score BETWEEN 0 AND 100),
    score_rationale          text,
    llm_model                text,
    extraction_warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cv_candidate_score ON cv_candidate_profile (score DESC);
CREATE INDEX IF NOT EXISTS idx_cv_candidate_cargo ON cv_candidate_profile (cargo_postulado);

COMMENT ON TABLE cv_candidate_profile IS
    'Campos extraídos por Ollama (qwen2.5:7b) del texto de un CV, más el score 0-100 de triaje. Ver ADR-122: el score es una señal de apoyo para priorizar revisión humana, nunca una decisión automática de contratar/descartar.';
COMMENT ON COLUMN cv_candidate_profile.experiencia_laboral IS
    'Array de {"empresa": string, "funciones": string}, tal como lo devolvió el LLM -- ver cv_extraction_client.cpp.';
COMMENT ON COLUMN cv_candidate_profile.extraction_warnings IS
    'Array de strings: campos que el LLM llenó pero que NO se pudo verificar como presentes en raw_text (chequeo de presencia anti-alucinación, ver ADR-122 y apa7ResponseLooksValid en text_spell_service.cpp como precedente del mismo patrón).';
COMMENT ON COLUMN cv_candidate_profile.score_rationale IS
    'Explicación breve del LLM sobre en qué se basó el score -- para que RRHH pueda auditar el número, nunca confiar en él a ciegas.';

-- RBAC: reutiliza soporte.view/soporte.manage + auth_user_tenant.department='rrhh'
-- (ADR-115, db_scripts/62) -- mismo criterio que support_ticket, sin permiso
-- nuevo. El panel de candidatos (GET /api/support/admin/candidates) aplica el
-- mismo bloque de autorización que handleSearchTickets (support_routes.cpp).
