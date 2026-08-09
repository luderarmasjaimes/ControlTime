# Changelog — Beemetry / AURIXA Plataforma Minera

Insumo para la decisión de release v0.1. No implica que el equipo ya haya
decidido cortar la versión — ver `RUNBOOK.md` para lo que falta antes de
GO-LIVE.

## [Unreleased] — 2026-07-27

### CORS multiorigen para un segundo frontend externo (2026-08-02)

`BEEMETRY_CORS_ALLOWED_ORIGIN` admite ahora una lista separada por comas
(retrocompatible con un solo valor). `router::Router::dispatch()` refleja,
por request, cuál de esos orígenes matchea el header `Origin` entrante —
sin tocar cookies/CSRF ni el wildcard `*`. Habilita una segunda app
frontend (repo aparte) contra este mismo backend cuando se despliega
same-site. Detalle completo en
[ADR-081](docs/decisions/081-cors-multiorigen-frontend-externo.md) y el
contrato de auth/permisos para esa app en
[docs/integration/EXTERNAL_FRONTEND_AUTH.md](docs/integration/EXTERNAL_FRONTEND_AUTH.md).

De paso, `pdf-export-service/Dockerfile` dejó de fallar en build: la imagen
base de Puppeteer trae dos repos apt de Google Chrome preconfigurados
(`google-chrome.list`, `google.list`) que no usa (el Chromium real lo
instala Puppeteer, no apt) y cuya clave GPG rota — cuando queda vencida,
`apt-get update` tumbaba la instalación de `qpdf`/`ffmpeg` aunque no
dependan de ese repo. Se eliminan ambos archivos antes de actualizar.

### Optimización de latencia frontend/backend (2026-08-02)

Revisión de rendimiento de extremo a extremo. Tres cuellos de botella
independientes que se multiplicaban entre sí:

- **Bundle inicial: 4.26MB → 607KB (177KB con gzip).** Todas las vistas
  pesadas (`three`, `echarts`, `plotly`, `konva`, `leaflet`, `tiptap`,
  `sql.js`, `hls.js`) eran imports estáticos en `App.tsx`, así que se
  descargaban y parseaban íntegras antes de pintar el login — que no usa
  ninguna. Ahora van con `React.lazy` + una frontera `Suspense`, y
  `build.rollupOptions.output.manualChunks` las separa en chunks `vendor-*`
  estables (cacheables a 1 año, ya no se invalidan al tocar código propio).
- **nginx no comprimía nada salvo HTML.** Se sirvían ~9.3MB de JS sin
  comprimir. Se habilita `gzip` (+ `gzip_static`, `gzip_proxied any` para que
  también aplique a los JSON de `/api/`).
- **El backend cerraba la conexión TCP después de CADA request.**
  `session()` en `main.cpp` leía una sola request y hacía `shutdown`: cada
  llamada a la API costaba un handshake TCP completo *más* el spawn de un
  hilo del SO nuevo (el accept loop hace `std::thread(...).detach()`). Ahora
  hay bucle keep-alive con tope de 100 requests/conexión y timeout de ocio
  configurable (`BEEMETRY_HTTP_KEEPALIVE_TIMEOUT`, default 15s; `0` restaura
  el comportamiento anterior). El timeout usa `SO_RCVTIMEO` y no
  `expires_after()` de beast, que solo afecta a operaciones asíncronas — con
  lecturas síncronas una conexión ociosa habría dejado su hilo colgado.
- **Plotly: 4.75MB → 1.15MB.** `LiveChartBlock` era el único consumidor de
  Plotly en toda la app y solo dibuja trazas `scatter` y `bar`; se cambia el
  bundle completo por `plotly.js-basic-dist-min`.
- `router.cpp`: el match de rutas por prefijo usaba `substr()`, que
  construía un `std::string` temporal por ruta evaluada y por request. Ahora
  usa `starts_with` (C++20).

### Vista previa de impresión, marca de agua y PDF cifrado con contraseña (2026-08-02)

- ADR-080: "Imprimir" del ribbon ya no imprime la app completa — abre una
  vista previa real (`ReadOnlyViewer`) con "Imprimir" (nativo del navegador)
  y "Descargar PDF protegido" como acciones separadas.
- Todo PDF exportado vía `GET /api/reports/{id}/export/pdf` ahora lleva marca
  de agua en cada página (texto resuelto server-side, reutiliza la columna
  `report_document_settings.watermark_json` que existía sin uso desde
  ADR-019) y queda cifrado con una contraseña de usuario generada por
  descarga (`qpdf`, cifrado PDF estándar AES-256) — no persiste en ningún
  lado, se muestra una única vez en el frontend.
- Post-procesado (watermark + cifrado) vive en el sidecar
  `pdf-export-service` (nuevas dependencias: `pdf-lib`, `qpdf` vía apt) —
  el backend C++ sigue sin ninguna dependencia de manipulación de PDF.
- Nueva variable de entorno obligatoria en producción:
  `PDF_OWNER_PASSWORD_SECRET` (`docker-compose.prod.yml`, `.env.example`).

### RBAC real en el módulo de informes (2026-08-02)

- ADR-079 cierra una brecha crítica encontrada en auditoría: el módulo de
  informes (`report_routes.cpp`/`report_service.cpp`) solo verificaba tenant,
  nunca rol/permiso — cualquier usuario del tenant podía aprobar, firmar o
  eliminar cualquier informe técnico minero.
- Permiso por transición de workflow resuelto por el estado actual (mismo lock
  de fila que la máquina de estados): `informes.edit` en `draft`/`rejected`,
  `informes.sign` en `in_review`/`approved`. Crear/importar exige
  `informes.edit`; eliminar exige `informes.sign`.
- Un informe `signed`/`archived` queda inmutable sin excepción de rol (ni
  admin) — ni edición de contenido ni eliminación.
- Nuevo hook reutilizable `frontend/src/auth/usePermissions.ts` (consume el
  endpoint `GET /api/auth/permissions`, ya existente pero sin uso hasta hoy) —
  reemplaza comparaciones de `session.role` hardcodeadas en `WorkflowPanel`,
  `ReportsAdminModal` y el `canMaintain` de la plataforma; agrega guard de
  render explícito a las vistas de administración.

### Auditoría ADR y bloqueantes de identidad

- Evidencia local cerrada al 2026-07-29: backend `3c6acc4d30a1`, frontend
  `32a8977e4138`, smoke auth E2E completo y deduplicación de empresa con 409
  case-insensitive.
- Router IA corrige trazabilidad de auth: infiere `SPEC-006` desde rutas
  `backend/src/auth`/`frontend/src/auth` y carga ADR-076/077/078 sin depender
  de que el texto de la tarea mencione el SPEC explícitamente.
- Inventario real de hashes actualizado: 14 cuentas Argon2id y 40 legacy; el
  retiro del verificador legacy queda como gate operativo hasta inventario cero
  o reset administrado formal.
- ADR-076 implementa OpenSSL CSPRNG para IDs, refresh/`jti` y API keys.
- ADR-077 implementa Argon2id autocontenido y rehash oportunista de hashes
  históricos sin invalidación masiva.
- CORS queda acotado al origen configurado, con credenciales y
  `X-CSRF-Token`; producción exige un origen HTTPS explícito.
- El build productivo ejecuta Catch2/CTest y falla cerrado ante regresiones.
- ECharts actualizado a 6.1.x: auditoría productiva npm en 0 vulnerabilidades.
- ADR-078 agrega alta admin de empresas con deduplicación y tenant real.
- Eliminado el panel TOC muerto; queda un único bloque TOC insertable.
- ADR-029/037/043/058/060/073/075, SPEC-006/008 e índice vigente
  reconciliados; `csrf_token_v2`, estado de despliegue y pendientes reales
  quedan explícitos.

### Acceso internacional por país

- Selector compacto país/idioma disponible desde login y registro, con
  PE→español, BR→portugués, CA→francés y US→inglés; cambio manual permitido.
- Traducción integral de las cuatro pantallas de autenticación, estados
  biométricos y navegación principal; nombres de países localizados.
- RUC peruano, CNPJ brasileño y documentos fiscales norteamericanos se
  validan según país; teléfonos se muestran con prefijo y se envían en E.164.
- Fallback local mantiene los selectores operativos sin catálogo backend.
- Eliminados `alert()`, `confirm()` y `prompt()` nativos activos; avisos,
  confirmaciones y captura de títulos usan modales accesibles traducidos.
- Corregidos el smoke CSRF (`csrf_token_v2`), las colisiones de sus datos de
  prueba y el UUID hexadecimal de longitud variable que hacía fallar altas
  aleatoriamente.
- Verificación: TypeScript/build OK, Vitest 25/25, E2E auth/face/audit/CSV/
  refresh-CSRF/logout OK, matriz fiscal PE/BR/US/CA 8/8 y navegador real ES/PT/FR/EN
  sin overflow a 1280×720 y backend Docker/CMake enlazado al 100 %.
- ADR-075 y SPEC-006/008 actualizados tras revisar conflictos con decisiones
  de navegación, LATAM, tenant, registro y biometría.

### Avatar biométrico local HD

- Avatar de cabecera rediseñado con relieve, indicador de ampliación y foco
  accesible; doble clic abre visor corporativo y clic fuera o `Esc` lo cierra.
- Generación local preferente MediaPipe/OpenCV, con fallback ONNX/AnimeGAN,
  miniatura de sesión y maestro vertical 4K bajo demanda.
- Nuevo endpoint autenticado `/api/auth/avatar/hd`, sin `user_id` controlado
  por cliente; caché privada y fallback para usuarios históricos.
- Se evita guardar el 4K en `localStorage`; la captura biométrica cruda no se
  agrega a la sesión ni se retiene por esta función.
- ADR-074 reconcilia el alcance biométrico real con ADR-004/025/027 sin
  habilitar visión EPP ni levantar el gate legal.
- Verificación: Python compila; TypeScript/build OK y 20 pruebas Vitest OK.
- Backend Docker/CMake compila y enlaza al 100 %. El paralelismo del build
  queda configurable y limitado a 2 por defecto para evitar agotar Docker.

### Navegación corporativa minera

- Cabecera compacta con título `Beemetry · Centro Minero`, contexto
  Minera/Unidad sin duplicación y estados resumidos.
- Menú reorganizado en carriles contiguos `Áreas` + opciones activas, ambos
  de una línea, con flechas automáticas y scroll táctil/horizontal.
- Iconos y objetivos táctiles más grandes, relieve 3D sutil, foco accesible y
  soporte para movimiento reducido.
- Etiquetas visibles simplificadas para operación: Gestión, Control, Terreno,
  Mapas, Permisos e Informes; Usuarios, Accesos y Umbrales.
- Verificación: TypeScript, build de producción, 18 pruebas frontend y QA
  visual en 1917 px/1366 px.

## [Unreleased] — 2026-07-24

### Auditoría integral de arquitectura

- ADR-068 documenta IA editorial multimodelo y limita la búsqueda
  bibliográfica externa a una acción explícita que no envía el cuerpo del
  informe ni telemetría.
- ADR-069 formaliza la migración del frontend productivo a TypeScript
  estricto.
- ADR-070 documenta bloques técnicos, plantillas semánticas y composición
  sobre tipos existentes.
- ADR-071 formaliza TOC único en página 2 y continuaciones automáticas.
- ADR-072 supersede ADR-028: GDAL runtime queda admin-only, con rutas
  confinadas, allowlists y jobs autenticados/tenant-owned.
- `docs/decisions/` pasa a ser la fuente canónica efectiva para RAG, agentes y
  CI; `specs/adr/` permanece como registro histórico. Las consultas con un
  identificador explícito (`ADR-NNN`) priorizan ahora el archivo canónico
  exacto antes de resultados semánticos o superseded.
- ADR-019 se reclasifica `partial`: faltan referencias cruzadas automáticas.
  ADR-025 se reconcilia con el runtime: login facial activo, visión EPP
  diferida y gate legal vigente.

### Verificación

- Frontend: tipos, build y 18 pruebas verdes.
- Plataforma IA: 9 pruebas verdes.
- Stack Docker: 17 servicios saludables; imagen web reconstruida.
- Estado histórico de esa corrida: 1 CVE moderada en `echarts@5.6.0` y
  fallback de contraseña. Ambos quedaron cerrados en la entrega 2026-07-27
  descrita al inicio de este changelog (ECharts 6.1.x + ADR-077).

## [Unreleased] — 2026-07-19

### Seguridad — auditoría integral interna/externa (ADR-058)
Auditoría con evidencia real (no estática nada más: pruebas en vivo contra
el stack corriendo). Resumen de lo CERRADO en esta pasada y lo que queda
como decisión del equipo.

**CERRADO (corregido + verificado en vivo):**
- **XSS almacenado en celdas de tabla del editor de informes** (alto). Las
  celdas son `contentEditable` que guardaban HTML crudo (`onChange(innerHTML)`)
  y se re-sembraban con `el.innerHTML = value` (TableBlock.tsx). Un editor
  podía pegar `<img onerror>`/`<svg onload>`/`<script>` en una celda; al
  abrir OTRO editor/revisor el informe en modo edición, el payload
  ejecutaba en su navegador. Como access+refresh token viven en
  localStorage, un XSS = robo de sesión persistente. Fix: sanitizador
  allowlist sin dependencias (`lib/sanitizeHtml.ts`, DOMParser) aplicado al
  renderizar y al guardar. Verificado: neutraliza todos los vectores y
  conserva el formato legítimo (`<span style="color;font-weight">` intacto).
  El ReadOnlyViewer y el export PDF ya eran seguros (React escapa `{cell}`).
- **IDOR horizontal + fuga sin auth en `/api/sensors/data`** (alto). (a) Sin
  `tenant_id` devolvía el inventario GLOBAL de sensores de TODOS los tenants
  sin pedir siquiera sesión; (b) con `tenant_id` solo verificaba que
  existiera una sesión, no que ese tenant perteneciera a ella — un usuario
  del tenant A podía leer los sensores del tenant B pasando su UUID. Fix
  (sensor_service.cpp): sesión obligatoria + tenant efectivo derivado de la
  sesión vía `resolveAllowedSensorTenant` (mismo criterio IDOR-proof que
  reports/surveillance). Verificado: sin token → 401 (antes 200 con datos).
  El mismo blindaje se aplicó al nuevo `/api/mining/telemetry/summary`.
- **Dependencias con CVEs altas**: Axios 1.13.6 → 1.18.1 (cierra SSRF por
  bypass de NO_PROXY, prototype-pollution auth-bypass, CRLF y null-byte
  injection), + form-data y linkify-it (ReDoS). `npm audit`: 3 altas → 0.
- **HSTS** (`Strict-Transport-Security`) añadido a las 4 locations estáticas
  de nginx (defensa en profundidad; el proxy TLS externo lo reenvía).
- **`dangerouslySetInnerHTML` innecesarios** en AlarmConfigView eliminados
  (etiquetas con Unicode real ≥ ≤ en vez de entidades HTML).

**VERIFICADO SANO (sin cambios necesarios):**
- Inyección SQL: todos los WHERE dinámicos usan placeholders `$N` con
  `PQexecParams`; nombres de columna desde whitelist. Limpio.
- Endpoints sensibles (kpis, markers, alarmas, cámaras, reports, dashboard
  metrics) ya devuelven 401 sin token.
- Secretos: todos vía `${...}`/`.env` (gitignoreado, sin secretos en git).
  Sin texto plano en compose.
- Contenedores: límites de recursos (memory+cpus) por servicio; backend
  HTTP solo a loopback en prod (nginx es el único ingress); ingesta IoT
  8443 autentica por `device_api_key_hash`. 17/17 contenedores healthy.

**PENDIENTE — decisión/esfuerzo del equipo (documentado, no cerrable en una
pasada de auditoría):**
- **Refresh token en localStorage** (alto): tanto access como refresh viven
  en localStorage (authStorage.ts), robables por cualquier XSS = toma
  persistente de cuenta. El ADR-029 lo describe como "server-side" pero se
  entrega y almacena en el cliente. Remediación recomendada: mover el
  refresh a cookie `HttpOnly; Secure; SameSite=Strict` + protección CSRF
  (hacerlo mal cambia XSS-theft por CSRF). Cambio arquitectónico.
- **Pentest externo de caja negra** (ya es la tarea #9 del backlog): los
  checks automatizables están cubiertos; un pentest formal requiere
  contratación y alcance del equipo de seguridad.
- **echarts@6** (1 CVE moderada restante): la corrige un salto semver-major
  que puede romper todos los gráficos → migración deliberada, no forzada.
- Menores: `db_replica` corre como `user: root` (solo interno, sin puerto
  al host); el compose de DEV expone mailpit/mqtt/tiles (el de PROD no);
  otros proyectos comparten el host Docker (superficie de movimiento
  lateral ajena a esta plataforma).

### Dashboards — widgets estilo ThingsBoard en Monitoreo→Sensores (ADR-057)
- **Análisis de C:\thingsboard-master** (522 `widget_types` del sistema +
  librería ui-ngx): las familias de widget con valor minero Y con datos
  reales disponibles en `/api/sensors/data` son tres, y se portaron como
  módulo reutilizable `Dashboard/widgets/SensorWidgets.tsx` integrado en la
  vista EXISTENTE Monitoreo → Sensores (`AdvancedSensors.tsx`):
  - **Gauge radial con zonas** (TB `analogue_radial_gauge` /
    `digital_speedometer`): lectura actual del sensor seleccionado con arco
    verde/ámbar/rojo. Sin umbrales por sensor en el esquema todavía, las
    zonas se derivan del rango observado en su propio historial de 7 días
    (verde <75%, ámbar <90% — criterio por defecto de ThingsBoard).
  - **Tarjetas de agregación** (TB value/aggregation cards): mínimo,
    promedio, máximo y último del historial del sensor, con unidad real.
  - **Doughnut de distribución por estado** (TB `doughnut`): sensores del
    ámbito visible agrupados online/warning/critical/offline, total al
    centro.
- Familias evaluadas y DESCARTADAS deliberadamente por falta de datos de
  respaldo en el esquema `sensors` (verificado contra la BD): tanques de
  líquido, `battery_level`, `signal_strength`/RSSI, gateway/edge — un
  widget sobre datos inventados es peor que ninguno; se implementarán
  cuando la telemetría transporte esos campos. `TelemetryDashboard` (S2)
  no se amplió porque hoy corre sobre telemetría simulada (mock).
- **Dato demo corregido**: `mining_sensor_history` tenía su última muestra
  el 2026-04-15 — fuera de la ventana de 7 días del endpoint, por lo que el
  gráfico "Historial reciente" preexistente llevaba meses mostrando "Sin
  historial" (y los widgets nuevos habrían nacido vacíos). Se re-sembró la
  historia demo desplazando las muestras a la ventana actual (+336 filas).
- Verificado E2E en vivo: gauge + donut + gráfico renderizando con datos
  reales del inclinómetro INC-TAJO-01 (mín 11.66° · prom 12.42° · máx
  13.11° · último 12.53°).

## [Unreleased] — 2026-07-18

### Mapas — TODOS los tiles externos rotos por CSP × Service Worker (ADR-056)
- **Incidente**: el 100% de los tiles del mapa (base satelital Google + los
  WMS gubernamentales: INGEMMET, MINEM, OEFA, ANA, SERNANP, SENAMHI, MTC,
  IGN) aparecían rotos, con los servidores respondiendo bien por curl.
  **Causa raíz**: los `fetch()` de un Service Worker se rigen por la CSP
  del SCRIPT DEL WORKER, no por la de la página. `tile-cache-sw.js`
  (cacheo offline de tiles) intercepta esas URLs y las re-pide con fetch
  interno; la CSP general (`connect-src 'self' ws: wss:`) mataba cada
  fetch externo al instante ("Failed to fetch" en 0 ms) → tile roto, y
  como nunca había éxito, la caché offline jamás se poblaba (fallo
  permanente, no intermitente). **Fix**: `location = /tile-cache-sw.js`
  dedicada en `nginx.conf` con CSP propia (`default-src 'none';
  connect-src 'self' https:`) — el permiso amplio queda acotado SOLO al
  worker de tiles (mismo criterio que `img-src https:` de la página: el
  campo "WMS personalizado" admite cualquier GeoServer); la CSP estricta
  de la SPA no cambia.
- **Timeout adaptativo en el SW**: el corte de red a 2.5 s solo aplica
  ahora cuando EXISTE copia en caché a la cual caer; sin respaldo se
  espera hasta 20 s (un GetMap de SENAMHI tarda ~3 s por sí solo, y la
  ráfaga inicial de Leaflet —~18 tiles contra 6 conexiones por host—
  encolaba los últimos más allá del timeout).
- **Catálogo WMS saneado** (`wmsCorporateCatalog.json` v2, re-probado en
  vivo 2026-07-18): SENAMHI migrado a `/geoserver/ows` (el alias
  `/geoserver/wms` responde en >25 s); el WMS público de MINAM fue dado
  de baja por la entidad (404) y queda como plantilla manual; la región
  INGEMMET pasa a ser la primera del catálogo para que el preset POR
  DEFECTO del MapViewer sea una capa verificada y no una plantilla vacía
  (antes: abrir el mapa + "Activar WMS" → "Complete URL y capa WMS", nada
  cargaba).
- Verificado E2E en vivo: base satelital 18/18 tiles OK, INGEMMET
  catastro 18/18, SENAMHI clima 18/18, MTC vial 18/18, IGN centros
  poblados 18/18 (antes: 18/18 rotos en todos).

### Informes — Editor de texto enriquecido (ADR-055)
- **Bug real corregido: el área resaltada/seleccionada "se perdía" al
  agrandar el tamaño de fuente de una selección (A+/A- de la barra
  flotante)**. Causa raíz: el editor de texto usa una técnica de doble capa
  (`<textarea>` invisible para captura nativa + `<div>` superpuesto que
  pinta el formato real por tramo) — el `<textarea>` solo admite UN tamaño
  de fuente uniforme para todo su contenido, así que en cuanto una porción
  seleccionada tenía su propio tamaño (distinto al del bloque), el
  rectángulo de selección NATIVO del navegador (atado a ese tamaño
  uniforme/pequeño) quedaba desalineado y diminuto respecto al texto real,
  mucho más grande, que se veía en la capa de encima. Corregido
  reemplazando la selección nativa por un indicador propio, calculado
  dentro del mismo overlay que ya resuelve el tamaño real por tramo (por
  lo que hereda el escalado correcto automáticamente) y ocultando la
  selección nativa del navegador vía `::selection { background: transparent }`
  (`PageCanvas.tsx` — `getLiveSelectionRange` + split de segmentos del
  overlay; `styles.css`).
- **Color de resaltado (marcador) y ciclo de MAYÚSCULAS/minúsculas
  ("Aa", estilo Word Mayús+F3)** ahora disponibles tanto en la barra
  flotante (solo la selección) como en el ribbon fijo (todo el bloque
  cuando no hay selección activa) — mismo criterio "selección si existe,
  si no todo el bloque" que ya usaban negrita/cursiva/subrayado/color/
  tamaño/fuente. Requirió:
  - Nuevo campo persistido `TextProps.highlightColor` (resaltado BASE del
    bloque) además del ya existente `TextStyleSpan.highlightColor` (por
    selección) — distinto de `props.backgroundColor` (fondo de TODO el
    cuadro de texto).
  - Nuevo canal de puente ribbon↔selección
    (`registerActiveCaseHandler`/`tryApplyCaseToActiveTextSelection` en
    `activeTextFormatBridge.ts`) para el botón "Aa", ya que a diferencia de
    negrita/color/tamaño esta acción MUTA EL TEXTO en sí, no solo un
    atributo de estilo (`Partial<BaseTextStyle>`), y el puente existente
    solo transporta parches de estilo.
- Corregido además un byte nulo (`\0`) real encontrado en
  `PageCanvas.tsx` (dentro de una plantilla de cadena, `measureWordCached`)
  — corrupción de una edición anterior, sin efecto funcional pero
  reemplazada por el espacio correcto.
- Verificado en vivo end-to-end (interacción real de mouse/teclado, no solo
  eventos sintéticos): indicador de selección escalando correctamente de
  16px a 26px+, resaltado del ribbon aplicado a bloque completo, ciclo de
  mayúsculas aplicado a selección y a bloque completo, Tabla de Contenidos
  generada correctamente sigue detectando encabezados por selección tras
  estos cambios.

## [Unreleased] — 2026-07-07

### Seguridad
- **CSP (Content-Security-Policy)** implementado (`router.cpp` + `nginx.conf`),
  cerrando el ítem que había quedado pendiente el 2026-07-05. Orígenes
  externos auditados (Google Fonts, Tailwind CDN, WMS gubernamentales);
  `img-src` permite `https:` sin allowlist de host por el campo real de
  "WMS personalizado (URL manual)" en `MapViewer.tsx`. Verificado con
  rebuild/redeploy real y `curl -I` contra `beemetry-web`.
- **Autenticación híbrida JWT** (access token corto + refresh token opaco
  server-side, rotación estricta, denylist de revocación por `jti`) — ver
  ADR-029 revisado.

### Rendimiento (React)
- **9 componentes memoizados** en 3 rondas (`PageCanvas`, `LeftLibrary`,
  `SensorWidget`, `MiningKpiWidget`, `TableBlock`, `MiningDashboard`,
  `AdvancedSensors`, `TelemetryDashboard`, `VideoDiagram`, `AlarmCenter`),
  cada uno con justificación verificada de por qué el memo es real (no
  cosmético) — ver `GAP_ANALYSIS_2026-07-04.md` § Ronda 3. 3 componentes
  muertos detectados (`AdvancedTableBlock`, `DynamicSensorField`,
  `CoverPage.tsx` nunca se importan).

### Informes (ADR-012)
- **Snapshot congelado de KPI/sensor al firmar**: `ReportStudioV2/App.tsx`
  captura el valor en vivo de cada widget kpi/sensor citado justo antes de
  confirmar la transición a `signed`, escribiéndolo en
  `element.props.snapshot`. Hallazgo real durante la implementación:
  `ReadOnlyViewer.tsx` y `exportEngine.ts` (DOCX) no tenían NINGÚN caso para
  `element.type === 'sensor'` — ese bloque desaparecía silenciosamente al
  exportar o ver en solo lectura (el export PDF reusa `ReadOnlyViewer`, ADR-016).
  Corregido en ambos.

### Rebrand (ADR-000, ADR-033)
- `PLATFORM_NAME` → `Beemetry` (antes `AURIXA`) en `platformBrand.config.ts`
  y todos los textos hardcodeados encontrados (`App.tsx`, `FormulaEngineEmbed.tsx`,
  `CoverPage.tsx`, `exportEngine.ts`).
- Target CMake `mapas_backend` → `beemetry_backend` (+ `entrypoint.sh`,
  `docker-compose.e2e-verify.yml`); `package.json` → `beemetry-frontend`.
- Los 14 `container_name` de `docker-compose.yml` renombrados de `aurixa-*`
  a `beemetry-*`. Los nombres de *servicio* (`web`, `frontend`, `db`, etc.)
  y el alias de red `backend` (usado por `nginx.conf` para el proxy) no
  cambiaron — verificado que el rename de `container_name` no tiene ningún
  acoplamiento funcional con enrutamiento/`depends_on`/healthchecks antes de
  aplicarlo. Stack completo (14 servicios) reconstruido y redesplegado,
  todos `healthy` tras el rename.
- Docs de negocio (`Referencias/`, SOW, cronogramas) deliberadamente NO
  tocados — son material histórico, per la regla del propio ADR-000.

## [Unreleased] — 2026-07-03 a 2026-07-05

### Seguridad (crítico)
- **Corregidos 2 IDOR** en gestión de usuarios (`GET /api/auth/users`,
  `POST /api/auth/users/maintenance`, `GET /api/auth/users/maintenance/audit`):
  el tenant ya no se toma de parámetros controlados por el cliente, siempre
  de la sesión autenticada. Verificado con ataque cruzado real de 2 tenants.
- **Auditoría append-only con hash encadenado** (`platform_audit_log`):
  trigger que bloquea `UPDATE`/`DELETE` incluso para el rol propietario de la
  tabla, cadena de hash SHA-256 verificable vía `fn_audit_log_verify_chain()`.
- **Comando/inyección**: `shellQuote()` aplicado a los 4 puntos que invocaban
  `std::system()` con datos externos (surveillance, biometría, GDAL).
- **Headers de seguridad HTTP** (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`) aplicados a toda respuesta de la API y a los assets
  estáticos del frontend. CSP completo queda pendiente (requiere auditar
  orígenes externos ya en uso antes de aplicar una política estricta).

### Datos y rendimiento
- **`mineria_lecturas` convertida a hypertable TimescaleDB** (chunks de 7
  días, compresión >30 días) — migración con integridad verificada byte a
  byte contra un dump real de producción.
- **Lecturas de dashboards/KPIs enrutadas a la réplica read-only**
  (`aurixa-db-replica`), aislando el primario de la carga de lectura.
- **Memory safety**: los 11 archivos backend con acceso a Postgres migrados
  de `PGresult*` crudo + `PQclear()` manual a `storage::PgResult` (RAII) —
  elimina la clase de fuga de memoria en cualquier `return`/`throw` temprano
  entre `PQexec` y `PQclear`.

### Workflow e informes (ADR-015, 017, 018)
- **Máquina de estados canónica** (`draft → in_review → approved → signed →
  archived`, con `rejected → draft`) validada server-side en cada
  transición — antes el cliente podía enviar cualquier string sin
  validación. Migración de datos legacy (`published` → `archived`) +
  `CHECK` constraint en `reports.status`.
- **Firma documental** (ADR-018): el estado `signed` ahora registra quién
  firmó (nombre/cargo resueltos server-side, nunca confiados del cliente) y
  cuándo, en columnas nuevas de `reports` — antes solo se cambiaba el string
  de estado sin ningún registro de aprobación humana.
- **Comentario de transición** (p.ej. motivo de rechazo) ahora llega al
  servidor y queda en la auditoría con hash encadenado — antes solo vivía en
  el navegador del usuario.
- **Versionado autoritativo en servidor** (ADR-015): cada guardado
  confirmado (autosave o manual) genera una revisión real en
  `report_content_revision`; el historial de versiones en la UI ya no se
  pierde al recargar la página.
- **Export PDF server-side** (ADR-016): nuevo sidecar Chromium headless que
  reutiliza el mismo componente de solo-lectura que ve el usuario —
  fidelidad visual garantizada, sin motor de render duplicado.
- **Serialización de bloques cover/toc** en el modelo de documento (antes no
  se guardaban al persistir el informe).

### Frontend / UX
- Barra de menú retráctil aplicada a **todos los menús** (no solo Informe
  Técnico), maximizando el área de trabajo.
- Corregido parpadeo de cámara/video en el modal de captura de imágenes.
- Corregido bug de sincronización: `handleOpenEdit` ahora carga el estado de
  workflow y la firma real al reabrir un informe existente (antes mostraba
  el estado residual de la sesión previa).
- Corregido bug de timezone en el filtro de fecha de "Mis Informes": excluía
  silenciosamente los informes creados "hoy" para usuarios en timezone
  UTC-negativo (incluye Perú, la región de despliegue real).
- Vocabulario de estados unificado en `ReportsAdminModal` (antes mostraba
  "Borrador" para cualquier informe firmado o rechazado).
- `PageCanvas` memoizado (`React.memo`): evita re-renderizar todas las
  páginas del documento al editar una sola.

### Documentación de código
- Comentarios Doxygen (`@brief`) agregados a los headers de lógica de
  negocio (auth, KPIs, informes, sensores, cámaras, motor de fórmulas,
  pool de conexiones).

## Cómo verificar este changelog
Cada ítem de esta lista fue probado contra contenedores reales (`aurixa-db`,
`aurixa-api`, `aurixa-web`) — no solo compilado. Ver `GAP_ANALYSIS_2026-07-04.md`
para la evidencia detallada (queries, respuestas HTTP, capturas) de cada fix.
