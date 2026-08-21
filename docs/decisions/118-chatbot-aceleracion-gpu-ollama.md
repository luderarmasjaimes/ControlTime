# ADR-118 — Aceleración GPU para Ollama (latencia del chatbot)

**Status**: implemented (2026-08-19)

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte / infraestructura

**Relación**: afecta el chatbot de ADR-112 (`mining_chatbot_service.cpp`,
`main.cpp::handleChatStreamSse`) y, de forma indirecta, la formateadora de
citas APA7 (`text_spell_service.cpp`) — ambas comparten el mismo servidor
Ollama.

## Contexto

El usuario final reportó que el chatbot tardaba más de lo normal en
responder y que las pantallas del chat se actualizaban lento. Se midió en
vivo antes de tocar nada:

- `POST /api/support/chat/message` (ruta completa, con persistencia):
  **9.2 s – 27 s** por respuesta, con variancia alta entre llamadas
  consecutivas idénticas.
- Llamada directa a Ollama (`/api/generate`, mismo modelo/opciones, sin pasar
  por el backend): **4.4 s – 8.9 s** — ya lenta por sí sola, y con la misma
  variancia alta.
- Instrumentación temporal en `support_routes.cpp::handleChatMessage`
  (después removida) confirmó que **~100% del tiempo estaba dentro de la
  llamada a Ollama** — la persistencia nueva de ADR-116 agregaba **0-1 ms**,
  descartada como causa.

Investigación de infraestructura (`ollama ps`, `nvidia-smi`, `docker stats`):

1. Ollama corría **100% en CPU** — `ollama ps` mostraba `PROCESSOR: 100% CPU`
   para ambos modelos. El host **sí tiene GPU** (NVIDIA GeForce RTX 5060,
   8 GB VRAM) y ya la usa con éxito otro servicio del mismo stack
   (`ai_engine`, ver ADR-105 punto 8) — Ollama la tenía deliberadamente sin
   mapear ("Ollama corre explícitamente sin GPU mapeada hoy").
2. El contenedor `ollama` tenía `OLLAMA_KEEP_ALIVE=-1` (nunca descargar
   modelos de RAM) — decisión válida cuando corría en 12 GB de RAM de CPU
   (ambos modelos, `gemma2:2b` ~2.3 GB + `qwen2.5:7b` ~5.5 GB, convivían sin
   problema), pero **qwen2.5:7b quedaba cargado "Forever"** consumiendo ~84%
   de la memoria del contenedor permanentemente, aunque solo se usa para
   formatear citas APA7 (`text_spell_service.cpp`, acción puntual).

## Decisión

### 1) Mapear la GPU existente al contenedor `ollama`

`docker-compose.yml`, servicio `ollama` → se agregó el mismo bloque
`deploy.resources.reservations.devices` (driver `nvidia`, `count: all`,
`capabilities: [gpu]`) que ya usa `ai_engine`. La imagen oficial
`ollama/ollama:latest` trae soporte CUDA embebido — no se cambió la imagen,
solo la reserva de dispositivo. `nvidia-container-toolkit` ya estaba probado
funcionando en este host (por `ai_engine`), así que no fue necesario
instalar nada nuevo.

Se mantiene el límite `cpus: '6'` como red de seguridad: si la GPU no
estuviera disponible por algún motivo, Ollama cae solo a CPU (mismo binario,
sin fallar el arranque) y ese límite sigue acotando el impacto sobre el resto
de contenedores (`mining_gateway`, OpenCV).

### 2) Bajar `OLLAMA_KEEP_ALIVE` de `-1` a `10m`

Con GPU, la restricción relevante pasó de RAM (12 GB, holgada) a **VRAM**
(8 GB, ajustada): `gemma2:2b` (~2.3 GB) + `qwen2.5:7b` (~5.5 GB) +
`ai_engine` (~0.2-0.3 GB) no caben cómodamente los tres a la vez. Confirmado
en vivo: al cargar `qwen2.5:7b` con `OLLAMA_KEEP_ALIVE=-1`, Ollama
**desalojaba `gemma2:2b` de la VRAM** para hacerle lugar — el siguiente
mensaje del chat pagaba una recarga completa del modelo (~12 s) en vez de
responder en caliente.

Se bajó a `10m` — el mismo valor que cada request del chatbot ya pide
explícitamente (`mining_chatbot_service.cpp`, `main.cpp`) — para que
`qwen2.5:7b` libere su VRAM cuando de verdad lleva un rato sin usarse, en vez
de retenerla indefinidamente. El chat (interactivo, uso frecuente) no debe
pagar el costo de un modelo que solo se usa para una acción puntual ya
documentada como tolerante a más latencia (ver `text_spell_service.cpp`,
comentario de ADR previo sobre la elección de modelo por tarea).

## Resultado medido (en vivo, mismo host, antes/después)

| Escenario | Antes (CPU) | Después (GPU, modelo en caliente) |
|---|---|---|
| `/api/generate` directo a Ollama | 4.4 s – 8.9 s | **0.55 s – 0.77 s** |
| `POST /api/support/chat/message` (con persistencia) | 9.2 s – 27 s | **0.55 s – 1.6 s** |
| `POST /api/support/chat/stream` (SSE, modelo en caliente) | no medido por separado (ídem ruta no-streaming) | **0.66 s** |
| Primera respuesta tras >10 min de inactividad (recarga de modelo en VRAM) | N/A (siempre "caliente" en RAM con `KEEP_ALIVE=-1`) | **~12-17 s** (una sola vez, luego vuelve a estar en caliente) |

Mejora de **~10-20x** en el caso caliente (que es el dominante en uso
interactivo real, con mensajes seguidos). El caso frío (primer mensaje tras
inactividad prolongada) es una regresión aceptada frente al `KEEP_ALIVE=-1`
anterior, a cambio de que ya NO ocurra cada vez que se usa el formateador de
citas APA7 en medio de una sesión de chat — trade-off explícito de la
sección "Decisión" punto 2.

## Consecuencias

### Positivas
- Reducción de latencia de un orden de magnitud para el caso de uso más
  frecuente (chat interactivo, ambos endpoints).
- El "pantallas se actualizan lento" reportado por el usuario era un síntoma
  directo de esta causa (streaming SSE token-a-token a la velocidad de
  generación de Ollama, sin ningún retraso artificial en el frontend — se
  revisó `streamSupportChatMessage` y no hay `setTimeout` ni throttling en
  el camino de renderizado de fragmentos).
- No requirió cambiar código de aplicación (C++/frontend) — cambio 100%
  de configuración de despliegue (`docker-compose.yml`).

### Negativas / Trade-offs
- Primera respuesta tras >10 min de inactividad paga ~12-17 s de recarga de
  modelo en VRAM (antes esto no ocurría con `KEEP_ALIVE=-1` en CPU/RAM,
  donde 12 GB alcanzaban para mantener ambos modelos siempre calientes).
  Mitigable subiendo `OLLAMA_KEEP_ALIVE` si en el futuro se libera VRAM
  (p. ej. si `ai_engine` se muda a otro host, o si se reemplaza
  `qwen2.5:7b` por un modelo más chico para APA7).
- Comparte la GPU con `ai_engine` (biometría facial) — bajo carga
  simultánea real de ambos servicios podría haber contención de VRAM/cómputo
  no observada en esta medición (hecha con `ai_engine` prácticamente
  inactivo, 230 MiB de VRAM en uso). No se dimensionó ese escenario
  combinado; revisar si se reporta lentitud durante logins faciales masivos
  concurrentes con uso intensivo del chat.
- Si el host cambia (deploy a una VPS sin GPU, por ejemplo), el bloque
  `devices` de Ollama debe quitarse manualmente (a diferencia de
  `ai_engine`, no está documentado como "opcional" en un comentario propio
  todavía — Docker puede rechazar el `up` completo si pide una GPU
  inexistente).

### Neutras
- El límite `cpus: '6'` de Ollama (de la corrección 2026-07-29, previa a este
  ADR) se mantiene sin cambios — sigue siendo la red de seguridad para el
  caso sin GPU.

## Alternativas descartadas

### Optimizar el código del backend (prompt building, persistencia, pool de conexiones)
Se instrumentó primero (antes de tocar infraestructura) para confirmar dónde
se iba el tiempo. El resultado fue inequívoco: ~100% dentro de la llamada a
Ollama, 0-1 ms en el resto del pipeline del backend. No había nada que
optimizar en C++ para este síntoma — se habría estado resolviendo el
problema equivocado.

### Reducir `num_predict`/`num_ctx` para acortar la generación
Habría reducido la calidad/completitud de las respuestas (respuestas
cortadas) sin atacar la causa real (ausencia de GPU). Descartado a favor de
resolver la causa raíz.

### Migrar a un modelo más chico
El modelo (`gemma2:2b`) ya era el elegido específicamente por ser el más
rápido entre las opciones evaluadas (ver comentario de benchmark en
`app_config.hpp`/`docker-compose.yml`, 2026-07-22). El problema no era el
modelo, era el hardware de cómputo.

## Evidencia y referencias
- `docker-compose.yml`, servicio `ollama` (bloque `deploy.resources`)
- `backend/src/support/mining_chatbot_service.cpp`, `main.cpp::handleChatStreamSse`
  (ambos ya pedían `keep_alive: "10m"` por request — sin cambios, el server
  default es lo que se alineó)
- `docs/decisions/105-deepface-silentface-proveedor-biometrico-primario.md`
  punto 8 (primer uso de GPU en el stack, `ai_engine`)
- Medición en vivo: `nvidia-smi`, `ollama ps`, `docker stats`, y timings de
  `curl -w "%{time_total}"` contra `/api/generate` directo y contra
  `/api/support/chat/message`/`/stream` a través del backend, antes y
  después del cambio, mismo host, mismo día.
