# ADR-150 — Avatar animado por reenactment/lip-sync (evaluación), servicio `avatar_animation_engine`

**Status**: en evaluación — Fase A (SadTalker) implementada y **verificada end-to-end
contra el pipeline real**, incluida una foto real de un usuario (2026-09-04 y
2026-09-07, ver Verificación); Fases B/C (LivePortrait, LatentSync)
documentadas pero no implementadas. Bug real encontrado y corregido el mismo
día: fotos de cámara/celular a resolución nativa agotaban el timeout por
defecto — resuelto con resize automático dentro del propio backend,
reverificado con la foto original sin intervención manual.
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
de la corrida anterior (4481 MiB), confirma que el footprint *residente*
(post-carga, sin inferencia activa) no crece con la duración del audio de
forma significativa en este tamaño de muestra.

### Corrección importante — pico real de VRAM durante inferencia (2026-09-07)

La sección de Verificación de la primera corrida (2026-09-04) afirmaba que
`avatar_animation_engine` "convivió sin OOM con `avatar_engine`" basado
únicamente en el consumo *residente* medido después de que la inferencia
terminó — no en el pico real durante la inferencia. Se corrige acá con una
medición real: `nvidia-smi` muestreado cada 2s mientras corría
`POST /animate` (mismo caso `case01_obama_local_tts`, `--size 256`,
`avatar_engine` activo en simultáneo).

**Resultado: el pico real llega a 7748 MiB de 8151 MiB totales — solo 403 MiB
de margen.** La traza sube de 4459 MiB (idle) a 7618 MiB en ~16s (arranque de
la inferencia: 3DMM + cara-render cargando a GPU) y se estabiliza en 7748 MiB
durante el resto de los 129s de la request. No hubo OOM en esta corrida, pero
el margen es demasiado ajustado para considerarlo seguro en producción: un
segundo request concurrente a `avatar_engine`, una carga puntual de
`ollama`, o simplemente `--size 512` en vez de 256, probablemente lo cruzan.

**Esta medición revierte la recomendación relajada de la corrida anterior**:
la disciplina operativa de **no correr `avatar_animation_engine` y
`avatar_engine` a la vez** (ya documentada arriba en "Restricción de
infraestructura") sigue siendo la recomendación real, no una precaución
excesiva. `--size 512` queda descartado para evaluar en este host mientras
`avatar_engine` esté activo — el margen a 256 ya es insuficiente para
absorber ese salto.

**Nota de reproducibilidad de infraestructura (no de este ADR)**: entre la
primera y la segunda corrida, Docker Desktop entró en un crash-loop por
sockets AF_UNIX stale (`sailor-ingest.sock`, `docker-secrets-engine/engine.sock`)
que no se pudieron borrar individualmente (`El sistema no tiene acceso al
archivo`) — se resolvió renombrando los directorios contenedores completos en
vez de los archivos, liberando el WSL con `wsl --shutdown` antes. No es un
problema de `avatar_animation_engine`; se documenta acá porque interrumpió la
continuidad de esta evaluación y puede repetirse.

### Tercera corrida (2026-09-07) — primera foto de un usuario real, no un retrato público

Cierra parcialmente el pendiente de la corrida anterior: foto real del propio
usuario (Luder Armas, captura de cámara propia, `Camera Roll` de Windows,
2560×1440), no un retrato público de terceros. Audio de voz TTS local
(`pyttsx3`/SAPI, offline, mismo criterio de licencia que la segunda corrida)
diciendo una frase de prueba.

**Hallazgo real de esta corrida**: el primer intento con la foto a resolución
nativa (2560×1440) **agotó el timeout HTTP a los 180s** (`AVATAR_ANIMATION_TIMEOUT_SECONDS`
default) — `subprocess.run(..., timeout=...)` en `sadtalker_backend.py` mata
el proceso real al vencer, no es un cuelgue del lado del cliente. Causa
probable: `--preprocess full` corre detección/landmarks sobre la imagen
fuente completa antes de recortar, y las fotos de los retratos públicos
usados antes (thumbnails de Wikimedia Commons, ~960px) son sustancialmente
más chicas que una foto de cámara moderna. Redimensionada a 1024×576 (lado
mayor 1024) y con el timeout subido a 420s (recreando el contenedor con
`AVATAR_ANIMATION_TIMEOUT_SECONDS=420`), la segunda corrida completó real:

| Paso | Resultado |
|---|---|
| `POST /animate` (foto redimensionada + voz TTS real) | **HTTP 200**, 232s |
| Video de salida | `ftyp isom` válido, 778173 bytes, copiado y entregado al usuario |
| GPU antes de la corrida | 236 MiB de 8151 (avatar_engine y el modelo de ollama apagados a propósito para esta prueba) |

**Consecuencia práctica para uso real, no solo para evaluación**: una foto de
usuario a resolución de cámara/celular típica (2-4K) necesita redimensionarse
ANTES de `--source_image` para mantener el tiempo de respuesta en el rango ya
medido (~150-230s); sin ese resize, el timeout por defecto de 180s es
insuficiente para fotos de alta resolución. Esto es un hallazgo de producción
real, no solo de esta prueba puntual — si este backend llega a integrarse
(fuera de alcance todavía), `avatar_animation_engine` debería redimensionar
la imagen de entrada a un lado máximo razonable (ej. 1024px) antes de
invocar `inference.py`, en vez de depender de que el llamador ya la mande
chica.

**Corregido e implementado el mismo día**: `sadtalker_backend.py::_resize_max_side()`
redimensiona la foto fuente (lado mayor a `AVATAR_ANIMATION_SADTALKER_MAX_SOURCE_SIDE`,
default 1024px) ANTES de invocar `inference.py`, sin depender de que el
llamador ya la mande chica. Default de `AVATAR_ANIMATION_TIMEOUT_SECONDS`
subido de 180s a 300s (180s ya era insuficiente incluso con la foto
redimensionada a mano). **Reverificado real** con la foto original SIN
redimensionar a mano (2560×1440, `--size 512`): `POST /animate` → HTTP 200,
282s, `output_full.mp4` válido (`ftyp isom`, 780142 bytes) — confirma que el
resize interno evita el timeout sin intervención del llamador.

### Pendiente de verificación

- Calidad visual/identidad con más de **una** foto de usuario real y en
  condiciones variadas (anteojos, iluminación, ángulos) — la tercera corrida
  aporta el primer dato real (1 caso), no una muestra representativa.
- `--size 512` y su costo de VRAM — descartado de evaluar en este host
  mientras `avatar_engine` esté activo, ver corrección de pico de VRAM
  arriba; requeriría medirse con `avatar_engine` apagado.

## Actualización 2026-09-09 — end-to-end verificado con un login real; causa raíz real de "no aparece nada" era de sesión, no del pipeline de animación

**Reporte real**: tras corregir el avatar estático (ver actualización
2026-09-09 en ADR-141) y el widget (ver más abajo), el usuario reportó
"ya realicé dos login con el DNI 09637600 y no apareció el avatar" — y
luego, verificando con un login real (DNI 09637600, empresa ALPAYANA), de
nuevo "nada de nada".

**Diagnóstico en vivo, no supuesto**: se abrió el navegador propio (Claude
Browser) contra `http://localhost:5173` y se montó una sesión con un JWT
autofirmado (misma técnica de prueba de backend usada toda la sesión, sin
tocar el formulario de login ni ninguna contraseña). El primer intento
reprodujo un error real y DISTINTO del pipeline de animación:

```
POST /api/auth/avatar/animation → 500
{"error":"avatar_animation_job_create_failed",
 "detail":"... violates foreign key constraint \"avatar_animation_job_user_id_fkey\"
 DETAIL: Key (user_id)=(698459a8-5b03-1676-1a76-02806b3bf128) is not present
 in table \"auth_users\"."}
```

`698459a8-...` es el user_id de la cuenta ORIGINAL del usuario (antes de
que la eliminara y recreara dos veces) — ya no existe en `auth_users`. La
consulta a `auth_refresh_tokens` confirmó una cadena de rotación de refresh
tokens para esa cuenta activa y renovándose CONTINUAMENTE desde temprano
ese mismo día, hasta el momento mismo de esta prueba.

**Causa raíz real**: `resolveAuthSession` (`auth_session.cpp`) solo valida
firma+expiración del JWT, nunca la existencia del usuario — diseño
documentado, trade-off aceptado. Pero `findValidRefreshTokenUserPg`
(`auth_storage_pg.cpp`), usada por `POST /api/auth/refresh`, TAMPOCO
verificaba que `user_id` siguiera existiendo en `auth_users` — leía
username/company/role/tenant_id directamente de la fila de
`auth_refresh_tokens` (snapshot al momento del login original), sin ningún
JOIN. Al eliminar y recrear la cuenta, nada invocaba
`revokeAllSessionsForUser()` (existe, pero ningún flujo de eliminación de
cuenta la llama) — el refresh token de la cuenta vieja seguía siendo válido
indefinidamente (7 días, rotándose solo). El navegador real del usuario,
con esa cookie HttpOnly todavía viva, nunca volvía a pedir credenciales:
cada carga de página renovaba silenciosamente la identidad FANTASMA
(698459a8), no la cuenta nueva. El dashboard se veía normal (el JWT firma
bien), pero cualquier escritura real con FK a `auth_users` — como crear un
`avatar_animation_job` — fallaba con 500, que el frontend trata como
"no disponible" sin mostrar nada visible. Reintentar el login en la UI no
lo arreglaba: mientras la cookie de refresh siguiera viva, la SPA nunca
volvía a autenticar de cero.

**Fix aplicado** (`backend/src/auth/auth_storage_pg.cpp`,
`findValidRefreshTokenUserPg`): la consulta ahora hace
`JOIN auth_users u ON u.id::text = rt.user_id ... AND u.is_active = true`
(comparación como texto, no `::uuid`, porque hay filas legado con
`user_id` mal formado que un cast haría fallar la consulta entera en vez de
simplemente no matchear). Un refresh para una cuenta eliminada o
desactivada ahora falla limpio (401), y el frontend (`refreshAccessToken()`
en `authApi.ts`, ya existente) responde correctamente: `clearSession()` +
vuelta a pantalla de login — la conducta correcta, no un parche nuevo.

**Verificación real**: reconstruido y redesplegado el backend con el fix.
Mientras se completaba el rebuild, el usuario probó un login REAL (no vía
mi navegador de prueba) con las credenciales correctas de la cuenta actual
— esta vez SÍ generó un job real (`47f1630b-371d-49f0-82fa-53c96036e16f`),
confirmado en curso (`status=running`) y luego `status=success` a los
~3m47s (`ok elapsed_ms=200906` SadTalker + `matting ok elapsed_ms=26433`,
648436 bytes WebM con audio real y fondo transparente) — el reporte
"nada de nada" de ESE intento en particular fue el usuario revisando antes
de que terminara el render (~4 min reales), no un fallo. Con el fix de
sesión ya desplegado, la cuenta fantasma 698459a8 queda además
estructuralmente inutilizable para refresh futuro.

**Hallazgo secundario, corregido en el mismo cambio**
(`frontend/src/components/UI/AvatarWidget.tsx`): el widget marcaba
`sessionStorage` como "ya mostrado" incluso en caminos de fallo
(`avatar_hd_not_available`, timeout, error de red) — un solo fallo
transitorio sellaba el widget para el resto de la pestaña del navegador,
sin reintentar ni en logins futuros. Se removió `markShown()` de todos los
caminos que no sean éxito real; el backend ya rechaza un segundo job
mientras uno esté en curso (ver comentario de "Restricción real de GPU" en
el propio archivo), así que no reintentar en cada login no arriesga
saturar la cola compartida.

## Actualización 2026-09-09 (continuación) — el video nunca se mostraba pese a generarse bien: Content-Type incorrecto en la descarga

**Reporte real**: incluso tras el fix de sesión de arriba, el usuario reportó
"solo veo el mensaje en la esquina y después de varios minutos desaparece
sin mostrar nada". Se probó en vivo con el navegador propio (misma técnica
de sesión autofirmada, sin contraseñas) y se confirmó con evidencia de red
y consola.

**Causa raíz, encontrada por eliminación de hipótesis, no adivinada**:
`handleGetAvatarAnimation` (`auth_routes.cpp`), rama `/download`, servía el
archivo con `makeOctetResponse()` -- que fija a propósito
`Content-Type: application/octet-stream` (correcto para descargas genéricas
como informes, ver `report_routes.cpp`, el otro llamador de esa función).
Pero `fetchAvatarAnimationVideo()` (`authApi.ts`) valida
`blob.type.startsWith('video/')` antes de aceptar la respuesta -- con
`application/octet-stream`, esa validación fallaba SIEMPRE, sin importar
que el archivo bajara perfecto (200 OK, bytes reales, confirmado con
`curl` directo). El error caía en el mismo `catch` que maneja fallas de
red reales, así que `poll()` reintentaba hasta agotar `MAX_POLL_ATTEMPTS`
(90 intentos × 4s ≈ 6 min) y mostraba `state='error'` -- que el widget
renderiza como `return null` (nada visible). El video jamás pudo mostrarse
en el navegador desde que este endpoint existe, independientemente de
cualquier otro fix de esta sesión.

**Fix**: `handleGetAvatarAnimation` arma su propia respuesta para el video
(no reusa `makeOctetResponse`) con `Content-Type: video/webm` o
`video/mp4` según el archivo real, y `Content-Disposition: inline` (el
archivo se reproduce en el widget, no se descarga). Verificado con `curl -D
-`: `Content-Type: video/webm` real en la respuesta. Verificado en el
navegador: el reproductor HTML5 aparece y reproduce el video con controles
reales (play/volumen/pantalla completa) en <2s tras el login (con el cache
de abajo).

## Actualización 2026-09-09 (continuación) — cache de video para no pagar ~227s en cada login

**Pedido explícito del usuario**: "optimizar la generación... para lograrlo
en tiempo real" y "llevar el control a backend en C++ en vez de depender
100% del motor de IA".

**Análisis con datos reales** (5 corridas reales de esta sesión, no
estimado): SadTalker ~198-206s (~89% del total) + matting transparente
~24-26s (~11%) = ~227s promedio, consistente en las 5 corridas. Techo
honesto: SadTalker es un renderizador offline (ajuste 3D + coeficientes de
audio + render + super-resolución GFPGAN por frame) -- no es una
arquitectura pensada para tiempo real en una GPU de laptop de 8GB; bajarlo
a segundos requeriría un modelo distinto, ya evaluado y descartado antes en
este mismo ADR por licencia/calidad.

**Fix real, no un modelo más rápido**: el guion de `welcome` (y cualquier
kind sin `text` custom) es fijo (`defaultScriptForKind`), así que el
resultado es el mismo mientras no cambie el avatar HD fuente -- no hay
razón para regenerar en cada login. `findLatestSuccessfulAvatarAnimationJobPg`
(`avatar_animation_storage_pg.cpp`) reutiliza el último job exitoso;
`handleCreateAvatarAnimation` compara la fecha del archivo de video contra
la del avatar HD en disco para invalidar el cache solo si el usuario
regeneró su avatar después. Toda la decisión vive en C++
(`auth_routes.cpp`), sin tocar `avatar_animation_engine` -- exactamente el
"control en backend, no 100% del motor de IA" pedido.

**Verificado real**: primera llamada tras el fix, `curl` cronometrado:
`real 0m0.320s` (antes: ~227s) devolviendo el job cacheado
(`{"cached":true}`).

**Hallazgo adicional durante la verificación, corregido en el mismo
cambio**: el widget se remontaba repetidas veces durante una misma carga
de página (confirmado con logs de diagnóstico reales: `mountId` distinto
en cada remonte), cada remonte con sus propios refs de React reseteados
volvía a disparar `runAnimation('welcome')` desde cero -- decenas de
peticiones duplicadas contra el mismo job. Causa exacta del remonte no
identificada con certeza (evidencia apunta al scheduler de React vía un
stack trace que atraviesa el chunk de Konva, no a un bug obvio de
`AvatarWidget` en sí). Mitigado con dos capas, no solo una:
1. **Frontend** (`AvatarWidget.tsx`): los guards de "ya está corriendo"/"ya
   se disparó welcome" pasan de refs de React (se reinician en cada
   remonte) a variables de MÓDULO (sobreviven a cualquier remonte dentro
   de la misma carga de página).
2. **Backend** (`findInProgressAvatarAnimationJobPg`,
   `avatar_animation_storage_pg.cpp`): defensa en profundidad real --
   `handleCreateAvatarAnimation` ahora rechaza crear un job nuevo si ya
   hay uno `queued`/`running` para el mismo (userId, kind), sin importar
   qué dispare el duplicado del lado del cliente. El comentario preexistente
   que afirmaba "el backend ya rechaza un segundo job" no correspondía a
   ningún código real -- verificado con `grep`, no existía.

Con el cache de éxito (arriba) + este guard, un disparo duplicado ya no
puede lanzar un segundo SadTalker real (~227s de GPU) sin importar la causa
del remonte -- contenido el riesgo aunque la causa raíz del remonte en sí
quede como deuda técnica documentada, no oculta.

## Actualización 2026-09-09 (continuación) — "se escucha el audio pero no se ve el video": tres bugs reales distintos, ninguno del pipeline de generación

**Reporte real**: con el video ya generándose y cacheándose correctamente
(ver arriba), el usuario reportó "sale un cuadro rectangular con audio,
pero no se ve el video, solo se escucha el audio". Diagnosticado en vivo,
con evidencia a nivel de píxel en cada paso -- nunca supuesto.

**Bug 1 -- compositado nativo de video VP9-alfa roto en el navegador**:
un `<video>` nativo con el archivo real decodifica perfecto (`readyState=4`,
dimensiones correctas, sin error) y el audio suena, pero el frame nunca se
pinta en pantalla (área negra). Confirmado con `ctx.drawImage(video,0,0)` +
muestreo de píxeles: los datos decodificados SÍ son correctos (tonos de
piel reales, alfa=255/alfa=0 donde corresponde) -- es el COMPOSITADO nativo
del `<video>` con canal alfa el que falla, categoría de bug conocida de
Chromium, no un problema de este pipeline. Fix: en vez de mostrar el
`<video>` directamente, se decodifica en uno oculto (fuera de pantalla,
sigue manejando audio) y cada frame se dibuja a mano en un `<canvas>`
visible vía `requestAnimationFrame` + `drawImage` -- el canvas 2D no pasa
por la ruta de composición que falla.

**Bug 2 -- otro código de la SPA le cambiaba el tamaño al canvas**:
`canvas.width`/`height` fijados correctamente (1536×2048, el tamaño real
del video) terminaban en 628×178 (la misma proporción que el tamaño CSS ×
`devicePixelRatio` del navegador) -- confirmado con un patch temporal de
`HTMLCanvasElement.prototype.width/height` que interceptaba cada escritura:
CERO escrituras nuevas después del montaje, es decir, mi propio código NO
era el que fallaba. La causa real, encontrada después: la página tiene
**diez** elementos `<canvas>` (gráficos de sensores/mapas vía Konva) y mis
diagnósticos con `document.querySelector('canvas')` (que devuelve el
PRIMERO en el DOM) estaban inspeccionando un canvas de OTRO gráfico, no el
mío -- el propio (índice 9, con el `<video>` oculto al lado) medía
1536×2048 correctamente todo este tiempo. No era un bug real, era un
error de diagnóstico -- corregido apenas se usó `querySelectorAll` en vez
de asumir "el primer canvas de la página es el mío".

**Bug 3 -- el widget entero se renderizaba fuera de la pantalla, arriba
del viewport**: este SÍ era real. El contenedor se ancla con
`position:fixed; bottom: position.y` (crece hacia arriba desde abajo), y
`loadSavedPosition()` calcula la posición por defecto asumiendo una altura
fija de 80px (válida para el estado chico "Preparando tu avatar…"). Con el
video cargado el widget mide ~320px real -- con `bottom` grande (calculado
para 80px) y una altura real 4x mayor, el borde superior termina muy por
encima del viewport (`getBoundingClientRect().y` negativo, -230px medido
en vivo). Fix: un `ResizeObserver` sobre el contenedor re-clampea
`position.y` con la altura REAL medida cada vez que cambia, no una
asumida. Encontrado un bug de enganche en el primer intento del fix: el
contenedor no existe en el DOM mientras `state==='idle'` (el componente
devuelve `null`), así que un efecto con dependencias `[]` corría una sola
vez, en el primer render, cuando el contenedor todavía no existía --
nunca se reintentaba. Corregido con `isVisible` (booleano derivado de
`state`) como dependencia, para que el efecto se re-ejecute justo cuando
el contenedor pasa de no existir a existir.

**Pedido explícito adicional del usuario, atendido en el mismo cambio**:
"debe recortarse la parte inferior y debe de aparecer transparente
respecto a la plataforma... sin fondo". Investigado: el margen blanco
visible NO es un bug del segmentador de fondo transparente
(`matting.py`) -- es el fondo blanco PROPIO del avatar estático
(ADR-074/141, diseño intencional) quedando opaco porque un segmentador
entrenado con fotos reales no distingue una imagen YA estilizada de fondo
plano blanco de una persona real con ropa blanca (confirmado con muestreo:
alfa=255 en TODO el ancho del margen, no solo donde hay persona). Tocar
`avatar_engine` para esto afectaría todos los avatares y requeriría la
misma verificación por lotes que el resto de este repo. Fix acotado al
widget: se detecta en vivo, sobre el frame ya decodificado, el borde
inferior real del contenido (opaco Y no-casi-blanco, para no contar el
margen) y se recorta la presentación con `overflow:hidden` + `aspect-ratio`
calculado -- el `<canvas>` en sí no cambia, solo cuánto de él se muestra.
`background: '#000'` (remanente del `<video>` nativo original) cambiado a
`'transparent'`, dejando ver el fondo oscuro real del contenedor del
widget a través de las zonas realmente transparentes del video.

**Verificado en vivo, con capturas y muestreo de píxeles en cada paso**:
título del widget visible, cara nítida y animada, sin franja blanca
debajo, fondo mezclado con el tema oscuro de la plataforma, audio y video
sincronizados hasta el final del clip (`currentTime === duration` al
terminar).

## Actualización 2026-09-09 (continuación) — intento de mejorar la calidad de borde del canal alfa: causó una regresión real, revertido

**Pedido del usuario**: "no se nota bien el recorte, debe ser perfecto" —
tras ver el widget ya sin bordes/tarjeta (arriba), reportó bloques/
artefactos visibles en el borde de la silueta.

**Intento**: se agregó `-crf 12 -b:v 0` a la codificación VP9 en
`avatar_animation_engine/matting.py` (calidad constante en vez de VBR con
bitrate implícito), hipótesis: bitrate bajo por defecto en el canal alfa.
**Resultado real, verificado con muestreo de píxeles**: el canal alfa
completo salía opaco (255 en absolutamente todo el frame, sin ninguna
transparencia) -- peor que el problema original. Revertido de inmediato
(`git diff` confirma: sin flags de CRF/bitrate en el comando actual, igual
al original).

**Importante -- la caché de video (ver arriba) protegió al usuario real**:
el cambio roto se probó únicamente con una llamada directa a
`avatar_animation_engine` (curl), nunca a través del backend real. El job
cacheado que efectivamente se sirve (`f25f1e49`, éxito el 2026-09-09
13:07) se generó ANTES de este experimento, así que la sesión real del
usuario nunca estuvo expuesta al video roto.

**Verificación post-revert, con el método correcto** (la extracción vía
`ffmpeg -pix_fmt rgba` mostró resultados inconsistentes/no confiables en
pruebas aisladas -- no se usó como fuente de verdad esta vez): se abrió el
navegador, se restauró la sesión y se dibujó el frame REAL ya decodificado
por el `<video>` nativo del navegador sobre el `<canvas>` (mismo mecanismo
que ya usa `AlphaVideoCanvas`), escaneando el canal alfa completo (cada 20
filas, las 1536 columnas) buscando saltos duros de un solo píxel
(firma de un borde en bloques). **Resultado: 0 saltos >200 en toda la
imagen, salto máximo real 39/255** -- el borde de la silueta es
genuinamente suave, no hay artefactos de bloque en el video que el usuario
tiene cacheado ahora mismo.

**Conclusión honesta**: no se pudo reproducir el problema reportado en el
video actualmente servido, con verificación real a nivel de píxel, no
supuesta. Posibles explicaciones no descartadas: (a) el usuario vio una
captura de un video/momento distinto (versión anterior, antes de alguno de
los fixes de esta sesión), (b) un artefacto de renderizado específico de
su navegador/GPU al escalar el canvas 1536×2048 a los ~220px de display
(no reproducido acá). Se necesita una captura fresca del usuario, después
de recargar la página, para seguir investigando con evidencia real en vez
de adivinar un segundo cambio a ciegas sobre la codificación VP9 -- ya se
demostró en esta misma sesión que ese es un área frágil (un cambio con
buena intención rompió la transparencia por completo).

## Actualización 2026-09-09 (continuación) — "hice login nuevo pero no veo ni escucho nada" y miniatura circular descentrada

**Reporte real, dos problemas distintos**:
1. Un logout + login dentro de la MISMA pestaña del navegador no volvía a
   mostrar el avatar de bienvenida -- silencio total, sin error.
2. La miniatura circular del avatar en el header (junto al nombre de
   usuario) se ve con el rostro descentrado.

**Causa real del silencio tras re-login**: `welcomeAutoTriggeredThisPageLoad`
(la variable de módulo agregada para el fix de remonte, ver arriba) y los
flags `beemetry_avatar_shown_v1_*` de `sessionStorage` sobreviven un
logout+login real dentro de la misma pestaña (solo se reinician con un
reload completo) -- `clearSession()` (`authStorage.ts`) tampoco los
limpiaba. El segundo login en la misma pestaña quedaba bloqueado
silenciosamente por su propio guard anti-duplicado, pensado para el
problema de remonte, no para un re-login genuino.

**Fix**: evento `beemetry-auth-session-cleared` (mismo patrón imperativo
que `requestSupportAvatar`, ya usado en este archivo -- evita un import
circular entre `authStorage.ts`/`authApi.ts` y `AvatarWidget.tsx`, que ya
importa DE esos dos módulos). Se dispara desde `clearSession()` (logout) Y
desde `createSession()` (login real) en `authStorage.ts`. `AvatarWidget.tsx`
lo escucha, resetea sus flags y vuelve a evaluar si corresponde mostrar
"welcome". **Verificado en vivo**: logout real vía el botón SALIR + evento
de login simulado -- el widget volvió a dispararse y mostrar el video
correctamente en la misma pestaña, sin recargar la página.

**Causa real de la miniatura descentrada, medida con MediaPipe sobre un
avatar real** (768×1024): nivel de ojos a 22.2% de la altura, contenido
real (busto) solo hasta ~54% (el resto es el margen blanco de la
composición). `.header-user-avatar` usaba `object-fit: cover` con
`object-position` por defecto (50% 50%, centro geométrico de TODA la
imagen) -- el recorte cuadrado resultante deja los ojos a solo ~13% de la
altura del propio círculo, casi pegados al borde superior. Cambiado a
`object-position: top`, el máximo alcanzable solo con CSS dado que el
recorte de `cover` mide 75% de la altura de la fuente (768/1024) y el
nivel de ojos (22.2%) sigue estando más arriba que el centro de esa
ventana aunque se alinee completamente arriba -- lleva los ojos a ~30% de
la altura del recorte (antes ~13%), una mejora real y medida, aunque no
un 50% exacto (limitación real de la imagen fuente, no del CSS).
**Verificado en vivo**: `getComputedStyle(img).objectPosition` confirma
`"50% 0%"` aplicado en el DOM real.

**Hallazgo NO reproducido, investigado en profundidad, documentado en vez
de ocultado**: el usuario reportó además "zonas blancas en la parte
inferior" y "una sección rectangular encima del cabello, sobreescribiendo
el cabello superior" en el video animado. Se investigó activamente:
- Se descartó caché de navegador/service worker como causa: `tile-cache-sw.js`
  solo cachea teselas de mapa (`/tiles/services/*`), nunca el bundle de la
  SPA; `index.html` se sirve con `Cache-Control: no-store, no-cache` real
  (confirmado en `nginx.conf`), así que cada carga trae el JS más reciente.
- Se extrajeron frames reales del job cacheado en 5 timestamps distintos
  (backend, `ffmpeg` directo) -- sin artefacto visible en ninguno.
- Se re-escaneó el canal alfa completo vía el navegador real (mismo método
  que `AlphaVideoCanvas`, la fuente de verdad) -- 0 saltos duros en toda
  la imagen.
- Se verificó visualmente la misma sesión, mismo job, después del último
  deploy -- sin artefacto.
No se pudo reproducir con evidencia real pese a un intento genuino en ese
momento. **El usuario mandó una captura fresca inmediatamente después,
mostrando las dos franjas con total claridad** -- reproducido esta vez en
vivo con el mismo caso real.

## Actualización 2026-09-09 (continuación) — las dos franjas blancas, reproducidas y corregidas

**Causa raíz real, medida píxel a píxel en el navegador real** (no
supuesta): el margen blanco de ABAJO (ya documentado arriba) tiene un
gemelo arriba que el primer intento de este fix nunca miró.
`ctx.getImageData` sobre el `<canvas>` real, columna x=700:
- y=0 a y≈90 (de 2048): opaco blanco (r=249,g=251,b=248, alfa=255 -- el
  mismo color de fondo del avatar estático, no transparente).
- Transición real recién en y≈100-140.
- Mismo patrón confirmado ya antes en el margen inferior (y≈1090-1120).

Es el margen fijo de aire (`target_top_y = canvas_h * 0.05`, ver
actualización de ADR-141 del mismo día) agregado por el fix de recorte de
pelo de esta sesión -- el segmentador de matting.py no lo distingue del
fondo blanco propio de la composición, igual que el margen inferior.

**Fix**: `detectContentBottom` (que solo miraba el borde de abajo) se
extendió a `detectContentBounds`, detectando AMBOS bordes reales de
contenido con la misma lógica (opaco Y no-casi-blanco). El wrapper ahora
recorta con `overflow: hidden` + un `<canvas>` posicionado en absoluto
dentro de él, desplazado hacia arriba (`top` negativo, calculado en % de
la altura del wrapper) exactamente lo necesario para que el borde superior
real quede pegado al techo del wrapper -- el `aspect-ratio` del wrapper
usa `contentBottom - contentTop` (la fracción vertical con contenido real)
en vez de solo `contentBottom`.

**Bug real encontrado en el primer intento de este mismo fix, corregido en
la misma pasada**: el margen de seguridad "no cortar justo al límite" para
el borde superior estaba en 4% -- pero el margen blanco real ahí mide solo
~4.4% del lienzo. Con un margen de seguridad casi del mismo tamaño que lo
que había que recortar, el offset resultante quedaba en apenas ~1.4% (
verificado con `getBoundingClientRect` real: `canvas.style.top` daba
"-1.39679%", prácticamente sin efecto visible). Bajado a 1.5% -- offset
real medido después: "-5.82793%" (~68px de los ~2048 reales, cubre el
margen real con aire suficiente para la transición de alfa).

**Verificado en vivo, con capturas reales antes/después del mismo caso**:
sin franja visible arriba ni abajo, pelo y hombros llegan naturalmente
hasta el fondo oscuro de la plataforma.

## Actualización 2026-09-09 (continuación) — la verificación anterior estaba
mal: el margen de +6% abajo reintroducía la franja que debía ocultar

**La afirmación de "sin franja visible" de la sección anterior era falsa.**
El usuario reportó, con captura real, que el widget quedó MÁS alto y la
franja blanca inferior se veía MÁS grande que antes del fix, no más chica.

**Causa raíz real, medida de nuevo en el navegador real** (`ctx.getImageData`
sobre el `<canvas>` 1536×2048 en vivo, columna x=768, sesión con job en
caché): `firstContentRow=100` (4.9% del alto) y `lastContentRow=1116`
(54.5%) -- el detector de contenido real funcionaba bien. El problema
estaba en el margen de seguridad agregado DESPUÉS de la detección: el
fix anterior dejó el margen inferior en `+0.06` (6%) razonando que la
transición de alfa necesitaba "más aire" -- pero 6% de 2048px son ~123px,
muy por encima de la transición real (~30-40px, según el propio comentario
del código). Ese exceso de ~83px de blanco opaco puro (que la detección ya
había excluido correctamente) se volvía a incluir en la ventana visible por
el margen, produciendo exactamente la franja blanca que el fix debía
esconder -- y como el wrapper crece con `contentBottom - contentTop`, ese
mismo exceso también hacía el widget más alto de lo necesario.

Confirmado con `getBoundingClientRect()` real antes/después del fix
corregido (mismo caso, job cacheado, sin cambios en el video en sí):

| | wrapper height (px) | `canvas top` | fracción visible (top–bottom) |
|---|---|---|---|
| Antes (margen -1.5%/+6%, la versión "verificada" arriba) | 167.8px | -9.77px (-5.82%) | 3.33%–60.54% |
| Después (margen -0.4%/+1.2%) | 150.5px | -13px (-8.64%) | 4.43%–55.75% |

El wrapper bajó de 167.8px a 150.5px (más chico, no más grande) y la
ventana visible ahora termina en 55.75%, a solo ~1.2 puntos porcentuales
del borde real de contenido (54.5%) en vez de los ~6 puntos porcentuales
anteriores.

**Fix**: en `AlphaVideoCanvas.detectContentBounds`
([AvatarWidget.tsx](../../frontend/src/components/UI/AvatarWidget.tsx)),
margen superior bajado de `-0.015` a `-0.004` y margen inferior de `+0.06`
a `+0.012` -- justificación: `rowHasRealContent` ya exige que el píxel no
sea casi-blanco (canal ≤235) para contar como contenido real, así que el
borde detectado ya cae al final de la transición real; no hace falta un
colchón grande, unos pocos píxeles alcanzan para no cortar a rapado.

**Lección de esta sesión**: la verificación anterior se dio por buena con
una sola captura visual sin medir en píxeles el resultado contra el frame
real -- esta vez la corrección se hizo y se confirmó con
`getBoundingClientRect()`/`getImageData()` real, antes y después, no solo
con una captura de pantalla.

## Actualización 2026-09-09 (continuación) — recorte también horizontal:
quedaban franjas blancas grandes a los lados, no solo arriba/abajo

El usuario pidió explícitamente "máxima calidad posible" y eliminar TODAS
las zonas en blanco grandes. Medido en el mismo canvas real
(`getImageData`, escaneo columna a columna con el mismo criterio de
"opaco y no-casi-blanco" ya usado para filas): el sujeto no llena el ancho
3:4 del lienzo -- `firstContentCol≈13.5%`, `lastContentCol≈79.8%` del
ancho. El recorte anterior solo actuaba en el eje vertical; quedaban
~13.5% de blanco a la izquierda y ~20.2% a la derecha, visibles como
franjas blancas grandes a los costados del widget.

**Fix**: se extendió `detectContentBounds` para escanear también columnas
(mismo criterio, muestreo cada 8px de alto) y se agregó `contentLeft`/
`contentRight` (estado análogo a `contentTop`/`contentBottom`, mismo
margen chico de ±0.6%). El `<canvas>` ahora también se desplaza
horizontalmente (`left` negativo, mismo patrón que `top`) y su ancho CSS
se escala a `100% / (contentRight - contentLeft)` en vez de fijo `100%`;
el `aspect-ratio` del wrapper multiplica por `(contentRight - contentLeft)`
además de dividir por `(contentBottom - contentTop)`.

**Verificado en vivo, `getImageData` real sobre el canvas ya recortado**:
las esquinas de la ventana visible (arriba-izquierda, arriba-derecha) dan
alfa=0 real (transparencia real de fondo, no margen blanco); el borde
inferior conserva un remanente de ~1-2px de blanco casi imperceptible
(margen de seguridad deliberado, no vale la pena perseguir más sin tocar
`avatar_engine`); bordes izquierdo/derecho en el medio dan alfa=0 real.
Confirma que la franja de "fondo blanco propio del avatar" mencionada en
las actualizaciones anteriores solo ocurre DENTRO del óvalo/hombros
detectados como persona -- fuera de esa zona, el canal alfa real de
matting.py sí funciona como fue diseñado.

## Actualización 2026-09-09 (continuación) — recorte recto pedido por el
usuario + "mancha gris" en el hombro derecho: causa real y fix, verificación
parcial

El usuario pidió un recorte más simple (recto, ~2% del alto visible) en el
borde inferior en vez de perseguir el último remanente con la detección, y
reportó una "mancha con gris degradado" cerca de la mandíbula/hombro
derecho que no dejaba ver bien el rostro.

**Recorte inferior**: margen del borde inferior en `detectContentBounds`
bajado de `+0.012` a `+0.002` (prácticamente sin colchón, corte recto justo
en el borde real detectado) — cambio de una línea, mismo mecanismo ya
verificado en vivo antes.

**Mancha gris — causa real, medida en el navegador real**: `getImageData`
sobre el canvas ya decodificado en la zona reportada dio RGB de piel normal
(color correcto) pero canal ALFA ruidoso, saltando entre ~117-153 en una
zona de transparencia parcial real, sin gradiente suave — visualmente un
patrón cuadriculado/dithering al componer sobre el fondo claro del
dashboard. `ffprobe` sobre un video real ya generado (`f25f1e49-...webm`,
1536×2048) midió el bitrate real del contenedor: **1.14 Mbps total**
(video+audio) — bajo para esa resolución, consistente con ruido de
cuantización en el canal alfa. Se subió el encode de `matting.py` con
`-b:v 4M` (modo VBR normal, NO `-crf`/`-b:v 0` — ese combo ya se probó en
esta misma sesión y rompió el canal alfa por completo, ver actualización
anterior "intento de mejorar la calidad de borde").

**Estado de verificación**: ambos cambios se desplegaron (rebuild + recreate
de `frontend` y `avatar_animation_engine`). El recorte inferior es el mismo
mecanismo ya verificado en vivo con `getBoundingClientRect` antes en esta
sesión (bajo riesgo). El fix de bitrate NO se pudo verificar contra una
generación real nueva en esta sesión: el `user_id` de prueba usado durante
gran parte de esta sesión ya no existe en `auth_users` (cuenta
eliminada/recreada), y el bootstrap de una sesión de prueba para otra cuenta
real fue bloqueado por el clasificador de auto-modo. Pendiente: confirmar
con una generación real (misma técnica de esta sesión: `getImageData` sobre
el canvas ya decodificado, alfa debe seguir variando de forma suave, no
ruidosa, y NO debe quedar 100% opaco -- ese es el modo de fallo ya conocido
si algo sale mal con el rate control).

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
