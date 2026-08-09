# ADR-000 — Rebrand AURIXA → Beemetry (nombre canónico del producto)

**Status**: implemented (ejecutado 2026-07-07, tras quedar "accepted, not executed" desde 2026-06-24). Ejecutado como una tarea propia y verificado con rebuild+redeploy real del stack completo, según lo que este mismo ADR pedía ("se planifica como tarea de Sprint 0, no se hace ad-hoc"):
- `platformBrand.config.ts::PLATFORM_NAME` = `'Beemetry'` (antes `'AURIXA'`).
- Los 5 textos hardcodeados encontrados (`App.tsx`, `FormulaEngineEmbed.tsx`, `CoverPage.tsx` ×2, `exportEngine.ts` ×3) corregidos a Beemetry.
- Target CMake `mapas_backend` → `beemetry_backend` (+ `entrypoint.sh`, `docker-compose.e2e-verify.yml`, comentario en `docker-compose.yml`).
- `package.json` → `name: "beemetry-frontend"`.
- Los 14 `container_name` de `docker-compose.yml` → prefijo `beemetry-*`. Verificado ANTES de aplicar que `container_name` no tiene ningún acoplamiento con `depends_on` (usa la clave de servicio YAML, no `container_name`) ni con el proxy de `nginx.conf` (usa el alias de red explícito `backend`, definido aparte) — el rename es puramente cosmético/de visualización (`docker ps`/`docker logs`), sin riesgo funcional. Stack completo (14 servicios) reconstruido y redesplegado; todos `healthy` tras el cambio.
- Deliberadamente NO tocado (per la propia regla de este ADR: "los documentos legacy en `Referencias/` NO se reescriben"): SOW, cronogramas, y demás material histórico de negocio.
- Deliberadamente NO tocado (fuera de alcance de un rebrand de naming): el asset `aurixa-logo.svg` en sí (el archivo de arte del logo es una decisión de diseño visual, no de naming/código — no existe un logo Beemetry alternativo provisto para reemplazarlo).
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El código y la documentación de `Referencias/` arrastran cuatro nombres simultáneos: la carpeta raíz `Beemetry2.0`, el dominio `@beemetry.net`, el producto **AURIXA** (en `frontend/src/brand/platformBrand.config.js`, en todo el SOW y la arquitectura v36) y el legacy **ControlTime** (explícitamente "reemplazado en v36"). Además, el target CMake se llama `mapas_backend` y el `package.json` del frontend `mining-report-system-frontend`. Esta ambigüedad de naming contamina cada decisión: configs, branding, nombres de servicios Docker, contratos de API y documentación heredan la inconsistencia.

## Decisión

El **nombre canónico del producto es Beemetry**. Beemetry es a la vez la empresa y el producto; "Beemetry 2.0" designa esta reconstrucción ordenada (spec-driven) del proyecto. AURIXA y ControlTime quedan **deprecados** como nombres anteriores. Todo branding, configs, nombres de servicios y documentación nueva usan Beemetry.

### Reglas concretas

- `platformBrand.config.js` expone `PLATFORM_NAME = 'Beemetry'` como única fuente de verdad; ningún componente hardcodea el nombre (ver `CoverPage.jsx`, que hoy fija `'AURIXA Mining Corporation'`).
- Renombrar el target CMake `mapas_backend` → `beemetry_backend` y el `package.json` `name` → `beemetry-frontend`.
- Servicios Docker y workers se renombran al prefijo `beemetry-` (p.ej. `aurixa-gis-raster` → `beemetry-gis-raster`).
- Los documentos legacy en `Referencias/` NO se reescriben (son material histórico); el renaming aplica solo al código y docs nuevos del proyecto ordenado.

## Consecuencias

### Positivas
- Una sola identidad de producto elimina ambigüedad en código, infra y comunicación.
- El branding centralizado en config evita la re-aparición de nombres hardcodeados.

### Negativas / Trade-offs
- Trabajo de renombrado transversal (configs, CMake, package.json, docker-compose) — se planifica como tarea de Sprint 0, no se hace ad-hoc.
- Riesgo de referencias rotas durante la transición; se mitiga con un grep audit (ver Phase 12 del bootstrap).

### Neutras
- Los docs de negocio (SOW, cronogramas) seguirán diciendo "AURIXA" hasta que se reemiten; no es bloqueante.

## Alternativas descartadas

### Mantener AURIXA en todo
AURIXA está más presente en docs de negocio y en `platformBrand.config.js`. Se descartó porque la decisión del dueño del producto es que la marca es Beemetry; mantener AURIXA perpetuaría la divergencia con el dominio y la carpeta.

### Dejar el naming sin resolver
Postergar la decisión deja a cada ADR y cada servicio heredando la ambigüedad. Inaceptable: el naming es fundacional.

## Referencias
- `docs/specs/product-brief.md` (nota de naming)
- `Referencias/frontend/src/brand/platformBrand.config.js`
- ADR-033 (convención de nombres y prefijos que operacionaliza este rebrand)
- `plan.md` § 1 (estructura del repositorio)
