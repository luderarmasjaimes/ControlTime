# ADR-047 — Galería de imágenes por tenant, insertable bajo demanda en el informe

**Status**: implemented (verificado 2026-07-17 contra `tenantGallery.ts`, `ImageInsertModal.tsx`, backend `tenant_assets_routes.cpp`)
**Fecha**: 2026-07-11 (aprox., a partir de comentarios de código; formalizado retroactivamente el 2026-07-17)
**Autores**: EC
**Ámbito**: reports

## Contexto

Los informes técnicos necesitan fotografías reales de la unidad minera (frentes de explotación, instalaciones, equipos) — no solo íconos o imágenes cargadas manualmente cada vez. El negocio pidió una galería reutilizable por tenant, para que el mismo set de fotos de la unidad esté disponible al insertar imágenes en cualquier informe/página, sin tener que volver a subir el archivo cada vez.

## Decisión

Se agrega una tabla `tenant_gallery_image` (backend, `tenant_assets_routes.cpp`) con las fotos JPEG de cada tenant, expuesta al frontend vía `tenantGallery.ts`. El modal de inserción de imagen (`ImageInsertModal.tsx`) gana una pestaña **"Galería"** — distinta de "Archivo" (subir del disco) — que lista las fotos ya guardadas del tenant real de la sesión (`telemetryTenantId` es un campo aparte, no confundir: la galería usa el tenant de la empresa/auth, no el de telemetría).

### Reglas duras
- La galería es por `tenant_id` real (auth), aislada igual que el resto de datos multitenant — un tenant nunca ve fotos de otro.
- Insertar desde galería reutiliza el mismo flujo de bloque `image` libre que subir desde archivo (ver ADR-048) — no hay un tipo de bloque especial "imagen de galería".

## Consecuencias

### Positivas
- Evita re-subir la misma foto institucional en cada informe nuevo.
- Reduce el tamaño de cada `.miningreport` si en el futuro se referencia por ID en vez de embeber base64 (optimización no implementada aún, ver Trade-offs).

### Negativas / Trade-offs
- Hoy el bloque `image` sigue guardando el `src` embebido (data URL o `@ref:binary_N` al exportar, ADR-010) en vez de una referencia liviana `@ref:gallery_image_id` — insertar desde galería no ahorra peso de documento todavía, solo el paso de "buscar el archivo en tu computadora". Optimización pendiente, no bloqueante.

## Alternativas descartadas

### Bloque de tipo `gallery-image` separado con referencia liviana
Más eficiente en tamaño de documento, pero exige un tipo de bloque nuevo con su propio ciclo de vida (¿qué pasa si se borra la foto de la galería pero el informe firmado la referenciaba?) — la resolución de esa pregunta (referencia vs. copia inmutable) no estaba definida a tiempo; se pospuso a favor de reusar el modelo `image` existente, más simple y ya auditado.

## Referencias
- `frontend/src/components/ReportStudioV2/lib/tenantGallery.ts`
- `frontend/src/components/ReportStudioV2/components/modals/ImageInsertModal.tsx`
- `backend/src/*/tenant_assets_routes.cpp`
- ADR-010 (modelo de bloques), ADR-048 (carátula e inserción de imagen libre)
