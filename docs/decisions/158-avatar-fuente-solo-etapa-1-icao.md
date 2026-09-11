# ADR-158 — La fuente del avatar sale sólo de la etapa 1 (5 lecturas ICAO), nunca de la etapa 2 (desafío activo)

**Status**: implemented (pendiente de validación con un registro real con cámara)

**Fecha**: 2026-09-04

**Autores**: Luder Armas + Claude

**Ámbito**: frontend, ia

**Relación**: corrige la selección de frame introducida en ADR-074 y ajustada
en ADR-157. Complementa ADR-146 (gestos del desafío) y ADR-149 (desafío en
paralelo con la espera de parpadeo). No modifica ninguna garantía de prueba de
vida (ADR-142/145/148/149).

## Contexto

Observación del usuario: el avatar debe salir del mejor frame de las **5
lecturas ICAO consecutivas** (etapa 1), donde las 4 condiciones de validación
se cumplen al 100%, y **nunca** de la etapa 2 (desafío activo), donde la
persona está en movimiento y no se puede garantizar ni el ángulo, ni el
centrado, ni la ubicación.

Al revisar el código, el comportamiento real era **exactamente el opuesto**.
La condición de captura del candidato en `AuthGateway.tsx` era:

```ts
if (updated.qualityReady && hasFaceNow && bestFace && challengesPassedRef.current) {
```

`challengesPassedRef` sólo pasa a `true` cuando el servidor confirma
`challenge.complete`. Es decir: **no se capturaba ningún candidato hasta
después de terminar el desafío.** El comentario que acompañaba esa condición
("no capturar mientras el desafío sigue en curso") describía una intención
correcta, pero la implementación esperaba de más: cerraba la etapa 1 completa
además del gesto.

Cadena real de eventos, en orden:

1. Etapa 1: la persona acumula 5 lecturas ICAO consecutivas → `qualityReady`.
   **Ningún frame de aquí se guardaba.**
2. El servidor sortea el desafío (ADR-149: arranca con `icaoReadsCompleted`).
3. El gesto rompe la frontalidad → el contador vuelve a 0/5.
4. Terminado el gesto, `challengesPassedRef = true` y recién ahí se abría la
   ventana: la persona vuelve a acumular 5 frames válidos **mientras se
   reacomoda tras el gesto**, y de ahí salía el avatar.

Con `move_closer` (ADR-146), el paso 4 empieza literalmente con la cara pegada
a la cámara. Eso explica de forma directa la evidencia del incidente
documentado en ADR-157: `face_too_large(h=0.81..0.83)` en los logs reales de
`ai_engine`, y un primer plano descentrado con la coronilla cortada como fuente
del avatar.

## Decisión

**La ventana de captura del candidato se confina a la etapa 1.**

- Nuevo `challengeStartedRef`: pasa a `true` en cuanto el servidor sortea el
  primer desafío (hay cola, o `complete`), y vuelve a `false` sólo si el
  servidor reinicia toda la captura a la etapa 1 (`exhausted`, ADR-156) o
  arranca una sesión de cámara nueva.
- La condición de captura pasa a ser
  `updated.qualityReady && hasFaceNow && bestFace && !challengeStartedRef.current`.
- Ventana real disponible: el cliente alcanza 5/5 en ~85 ms (bucle de
  `requestAnimationFrame`, ~60 fps) mientras el servidor necesita ~875 ms
  (5 frames a ~175 ms) para sortear el desafío. Quedan varios cientos de
  milisegundos de frames 5/5 limpios para comparar entre sí.
- El desempate entre candidatos pasa a pesar `visualQuality * 2`: dentro de la
  etapa 1 todos los candidatos ya cumplen lo mismo (5/5 ICAO + `lastVerifyOk`),
  así que esos términos no discriminan; lo que decide es nitidez, exposición,
  tamaño de rostro, centrado y las penalizaciones de encuadre de
  `estimateAvatarFrameQuality` (ADR-157).
- Ventana de frescura del candidato 20 s → **90 s**: el candidato ahora nace
  ANTES del desafío, así que entre su captura y el envío transcurre todo el
  desafío (hasta `kLivenessChallengeMaxAttempts=5` × `kLivenessChallengeTimeoutMs=8000`
  = 40 s) más el llenado del formulario. Con 20 s el candidato bueno vencía
  casi siempre y el código caía a la captura en vivo justo en el peor instante
  posible: el final del gesto.

## Lo que NO cambia (importante)

- **La prueba de vida sigue igual de exigente.** El desafío activo continúa
  siendo obligatorio para **enviar**: `challengesPassedRef` sigue gateando el
  auto-envío de login facial y el de registro, sin tocar. Lo único que cambia
  es de qué etapa sale el píxel.
- Los 4 chequeos ICAO, el candado de lecturas (ADR-148), el parpadeo natural
  (ADR-145) y la verificación en servidor (ADR-142) quedan intactos.
- El mismo frame elegido sigue sirviendo de plantilla biométrica; que provenga
  de la etapa 1 lo hace, si acaso, más frontal y mejor encuadrado que antes.

## Consecuencias

- El avatar deja de heredar el encuadre del final de un gesto. Sumado a
  ADR-157 (reencuadre por padding y umbral propio de la etapa raw), la fuente
  que llega a SD1.5 es un frame frontal, centrado y a distancia normal.
- Caso patológico: si el cliente nunca llegó a 5/5 antes de que el servidor
  sortease el desafío, no hay candidato y el envío cae a la captura en vivo
  (comportamiento previo). Es improbable por la asimetría de cadencias descrita
  arriba — el servidor no sortea desafío sin haber contado 5 lecturas propias.

## Alcance: todas las pantallas de captura facial

Actualización de la misma sesión, a pedido explícito del usuario ("en todas
las pantallas que hagan uso de la validación biométrica facial se tiene que
respetar el proceso de selección de las mejores imágenes").

`UserManagementView` y `MaintenanceBiometricModal` no hacían selección alguna:
tomaban el frame EN VIVO del instante en que se cumplía el gate -- es decir,
exactamente el final del gesto. Peor que el caso de `AuthGateway`, que al
menos comparaba entre varios.

Se extrae `frontend/src/auth/bestBiometricFrame.ts`:

- `createBestFrameCollector()` acumula el mejor candidato con el mismo
  criterio (`visualQuality * 2 + bonus`) y la misma ventana de frescura
  (90 s). `build()` sólo se invoca cuando el candidato gana, para no codificar
  JPEG y plantilla en cada frame descartado.
- `faceBoxFromServerOval()` traduce `status.face_oval` (que viene en el
  espacio del frame subido, `FACIAL_ICAO.CAMERA.width/height.ideal`) al
  espacio de coordenadas nativo del `<video>`. Sin esa conversión
  `estimateAvatarFrameQuality` mediría el recorte en el lugar equivocado.
  Estas pantallas no corren MediaPipe localmente, así que el óvalo del
  servidor es su única fuente de geometría facial.
- `useLivenessChallengeSync` expone ahora `challengeStartedRef` con la misma
  semántica que en `AuthGateway`, para que las tres pantallas cierren la
  ventana en el mismo punto exacto.

En las tres, si no hay candidato de etapa 1 (o venció) se cae a la captura en
vivo -- el comportamiento anterior -- dejando constancia en el log.

## Validación pendiente

Requiere un registro real con cámara: confirmar en `docker logs
beemetry-ai-vision` que desaparece `face_too_large` en la etapa raw, y
comparar el volcado `00_work_wb_*` con los del incidente — debe verse un frame
frontal y centrado, no un primer plano.

## Actualización 2026-09-09 — la ventana de 90s seguía cayendo a captura en
vivo tras el desafío: usuario real, cabeza en movimiento en el avatar final

El usuario reportó, con el avatar 4K real de un registro nuevo (DNI
09637600, "LUDER EDER ARMAS JAIMES"), la cabeza claramente inclinada/en
movimiento — exactamente el defecto que esta decisión existe para evitar.
Confirmado por lectura de código (`AuthGateway.tsx`, no se pudo reproducir
en vivo: la cámara está bloqueada en el navegador headless de esta sesión,
ver limitación abajo): el mecanismo de "mejor candidato de etapa 1"
(`bestLoginProbeRef`) SÍ existe y SÍ se llena solo mientras
`!challengeStartedRef.current`, tal como describe este ADR — pero al momento
de armar el request final, si ese candidato tiene más de 90s
(`bestProbeIsFresh`, umbral que ya había subido de 8s→20s→90s por este mismo
tipo de incidente, ver comentario en el código), se descarta TODO
(`template`, `imageBase64`, `portraitOvalBase64`, `bustRectBase64`) y se cae
a `frameToBustRectAroundOvalJpegBase64(videoRef.current, liveFaceBox)` --
una captura EN VIVO, en el instante del envío, con la cabeza recién saliendo
del desafío activo (turn_left/turn_right/move_closer/move_away, hasta 40s de
por sí) más el tiempo real que toma completar el resto del formulario de
registro (nombre, DNI, empresa, rol, contraseña) para una persona real —
fácilmente más de 90s.

**Fix**: el umbral local de frescura en `AuthGateway.tsx` (duplicado del
`BEST_FRAME_MAX_AGE_MS` de `bestBiometricFrame.ts`, no lo importaba) se subió
de 90 000ms a 1 200 000ms (20 min). Razonamiento: a diferencia del `template`
(usado para el matching biométrico en sí, donde la frescura importa por
motivos de identidad), reusar las imágenes del avatar de un candidato
"viejo" dentro de la MISMA sesión de cámara ininterrumpida no tiene ese
mismo riesgo — sigue siendo la misma persona, solo un frame de más atrás en
el tiempo, y uno YA validado como estático/frontal en vez de uno fresco pero
recién salido de movimiento.

**Limitación de esta verificación**: el navegador de esta sesión no tiene
acceso a cámara (`getUserMedia` bloqueado en el entorno headless), así que
este fix se hizo por lectura de código + razonamiento sobre la causa exacta
que describen los propios comentarios del archivo, NO con una prueba en
vivo de un registro real. Queda pendiente que un registro real (cámara
física) confirme que el avatar ya no muestra movimiento — mismo criterio de
"no prometer verificado lo que no se verificó" del resto de este documento.
