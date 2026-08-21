# ADR-120 — Lote de líneas por lectura TLS en `mining-gateway` (reduce writes por sesión)

**Status**: implemented (2026-08-20)

**Fecha**: 2026-08-20

**Ámbito**: core-iot

**Relación**: opera un nivel por debajo de la topología de consumidores/Kafka
que fija ADR-108 (no la modifica); refina la sesión TLS cruda de ADR-003.

## Contexto

`mining_gateway.cpp` implementa el servidor TLS crudo (no HTTP) que reciben
los agregadores de campo de la topología aprobada en ADR-108 (250
agregadores × 100 sensores). Antes de este cambio, `MiningSession::read_line()`
procesaba exactamente **una** línea por evento `async_read_until` y devolvía
un `OK`/`ERR` con un `async_write` propio — un ciclo completo de E/S de red
por cada línea recibida.

Bajo ráfaga (frecuente cuando un agregador entrega varias lecturas juntas en
el mismo paquete TLS), ese patrón desperdiciaba un `async_write` — y su
vuelta por el reactor de Asio — por cada línea, aunque ya hubiera varias
disponibles en el mismo `streambuf`. La suite de capacidad de ADR-108 fijó y
validó la topología de consumidores/particiones/Kafka aguas abajo, pero no
tocó esta capa: la sesión TLS del gateway seguía sirviendo una respuesta por
línea, sin agrupar.

## Decisión

1. `MiningSession::read_line()` ahora, dentro del mismo callback de
   `async_read_until`, consume **todas** las líneas completas ya disponibles
   en el buffer — hasta un límite `max_lines_per_read` (nuevo campo de
   `MiningConfig`, default **256**) — y emite un único `async_write` con las
   respuestas concatenadas (`OK\n`/`ERR\n` por línea, mismo orden de llegada).
2. El protocolo de línea no cambia: sigue siendo texto plano, un `OK`/`ERR`
   por línea recibida, mismo orden. Los agregadores de campo no requieren
   ningún cambio de firmware ni de cliente.
3. `max_lines_per_read` es un tope defensivo, no una espera activa: si el
   buffer solo trae una línea, se responde con una sola línea — no se
   bloquea esperando acumular 256. Sirve para acotar la memoria reservada de
   antemano (`response.reserve(max_lines_per_read * 3)`) y para no
   monopolizar el hilo de E/S con una ráfaga arbitrariamente grande antes de
   devolver el control al `io_context`.
4. Si una línea individual excede `max_line_size`, la sesión corta con
   `ERR payload too large` y cierra — mismo comportamiento de guarda
   preexistente, ahora también aplicado línea por línea dentro del lote.
5. El valor por defecto (256) es una constante de código en `MiningConfig`,
   **no** expuesto todavía por variable de entorno — a diferencia de otros
   parámetros de topología que ADR-108 sí administra por configuración de
   despliegue.

## Consecuencias

- Reduce el número de `async_write` (y su ida/vuelta de E/S) por sesión bajo
  ráfaga, sin cambiar el protocolo de línea ni el contrato de una respuesta
  por línea.
- No sustituye ni modifica la topología de consumidores/particiones de
  ADR-108 — opera una capa más abajo, en la sesión TLS cruda, antes de que la
  línea llegue a `TelemetryIngestor`.
- Introduce una superficie nueva de tuning (`max_lines_per_read`) sin panel
  ni variable de entorno propia — cambiarla hoy exige recompilar.
- Ante un agregador que envíe líneas sin backpressure, el tope de 256 evita
  que una sola sesión acapare el hilo de E/S en una sola pasada, pero no es
  un rate-limit por sesión: el ciclo simplemente se repite en la siguiente
  vuelta de `read_line()`.
- No se repitió la suite de capacidad de ADR-108 después de este cambio —
  la mejora de E/S no tiene todavía una medición de throughput/latencia
  propia, solo la verificación de que el contrato de protocolo se conserva.

## Alternativas descartadas

- **Mantener una respuesta por línea (estado anterior)**: simple, pero
  desperdicia E/S en ráfaga — identificado como superficie de mejora durante
  las pruebas de capacidad de ADR-108, sin ADR propio hasta ahora.
- **Sin límite superior (`max_lines_per_read` ilimitado)**: arriesga
  monopolizar el hilo de E/S del `io_context` con una sesión que reciba una
  ráfaga arbitrariamente grande, degradando el resto de conexiones
  concurrentes del mismo hilo.
- **Exponer `max_lines_per_read` por variable de entorno desde ya**:
  descartado por ahora — no hay evidencia todavía de que 256 sea
  insuficiente para la topología de 25k probada en ADR-108; se prefiere
  agregar el env var cuando exista una necesidad medida, no
  especulativamente.

## Referencias

- `backend/src/mining/mining_gateway.cpp` (`MiningSession::read_line`)
- `backend/src/mining/mining_gateway.hpp` (`MiningConfig::max_lines_per_read`)
- ADR-108 (`capacidad-telemetria-25k-topologia-escalamiento`) — topología de
  consumidores/particiones que este ADR no modifica
- ADR-003 (`servidor-http-ws-boost-beast`) — servidor async base
