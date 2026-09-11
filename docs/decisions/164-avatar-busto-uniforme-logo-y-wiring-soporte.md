# ADR-164 — Avatar de soporte: uniforme + logo Beemetry (compositing) y wiring a onboarding/report/alarm_loop

**Status**: 🟡 implementado; `avatar_engine` recreado y verificado con
inferencia GPU real (sin PII, ver §Verificación); backend compilado con
tests Catch2 en verde (`Dockerfile.verify`). Pendiente: redeploy del
contenedor principal (`beemetry-api`/`beemetry-web`) y verificación de
calidad visual del uniforme sobre un rostro real y consentido.
**Fecha**: 2026-09-08
**Autores**: Luder Armas + Claude
**Ámbito**: ia
**Relación**: extiende ADR-150 (avatar animado hablante, `avatar_animation_engine`)
y ADR-141/074 (estilización por difusión, `avatar_engine`). Respeta el
descarte de ADR-160 (cuerpo completo con movimiento, inviable por VRAM en
este host) — no lo reabre ni lo contradice.

## Contexto

Pedido explícito del usuario: un avatar animado que sirva de personaje de
soporte de la plataforma, con uniforme y logo de Beemetry, representando a
un especialista de campo minero, disponible en más partes del producto que
solo la bienvenida tras login.

Investigación previa (misma sesión) confirmó que la pieza de "cuerpo entero
con movimiento" ya fue evaluada y descartada por VRAM en ADR-160, y que lo
verificado y viable en este hardware es el avatar de **busto** hablante de
ADR-150 sobre el retrato estilizado de ADR-074/141. También se confirmó que:

- No existe ningún archivo del logo de Beemetry en el repo (solo un logo
  histórico "AURIXA", ver `frontend/src/brand/aurixa-logo.svg`).
- El backend ya acepta los `kind` `welcome|onboarding|report|kpi|alarm_loop`
  para el avatar animado (`POST /api/auth/avatar/animation`), pero solo
  `welcome` tenía un guion real y un disparador cableado en el frontend
  (`backend/src/auth/avatar_animation_job.cpp`, `AvatarWidget.tsx`) — el
  resto quedaba con el placeholder `"Vista previa del avatar animado."`,
  documentado como pendiente explícito en el propio código.
- No existe ningún selector de género en el pipeline, ni hace falta uno
  nuevo: ADR-074/141 ya estilizan la foto REAL de cada usuario, así que el
  resultado ya corresponde a esa persona.

## Decisión

### 1. Uniforme — cambio de prompt, no de arquitectura

`avatar_engine/avatar_diffusion.py` (`_STYLE_PROMPT`): se agrega, al final
del prompt ya probado (sesión 2026-09-03/08), una frase descriptiva de
vestuario ("wearing a navy blue collared corporate polo shirt with a thin
safety-orange trim at the collar, professional mining-field support
technician styling"). `_NEGATIVE_PROMPT` no cambia — sigue excluyendo
"logo" a propósito (ver punto 2).

### 2. Logo — compositing determinístico, NO generado por difusión

SD1.5 no renderiza texto/logos legibles de forma confiable; pedírselo a la
difusión da un resultado impredecible, no una insignia reconocible. En vez
de eso: `avatar_diffusion.py` gana `apply_logo_badge(out_bgr)`, invocada
desde `server.py` justo después de `enhance_with_gfpgan` (mismo punto del
pipeline, antes de encodear la respuesta). Cadena real:

1. `_load_logo_badge_rgba(path)`: los 3 archivos de logo reales
   (`avatar_engine/assets/beemetry-logo-{hex,badge-circular,wordmark}.png`,
   provistos por el usuario) NO tienen transparencia real — verificado con
   PIL antes de escribir código: los que tienen canal alfa lo tienen
   uniformemente en 255 (opaco), y `beemetry-logo-hex.png` ni siquiera tiene
   canal alfa. Se les agrega alfa por color-key simple (umbral "casi
   blanco" ≥245 sobre escala de grises + blur 3×3 para suavizar el borde) —
   funciona sin degradados que compliquen el umbral porque los 3 son tinta
   azul sólida sobre blanco plano.
2. Se usa `beemetry-logo-hex.png` (el ícono hexagonal solo, sin wordmark)
   por ser el más legible en tamaño pequeño.
3. `apply_logo_badge`: redimensiona el badge a ~16% del lado menor del
   retrato, lo pega con alpha blending en la esquina inferior derecha
   (margen ~4%). Nunca lanza — cualquier fallo (asset ausente, imagen
   inválida) devuelve la imagen sin insignia, mismo criterio defensivo que
   `enhance_with_gfpgan`. Togglable por `AVATAR_LOGO_BADGE_ENABLED` /
   `AVATAR_LOGO_BADGE_PATH`.

**Verificado sin GPU** (algoritmo puro, corrido dentro del contenedor real
`beemetry-avatar-engine` vía `docker exec`, sobre un lienzo sintético): el
color-key deja el badge limpio, sin halo blanco, y la posición/tamaño caen
donde se esperaba (badge 77×66px sobre lienzo 480×640, esquina inferior
derecha) — ver captura descartada tras la verificación.

### 3. Wiring de kinds a producto

`backend/src/auth/avatar_animation_job.cpp` (`defaultScriptForKind`): guiones
reales para `onboarding`, `report` y `alarm_loop` (antes placeholder único).
`kpi` se queda con el placeholder a propósito — sin punto de disparo real en
la UI (ver más abajo), documentado como pendiente, no como olvido.

`frontend/src/components/UI/AvatarWidget.tsx` deja de estar hardcodeado a
`kind: 'welcome'`:

- Nuevo `requestSupportAvatar(kind, dedupeKey?)` exportado, disparado por
  `CustomEvent` — mismo patrón imperativo que ya usa
  `ConfirmActionDialog.tsx` (`requestConfirmation`/`requestNotice`), sin
  contexto/provider nuevo.
- Deduplicación por sessionStorage, ahora por `(kind, dedupeKey)` en vez de
  un único flag fijo a `welcome`.
- **Restricción de GPU respetada por diseño**: `avatar_animation_engine`
  corre con un solo worker (`ThreadPoolExecutor(max_workers=1)`, cola tope
  3, ~200-300s/render, ver ADR-150). Mientras haya una animación en curso
  (`queued`/`rendering`), cualquier `requestSupportAvatar` nuevo se ignora
  — nunca se encola un segundo job desde este widget.

Disparadores reales (confirmados contra el árbol de código, no supuestos):

| Kind | Disparador | Archivo |
|---|---|---|
| `onboarding` | Clic en "Entrar al sistema" tras completar el registro biométrico (sustituye a `welcome` esa sesión, vía flag `beemetry_avatar_just_registered_v1`) | `AuthGateway.tsx` (rama `registerUserBiometricStep === 'success'`) → leído en `AvatarWidget.tsx` |
| `report` | Éxito de exportación PDF/DOCX/PPTX server-side | `ReportStudioV2/App.tsx`, `handleExportPdf`/`handleExportDocx`/`handleExportPptx` |
| `alarm_loop` | Alarma CRÍTICA no reconocida más reciente, vía WebSocket | `Dashboard/AlarmCenter.tsx`, efecto sobre `liveAlarms` de `useAlarmStream()` |
| `kpi` | **Ninguno** — sin punto de acción explícita real en `MiningKpiWidget.tsx`/`KpiOperationsView.tsx`/`TelemetryDashboard.tsx`/`MiningDashboard.tsx` (solo tooltips de ECharts al pasar el mouse). Se difiere a una pasada futura en vez de inventar un botón nuevo no pedido, o peor, disparar automáticamente al abrir el dashboard (violaría la restricción de cola de GPU de arriba). | — |

### 4. Arrastrable

No existía ninguna librería de drag (`react-rnd`/`dnd-kit`/`react-draggable`
ausentes de `frontend/package.json`) ni componente reposicionable en el
repo — confirmado por búsqueda dirigida. Se reutiliza la única mecánica de
arrastre real existente, `beginColumnResize` en
`ReportStudioV2/components/document/TableBlock.tsx:282-310` (patrón `useRef`
+ listeners `mousemove`/`mouseup` en `window`), adaptada en `AvatarWidget.tsx`
a delta X/Y libre en vez de solo ancho de columna. Posición persistida en
`localStorage` (`beemetry_avatar_widget_pos_v1`), clamped a los bordes del
viewport.

### Sobre género (aclaración, sin cambio de código)

No se agrega ningún selector de género. El pipeline de ADR-074/141 ya
estiliza la foto real de cada usuario — el avatar resultante ya corresponde
al género/rasgos de esa persona porque es su propia cara.

## Consecuencias

- El avatar de soporte ahora aparece en 4 momentos del producto en vez de 1
  (welcome/onboarding son mutuamente excluyentes, report y alarm_loop son
  aditivos), con vestuario e insignia de marca, sin tocar la arquitectura de
  cuerpo completo ya descartada por ADR-160.
- `kpi` queda explícitamente sin disparador — no es una omisión silenciosa,
  requiere diseñar una UI nueva (botón de ayuda) que no se pidió construir
  en esta pasada.
- El único mecanismo de "no saturar la cola de GPU" es del lado cliente
  (ignorar requests mientras hay uno en curso); el backend ya tenía su
  propio tope de cola independiente (`avatar_animation_engine`, cola=3) como
  segunda línea de defensa.

## Verificación

- **Frontend**: `npx tsc --noEmit` (0 errores) y `npx vite build` (build
  verde) sobre el árbol con los 4 archivos tocados
  (`AvatarWidget.tsx`, `AuthGateway.tsx`, `ReportStudioV2/App.tsx`,
  `Dashboard/AlarmCenter.tsx`).
- **Compositing del logo**: verificado SIN GPU, algoritmo puro corrido
  dentro del contenedor real `beemetry-avatar-engine` (mismo runtime
  cv2/numpy) sobre un lienzo sintético — resultado visual limpio, sin halo,
  posición esperada.
- **Backend (Catch2)**: `docker build -f backend/Dockerfile.verify backend`
  — ver bloque de actualización más abajo con el resultado real.
- **Pipeline completo end-to-end, SIN foto real**: `docker compose build
  avatar_engine` (build limpio, `COPY . .` recogió `avatar_diffusion.py`,
  `server.py` y `assets/` nuevos) + recreación del contenedor + `POST
  /stylize` real contra la GPU (RTX 5060, `pipeline ready device=cuda`) con
  una imagen SINTÉTICA generada por código (óvalo gris con dos puntos y una
  curva, CERO datos personales — se evitó a propósito usar cualquiera de los
  62 avatares HD reales ya almacenados en `/data/auth/avatars_hd` de este
  entorno, son datos biométricos de usuarios reales sin consentimiento
  específico para esta prueba). Resultado: `200 OK`, `elapsed_ms=4889`,
  imagen decodificada y verificada visualmente — la insignia del logo
  aparece limpia en la esquina inferior derecha, sin artefactos, exactamente
  igual que en la verificación sin GPU. Confirma que el pipeline completo
  (difusión + ControlNet + GFPGAN + `apply_logo_badge`) corre sin errores
  con el código nuevo.
- **Calidad del uniforme/vestuario sobre un rostro real**: la imagen
  sintética de la prueba de arriba no tiene hombros/cuello reales, así que
  no permite evaluar si la frase de vestuario agregada al prompt se ve bien
  sobre una persona real — esto SIGUE pendiente, requiere una foto de
  registro real y consentida, no disponible en esta sesión. Pendiente antes
  de subir el status de este ADR a "implemented, verificado" en el sentido
  pleno que usa el resto de este log (ver ADR-157/158/159 para el mismo
  patrón de "implementado en código, verificación con foto real pendiente").

## Alternativas descartadas

- **Pedirle el logo a la difusión vía prompt**: descartado — SD1.5 no
  renderiza texto/logos legibles de forma confiable, y ya hay evidencia en
  este mismo repo (`_NEGATIVE_PROMPT` excluye "logo" desde antes de este
  ADR) de que intentarlo generaba ruido, no una insignia reconocible.
- **Selector de género nuevo**: innecesario, ver arriba.
- **Columna DB `onboarding_completed` para detectar "primer login"**:
  descartada a favor de un flag de sessionStorage puesto en el momento real
  de "usuario recién registrado" (`AuthGateway.tsx`), que no requiere tocar
  el esquema ni una migración nueva.
- **Disparar `kpi` automáticamente al abrir el dashboard**: descartado por
  la restricción de cola de GPU de un solo worker — saturaría la cola
  compartida con el resto de usuarios de la plataforma.
- **Librería de drag nueva (`react-rnd`/`dnd-kit`)**: descartada a favor de
  reusar la mecánica ya existente en el repo (`TableBlock.tsx`), evita una
  dependencia nueva para un caso de uso simple (mover un div).

## Referencias

- ADR-074 (`avatar-biometrico-local-hd-bajo-demanda`)
- ADR-141 (`avatar-estilizado-difusion-local-sd15-controlnet`)
- ADR-150 (`avatar-animado-reenactment-evaluacion`)
- ADR-160 (`avatar-cuerpo-completo-pose-driven-descartado-vram`)

---

## Actualización 2026-09-08 (misma sesión) — resultado real de los builds

Ambos builds terminaron, limpios:

- `docker build -f backend/Dockerfile.verify backend --no-cache`: compiló
  los 89 archivos `.cpp` del target `beemetry_backend` (incluidos los dos
  archivos tocados por este ADR, `avatar_animation_job.cpp` y
  `auth_routes.cpp`) sin errores. `ctest`: **`backend_unit_tests` passed,
  100% tests passed, 0 failed** (el target liviano de este Dockerfile
  corre un solo binario Catch2 que internamente agrupa todas las
  aserciones, mismo patrón que otros ADR de este log).
- `docker compose build avatar_engine`: build limpio, `COPY . .` recogió
  los 3 archivos nuevos/editados (`avatar_diffusion.py`, `server.py`,
  `assets/`). Contenedor recreado y verificado sano (`pipeline ready
  device=cuda gfpgan=True`).

**No se redesplegaron los contenedores en producción de este entorno**
(`beemetry-api`/`beemetry-web`) — a diferencia de `avatar_engine` (servicio
aislado, sin sesiones de usuario en curso), reiniciar el backend/frontend
principal interrumpiría cualquier sesión activa del desarrollador en este
mismo entorno; queda como paso explícito a confirmar antes de ejecutarlo,
no una omisión.

Status sube a: 🟡 **implementado y compilando/corriendo limpio en el stack
real** (avatar_engine ya recreado y probado con inferencia GPU real;
backend compilado y con tests verdes, pendiente de redeploy del contenedor
principal); **pendiente de "verificado" en sentido pleno**: calidad visual
del uniforme sobre un rostro real (requiere foto de registro real y
consentida, no disponible en esta sesión) y `kpi` sigue diferido sin
disparador.
