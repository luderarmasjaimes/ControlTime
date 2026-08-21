# ADR-124 — Pool de conexiones TCP reutilizables hacia `ai_engine`

**Status**: implemented (2026-08-20/21, hallado y documentado en auditoría 2026-08-21)

**Fecha**: 2026-08-20

**Ámbito**: ia

**Relación**: mismo problema (overhead de conexión repetida) que `storage::PgPool`
ya resuelve para Postgres; comparte el hot path de captura biométrica con
ADR-098 (aislamiento de sesión) y ADR-119 (fusión de lentes/ONNX).

## Contexto

`analyzeFrameWithAiEngine` — el endpoint más caliente de todo el pipeline
biométrico, invocado una vez por cada verify-frame cada `VERIFY_SYNC_MS=175ms`
mientras dura una captura de login/registro facial — abría una conexión TCP
nueva hacia `ai_engine` (resolve + connect + handshake completo) y la cerraba
con `shutdown()` en cada llamada. `disableNagleForLowLatency()` ya evitaba el
retraso de ~40ms del algoritmo de Nagle por paquete chico, pero el propio
round-trip del *handshake* TCP (SYN/SYN-ACK/ACK) se seguía pagando en cada
frame — overhead puro sobre la red interna del bridge de Docker, sin ganar
nada a cambio, porque el destino (`gAiEngineUrl`) es siempre el mismo durante
toda una sesión de captura.

Ninguna decisión previa documentaba esto: no había ADR de pooling de
conexiones hacia `ai_engine`, a diferencia de `storage::PgPool`, que sí
resuelve el mismo problema para Postgres.

## Decisión

`backend/src/biometric/ai_engine_conn_pool.hpp` (nuevo): un pool en memoria,
por proceso, de conexiones TCP idle hacia `ai_engine`, deliberadamente simple:

1. **Un `io_context` propio por conexión pooled**, no un `io_context`
   compartido entre hilos — el `io_context` sobrevive junto con el
   `tcp_stream` entre llamadas en vez de crearse/destruirse en cada una,
   evitando la complejidad de sincronizar un reactor compartido entre hilos
   concurrentes de captura.
2. **Un pool por destino** (`host:port`), con un límite fijo de **16**
   conexiones idle por destino (`kMaxIdlePerTarget`) — suficiente para el
   volumen de sesiones de captura concurrentes esperado, sin crecer sin
   límite.
3. **Reuso optimista**: si el servidor no ofrece keep-alive (HTTP/1.0, o
   `Connection: close` en la respuesta), o si escribir/leer sobre una
   conexión reusada falla (el peer la cerró entre medio — timeout de
   keep-alive idle del lado del servidor), el llamador simplemente descarta
   esa conexión y reintenta **una vez** con una nueva. El comportamiento
   nunca cae por debajo del anterior (conexión nueva por request) — solo
   mejora cuando la reutilización funciona.
4. `tryAcquire`/`release` son las únicas dos operaciones públicas, protegidas
   por un único `std::mutex`; una conexión que llega inválida (`socket()` ya
   cerrado) al intentar adquirirla se descarta silenciosamente en el propio
   `tryAcquire`, sin exponer ese detalle al llamador.

`ai_engine_client.cpp` gana `sendPooledAiEnginePost`/`makeFreshAiConn`, que
envuelven el POST existente: intenta adquirir del pool, si no hay disponible
crea una conexión fresca, y al terminar la devuelve al pool (`release`) si
sigue sana.

## Consecuencias

- Elimina el costo de handshake TCP repetido en el endpoint más caliente del
  pipeline biométrico sin cambiar el contrato HTTP con `ai_engine` ni el
  comportamiento observable — es una optimización pura de transporte.
- El pool es *best-effort*: nunca bloquea esperando una conexión libre (si no
  hay una idle, simplemente abre una nueva, igual que antes de este ADR) y
  nunca puede dejar una sesión de captura sin poder progresar por falta de
  conexiones — el límite de 16 solo acota cuántas conexiones quedan *idle*
  reutilizables, no cuántas pueden abrirse en total.
- Es estado de proceso (`static AiEngineConnPool inst`), no persistente ni
  compartido entre réplicas del backend — coherente con que `ai_engine` hoy
  se despliega como un único sidecar por instancia de backend.
- No se agregó métrica de hit-rate del pool (cuántos POST reusan una
  conexión vs. abren una nueva) — candidato razonable para una futura pasada
  de observabilidad si el volumen de capturas crece lo suficiente para
  justificarlo.

## Alternativas descartadas

- **`io_context` compartido entre hilos con `strand`**: más eficiente en
  teoría, pero introduce una superficie de sincronización mayor para un
  beneficio marginal dado el volumen actual de capturas concurrentes — se
  prefirió el modelo más simple de "un `io_context` por conexión pooled".
- **Cliente HTTP de mayor nivel con pooling incorporado** (p.ej. una librería
  de terceros): habría sido una dependencia nueva solo para un problema que
  Boost.Beast (ya en el árbol) resuelve con ~70 líneas de código propio,
  auditable y sin sorpresas de comportamiento.
- **No poolear y aceptar el overhead**: descartado porque el propio hot path
  ya estaba bajo escrutinio por otros hallazgos de latencia de esta misma
  sesión (ADR-100, límite de hilos de onnxruntime) — el handshake TCP
  repetido era la pieza de overhead de transporte que quedaba sin atacar.

## Referencias

- `backend/src/biometric/ai_engine_conn_pool.hpp` (nuevo)
- `backend/src/biometric/ai_engine_client.cpp` (`sendPooledAiEnginePost`,
  `makeFreshAiConn`, `analyzeFrameWithAiEngine`)
- `backend/src/db/pg_pool.hpp` — mismo problema resuelto antes para Postgres,
  precedente de diseño
- ADR-098 (aislamiento de sesión de captura biométrica), ADR-100
  (límite de hilos onnxruntime) — mismo hot path
