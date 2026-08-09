# ADR-085 — CRUD completo de empresas y pantalla de administración

**Status**: implemented (backend + frontend; pendiente de verificación E2E contra contenedor real — ver Fase 6 del plan de implementación)
**Fecha**: 2026-08-05
**Autores**: EC
**Ámbito**: plataforma
**Relación**: extiende ADR-078 (no lo supersede — la decisión de alta administrada sigue vigente tal cual); depende de ADR-086 (RBAC granular `empresas.view`/`empresas.manage`) y ADR-067 (`findOrCreateTenantForCompanyPg`); cierra la mitad restante del Hallazgo G2 de ADR-061.

## Contexto

ADR-078 (2026-07-29) resolvió el alta de empresas: `POST /api/auth/companies`
con deduplicación case-insensitive y tenant real. Quedó explícitamente fuera
de ese ADR el mantenimiento (editar/dar de baja), una pantalla de
administración, y el campo RUC — la mitad del Hallazgo G2 documentado en
`docs/decisions/061-catalogo-casos-prueba-qa.md` (líneas 19-40) y en
`docs_/01_Planificacion/Auditoria_Registro_RUC_Tenant_2026-07-21.md`.

Gerencia pidió cerrar el resto: mantenimiento completo (CRUD), pantalla de
administración similar a la de usuarios, y perfiles RBAC diferenciados entre
"ver el catálogo" y "mantenerlo" (este último, ver ADR-086).

**Hallazgos reales encontrados al implementar** (no supuestos — verificados
contra el código):
- El dedup del `POST` original hacía `SELECT` + `INSERT` sin índice único de
  respaldo: dos altas concurrentes del mismo nombre normalizado podían crear
  dos filas. Cerrado con un índice único sobre `lower(btrim(name))`
  (`ux_auth_companies_name_norm`, `db_scripts/50`).
- El nombre de empresa es clave foránea *de facto* en 5+ tablas
  (`auth_users.company_name`, `reports.company_name`,
  `auth_audit_logs.company_name`, `tenants.tenant_name`,
  `mineria_empresas.nombre`), sin FK real. Un `UPDATE` que renombrara
  rompería login, informes y resolución de tenant en silencio.
- El esquema de `auth_companies` se crea desde dos lugares — el script SQL
  (despliegues existentes) y `ensureAuthSchemaPg()` en C++ (despliegues
  nuevos, que solo montan `db_scripts/01-29` vía
  `docker-entrypoint-initdb.d`). Toda columna nueva se agregó en ambos.

## Decisión

1. **Esquema** (`db_scripts/50_companies_crud_rbac.sql`, espejado en
   `ensureAuthSchemaPg`): `auth_companies` gana `company_id` (uuid
   surrogate), `ruc`, `country_code`, `domicilio_fiscal`, `tenant_id`
   (materializa el vínculo que antes solo se resolvía por nombre en cada
   request), `updated_at/by`, `deactivated_at/by`, `demo_data`. `name` sigue
   siendo la PK — no se puede quitar sin romper todo lo que referencia por
   nombre (ver Hallazgo de arriba).
2. **Renombrar queda fuera de alcance en v1**: el `PUT` edita
   `ruc`/`country_code`/`domicilio_fiscal`, nunca `name`
   (`updateCompanyPg`, `auth_storage_pg.cpp`). Un error de tipeo en el alta
   requiere baja + alta nueva. Documentado como riesgo abierto — un rename
   con cascade transaccional a las 5 tablas dependientes merece su propio
   ADR si Gerencia lo pide.
3. **Baja = soft delete**, nunca borrado físico: `DELETE
   /api/auth/companies/{id}` marca `active=false` +
   `deactivated_at/by` (`setCompanyActivePg`); el mismo endpoint con
   `?reactivate=true` revierte. Hay informes/telemetría/usuarios enlazados
   por nombre — un borrado físico los dejaría huérfanos.
4. **Endpoints nuevos** (`auth_routes.cpp`): `GET
   /api/auth/companies/manage` (catálogo administrativo — incluye
   inactivas si se pide, RUC enmascarado si el solicitante no tiene
   `empresas.manage`), `PUT /api/auth/companies/{id}`, `DELETE
   /api/auth/companies/{id}`. El `POST` existente se extiende para aceptar
   `ruc`/`country`/`domicilio_fiscal` opcionales, validando el RUC con el
   mismo checksum ya existente (extraído a `tax_id.cpp`, ver ADR-087) antes
   de aceptar el alta.
5. **Pantalla de administración** (`CompanyManagementView.tsx`): mismo
   patrón estructural que `UserManagementView.tsx` — header con búsqueda +
   alta, layout de dos columnas (lista + detalle), reutiliza
   `accessAdministration.css` sin duplicar clases. Con solo
   `empresas.view`: modo lectura, sin botones de mantenimiento (el RUC ya
   llega enmascarado del backend — doble cinturón de seguridad, no solo
   ocultar UI).
6. **Cliente API** (`authApi.ts`): `fetchCompaniesAdmin`,
   `updateCompany`, `setCompanyActive` nuevos; `createCompany` extendido
   aceptando `{name, ruc?, country?, domicilio_fiscal?}` manteniendo
   compatibilidad con los call sites que solo mandaban un `string` (p.ej.
   `AuthGateway.tsx`).

## Consecuencias

- Gerencia obtiene mantenimiento real (no solo alta) de empresas, con
  trazabilidad completa (auditoría `company_update`/`company_deactivate`/
  `company_reactivate`, mismo mecanismo que `company_create` de ADR-078).
- El índice único cierra una condición de carrera real preexistente, no
  introducida por este cambio — un efecto colateral positivo de tocar este
  código.
- `auth_companies` y `mineria_empresas` siguen siendo catálogos distintos
  sincronizados por nombre; este ADR agrega `tenant_id` a `auth_companies`
  para acortar el camino, pero **no las unifica** — eso es una migración
  mayor, fuera de alcance aquí y no debe leerse como resuelto.
- La tercera tabla `mineria_empresas` de `formula_engine/init_minas.sql`
  (compose separado, con su propio `ruc`) no se toca — se deja esta nota
  para que quien la encuentre después no la lea como una inconsistencia
  introducida por este trabajo.

### Negativas / Trade-offs
- Sin rename, un typo en el alta es permanente salvo baja+alta nueva.
- El RUC en `auth_companies` se hizo backfill desde `auth_users.ruc` (por
  usuario, no por empresa) solo donde no había ambigüedad; empresas con RUC
  ambiguo entre sus usuarios quedan con `ruc=''` para resolución manual (ver
  query de verificación en el propio script SQL).

## Alternativas descartadas

- **Quitar `name` como PK y usar solo `company_id`**: habría requerido
  migrar las 5+ tablas que referencian por nombre en el mismo cambio —
  alcance desproporcionado para cerrar G2. Se prefirió agregar `company_id`
  como surrogate adicional.
- **Permitir rename con cascade automático ya en v1**: más riesgo (toca
  `reports`/`auth_users` en caliente); se prefirió diferirlo explícitamente
  documentado como riesgo abierto antes que improvisarlo sin decisión de
  Gerencia.

## Referencias

- `db_scripts/50_companies_crud_rbac.sql`
- `backend/src/auth/auth_storage_pg.hpp` / `.cpp` (`AuthCompanyRecord`,
  `listCompaniesAdminPg`, `getCompanyByIdPg`, `createCompanyPg`,
  `updateCompanyPg`, `setCompanyActivePg`)
- `backend/src/auth/auth_routes.cpp`
- `frontend/src/components/ReportStudioV2/components/views/CompanyManagementView.tsx`
- `frontend/src/auth/authApi.ts`
- `frontend/src/App.tsx` (grupo de menú `empresas`, ver ADR-086)
