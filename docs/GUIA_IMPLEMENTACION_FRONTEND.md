# 🧭 GUÍA DE IMPLEMENTACIÓN FRONTEND — Beemetry

**Fecha**: 2026-09-14
**Audiencia**: Cualquier desarrollador (interno o externo) que vaya a tocar `frontend/`
**Propósito**: Que quien reciba el código fuente del frontend no rompa decisiones arquitectónicas ya tomadas, no reintroduzca vulnerabilidades ya corregidas, y sepa dónde buscar el detalle técnico completo de cada decisión.
**Cómo se construyó este documento**: exploración exhaustiva del código real (no de intenciones) — `frontend/src` completo, `docs/decisions/README.md` (1642 líneas), configuración de build/CI, y los ADRs citados abajo. Donde un ADR dice una cosa y el código hace otra, este documento sigue al código y lo aclara explícitamente (ver §2.5).

> **Regla de oro del proyecto** (ver `docs/decisions/README.md`, línea 3): *una decisión arquitectónica sin ADR no existe*. Este documento resume decisiones YA TOMADAS — no reemplaza `docs/decisions/`, apunta a él. Si el trabajo nuevo implica una decisión de arquitectura (no una implementación directa de algo ya decidido), corresponde un ADR nuevo, no solo código.

---

## 1. Qué compartir junto con el código fuente

Además del árbol completo de `frontend/`, comparte:

| Compartir | Por qué |
|---|---|
| **`README.md`** de la raíz del repo | Punto de entrada corregido (2026-09-14) — introduce Beemetry de verdad y enlaza a `AGENTS.md`/`docs/decisions/README.md`. Antes describía un prototipo descartado (ECW→MBTiles); ya no. |
| **Este documento** (`docs/GUIA_IMPLEMENTACION_FRONTEND.md`) | Resumen ejecutivo — léelo primero |
| **`docs/decisions/README.md`** completo | Índice canónico de los 188 ADRs, agrupado por ámbito. Es largo (1642 líneas) pero es la única fuente de verdad de "por qué así y no de otra forma" |
| **Los ADRs de la tabla del §9** (o toda la carpeta `docs/decisions/`, son archivos de texto, pesan poco) | Detalle técnico completo de cada decisión frontend-relevante |
| **`AGENTS.md`** (raíz del repo) | Explica la metodología de trabajo (ADR obligatorio, convención de numeración, qué carpetas son legado) |
| `frontend/package.json`, `vite.config.js`, `tsconfig.json` | Ya vienen con el código, pero revísalos primero — ahí están los scripts, alias de paths y config de build reales |

**Qué NO compartir / NO usar como referencia**:

- **`docs_/`** (con guion bajo, distinto de `docs/`) — es material de gestión/comercial (SOW, cronogramas, informes gerenciales, RFQ de infraestructura). No es documentación técnica para desarrollo y puede contener información de costos/contratos que no corresponde compartir con un desarrollador externo sin criterio de negocio.
- **`specs/adr/`** — log de ADRs antiguo, deprecado desde 2026-07-13. Se conserva solo por trazabilidad histórica; no recibe decisiones nuevas. El log vigente es únicamente `docs/decisions/`.
- **`ecw-plugin/`, `scripts/*ecw*`** — resto de un prototipo temprano y descartado (conversión satelital), no referenciado en `docker-compose.yml`. No es parte del stack actual.

No existe hoy un `CLAUDE.md` ni `CONTRIBUTING.md` ni `ARCHITECTURE.md` en el repo — este documento llena ese vacío. Si más adelante se agrega un `CLAUDE.md`, debería enlazar a este archivo en vez de duplicarlo.

---

## 2. Reglas arquitectónicas NO NEGOCIABLES

Estas son decisiones ya tomadas y verificadas en producción. Revertirlas sin un ADR nuevo que lo justifique es tratado como una regresión, no como una mejora.

### 2.1 Un solo store Zustand — nada de Redux, nada de Context para estado de documento

**ADR-014** (actualizado 2026-09-12). Todo el estado del editor de informes vive en un único store Zustand: `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (~5200 líneas). No se crean stores adicionales para estado de documento (`doc: ReportDocument`) ni se usa Redux.

Única excepción permitida: un store **efímero** que (a) nunca contiene `doc`, (b) nunca se persiste, (c) vive solo mientras dura una interacción puntual. Precedente real: `useDragPreviewStore` (ADR-174, overlay de arrastre de miniaturas de diapositivas).

Dentro del store hay una distinción crítica que hay que internalizar antes de tocarlo:
- `doc.meta.version` — contador local, se incrementa en cada acción del usuario.
- `currentReportVersionNumber` — versión autoritativa del servidor (ADR-015/021), se hidrata al cargar/guardar.

Confundir estos dos campos rompe el control de concurrencia optimista (ver §2.5).

### 2.2 No hay librería de ruteo — navegación por estado de vista

No hay `react-router` ni ningún router en las dependencias. La navegación es manual, dirigida por estado (`activeTab`/similar en `App.tsx`/`NavBar.tsx`), con el diseño de navegación "por carriles" del **ADR-040** (áreas/opciones con iconos grandes, flechas automáticas) y nomenclatura en lenguaje llano minero del **ADR-042** ("Gestión", "Control", "Terreno", "Mapas", "Permisos", "Informes"...). `App.tsx` bajó de ~1954 a 354 líneas cuando `NavBar.tsx` se extrajo (**ADR-175**) — si necesitas tocar navegación, es ahí donde vive, no en `App.tsx`.

Si tu instinto es "esto necesitaría react-router", frénate: no es que falte, es una decisión deliberada de este proyecto. Si de verdad hace falta, es una discusión de ADR nuevo, no una instalación de npm.

### 2.3 Autenticación: Bearer en memoria + cookies namespaced + CSRF double-submit

Patrón completo en `frontend/src/auth/authApi.ts` (1397 líneas) y `authStorage.ts` (317 líneas). Reglas:

- El **access token JWT vive solo en memoria** (variable de módulo en `authStorage.ts`), nunca en `localStorage`/`sessionStorage`, nunca en el objeto `Session` persistido (`session.token` siempre se guarda como `''`). Esto es **ADR-132**, hecho específicamente porque dos apps frontend en el mismo host colisionaban compartiendo cookies genéricas.
- El **refresh token** es exclusivamente una cookie `HttpOnly` (`beemetry_refresh_token`) — el JS nunca la lee, solo dispara `POST` con `credentials:'include'` y deja que el navegador la adjunte.
- **CSRF double-submit**: la cookie `beemetry_csrf_token` (legible por JS) se repite en el header `X-CSRF-Token` (`csrfHeaders()` en `authApi.ts`) en cualquier request que dependa de la cookie de refresh.
- **Todas las cookies están namespaced** (`beemetry_*`, no nombres genéricos) — a propósito, para coexistir con otra app frontend en el mismo dominio (ADR-081/132).
- Gotcha real ya documentado (**ADR-187/188**, memoria del proyecto): cualquier ruta autenticada solo por `X-Device-Key`/`X-Api-Key` (no por sesión de usuario) debe llamarse con `credentials:'omit'` y sin header `Authorization` — si el navegador tiene una cookie de sesión de admin activa, el gate CSRF del backend la detecta igual y devuelve un 403 falso, aunque la ruta no tenga nada que ver con sesiones de usuario.
- **ADR-134/177**: hubo una vulnerabilidad crítica real (auto-registro público aceptaba `"role":"admin"` contra una empresa existente) — decomisada por completo, no solo mitigada. El endpoint de registro público **nunca** debe volver a aceptar un rol provisto por el cliente.
- **ADR-161**: hubo un bypass de seguridad real en el fallback de OTP de `authApi.ts` (trataba cualquier OTP como válido si el backend no respondía — fail-open). Ya corregido a fail-closed. Si tocás el flujo de OTP/pre-registro, no reintroduzcas un fallback "si falla, dejar pasar".

### 2.4 i18n: diccionarios propios, sin librería — y con un gap de cobertura conocido

`frontend/src/i18n/I18nProvider.tsx` (2238 líneas) es 100% custom — no hay `react-i18next` ni `formatjs`. Idiomas soportados: `es | en | fr | pt`, resueltos por país de acceso (**ADR-075**). Las traducciones son objetos planos con claves punteadas (`'auth.accessControl'`) y placeholders `{value}`.

**Gap conocido (ADR-075, actualización 2026-09-12)**: el tipo `TranslationKey` dejó de forzar que las 4 traducciones tengan exactamente las mismas claves (usa un escape `(string & {})`). Hoy puede haber hasta 154 claves faltantes en `en`/`pt`, que caen en fallback silencioso a español. **Si agregás una clave nueva, agregala a los 4 diccionarios a mano** — el compilador no te va a avisar si te olvidás de alguno.

### 2.5 Offline: SQLite/WASM vía Cache API — NO es IndexedDB, y está aislado por usuario+tenant

El ADR-022 se llama `offline-cola-versionada-indexeddb`, pero **el nombre no refleja la implementación real**: la persistencia offline es **SQLite compilado a WASM (`sql.js`)**, con los bytes serializados guardados vía la **Cache API** del navegador (`caches.open(...)`), no `indexedDB` directo. Si buscás código de IndexedDB para el editor de informes offline, no lo vas a encontrar — buscá `frontend/src/components/ReportStudioV2/lib/offlineSqlite.ts` (434 líneas).

Puntos clave:
- El nombre de la cache está **namespaced por `userId`+`tenantId`** (`beemetry-offline-sqlite-v2__${userId}__${tenantId}`) — esto corrigió una fuga real de datos entre técnicos que compartían una misma tablet de campo (**ADR-127**). Si tocás este archivo, no se te ocurra volver a un nombre de cache global.
- Concurrencia optimista: `expected_version`/HTTP 409 al guardar, reconciliación al reconectar, elección explícita sobreescribir-vs-guardar-como-nuevo. Las revisiones de conflicto quedan etiquetadas (`offline_conflict_overwrite`/`offline_conflict_kept_as_new`) para distinguirlas de un autosave normal.
- No confundir con `frontend/src/lib/mapOfflineCache.ts` — es un subsistema DISTINTO (cache offline de tiles de mapa, ADR-026/056), no la cola de edición de informes.

### 2.6 TypeScript estricto para código nuevo

`tsconfig.json` tiene `strict: true`, pero `allowJs: true`/`checkJs: false` — es una migración incremental (**ADR-069**, ya completada: 111 `.ts/.tsx` contra solo 6 `.js/.jsx` restantes, todos tests/config). **Todo código nuevo va en `.ts`/`.tsx`**, nunca `.js`/`.jsx`. `tsc --noEmit` (`npm run type-check`) es solo chequeo de tipos — Vite/esbuild hace la transpilación real, y **este chequeo no corre en CI** (ver §8). Corré `npm run type-check` a mano antes de cada PR, porque nadie más lo va a hacer por vos.

### 2.7 No hay linter ni formatter configurado

No existe `eslint.config.*`, `.eslintrc*` ni `.prettierrc*` en todo el repo. Esto es real, no un descuido de este documento. Consecuencia práctica: **la consistencia de estilo depende de que imites el código existente**, no de una herramienta. Antes de escribir un archivo nuevo, mirá 2-3 archivos similares ya existentes en la misma carpeta y calcá su estilo (comillas, punto y coma, orden de imports, forma de comentar el "por qué").

---

## 3. Estructura de `frontend/src`

```
src/
  auth/            # authApi.ts, authStorage.ts, roleConstants.ts, captura biométrica,
                    # usePermissions.ts, geolocation.ts — ver §2.3
  brand/           # marca/logo del producto
  components/
    Auth/          # pantallas de login/registro/biometría
    Dashboard/     # KPIs, dashboards operativos
    Editor/        # editor de texto rico (legado, distinto de ReportStudioV2)
    Formula/       # FormulaEngineEmbed.tsx — iframe al motor de fórmulas legado (ADR-188)
    Home/          # landing pública pre-login (ADR-171) — TODOS los datos son ficticios
                    # hasta que haya clientes reales, ver esa nota si tocás esta carpeta
    Platform/      # administración de plataforma/tenant
    ReportStudioV2/ # el módulo más grande y con más tests — editor de informes real
                    # (store/, lib/, components/) — ver §2.1
    Special/       # mapas, geoportal, visores especiales
    UI/            # NavBar.tsx y componentes de interfaz compartidos
    Viewer/        # visor de solo lectura de informes
  config/          # catálogos JSON, config ICAO facial, ubicaciones mineras
  i18n/            # I18nProvider.tsx — ver §2.4
  lib/             # utilidades transversales: fetchWithAuth, logger, mapOfflineCache,
                    # useLiveKpi, navClickGuard, trustedHtml, connectivityMonitor
  print-report/    # entry point separado (print-report.html) para el sidecar de
                    # exportación PDF headless — no es una vista normal de la SPA
```

`App.tsx` (354 líneas) es el shell autenticado; la mayoría de la lógica de navegación vive en `components/UI/NavBar.tsx` desde ADR-175.

---

## 4. Stack técnico y comandos

**Dependencias clave** (no reinventar lo que ya está):
- Estado: `zustand` (§2.1)
- Editor/canvas: `konva`/`react-konva` (ReportStudioV2 actual — **no** `@tiptap/react`, que es solo del módulo legado "Report v1")
- Gráficos: `echarts`, `plotly.js-basic-dist-min` (no el paquete `plotly.js` completo, swap deliberado del ADR-093), `react-plotly.js`
- 3D: `three`, `@react-three/fiber`, `@react-three/drei`
- Mapas: `leaflet` (offline vía MBTiles, ADR-026)
- Documentos: `docx`+`jszip` (exportación DOCX 100% cliente, ADR-139), `mammoth` (importación DOCX)
- Offline: `sql.js` (§2.5)
- Biometría: `@mediapipe/tasks-vision` (WASM, corre en el navegador — assets self-hosteados en `frontend/public/mediapipe/` por la CSP `connect-src 'self'`, ADR-162)
- Testing: `vitest` + `@testing-library/react` (unit), `@playwright/test` (E2E)

**Scripts** (`frontend/package.json`):
```bash
npm run dev          # servidor de desarrollo, puerto 5180 (NO 5173 — ese puerto lo ocupa
                      # Docker Desktop/WSL; ver frontend/vite.config.js)
npm run build         # build de producción
npm run type-check    # tsc --noEmit — corré esto a mano, no corre en CI (§2.6, §8)
npm run test          # vitest (watch)
npm run test:run      # vitest (una pasada, usado en CI)
npm run test:api      # solo authApi.test.js (contrato de auth)
npm run test:e2e      # playwright
npm run test:all      # build + test:run + playwright, la validación más completa disponible
```

**Build/deploy**: el contenedor de producción (`frontend/Dockerfile`) es un build estático servido por **nginx** — no hay proceso Node, no hay SSR, **no hay hot-reload en producción**. Cualquier cambio de frontend en el stack real requiere `docker compose up -d --no-deps --build frontend` para reflejarse. `nginx.conf` es templado (`envsubst` inyecta secretos server-side al arrancar, nunca llegan al navegador) y hace de reverse proxy hacia el backend (`/api/`, `/ws`), el motor de fórmulas legado (`/formula-api/`) y el tile server (`/tiles/`).

---

## 5. Patrones de UI/diseño

- **Accesibilidad**: estándar WCAG 2.1 AA obligatorio en formularios (**ADR-106**) — usar las clases CSS reutilizables ya creadas (`frontend/src/a11y-form-base.css`), no reinventar contraste a mano. Ver `docs/GUIA_IMPLEMENTACION_ADR106.md` para el detalle paso a paso.
- **Modales**: nunca usar `prompt()`/`alert()`/`confirm()` nativos del navegador — hay un modal host global + `SaveTitleModal` como patrón a seguir (**ADR-073**).
- **Referencia de marca**: `docs/decisions/092-plantilla-corporativa-timetelemetry-referencia-diseno.md` tiene la paleta de colores, tipografía (Roboto) y 26 layouts de referencia.
- **CSS auto-contenido para componentes lazy-loaded**: si un modal/componente se monta desde `App.tsx` pero su CSS vive en un chunk lazy de ReportStudioV2, el CSS puede no cargar a tiempo — usar hoja de estilos auto-contenida en el propio componente (**ADR-095**, bug real que ya ocurrió).

---

## 6. Seguridad — incidentes reales que no deben repetirse

Estos no son advertencias teóricas, son bugs que existieron en producción y se corrigieron. Si tu cambio se parece a alguno de estos patrones, deteneté:

| Qué pasó | ADR | No repetir |
|---|---|---|
| Registro público aceptaba `"role":"admin"` contra una empresa existente | 134, 177 | El endpoint de registro nunca debe leer un rol provisto por el cliente |
| Fallback de OTP trataba cualquier código como válido si el backend no respondía | 161 | Nunca un fallback "si falla la validación, dejar pasar" en un paso de seguridad |
| Cookies genéricas colisionaban entre dos frontends en el mismo host | 081, 132 | Toda cookie nueva debe llevar el prefijo `beemetry_` |
| Ruta autenticada solo por `X-Device-Key` recibía 403 CSRF falso si había una cookie de sesión de admin activa | ADR-187/188 (memoria) | `credentials:'omit'`, sin `Authorization`, en cualquier fetch a una ruta device-key-only |
| Cache offline compartida entre técnicos en la misma tablet filtraba datos de un usuario a otro | 127 | Toda cache/store persistente de datos de usuario debe llevar `userId`+`tenantId` en su clave |
| Post-red-team: CSP, cookies cross-site, validación de entrada | 133 | Revisar ese ADR antes de relajar cualquier header de seguridad existente |

---

## 7. Testing

- **Unit/componente**: Vitest + Testing Library, `jsdom`. La cobertura real está muy concentrada en **ReportStudioV2** (store, lib de docx/offline/clipboard/tablas, algunos componentes de gráficos) — el resto de la app (Dashboard, Home, Platform) tiene poca o ninguna cobertura. Si tocás ReportStudioV2, revisá si ya existe un `*.test.ts` hermano antes de escribir uno nuevo desde cero.
- **E2E**: Playwright, specs en `frontend/e2e/` (`dashboard`, `editor`, `editor-save`, `map-performance`, `report-v2-admin`, `user-maintenance`).
- Antes de un PR grande: `npm run test:all` (build + unit + E2E) es la validación más completa disponible localmente.

---

## 8. CI/CD — gaps conocidos

`.github/workflows/ci.yml` corre en cada push/PR: `npm ci` → `build` → Vitest (`test:run`, `test:api`) → Playwright contra `vite preview`.

**Gap real, no corregido todavía**: `type-check` (`tsc --noEmit`) **no corre en CI**. Un error de tipos puede llegar a `main` sin que nada lo detecte (ya pasó una vez, documentado en la auditoría de ADR-093 — `vite build` compiló igual con una regresión de tipos real). Hasta que se agregue ese paso a `ci.yml`, correr `npm run type-check` manualmente antes de cada PR es responsabilidad de quien programa, no un backstop automático.

Tampoco hay lint en CI (coherente con que no hay linter configurado, §2.7).

---

## 9. Catálogo de ADRs frontend-relevantes (por ámbito)

Tabla completa de los ADRs con relevancia directa en `frontend/`. Los que no aparecen acá (la mayoría de `core-iot` y `datos`, y buena parte de `ia`) son del backend C++/sidecars — irrelevantes para trabajo puramente frontend, salvo que tu tarea cruce el límite front↔back.

### Ámbito `plataforma`

| ADR | Slug | Resumen |
|---|---|---|
| 029 | rbac-identidad-plataforma-jwt | RBAC multitenant + JWT; refresh token migrado a cookie `HttpOnly` + CSRF double-submit |
| 036 | rbac-siete-roles-unificados | Unifica 4 roles RBAC con los 6 de `roleConstants.ts` + `viewer` = 7 roles |
| 040 | sistema-diseno-navegacion-enterprise | Sistema de navegación por "carriles" de Áreas/Opciones |
| 041 | resiliencia-token-fetch-crudo | Refresh automático de token en `fetch()` crudo del dashboard |
| 042 | nomenclatura-menus-lenguaje-llano-minero | Etiquetas de menú en lenguaje operativo llano |
| 063 | correccion-rbac-siete-roles-asignables | `ADMIN_ASSIGNABLE_ROLES` reemplaza `USER_ROLES` en pantallas de admin |
| 069 | migracion-frontend-typescript-estricto | Migración a TypeScript estricto (§2.6) |
| 075 | internacionalizacion-pais-idioma-acceso | i18n por país (§2.4, incluye gap de cobertura) |
| 079 | rbac-workflow-informes-inmutabilidad-firma | Permiso por transición de workflow; hook `usePermissions()` |
| 081 | cors-multiorigen-frontend-externo | CORS multi-origen, habilita un segundo frontend externo |
| 082 | autenticacion-cookie-httponly-csrf-double-submit | Patrón CSRF original (revisado por ADR-132/133) |
| 093 | vite8-rolldown-migracion-parcial-interop-plotly | Vite 8/Rolldown; swap a `plotly.js-basic-dist-min` |
| 095 | usermaintenancemodal-css-autocontenida-marca | CSS auto-contenida para modales montados fuera de su chunk lazy |
| 101 | fix-bucle-reintento-registro | Fix de loop de `useEffect` que borraba mensajes de error |
| 106 | accesibilidad-contraste-formularios-ui | WCAG 2.1 AA en formularios (§5) |
| 107 | geolocalizacion-cliente-login-contrasena | Geolocalización opcional del dispositivo cliente |
| 130 | rbac-empresas-minera-organizacion-acceso-cruzado | Acceso cruzado entre tenant organización y tenant minero |
| 132 | bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend | Bearer en memoria + cookies namespaced (§2.3) |
| 133 | endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada | Endurecimiento post red-team (§6) |
| 134 | fix-critico-escalada-privilegios-autoregistro-empresa-existente | Vulnerabilidad crítica de escalada de privilegios (§6) |
| 153 | reintento-login-facial-no-transitorio-y-precheque-username | Retry de login facial + pre-check de username |
| 154 | beacon-diagnostico-client-incident | `POST /api/client-incident` — reporta fallas reales del cliente al servidor |
| 161 | otp-validacion-contacto-pre-registro | OTP pre-registro; bypass de seguridad corregido (§6) |
| 162 | tracking-facial-local-mediapipe-wasm | MediaPipe Tasks Vision (WASM) en el navegador |
| 171 | pagina-publica-marketing-datos-ilustrativos | Landing pública — datos 100% ficticios hasta clientes reales |
| 175 | navbar-extraccion-shell-autenticado | Extracción de `NavBar.tsx` desde `App.tsx` |
| 176 | catalogo-pendientes-borrado-mejora-correccion | Catálogo de deuda técnica menor (propuesto, no decide) |
| 177 | decomiso-autoasignacion-rol-autoregistro-publico | Decomiso completo del vector de ADR-134 |
| 178 | operaciones-campo-fuera-de-alcance-implementacion-futura-independiente | "Operaciones de Campo" declarado fuera de alcance |

### Ámbito `reports` (ReportStudioV2 — el más denso, 44+ ADRs)

| ADR | Slug | Resumen |
|---|---|---|
| 010 | modelo-documento-json-bloques | Documento = JSON tipado de bloques; texto plano + spans, no ProseMirror |
| 011 | estructura-formal-secciones-cover-toc | `cover`/`toc` serializables, modelo de páginas plano |
| 012 | binding-dato-widget-referencia-versionada | Widget = referencia + snapshot versionado |
| 013 | editor-tiptap-konva | **Konva** para layout de página (actual); Tiptap solo en "Report v1" legado |
| 014 | estado-editor-zustand | Un solo store Zustand (§2.1) |
| 015 | versionado-informe-server-autoritativo | Versionado/auditoría autoritativos del servidor |
| 016 | export-server-side-asincrono | Export canónico server-side (Chromium headless) |
| 017 | workflow-canonico-informe | Máquina de estados draft→in_review→approved→signed→archived |
| 018 | firma-documental-vs-integridad-archivo | Firma de aprobación humana; integridad SHA-256 diferida |
| 019 | resolucion-diferida-numeracion-toc-refs | Numeración/TOC/referencias cruzadas automáticas |
| 020 | mapa-bloque-tipado-georeferencia | Mapa = snapshot de imagen (v0.1); geo-ref tipado diferido |
| 021 | ownership-metadatos-ciclo-vida | `meta.version` local vs `version_number` autoritativo (§2.1) |
| 022 | offline-cola-versionada-indexeddb | Offline real = SQLite/WASM vía Cache API, no IndexedDB (§2.5) |
| 044 | exportacion-portatil-cifrada-informes | Export `.mreport` cifrado AES-256-GCM |
| 045 | edicion-offline-sqlite-cliente | Edición offline con SQLite/WASM descargado localmente |
| 046-053 | header/footer, galería de imágenes, portada, ajuste de texto, spans, copiar/pegar, zoom/nav, estilos de tabla | Funcionalidades base del editor |
| 062, 064, 065 | inserción de video (webcam/pantalla) | `getUserMedia`/`getDisplayMedia` insertable en el lienzo |
| 069-071 | bloques de plantilla, página de TOC | |
| 073 | modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon | Sin `prompt/alert/confirm` nativos (§5) |
| 080 | marca-de-agua-y-password-pdf | Watermark + PDF con contraseña |
| 083, 084 | export PPTX, PPTX→MP4 | Modo presentación exportable |
| 092 | plantilla-corporativa-timetelemetry-referencia-diseno | Referencia de marca (§5) |
| 127 | aislamiento-cache-offline-sqlite-por-usuario | Cache offline aislada por usuario+tenant (§2.5) |
| 128 | plantillas-documento-tipo-presentacion | `docType: 'presentation'`, 16:9 nativo |
| 137 | envio-informes-notificaciones-multicanal | `POST /api/reports/{id}/share` |
| 138 | enlace-directo-pdf-qr-sin-password | QR para PDF sin cifrar |
| 139 | exportacion-docx-nativa-cliente | DOCX 100% client-side (`docx`+`jszip`), sin backend |
| 172 | motor-tablas-excel-formulas-formato-condicional | Motor de hoja de cálculo embebido en `TableBlock.tsx` |
| 173 | importacion-word-docx-mammoth | Importación `.docx` vía `mammoth` |
| 174 | capacidades-avanzadas-editor-store-navegacion-diapositivas | Undo/redo agrupado, autoFlow, `useDragPreviewStore` |
| 179 | push-sse-kpis-bug-real-query-y-cliente-frontend | `useLiveKpi.ts` (EventSource, auth por cookie) |
| 182 | verificacion-export-20-tipos-grafico-bugs-histograma-funnel | Fixes de export de gráficos |
| 183-185 | benchmark/optimización/cierre de export O3 | Meta de performance de export, desviación aceptada por negocio |

### Ámbito `ia` (solo puntos de contacto frontend)

| ADR | Slug | Relevancia frontend |
|---|---|---|
| 098 | aislamiento-sesion-captura-biometrica | `X-Capture-Session-Id` propagado desde el frontend |
| 147 | buffer-nginx-reintento-transitorio-precheque-dni | Fix de `nginx.conf`; `useLivenessChallengeSync` compartido |
| 157, 158 | UI de avatar listo | Polling de `GET /api/auth/avatar/thumb`, `AvatarWidget.tsx` |
| 164 | avatar-busto-uniforme-logo-y-wiring-soporte | `AvatarWidget.tsx` genérico, evento `requestSupportAvatar()` |

*(El resto de `ia`, ~35 ADRs, es motor biométrico backend/sidecar — no toca `frontend/`.)*

### Ámbito `geo`

| ADR | Slug | Resumen |
|---|---|---|
| 026 | cartografia-offline-mbtiles-maplibre | MBTiles offline + Leaflet |
| 056 | csp-service-worker-tiles-mapa | CSP dedicada para el Service Worker de tiles |
| 072 | gdal-cli-runtime-admin-confinado | CLI GDAL solo-admin (supersede a 028) |
| 121 | coordenadas-geograficas-empresa-mapa | Mapa centrado en la mina real del tenant |
| 123 | geocatmin-integracion-plataforma-minera | `MiningGeoportalView.tsx`, `GeocatminWorkbench.tsx` |

### Ámbito `realtime`

| ADR | Slug | Resumen |
|---|---|---|
| 057 | dashboard-widgets-estilo-thingsboard | Widgets tipo gauge/agregación alimentados por `/api/sensors/data` |

### Ámbito `soporte` (chat)

| ADR | Slug | Resumen |
|---|---|---|
| 116 | (panel `support_chat_message`) | Panel de chat de soporte |
| 129 | widget-chat-menu-whatsapp-adjuntos-cv-web | Menú estilo WhatsApp en el widget de chat web |

### Ámbito `marketing`

| ADR | Slug | Resumen |
|---|---|---|
| 171 | pagina-publica-marketing-datos-ilustrativos | Landing pública (`components/Home/`) — datos ficticios obligatorio (ver §3) |

### Motor de fórmulas legado (tab "Cálculo") — no es React

| ADR | Slug | Resumen |
|---|---|---|
| 187 | administracion-sensores-motor-formulas-tiempo-real | Motor real de fórmulas por sensor (backend, con UI en `SensorManagementView.tsx`/`FormulaOverviewView.tsx`, sí es React) |
| 188 | reconstruccion-tab-calculo-motor-real | El tab "Cálculo" (`components/Formula/FormulaEngineEmbed.tsx`) es un **iframe** a una app vanilla-JS (`frontend/public/formula/`), NO un componente React — si te asignan trabajo en "Cálculo", el código relevante no está en `src/`, está en `public/formula/app.js`+`index.html` |

---

## 10. Checklist antes de abrir un PR de frontend

- [ ] `npm run type-check` sin errores (no corre en CI, ver §8 — es tu responsabilidad)
- [ ] `npm run test:run` sin fallos
- [ ] Si tocaste algo de `ReportStudioV2/store`, ¿hay un `.test.ts` hermano que corriste?
- [ ] Si agregaste una clave de i18n, ¿la agregaste en los 4 diccionarios (§2.4)?
- [ ] Si agregaste una cookie o cache/store persistente de datos de usuario, ¿lleva el prefijo `beemetry_` y está namespaced por usuario+tenant si corresponde (§2.5, §6)?
- [ ] Si el cambio introduce una decisión de arquitectura nueva (no solo implementa una ya tomada), ¿escribiste el ADR correspondiente en `docs/decisions/`?
- [ ] ¿El código nuevo es `.ts`/`.tsx`, no `.js`/`.jsx` (§2.6)?
- [ ] ¿Revisaste un archivo similar ya existente para calcar el estilo, dado que no hay linter (§2.7)?
