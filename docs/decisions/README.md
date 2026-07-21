# Architecture Decision Records (ADRs)

Memoria arquitectónica persistente de Beemetry 2.0. Una decisión arquitectónica sin ADR **no existe**.

> Este es el **único log vigente**. Existe un segundo directorio,
> [`specs/adr/`](../../specs/adr/README.md) (12 registros, metodología SDD
> temprana bajo la marca "AURIXA"), que se conserva por trazabilidad histórica
> pero **no recibe decisiones nuevas** — marcado como tal desde 2026-07-13.

## Convención

- Numerados sin gaps: `NNN-slug.md`, **log único cronológico** (orden de decisión, no por tema).
- Cada ADR lleva un campo **`Ámbito`** que indica el dominio al que pertenece: `plataforma`,
  `core-iot`, `datos`, `reports`, `ia`, `geo` (y, a futuro, ámbitos de componentes nuevos como
  `realtime`). El índice de abajo se **agrupa por ámbito**; la numeración sigue siendo global.
- Plantilla mínima: **Contexto / Decisión / Consecuencias / Alternativas descartadas / Referencias**.
- Status: `proposed` | `accepted` | `implemented` | `superseded by NNN` | `deferred` | `partial`.
- Cambiar una decisión NO edita el ADR original: crea uno nuevo con `Supersedes ADR-NNN`, o agrega
  un bloque de "Actualización"/"Corrección de auditoría" fechado ARRIBA del texto original (nunca
  se borra la nota anterior — ver ejemplo real en ADR-022/034).
- Numeración cronológica: una decisión fundacional puede tener número alto (p.ej. ADR-031/034 refinan/reencuadran ADR-002).

> ¿Por qué log único + ámbito y no carpetas por dominio? Las carpetas fragmentarían la
> numeración global y la vista de orden, y complicarían las refs cruzadas entre dominios. El
> campo `Ámbito` da ownership de dominio sin romper el log único, y escala a componentes futuros.

## Índice de ADRs

> **Auditado al 2026-07-13**: 46 ADRs (000-045). La columna Status de esta
> tabla se corrigió para reflejar el estado REAL verificado en cada archivo
> (antes decía "proposed" para casi todos los ADRs 000-035, aunque la
> mayoría ya estaban implementados y verificados en sesiones anteriores —
> la tabla índice había quedado desactualizada respecto al contenido real
> de cada ADR). `implemented` = verificado contra código/stack real
> (rebuild, logs, DB, o navegador real), no solo "se escribió el código".
> Ver el reporte de progreso del proyecto de reportabilidad más abajo.
>
> **Actualización 2026-07-17**: 46 → **54 ADRs**. Se agregaron 8 (046-053),
> todos ámbito `reports`: 4 formalizan decisiones que el código ya tenía
> implementadas desde antes de esta fecha pero sin ADR escrito (046-049 —
> encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y
> 4 documentan trabajo nuevo de esta sesión (050-053 — formato de texto por
> selección, copiar/pegar, navegación/zoom/página, estilos de tabla). De
> paso se corrigió una divergencia real entre documentación y código:
> ADR-010/013 declaraban Tiptap/ProseMirror-JSON para el texto de
> ReportStudioV2, pero el código real (desde antes de esta sesión) usa
> string plano — ver el bloque de "Actualización 2026-07-17" agregado a
> ambos ADR (no se editó el texto original, según la convención de este
> log) y el detalle completo en ADR-050.
>
> **Actualización 2026-07-17 (segunda pasada, mismo día)**: 54 → **55 ADRs**.
> Se agregó ADR-054 (`sync-thingsboard-legacy-aws`, ámbito `core-iot`),
> implementando el entregable "sync inicial con AWS" del release R2 —
> confirmado como una instancia ThingsBoard real, no un servicio AWS
> genérico. No hay conflicto con ADR-034: esa decisión ya anticipaba
> explícitamente que "ThingsBoard puede convivir detrás del gateway mientras
> se estrangula" y solo descartaba el híbrido *permanente*, no la
> coexistencia transitoria — ADR-054 es la implementación concreta de esa
> coexistencia. De paso se encontró y corrigió un bug real preexistente en
> `TelemetryIngestor::enqueue()` (ADR-008): en modo Kafka nunca producía al
> bus, dejando filas varadas en memoria sin insertar ni reportar error — ver
> el bloque de "Actualización 2026-07-17" agregado arriba del texto original
> de ADR-008. Ambos hallazgos se verificaron con una prueba de carga real de
> 6.000.000 de puntos en 10 minutos (~10.000/seg sostenidos) contra un
> ThingsBoard local aislado: 0 errores, 0 pérdida en cola, réplica
> `db_replica` sincronizada al 100% al cierre.
>
> **Actualización 2026-07-20**: 55 → **59 ADRs**. `CHANGELOG.md` ya
> documentaba, con fecha y evidencia de verificación E2E, cuatro bloques de
> trabajo de los días 2026-07-18/19 citándolos como "ADR-055" a "ADR-058" —
> pero ninguno tenía todavía un archivo real en este directorio ni fila en
> este índice (brecha de trazabilidad detectada en la auditoría de
> arquitectura del 2026-07-20, ver el informe de avance de esa fecha). Se
> formalizaron los cuatro con esos mismos números, sin reordenar ni
> renumerar nada ya citado en commits/changelog: **055**
> (`editor-indicador-seleccion-propio`, ámbito `reports`, 2026-07-18),
> **056** (`csp-service-worker-tiles-mapa`, ámbito `geo`, 2026-07-18),
> **057** (`dashboard-widgets-estilo-thingsboard`, ámbito `realtime` —
> primer ADR real de ese ámbito, reservado desde 2026-07-13 sin ADR propio
> hasta hoy, 2026-07-19), **058**
> (`auditoria-seguridad-integral-jul2026`, ámbito `plataforma`, 2026-07-19).
> Se revisó cada uno contra los ADR ya existentes buscando contradicciones:
> ninguna encontrada — 056 extiende el hardening de ADR-043 sin reabrirlo,
> 057 inaugura `realtime` sin chocar con ADR-031, y 058 documenta (dentro de
> su propio bloque PENDIENTE) la misma divergencia de ADR-029 (refresh token
> en `localStorage`) que ya se había cerrado ese mismo día con su propia
> actualización — ver ADR-058 § PENDIENTE para la referencia cruzada
> explícita entre ambos.
>
> **Actualización 2026-07-21**: 59 → **61 ADRs**. Se agregaron **059**
> (`plan-maestro-pruebas-qa`) y **060** (`framework-pruebas-backend-catch2`),
> ambos ámbito `plataforma`, cerrando el entregable contractual "plan
> maestro de pruebas QA" del Sprint S4/R2. No quedaron solo en papel: se
> compiló y corrió el primer target de tests automatizados del backend
> (`beemetry_backend_tests`, Catch2 v3, 27 aserciones/7 test cases, 100%
> passed), y — más importante — se detectó y corrigió un hallazgo real de
> resiliencia operativa: el contenedor `beemetry-api` en ejecución corría
> una imagen construida el 2026-07-20T21:37, **antes** del fix de
> cookies/CSRF de ADR-029 — verificado desde una imagen de prueba aislada
> pero nunca desplegado al sistema real. Se reconstruyó (`docker compose
> build web`) y redesplegó, y se corrió `scripts/smoke-auth-e2e.ps1`
> completo (registro→login→refresh con cookie+CSRF→logout) contra el
> contenedor real ya actualizado: `Resultado: OK`. De paso se corrigieron 2
> bugs reales preexistentes en ese mismo script (campo `token` desactualizado
> tras el cambio a `access_token`; lectura de cookies con un `Path` de URI
> incorrecto que nunca iba a encontrar las cookies de sesión).

### Ámbito `plataforma` — fundaciones transversales
| # | Slug | Status | Resumen |
|---|---|---|---|
| 000 | `rebrand-aurixa-a-beemetry` | ✅ implemented (2026-07-07) | El producto se llama Beemetry; AURIXA/ControlTime/`mapas_backend` deprecados. |
| 001 | `despliegue-soberano-on-prem` | ✅ implemented (2026-07-06) | Todo on-prem (VPS Lima, Docker); sin nube externa para dato crítico. |
| 002 | `backend-cpp-gateway-central` | ✅ implemented (2026-07-06) | Gateway C++ único autenticado; proxy a sidecars (refinado por 031). |
| 004 | `arquitectura-poliglota-cpp-sidecars` | ✅ implemented (2026-07-06) | Hot path C++; IA/ML/CV en sidecars (Python/Ollama/LanguageTool) por HTTP. |
| 023 | `presupuestos-rendimiento-slas` | ✅ implemented, alcance cliente (2026-07-07) | SLAs como restricciones: <20ms, autosave<0.5s, export<5s, 10k, IA<1s, 0% pérdida. |
| 029 | `rbac-identidad-plataforma-jwt` | ✅ implemented, corregido (2026-07-19) | Identidad de plataforma: RBAC multitenant + JWT; login user/pass en v0.1. Refresh token migrado de `localStorage` a cookie `HttpOnly`+CSRF double-submit — ver actualización en el ADR. |
| 030 | `auditoria-100-acciones-server` | ✅ implemented (2026-07-07) | Auditoría 100% autoritativa en servidor, transversal, con hash encadenado. |
| 031 | `backend-plataforma-compartida-multicomponente` | ✅ implemented (2026-07-06) | Backend = plataforma compartida; ReportStudio es el primer componente por prioridad. |
| 033 | `convencion-nombres-prefijos` | ⚠️ partial (2026-07-07) | Estándar de prefijos: `beemetry-*` contenedores, APIs `/api/v1/...`, DBs/tablas/buckets/env. |
| 035 | `plataforma-enterprise-latam` | 📋 proposed (2026-07-12) | Topología edge+hub de 3 niveles para escalar a todas las unidades mineras de LATAM. |
| 036 | `rbac-siete-roles-unificados` | ✅ implemented (2026-07-13) | Reconcilia el RBAC de 4 roles con los 6 de `roleConstants.ts` + `viewer` = 7 roles únicos. |
| 037 | `alta-usuarios-administrada-sin-biometria` | ✅ implemented (2026-07-13) | Admin crea usuarios remotos sin biometría; enrolamiento diferido al primer login presencial. |
| 038 | `delegacion-acceso-tenant-activo-emisor` | ✅ implemented (2026-07-13) | Otorgar/revocar acceso multitenant siempre escopeado al tenant activo de quien lo emite. |
| 040 | `sistema-diseno-navegacion-enterprise` | ✅ implemented (2026-07-13) | Nav unificado slate+ámbar, dos niveles siempre visibles, una sola línea con scroll. |
| 041 | `resiliencia-token-fetch-crudo` | ✅ implemented (2026-07-13) | Refresco automático de token en `fetch()` crudo del dashboard; documenta triplicación de la lógica (consolidada 2026-07-13). |
| 042 | `nomenclatura-menus-lenguaje-llano-minero` | ✅ implemented (2026-07-13) | Renombrado de menús a lenguaje llano para usuarios de operación minera. |
| 043 | `endurecimiento-seguridad-pre-pentest` | ✅ implemented (2026-07-13) | Cierra IDOR crítico en cámaras, endpoints sin auth (GDAL/KPIs), CORS y salt de contraseña (salt rotation documentada, no ejecutada — requiere ventana de mantenimiento). |
| 058 | `auditoria-seguridad-integral-jul2026` | ✅ implemented (2026-07-19) | XSS almacenado (tablas) e IDOR sin auth (`/api/sensors/data`) cerrados y verificados en vivo; CVEs de dependencias a 0; HSTS agregado. Pendiente: pentest externo (sin agendar) y `echarts@6` (CVE moderada, migración deliberada). |
| 059 | `plan-maestro-pruebas-qa` | ✅ accepted, primera fase implementada (2026-07-21) | 5 capas de prueba formalizadas (unit frontend, unit backend, e2e frontend, smoke/integración backend, regresión de cierre de etapa) con cronograma y exit criteria por gate. Verificado en vivo: `smoke-auth-e2e.ps1` extendido corrido de punta a punta contra el `beemetry-api` real, `Resultado: OK`. |
| 060 | `framework-pruebas-backend-catch2` | ✅ implemented, verificado (2026-07-21) | Catch2 v3 (apt) como framework de tests del backend; target `beemetry_backend_tests` cubriendo `http_utils.cpp`. `ctest`: 100% passed; corrida detallada: 27 aserciones en 7 test cases, todas passed. |

**Ámbito `plataforma`: 18/20 implemented, 1 partial, 1 proposed.**

### Ámbito `core-iot` — plataforma IoT del core C++
| # | Slug | Status | Resumen |
|---|---|---|---|
| 003 | `servidor-http-ws-boost-beast` | ✅ implemented (2026-07-06) | HTTP/WS async con Boost.Beast+Asio (C++20), pool ~15k WS. |
| 007 | `ingesta-telemetria-etapa1-libpq` | ✅ implemented (2026-07-06) | Etapa 1: gateway TLS C++ + libpq directo (simulación 10k). |
| 008 | `bus-eventos-redpanda-etapa2` | ✅ implemented (2026-07-07) | Etapa 2: Redpanda + librdkafka + COPY binario para 10k/seg. |
| 027 | `opencv-procesamiento-imagenes` | ✅ implemented, alcance v0.1 (2026-07-06) | OpenCV en v0.1 = imágenes de informe + captura de mapa; EPP diferida (por diseño). |
| 034 | `core-plataforma-iot-reemplazo-thingsboard` | ✅ implemented (actualizado 2026-07-13) | Core C++ = plataforma IoT propia: ingesta + fórmulas + gestión de dispositivos + alarmas + adaptadores MQTT/Modbus/OPC-UA (los adaptadores, dados por diferidos el 2026-07-09, se confirmaron implementados y corriendo el 2026-07-13). |
| 054 | `sync-thingsboard-legacy-aws` | ✅ implemented (2026-07-17) | Conector backfill REST + tiempo real WS que sincroniza el ThingsBoard legacy (hoy AWS) hacia la plataforma propia durante la transición de ADR-034; probado con 6M puntos/10min a 10k/seg. |

**Ámbito `core-iot`: 6/6 implemented.**

### Ámbito `datos` — bases de datos y almacenamiento
| # | Slug | Status | Resumen |
|---|---|---|---|
| 005 | `dos-bases-de-datos-sensors-formula` | ✅ implemented (2026-07-06) | `sensors_db` (TimescaleDB) + `formula_db`/operacional (PostgreSQL). |
| 006 | `timescaledb-hypertables-retencion` | ✅ implemented (2026-07-07) | Hypertables + retención/compresión + continuous aggregates. |
| 009 | `almacenamiento-objetos-minio-parquet` | ✅ implemented (2026-07-08) | MinIO (S3 on-prem) + archivado Parquet del histórico frío. |
| 032 | `timescaledb-instancias-ingesta-lectura` | ✅ implemented (2026-07-06) | Dos instancias Timescale: primaria (ingesta) + réplica read-only vía streaming replication. |

**Ámbito `datos`: 4/4 implemented.**

### Ámbito `reports` — componente ReportStudio ("proyecto de reportabilidad", primero por prioridad)
| # | Slug | Status | Resumen |
|---|---|---|---|
| 010 | `modelo-documento-json-bloques` | ✅ implemented, premisa de texto corregida (2026-07-17) | Documento = JSON tipado de bloques. Texto: string plano + spans (ADR-050) — la premisa original ("ProseMirror-JSON") no aplicaba a ReportStudioV2, ver actualización en el ADR. |
| 011 | `estructura-formal-secciones-cover-toc` | ✅ implemented, alcance revisado (2026-07-07) | Árbol `sections[]` + `cover`/`toc` serializables + `headingStyle`. |
| 012 | `binding-dato-widget-referencia-versionada` | ✅ implemented, alcance acotado (2026-07-07) | Widget = referencia + snapshot versionado; snapshot al firmar (no en cada tick). |
| 013 | `editor-tiptap-konva` | ✅ implemented, alcance corregido (2026-07-17) | Layout de página con Konva (vigente). Texto: Tiptap solo en el módulo "Report" v1 (fuera de ReportStudioV2) — Report v2 usa el modelo de ADR-050, ver actualización en el ADR. |
| 014 | `estado-editor-zustand` | ✅ implemented (2026-07-06) | Store Zustand único (no Redux); límite claro cliente↔servidor. |
| 015 | `versionado-informe-server-autoritativo` | ✅ implemented (2026-07-06) | Versiones/auditoría autoritativas en servidor (`report_content_revision`). Pendiente menor: política de retención del historial. |
| 016 | `export-server-side-asincrono` | ✅ implemented (2026-07-06) | Export canónico server-side (Chromium headless); cliente solo fallback. |
| 017 | `workflow-canonico-informe` | ✅ implemented (2026-07-06) | Máquina de estados única front↔BD (draft→in_review→approved→signed→archived). |
| 018 | `firma-documental-vs-integridad-archivo` | ✅ implemented, alcance v0.1 (2026-07-06) | Firma de aprobación humana (v0.1); hash SHA-256 de integridad diferido a futuro por diseño. |
| 019 | `resolucion-diferida-numeracion-toc-refs` | ✅ implemented, mayormente (2026-07-07) | Numeración/TOC/"Página X de Y" con anclas resueltas en render. |
| 020 | `mapa-bloque-tipado-georeferencia` | ✅ implemented, alcance v0.1 (2026-07-06) | v0.1: snapshot a imagen (popup); bloque tipado con geo-ref real diferido a futuro por diseño. |
| 021 | `ownership-metadatos-ciclo-vida` | ✅ implemented (2026-07-07) | `document.meta.version` (contador local) vs `version_number` (BD, autoritativo) — separación resuelta en la UI. |
| 022 | `offline-cola-versionada-indexeddb` | ✅ implemented — cierre completo (2026-07-13) | Persistencia offline real (SQLite/WASM en vez de IndexedDB) + resolución de conflicto real: concurrencia optimista server-side (`expected_version`/409), prompt de reconciliación al reconectar, y elección sobrescribir-vs-guardar-como-nuevo al guardar. Más: checkpoint forzado cada 3 min en línea (pedido de negocio adicional). |
| 039 | `puente-tenant-id-company-name-informes` | ✅ implemented — migración completa (2026-07-13) | `reports` migrado por completo a `tenant_id` (UUID) como única clave de aislamiento; `company_name` queda solo como display legacy. De paso se corrigió un hallazgo real: `session.tenantId` podía traer un tenant DEMO de fallback para usuarios sin tenant real, evadiendo el chequeo `tenant_required` — cerrado con `userHasRealTenantMembership`. |
| 044 | `exportacion-portatil-cifrada-informes` | ✅ implemented (2026-07-13) | Export/import `.mreport` cifrado AES-256-GCM server-side; mismo tenant sin cambios, otro tenant solo estructura. |
| 045 | `edicion-offline-sqlite-cliente` | ✅ implemented (2026-07-13) | Edición offline: SQLite (sql.js/WASM) local descargada del servidor, banner con fecha/hora del corte, reconciliación al reconectar. |
| 046 | `encabezado-pie-elementos-plataforma-fijos` | ✅ implemented (formalizado 2026-07-17) | Header/footer fijos, no editables; datos de empresa/unidad/usuario calculados en vivo de sesión, nunca en `props`. |
| 047 | `galeria-imagenes-tenant` | ✅ implemented (formalizado 2026-07-17) | Galería de fotos JPEG por tenant, insertable bajo demanda en cualquier página del informe. |
| 048 | `caratula-toda-pagina-imagen-libre` | ✅ implemented (formalizado 2026-07-17) | Carátula ocupa toda la hoja; la foto de empresa es un bloque `image` libre (movible/redimensionable), no un fondo fijo. |
| 049 | `ajuste-texto-alrededor-objetos` | ✅ implemented, extendido (2026-07-17) | 7 modos de ajuste de texto estilo Word alrededor de objetos; extendido para soportar formato mixto (spans, ADR-050) dentro del texto que envuelve. |
| 050 | `formato-texto-por-seleccion-spans` | ✅ implemented (2026-07-17) | Negrita/cursiva/subrayado/color/tamaño/fuente aplicables solo al texto seleccionado (spans sobre string plano) — corrige la premisa ProseMirror de ADR-010/013. |
| 051 | `copiar-pegar-objetos-lienzo` | ✅ implemented (2026-07-17) | Copiar/pegar de bloques dentro del mismo lienzo (portapapeles interno de la app, no del sistema operativo). |
| 052 | `navegacion-zoom-tamano-pagina` | ✅ implemented (2026-07-17) | Navegación de teclado (PageUp/PageDown/flechas), zoom 10%-400%, tamaño de hoja/orientación configurable por página individual. |
| 053 | `estilos-visuales-tabla` | ✅ implemented (2026-07-17) | Galería de temas de color, filas alternadas, bordes configurables, título de tabla; formato por selección en celdas (`contentEditable`+`execCommand`). |
| 055 | `editor-indicador-seleccion-propio` | ✅ implemented (2026-07-18) | Indicador de selección propio (ya no el nativo del navegador) para que el resaltado escale correctamente con tamaño de fuente mixto por tramo; resaltado y ciclo de mayúsculas llevados al mismo criterio "selección o bloque completo" de ADR-050. |

**Ámbito `reports`: 25/25 implemented sin reservas — ver "Progreso del proyecto de reportabilidad" abajo.**

### Ámbito `ia` — inteligencia artificial local
| # | Slug | Status | Resumen |
|---|---|---|---|
| 024 | `ia-local-ollama-languagetool` | ✅ implemented (2026-07-06) | IA de redacción local: Ollama + LanguageTool (es-PE); nada en la nube. |
| 025 | `biometria-vision-epp-diferidas` | 🚫 deferred, confirmado (2026-07-06) | Biometría/EPP diferidas por restricción legal (no persistir sin base legal). |

**Ámbito `ia`: 1/2 implemented, 1 deferred por diseño (no cuenta como pendiente).**

### Ámbito `geo` — cartografía y geoespacial
| # | Slug | Status | Resumen |
|---|---|---|---|
| 026 | `cartografia-offline-mbtiles-maplibre` | ✅ implemented (2026-07-07) | Mapas offline MBTiles + mbtileserver + MapLibre GL (Leaflet deprecado). |
| 028 | `gdal-conversion-raster-diferida` | 🚫 deferred, confirmado (2026-07-06) | Conversión raster GDAL diferida a versión futura; v0.1 usa MBTiles. |
| 056 | `csp-service-worker-tiles-mapa` | ✅ implemented (2026-07-18) | CSP dedicada para el Service Worker de cacheo de tiles (`tile-cache-sw.js`) — la CSP general de la SPA rompía el 100% de los tiles externos; timeout adaptativo + catálogo WMS saneado. |

**Ámbito `geo`: 2/3 implemented, 1 deferred por diseño (no cuenta como pendiente).**

### Ámbito `realtime` — visualización de datos en tiempo real
| # | Slug | Status | Resumen |
|---|---|---|---|
| 057 | `dashboard-widgets-estilo-thingsboard` | ✅ implemented (2026-07-19) | Gauge radial, tarjetas de agregación y doughnut de estado en Monitoreo→Sensores, alimentados por `/api/sensors/data` real (no telemetría simulada). Primer ADR de este ámbito. |

**Ámbito `realtime`: 1/1 implemented.**

### Ámbitos futuros (componentes por venir)
- *(otros componentes se agregan acá a medida que surgen)*

---

## Progreso del proyecto de reportabilidad (ámbito `reports`)

Cálculo basado **en los 25 ADRs de ámbito `reports` redactados hasta hoy**
(010-022, 039, 044-053, 055) — no incluye trabajo futuro sin ADR todavía, ni
los gates de release que no son decisiones arquitectónicas (pentest, QA
funcional, GO-LIVE — ver más abajo, se rastrean aparte).

| Estado | ADRs | Peso |
|---|---|---|
| Implementado sin reservas (incl. alcance v0.1 explícitamente reducido por diseño) | 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 039, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 055 | 25 × 1.0 = 25.0 |
| **Total** | **25 ADRs** | **25.0 / 25** |

### → **Avance del proyecto de reportabilidad: 100%** (25 / 25 ADRs planificados)

**Actualización 2026-07-20**: se agregó ADR-055 (`editor-indicador-seleccion-propio`,
formalizando un bug fix del 2026-07-18 que no tenía ADR escrito — ver §
"Actualización 2026-07-20" arriba del índice). El proyecto de reportabilidad
sigue al 100%; no cambia el avance, solo el conteo total de ADRs que lo
respaldan.

**Actualización 2026-07-17 (tercera pasada)**: se agregaron 8 ADRs nuevos
(046-053) — 4 formalizan decisiones ya implementadas sin ADR escrito
(encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y 4
documentan trabajo nuevo de esta sesión: formato de texto por selección
(negrita/color/tamaño/fuente solo en la porción seleccionada, corrigiendo
de paso una premisa incorrecta de ADR-010/013 sobre Tiptap/ProseMirror),
copiar/pegar de objetos en el lienzo, navegación de teclado + zoom
10%-400% + tamaño de hoja por página, y estilos visuales de tabla. Los 24
ADRs de `reports` siguen al 100% — ninguno quedó parcial.

**Actualización 2026-07-13 (segunda pasada, misma fecha)**: ADR-022 se cerró
por completo — era el único ADR de `reports` que quedaba parcial. El negocio
pidió explícitamente resolver el pendiente documentado ("falta resolución de
conflicto por version-base"): ahora, si otra terminal actualiza un informe
mientras esta edita sin conexión, al reconectar se detecta el conflicto real
(concurrencia optimista server-side, `409 version_conflict`, verificado
contra el backend real) y se pregunta explícitamente al usuario si quiere
traer la versión del servidor o seguir con su copia offline — y si sigue,
al guardar puede elegir sobrescribir o guardar como informe nuevo (nunca se
pierde trabajo silenciosamente). Se agregó además un checkpoint forzado cada
3 minutos en línea, pedido de negocio adicional no contemplado en el ADR
original. Ver ADR-022 para el detalle técnico completo y la verificación
end-to-end (backend real + navegador real, sin recargar la página, con una
"segunda terminal" real vía HTTP directo).

**Con esto, los 16 ADRs planificados del proyecto de reportabilidad están
100% implementados y verificados.** No queda ningún ADR parcial en este
ámbito.

Fuera del cálculo de ADRs (no son decisiones arquitectónicas) pero
**bloqueante para el release real** — backlog operativo:
- Pentest de seguridad pre-release (pendiente, no iniciado).
- QA funcional formal v0.1 (cobertura parcial vía smoke tests repetidos;
  falta un pase exhaustivo firmado).
- Release v0.1: Deploy + Documentación + GO-LIVE formal.

### Fecha referencial de término

**Estimado: fines de julio 2026 (referencial, no comprometido)** — con el
100% de los ADRs de reportabilidad ya cerrados, lo único que queda es el
backlog operativo de arriba:
- Pentest externo: típicamente 1-2 semanas de calendario una vez agendado
  (no iniciado a la fecha de este reporte — es el mayor y único factor de
  incertidumbre real de la fecha; ya no depende de trabajo de desarrollo).
- QA funcional + GO-LIVE: 3-5 días una vez el pentest no tenga hallazgos
  críticos abiertos.

Si el pentest se agenda esta semana, **2026-07-31** sigue siendo una fecha
objetivo razonable. Si se demora en agendarse, la fecha se corre en la misma
medida — es el único paso de este plan que no depende del equipo de
desarrollo.

---

## Cómo agregar un ADR nuevo

1. Numerar al siguiente disponible (sin reciclar números, aunque haya ADRs `superseded`).
2. Crear archivo `NNN-slug-corto.md` con el campo **`Ámbito`** en la cabecera.
3. Agregar fila al índice, en el grupo de su ámbito.
4. Mencionar en el commit con `Refs ADR-NNN`.
5. Si supersede uno anterior: editar el anterior agregando `Status: superseded by ADR-NNN` y la fecha.
