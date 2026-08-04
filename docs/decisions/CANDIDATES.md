# ADR Candidates — scratch (Phase 1)

> **Archivo histórico congelado.** Conserva el scratch previo a la adopción
> formal; no representa decisiones vigentes ni debe usarse para calcular
> estado. La autoridad actual es [`README.md`](README.md) y los ADR numerados.

> Lista de trabajo. No son ADRs finales (eso es Phase 3). Marca qué está ya decidido en
> el código/docs de `Referencias/` (solo documentar) vs qué es **decisión abierta** que
> requiere postura del developer. Numeración provisional; la final se asigna en Phase 3.

Leyenda de estado:
- `DOC` = ya implementado/documentado en v36, el ADR solo lo formaliza.
- `OPEN` = decisión load-bearing con doubt o tensión con una promesa dura → necesita postura.
- `NEW` = decisión nueva surgida del bootstrap.

## Familia A — Fundaciones de plataforma

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| A1 | Backend C++ como gateway central (no microservicios dispersos) | DOC | El backend Boost.Beast concentra auth, ruteo y proxy a los servicios satélite (formula, ai_engine, languagetool, tileserver). Alt: API gateway dedicado (Kong/Nginx+); descartado por latencia y soberanía. |
| A2 | HTTP/WS server con Boost.Beast + Asio (C++20) | DOC | Servidor async propio. Alt: Drogon/Crow/oatpp; descartado por control fino de WS a 10k y cero deps de framework. |
| A3 | Despliegue soberano on-prem (VPS Linux Lima, Docker, 8 servicios) | DOC | Todo el stack on-prem; sin nube externa para dato crítico. Eje de la promesa de soberanía. |
| A4 | Rebrand AURIXA → **Beemetry** (deprecación de ControlTime y `mapas_backend`) | NEW | Nombre canónico del producto = Beemetry. Renombrar branding, configs, target CMake, package.json. |

## Familia B — Datos y telemetría

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| B1 | Dos bases de datos: `sensors_db` (TimescaleDB) + `formula_db` (PostgreSQL) | DOC | Separación telemetría vs negocio/fórmulas. Alt: una sola DB; tradeoff de acoplamiento. |
| B2 | **Hypertables + políticas de retención/compresión** (hot/histórico) | OPEN | Hoy `mineria_lecturas` y `mining_sensor_history` son tablas planas, sin retención ni compresión. Decisión: plan de migración a hypertables + continuous aggregates + retención 2-7 años. |
| B3 | **Pipeline de ingesta a 10k sensores/seg** | OPEN | Hoy inserción `libpq`. Doc de optimización recomienda librdkafka/Redpanda + COPY binario. Decisión: ¿Redpanda desde v0.1 o libpq+COPY y Redpanda en hardening? |
| B4 | Almacenamiento de objetos soberano (MinIO) + archivado Parquet | DOC/OPEN | MinIO para archivos/objetos; archivado de histórico frío a Parquet. Confirmar si entra en v0.1. |

## Familia C — ReportStudio (núcleo de valor)

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| C1 | **Modelo del documento de informe** (cómo se representa un .miningreport) | OPEN | ¿JSON tipado de bloques? ¿HTML? ¿árbol Tiptap serializado? Es la decisión central — sostiene trazabilidad y WYSIWYG. |
| C2 | **Binding dato→widget (trazabilidad en vivo)** | OPEN | ¿El widget (SensorWidget/MiningKpiWidget) guarda snapshot al insertar, re-consulta en vivo, o referencia versionada? Sostiene la promesa #2. |
| C3 | Editor de texto = Tiptap/ProseMirror; página = Konva canvas | DOC | Texto enriquecido con Tiptap; layout de página/posicionamiento con Konva. Alt: Slate/Lexical, DOM puro. |
| C4 | Estado del editor = Zustand store único (`useEditorStore`) | DOC | Store central. Confirmar límites (qué vive en store vs server). |
| C5 | **Versionado + auditoría del informe** | OPEN | VersionHistory/VersionComparator existen client-side. Decisión: ¿versionado autoritativo en server (inmutable) o client? Sostiene trazabilidad/auditoría. |
| C6 | **Export server-side canónico (PDF/DOCX <5s) vs fallback cliente** | OPEN | exportEngine tiene `/api/export` + fallback `window.print()`/html2canvas. Decisión: cuál es la fuente de verdad del WYSIWYG. |

## Familia D — Offline y tiempo real

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| D1 | **Modo offline + reconciliación con 0% pérdida** | OPEN | Hoy cola en localStorage + polling /api/health. Decisión: modelo de cola, resolución de conflictos y garantía de durabilidad. Sostiene la promesa #1. |
| D2 | Autoguardado incremental (<0.5s) vía WebSocket | DOC | autosaveEngine cada 5s + retry. Confirmar SLA. |
| D3 | Latencia de pantalla <20 ms (presupuesto de rendimiento) | DOC | Promesa O1. Se vuelve criterio de hito, no solo decisión. |

## Familia E — IA local y geo

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| E1 | IA local: Ollama (reescritura) + LanguageTool (ortografía es-PE) | DOC | LLM y corrección locales, sin nube. Promesa O6 (<1s/párrafo). |
| E2 | **Biometría diferida por requisitos legales** (no v0.1) | NEW | No persistir datos biométricos sin base legal validada por país. Capacidad latente, no activa. |
| E3 | Visión EPP / ONNX en C++ (eliminar salto Python) | OPEN | Optimización propuesta; ligada a biometría → probablemente difiere con E2. |
| E4 | **GDAL: subprocess CLI vs librería enlazada** | OPEN | Hoy invoca `gdal_translate`/`gdaladdo` como subprocess (frágil ante PATH). Decisión: enlazar GDAL C++ o mantener CLI con contrato robusto. |
| E5 | Mapas offline: MBTiles + mbtileserver + MapLibre GL | DOC | Cartografía soberana sin internet. Alt: Leaflet (presente como secundario). |

## Familia F — Seguridad y acceso

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| F1 | RBAC multitenant + JWT (login usuario/contraseña en v0.1) | DOC | Roles, tenants/regiones, sesiones JWT. |
| F2 | Auditoría 100% de acciones (trazabilidad O7) | DOC/OPEN | auditTrail client-side existe; decisión: auditoría autoritativa en server. |

---

## Resoluciones (Phase 1 — confirmadas con el developer 2026-06-24)

Decisiones load-bearing tomadas:

- **C1 — Modelo del documento = JSON tipado de bloques.** El informe es un árbol de bloques
  tipados (texto, tabla, widget-sensor, mapa, KPI) con layout; el texto rico vive como
  ProseMirror-JSON dentro del bloque de texto. Habilita trazabilidad por-bloque, WYSIWYG
  determinista y export reproducible. (Alt descartadas: árbol Tiptap único; HTML canónico.)
- **C2 — Binding dato→widget = referencia versionada + snapshot.** El widget guarda referencia
  a la query/sensor **y** snapshot del valor citado (timestamp+versión). Informe reproducible
  y trazable; "refrescar" es explícito y crea nueva versión. (Alt: snapshot puro; live query.)
- **D1 — Offline = cola de operaciones versionada + conflicto explícito.** Cada cambio lleva
  versión-base; el server aplica si coincide, si no marca conflicto para resolución manual
  (sin auto-merge silencioso). Durabilidad en **IndexedDB** (migrar desde localStorage).
  (Alt descartadas: last-write-wins; CRDT por sobre-ingeniería para v0.1.)

Resueltas vía los docs v36 (el ADR las formaliza, no son dilema):

- **B2 — Retención/compresión Timescale**: políticas definidas como objetivo (hot 30-45d,
  compresión >7d, Parquet→MinIO, continuous aggregates); **implementación = tarea de sprint**
  (BE3, S9-S11), no decisión abierta.
- **B3 — Ingesta 10k**: libpq directo en Etapa 1; **Redpanda + librdkafka + COPY binario en
  Etapa 2** (S9-S12). Es secuenciamiento, no dilema.
- **C5 — Versionado/auditoría**: **servidor autoritativo** (`report_content_revision`,
  `platform_audit_log`). Resolución de conflictos de edición concurrente → cubierta por D1.
- **C6 — Export**: **server-side, job asíncrono con worker** (no bloquea ruta caliente C++).
  El fallback cliente (print/html2canvas) NO es canónico; queda solo como degradación offline.
- **F2 — Auditoría**: autoritativa en server (no client-side como hoy).

Diferido:

- **E4 — GDAL / conversión raster**: **diferido a versión futura** (requiere análisis más
  detallado: subprocess vs librería enlazada, escalado del worker `gis-raster`). Fuera de v0.1.
  Los mapas de v0.1 usan MBTiles/MapLibre ya servidos.

## Transversales añadidos (Phase 1 — feedback del developer)

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| A5 | **Arquitectura políglota: C++ core + sidecar Python (ML/CV) por HTTP** | NEW | El hot path (telemetría, WS, auth, ruteo) es 100% C++. La IA/ML/CV vive en sidecars (Python `ai_engine`, Ollama, LanguageTool) que el gateway C++ invoca por HTTP. **En v0.1 el sidecar Python está activo** para IA no-biométrica + scripts utilitarios (`image_optimizer.py`); la función biométrica del sidecar queda **latente** (difiere con E2). Alt descartadas: embeber Python en C++; reescribir modelos en C++ (solo se hará selectivamente en hardening, p.ej. ONNX C++). |
| B5 | **Bus de eventos / streaming: Redpanda + librdkafka (Etapa 2)** | DOC | Bus para desacoplar picos de telemetría, back-pressure y resiliencia a 10k sensores/seg; topics por tenant/zona; consumidor C++ persiste con COPY binario. **Etapa 2 (S9-S12)**; en Etapa 1 la ingesta es libpq directo (ver B3). Se explicita como ADR propio (estaba implícito en B3). |
| E6 | **OpenCV / procesamiento de imágenes y visión** | NEW | En v0.1: optimización/composición de imágenes del informe y captura de mapa→imagen (RAII wrappers `opencv_raii`). La **visión EPP/biométrica** (clasificadores, liveness, `vision_pipeline` completo) **difiere** junto con E2/E3. ONNX C++ para inferencia se evalúa en hardening. |

---

## Familia G — Estructura formal del informe (NUEVOS, surgidos en Phase 2)

Validación de C1 contra el formato real (`.miningreport`) + manuales operativos. El modelo
cubre el cuerpo multipágina pero NO la estructura formal del informe técnico. Gaps → ADRs:

| # | Candidato | Estado | Resumen |
|---|---|---|---|
| C1b | **Extensión del modelo: árbol de `sections[]` + `cover`/`toc` como bloques serializables + `headingStyle` en bloques text** | NEW | Hoy solo páginas planas. Se agrega un árbol semántico de secciones; cover y TOC se promueven a tipos de bloque persistidos; los bloques de texto-encabezado llevan `headingStyle` (corrige el bug donde la TOC busca un campo que no existe). |
| C7 | **Workflow canónico del informe (front ↔ BD unificados)** | NEW | Estado único de la máquina: Borrador→Revisión→Aprobado→Firmado (+Rechazado). Hoy front usa `review/signed/rejected` y BD usa `in_review/archived`: hay que unificar claves y autoridad (server). |
| C8 | **Firma documental (aprobación humana) ≠ integridad del archivo (SHA-256)** | NEW | Distinguir el bloque de firma de aprobación (nombre, cargo, fecha, rol) de la firma criptográfica de integridad del `.miningreport`. Ambas existen; hoy solo está la de integridad. |
| C9 | **Resolución diferida: numeración jerárquica, TOC, refs cruzadas, "Página X de Y"** | NEW | Modelo con anclas estables resueltas en render/export (no texto estático). Numeración global, TOC desde el árbol de secciones, refs cruzadas por ancla. |
| C10 | **Mapa como bloque tipado con referencia geoespacial** | NEW | Hoy el mapa se degrada a `image` y pierde geo-ref. Definir un tipo `map` persistido (capa, bbox/centro, zoom, fuente WMS/MBTiles) que se rinde y exporta sin perder trazabilidad. |
| C11 | **Ownership de metadatos de ciclo de vida** (`project_id`, `created_by`, `reviewed_by`) | NEW | Definir qué vive en `document.meta` (portátil/offline) vs autoritativo en BD/API. |

### Fixture canónico

`.miningreport` (envelope: `manifest` + `document{pages[],meta}` + `binaries` + `auditLog` +
`workflow` + `signature`) es el **artefacto de oro** que el sistema debe reproducir. Se
preservará su especificación en `docs/specs/` (Phase 9). Inconsistencia a corregir ya:
`headingStyle` en bloques text (sin esto la TOC nunca detecta secciones).
