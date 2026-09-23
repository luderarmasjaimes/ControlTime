-- ============================================================================
-- 112 — Permiso "exportar PDF sin contraseña" (perfiles avanzados)
-- ============================================================================
-- El export PDF cifra siempre con una contraseña generada al vuelo
-- (ADR-080, report_pdf_export.cpp) -- pedido explícito: dar a perfiles
-- avanzados la opción de exportar un PDF estándar SIN esa protección
-- (ej. para adjuntarlo a un flujo externo que ya maneja su propio control de
-- acceso). Es una excepción de seguridad real, así que queda detrás de un
-- permission code dedicado (nunca un flag que el cliente pueda simplemente
-- mandar en el body sin que el backend lo verifique -- ver
-- report_routes.cpp, bloque POST /export/pdf) en vez de reusar el genérico
-- informes.view que ya gatean las 4 rutas de export.
--
-- Sembrado a 'admin' y 'manager' únicamente (perfiles "avanzados" de la
-- plataforma) -- 'admin' ya pasa cualquier chequeo por el bypass hardcodeado
-- de permissions.cpp, se siembra igual por auditabilidad/consistencia con el
-- resto de permisos informes.*.

INSERT INTO platform_permissions (code, module, description) VALUES
    ('informes.export_sin_clave', 'informes', 'Exportar el PDF de un informe sin contraseña de acceso (perfiles avanzados)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, 'informes.export_sin_clave'
FROM unnest(ARRAY['admin', 'manager']) AS r(role)
ON CONFLICT DO NOTHING;
