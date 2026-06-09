-- =============================================================================
-- 25_platform_ui_countries_languages.sql
-- Catálogo UI: idiomas de interfaz y ampliación de países (Latam, Caribe, Norteamérica).
-- Prerrequisito: 16_platform_multitenant_latam_i18n_rbac_audit.sql (ref_country).
-- Idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ref_ui_language (
    code TEXT PRIMARY KEY CHECK (char_length(code) = 2),
    label_es TEXT NOT NULL,
    label_native TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO ref_ui_language (code, label_es, label_native, sort_order) VALUES
    ('es', 'Español', 'Español', 10),
    ('en', 'Inglés', 'English', 20),
    ('pt', 'Portugués', 'Português', 30),
    ('fr', 'Francés', 'Français', 40)
ON CONFLICT (code) DO UPDATE SET
    label_es = EXCLUDED.label_es,
    label_native = EXCLUDED.label_native,
    sort_order = EXCLUDED.sort_order;

INSERT INTO ref_country (iso2, iso3, region, name_en, name_es, default_locale, currency_code, phone_prefix) VALUES
    ('GT', 'GTM', 'latam', 'Guatemala', 'Guatemala', 'es-GT', 'GTQ', '502'),
    ('BZ', 'BLZ', 'latam', 'Belize', 'Belice', 'en-BZ', 'BZD', '501'),
    ('HN', 'HND', 'latam', 'Honduras', 'Honduras', 'es-HN', 'HNL', '504'),
    ('SV', 'SLV', 'latam', 'El Salvador', 'El Salvador', 'es-SV', 'USD', '503'),
    ('NI', 'NIC', 'latam', 'Nicaragua', 'Nicaragua', 'es-NI', 'NIO', '505'),
    ('CR', 'CRI', 'latam', 'Costa Rica', 'Costa Rica', 'es-CR', 'CRC', '506'),
    ('PA', 'PAN', 'latam', 'Panama', 'Panamá', 'es-PA', 'USD', '507'),
    ('BO', 'BOL', 'latam', 'Bolivia', 'Bolivia', 'es-BO', 'BOB', '591'),
    ('EC', 'ECU', 'latam', 'Ecuador', 'Ecuador', 'es-EC', 'USD', '593'),
    ('UY', 'URY', 'latam', 'Uruguay', 'Uruguay', 'es-UY', 'UYU', '598'),
    ('PY', 'PRY', 'latam', 'Paraguay', 'Paraguay', 'es-PY', 'PYG', '595'),
    ('VE', 'VEN', 'latam', 'Venezuela', 'Venezuela', 'es-VE', 'VES', '58'),
    ('GY', 'GUY', 'latam', 'Guyana', 'Guyana', 'en-GY', 'GYD', '592'),
    ('SR', 'SUR', 'latam', 'Suriname', 'Surinam', 'nl-SR', 'SRD', '597'),
    ('CU', 'CUB', 'caribbean', 'Cuba', 'Cuba', 'es-CU', 'CUP', '53'),
    ('DO', 'DOM', 'caribbean', 'Dominican Republic', 'República Dominicana', 'es-DO', 'DOP', '1'),
    ('HT', 'HTI', 'caribbean', 'Haiti', 'Haití', 'fr-HT', 'HTG', '509'),
    ('JM', 'JAM', 'caribbean', 'Jamaica', 'Jamaica', 'en-JM', 'JMD', '1'),
    ('TT', 'TTO', 'caribbean', 'Trinidad and Tobago', 'Trinidad y Tobago', 'en-TT', 'TTD', '1'),
    ('BB', 'BRB', 'caribbean', 'Barbados', 'Barbados', 'en-BB', 'BBD', '1'),
    ('BS', 'BHS', 'caribbean', 'Bahamas', 'Bahamas', 'en-BS', 'BSD', '1'),
    ('PR', 'PRI', 'caribbean', 'Puerto Rico', 'Puerto Rico', 'es-PR', 'USD', '1')
ON CONFLICT (iso2) DO NOTHING;

COMMIT;
