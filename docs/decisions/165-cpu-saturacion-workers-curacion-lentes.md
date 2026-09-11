# ADR-165 — Sobre-suscripción de CPU en `curate_glasses_dataset.py`: mismo patrón de ADR-100, en un script que quedó fuera de ese fix

**Status**: ✅ implementado y verificado en vivo contra el proceso real corriendo en producción (2026-09-10)
**Fecha**: 2026-09-10
**Autores**: Luder Armas + Claude
**Ámbito**: ia
**Relación**: mismo diagnóstico raíz que ADR-100 (`onnxruntime` detecta núcleos del host/proceso, no la cuota real del cgroup, y sobre-suscribe hilos), aplicado aquí a un script (`data/curate_glasses_dataset.py`, ADR-163) que crea su propia `FaceAnalysis` por fuera de `face_embedding_insight.py` y por eso nunca heredó ese fix. Distinto del bug puntual de cuelgue de captura (lock de MediaPipe, ver ADR-125) — este es un problema de **capacidad**: contención de CPU entre un batch de curación y el tráfico real de login/registro facial, ambos en el mismo contenedor `beemetry-ai-vision`.

## Contexto

`data/curate_glasses_dataset.py` (ADR-163) corre **dentro del contenedor de producción** `beemetry-ai-vision` (reutiliza InsightFace/onnxruntime/pesos ya cargados ahí) para curar el pool de 66k imágenes gafas/sin-gafas, paralelizado con `multiprocessing.Pool`. El 2026-09-07 se subió temporalmente el límite de CPU del contenedor en `docker-compose.yml` de `cpus:'4'` a `cpus:'12'` (y memoria 6144M→10240M) porque, según el comentario ya existente ahí, "16-24 workers competían por 4 CPUs (sin ganancia real) y superaban el cap de memoria, tumbando el contenedor real de producción (RestartCount confirmado)".

Evidencia en vivo el 2026-09-09/10, con la corrida real ya usando `--workers 8` (explícito, no el default) bajo el límite de 12 CPUs:

- `docker stats beemetry-ai-vision`: **1188% CPU** — prácticamente el límite entero de 12 CPUs consumido por el batch de curación, dejando casi nada para `eye_analyzer.py` (el proceso de login/registro facial real, PID 1 del contenedor, corriendo en el mismo cgroup).
- `ps aux` dentro del contenedor: 8 workers, cada uno a **~145-157% CPU** — muy por encima del ~100%/proceso esperado si el trabajo estuviera bien acotado a 8 procesos sobre 12 CPUs.
- Prueba directa de `/health` (endpoint trivial, sin locks ni modelos) mientras la curación corría: **90ms-673ms** de latencia, muy por encima de lo esperable para un endpoint que solo responde `200 OK`.

## Diagnóstico

Tres fuentes de sobre-suscripción distintas, revisadas una por una con evidencia directa contra el propio contenedor (no solo lectura de código):

1. **onnxruntime — la causa dominante, misma raíz que ADR-100.** Verificado en el contenedor: `SessionOptions().intra_op_num_threads` por defecto es `0` (auto), y `'ORT_NUM_THREADS' in os.environ` no tiene ningún efecto real sobre onnxruntime (no es una variable que la librería lea — la única API real es `SessionOptions.intra_op_num_threads`, fijada *antes* de construir el `InferenceSession`). `insightface.model_zoo.model_zoo.get_model()` descarta en silencio cualquier kwarg que no sea `providers`/`provider_options` (mismo hallazgo exacto de ADR-100), así que no hay forma de pasarle `sess_options` a través de la API pública de `FaceAnalysis`. Resultado: cada uno de los 8 workers crea 3 sesiones onnxruntime (detection/genderage/landmark_3d_68) **sin ningún límite de hilos**, la misma sobre-suscripción de ADR-100 pero multiplicada por 8 procesos en vez de vivir en uno solo.
2. **OpenCV tiene su propio pool de hilos, independiente de onnxruntime/OpenMP.** Verificado: `cv2.getNumThreads()` dentro del contenedor devuelve **12** (SÍ lee la cuota real del cgroup, a diferencia de `os.cpu_count()` — ver punto 3) — cada llamada `cv2.*` en `evaluate_image` (cvtColor/Sobel/Laplacian/morphologyEx) podía repartirse en hasta 12 hilos, sin relación con `OMP_NUM_THREADS`/`ORT_NUM_THREADS` (esas variables nunca tocaban esta librería). Con 8 workers, eso es un techo teórico de hasta 8×12 hilos de OpenCV compitiendo por 12 CPUs reales, encima de lo de onnxruntime.
3. **El default de `--workers` usaba `os.cpu_count()`.** Verificado dentro del contenedor: `os.cpu_count()`/`nproc` devuelven **32** (núcleos lógicos del host, i9-14900HX), mientras que la cuota real del cgroup (`/sys/fs/cgroup/cpu/cpu.cfs_quota_us` ÷ `cpu.cfs_period_us`) es **12** — la misma trampa host-vs-cgroup que ADR-100 ya documentó para onnxruntime, aquí aplicada al número de *procesos* en vez de al número de *hilos*. El default anterior (`os.cpu_count() - 4` = 28) habría sido catastrófico si alguien corriera el script sin pasar `--workers` explícito.

Nótese que la corrida real ya usaba `--workers 8` (elegido a mano, razonablemente conservador para 12 CPUs) — el problema no era solo el default, sino que **cada** uno de esos 8 procesos, aun siendo pocos, sobre-suscribía internamente vía (1) y (2).

## Decisión

Todo el fix vive en `data/curate_glasses_dataset.py`, sin tocar `ai_engine/` (el script sigue siendo standalone, sin depender de un import cruzado hacia `face_embedding_insight.py` para no acoplar un script de curación de un solo uso al módulo de producción):

1. **Monkeypatch de `onnxruntime.InferenceSession.__init__`** dentro de `_worker_init()`, mismo mecanismo exacto que ADR-100 (`face_embedding_insight.py`), con su propia variable `CURATE_ORT_THREADS` (default `1`, no `2` como en producción — acá la paralelización real ya la da tener N procesos, no hace falta que cada sesión reparta además cada inferencia).
2. **`cv2.setNumThreads(1)`** dentro de `_worker_init()` — mismo razonamiento, aplicado a OpenCV en vez de onnxruntime.
3. **`os.nice(10)`** dentro de `_worker_init()` (env `CURATE_WORKER_NICE`) — de-prioriza el scheduling de los workers de curación frente a `eye_analyzer.py` (nice 0), así que bajo contención real el kernel favorece las respuestas de login/registro en vivo sobre el batch, sin imponer un techo duro de CPU que alargue el batch cuando el host no está saturado.
4. **`_container_cpu_budget()`** — lee `/sys/fs/cgroup/cpu.max` (cgroup v2) o `cpu.cfs_quota_us`/`cpu.cfs_period_us` (cgroup v1), cae a `os.cpu_count()` solo si no hay cuota fija. Nuevo default de `--workers`: `budget - 2` (antes `os.cpu_count() - 4` = 28 en este host) — dos CPUs de margen reservado para `eye_analyzer.py`, calculado sobre la cuota real, no sobre los núcleos del host.

## Verificación

- `_container_cpu_budget()` ejecutado dentro del contenedor real: devuelve `12` (coincide con `cpus:'12'` de `docker-compose.yml`); default de `--workers` resultante: `10`.
- Monkeypatch de onnxruntime confirmado activo tras `_worker_init()`: `ort.InferenceSession.__init__.__name__` → `_ort_init_thread_limited`; 10 inferencias reales sobre una imagen sintética con el patch aplicado: 0.56s (~56ms/inferencia), sin regresión funcional (mismo resultado de detección que sin el patch).
- Aplicado en caliente contra la corrida real en producción (no solo en aislamiento): el proceso de curación en vivo (`--limit 4000 --workers 8`) se reinició dos veces durante esta sesión para levantar el código corregido — el propio bucle externo que lo supervisa (fuera de este repo) lo relanzó solo cada vez, sin intervención adicional, confirmando que es reanudable como documenta ADR-163 (el reporte JSONL ya escrito no se tocó).
- Mitigación inmediata mientras se preparaba el fix de código: `renice -n 10` aplicado en caliente a los 8 workers ya corriendo con el código viejo (sin reiniciar nada), para aliviar la contención mientras se verificaba el fix — acción reversible, sin pérdida de progreso.
- **Medición antes/después contra el mismo contenedor real, misma carga (curación activa, `--workers 8`)**:

  | Métrica | Antes (código viejo) | Después (fix) |
  |---|---|---|
  | `docker stats` CPU total del contenedor | 1188% | **725%** |
  | CPU por worker (`ps`, 8 workers) | ~145-157% cada uno | **~87-90% cada uno** |
  | `GET /health` (endpoint trivial, sin locks/modelos) | 90ms-673ms | **8-10ms** |

  El endpoint `/health` no toca ningún modelo ni lock — su latencia depende solo de que el proceso de `eye_analyzer.py` consiga tiempo de CPU del kernel para atender la request. La caída de 90-673ms a un consistente 8-10ms (mismo orden de magnitud que sin ninguna carga de fondo) es la evidencia directa de que la contención real sobre el tráfico de producción se resolvió, no solo que bajó el CPU total reportado.

## Consecuencias

- Corrige de raíz (no solo alivia) la fuente principal de sobre-suscripción — la próxima vez que se lance el script, ya sea con `--workers` explícito o con el default nuevo, cada worker consume una fracción acotada de CPU en vez de multiplicar internamente los hilos de onnxruntime/OpenCV.
- No se tocó `docker-compose.yml` (el límite temporal `cpus:'12'`/`memory:10240M` con su nota de reversión ya documentada en ADR-163 queda igual) — revertirlo a `cpus:'4'`/`memory:6144M` exige recrear el contenedor (`docker compose up -d`), lo que interrumpiría el tráfico de login/registro facial en vivo; se deja como decisión operativa explícita del usuario, no como parte de este fix.
- No se movió la curación a un contenedor/proceso aparte del de producción — sigue siendo una decisión consciente de ADR-163 (reusar InsightFace/pesos ya cargados en `beemetry-ai-vision`); este ADR solo evita que ese reuso compita de forma desproporcionada por CPU con el tráfico real.
- `os.nice(10)` es una mitigación de scheduling, no un límite duro: si el host llega a estar 100% saturado de todos modos (12 CPUs todas ocupadas, niceness aparte), la latencia del servicio en vivo puede seguir degradándose — la reserva real de 2 CPUs vía el nuevo default de `--workers` es la protección de fondo.

## Alternativas descartadas

- **Importar el monkeypatch directamente desde `ai_engine/face_embedding_insight.py`** en vez de duplicar ~10 líneas: descartado — acoplaría un script de curación de un solo uso (`data/`, fuera de la imagen de producción por convención de ADR-163) a un módulo de producción con su propio ciclo de vida/estado (analyzer singleton, lock), y el valor por defecto de hilos que necesita cada uno es distinto (1 vs. 2) — la duplicación puntual, con referencia cruzada explícita en el comentario, es más simple de razonar que una dependencia entre ambos.
- **Mover la curación a un contenedor separado**: descartado por la misma razón que ya documentó ADR-163 (reuso de InsightFace/pesos ya montados en `beemetry-ai-vision`, evita descargar/instalar de nuevo) — el problema real no era *dónde* corre, sino que sobre-suscribía CPU sin límite dentro de donde ya corría.
- **Bajar `docker-compose.yml` a `cpus:'4'` ahora mismo**: descartado en esta sesión — exige recrear el contenedor de producción, interrumpiendo tráfico de login/registro en vivo; queda para cuando el usuario decida cortar la curación o cuando termine sola.

## Referencias

- `data/curate_glasses_dataset.py` (`_worker_init`, `_container_cpu_budget`)
- `ai_engine/face_embedding_insight.py` (mismo mecanismo de monkeypatch, ADR-100)
- `docker-compose.yml` (`ai_engine.deploy.resources.limits`, bump temporal documentado en ADR-163)
- ADR-100 (`onnxruntime-thread-limit-insightface`) — diagnóstico raíz original
- ADR-163 (`curacion-dataset-lentes-reentrenamiento-onnx`) — script y bump temporal de CPU/memoria que este ADR corrige
