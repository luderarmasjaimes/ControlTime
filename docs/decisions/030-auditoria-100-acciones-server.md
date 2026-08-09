# ADR-030 — Auditoría 100% de acciones, autoritativa en el servidor

**Status**: implemented (cerrado 2026-07-07). Corrección de alcance sobre la nota anterior: releyendo el texto de este mismo ADR, "100% de acciones" se define explícitamente como acciones SENSIBLES de usuario (login, cambios de permisos, workflow, firma, refresh, export, acceso a dato sensible) — NO como cada INSERT de telemetría de alto volumen. Auditar ~10k lecturas/seg de sensores generaría más filas de auditoría que datos reales, contradiciendo el propósito forense de la tabla; no es un hueco real, fue una lectura de alcance incorrecta la vez anterior.

El hueco REAL identificado releyendo con cuidado: `auth_audit_logs` (login) y `auth_user_maintenance_audit` (cambios de permisos) — las dos categorías que el propio ADR nombra primero en su lista — vivían en tablas propias sin la protección append-only + hash encadenado que sí tenía `platform_audit_log` desde el script 31 (violando además la propia regla de este ADR: "los componentes nuevos usan el mismo servicio de auditoría, no implementan el suyo"). Cerrado con `db_scripts/37_adr030_hash_chain_auth_audit_tables.sql`: mismo patrón que 31 (trigger `BEFORE INSERT` calcula `prev_hash`/`row_hash` vía SHA-256; trigger `BEFORE UPDATE OR DELETE` rechaza incondicionalmente, efectivo incluso para el rol owner), replicado en las 2 tablas, con backfill de las 818 filas históricas preexistentes (800 + 18).

**Verificado contra `beemetry-db` real**: `fn_auth_audit_logs_verify_chain()`/`fn_auth_user_maint_audit_verify_chain()` → 0 filas rotas en ambas tras el backfill; intento real de `UPDATE auth_audit_logs SET detail='tampered'` → rechazado (`ERROR: auth_audit_logs es append-only`); intento real de `DELETE FROM auth_user_maintenance_audit` → rechazado con el mismo mecanismo; un login real posterior a la migración insertó correctamente con `row_hash` poblado (la ruta de escritura normal no se vio afectada).

Con esto, las 3 categorías "sensibles" con almacenamiento propio en BD (`platform_audit_log`, `auth_audit_logs`, `auth_user_maintenance_audit`) tienen la misma protección forense. Cobertura restante fuera de BD (refresh de widgets vía ADR-012, export vía ADR-016) ya generan sus propias entradas en `platform_audit_log`/logs de aplicación — no requieren tablas nuevas.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El KPI O7 exige que el 100% de las acciones queden auditadas, y la soberanía/compliance lo refuerza. La auditoría es un **servicio de plataforma** transversal a todos los componentes (ADR-031). El código tiene auditoría parcial client-side (`auditTrail.js`, clave `aurixa_audit_trail`) y el modelo v36 define tablas `platform_audit_log` y `report_sensitive_action_log`, con contexto derivado del login.

## Decisión

La auditoría es **autoritativa en el servidor** y **transversal a la plataforma**: toda acción sensible (login, cambios de permisos, transiciones de workflow, firma, refresh de widgets, export, accesos a dato sensible) genera una entrada en las tablas de auditoría del servidor, con contexto de identidad (ADR-029) y, donde aplique, **hash encadenado** para integridad forense. La auditoría client-side es, a lo sumo, un buffer que se reconcilia con el servidor — nunca la fuente de verdad.

### Reglas duras
- Ninguna acción sensible se considera "hecha" sin su entrada de auditoría en el servidor.
- El log de auditoría es append-only; no se edita ni borra (retención según compliance).
- Las entradas críticas (workflow, firma) usan hash encadenado para detectar manipulación.
- Los componentes nuevos usan el mismo servicio de auditoría (no implementan el suyo).

## Consecuencias

### Positivas
- Cumple O7 (100%) y soporta auditoría/compliance reales.
- Trazabilidad forense (hash encadenado) para acciones críticas.

### Negativas / Trade-offs
- Cada acción sensible toca el servidor — costo aceptable; las entradas son chicas.
- Volumen de auditoría a retener/gestionar — cubierto por políticas de retención.

### Neutras
- Reusa el contexto de login (migraciones 20-21 del modelo v36).

## Alternativas descartadas

### Auditoría client-side
Es el estado parcial actual (`aurixa_audit_trail`). No es confiable ni completa; un cliente puede no reportar. Rechazada como autoritativa.

### Auditoría solo de login
Insuficiente para O7 (100% de acciones) y para un informe con valor operativo/legal.

## Referencias
- `Referencias/docs/02_Arquitectura/Modelo_Datos_AURIXA_v36.md` § 3.2 (tablas de auditoría)
- `Referencias/frontend/src/components/ReportStudioV2/lib/auditTrail.js`
- ADR-015 (versionado), ADR-017 (workflow), ADR-018 (firma), ADR-029 (identidad), ADR-031 (plataforma)
