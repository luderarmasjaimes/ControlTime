-- ============================================================================
-- 53_face_template_provider_tracking.sql
-- Hallazgo de seguridad 2026-08-10: la verificación facial (login/face)
-- comparaba CUALQUIER face_template guardado con similitud coseno genérica,
-- sin importar qué motor lo generó. Eso permitía falsos positivos sistemáticos
-- entre personas DISTINTAS con el fallback "legacy" (miniatura de 24x24
-- píxeles, no un embedding biométrico real — ver
-- backend/src/biometric/face_analysis.cpp::extractLegacyTemplateFromMat), y
-- además el registro acepta face_template arbitrario del cliente sin ninguna
-- verificación de que venga de un análisis facial real.
--
-- Esta columna registra QUÉ motor generó cada plantilla, para que el login
-- pueda despachar a la comparación correcta por cuenta (coseno solo para
-- embeddings reales; DermalogFaceRecognition3.VerifyTemplates para
-- plantillas Dermalog, nunca coseno genérico sobre su blob opaco) y para
-- poder RECHAZAR explícitamente cuentas con plantillas que no vienen de
-- ningún motor real reconocido, en vez de aceptarlas por descarte.
-- ============================================================================
BEGIN;

ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS face_template_provider VARCHAR(32) NOT NULL DEFAULT 'unknown';

-- Backfill de las cuentas existentes, inferido por dimensión (mejor esfuerzo
-- retroactivo -- desde ahora el registro graba el provider real explícitamente,
-- no se vuelve a inferir por tamaño).
UPDATE auth_users
   SET face_template_provider = CASE
       WHEN jsonb_array_length(face_template) = 512 THEN 'insightface_onnx'
       WHEN jsonb_array_length(face_template) = 576 THEN 'legacy'
       WHEN jsonb_array_length(face_template) = 0 THEN 'none'
       ELSE 'unknown_client_supplied'
   END
 WHERE face_template_provider = 'unknown';

COMMENT ON COLUMN auth_users.face_template_provider IS
    'Motor que generó face_template: insightface_onnx (embedding real, coseno OK), '
    'dermalog_cli (blob opaco, requiere VerifyTemplates del SDK, nunca coseno), '
    'legacy (miniatura 24x24 no discriminativa, ADR-102-security), '
    'unknown_client_supplied (arreglo enviado directo por el cliente en el registro, '
    'nunca derivado de un análisis facial real), none (sin biometría registrada). '
    'El login facial rechaza legacy y unknown_client_supplied -- ver '
    'buildFaceLoginProbe en face_analysis.cpp.';

COMMIT;
