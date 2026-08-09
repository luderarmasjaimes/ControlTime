# ADR-044 — Exportación/importación portátil cifrada de Informe Técnico (.mreport)

**Status**: accepted (implementado y verificado 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: reports

> Permite trasladar un Informe Técnico completo entre terminales de la misma
> unidad minera en un solo archivo, sin depender de que ambas terminales
> tengan conexión simultánea al mismo backend en ese momento — pero protege
> los datos operativos de una unidad minera si el archivo termina en manos de
> otra unidad distinta (traslado accidental, USB compartido, etc).

## Contexto

Ya existía un intento previo puramente client-side (`miningReportFormat.ts`,
`.miningreport`): JSON plano + base64, firmado con SHA-256 pero **sin
cifrado real** (cualquier editor de texto lo abre) y **sin ningún concepto de
tenant** — importarlo en cualquier otra empresa mostraba el informe completo,
imágenes y KPIs incluidos. Se reemplaza por completo por un contenedor
`.mreport` generado y descifrado siempre en el backend.

## Decisión

### Cifrado — por qué vive solo en el backend
AES-256-GCM con clave derivada (SHA-256) de `BEEMETRY_REPORT_EXPORT_KEY`
(literal permitido solo en desarrollo; `docker-compose.prod.yml` exige
`BEEMETRY_REPORT_EXPORT_KEY`). La clave **nunca llega al frontend**: si viviera en el
bundle JS, cualquier usuario podría extraerla y descifrar el archivo con un
script propio, incumpliendo el requisito de que el archivo "no debe poder
abrirse por otra aplicación, solo por la unidad minera". Por diseño, a
diferencia de `JWT_SECRET`, esta clave **no puede ser efímera**: un archivo
exportado hoy debe importarse en cualquier terminal que hable con el mismo
backend, incluso tras un reinicio — debe fijarse a un valor estable en
producción.

### Redacción por tenant — criterio por tipo de bloque
Al importar, el backend compara el `tenant_id` (o `company_name` para
sesiones legacy sin tenant real — mismo criterio que
`auth::userBelongsToTenant`, ADR-038/039/043) embebido en el archivo contra
el del usuario que importa:

- **Coincide** → documento devuelto sin ningún cambio.
- **No coincide** → se redactan por defecto todos los bloques con datos
  operativos de la unidad de origen, conservando únicamente su
  posición/tamaño/tipo (estructura):
  - `image`, `map`: se limpia `src` (el frontend ya cae a su placeholder
    estándar — `reportImageSrc.ts` — cuando `src` está vacío, no hizo falta
    duplicar ese SVG en el backend).
  - `chart`, `kpi`, `sensor`: `props` se reemplaza por un marcador neutro
    (`title: "[No disponible - pertenece a otra unidad minera]"`), sin
    `kpiCode`/`sensorId`/`source` — así tampoco queda una referencia que el
    frontend pudiera intentar resolver contra la API de otro tenant.
  - `cover`: es el único tipo mixto — conserva `title`/`author`/`date`/
    `classification` (genéricos del informe) pero blanquea `company`/`unit`/
    `docCode` (identifican la unidad de origen).
  - `text`, `table`, `toc`: **nunca se tocan**, en ningún escenario — es la
    autoría directa del usuario (párrafos, celdas escritas a mano, TOC
    autogenerado), tal como pidió el negocio explícitamente.
  - Cualquier tipo de bloque futuro no listado arriba cae en la rama
    "redactar por defecto" (conservador): un bloque nuevo que alguien agregue
    a `useEditorStore.ts` sin actualizar `report_portable.cpp` queda protegido
    por default en vez de fugarse por omisión.

### Optimización de tamaño
Las imágenes (`data:<mime>;base64,...`) se extraen del JSON, se decodifican a
bytes crudos y se guardan en una sección binaria aparte dentro del mismo
contenedor cifrado — evita el ~33% de inflado que deja el base64 embebido
como texto. No se agregó compresión zlib/gzip (habría requerido una nueva
dependencia de build, `find_package(ZLIB)`, no presente hoy en el proyecto)
— queda como mejora futura si el tamaño de informes reales lo justifica.

### Formato del contenedor (no es un ZIP)
`MAGIC(8) || IV(12) || TAG_GCM(16) || CIPHERTEXT`. El texto plano cifrado es
`[u32 lenMeta][meta JSON][u32 binCount][por binario: u32 lenMime|mime|u32
lenData|datos crudos]`. Deliberadamente no es un formato reconocible (no ZIP,
no un Content-Type estándar — se sirve como `application/octet-stream` con
`X-Content-Type-Options: nosniff`): no hay herramienta genérica que pueda
abrirlo, solo `reports::portable::importReport` de este mismo backend.

## Consecuencias

### Positivas
- Cumple el requisito de negocio íntegro: mismo tenant → sin cambios; tenant
  distinto → solo estructura, dato operativo protegido; texto siempre igual.
- Verificado extremo a extremo contra el backend real (no solo unitario):
  crear informe con los 9 tipos de bloque existentes → exportar → importar
  como mismo usuario (idéntico, `tenant_match=true`) → importar como usuario
  de otra empresa sin tenant compartido (`tenant_match=false`, imagen/mapa con
  `src` vacío, kpi/chart/sensor con placeholder neutro, texto/tabla/toc y
  título/autor de portada intactos, company/unit/docCode de portada vacíos).
- Reemplaza por completo la implementación anterior sin cifrado real
  (`miningReportFormat.ts`, eliminado) — no queda un camino paralelo inseguro.

### Negativas / Trade-offs
- Exportar exige que el informe ya esté guardado (id real) — a diferencia
  del intento anterior no hay fallback 100% cliente, porque cifrar sin la
  clave del servidor no cumpliría el requisito de seguridad.
- `BEEMETRY_REPORT_EXPORT_KEY` sin fijar en producción dejaría los `.mreport`
  atados a un literal de desarrollo conocido — mismo tipo de deuda ya
  documentada para el salt de contraseña (ADR-043): advertencia en logs, no
  autocorregible sin una decisión operativa de fijar la variable.
- Sin compresión general (solo el ahorro de-base64 en imágenes); informes muy
  extensos en texto no se benefician de una reducción adicional.

## Alternativas descartadas

### Mantener el cifrado/firma en el cliente (como el `.miningreport` anterior)
No puede cumplir "no debe poder abrirse por otra aplicación" de forma real:
cualquier clave o lógica de descifrado en el bundle JS es extraíble por el
propio usuario. Se descartó en favor de mover todo el ciclo cifrado al
backend.

### ZIP real con contraseña
Un ZIP cifrado es abrible por cualquier gestor de archivos si se conoce (o se
fuerza) la contraseña, y no permite decidir la redacción por tenant sin antes
descifrar del lado del cliente. El contenedor propietario a medida resuelve
ambos problemas a la vez.

## Referencias
- `backend/src/reports/report_portable.hpp/cpp` (cifrado + redacción, nuevo)
- `backend/src/reports/report_routes.cpp` (`GET .../export/portable`,
  `POST /api/reports/import/portable`)
- `backend/src/http/http_utils.hpp/cpp` (`makeOctetResponse`, nuevo)
- `frontend/src/components/ReportStudioV2/lib/api.ts`
  (`fetchReportPortableBlob`, `importReportPortable`)
- `frontend/src/components/ReportStudioV2/App.tsx` (handlers de export/import)
- `frontend/src/components/ReportStudioV2/lib/miningReportFormat.ts`
  (eliminado — reemplazado por este ADR)
- ADR-038/039/043 (mismo criterio de verificación de tenant/company)
