# ADR-203 — Avatar: recorte de solo cabeza + catálogo de cuerpo/vestimenta pre-hecho (reemplaza el compuesto de hombros fotografiados)

**Status**: 🟡 implementado en código y verificado por build real (backend
Docker+ctest en verde, frontend `tsc`+`vite build` en verde, `avatar_engine`/
`ai_engine` reconstruidos); pendiente verificación visual con una foto de
registro real y consentida (sin acceso a cámara en este entorno, mismo
patrón de "implementado, verificación con foto real pendiente" que ADR-157/
158/159).

**Fecha**: 2026-09-20

**Autores**: Luder Armas + Claude

**Ámbito**: ia, backend, frontend

**Relación**: reemplaza el mecanismo de composición de ADR-074/141/157
(recorte de busto con hombros/torso de la FOTO REAL del usuario sobre lienzo
blanco) por un recorte de SOLO cabeza compuesto sobre una plantilla de
cuerpo/vestimenta pre-hecha. Respeta el descarte de ADR-160 (avatar de
cuerpo completo con movimiento, sigue inviable por VRAM en este host — no se
reabre ni se contradice: este ADR no anima el cuerpo, solo lo reemplaza por
una imagen estática). No modifica `avatar_animation_engine`/SadTalker
(ADR-150) más allá de heredar la imagen ya compuesta como fuente, ni la fase
de audio/TTS de ADR-202 (sesión concurrente sobre archivos distintos, sin
superposición). Sustituye el mecanismo de "vestimenta" de ADR-164 (frase de
texto en el prompt de difusión + logo compuesto en la esquina del busto) por
un catálogo real, seleccionable por el usuario.

## Contexto

Pedido explícito del usuario (2026-09-20, modo automático): recortar SOLO la
cabeza del avatar; el resto del cuerpo debe ser una imagen pre-guardada que
el usuario pueda elegir de un listado de vestimenta, evitando así todo el
problema de detección de hombros — y en su lugar concentrar el esfuerzo en
mejorar la detección/uniformidad de los bordes de la cabeza (cabello,
orejas). Además: reducir el avatar flotante interactivo un 50%, y permitir
"actualizar la vestimenta" del avatar ya generado.

### El problema real que esto resuelve

Investigación de código (esta sesión, antes de escribir nada) confirmó que
la segmentación de "persona" para el avatar vive en
`ai_engine/eye_analyzer.py` (no en `avatar_engine/`, que solo hace la
inferencia de difusión SD1.5+ControlNet) y que **no existe hoy ningún
modelo ni lógica que distinga pelo/orejas de hombros/ropa**:

- Camino legado (`_bust_roi_mask_from_mediapipe`, retrato ovalado sobre
  negro): la máscara es el casco convexo del contorno facial genérico de
  MediaPipe (`FACEMESH_FACE_OVAL`), con la mitad superior e inferior
  **dilatadas a lo bruto** con kernels elípticos fijos para aproximar
  "pelo" y "cuello/hombros" — no hay clasificación real, solo un
  `cv2.dilate()` ciego.
- Camino primario actual (`_person_mask_selfie_or_fallback`, recorte
  rectangular con fondo de cámara real): `selfie_segmenter.tflite` de
  MediaPipe es un segmentador **binario** persona/fondo — incluye
  pelo/orejas/hombros/ropa como un solo blob "persona", sin ninguna
  distinción entre ellos.

Esa falta de distinción es la causa raíz documentada de una cadena larga de
incidentes reales ya registrados en este mismo log (ALPAYANA/09637600,
2026-09-03 a 09-10): rostro cortado por umbrales calibrados en el dominio
geométrico equivocado (ADR-157), fuente de captura con encuadre
impredecible (ADR-158), y — el más directamente relacionado con este ADR —
en `avatar_animation_engine/matting.py`, una serie de parches sucesivos
sobre la MISMA ambigüedad de borde hombro/fondo: degradado ancho de
confianza en la franja de hombros (líneas ~140-190, fix con sigmoide
centrado en 0.5), y una franja de ~35% del alto del video mal clasificada
como "persona" opaca por el prior espacial del segmentador (entrenado con
selfies reales, no con avatares compuestos sobre lienzo blanco puro; fix
con umbral de casi-blanco forzado a transparente). Ambos son parches sobre
el mismo problema estructural: pedirle a un segmentador genérico que separe
correctamente algo que nunca se le enseñó a separar (piel/pelo real de
tela/hombro reales), sobre una composición (avatar sobre blanco) fuera de
la distribución con la que se entrenó.

**La idea central de este ADR es eliminar el problema en vez de seguir
parchándolo**: si el cuerpo/vestimenta ya NO viene de una foto (viene de una
plantilla que se controla por completo, con alfa perfecto por
construcción), la segmentación real solo necesita resolver un problema
mucho más chico y mejor acotado — dónde termina la cabeza — y el corte se
hace por una línea de cuello fija, nunca por "dónde cree el modelo que
empieza el hombro".

## Decisión

### 1. Recorte de SOLO cabeza, con corte duro de cuello (`ai_engine/eye_analyzer.py`)

- Nuevo modelo **adicional** de MediaPipe: `selfie_multiclass_256x256.tflite`
  (segmentador multiclase oficial: fondo/pelo/piel-cuerpo/piel-cara/ropa/
  otros — Apache 2.0, mismo origen `storage.googleapis.com/mediapipe-models`
  que el `selfie_segmenter.tflite` binario ya usado en este repo). Descarga
  idempotente vía el mismo mecanismo ya existente
  (`mediapipe_models_fetch.py::_MODEL_SPECS`, no obligatorio: si falla la
  descarga, el motor sigue con el fallback de abajo).
- `_head_only_mask(out_bgr, alpha_sm)`: construye la máscara de cabeza como
  la unión de las categorías pelo + piel-cara + piel-cuerpo + otros
  (accesorios) — **nunca** la categoría "ropa" — restringida al componente
  conexo que toca la cara (reutiliza `_restrict_mask_to_face_component`, ya
  existente) y a la región "persona" ya conocida (`alpha_sm`). Después de
  eso, **corte duro**: cualquier fila por debajo de una línea de cuello fija
  (mentón detectado + margen fijo `AVATAR_HEAD_NECK_MARGIN_FRAC`, default
  0.32 del alto de rostro) se pone a 0 sin excepción, sin importar qué haya
  dicho el segmentador ahí — este es el mecanismo real que elimina la
  dependencia de "adivinar" dónde empieza el hombro.
- Sin el modelo multiclase disponible (descarga fallida): cae a
  `_person_mask_selfie_or_fallback` (el binario ya existente) con el MISMO
  corte duro de cuello encima — pierde la clasificación fina pelo/orejas,
  pero conserva la mejora estructural central.
- Plumeado del borde: mismo agudizado sigmoide centrado en 0.5 ya verificado
  en `avatar_animation_engine/matting.py` (empuja valores intermedios hacia
  los extremos sin desplazar el punto de decisión) — reimplementado acá
  porque son procesos/contenedores separados sin módulos compartidos.
- `_head_cutout_rgba(out_bgr, head_mask)`: recorte BGRA ajustado al bounding
  box de la cabeza (+ padding chico), el artefacto que se persiste para
  poder recomponer sin volver a estilizar.

### 2. Catálogo de cuerpo/vestimenta pre-hecho, dibujado por código (`ai_engine/avatar_body_templates.py`, nuevo)

4 plantillas fijas (`polo_azul`, `chaleco_seguridad`, `camisa_gris`,
`chaqueta_campo`), cada una un lienzo 3:4 dibujado con `cv2`/`numpy` en vez
de con difusión o arte de terceros:

- **Por qué NO difusión**: pedirle a SD1.5 un "cuerpo sin cara"/maniquí no
  es confiable — el modelo insiste en pintar una cara donde no se le pide
  una. Es la MISMA clase de problema ya documentada en este repo para
  logos/texto (`avatar_engine/avatar_diffusion.py`, `_NEGATIVE_PROMPT`
  excluye "logo" desde ADR-164 porque SD1.5 no renderiza eso de forma
  confiable). Se aplica el mismo criterio que ya usó ADR-164 para el logo:
  compositing determinístico en vez de generativo poco confiable.
- **Por qué NO arte de terceros**: cero riesgo de licencia nuevo que auditar
  (este log ya tiene un historial extenso de auditorías de licencia de
  modelos/pesos — ADR-144/166 — evitar sumar un paquete de assets de
  terceros a esa lista).
- Cada plantilla trae metadata de anclaje (`neck_center_x_frac`,
  `neck_top_y_frac`, `neck_width_frac`) — geometría CONOCIDA por
  construcción, a diferencia de una foto real de encuadre impredecible.
  `compose_head_on_template()` escala el recorte de cabeza para que el
  ancho de SU PROPIO cuello (medido directamente del canal alfa, banda
  80%-95% de su alto) coincida con `neck_width_frac`, y lo pega anclado al
  bounding box REAL del contenido alfa (no al tamaño del arreglo, que trae
  padding transparente de `_head_cutout_rgba`) — bug real encontrado y
  corregido en esta misma sesión con una prueba sintética antes de
  integrarlo (ver "Verificación").
- El logo Beemetry (ADR-164) se compone en la plantilla misma (mismo
  algoritmo de color-key sobre casi-blanco ya verificado ahí, reimplementado
  acá porque son servicios distintos) — necesario porque el recorte de solo
  cabeza corta la esquina inferior derecha del busto donde antes vivía el
  logo aplicado por `avatar_engine`.
- Plantillas cacheadas en disco (`AVATAR_BODY_TEMPLATE_DIR`, se dibujan una
  sola vez) — dibujarlas de nuevo es <50ms de `cv2` puro, no un costo real,
  pero cachear evita divergencias entre réplicas.

### 3. Persistencia del recorte de cabeza para "cambiar de vestimenta" sin GPU

- `/cartoon_avatar` (ai_engine) devuelve ahora `head_cutout_base64` (PNG
  RGBA) además de `image_base64`/`image_hd_base64`. El backend lo persiste
  en `/data/auth/avatar_heads/{userId}.png` (mismo patrón tmp+rename+
  permisos 0600 que `avatars_hd`, `backend/src/main.cpp`, hilo
  `AUTH_REGISTER_CARTOON_BG`) — fuera de la fila de la BD a propósito
  (derivado biométrico grande, igual criterio que el maestro HD).
- Nueva ruta ai_engine `POST /recompose_avatar_body`: pega un recorte de
  cabeza YA generado sobre OTRA plantilla — puro `cv2`/`numpy`, sin GPU, sin
  difusión, sin volver a detectar rostro. Nueva ruta `GET
  /avatar_body_templates`: catálogo con miniaturas.
- Backend: `GET /api/avatar/body-templates` (proxy autenticado del
  catálogo, marca cuál es la plantilla ACTUAL del usuario) y `POST
  /api/auth/avatar/body-template` (`{"slug": "..."}` → lee el recorte de
  cabeza persistido, llama al recompose rápido, reescribe
  `avatars_hd/{userId}.png` y `avatar_cartoon_base64`). Responde `409
  avatar_head_not_available` si la cuenta no tiene recorte persistido
  (avatares generados antes de este cambio, o los 3 niveles de fallback
  cayeron al lienzo blanco clásico sin cabeza aislable) — requiere
  regenerar el avatar (reenrolarse), no es un error transitorio.
- `auth_users.avatar_body_template_slug TEXT` (`db_scripts/113_avatar_body_template.sql`,
  espejado en el bootstrap inline de `auth_storage_pg.cpp::ensureAuthSchemaPg`
  igual que el resto del esquema, ADR-131) — catálogo chico y curado, CHECK
  explícito en vez de tabla aparte, mismo criterio que
  `avatar_animation_job.kind`. Slug vacío (`''`) es el estado real de toda
  cuenta anterior a este cambio.
- Ambos backends de almacenamiento (Postgres y File, este último modo
  desarrollo/offline) quedan al día: `updateUserAvatarBodyTemplatePg`/
  `updateUserAvatarBodyTemplateFile`.

### 4. Avatar flotante interactivo, 50% más chico (`frontend/src/components/UI/AvatarWidget.tsx`)

Pedido explícito: `WIDGET_WIDTH` 220px → 110px (mitad). Todo lo que se
dibuja dentro (`AlphaVideoCanvas`) escala con ese único ancho por diseño
previo, así que no hizo falta tocar la lógica de recorte de márgenes
blancos ya existente ahí — solo se redujeron proporcionalmente los controles
superpuestos (botón de mute 26px→20px, botón de cerrar 22px→17px, ícono de
play 34px→18px) para que sigan siendo legibles/tocables al nuevo tamaño.

### 5. Selector de vestimenta (`frontend/src/components/UI/AvatarBodyTemplatePicker.tsx`, nuevo)

Panel dentro del diálogo de avatar HD ya existente en `NavBar.tsx` (botón
"Cambiar vestimenta" nuevo en su pie): lista el catálogo
(`listAvatarBodyTemplates`), aplica la selección
(`updateAvatarBodyTemplate`) y refleja el resultado de inmediato en la
cabecera vía un override local de `NavBar` (`session` es una prop que este
componente no controla; `updateSessionAvatar()` persiste el valor para la
próxima carga, el override local lo refleja en la sesión actual sin
recargar). Claves i18n nuevas agregadas solo al diccionario `es` — el resto
de idiomas (`en`/`fr`/`pt`) ya usan `es` como base + `translate()` cae a
`es` para cualquier clave ausente (mecanismo de fallback ya existente en
`I18nProvider.tsx`), así que no queda ninguna clave rota, solo pendiente de
traducción real.

## Consecuencias

- **Elimina de raíz** la dependencia de segmentar hombros/ropa reales para
  el avatar estático — el corte de cuello es una línea fija por landmarks,
  nunca una inferencia de "dónde termina la persona".
- **Mejora medible de la calidad de borde de cabeza** (pelo/orejas): pasa de
  un casco convexo dilatado a lo bruto (o un binario persona/fondo sin
  distinción) a una máscara por categorías reales (pelo/piel-cara/piel-
  cuerpo/otros) del modelo multiclase oficial de MediaPipe, sin agregar
  ningún modelo GPU nuevo (TFLite/CPU, igual que el segmentador binario ya
  en uso) — no compite por los ~8GB de VRAM compartidos de este host
  (ADR-160).
- **"Cambiar de vestimenta" es instantáneo** (recompose puro `cv2`, sin
  difusión ni GPU) en vez de una regeneración completa de 15-40s — mejora
  de velocidad concreta pedida por el usuario, medible por diseño (nueva
  ruta separada de la de generación).
- **Sin migración retroactiva**: cuentas con avatar generado antes de este
  cambio no tienen recorte de cabeza persistido ni pueden usar "cambiar de
  vestimenta" hasta reenrolarse — no se reprocesa la foto original (no se
  retiene, ver minimización de ADR-074), es una limitación conocida y
  aceptada, no un olvido.
- El logo Beemetry (ADR-164) migra de "compuesto sobre el busto que generó
  avatar_engine" a "compuesto sobre la plantilla" — mismo resultado visual
  final, mecanismo distinto porque el recorte de cabeza ya no incluye la
  esquina donde vivía antes.
- `avatar_animation_engine`/SadTalker (ADR-150) no cambia de arquitectura:
  sigue recibiendo la imagen HD ya compuesta como fuente. Es razonable
  esperar que `matting.py` tenga MENOS ambigüedad de borde en el video
  resultante (la región de cuerpo ahora es una plantilla con colores/bordes
  limpios por construcción, no una foto con ruido JPEG/iluminación real) —
  **no verificado con evidencia real todavía**, esta sesión no tiene acceso
  a GPU de animación ni a una cuenta con avatar animado end-to-end nuevo.

## Verificación

- **ai_engine, sintaxis**: `python -m py_compile eye_analyzer.py
  avatar_body_templates.py mediapipe_models_fetch.py` — sin errores.
- **`avatar_body_templates.py`, lógica de compositing**: ejecutado standalone
  (cv2/numpy puro, sin mediapipe/torch) contra un recorte de cabeza
  SINTÉTICO (óvalos generados por código, cero datos personales, mismo
  criterio de privacidad que ADR-164) para las 4 plantillas + un slug
  inválido (cae al default). **Encontró y corrigió un bug real antes de
  darlo por bueno**: la primera versión anclaba el recorte al tamaño del
  arreglo BGRA completo, no al bounding box real del canal alfa — como
  `_head_cutout_rgba` agrega padding transparente alrededor del recorte,
  esto dejaba un hueco visible entre el mentón y el cuello de la plantilla.
  Corregido anclando al bounding box real del contenido alfa (filas/columnas
  con alfa > umbral) en vez del tamaño del arreglo; reverificado con el
  mismo caso sintético (incluida una variante con padding asimétrico
  izquierda/derecha) — el hueco desaparece y el centrado horizontal se
  mantiene correcto.
- **Backend**: `docker build -f backend/Dockerfile.verify backend` (contexto
  `backend/`, ver nota de migración de esta cuenta) — build limpio de los
  ~90 archivos `.cpp` incluidos los tocados por este ADR
  (`ai_engine_client.cpp/hpp`, `auth_routes.cpp`, `auth_storage_pg.cpp/hpp`,
  `auth_storage_file.cpp/hpp`, `auth_types.hpp`, `main.cpp`,
  `biometric_types.hpp`); `ctest` → `backend_unit_tests` **100% passed, 0
  failed**.
- **Frontend**: `npx tsc --noEmit` (0 errores) y `npx vite build` (build
  verde) sobre el árbol con `AvatarWidget.tsx`, `AvatarBodyTemplatePicker.tsx`
  (nuevo), `NavBar.tsx`, `authApi.ts`, `authStorage.ts` (sin cambios de
  firma, solo import existente), `I18nProvider.tsx`, `index.css`.
- **`ai_engine`, build de contenedor real**: `docker compose build ai_engine`
  — ver bloque de actualización más abajo con el resultado real.
- **Pendiente**: registro real con cámara (no reproducible en este entorno,
  sin acceso a cámara física) — confirmar visualmente que el recorte de
  cabeza real (no sintético) encaja bien sobre cada una de las 4 plantillas,
  que `AVATAR_HEAD_NECK_MARGIN_FRAC=0.32` no corta mentón ni incluye hombro
  real en ningún caso normal, y que "cambiar de vestimenta" se refleja en la
  cabecera sin recargar. Mismo criterio de "no prometer verificado lo que no
  se verificó" que el resto de este log (ADR-157/158/159).

## Alternativas descartadas

- **Modelo de matting de pelo dedicado en GPU (ej. MODNet)**: sumaría un
  segundo modelo GPU-residente en un host con ~8GB de VRAM YA ajustados
  entre `avatar_engine` y `avatar_animation_engine` (ADR-160) — el
  segmentador multiclase de MediaPipe (TFLite/CPU) logra el objetivo sin
  ese costo.
- **Cuerpo/plantilla generado por difusión**: descartado por confiabilidad,
  mismo criterio que el logo en ADR-164 (SD1.5 no puede NO pintar una cara
  cuando se le pide un cuerpo sin cara de forma consistente).
- **Migrar retroactivamente los avatares existentes**: requeriría
  reprocesar la foto original de registro, que no se retiene por diseño
  (minimización, ADR-074) — no es técnicamente posible sin pedirle a cada
  usuario que se reenrole.
- **Tabla de catálogo en base de datos para las plantillas**: innecesaria
  para un conjunto chico y curado que solo cambia por decisión de producto,
  no por acción del usuario — mismo criterio que
  `avatar_animation_job.kind` (CHECK explícito).
- **Reescribir `_compose_avatar_canvas` en el lugar**: descartado a favor de
  una función nueva (`compose_head_on_template`) que convive con la
  anterior como fallback — la lógica existente tiene un historial de
  incidentes reales ya resueltos (ALPAYANA/09637600) que no vale la pena
  arriesgar tocando en el mismo cambio; la ruta nueva se activa primero y
  cae a la anterior ante cualquier fallo de la máscara de cabeza.

## Referencias

- ADR-074 (`avatar-biometrico-local-hd-bajo-demanda`)
- ADR-141 (`avatar-estilizado-difusion-local-sd15-controlnet`)
- ADR-150 (`avatar-animado-reenactment-evaluacion`)
- ADR-157 (`avatar-encuadre-y-visibilidad-en-primera-sesion`)
- ADR-158 (`avatar-fuente-solo-etapa-1-icao`)
- ADR-159 (`avatar-mejoras-calidad-gfpgan-steps-mejor-seed`)
- ADR-160 (`avatar-cuerpo-completo-pose-driven-descartado-vram`)
- ADR-164 (`avatar-busto-uniforme-logo-y-wiring-soporte`)
- ADR-167 (`avatar-soporte-alcance-v1-saludo-bienvenida-justificacion-ia`)
- ADR-202 (`avatar-tts-neuronal-piper-reemplaza-espeak-ng`)
- `ai_engine/eye_analyzer.py` (`_head_only_mask`, `_head_cutout_rgba`,
  `_cartoonify_face_bgr`, rutas `/cartoon_avatar`, `/recompose_avatar_body`,
  `/avatar_body_templates`)
- `ai_engine/avatar_body_templates.py` (nuevo)
- `ai_engine/mediapipe_models_fetch.py` (`selfie_multiclass_256x256.tflite`)
- `backend/src/auth/auth_routes.cpp` (`handleListAvatarBodyTemplates`,
  `handleUpdateAvatarBodyTemplate`)
- `backend/src/biometric/ai_engine_client.cpp/hpp`
  (`listAvatarBodyTemplatesFromAiEngine`,
  `recomposeAvatarBodyTemplateOnAiEngine`)
- `db_scripts/113_avatar_body_template.sql`
- `frontend/src/components/UI/AvatarWidget.tsx`,
  `AvatarBodyTemplatePicker.tsx` (nuevo), `NavBar.tsx`
