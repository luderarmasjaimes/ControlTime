-- ============================================================================
-- 66_deepface_silentface_provider_comment.sql
-- Documenta el nuevo valor válido de auth_users.face_template_provider tras
-- reemplazar SeetaFace6 por DeepFace (Facenet512) + Silent-Face-Anti-Spoofing
-- (MiniFASNet) como proveedor biométrico local por defecto. La columna ya es
-- VARCHAR(32) sin CHECK constraint (ver db_scripts/53), así que no hace falta
-- ALTER de esquema -- solo se actualiza el comentario para reflejar el motor
-- que el registro graba hoy y que loginFaceTargetedPg despacha explícitamente
-- (auth_storage_pg.cpp).
-- ============================================================================
BEGIN;

COMMENT ON COLUMN auth_users.face_template_provider IS
    'Motor que generó face_template: deepface_silentface (Facenet512 + '
    'Silent-Face-Anti-Spoofing, embedding real de 512 componentes, proveedor '
    'local por defecto), insightface_onnx (embedding real, coseno OK), '
    'dermalog_cli (blob opaco, requiere VerifyTemplates del SDK, nunca coseno), '
    'seetaface6_local (heredado -- ya no es el proveedor por defecto), '
    'legacy (miniatura 24x24 no discriminativa, ADR-102-security), '
    'unknown_client_supplied (arreglo enviado directo por el cliente en el registro, '
    'nunca derivado de un análisis facial real), none (sin biometría registrada). '
    'El login facial rechaza legacy y unknown_client_supplied -- ver '
    'loginFaceTargetedPg en auth_storage_pg.cpp y buildFaceLoginProbe en face_analysis.cpp.';

COMMIT;
