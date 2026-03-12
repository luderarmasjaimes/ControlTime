# Plataforma de procesamiento satelital en tiempo real (ECW -> MBTiles)

Solución base para baja latencia con:

- Backend C++ (`Boost.Asio` + `Boost.Beast` + `OpenCV`) para orquestar conversiones.
- Pipeline de conversión `ECW -> MBTiles` con `GDAL` y parámetros configurables.
- Servidor de tiles dedicado (`mbtileserver`) consumido por frontend web.
- Frontend avanzado con `MapLibre GL JS` y monitoreo de jobs en tiempo real (polling).
- Despliegue Linux usando `Docker Compose`.

## Arquitectura

1. Cliente carga archivo ECW en carpeta compartida `./data/incoming`.
2. Backend recibe parámetros de conversión por API.
3. Backend ejecuta `gdal_translate` + `gdaladdo` y genera MBTiles en `./data/tiles`.
4. `mbtileserver` publica los MBTiles.
5. Frontend consume tiles y superpone capas.

## Estructura

- `backend/`: API C++ y motor de conversión.
- `frontend/`: UI MapLibre + panel de control.
- `data/`: entrada/salida compartida para conversiones y tiles.
- `docker-compose.yml`: orquestación completa Linux.

## Requisitos

- Docker Desktop con backend Linux.
- Para desarrollo local C++ con Visual Studio (CMake):
  - Boost 1.90 en `C:\boost_1_90_0`
  - OpenCV en `C:\opencv`
  - GDAL con soporte ECW (si aplica tu licencia/plugin)

## Levantar en Docker

```bash
docker compose up --build
```

Servicios:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8081`
- Tile server: `http://localhost:8000`

## Flujo de uso rápido

1. Coloca tu archivo en `C:\mapas\data\incoming\input.ecw`.
2. En el frontend:
  - Define `input_path` como `/data/incoming/input.ecw`.
  - Define `output_path` como `/data/incoming/raura_mbtiles3.mbtiles`.
   - Ajusta `min_zoom`, `max_zoom`, `compression`, `quality`.
   - Ejecuta conversión.
3. Al terminar, carga el tileset `raura_mbtiles3` en el frontend.

## Smoke test (una orden)

Para validar toda la plataforma (backend + conversión + tileserver + frontend):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

Este script:

- Levanta contenedores con `docker compose up -d --no-build`.
- Genera imagen de prueba y la georreferencia.
- Ejecuta conversión vía API.
- Verifica publicación de tiles y disponibilidad del frontend.

## API

### `GET /health`

Estado del backend.

### `GET /api/capabilities`

Indica si el runtime tiene soporte ECW disponible:

```json
{
  "ecw_supported": false
}
```

### `POST /api/convert`

Ejemplo:

```json
{
  "input_path": "/data/incoming/imagen.ecw",
  "output_name": "imagen.mbtiles",
  "min_zoom": 0,
  "max_zoom": 18,
  "compression": "JPEG",
  "quality": 85,
  "resampling": "BILINEAR"
}
```

Respuesta:

```json
{
  "job_id": "d7a1f6...",
  "status": "queued"
}
```

### `GET /api/jobs/{job_id}`

Estado y logs del job.

## Tuning inicial de compresión

- `compression=JPEG` + `quality=80..88` para equilibrio tamaño/calidad.
- `max_zoom` realista según GSD, evita sobre-muestreo artificial.
- Pirámides (`gdaladdo`) con `AVERAGE` para visualización rápida.
- Para datos con bordes nítidos/cartografía, evaluar `PNG` (más pesado).

## Notas ECW

La lectura ECW en GDAL depende del driver/plugin y licenciamiento. Si el contenedor no abre ECW, usa:

- Imagen Docker con GDAL + ECW plugin compatible.
- Conversión previa a GeoTIFF/COG en un entorno con driver ECW habilitado.

### Montaje de plugin ECW en este proyecto

1. Copia binarios del plugin ECW Linux en `ecw-plugin/`.
2. Reinicia backend:

```bash
docker compose up -d --build backend
```

3. Verifica capacidades:

```bash
curl http://localhost:8081/api/capabilities
```

Si devuelve `ecw_supported: true`, ya puedes convertir `input.ecw` directamente.

### Verificación automática del plugin ECW

Ejecuta:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-ecw.ps1
```

Este chequeo valida:

- Presencia de binarios ECW en `ecw-plugin/`.
- Montaje en `/opt/ecw` dentro del contenedor.
- Dependencias dinámicas con `ldd`.
- Drivers detectados por `gdalinfo --formats`.
- Lectura de `input.ecw` y estado de `/api/capabilities`.

### Prueba final ECW (cuando el SDK ya esté instalado)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-ecw-now.ps1
```

Ejecuta la conversión con rutas fijas:

- Input: `/data/incoming/input.ecw`
- Output: `/data/incoming/raura_mbtiles3.mbtiles`

y valida que tileserver/frontend respondan correctamente.

## Instalación ECW en Windows (sin admin) y conversión host

Si no tienes plugin ECW en Linux Docker, puedes convertir en host Windows:

1) Instalar GDAL + ECW SDK en tu perfil:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-ecw-sdk-host.ps1
```

2) Convertir `input.ecw` -> `raura_mbtiles3.mbtiles` y publicar en tileserver:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\convert-ecw-host.ps1
```

3) Ejecutar regresión completa (servicios + smoke + ECW host):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\regression-full.ps1
```

## Autenticación y biometría (Dermalog)

El sistema ahora incluye:

- Login obligatorio con biometría facial o password.
- Control de acceso por rol (`admin`/`operator`).
- Centro de auditoría protegido por backend (solo `admin`).

### Dermalog SDK en Docker (Debian)

1. Define ruta del SDK en host Windows:

```powershell
$env:DERMALOG_SDK_HOST_DIR = 'C:/dermalog/dermalog-face-sdk-deb_6.11.0_amd64'
```

2. Levanta backend:

```powershell
docker-compose up -d --build web
```

3. El contenedor instalará automáticamente los `.deb` desde la carpeta montada y usará el proveedor biométrico `dermalog_cli`.

Ver detalles de contrato del CLI y variables en:

- `backend/DERMALOG_INTEGRATION.md`

