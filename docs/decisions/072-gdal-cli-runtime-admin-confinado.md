# ADR-072 — Conversión GDAL runtime por CLI, administrada y confinada

**Status**: partial; código endurecido, fixture raster y rebuild final pendientes (2026-07-24)
**Fecha**: 2026-07-24
**Autores**: EC
**Ámbito**: geo
**Supersedes**: ADR-028 (`gdal-conversion-raster-diferida`)

## Contexto

ADR-028 difería la conversión y prohibía endpoints on-demand, pero el código
actual ya instala GDAL CLI, expone `/api/convert` y ejecuta
`gdal_translate`/`gdaladdo` en un job de fondo. La implementación previa
aceptaba algoritmos interpolados en shell, rutas arbitrarias y permitía
consultar jobs sin sesión: no podía documentarse como producción.

## Decisión

Se acepta para v0.1 el **subprocess GDAL CLI robustecido**, sin enlazar
`libgdal` y sin crear todavía un worker separado:

- `POST /api/convert` es solo para rol `admin`;
- `POST /api/analyze-core` también exige `admin`, extensión de imagen
  permitida y confinamiento al data root; los assets demo exigen sesión;
- entradas limitadas a ECW/GeoTIFF existentes dentro de
  `BEEMETRY_MAPAS_DATA_ROOT`;
- salidas obligatorias dentro de `<dataRoot>/tiles`;
- compresión (`JPEG|PNG`) y remuestreo se validan por allowlist;
- cada job guarda propietario/tenant y `GET /api/jobs/{id}` exige sesión y
  ownership (admin puede auditar);
- rutas se normalizan y confinan antes de abrir un hilo.

El endpoint de capacidades puede ser público porque no procesa archivos ni
revela datos de tenant. Los jobs siguen en memoria y se pierden al reiniciar;
es una limitación aceptada de v0.1, no un sistema de colas durable.

## Consecuencias

- Resuelve la contradicción real con ADR-028 sin fingir que la función sigue
  diferida.
- Se evita inyección de comandos y lectura/escritura fuera del volumen
  cartográfico.
- El proceso comparte CPU/RAM con el gateway; para volumen concurrente se
  requiere un worker/cola y un ADR posterior.
- Falta una prueba E2E con un raster permitido y validación visual del
  MBTiles antes de certificar calidad cartográfica; build y controles de
  acceso sí están verificados.

## Alternativas descartadas

- **Mantener ADR-028 como vigente**: contradice el runtime real.
- **Enlazar libgdal ahora**: mayor superficie de build sin necesidad medida.
- **Permitir rutas libres a usuarios autenticados**: viola seguridad y
  multitenancy.
- **Declarar la conversión completamente certificada sin fixture**: no hay
  evidencia visual suficiente.

## Evidencia y referencias

- `backend/src/gdal/conversion_service.cpp`, `gdal_routes.cpp`
- `backend/Dockerfile` (`gdal-bin`)
- Build de imagen `web`: OK tras el primer endurecimiento (2026-07-24).
  Después se agregó confinamiento equivalente a `analyze-core` y auth a
  assets demo; el rebuild final no pudo ejecutarse porque Docker Desktop dejó
  de responder. Verificación E2E de conversión: pendiente de fixture
  ECW/GeoTIFF autorizado.
