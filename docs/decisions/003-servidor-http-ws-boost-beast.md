# ADR-003 — Servidor HTTP/WS con Boost.Beast + Asio (C++20)

**Status**: implemented (verificado 2026-07-06: `CMAKE_CXX_STANDARD 20`; `connection_pool.cpp` usa `websocket::stream`/`async_accept`/`async_read`; `mining_gateway.cpp` usa Asio SSL/TLS + `async_read_until`)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: core-iot

## Contexto

El gateway (ADR-002) debe sostener telemetría en tiempo real de hasta 10.000 sensores simultáneos vía WebSocket, con TLS, y un presupuesto de latencia agresivo (<20 ms local). Necesita I/O asíncrono de alto rendimiento y control fino del ciclo de vida de miles de conexiones WS. El código existente ya usa Boost.Beast/Asio con un pool de conexiones de hasta 15k (`server/connection_pool.cpp`, `websocket_session.hpp`).

## Decisión

El servidor HTTP/WebSocket se construye sobre **Boost.Beast + Boost.Asio (C++20)**, con serialización vía **Boost.JSON** y TLS vía **OpenSSL**. El modelo es asíncrono (proactor de Asio), con un pool de sesiones WS (`connection_pool`) dimensionado para ~15k conexiones.

### Reglas duras
- I/O no bloqueante en el hot path; nada que bloquee el event loop (trabajo pesado se delega a sidecars o thread pools).
- El pool de conexiones WS es la unidad de gestión de lifecycle; su tamaño es configurable (`PG_POOL_SIZE` y equivalentes por env).
- La serialización JSON usa Boost.JSON; en hot paths de ingesta se evalúa simdjson/FlatBuffers en hardening (ver ADR-008).

## Consecuencias

### Positivas
- Control total del modelo async y del lifecycle WS sin overhead de framework.
- Cero dependencias de un framework de terceros que limite el tuning a 10k.
- Reutiliza el código ya probado de `Referencias/backend`.

### Negativas / Trade-offs
- Boost.Beast es de bajo nivel: más código propio (routing, parsing) que un framework. Mitigado: ya está escrito y modularizado.
- Curva de aprendizaje alta para nuevos devs — se cubre con runbooks y el ADR de optimización.

### Neutras
- Ata el backend a C++20 y a la disponibilidad de Boost en el toolchain (vcpkg/CMake presets ya configurados).

## Alternativas descartadas

### Frameworks C++ (Drogon, Crow, oatpp)
Más productivos (routing declarativo, ORM), pero introducen abstracciones que estorban el control fino de WS a 10k y agregan dependencia. Se descartan por la ruta crítica de telemetría.

### Stack no-C++ (Go/Rust/Node) para el gateway
Go/Rust serían viables en rendimiento, pero el núcleo de tiempo real, visión (OpenCV) e ingesta ya está en C++ y el equipo BE1 es C++; reescribir el gateway rompería la coherencia y la ruta crítica.

## Referencias
- `Referencias/backend/src/server/connection_pool.cpp`, `src/websocket_session.hpp`
- `Referencias/backend/CMakeLists.txt`, `CMakePresets.json`
- `Referencias/docs/02_Arquitectura/Optimizacion_TiempoReal_CPP_AURIXA_v36.md`
- ADR-002 (gateway), ADR-007 (ingesta), ADR-008 (bus de eventos)
