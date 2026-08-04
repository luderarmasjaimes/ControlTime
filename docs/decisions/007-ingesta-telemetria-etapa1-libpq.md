# ADR-007 — Ingesta de telemetría en Etapa 1: gateway TLS C++ + libpq directo

**Status**: implemented (verificado 2026-07-06: `telemetry_ingest.cpp` usa libpq directo (`PQconnectdb`/`PQexec`); `mining_gateway.cpp` acepta TLS en 8443)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: core-iot

## Contexto

La telemetría de sensores entra por un gateway WebSocket TLS en C++ (`mining/mining_gateway.cpp`, `telemetry_ingest.cpp`) y se persiste en `sensors_db`. La meta de 10k sensores/seg es de Etapa 2; en Etapa 1 el foco es el núcleo funcional con simulación de carga (S6). Hay que decidir el mecanismo de ingesta de Etapa 1 sin sobre-construir el pipeline antes de tiempo.

## Decisión

En **Etapa 1**, la ingesta es **directa**: sensores → gateway TLS C++ → persistencia en TimescaleDB vía **libpq** con prepared statements. No se introduce bus de eventos todavía. El gateway valida, normaliza y escribe; la simulación de 10k en S6 valida el diseño funcional. El salto a un bus desacoplado se hace en Etapa 2 (ADR-008).

### Reglas duras
- Inserción con prepared statements / batch; nada de construir SQL por concatenación.
- El gateway aplica back-pressure básico (límite de cola en memoria) para no caer bajo ráfaga.
- El contrato del payload de telemetría se versiona desde Etapa 1 para no romper al migrar al bus.

## Consecuencias

### Positivas
- Mínima complejidad para arrancar el núcleo funcional; menos piezas que operar en Etapa 1.
- Camino claro de evolución a Redpanda sin reescribir el contrato.

### Negativas / Trade-offs
- libpq directo **no escala a 10k/seg sostenido** — explícitamente aceptado: es Etapa 1; la escala real es Etapa 2 con el bus.
- Picos de carga pueden saturar el gateway sin desacople — mitigado con back-pressure y por ser carga simulada en E1.

### Neutras
- Es secuenciamiento, no un dilema: ADR-008 lo continúa.

## Alternativas descartadas

### Redpanda/Kafka desde Etapa 1
Escala mejor, pero agrega un componente complejo (bus, topics, consumidores) antes de tener el núcleo funcional. Se difiere a Etapa 2 (ADR-008) por disciplina de no sobre-construir.

### COPY binario desde Etapa 1
Máximo throughput de escritura, pero su valor se realiza junto al bus y al volumen real; se incorpora en Etapa 2.

## Referencias
- `Referencias/backend/src/mining/telemetry_ingest.cpp`, `mining/mining_gateway.cpp`
- `Referencias/docs/02_Arquitectura/Arquitectura_Solucion_AURIXA_v36.md` § 8.2
- ADR-008 (bus de eventos Etapa 2), ADR-006 (TimescaleDB), ADR-034 (core como plataforma IoT: la ingesta es parte del subsistema multi-protocolo)
