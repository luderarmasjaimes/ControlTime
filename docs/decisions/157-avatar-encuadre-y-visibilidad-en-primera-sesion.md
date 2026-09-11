# ADR-157 — Avatar: encuadre antes de difundir, umbral propio de la etapa raw, y visibilidad en la primera sesión

**Status**: implemented (pendiente de validación visual con un registro real)

**Fecha**: 2026-09-04

**Autores**: Luder Armas + Claude

**Ámbito**: ia, backend, frontend

**Relación**: corrige defectos de ADR-074 (avatar biométrico), ADR-141
(estilizado por difusión SD1.5+ControlNet) y del control de calidad añadido en
la sesión 2026-09-03. No revierte ninguna de esas decisiones.

## Contexto

Dos reportes reales del usuario sobre la misma cuenta recién creada:

1. Tras registrarse, la cabecera mostraba el placeholder de dos iniciales, como
   si el avatar no se hubiera creado. Cerrando sesión y volviendo a entrar, el
   avatar aparecía.
2. La calidad del avatar era mala: se recibía la foto real prácticamente sin
   estilizar (no el render 3D del pipeline de ADR-141).

Diagnóstico con evidencia de runtime (logs de contenedores y volcados de
`AVATAR_DEBUG_DIR`), no por sospecha.

### (1) Avatar invisible en la primera sesión

El registro guarda al usuario con `avatarCartoonBase64` vacío a propósito
(`main.cpp`) y genera el avatar en un hilo *detached*
(`AUTH_REGISTER_CARTOON_BG`, 15-40 s entre los 3 niveles de fallback y las 3
seeds de difusión), para no bloquear el alta. `authUserSessionJson()` omite el
campo cuando está vacío, el frontend persiste esa sesión en `localStorage` y
**nunca la vuelve a consultar**: solo el login (que sí lee la fila ya
actualizada) traía el avatar. No existía ningún endpoint que devolviera la
miniatura del usuario de la sesión — `/api/auth/avatar/hd` sirve el máster 4K y
responde 404 mientras no esté listo.

### (2) Calidad: la difusión funcionaba y su salida se descartaba

- `avatar_engine` estaba sano, con SD1.5+ControlNet en GPU, y **sin un solo
  falso positivo NSFW** — ADR-155 quedó confirmado como operativo.
- Cada inferencia devolvía `stylize ok` en 3-7 s, y aun así las tres seeds se
  rechazaban:
  ```
  [AVATAR_QUALITY] rejected seed=default stage=raw reason=face_too_large(h=0.81,w=0.51)
  ```
  cayendo a `generator=local_mediapipe_opencv` — la foto cruda que reportó el
  usuario.
- Los volcados lo confirman: `diffusion_seeddefault.png` es un estilizado 3D
  correcto; `99_thumb_final_candidate.png` es la foto sin estilizar.

Dos causas encadenadas:

- **Umbral aplicado en el dominio geométrico equivocado.**
  `AVATAR_QUALITY_MAX_FACE_FRACTION=0.55` se calibró sobre lienzos
  **compuestos** (máximo real 0.458 en CA-15(a)), donde el rostro ya está
  reducido al 92% del lienzo. La etapa `raw` lo aplicaba sobre el **recorte de
  busto** de `_bust_roi_mask_from_mediapipe`, donde el rostro ocupa por
  construcción 0.7-0.85 del alto: ahí 0.55 es inalcanzable. El control
  rechazaba salidas buenas y entregaba una peor.
- **El encuadre de origen.** La captura era un primer plano descentrado, con la
  coronilla cortada y mirada hacia abajo. ControlNet-Canny replica la
  composición que recibe: no puede inventar el encuadre de retrato corporativo
  que su propio prompt describe.

## Decisión

1. **Umbral propio para la etapa raw.**
   `_avatar_output_quality_reason()` acepta `max_face_frac_override`; el bucle
   de reintento de difusión pasa `AVATAR_QUALITY_MAX_FACE_FRACTION_RAW`
   (default 0.88). El control del **compuesto final** — el que realmente
   protege lo que se persiste — no cambia: sigue en 0.55.

2. **Reencuadre solo por padding antes de difundir.**
   `_diffusion_reframe_pad()` rellena el recorte con blanco hasta que el rostro
   ocupa ~`AVATAR_DIFFUSION_TARGET_FACE_FRACTION` (0.45) del alto, centrado en
   X y con headroom (centro del rostro al 42% del alto, igual criterio que
   `_compose_avatar_canvas`). Se difunde el lienzo y se recorta exactamente la
   región original.
   **Nunca reescala**: la máscara alfa, los bordes y todo el compuesto viven en
   la grilla de píxeles de `work_wb`; padding + recorte es reversible píxel a
   píxel, un reescalado obligaría a rehacer segmentación y matte.

3. **Endpoint `GET /api/auth/avatar/thumb`** — devuelve `{status:"ready",
   avatar_cartoon_base64}` o `{status:"pending"}` (200, no 404: la ausencia es
   un estado legítimo durante los primeros segundos de la cuenta). Mismas
   garantías que `/avatar/hd`: resuelve por sesión, nunca por un `user_id` del
   cliente (IDOR), y revalida que el usuario siga activo.
   El frontend sondea cada 6 s, máximo 20 intentos (~2 min), **solo** si la
   sesión no tiene avatar, y actualiza sesión y cabecera sin recargar ni
   re-loguear. Si los 3 niveles fallan, el sondeo se agota en silencio y queda
   el placeholder de iniciales (comportamiento de ADR-074).

4. **Penalización de encuadre en la captura.**
   `estimateAvatarFrameQuality()` ya penalizaba el recorte de frente; se suman
   *demasiado cerca* (ancho de rostro > 0.45 del frame) y *descentrado
   horizontal* (> 0.1 del ancho). Sigue sin **bloquear** ningún frame: solo
   reordena cuál de los frames ya aprobados por ICAO/liveness gana como fuente
   del avatar. Bloquear haría imposible el registro en webcams de laptop mal
   ubicadas, que es justamente el caso que produjo el incidente.

## Consecuencias

- Un registro con encuadre mediocre ahora produce un avatar **estilizado** en
  vez de la foto cruda: el rechazo por `face_too_large` en la etapa raw
  desaparece para recortes de busto normales.
- El usuario recién registrado ve su avatar dentro de la misma sesión.
- El reencuadre agranda el lienzo que recibe SD1.5, que lo reduce a
  `AVATAR_DIFFUSION_MAX_SIDE`: el rostro recibe algo menos de resolución
  efectiva. Acotado con `AVATAR_DIFFUSION_MAX_REFRAME_GROWTH` (2.2×).
- Riesgo residual: subir el umbral raw a 0.88 deja pasar colapsos con rostro
  muy grande que antes se filtraban ahí. Mitigado porque el control del
  compuesto final (0.55) y el de identidad (`AVATAR_QUALITY_MIN_IDENTITY_SIM`)
  siguen intactos y son los que gatean lo que se persiste.
- Sigue vigente la limitación conocida de ADR-141: deriva de identidad propia
  de SD1.5 sin anclaje (IP-Adapter-FaceID/InstantID descartados por licencia).

## Validación pendiente

Requiere un registro real con cámara (no reproducible sin rostro en vivo):
comprobar en los logs de `beemetry-ai-vision` que una seed pasa la etapa raw
(desaparece `face_too_large`), que el thumb final es el estilizado, y que la
cabecera cambia de iniciales a avatar sin cerrar sesión.
