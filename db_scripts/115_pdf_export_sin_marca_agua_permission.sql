-- ============================================================================
-- 115 — Permiso "exportar PDF sin marca de agua" (perfiles avanzados)
-- ============================================================================
-- Mismo criterio que informes.export_sin_clave (db_scripts/112): el export
-- PDF siempre dibuja marca de agua (ADR-080); esto da a perfiles avanzados
-- la opción de un PDF limpio (ej. para reenviar a un cliente final sin la
-- leyenda "CONFIDENCIAL — tenant — usuario — fecha" superpuesta). Permission
-- code dedicado -- nunca un flag que el cliente pueda mandar sin que el
-- backend lo verifique (ver report_routes.cpp, bloque POST /export/pdf).
--
-- Sembrado a 'admin' y 'manager' únicamente (perfiles "avanzados" de la
-- plataforma, mismo set que informes.export_sin_clave) -- 'admin' ya pasa
-- cualquier chequeo por el bypass hardcodeado de permissions.cpp, se siembra
-- igual por auditabilidad/consistencia con el resto de permisos informes.*.

INSERT INTO platform_permissions (code, module, description) VALUES
    ('informes.export_sin_marca_agua', 'informes', 'Exportar el PDF de un informe sin marca de agua (perfiles avanzados)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, 'informes.export_sin_marca_agua'
FROM unnest(ARRAY['admin', 'manager']) AS r(role)
ON CONFLICT DO NOTHING;
