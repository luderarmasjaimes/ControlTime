# ADR-100 — Límite de hilos de onnxruntime para InsightFace (evita sobre-suscripción en Docker)

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: ia
**Relación**: mismo endpoint que ADR-098 (aislamiento de sesión); ambos
diagnosticados en la misma sesión de reportes de usuario sobre lentitud e
imprecisión del óvalo.

## Contexto

Tras corregir el bloqueo de InsightFace (ADR-099) y el aislamiento de
sesión (ADR-098), el usuario reportó que la validación "ya valida
correctamente, pero se demoró mucho — antes lo hacía más rápido", además
de un óvalo impreciso y una demora larga al activarse la captura por
primera vez.

Medición directa (`docker exec` + `curl -w "%{time_total}"`) aisló el
problema al endpoint `/face_embedding` de `ai_engine`:

- `/analyze_eyes` (MediaPipe): 30-50ms — normal.
- `/face_embedding` (InsightFace): **4.0-7.1 segundos**, con
  **398% de CPU** (saturando el límite de 4 CPU del contenedor
  `beemetry-ai-vision`, `docker-compose.yml`).

Investigando la causa: `insightface.model_zoo.model_zoo.get_model()` (código
de la librería, no del proyecto) solo reenvía los kwargs `providers` y
`provider_options` al construir la `onnxruntime.InferenceSession` de cada
uno de los 5 modelos de `buffalo_l` — cualquier otro kwarg pasado a
`FaceAnalysis(...)`, incluido `sess_options`, se descarta en silencio. No
hay forma de fijar `intra_op_num_threads` vía la API pública. Sin ese
límite, onnxruntime detecta el conteo de núcleos disponible (que dentro de
un contenedor puede reflejar el del **host**, no la cuota real del cgroup
que Docker le asignó) y crea un pool de hilos muy por encima de lo que el
contenedor puede ejecutar de verdad — sobre-suscripción clásica que causa
*throttling* severo del cgroup en vez de paralelismo real.

Nótese que `ai_engine/glasses_fusion.py` ya fijaba
`intra_op_num_threads=1`/`inter_op_num_threads=1` para su propio modelo
(el clasificador de lentes) — ese patrón, correctamente aplicado ahí, nunca
se replicó para los modelos de InsightFace.

## Decisión

`ai_engine/face_embedding_insight.py` parchea `onnxruntime.InferenceSession`
a nivel de proceso: envuelve `__init__` para inyectar un `SessionOptions`
con `intra_op_num_threads=INSIGHTFACE_ORT_THREADS` (variable de entorno,
default `2`) e `inter_op_num_threads` igual, **solo cuando el llamador no
especifica sus propias `sess_options`** — el chequeo `if
kwargs.get("sess_options") is None` deja intacto el comportamiento de
`glasses_fusion.py`, que sí las fija explícitamente.

## Verificación

| Métrica | Antes | Después |
|---|---|---|
| `/face_embedding` (InsightFace) | 4.0–7.1s | **0.58–0.79s** |
| CPU durante la llamada | 398% | **8.68%** |
| End-to-end vía backend (`/api/process_frame`) | 7–9s | **0.64–0.88s** |

Mejora de ~10x, medida con la misma imagen de prueba antes/después del
cambio, en el mismo contenedor.

## Consecuencias

- La demora inicial de activación de la UI de captura (reportada por el
  usuario como "quedan los campos seleccionados, tarda en habilitarse")
  y la imprecisión percibida del óvalo comparten la misma causa raíz:
  el ciclo de sincronización del frontend (`VERIFY_SYNC_MS`) espera cada
  respuesta antes de la siguiente, así que una respuesta de 7-9s reduce
  drásticamente la frecuencia real de actualización del óvalo/ICAO. No
  se midió el efecto directo sobre la UI en este ADR (requiere prueba
  manual con cámara), pero es la explicación más directa dado el
  diagnóstico de latencia.
- `INSIGHTFACE_ORT_THREADS=2` es un valor conservador elegido para
  dejar margen a peticiones concurrentes (MediaPipe + Flask
  `threaded=True`); no se exploró si 3 o 4 hilos mejorarían aún más el
  tiempo por request a costa de peor comportamiento bajo concurrencia
  — queda como ajuste fino posible si se necesita más rendimiento.

## Alternativas descartadas

- **Parchear `insightface.model_zoo.model_zoo.get_model` directamente**
  (monkeypatch de la función en vez de la clase `InferenceSession`):
  descartado — más frágil ante cambios internos de la librería;
  parchear `onnxruntime.InferenceSession` es un punto de intercepción
  más estable y ya tiene precedente en el propio proyecto
  (`glasses_fusion.py` construye su sesión con `SessionOptions` propio
  del mismo modo).
- **Fijar el límite de CPU del contenedor más alto** (`docker-compose.yml`,
  `deploy.resources.limits.cpus`): descartado — no ataca la causa raíz
  (el problema es sobre-suscripción de *hilos de aplicación* relativa a
  la cuota real, no falta de cuota en sí) y aumentaría el consumo de
  recursos del host sin necesidad.

## Referencias

- `ai_engine/face_embedding_insight.py`
- `ai_engine/glasses_fusion.py` (patrón de `SessionOptions` ya existente)
- `docker-compose.yml` (`ai_engine.deploy.resources.limits.cpus: '4'`)
- ADR-098 (`aislamiento-sesion-captura-biometrica`)
