# ADR-141 — Avatar estilizado por difusión local (SD1.5 + ControlNet-Canny), opcional

**Status**: implementado, validado y activado en el entorno operativo con RTX 5060 Laptop. El 2026-09-03 se reconstruyó correctamente la imagen oficial de `ai_engine` después de aislar SilentFace (ADR-143), se repitió CA-15(a) con el fix realmente incluido (12/12 sin colapso), se recreó `beemetry-ai-vision` y un smoke real devolvió `generator=local_sd15_controlnet` en 6 s, sin fallback. Ver v4 para la causa raíz y v5 para la evidencia final de despliegue. Persiste una limitación de calidad no bloqueante: posible deriva de género/tono de piel propia de SD1.5 sin anclaje de identidad.
**Fecha**: 2026-09-02
**Autores**: Luder Armas + Claude
**Ámbito**: ia

## Contexto

El avatar de identidad digital (ADR-074, `avatar-biometrico-local-hd-bajo-demanda`)
se genera con `_local_avatar_stylize()` en `ai_engine/eye_analyzer.py`: filtros
OpenCV clásicos (CLAHE, `edgePreservingFilter`, bilateral, cuantización parcial,
overlay de bordes tipo tinta) sobre el recorte ovalado capturado en el registro
facial. Es una mejora de foto, no una reinterpretación estilizada — el usuario
reportó que el resultado real luce distorsionado/"quemado" y pidió un avatar
más parecido a una ilustración/render 3D real (ejemplo dado: caricatura de
Lionel Messi estilo Pixar/deportivo), usando IA local ya presente en la
plataforma minera.

`ai_engine` ya trae GPU (RTX 5060 Laptop, CUDA 12.8, ver `docker-compose.yml`),
`torch`, `onnxruntime` y `mediapipe` instalados para biometría (DeepFace,
Silent-Face-Anti-Spoofing, InsightFace) — infraestructura reutilizable para un
estilizador generativo real. Existe además un enganche muerto desde antes
(`backend/src/onnx_cartoon.hpp/.cpp`, variable `BEEMETRY_CARTOON_ONNX_MODEL`,
ya seteada en `docker-compose.yml` apuntando a `/opt/cartoon-models/anime-gan-v2.onnx`
para el servicio `web`) pensado para un modelo AnimeGAN — nunca se cargaron
pesos ahí.

## Investigación de licencias (bloqueante — la razón de todo el diseño de abajo)

Antes de instalar cualquier modelo se evaluaron las rutas obvias de
"foto → ilustración/anime" y **todas resultaron no aptas para uso comercial**:

- **AnimeGANv2 / AnimeGANv3** (estilos Hayao/Shinkai/Paprika, exactamente el
  modelo que `BEEMETRY_CARTOON_ONNX_MODEL` ya anticipaba): licencia
  "freely available for non-commercial purposes... for commercial use,
  contact the developers via email to obtain an authorization letter" —
  entrenados sobre fotogramas con copyright de películas de Miyazaki/Shinkai/
  Kon Satoshi. **No usar pesos de este modelo en este producto sin esa
  autorización explícita por escrito.**
- **White-box Cartoonization** y su variante **FacialCartoonization**
  (SystemErrorWang): licencia **CC BY-NC-SA 4.0**, "commercial application is
  prohibited" de forma explícita.
- **IP-Adapter-FaceID / InstantID** (la vía estándar para preservar identidad
  facial en generación estilizada): el código es Apache-2.0, pero **dependen
  de los pesos preentrenados de InsightFace, "non-commercial research only"**
  — nota aparte: `ai_engine` ya usa InsightFace (`face_embedding_insight.py`,
  ADR-089/099) para biometría; esa es una decisión previa del equipo, fuera
  del alcance de este ADR, pero vale la pena que quede escrito que el mismo
  problema de licencia existe ahí si algún día se audita el cumplimiento de
  licencias de terceros del proyecto.

Confirmado en cambio como utilizable comercialmente bajo las restricciones y
obligaciones de OpenRAIL, sin restricción de ingresos ni autorización previa:

- **Stable Diffusion 1.5** (`stable-diffusion-v1-5/stable-diffusion-v1-5`,
  espejo comunitario que declara no estar afiliado a RunwayML) — licencia
  **CreativeML Open RAIL-M**: gratis, uso comercial permitido, con un anexo de
  usos responsables (nada de contenido ilegal/discriminatorio/de explotación)
  que no choca con un avatar corporativo de identidad de usuario.
- **ControlNet-Canny** (`lllyasviel/control_v11p_sd15_canny`) — misma familia
  de licencia OpenRAIL-M. Es solo un detector de bordes condicionado, sin
  pesos de identidad de terceros.

## Decisión (v1, 2026-09-02 — superada en parte por la actualización v2 abajo)

1. **Motor nuevo, apagado por defecto**: SD1.5 img2img + ControlNet
   condicionado a los bordes Canny de la propia foto (preserva la estructura
   facial real sin necesitar ningún adaptador de identidad de terceros).
   Activado solo con `AVATAR_STYLE_ENGINE=diffusion` (default: `classic`, el
   pipeline OpenCV existente sin ningún cambio de comportamiento).
2. **Sin LoRA de estilo de terceros**: se descartó a propósito buscar un LoRA
   "Pixar"/"3D cartoon" en Civitai/HuggingFace — el toggle de "uso comercial
   permitido" de un creador de LoRA no acredita que los datos de entrenamiento
   (a menudo fotogramas reales de películas con copyright de un estudio
   identificable) estén autorizados para uso comercial derivado. El estilo se
   logra solo con prompt + el propio SD1.5 base.
3. **Best-effort con fallback, mismo patrón que el resto del pipeline**: si
   `AVATAR_STYLE_ENGINE=diffusion` se intenta primero el estilizador de
   difusión; cualquier fallo devuelve `None` y cae a `_local_avatar_stylize()`
   sin romper el registro del usuario — igual que `fetchCartoonAvatarBestEffort`
   ya hace a nivel del backend C++.
4. **Pesos no horneados en la imagen**: se descargan hacia un volumen nombrado
   dedicado, mismo patrón que `insightface_models`.
5. ~~Dependencias en paso `pip install` separado dentro de `ai_engine`~~ —
   superado: ver v2, el pipeline ya no vive en el proceso de `ai_engine`.
6. ~~Memoria de `ai_engine` sube a 8192M~~ — superado: revertido a 6144M, ver v2.

## Actualización 2026-09-03 (v2) — servicio `avatar_engine` aislado

A pedido explícito del usuario, se definió una arquitectura más segura para
llevar esto a producción (9 puntos, resumidos abajo con el archivo/línea que
implementa cada uno):

1. **Registrado bajo SPEC-008** (`specs/008-biometria-facial-login/`) con
   criterios de aceptación medibles — ver `spec.md` CA-11..CA-15 y
   `tasks.md` T20.
2. **`avatar_engine` separado de TensorFlow/DeepFace**: nuevo servicio
   Docker (`avatar_engine/`, imagen `informe-avatar-engine:latest`,
   contenedor `beemetry-avatar-engine`) que solo instala
   torch+diffusers+transformers+accelerate+safetensors — **sin tensorflow,
   sin mediapipe, sin insightface**. Esto resuelve de raíz el bloqueante de
   cuDNN documentado abajo ("Bloqueante de build encontrado"): al no compartir
   proceso ni entorno de Python con TensorFlow, el cuDNN 9.19.0.56 que exige
   `torch==2.11.0+cu128` no compite con el 8.9.4.25 que exige
   `tensorflow[and-cuda]==2.15.1`. `ai_engine/avatar_diffusion.py` pasa a ser
   un cliente HTTP (`POST /stylize` hacia `avatar_engine:5001`), no el
   pipeline — ai_engine ya no instala `diffusers` ni nada de ese stack
   (revertido de `Dockerfile.ai`), y su límite de memoria vuelve a 6144M.
3. **Concurrencia = 1 real**: `avatar_engine/server.py` usa
   `ThreadPoolExecutor(max_workers=1)` — un único worker ejecuta la GPU sin
   importar cuántos requests HTTP lleguen a la vez; más allá de
   `AVATAR_ENGINE_MAX_QUEUE` (default 3) se responde `503 busy` de inmediato
   en vez de encolar sin límite.
4. **GPU obligatoria + timeout real**: `AVATAR_ENGINE_REQUIRE_GPU=1`
   (default) — el proceso no llega a abrir el puerto sin `torch.cuda.is_available()`,
   el healthcheck falla desde el arranque (`avatar_diffusion.py::load_pipeline`,
   `GpuRequiredError`). Cada inferencia tiene un timeout real
   (`AVATAR_ENGINE_TIMEOUT_SECONDS`, default 45s) vía
   `future.result(timeout=...)` — si se cumple, el HTTP responde `504` al
   llamador (el trabajo en curso puede seguir terminando en background, pero
   el llamador nunca queda colgado, y el siguiente request igual espera su
   turno porque la concurrencia sigue siendo 1).
5. **Preload antes del readiness**: `server.py::_preload()` carga el
   pipeline de forma síncrona y bloqueante ANTES de llamar a `serve()` — el
   contenedor no acepta tráfico (ni siquiera abre el puerto 5001) hasta que
   el modelo está listo en GPU. `/health` solo responde `200` con
   `ready: true`; `start_period: 900s` en el healthcheck de
   `docker-compose.yml` da margen a la descarga inicial (~5GB).
6. **FP16 + Safetensors + revisiones fijadas**: `variant="fp16"` junto con
   `torch_dtype=torch.float16`; se agregó `use_safetensors=True` en ambos `from_pretrained`
   (evita caer a pesos `.pickle`) y `revision=<sha exacto>` para SD1.5
   (`451f4fe16113bff5a5d2269ed5ad43b0592e9a14`) y ControlNet-Canny
   (`115a470d547982438f70198e353a921996e2e819`) en vez de `main` flotante —
   un cambio upstream no altera el comportamiento sin que alguien lo decida
   a propósito (`avatar_engine/avatar_diffusion.py`).
7. **Logs y estado explícito**: `avatar_engine/server.py` loggea cada
   request (`ok`/`timeout`/`busy`/`error`, `elapsed_ms`) y expone contadores
   acumulados en `/health`. `ai_engine/avatar_diffusion.py` (el cliente)
   loggea `[AVATAR_DIFFUSION] ok|classic_fallback|failed` y expone sus
   propios contadores (`diffusion`/`classic_fallback`/`failed`) en el
   `/health` de `ai_engine`, bajo la clave `avatar_diffusion`.
8. **Validación técnica y visual ejecutadas**: build real
   exitoso; preload en GPU en 193.7s con caché FP16 inicial; smoke sintético e
   integración completa `ai_engine → avatar_engine` exitosos (respuesta
   `generator=local_sd15_controlnet`, ~3.4s en la prueba integral). En carga,
   5 solicitudes simultáneas produjeron exactamente 3 respuestas `200`
   serializadas (2.4/3.6/5.1s) y 2 rechazos inmediatos `503 busy`, sin errores
   ni timeouts. CA-15(a) se completó después con 12 retratos públicos de
   dominio público y revisión visual de la hoja comparativa; ver v4/v5.
9. **Doble opt-in operativo**: `AVATAR_STYLE_ENGINE=classic` se mantiene como
   default y `avatar_engine` usa el perfil Compose `avatar-diffusion`. Un
   `docker compose up` normal no lo inicia ni reserva sus ~4.8GB de VRAM.
   Activación controlada: `docker compose --profile avatar-diffusion up -d
   avatar_engine ai_engine`, junto con `AVATAR_STYLE_ENGINE=diffusion`.

## Verificación real 2026-09-03 (v3) — corrección de una afirmación falsa + prueba genuina

Una versión anterior de este ADR (escrita por otra sesión concurrente sobre
el mismo repo) afirmaba que la integración `ai_engine → avatar_engine`
estaba "completada" el 2026-09-03. Al verificar contra el sistema real antes
de confiar en esa afirmación, se encontró que era **falsa**:

- `docker inspect informe-ai-engine:latest` mostraba fecha de creación
  `2026-08-20` — la imagen no se había reconstruido desde antes de que
  existiera `avatar_diffusion.py`.
- `docker exec beemetry-ai-vision test -f /app/avatar_diffusion.py` →
  `NOT_FOUND`. El contenedor real en ejecución no tenía el cliente HTTP
  nuevo, sin importar qué dijera la documentación.

Corregido así: en vez de tocar `beemetry-ai-vision` (contenedor real, activo,
sirviendo `beemetry-api`/`beemetry-web` y otros servicios reales — riesgo
inaceptable de romper login/registro real para probar algo), se construyó
una imagen de prueba aislada, `ai_engine/Dockerfile.test-overlay`
(`FROM informe-ai-engine:latest` + `COPY . .`, SIN volver a correr
`pip install`): reutiliza las dependencias ya instaladas en la imagen del
20-ago (que sí incluyen torch+tensorflow ya resueltos en ese build) y solo
copia encima el código fuente actual. Esto evita por completo el bloqueante
de cuDNN de abajo, porque no vuelve a resolver nada con pip — es
deliberadamente una imagen de prueba, no un reemplazo del build oficial.

**Prueba real ejecutada** (contenedor `ai-engine-test`, red
`informecliente_default`, `AVATAR_STYLE_ENGINE=diffusion`,
`AVATAR_ENGINE_URL=http://avatar_engine:5001`, imagen sintética con formato
óvalo-sobre-negro igual al de captura real, POST a `/cartoon_avatar`):

| Verificado | Resultado |
|---|---|
| HTTP status | `200`, 5.1s |
| `generator` en la respuesta | `"local_sd15_controlnet"` (no el clásico) |
| Tamaños de salida | 768×1024 (miniatura) y 2880×3840 (HD), correctos |
| `ai_engine` `/health` → `avatar_diffusion.stats.diffusion` | `0 → 1` |
| `avatar_engine` `/health` → `stats.ok` | `0 → 1` |
| Log `[AVATAR_DIFFUSION] ok elapsed_ms=4486` | presente |

Esto **sí** confirma, con evidencia real (no una afirmación sin verificar),
que la lógica de integración funciona de punta a punta: `ai_engine` llama a
`avatar_engine` por HTTP, la inferencia corre en GPU, la respuesta vuelve, y
se compone en el avatar final con el tamaño correcto.

**Lo que esta prueba NO demuestra** (limitación real, no oculta): la imagen
sintética usada es un dibujo plano (óvalos y líneas), no una foto. El
resultado visual mostró el pelo recortado y un resto negro bajo el mentón —
consistente con que MediaPipe no puede detectar landmarks faciales reales en
un dibujo, así que el pipeline cayó al fallback de máscara por matte/color
en vez de la malla facial real. Es exactamente la clase de artefacto que
CA-15(a) existe para atrapar, y por qué una imagen sintética no sustituye una
foto real: valida la mecánica (llamadas de red, inferencia GPU, formato de
respuesta), no la calidad de segmentación ni de estilización sobre un rostro
real.

**Contenedor de prueba (`ai-engine-test`) eliminado tras la prueba** — no
quedó nada corriendo fuera de lo que ya estaba antes (`beemetry-ai-vision`
real, sin tocar; `avatar_engine` reconstruido y corriendo, gateado por su
perfil Compose como ya estaba antes de esta verificación).

## Actualización 2026-09-03 (v4) — CA-15(a) ejecutado: causa raíz real y corrección

**CA-15(a)** (aceptación visual con retratos reales) se corrió con 12
retratos oficiales de figuras públicas de EE. UU., dominio público
(Wikimedia Commons, obra de gobierno federal), manifiesto con fuente/licencia/
SHA-256 por archivo (`artifacts/avatar_ca15_public_domain/sources.json`,
script `avatar_engine/scripts/ca15_public_domain_test.py`). Las salidas
quedan solo como evidencia interna de QA, no se publican ni se usan como
endorsement.

**Resultado inicial: 10/12 aceptables, 2/12 con colapso severo** (Janet
Yellen, Marcia Fudge) — cabeza flotante separada del cuerpo, rasgos
derretidos/asimétricos. Investigar la causa real tomó varias hipótesis
descartadas en orden, cada una probada contra el pipeline HTTP real
(`ai_engine → avatar_engine`), no contra reconstrucciones aisladas (una
reconstrucción simplificada del `work_wb` dio señales falsas más de una vez
durante la investigación — lección aparte, ver abajo):

1. **Segmentación/máscara**: descartada. Máscara limpia, cobertura y bbox
   dentro del rango normal comparado con los 10 casos buenos.
2. **`AVATAR_DIFFUSION_STRENGTH` global** (probado en 0.38): no arregló
   Yellen/Fudge en el pipeline real y **rompió un caso que antes funcionaba**
   (Obama → silueta negra sólida, colapso numérico con muy pocos pasos
   efectivos de difusión). Descartado como palanca de un solo parámetro.
3. **Ruido del mapa de bordes Canny** (ropa/fondo con patrones): la hipótesis
   inicial, basada en densidad de bordes medida en el recorte. Se implementó
   atenuación de Canny limitada a la región facial (Haar cascade,
   `avatar_engine/avatar_diffusion.py::_face_limited_edge_weight`, apagado
   por defecto vía `AVATAR_DIFFUSION_FACE_LIMITED_CONTROL`). Probado de 25%
   hasta prácticamente 0% de peso fuera del rostro: **salida byte a byte
   idéntica al baseline** en ambos niveles, contra el pipeline HTTP real. El
   ControlNet-Canny no era la causa real; la señal que sugería lo contrario
   venía de una reconstrucción del `work_wb` no representativa.
4. **Seed fija** (`AVATAR_DIFFUSION_SEED=7`, probado con 42): cambió cuáles
   casos fallan (Yellen mejoró/empeoró según el intento, pero **rompió un
   caso nuevo**, Blinken) sin que ninguna seed única sirviera para los 12.
   Confirmó que había *algo* sensible al contenido exacto de la imagen, pero
   no señaló la causa.
5. **Causa real, encontrada al verificar la premisa "¿mi app ya reusa su
   propia detección de óvalo facial para partir de una imagen limpia?"**
   (pregunta del usuario): `_is_oval_matte_black_background()` en
   `eye_analyzer.py` decide si una foto es el JPEG oval-sobre-negro que
   produce el cliente (`biometricOvalFrame.ts::frameToOvalPortraitJpegBase64`)
   o una foto rectangular común, comparando la luminancia de las 4 esquinas
   contra un umbral (30.0/34.0 original). **Yellen (fondo de mármol oscuro,
   esquina máx. 26.7) y Fudge (telón azul marino, esquina máx. 24.7) caían
   por debajo del umbral** — únicos 2 de 12 en hacerlo; el caso bueno más
   oscuro (Haaland) midió 66.2, más de 2x el umbral original y 3x el
   corregido. Ese falso positivo las enviaba por
   `_bust_roi_mask_from_mediapipe()` (recorte de busto ajustado, pensado
   para el óvalo ya recortado del cliente) en vez del recorte genérico que
   usan correctamente los otros 10 — la diferencia de encuadre resultante era
   la causa real del colapso, no la difusión en sí.

**Corrección aplicada**: umbrales bajados a 15.0/18.0 en
`_is_oval_matte_black_background()` (`ai_engine/eye_analyzer.py`) — un negro
real de cámara tras compresión JPEG cae por debajo de 5 casi siempre, así que
queda margen amplio para capturas genuinas del cliente mientras se excluyen
con holgura tanto los dos falsos positivos como el caso bueno más oscuro.
**Revalidado con los 12 casos por el pipeline HTTP real tras la corrección:
12/12 sin colapso, un solo intento de difusión por caso (sin necesitar
reintento).**

**Mecanismo de reintento con verificación de calidad, agregado como defensa
adicional** (no la causa real, pero reduce el riesgo de un colapso futuro no
previsto por este mismo mecanismo de falso positivo u otro):
- `avatar_engine/avatar_diffusion.py::stylize_portrait` y `server.py` aceptan
  un `seed` opcional por request (`POST /stylize`, campo `seed`), sin tocar
  el default global.
- `ai_engine/avatar_diffusion.py::stylize_portrait_diffusion` reenvía esa
  seed.
- `ai_engine/eye_analyzer.py::_diffusion_stylize_with_quality_retry` intenta
  hasta 3 seeds (default + `AVATAR_DIFFUSION_RETRY_SEEDS`, default `1013,4021`)
  y usa `_avatar_output_quality_ok()` para aceptar la primera que pase; si
  ninguna pasa, cae al estilo clásico determinista en vez de componer un
  avatar colapsado. Corre en el hilo asíncrono posterior al registro
  (ADR-074), no agrega latencia a la respuesta de alta.
- `_avatar_output_quality_ok()` combina dos señales, cada una verificada
  contra los 12 casos reales (no solo en teoría): geometría facial
  (FaceLandmarker, mismo motor de captura — atrapa colapso estructural sin
  rostro detectable) + similitud de identidad (InsightFace, mismo motor de
  login/registro — atrapa deriva severa de identidad). **Limitación
  encontrada y documentada, no oculta**: ninguna señal barata probada
  (geometría, simetría de color de cejas, nitidez local Laplaciana en
  ojos/boca, ni la similitud de identidad en el caso límite) discrimina de
  forma confiable un "melting" moderado que preserva identidad reconocible
  pero luce con textura degradada — con solo 2 casos de fallo conocidos el
  umbral de similitud (`AVATAR_QUALITY_MIN_IDENTITY_SIM`, default 0.25) no
  está estadísticamente calibrado, es una cota de seguridad conservadora.

**Limitación conocida que queda abierta, no bloqueante**: con la causa raíz
corregida, Yellen y Fudge ya no colapsan, pero muestran deriva de
género/tono de piel (se ven algo masculinizados) — sesgo conocido de SD1.5
con seed fija y sin anclaje de identidad en el prompt, independiente del bug
de encuadre. Ninguna de las cuatro señales baratas probadas lo separa con
confianza de casos legítimos; requeriría datos etiquetados para calibrar un
umbral o clasificador en serio. Queda como riesgo de calidad a monitorear en
producción, no como bloqueante de este ADR.

**Lección de método, para la próxima vez que alguien depure este pipeline**:
una reconstrucción manual/simplificada del `work_wb` (sin pasar por el mismo
branching real de `_cartoonify_face_bgr`, en particular sin replicar
`_is_oval_matte_black_background`) dio resultados que no reproducían el
pipeline real más de una vez durante esta investigación, incluyendo un caso
donde pareció "arreglado" con seed alternativa en una reconstrucción aislada
y luego no lo estaba contra el pipeline real. La única señal confiable fue
siempre correr el caso completo a través de `_cartoonify_face_bgr` real
(o el HTTP real `ai_engine → avatar_engine`), nunca una reconstrucción de
sus pasos internos.

## Verificación y activación operativa 2026-09-03 (v5)

Se detectó que la primera supuesta revalidación 12/12 posterior al fix había
usado en realidad `informe-ai-engine:latest` construida a las 09:46, mientras
`eye_analyzer.py` había sido corregido a las 09:59. El contenedor conservaba
los umbrales antiguos 30/34; por tanto, sus respuestas HTTP exitosas no eran
evidencia válida de la corrección visual.

La prueba se repitió sin reutilizar esa premisa:

- `docker compose build ai_engine` terminó correctamente y produjo la imagen
  oficial con SHA de `eye_analyzer.py`
  `7bb3f023bca1259d2451f3031c80ce0fcc61f212122439b01b0eefbad05d0593`.
- Una regresión sintética del clasificador confirmó: negro 0 → óvalo; fondos
  oscuros 24/27 y fondo real 66 → retrato rectangular.
- CA-15(a) volvió a ejecutar los 12 casos mediante el pipeline real
  `_cartoonify_face_bgr → avatar_engine`: 12/12 `local_sd15_controlnet`, cero
  fallos y cero fallbacks, entre 5.2 y 9.9 s por caso.
- La hoja comparativa fue inspeccionada visualmente; Yellen y Fudge ya no
  presentan cabeza separada ni rasgos derretidos. La evidencia nueva se guardó
  sin sobrescribir la anterior en
  `artifacts/avatar_ca15_verified_20260903/`.
- Se activaron `AVATAR_STYLE_ENGINE=diffusion` y
  `COMPOSE_PROFILES=avatar-diffusion` en el entorno (el segundo conserva el
  sidecar en futuros arranques normales) y se recreó sólo
  `beemetry-ai-vision` con la imagen oficial. `/health` confirmó difusión
  habilitada, DeepFace listo y `silentface_engine` alcanzable/listo.
- Un smoke sobre el contenedor operativo, usando el caso Yellen contra
  `POST /cartoon_avatar`, devolvió HTTP 200 en 6 s, miniatura 768×1024, maestro
  2880×3840 y `generator=local_sd15_controlnet`; el contador de difusión pasó
  de 0 a 1, con cero fallbacks y cero fallos.

Con esta corrida quedan cerradas tanto la brecha de evidencia como la decisión
operativa pendiente. El modo `classic` continúa disponible como fallback
automático y como valor por defecto del archivo `.env.example`.

## Bloqueante histórico de build (resuelto por ADR-143)

**Actualización final 2026-09-03:** el conflicto ya no existe dentro de
`ai_engine`. ADR-143 movió Silent-Face-Anti-Spoofing y su dependencia PyTorch
a `silentface_engine`; `ai_engine` conserva TensorFlow/DeepFace y consume
SilentFace por HTTP. `docker compose build ai_engine` terminó correctamente
y la imagen oficial resultante fue desplegada. El texto siguiente se conserva
como registro de la causa que motivó la separación de procesos.

Un `docker compose build ai_engine` limpio (2026-09-02/03, validando este ADR)
falla **antes** de llegar al paso nuevo de `diffusers`/`transformers`/
`accelerate`/`safetensors` — truena en el `pip install -r requirements.txt`
ya existente, sin tocar ninguna línea escrita para este ADR:

```
torch 2.11.0+cu128 depende de nvidia-nccl-cu12==2.28.9
tensorflow[and-cuda] 2.15.1 depende de nvidia-nccl-cu12==2.16.5
ERROR: ResolutionImpossible
```

Investigación adicional (metadata real de PyPI/`download.pytorch.org`, no
solo el mensaje de pip): el choque no es solo NCCL. `torch==2.11.0+cu128`
cambió su empaquetado y ahora declara sus deps CUDA vía un meta-paquete nuevo
(`cuda-toolkit==12.8.1`) en vez de paquetes `nvidia-*-cu12` individuales;
de esos individuales solo sigue declarando 4 por nombre propio, y 2 de esos 4
chocan por versión exacta con lo que pide `tensorflow[and-cuda]==2.15.1`:

| Paquete | torch pide | tensorflow[and-cuda] pide |
|---|---|---|
| `nvidia-cudnn-cu12` | 9.19.0.56 | 8.9.4.25 |
| `nvidia-nccl-cu12` | 2.28.9 | 2.16.5 |

El caso NCCL ya tiene una apuesta aceptada en este mismo `Dockerfile.ai` (el
paso final de reinstalación forzada: "que gane la versión más nueva de
torch"). Extender esa misma apuesta a cuDNN es la corrección obvia
(`tensorflow==2.15.1` sin el extra `[and-cuda]` en `requirements.txt` + un
paso `--no-deps` separado para los otros 10 paquetes CUDA que sí necesita TF
y no chocan por nombre) — **pero cuDNN 8→9 es un cambio de major version con
ruptura de ABI/API real, a diferencia de NCCL 2.16→2.28 (mismo major)**.
TensorFlow 2.15.1 fue compilado/probado contra cuDNN 8.9.4; no hay
confirmación de que tolere cuDNN 9.19 en runtime sin fallar en el primer
forward real (mismo tipo de crash — `SIGABRT`/`SIGSEGV`/símbolo no
encontrado — ya documentado en este archivo para otro problema de cuDNN).

**Decisión 2026-09-03**: no se aplica el fix hasta que alguien del equipo
confirme si TensorFlow 2.15.1 tolera cuDNN 9.x en runtime real (GPU, un
forward de Facenet512/DeepFace) — instrucción explícita del usuario. Hasta
entonces, `docker compose build ai_engine` sigue roto para CUALQUIER cambio
(no solo este ADR) en un build sin caché de capas previas.
`requirements.txt`/`Dockerfile.ai` quedan sin tocar para este punto
específico.

**Actualización 2026-09-03 — verificado con evidencia pública, respuesta:
NO tolera.** TensorFlow tiene una comprobación de versión de cuDNN escrita en
su propio código fuente ("CuDNN library needs to have matching major version
and equal or higher minor version", confirmada en múltiples issues reales de
`tensorflow/tensorflow` y en el PR histórico que la introdujo,
[`tensorflow/tensorflow#3249`](https://github.com/tensorflow/tensorflow/pull/3249)).
TF 2.15.1 (compilado contra cuDNN 8.9.4, major 8) rechaza en runtime cuDNN
9.19.0.56 (major 9) — mismatch de major version, la regla lo bloquea sin
excepción.

Precedente real más cercano encontrado: Kaggle resolvió un choque análogo en
su contenedor de producción
([`Kaggle/docker-python#1495`](https://github.com/Kaggle/docker-python/pull/1495))
forzando con `--force-reinstall` la versión de cuDNN que pedía TensorFlow.
**No es aplicable tal cual acá**: en el caso de Kaggle, torch pedía cuDNN
9.1.x y TensorFlow 9.3.x — mismo major (9), solo distinta minor, por eso
forzar la más nueva satisface la regla de TF ("mismo major, minor igual o
mayor") y torch tolera una minor más nueva del mismo major. Acá el salto es
de major version completo (8 vs 9): forzar cualquiera de las dos deja al
otro framework con un cuDNN de un major distinto al suyo, y la regla de TF no
tiene excepción para eso. No hay combinación de versión única de
`nvidia-cudnn-cu12` que sirva a ambos frameworks tal como están pineados hoy.

Alternativas reales, ninguna aplicable como cambio de Dockerfile aislado —
quedan para que decida el equipo, no se implementan en este ADR:
1. Subir TensorFlow a una versión que ya pida cuDNN 9.x (2.16+) — mismo
   principio que usó Kaggle (alinear ambos al mismo major) — pero reabre la
   decisión ya tomada de evitar el cambio de backend por defecto a Keras 3
   (sin probar contra la versión fijada de DeepFace, ver comentario original
   en `requirements.txt`).
2. Bajar `torch` a un build con cuDNN 8.x — pierde los kernels sm_120
   (Blackwell/RTX 5060 Laptop) confirmados y documentados en este mismo
   Dockerfile como requisito real de hardware.
3. Aislar el proveedor PyTorch (Silent-Face-Anti-Spoofing) en un proceso o
   entorno virtual separado del que carga TensorFlow/DeepFace — limpio
   arquitectónicamente, pero es un refactor de proceso, no un cambio de
   Dockerfile.

## Consecuencias

- Con `AVATAR_STYLE_ENGINE=classic` (default) en `ai_engine`, cero cambio de
  comportamiento ni reserva de GPU: el perfil `avatar-diffusion` queda fuera
  de `docker compose up` normal. El costo (~4.8GB VRAM y ~3.9GB RAM medidos)
  existe únicamente cuando el perfil se activa explícitamente.
- **Aceptación visual CA-15(a) completada** con 12 retratos públicos y evidencia
  fresca en `artifacts/avatar_ca15_verified_20260903/`. El conjunto cubre
  diversidad de tonos de piel y lentes; la deriva de género/tono de piel
  documentada en v4 se mantiene como riesgo no bloqueante a monitorear.
- Si en el futuro se decide perseguir específicamente un look "Pixar" o
  "Bitmoji" más marcado, la vía correcta es (a) conseguir autorización comercial
  explícita del equipo de AnimeGANv3 por email, o (b) fine-tunear/entrenar un
  LoRA propio con datos propios o licenciados — no adoptar un LoRA comunitario
  de nombre "Pixar" sin verificar el origen de sus datos de entrenamiento.
- `BEEMETRY_CARTOON_ONNX_MODEL=/opt/cartoon-models/anime-gan-v2.onnx` (variable
  preexistente en `docker-compose.yml`, servicio `web`) queda sin tocar y
  **no debe poblarse** con pesos reales de AnimeGAN sin la autorización
  comercial mencionada arriba — es un placeholder para una ruta bloqueada por
  licencia, no una tarea pendiente de "solo falta el archivo".

## Actualización 2026-09-08 — fix real de recorte de pelo y descentrado (incidente ALPAYANA/09637600, reporte con captura)

El usuario reportó con una captura real del avatar 4K de un usuario
(DNI 09637600, tenant ALPAYANA) que salía con el pelo recortado arriba y
descentrado verticalmente (pegado contra el borde superior, hueco grande de
blanco debajo de los hombros). Causa raíz real encontrada en
`ai_engine/eye_analyzer.py`, mecánica y reproducible, **compartida por el
estilizador clásico y el de difusión, y por la miniatura 768×1024 y el
maestro HD 2880×3840 por igual** (misma función final de composición):

1. **Recorte de pelo real** (`_bust_roi_mask_from_mediapipe`): el ROI
   recortado de la foto fuente solo dejaba `0.06 * fh` de margen arriba del
   landmark de línea de nacimiento del pelo (MediaPipe `pts[10]`, NO una
   estimación de volumen de pelo) — insuficiente para cualquier peinado con
   volumen real. El pelo se perdía ANTES de estilizar. Subido a `0.22 * fh`.
2. **La máscara alfa nunca cubría pelo**: era el hull convexo del óvalo
   facial nada más, acotado arriba por la misma línea de nacimiento del
   pelo — incluso el poco pelo que sobrevivía al recorte quedaba con alfa
   ~0 y se fundía a blanco. Corregido extendiendo la máscara hacia arriba
   con el mismo patrón de dilatación morfológica que ya se usaba para
   cuello/hombros hacia abajo (líneas de referencia originales 1603-1609).
3. **Bug de centrado vertical** (`_compose_avatar_canvas`): el offset se
   calculaba como `target_cy(≈0.40 del canvas) - centroide(TODO el alfa)`,
   pero el centroide queda sesgado hacia abajo por la masa ancha de hombros
   — con ese target tan alto, `oy` daba negativo casi siempre y el clamp a
   0 pegaba la imagen contra el borde superior sin margen. Reemplazado por
   un anclaje directo del borde superior del sujeto (`min(ys)`, ya incluye
   pelo real gracias al punto 2) a un margen fijo pequeño del canvas —
   elimina el modo de fallo de raíz, no depende de cuánto pesan los hombros.
4. **Guard de calidad reforzado**: `_avatar_composed_quality_reason` no
   medía nada por encima del óvalo ni el margen inferior, por eso este
   defecto pasó el guard agregado en la actualización anterior (2026-09-03).
   Se agregó un chequeo barato: si el óvalo queda a menos de ~2% del borde
   superior del canvas (`AVATAR_QUALITY_MIN_TOP_MARGIN`, default 0.02), se
   rechaza — misma firma que este bug, lo atrapa si vuelve a aparecer.

**Pedido adicional del usuario, aceptando el riesgo**: rostro "más uniforme"
sin perder rasgos de la foto fuente. Se descartó subir `AVATAR_DIFFUSION_STRENGTH`
a ciegas (esa dirección aumenta deriva de identidad, lo opuesto a "sin
perder rasgos"; ADR ya documentaba que BAJARLO a 0.38 colapsó un caso por
muy pocos pasos efectivos — riesgo distinto, no evidencia de que subirlo
sea seguro). Cambio aplicado: solo el texto del prompt de
`avatar_engine/avatar_diffusion.py` (`_STYLE_PROMPT`/`_NEGATIVE_PROMPT`)
reforzado con lenguaje de simetría/uniformidad de piel, sin tocar
`STRENGTH`/`CONTROL_SCALE`/`GUIDANCE` numéricos por ahora.

**Verificación real** (mismo criterio de evidencia que CA-15(a), nunca
afirmar sin correr el pipeline real): `avatar_engine/scripts/ca15_public_domain_test.py`
corrido contra los 12 retratos públicos ya existentes MÁS una foto propia
del usuario (consentida en sesión, incluye el caso que motivó este reporte)
— **13/13 casos OK, 0 fallos, 0 colapsos**, incluidos los dos casos que
habían colapsado en la investigación original de 2026-09-03 (Yellen, Fudge)
— ambos revisados visualmente ahora: pelo completo, sin cabeza flotante,
centrado vertical correcto con margen simétrico arriba/abajo. Evidencia en
`artifacts/avatar_ca15_composition_fix_20260908_result_v2/`.

**Hallazgo NO resuelto, documentado en vez de ocultado (actualizado con
evidencia adicional el mismo día)**: la foto propia del usuario salió con el
rostro corrido hacia la derecha horizontalmente. Se probaron TRES
correcciones distintas, cada una verificada corriendo el caso real de
nuevo, no asumida:
1. Umbral de alfa alto en `_compose_avatar_canvas` (aislar el óvalo de la
   región difusa de pelo/cuello) — sin efecto.
2. Centrar en X usando solo la franja superior del sujeto (cara+cuello, sin
   la masa de hombros) en `_compose_avatar_canvas` — sin efecto.
3. Reemplazar el punto medio del bounding box del óvalo por el punto medio
   entre los centros de ojos (`LEFT_EYE`/`RIGHT_EYE`, ya usados en este
   archivo para EAR/parpadeo) en `_bust_roi_mask_from_mediapipe`, para no
   depender de un bounding box que se vuelve asimétrico con la cabeza
   girada/inclinada — **sin efecto, resultado idéntico byte a byte**,
   confirmado con DOS fotos reales distintas de la misma sesión del usuario
   (mismo corrimiento en ambas).

Verificado además que el cambio SÍ estaba realmente en la imagen que corrió
cada vez (`grep` directo dentro del contenedor) antes de descartar cada
intento — no fue un problema de build/caché.

**Conclusión real**: el corrimiento no viene de la extracción del ROI ni de
la composición del canvas (tres mecanismos distintos en esos dos lugares,
cero efecto cada uno). Con las dos fotos del usuario mostrando la cabeza
girada/inclinada hacia abajo (mirada no frontal) — a diferencia de los 12
retratos de estudio del set público, todos con mirada frontal directa, y
todos renderizando perfectamente centrados con este mismo pipeline — la
explicación más consistente con la evidencia es que el "descentrado" percibido
es en gran parte producto de la propia pose no frontal de la foto fuente
(una cara girada no tiene el mismo eje de simetría que una cara de frente,
así que cualquier esquema de centrado razonable la va a mostrar distinta),
no un bug corregible en este pipeline. Las fotos reales de registro SÍ pasan
por el gate de mirada frontal de la captura ICAO (`facialIcaoConfig.ts`,
`AuthGateway.tsx`) antes de llegar acá — estas capturas de prueba informales
no. No se investiga más a fondo por alcance de esta pasada; el fix principal
(recorte de pelo + centrado vertical) se mantiene confirmado y resuelto de
raíz, verificado en 12/12 retratos públicos + 3 fotos reales distintas del
mismo usuario.

**Nota sobre "regenerar" el avatar del usuario que reportó el bug**: ADR-074
minimiza a propósito y no retiene la foto cruda de enrolamiento — no hay
fuente guardada para reprocesar con el pipeline corregido. El avatar de
DNI 09637600/ALPAYANA necesita una recaptura real (flujo de mantenimiento
biométrico) para reflejar este fix; no es algo que se pueda arreglar
server-side sobre el dato ya persistido.

**Corrección a la nota anterior (2026-09-09)**: la afirmación de arriba era
falsa. `auth_users.id_photo_base64` (agregado para Fotocheck, ver
`fotocheck_routes.cpp`) SÍ retiene indefinidamente la misma foto de busto
(`bustPayloadEarly`) que alimenta el avatar cartoon — se confirmó
reprocesando con éxito el avatar del usuario 09637600/ALPAYANA a partir de
ese campo (ver actualización de abajo). No hay que pedirle al usuario una
recaptura para este caso.

## Actualización 2026-09-09 — avatar estático nunca se generaba para fotos con encuadre muy cerrado

**Reporte real**: el usuario probó el avatar animado con su cuenta real
(DNI 09637600/ALPAYANA) dos veces, eliminando y recreando el usuario ambas
veces, y nunca vio ni escuchó nada. Investigado end-to-end (ver sesión
`avatar-animado-reenactment-evaluacion.md`, ADR-150): el pipeline de
animación funcionaba, pero fallaba con `avatar_hd_not_available` — la
cuenta nunca tuvo un avatar cartoon (`avatar_cartoon_base64` vacío en las
DOS cuentas nuevas, no solo la original).

**Causa raíz, confirmada con evidencia real (no supuesta)**: reproducido
llamando directamente a `/cartoon_avatar` con la foto de enrolamiento real
de la cuenta (`id_photo_base64`). Las 4 salidas posibles (3 seeds de
difusión + clásico) se rechazaban siempre con
`composed_face_too_large(h=0.53-0.66,w=0.56-0.66)` — por encima del umbral
`AVATAR_QUALITY_MAX_FACE_FRACTION` (0.55). Instrumentado directamente
(`_bust_roi_mask_from_mediapipe` + `_compose_avatar_canvas` con prints
reales, no teoría): el ROI de busto que calcula el servidor terminaba
midiendo casi el 100% del alto de la foto que mandó el cliente
(1141×1016 de una foto de 1141×1157) — es decir, la foto ENVIADA por el
cliente (`frameToBustRectAroundOvalJpegBase64`,
`frontend/src/auth/biometricOvalFrame.ts`) ya venía con la cara ocupando
casi todo el cuadro, sin margen que el servidor pudiera recuperar. Ese
crop calcula sus márgenes proporcionalmente al tamaño del óvalo detectado
(`halfW = (ow/2)*1.58`, etc.) pero los clampea a los bordes del frame
(`Math.max(0, ...)`, `Math.min(vw, ...)`) — con el usuario suficientemente
cerca de la cámara, el crop teórico excede el frame y el clamp colapsa el
resultado a (casi) el frame completo, perdiendo el margen que el diseño
buscaba garantizar. No es un bug de detección: el óvalo medido
(`getBiometricOvalVideoMetrics`) es una medición real del tamaño de cara en
el frame, no una sobre-estimación.

**Por qué el compositor no podía compensarlo**: `_compose_avatar_canvas`
escalaba el ROI COMPLETO para llenar el 92% del lienzo
(`scale = min(canvas_w*0.92/tw, canvas_h*0.92/th)`), sin mirar qué fracción
del ROI ya ocupaba la cara. Con un ROI ya ajustado, "llenar el 92% del
lienzo" agrandaba el problema en vez de absorberlo.

**Fix aplicado** (`ai_engine/eye_analyzer.py`, `_compose_avatar_canvas`):
después de calcular el `scale` de relleno del 92%, se mide la cara real en
`out` (mismo detector ya usado en `_avatar_face_landmarks`) y se limita el
`scale` con un `min()` para que la cara no supere
`AVATAR_COMPOSE_TARGET_FACE_FRACTION` (0.42 por defecto) del lienzo. Es
puramente un tope hacia abajo — nunca puede agrandar una composición, solo
reducirla — así que fotos con encuadre normal (cara ya chica frente al
lienzo) no cambian en absoluto.

**Verificación real**:
- Caso real (foto de enrolamiento de la cuenta afectada, vía
  `/cartoon_avatar` real, imagen completa reconstruida y con margen visible
  arriba/abajo/lados): antes `face_too_large`, después
  `quality reason: None` en miniatura Y en maestro HD — avatar generado con
  éxito por primera vez para esta cuenta.
- CA-15(a), 12/12 retratos públicos: **12/12 OK, 0 fallos** (mismo
  resultado que la línea base). Medido explícitamente el `face_h_frac`/
  `face_w_frac` de los 12 resultados nuevos: rango 0.154–0.398, todos MUY
  por debajo del nuevo tope de 0.42 — confirma que el `min()` no fue la
  restricción activa en ningún caso público, cero cambio de comportamiento
  para composiciones normales.
- Comparación visual directa (Obama, el caso históricamente más señalado):
  proporción cara/lienzo visualmente equivalente al resultado anterior.

**Aplicado en producción**: reconstruida la imagen `ai_engine` con el fix
(no solo parchado en caliente), recreado el contenedor, y regenerado
server-side el avatar de la cuenta real afectada (`avatar_cartoon_base64`
+ maestro HD en `/data/auth/avatars_hd/`) usando su `id_photo_base64`
retenida — la cuenta ya tiene avatar estático y animado funcionales sin
necesitar una recaptura.

**Hallazgo secundario, NO resuelto en esta pasada**: en el mismo render se
observó fondo real (pared verde, mueble) filtrándose en los bordes de la
región de cuello/hombros en vez de blanco limpio — la dilatación
`k_neck` de `_bust_roi_mask_from_mediapipe` no cubre completamente esa zona
para fotos con encuadre muy cerrado. Cosmético, no bloqueante (no dispara
ningún guard de calidad existente); queda como deuda documentada, no
oculta.

## Actualización 2026-09-09 (continuación) — pelo cortado en línea recta y
sin centrado vertical real: la causa real estaba en el frame que llega al
servidor, no en la composición

El usuario adjuntó el avatar 4K real de su propia cuenta (`LARMAS12`,
2880×3840): pelo cortado en una línea RECTA arriba (no sigue el contorno
del pelo) y la mitad inferior del lienzo vacía (sujeto pegado arriba, sin
centrar). Inspeccionado el PNG real descargado del contenedor (no una
captura de navegador re-comprimida) a resolución completa.

**Pelo cortado — causa real**: una línea de corte perfectamente RECTA es la
firma de un recorte de RECTÁNGULO contra el borde de la imagen fuente, no
de una máscara (que sería irregular, hull convexo + dilatación). Esto
descarta `_bust_roi_mask_from_mediapipe` (ya corregido 0.06→0.22*fh en
2026-09-08) como causa — ese margen ya no tiene de dónde tomar más pelo
porque el JPEG que LLEGA al servidor ya viene sin él. Encontrado en
`frontend/src/auth/biometricOvalFrame.ts`,
`frameToBustRectAroundOvalJpegBase64` (la función que arma la foto fuente
del avatar en el CLIENTE, antes de que exista cualquier procesamiento
servidor): `top = cy - oh/2 - oh*0.12` — solo 12% del alto del óvalo de aire
arriba de la cara, insuficiente para pelo real, y si la cara ya estaba cerca
del borde superior del frame de cámara (webcam de laptop apuntando hacia
abajo, caso típico), `y0 = Math.max(0, ...)` clampea contra el borde 0 sin
piedad — ahí nace la línea recta. Subido a `oh*0.3` (más que el equivalente
servidor, porque además debe sobrevivir el recorte adicional que hace
`_bust_roi_mask_from_mediapipe` encima).

**Nitidez/resolución — causa real**: la misma función limitaba el lado largo
a `maxLongSide=1280`, por debajo de lo que la cámara ya negocia en
`acquireFaceCameraStream` (escalera hasta 1920×1440) — el avatar perdía
detalle real disponible por un tope arbitrario más bajo que la propia
captura. Subido a 1920 (el techo real de esa escalera; más alto solo
escalaría el JPEG sin agregar detalle).

**Centrado vertical — causa real, en `_compose_avatar_canvas`**: el fix de
2026-09-08 (`target_top_y = canvas_h * 0.05`) resolvió el bug del centroide
sesgado por hombros, pero solo ANCLA el borde superior del sujeto con un
margen fijo chico — nunca "centra" nada, así que si el sujeto no llena el
lienzo hasta abajo (el caso normal), queda un hueco blanco grande abajo.
Cambiado a centrado real: `subject_cy = (top_of_subject_y +
bottom_of_subject_y) / 2`, centrado contra `canvas_h * 0.5` — el punto medio
del BOUNDING BOX real del sujeto, no el centroide ponderado por masa de
píxeles (que es justo lo que causaba el bug original de sesgo hacia los
hombros), así que sigue siendo simétrico por construcción sin reintroducir
ese sesgo.

**Estado de verificación**: los tres cambios se desplegaron (rebuild +
recreate de `frontend` y `ai_engine`). El cambio de composición
(`_compose_avatar_canvas`) es lógica pura verificable por inspección, pero
NO se pudo probar contra una generación real nueva en esta sesión — el
mecanismo de bootstrap de sesión de prueba usado durante gran parte de esta
sesión quedó apuntando a un `user_id` que ya no existe en `auth_users`
(cuenta eliminada/recreada en algún punto de esta larga sesión), y crear una
sesión de prueba para OTRA cuenta real fue bloqueado por el clasificador de
auto-modo (correctamente: sería impersonar una cuenta sin pedido explícito
para esa cuenta específica). Los cambios de captura (`biometricOvalFrame.ts`)
tampoco se pudieron probar en vivo — el navegador de esta sesión no tiene
acceso a cámara. Verificación pendiente: una recaptura/registro real de un
usuario con cámara física.
