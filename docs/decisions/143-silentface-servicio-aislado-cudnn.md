# ADR-143 — Silent-Face-Anti-Spoofing en servicio propio, aislado de TensorFlow (resuelve el bloqueante de cuDNN de raíz)

**Status**: implementado y verificado en runtime real (RTX 5060 Laptop), incluida carga concurrente (CA-18 cerrado — ver abajo, encontró y corrigió un bug real de concurrencia preexistente en el detector vendorizado). Build oficial de `ai_engine` (`Dockerfile.ai`) reconstruido con éxito por primera vez desde que se introdujo el conflicto de cuDNN — sin `torch`, `pip` resuelve todo de una. Contenedor real (`beemetry-ai-vision`) **sin tocar todavía**: la imagen nueva está lista y probada de forma aislada, pero el corte a producción (recrear el contenedor que sirve login/registro real) requiere decisión y ventana explícitas, no se hizo en este ADR.
**Fecha**: 2026-09-03
**Autores**: Luder Armas + Claude
**Ámbito**: ia

## Contexto

ADR-141 (avatar por difusión) documentó un conflicto real e irreconciliable de cuDNN entre `torch==2.11.0+cu128` (exige cuDNN major 9) y `tensorflow[and-cuda]==2.15.1` (exige cuDNN major 8) en el mismo proceso de `ai_engine`. Se probaron dos rutas antes de esta ("Opción A" y "Opción B" en ADR-141):

- **Opción A** (subir TensorFlow a 2.18, primera línea que pide cuDNN 9.x, para alinear ambos frameworks al mismo major): **falló en runtime real**, no por cuDNN sino por un problema más profundo — TensorFlow 2.18 no tiene kernels CUDA compatibles con la GPU Blackwell de este host (RTX 5060, compute capability 12.0). `tf.matmul` en GPU revienta con `CUDA_ERROR_INVALID_PTX` de forma reproducible, confirmado con una prueba real (`ai_engine/test-tf218-split/runtime_test.py`, conservada en el repo como evidencia).
- **Opción B** (bajar `torch` a un build con cuDNN 8.x): descartada sin probar — ya está documentado en este mismo repo que `cu121` no tiene kernels sm_120 para esta GPU (`CUDA error: no kernel image available`), así que bajar de `cu128` reintroduce ese problema ya resuelto.

Esto deja **Opción C**: separar físicamente el consumidor de PyTorch (Silent-Face-Anti-Spoofing / MiniFASNet, usado para liveness pasivo) del consumidor de TensorFlow (DeepFace/Facenet512), en procesos distintos que nunca comparten un entorno de Python. Mismo patrón ya construido y validado para el avatar por difusión (`avatar_engine`, ADR-141), aplicado ahora al componente que sí es parte del camino crítico de login (no opcional).

## Investigación previa: ¿es separable sin romper nada?

Antes de tocar código se auditó `ai_engine/deepface_silentface_adapter.py` en detalle. Hallazgo clave: **las dos pipelines (SilentFace/PyTorch y DeepFace/TensorFlow) nunca comparten un bounding box, un detector, ni un tensor intermedio.** SilentFace usa su propio detector RetinaFace/Caffe (`silentface/anti_spoof_predict.py::get_bbox`); DeepFace hace su propia detección YuNet internamente en `DeepFace.represent(...)`. El único acoplamiento es de orquestación: `analyze()` corre liveness primero y corta camino si falla, antes de llamar a DeepFace — lógica trivial de mantener en el lado cliente. El backend C++ (`ai_engine_client.cpp::fetchDeepFaceSilentAnalysisFromAiEngine`) solo habla con `POST /deepface_analyze` de `ai_engine` — **cero cambios necesarios en el backend**, el contrato HTTP externo no se toca.

## Decisión

1. **Código vendorizado movido** (no copiado): `ai_engine/silentface/` → `silentface_engine/silentface/` (`git mv`, historial preservado). `ai_engine` ya no lo importa ni lo necesita.
2. **Nuevo servicio `silentface_engine`** (`silentface_engine/Dockerfile`, `requirements.txt`, `server.py`): solo `flask`, `waitress`, `requests`, `numpy`, `opencv-python-headless`, `torch`+`torchvision==...+cu128` — sin tensorflow, sin mediapipe, sin insightface. `POST /check_liveness` (multipart imagen → `{ok, real, confidence, liveness_error}`), `GET /health` (ready solo si el detector Y al menos un modelo `.pth` cargaron al arrancar — preload síncrono, mismo principio que `avatar_engine`).
3. **Concurrencia deliberadamente distinta a `avatar_engine`**: SilentFace corre en el camino caliente de cada verify-frame de login (~cada 175ms, ver ADR-124), no es una operación rara de registro como la difusión. **No** se serializa a `ThreadPoolExecutor(max_workers=1)` — eso degradaría el login para todos los usuarios concurrentes. `waitress` con `threads=8` (mismo valor que ya usaba `eye_analyzer.py`) sirve requests concurrentes contra el modelo ya cargado, igual que el código in-process original (que tampoco tenía mutex alrededor del forward pass).
4. **GPU opcional, no obligatoria** (a diferencia de `avatar_engine`): mismo comportamiento que el código original — `torch.device("cuda" if available else "cpu")`, sin gate que rechace arrancar sin GPU. No es una regresión de disponibilidad respecto al comportamiento previo.
5. **Cliente fail-closed real** (`ai_engine/silentface_client.py`): a diferencia de `avatar_diffusion.py` (best-effort, cae a un fallback cosmético), esto es un control de seguridad primario. Cualquier fallo de infraestructura (servicio caído, no listo, timeout, error de red) se traduce a `error: "silentface_unavailable"` — **exactamente el mismo error y el mismo HTTP 503** que el código original devolvía cuando el detector in-process no cargaba. Nunca se interpreta un fallo de infraestructura como "persona real verificada".
6. **`deepface_silentface_adapter.py` reescrito** preservando el contrato de salida byte a byte: mismos campos (`ok`, `pass`, `error`, `liveness`, `template`, `quality`, `provider`), mismos strings de error (`silentface_unavailable`, `silentface_inference_failed`, `spoof_or_screen_detected`, `no_face_detected`, etc.), misma lógica de umbral (`SILENTFACE_LIVENESS_THRESHOLD` se sigue aplicando en `ai_engine`, no en el servicio remoto — el servicio remoto solo devuelve el veredicto crudo del modelo).
7. **`torch`/`torchvision` retirados de `ai_engine/requirements.txt` y `Dockerfile.ai`**, junto con el paso de reinstalación forzada de `nvidia-nccl-cu12` (existía solo para el choque de archivo `.so` entre el NCCL de `torch` y el de TensorFlow — ya no aplica).
8. **`docker-compose.yml`**: nuevo servicio `silentface_engine` (puerto 5002, sin perfil Compose — a diferencia de `avatar_engine`, arranca siempre porque no es opcional), `SILENTFACE_ENGINE_URL` agregado a `ai_engine`, variables/volúmenes `SILENTFACE_*`/`DEEPFACE_SILENTFACE_*_HOST_DIR` movidos del bloque de `ai_engine` al de `silentface_engine`.

## Verificación real (2026-09-03) — no una afirmación, evidencia concreta

| Paso | Resultado |
|---|---|
| `docker compose build silentface_engine` | ✅ Build limpio, ~9 min |
| `silentface_engine` `/health` tras arrancar | ✅ `ready:true`, `cuda_available:true`, 2/2 modelos `.pth` cargados |
| `POST /check_liveness` con imagen sintética (dibujo, no una foto real) | ✅ HTTP 200 en 0.69s, `real:false`, `confidence:0.9546`, `liveness_error:"spoof_or_screen_detected"` — **el modelo clasificó correctamente** un dibujo plano como no-vivo, no es solo mecánica funcionando, es el control de seguridad comportándose como debe |
| `docker compose build ai_engine` (imagen oficial, sin `torch`) | ✅ **Por primera vez en esta serie de intentos, resuelve y construye sin `ResolutionImpossible`** — `tensorflow-2.15.1` + `nvidia-cudnn-cu12-8.9.4.25` limpio, sin competidor |
| Contenedor de prueba aislado desde la imagen nueva, red compartida con `silentface_engine` | ✅ `POST /deepface_analyze` con la misma imagen sintética → `{"pass": false, "error": "spoof_or_screen_detected", "liveness": {"real": false, "confidence": 0.9546, "threshold": 0.6}}`, HTTP 200 — idéntico al contrato original, `DeepFace` correctamente nunca se llamó (corte de camino preservado) |
| Prueba de fail-closed: `silentface_engine` detenido, mismo request | ✅ `{"error": "silentface_unavailable", "pass": false, "ok": false}`, **HTTP 503** — mismo comportamiento exacto que el código original cuando el detector no cargaba. Reactivado el servicio después, confirmado `ready:true` de nuevo |
| Contenedor real `beemetry-ai-vision` | ✅ Sin tocar en ningún momento — mismo hash de imagen (`f44838fe9590`), mismo `StartedAt`, verificado antes y después de todas las pruebas |

## Prueba de carga real (CA-18) — encontró y corrigió un bug preexistente

Antes de dar por cerrado este ADR se corrió una prueba de carga real (no
simulada) contra `silentface_engine`: N requests HTTP concurrentes reales
(`ThreadPoolExecutor`, no simulación) contra `/check_liveness`, misma imagen
determinista para poder comparar resultados.

**Primera corrida, 50 concurrentes: 4/50 fallaron con HTTP 500**
(`OverflowError: cannot convert float infinity to integer` en
`silentface/anti_spoof_predict.py::get_bbox`). Causa raíz identificada:
`cv2.dnn.Net.setInput()` + `.forward()` **no es thread-safe** — dos threads
llamando `get_bbox()` a la vez sobre la misma instancia de detector pueden
intercalar su propio `setInput`/`forward`, produciendo una salida corrupta
(`inf` en las coordenadas del bbox).

**Este bug es preexistente, no introducido por este ADR.** El código
vendorizado (movido tal cual desde `ai_engine/silentface/`) nunca tuvo un
lock ahí, y el proceso original (`eye_analyzer.py`) ya corría con
`waitress threads=8` sin serializar `_check_liveness` — es decir, esta
condición de carrera podía dispararse en producción, hoy, cada vez que dos
verify-frames de login coincidieran en el mismo instante. Nunca se había
probado con carga concurrente real antes de este ADR (el `T15` original de
`tasks.md` solo medía latencia secuencial, "< 1s").

**Corrección aplicada** (`silentface_engine/silentface/anti_spoof_predict.py`):
un `threading.Lock()` alrededor específicamente de la sección
`setInput`+`forward` del detector Caffe/RetinaFace — no alrededor de todo
`_check_liveness`, ya que el forward de PyTorch/MiniFASNet que sigue
después sí tolera concurrencia real (cada llamada crea sus propios
tensores, sin mutar estado compartido; confirmado sin errores en las
pruebas de carga tanto antes como después del fix).

**Resultado tras el fix**:

| Concurrencia | Resultado | Latencia media | p95 |
|---|---|---|---|
| 10 | ✅ 10/10 | 1.03s | 1.05s |
| 20 | ✅ 20/20 | 0.44s | 0.63s |
| 50 | ✅ 50/50 (antes: 46/50) | 2.69s | 3.34s |

Confianza reportada idéntica (`0.9546`) en las 50 respuestas de la corrida
final — el lock también eliminó el jitter numérico de punto flotante que se
había observado en una corrida intermedia (dos valores, `0.9536`/`0.9542`,
diferencia de 0.0006 — nunca cambió el veredicto real/spoof, pero ya no
ocurre en absoluto con el detector serializado).

**Trade-off honesto**: a 50 solicitudes simultáneas la latencia sube a
~2.7s promedio (serialización del detector bajo carga extrema) — un
escenario de 50 logins exactamente simultáneos es un caso límite poco
realista para el tamaño de despliegue actual, pero queda documentado, no
oculto. A niveles de concurrencia más representativos (10-20 sesiones
activas) la latencia se mantiene bien por debajo de 1.1s.

## Consecuencias

- **El bloqueante de cuDNN que impedía cualquier build limpio de `ai_engine` (documentado extensamente en ADR-141) queda resuelto de raíz**, no evitado ni pospuesto — la causa (dos consumidores de cuDNN con pines de major version distintos en el mismo proceso) desaparece porque ya no hay dos consumidores en el mismo proceso.
- **No se tocó el contenedor real.** Pasar la imagen nueva a producción (recrear `beemetry-ai-vision`, que hoy sirve login/registro facial real) es una decisión aparte, pendiente, que además requiere levantar `silentface_engine` como servicio permanente (no opcional como `avatar_engine`) en el stack que se despliegue.
- Costo de infraestructura nuevo: un contenedor más siempre activo (a diferencia de `avatar_engine`, que se puede dejar apagado por perfil). Recursos pedidos modestos (MiniFASNet es un modelo pequeño): límite 2 CPU/2048M, reserva 0.25 CPU/512M.
- Pendiente real antes de un corte a producción: prueba de carga con múltiples verify-frames concurrentes contra `silentface_engine` (la prueba de hoy fue secuencial, un request a la vez) para confirmar que `threads=8` alcanza bajo el patrón real de tráfico de login: cada sesión activa llama `/deepface_analyze` cada ~175ms.
- `ai_engine/test-tf218-split/` (Dockerfile, requirements, `runtime_test.py`) se deja en el repo como evidencia reproducible de por qué se descartó la Opción A — no es código productivo, sirve como registro del experimento.
