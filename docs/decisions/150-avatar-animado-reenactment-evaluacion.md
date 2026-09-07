# ADR-150 — Avatar animado por reenactment/lip-sync (evaluación), servicio `avatar_animation_engine`

**Status**: en evaluación — Fase A (SadTalker) implementada y **verificada end-to-end
contra el pipeline real** (2026-09-04, ver Verificación); Fases B/C (LivePortrait,
LatentSync) documentadas pero no implementadas.
**Fecha**: 2026-09-04
**Autores**: Luder Armas + Claude
**Ámbito**: ia
**Relación**: complementa ADR-074 (avatar biométrico estático) y ADR-141 (avatar
estilizado por difusión SD1.5+ControlNet, `avatar_engine`); no los reemplaza.

## Contexto

Se recibió un diagnóstico externo (pegado por el usuario) que atribuía la
pérdida de identidad del avatar estilizado actual (ADR-141: "deriva de
género/tono de piel propia de SD1.5 sin anclaje de identidad", limitación
conocida no bloqueante) a una limitación de arquitectura, y proponía
LivePortrait, Linly-Talker y LatentSync/SadTalker como alternativas "más
fieles a la identidad".

**Hallazgo de esta sesión — desajuste técnico con el diagnóstico recibido**:
los tres modelos propuestos son de **reenactment/lip-sync**: reciben una
imagen fuente **más una señal conductora** (video de otra persona moviéndose,
o audio) y animan la cara fuente para que siga esa señal. Sin señal
conductora no estilizan nada — devuelven esencialmente la misma cara, no una
ilustración/render 3D tipo Pixar. Eso es lo opuesto al objetivo real que
motivó ADR-141 ("avatar más parecido a una ilustración... estilo Pixar/
deportivo"): ahí el problema no es falta de movimiento, es que SD1.5
reinterpreta demasiado la identidad al estilizar.

Confirmado con el usuario (sesión 2026-09-04): el objetivo real no es
reemplazar el avatar estático de ADR-074/141, sino evaluar una **función
nueva y separada**: un avatar animado (video/audio-driven) que preserva la
identidad real, como capacidad adicional. Esta pasada cubre únicamente la
evaluación técnica del servicio aislado y su primer backend funcional; el
wiring a `ai_engine`/backend/frontend queda fuera de alcance hasta decidir,
con evidencia visual real, si algún backend vale la pena activar en producto
(mismo patrón evaluación→activación de ADR-141 v3/v4 → v5).

## Investigación de licencias (bloqueante, mismo patrón que ADR-141)

| Modelo | Licencia del código | Bloqueante real encontrado |
|---|---|---|
| **SadTalker** (`OpenTalker/SadTalker`) | Apache 2.0 (actualizado; la restricción NC histórica fue removida) | Ninguno. Dependencias faciales verificadas en su `requirements.txt` real: `face_alignment` (BSD-3, Adrian Bulat), `facexlib` (BSD-3, xinntao), `gfpgan` (Apache 2.0, TencentARC), `Real-ESRGAN`/background enhancer opcional (BSD-3, xinntao). **Sin InsightFace.** |
| **LivePortrait** (`KwaiVGI/LivePortrait`) | MIT | Depende de pesos **InsightFace `buffalo_l`** y **X-Pose**, ambos con licencia "non-commercial research purposes only" explícita en el propio repo. Mismo bloqueante que ya descartó InstantID/IP-Adapter-FaceID en ADR-141. |
| **LatentSync** (`bytedance/LatentSync`) | Apache 2.0 | `requirements.txt` real trae `insightface==0.7.3` para el recorte/alineación facial de preprocesamiento — mismo bloqueante de pesos no comerciales, a pesar de que el código propio del repo es Apache 2.0. |
| **Linly-Talker** (`Kedreamix/Linly-Talker`) | MIT (orquestador) | Descartado como base directa: no es un modelo, es un framework completo ASR (Whisper) + LLM + TTS + generación de avatar que monta SadTalker/MuseTalk/Wav2Lip como backends intercambiables — traerlo entero para solo animar un avatar es sobre-ingeniería. Si se quisiera MuseTalk como backend adicional más adelante, MuseTalk en sí es MIT y no depende de InsightFace. |

**Decisión de licencias**: se implementa primero **SadTalker**, único de los
tres sin bloqueante. **LivePortrait y LatentSync** requieren sustituir su
detector facial de preprocesamiento (InsightFace `buffalo_l`/X-Pose) por uno
de licencia permisiva — candidato: `mediapipe.tasks.vision.FaceLandmarker`,
ya usado en `ai_engine/eye_analyzer.py`. Ese parche sobre código de terceros
es un trabajo iterativo (varias rondas de prueba contra fotos reales, mismo
tipo de investigación que tomó ADR-141 v4 con varias hipótesis descartadas
antes de encontrar la causa real) — **no se implementa en esta pasada**, se
deja como Fase B/C explícitamente abierta.

## Restricción de infraestructura — VRAM compartida

GPU única, RTX 5060 Laptop, **8151 MiB VRAM totales** (confirmado en
`docs/INFORME_CONSUMO_RECURSOS_SERVIDOR_PRUEBAS_2026-09-01.md`). Ya reservan
GPU en el mismo host: `avatar_engine` (~4.7-4.8GB, sin profile-gate desde
2026-09-03, corre siempre), `ai_engine`/`silentface_engine` (GPU opcional,
footprint chico) y `ollama` (2.3-7.8GB según modelo cargado — ya documentado
en `docker-compose.yml` que `gemma2:2b` y `qwen2.5:7b` no caben los dos a la
vez junto con `ai_engine`). Docker no particiona VRAM por contenedor
(`count: all` da acceso compartido, no una cuota) — la única defensa real es
no correr todo a la vez.

**Decisión**: `avatar_animation_engine` queda con `profiles: ["avatar-animation"]`
(gateado, mismo patrón que tenía `avatar_engine` antes del 2026-09-03) y se
documenta como **mutuamente excluyente en uso real con `avatar_engine`** —
no hay forma de forzar esa exclusión a nivel Docker, así que queda como
disciplina operativa documentada, igual criterio que el comentario ya
existente sobre `ollama` en `docker-compose.yml`.

## Decisión de arquitectura

1. **Servicio nuevo aislado** `avatar_animation_engine/` (puerto **5003** —
   5001 ya es `avatar_engine`, 5002 ya es `silentface_engine`), mismo patrón
   que `avatar_engine/server.py`: Flask + waitress, `ThreadPoolExecutor(max_workers=1)`
   para serializar GPU, cola con tope (`AVATAR_ANIMATION_MAX_QUEUE`, default 3)
   y `503 busy` inmediato al superarla, timeout real por request
   (`AVATAR_ANIMATION_TIMEOUT_SECONDS`, default 180s — un video tarda
   sensiblemente más que una imagen) con `504`, preload síncrono bloqueante
   antes de `serve()` (el puerto no abre sin backend listo), `/health` con
   stats y backend activo.
2. **Un backend por proceso**: env var `AVATAR_ANIMATION_ENGINE` =
   `sadtalker` (implementado) | `liveportrait` | `latentsync` (ambos
   levantan `NotImplementedError` explícito referenciando este ADR hasta
   completar Fase B/C). No se cargan los tres backends a la vez en el mismo
   proceso ni en la misma GPU.
3. **SadTalker vendorizado por commit pineado, no reescrito a mano**: se
   clona `https://github.com/OpenTalker/SadTalker.git` en la imagen y se fija
   `git checkout cd4c0465ae0b54a6f85af57f5c65fec9fe23e7f8` (último commit real
   del repo, 2023-10-10 — el proyecto está congelado desde entonces). El
   adaptador (`backends/sadtalker_backend.py`) invoca su `inference.py` real
   vía subproceso con los flags documentados en su propio `argparse`
   (`--source_image`, `--driven_audio`, `--result_dir`, `--checkpoint_dir`,
   `--preprocess full`, `--still`, `--enhancer gfpgan`, `--size`), en vez de
   reimplementar su pipeline interno (3DMM/audio2exp/audio2pose/face-render) —
   más confiable y verificable que una reescritura, mismo criterio de "no
   reconstrucciones aisladas" que dejó ADR-141 v4 como lección.
4. **Checkpoints, no horneados en la imagen**: el modelo de difusión/mapping
   (`SadTalker_V0.0.2_256.safetensors`/`_512.safetensors`,
   `mapping_00109/00229-model.pth.tar`) se descargan desde GitHub Releases de
   `OpenTalker/SadTalker` (URLs reales confirmadas en
   `scripts/download_models.sh` del propio repo). El árbol `BFM_Fitting/`
   (3DMM, requerido por `--bfm_folder`, confirmado en el propio `inference.py`)
   no tiene URL de GitHub Releases — se obtiene por `snapshot_download` desde
   el espacio oficial en Hugging Face `vinthony/SadTalker` (mismo autor,
   mirror histórico de `checkpoints/` completo, revisión pineada
   `5194f86e46b8d20f11c9c3610b808c325032e1c5`), igual patrón que
   `avatar_engine` usa HF Hub para SD1.5/ControlNet. Los pesos de
   `--enhancer gfpgan` (`GFPGANv1.4.pth`, `detection_Resnet50_Final.pth`,
   `parsing_parsenet.pth`, `alignment_WFLW_4HG.pth`) se descargan de GitHub
   Releases de `xinntao/facexlib` y `TencentARC/GFPGAN`. Todo va a un volumen
   nombrado (`avatar_animation_cache`), no a la imagen — mismo patrón que
   `diffusion_avatar_cache`.
5. **Riesgo de versión de torch, documentado, no resuelto por adivinanza**:
   el `requirements.txt`/README oficial de SadTalker (2023) sugiere
   `torch==1.12.1+cu113`. Este repo ya estableció (ADR-141/143) que la RTX
   5060 Laptop (Blackwell, sm_120) solo funciona de forma confiable con
   `torch==2.11.0+cu128` — no se negocía ese pin por servicio. Se instala
   SadTalker sobre ese torch ya pineado, dejando que `pip` resuelva
   `kornia`/`face_alignment`/`facexlib`/`basicsr` a versiones compatibles en
   vez de fijar los pines exactos (viejos) del `requirements.txt` de 2023.
   Riesgo real: código de 2023 puede usar APIs de `torch`/`kornia` que
   cambiaron — se valida con un build y una llamada real, no se asume.
6. **Recorte por defecto `--preprocess full --still`**: mantiene el
   encuadre de busto completo en vez de recorte ajustado solo a la cara,
   más coherente con el uso de avatar en cabecera (ADR-074) que el recorte
   "talking head" por defecto de la demo de SadTalker.

## Fuera de alcance de esta pasada

- Integración con `ai_engine` (cliente HTTP), rutas backend C++ o UI de
  frontend para mostrar el avatar animado — pendiente de revisar calidad
  real del backend SadTalker primero.
- Generalizar el dispatch binario de `AVATAR_STYLE_ENGINE`
  (`ai_engine/avatar_diffusion.py::is_enabled()`) a más de dos valores — no
  aplica todavía porque este servicio nuevo no se llama desde `ai_engine` en
  esta pasada.
- Fases B (LivePortrait) y C (LatentSync): infraestructura del servicio ya
  soporta seleccionarlos por env var, pero el backend real (vendorizado +
  parche InsightFace→MediaPipe) no está escrito. Levantan
  `NotImplementedError` con referencia a este ADR.

## Verificación

Corrida real 2026-09-04 (sesión de continuación), estándar de evidencia de
ADR-141: nunca afirmar sin correr el pipeline real.

| Paso | Resultado |
|---|---|
| `docker compose --profile avatar-animation build avatar_animation_engine` | OK |
| Arranque con perfil `avatar-animation` | OK, healthy en ~20s (checkpoints ya en volumen) |
| Preload síncrono | `backend ready engine=sadtalker device=cuda elapsed_s=10.9` |
| `GET /health` | `{"device":"cuda","engine":"sadtalker","ready":true,"stats":{"ok":1,"error":0,...}}` |
| `POST /animate` (foto + wav de prueba) | **HTTP 200**, 61.4s, 239132 bytes |
| Video de salida | h264 896x1200, 50 frames, 2.0s, audio aac — `artifacts/avatar_animation_smoke_20260904/result_sadtalker.mp4` |
| VRAM (`nvidia-smi`, total 8151 MiB) | 3125 MiB antes → 4481 MiB con el servicio cargado, **corriendo simultáneamente con `avatar_engine`** |

**Hallazgo sobre la exclusión mutua documentada arriba**: en esta corrida
`avatar_animation_engine` (SadTalker, `--size 256 --enhancer gfpgan`) convivió
sin OOM con `avatar_engine` ya cargado — footprint incremental ~1.4 GB
residentes, muy por debajo de lo temido al escribir la sección de VRAM. La
disciplina operativa de apagar uno u otro **sigue siendo la recomendación por
defecto** (no se midió el pico durante inferencia, sólo el residente, y
`--size 512` no se probó), pero el gate por perfil no es un bloqueo duro para
evaluar.

### Bugs reales encontrados y corregidos en esta corrida

Ambos son incompatibilidades de código de 2023 con el stack moderno pineado
(NumPy 1.26 / torch 2.11+cu128), no errores del adaptador propio:

1. **Alias `np.float` eliminados (NumPy 1.24+)** — fallaba en
   `src/face3d/util/my_awing_arch.py:18` durante `landmark Det`. El parche
   `sed` del Dockerfile ya existía y su regex era correcta (respeta
   `np.float32`/`np.bool_`), pero **la imagen en uso nunca se había
   reconstruido con esa capa**: quedaban 16 ocurrencias sin parchear dentro
   del contenedor. Se resolvió reconstruyendo.
2. **Array ragged en `align_img`** — `POS()` devuelve `t` con shape (2,1), así
   que `t[0]` es un array de un elemento y
   `np.array([w0, h0, s, t[0], t[1]])` construía un array inhomogéneo, que
   NumPy toleraba con `VisibleDeprecationWarning` hasta 1.23 y rechaza desde
   1.24. Parche nuevo en el Dockerfile tomando el escalar explícito
   (`t[0][0], t[1][0]`); `s` ya es escalar y no se toca.

**Lección de proceso incorporada al Dockerfile**: el parche (2) lleva un
`grep -q` de verificación encadenado, para que una sustitución que deje de
aplicar (por un cambio en upstream, o por reutilizar una imagen vieja) **falle
el build** en vez de producir una imagen que revienta recién en la primera
inferencia real — exactamente el modo de fallo que costó dos vueltas en esta
sesión.

### Segunda corrida (2026-09-07) — arnés real con audio de habla

Corrida del propio `scripts/evaluate_public_domain.py` (no una reconstrucción
aislada) contra el servicio real, cerrando el pendiente más importante de la
corrida anterior: la primera prueba (2026-09-04) usó un tono sintético como
audio, válido para probar el pipeline pero no para juzgar lip-sync.

**Assets de esta corrida**:
- Imagen: `01_barack_obama.jpg`, ya verificado como dominio público en
  `artifacts/avatar_ca15_public_domain` (mismo manifiesto de ADR-141/CA-15a,
  obra de gobierno federal EE. UU.).
- Audio: habla real generada con TTS **local y offline** (`pyttsx3` sobre
  SAPI de Windows, sin red ni dependencia de audio de terceros con licencia
  ambigua) — se evita así el mismo tipo de problema de licencias que ya
  bloqueó LivePortrait/LatentSync en la tabla de arriba, aplicado esta vez al
  driving audio en vez de a los pesos del modelo.

**Resultado**: `POST /animate` vía el arnés real, `1/1 casos OK`,
`elapsed_ms=146915` (audio de ~10s, más lento que el smoke de 2s de la
primera corrida, escala con la duración del audio). Video de salida h264
896×1200, **196 frames, 7.84s**, audio aac. `report.json` con SHA-256 de
imagen/audio y fuente/licencia de cada asset, mismo estándar de evidencia que
`avatar_engine/scripts/ca15_public_domain_test.py`.

VRAM con el servicio cargado tras esta corrida: 4459 MiB de 8151 MiB
(`avatar_engine` seguía activo en simultáneo) — consistente con la medición
de la corrida anterior (4481 MiB), confirma que el footprint no crece con la
duración del audio de forma significativa en este tamaño de muestra.

**Nota de reproducibilidad de infraestructura (no de este ADR)**: entre la
primera y la segunda corrida, Docker Desktop entró en un crash-loop por
sockets AF_UNIX stale (`sailor-ingest.sock`, `docker-secrets-engine/engine.sock`)
que no se pudieron borrar individualmente (`El sistema no tiene acceso al
archivo`) — se resolvió renombrando los directorios contenedores completos en
vez de los archivos, liberando el WSL con `wsl --shutdown` antes. No es un
problema de `avatar_animation_engine`; se documenta acá porque interrumpió la
continuidad de esta evaluación y puede repetirse.

### Pendiente de verificación

- Calidad visual/identidad con **fotos de usuarios reales** del producto (las
  dos corridas hasta ahora usaron retratos públicos de terceros, válidos para
  probar el pipeline y el lip-sync, no necesariamente representativos de la
  variedad real de rostros/anteojos/iluminación de los usuarios finales).
- `--size 512` y su costo de VRAM (ambas corridas usaron el default 256).
- Medir VRAM en el *pico* durante la inferencia, no solo el residente
  post-carga (ninguna corrida hasta ahora perfiló el pico).

## Alternativas descartadas

- **Reescribir el pipeline de SadTalker a mano dentro de este repo**: mayor
  superficie de bugs sin ganar nada; se prefiere vendorizar+pinear y llamar
  su CLI real.
- **Bajar `torch` a la versión que pide el README de SadTalker (1.12.1+cu113)**:
  pierde soporte Blackwell/sm_120 ya confirmado como requisito de hardware en
  ADR-141/143.
- **Empezar por LivePortrait** (el que el diagnóstico externo marcaba como
  mejor): descartado como primer paso por el bloqueante de licencia
  InsightFace/X-Pose sin parche todavía validado.
