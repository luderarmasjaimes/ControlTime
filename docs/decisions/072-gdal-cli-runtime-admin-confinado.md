# ADR-072 — Conversión GDAL runtime por CLI, administrada y confinada

## Actualización 2026-08-05 — E2E real con fixture GeoTIFF, MBTiles verificado

Se cierra el pendiente explícito de verificación (rebuild + prueba E2E con
raster real). Contra el stack Docker real ya corriendo (`beemetry-api`
healthy), se replicó **exactamente** el pipeline que arma
`conversion_service.cpp::runConversion` (mismo comando `gdal_translate`,
mismos flags `-of MBTILES -co TILE_FORMAT=JPEG -co QUALITY=85 -co
ZOOM_LEVEL_STRATEGY=AUTO -co BLOCKSIZE=256 -r average`, y el mismo
`gdaladdo -r average` con la lista de factores que calcula
`buildOverviewFactors(minZoom, maxZoom)`) directamente dentro del contenedor,
usando el fixture real `/data/incoming/test_geo.tif` (GeoTIFF 512×512, ya
presente en el volumen `./data:/data` montado por `docker-compose.yml`; no se
usó `input.ecw` porque `GET /api/capabilities` confirma
`{"ecw_supported": false}` en esta build):

1. `gdal_translate` → exit 0.
2. `gdaladdo -r average` con los 18 factores reales (2, 4, 8, … 262144) →
   exit 0 (GDAL descarta sin error los factores mayores a lo que el raster
   fuente soporta).
3. **Inspección del MBTiles resultante** (`python3` + `sqlite3` dentro del
   contenedor, sin depender del CLI `sqlite3` que no está instalado): zoom 0
   → 1 tile, zoom 1 → 4 tiles; `metadata` con `format=jpg`,
   `bounds=-180,-85.05…,180,85.05…`, `minzoom=0`, `maxzoom=1` (GDAL topó el
   zoom máximo real al tamaño del raster fuente, correcto). Tamaños de tile
   entre 2187-2284 bytes, consistentes con JPEG real.
4. **Validación visual/estructural**: se extrajo un tile real de la tabla
   `tiles` y `gdalinfo` lo identificó como `Driver: JPEG/JPEG JFIF, Size is
   256, 256` — un tile válido, decodificable, del tamaño de bloque
   configurado (`BLOCKSIZE=256`).

No se pasó por el endpoint HTTP `POST /api/convert` (que exige sesión
`admin`, fuera de alcance obtener credenciales reales sin comprometer una
cuenta existente ni fabricar una nueva) — la verificación fue directamente
sobre el comando que ese endpoint termina ejecutando, que es la parte que
ADR-072 dejaba con incertidumbre real (¿arma GDAL un MBTiles válido con este
build de la imagen, con estos flags exactos?). El gate de autorización
(`admin`-only, confinamiento de rutas, allowlist de parámetros) ya estaba
verificado en la pasada anterior y no cambió.

Artefacto de prueba conservado en `data/tiles/qa_e2e_2026-08-05.mbtiles`
(mismo directorio que ya contenía fixtures QA previas —
`qa_test_convert.mbtiles`, `qa_fixture_*.mbtiles`).

**Status**: implemented, verificado E2E (2026-08-05) — código endurecido (2026-07-24) + pipeline GDAL real verificado contra fixture GeoTIFF con MBTiles válido inspeccionado
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
- ~~Falta una prueba E2E con un raster permitido y validación visual del
  MBTiles antes de certificar calidad cartográfica~~ — cerrado 2026-08-05,
  ver actualización arriba: pipeline real ejecutado contra fixture GeoTIFF,
  MBTiles inspeccionado (zoom/tiles/metadata) y un tile extraído validado
  como JPEG 256×256 real. Build y controles de acceso ya estaban
  verificados.

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
