-- 91_auth_id_photo.sql — foto real (no caricaturizada) del registro
--
-- Contexto: el fotocheck (credencial con foto + QR cifrado, 2026-09-08)
-- necesita mostrar la cara REAL de la persona, no el avatar caricaturizado
-- por IA (avatar_cartoon_base64) que ya se guarda desde antes. Fuente: el
-- mismo recorte de busto (capturedBustRectBase64) que ya alimenta ese
-- avatar -- ver handleRegister en main.cpp.
--
-- Idempotente (mismo patrón que el resto de db_scripts/*.sql de este repo).
-- Espejado también en ensureAuthSchemaPg (auth_storage_pg.cpp) para que se
-- aplique solo al arrancar el backend, sin paso manual de psql.

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS id_photo_base64 TEXT;

COMMENT ON COLUMN auth_users.id_photo_base64 IS
  'JPEG base64 (sin prefijo data:) de la foto real capturada en el registro biométrico. Dato sensible (PII biométrica real, no un template) -- usado únicamente para el fotocheck.';
