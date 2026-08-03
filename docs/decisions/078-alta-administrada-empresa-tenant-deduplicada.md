# ADR-078 — Alta administrada de empresa con tenant real y deduplicación

**Status**: implemented, probado y desplegado localmente (2026-07-29)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: plataforma
**Relación**: completa ADR-037/066/067; respeta ADR-029/036/038/043/075.

## Contexto

El catálogo público `GET /api/auth/companies` permitía seleccionar una minera
en login/registro, pero no existía un alta administrada. Agregar nombres por
SQL podía duplicar razones sociales por espacios o mayúsculas y crear una
entrada sin tenant operativo.

## Decisión

1. `POST /api/auth/companies` requiere JWT vigente y rol `admin`.
2. La razón social se recorta, se limita a 2–180 caracteres y se compara con
   `lower(btrim(name))`; un duplicado devuelve HTTP 409 con el nombre canónico.
3. Antes de publicar el catálogo se crea/resuelve un tenant real mediante la
   ruta canónica de ADR-067 y se vincula al administrador creador.
4. El alta se audita como `company_create`; la API nunca acepta un `tenant_id`
   suministrado por el cliente.
5. El frontend expone `createCompany(name)` usando el cliente autenticado
   canónico. El smoke usa un duplicado conocido para verificar 409 sin dejar
   empresas de prueba persistidas.

## Compatibilidad

- ADR-066 mantiene `company` como razón social de la minera, no del
  contratista.
- ADR-067 sigue siendo el único aprovisionador de tenant y membresía.
- ADR-038 evita que el cliente elija arbitrariamente el tenant.
- ADR-075 obtiene el catálogo actualizado sin cambiar país/idioma.

## Evidencia

- `backend/src/auth/auth_routes.cpp`
- `frontend/src/auth/authApi.ts`
- `scripts/smoke-auth-e2e.ps1`
- Imagen backend `3c6acc4d30a1` y frontend `32a8977e4138` desplegadas en
  local.
- Smoke E2E del 2026-07-29: registro, login password, login facial,
  deduplicación `POST /api/auth/companies` con HTTP 409 case-insensitive,
  auditoría, CSV, refresh CSRF y logout.
- Build C++ con Catch2/CTest; TypeScript, Vitest y build frontend.
