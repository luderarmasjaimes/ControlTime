-- ============================================================================
-- 58_geolocation_columns_auth_audit_logs.sql
-- ADR-107: la ubicación del dispositivo cliente (login/password y login/face)
-- venía guardándose SOLO como texto libre dentro de `detail`
-- ("ok geo=lat,lon geo_accuracy_m=N"), suficiente para trazabilidad/lectura
-- fila por fila pero inútil para filtrar o agregar por coordenadas (p. ej.
-- "logins fuera de un radio esperado"). Se agregan columnas numéricas
-- dedicadas para eso; `detail` NO se toca (queda igual, por compatibilidad
-- con lecturas existentes y como registro legible humano).
--
-- Deliberadamente FUERA de la fórmula del hash-chain (trg_fn_auth_audit_logs_
-- hash_chain, ver script 37/ADR-030): mismo precedente ya establecido por la
-- columna `source_ip` (existe en la tabla, no participa del digest). Tocar
-- esa fórmula retroactivamente es inviable en una tabla append-only -- el
-- propio trigger de bloqueo impediría reescribir el row_hash de las filas
-- históricas con la fórmula nueva, y verificarlas con `fn_auth_audit_logs_
-- verify_chain()` fallaría en falso-positivo de "manipulación". La garantía
-- de integridad de estas columnas sigue siendo la misma que ya tenía
-- `source_ip`: el trigger `trg_auth_audit_logs_block_mutation` impide
-- CUALQUIER UPDATE/DELETE sobre la fila completa después del INSERT, sin
-- excepción de columna.
--
-- SIN backfill retroactivo: se intentó copiar lat/lon/accuracy desde el texto
-- ya guardado en `detail` de filas históricas, y el propio trigger
-- `trg_auth_audit_logs_block_mutation` lo RECHAZÓ ("auth_audit_logs es
-- append-only: UPDATE no está permitido") -- exactamente la garantía por la
-- que existe la tabla, funcionando como debe incluso contra este propio
-- script de migración. Las filas insertadas ANTES de esta migración quedan
-- con latitude/longitude/accuracy_m en NULL (su dato de ubicación sigue
-- accesible como siempre, en el texto de `detail`); solo las filas
-- insertadas DESPUÉS de este script llegan con las columnas nuevas pobladas
-- desde el backend (ver appendAuthAuditLogPg en auth_storage_pg.cpp).
-- ============================================================================
BEGIN;

ALTER TABLE auth_audit_logs
    ADD COLUMN IF NOT EXISTS latitude   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude  DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;

COMMENT ON COLUMN auth_audit_logs.latitude IS
    'Latitud del dispositivo cliente (navigator.geolocation del navegador), '
    'NULL si no se envió o el usuario negó el permiso -- ver ADR-107. Nunca '
    'se infiere por IP ni viene del servidor.';
COMMENT ON COLUMN auth_audit_logs.longitude IS
    'Longitud del dispositivo cliente -- ver comentario de la columna latitude.';
COMMENT ON COLUMN auth_audit_logs.accuracy_m IS
    'Radio de confianza en metros reportado por el sensor de ubicación del '
    'dispositivo cliente (GeolocationPosition.coords.accuracy), NULL si no '
    'se reportó.';

COMMIT;
