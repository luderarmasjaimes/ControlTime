# ADR-033 — Convención de nombres y prefijos (componentes, contenedores, servicios, APIs, DB)

**Status**: partial — reconfirmado 2026-08-08 (auditoría de ADRs abiertos): contenedores/target CMake/`package.json` y las 62 variables de entorno del backend siguen en `beemetry-*`/`BEEMETRY_*` sin regresión. Rename de bases de datos (`sensors_db`→`beemetry_sensors`) y versionado de API (`/api/v1/...`) siguen sin iniciar, tal como se documentó originalmente — decisión deliberada, no olvido; ver razones abajo. (revisado 2026-07-07, junto con la ejecución de ADR-000). Lo compartido con el rebrand de ADR-000 quedó resuelto: los 14 `container_name` → prefijo `beemetry-*` (aunque con nombres más simples que la tabla de este ADR, ver nota abajo), target CMake `mapas_backend` → `beemetry_backend`, `package.json` → `beemetry-frontend`, `PLATFORM_NAME` → `'Beemetry'` sin hardcodear fuera de `platformBrand.config.ts`. Un grep de `aurixa|controltime|mapas_backend` en código/infra activa ahora da 0 (fuera de menciones históricas en `docs/decisions/*.md` y `Referencias/`, que documentan la decisión misma o son material legacy — ambos exentos explícitamente por este mismo ADR y por ADR-000).

**Deliberadamente NO ejecutado en esta pasada** — la tabla completa de este ADR pide bastante más que un prefijo de contenedor, y el resto son cambios de un orden de riesgo distinto, no un ajuste cosmético:
- **Nombres exactos por servicio** (`beemetry-gateway`, `beemetry-timescale-primary`/`-replica`, `beemetry-postgres`, `beemetry-ai`, `beemetry-ollama`, etc., en vez de los `beemetry-api`/`beemetry-db`/`beemetry-db-replica`/`beemetry-ai-vision`/`beemetry-llm` que quedaron aplicados): un bikeshed de nomenclatura más fino, de bajo valor incremental frente al riesgo de un segundo rename de la misma infra ya renombrada en esta misma sesión.
- **Nombre de las bases de datos** (`beemetry_sensors`/`beemetry_ops` en vez de `sensors_db`): esto SÍ es de alto riesgo real — requiere renombrar la DB Postgres en vivo (`ALTER DATABASE` o dump/restore), actualizar cada `DATABASE_URL`/cadena de conexión en `docker-compose.yml` y `app_config.cpp`, y probar que ninguna conexión activa (backend, réplica, pgbouncer, motor de fórmulas) quede apuntando al nombre viejo. Es exactamente la clase de cambio "difícil de revertir, afecta un sistema compartido" que amerita una ventana y pruebas dedicadas, no un cierre apurado al final de una sesión ya larga.
- **Versionado de API** (`/api/v1/...` en vez de `/api/...`): tocaría cada `r.get/post/put/del(...)` de `main.cpp` (decenas de rutas) Y cada llamada `fetch`/`axios` del frontend (decenas de call sites en `lib/api.ts` y otros) — un refactor transversal grande, no incremental, con alto riesgo de romper algo si se apura.
- **Prefijo de variables de entorno** (`BEEMETRY_*` en vez de `MAPAS_*`/`JWT_*`/etc.), **buckets de MinIO** (`beemetry-reports`/`beemetry-assets`/`beemetry-archive` — MinIO ni siquiera tiene buckets creados hoy, ver ADR-009), **topics de Redpanda** (`beemetry.telemetry.*` — Redpanda corre pero la ingesta real vía Kafka es Etapa 2 per ADR-008): todos dependen de trabajo que aún no existe o que tiene su propio ADR marcándolo como Etapa 2; no tiene sentido nombrar algo que no se ha construido.

**Actualización 2026-07-07 (segunda pasada, variables de entorno)**: cerradas
las 62 variables de entorno del backend C++ a prefijo `BEEMETRY_*`
(`backend/src/**/*.cpp`, `entrypoint.sh`, el bloque `environment:` del
servicio `web` en `docker-compose.yml`, y `docker-compose.e2e-verify.yml`).
Deliberadamente EXCLUIDAS de este rename: `OMP_NUM_THREADS`/
`OPENBLAS_NUM_THREADS` — no son variables propias, las consume directamente
la librería OpenMP/OpenBLAS enlazada por su nombre estándar; renombrarlas
las habría dejado sin efecto silenciosamente. También excluidos los env vars
propios de `formula_engine`/`ai_engine`/`pdf_export` (Python/Node, código no
auditado en esta pasada — cambiarles la clave en `docker-compose.yml` sin
tocar su código fuente los habría roto).

**Verificado contra el stack real**: `docker compose build web` con 0
errores; contenedor `beemetry-api` sano tras el redeploy; login real
(requiere `BEEMETRY_DATABASE_URL`), `GET /api/mining/kpis` real (requiere el
mismo o `BEEMETRY_REPLICA_DATABASE_URL`), ingestor de telemetría conectado a
Kafka (`BEEMETRY_KAFKA_BROKERS`/`BEEMETRY_TELEMETRY_INGEST_MODE`), y
`mining_gateway` TLS escuchando en 8443 (`BEEMETRY_MINING_GATEWAY_PORT`/
`BEEMETRY_TLS_CERT_PATH`/`BEEMETRY_TLS_KEY_PATH`) — todos confirmados en los
logs reales del contenedor tras el rename, sin ningún warning de config
faltante.

**Explícitamente diferido, por elección del usuario (no por falta de
análisis)**: el rename de bases de datos (`sensors_db`→`beemetry_sensors`) y
el versionado de API (`/api/v1/...`). Motivo dado: alto riesgo real de
romper algo silenciosamente sin poder verificar en navegador dentro de esta
sesión (decenas de rutas backend + decenas de call sites de `fetch`/`axios`
en el frontend; una sola referencia que se escape no se detecta sin QA
manual). Queda como iniciativa propia si se decide abordarla con ventana de
prueba dedicada.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

> Operacionaliza ADR-000 (rebrand a Beemetry) y ADR-031 (plataforma vs componente).
> Se resume en `plan.md § 7` (convenciones operativas).

## Contexto

El código de `Referencias/` mezcla nombres y estilos: target CMake `mapas_backend`, `package.json` `mining-report-system-frontend`, servicios `aurixa-*`, claves de storage `aurixa_*`, branding hardcodeado. Sin un estándar único, cada componente y contenedor nuevo reintroduce inconsistencia, y la separación plataforma/componente (ADR-031) se vuelve ilegible. Hace falta una convención de nombres y prefijos cerrada.

## Decisión

Adoptamos un esquema de nombres único, con `beemetry` como raíz de marca (minúsculas, **sin versión** en identificadores):

### Contenedores / servicios Docker — `beemetry-<servicio>` (kebab-case)
| Servicio | Nombre |
|---|---|
| Gateway C++ | `beemetry-gateway` |
| TimescaleDB primaria (ingesta) | `beemetry-timescale-primary` |
| TimescaleDB réplica (lectura) | `beemetry-timescale-replica` |
| PostgreSQL operacional | `beemetry-postgres` |
| Motor de fórmulas | `beemetry-formula` |
| Sidecar IA (Python) | `beemetry-ai` |
| LLM local | `beemetry-ollama` |
| Corrección texto | `beemetry-languagetool` |
| Servidor de tiles | `beemetry-tiles` |
| Object storage | `beemetry-minio` |
| Bus de eventos (Etapa 2) | `beemetry-redpanda` |
| Worker raster (futuro) | `beemetry-gis-raster` |
| Frontend / web | `beemetry-web` |

### Backend C++
- Target CMake: `beemetry_backend` (snake_case).
- Módulos por dominio = carpetas snake_case ya existentes (`auth/`, `mining/`, `reports/`, `text/`, …).

### Frontend
- `package.json` name: `beemetry-frontend`.
- Componentes React: PascalCase; carpetas por dominio.
- Marca: única fuente `platformBrand.config.js` → `PLATFORM_NAME = 'Beemetry'` (prohibido hardcodear, ADR-000).

### APIs — versionadas, prefijo plataforma vs componente (alinea ADR-031)
- Formato: `/api/<version>/<scope>/...` con **versión explícita** (`v1`, `v2`, …).
- Servicios de **plataforma**: `/api/v1/platform/*` (auth, perfiles, permisos, telemetría, auditoría).
- Servicios de **componente**: `/api/v1/<componente>/*` → `/api/v1/reports/*`, futuro `/api/v1/realtime/*`.
- Un cambio **breaking** incrementa la versión (`v2`); `v1` se mantiene mientras haya consumidores (soporta múltiples componentes en paralelo, ADR-031).

### Bases de datos y tablas
- DBs: `beemetry_sensors` (Timescale), `beemetry_ops` (operacional/fórmulas).
- Tablas con **prefijo de dominio**: `telemetry_*`, `report_*`, `platform_*` (auditoría/identidad).

### Storage (MinIO) — buckets `beemetry-<uso>`
- `beemetry-reports` (informes exportados), `beemetry-assets` (binarios de informe), `beemetry-archive` (Parquet histórico).

### Variables de entorno — `BEEMETRY_*` (UPPER_SNAKE)
- Ej.: `BEEMETRY_PG_POOL_SIZE`, `BEEMETRY_GATEWAY_PORT`.

### Topics Redpanda (Etapa 2) — `beemetry.telemetry.<tenant>.<zona>`

### Reglas duras
- Prohibido `aurixa*`, `controltime*`, `mapas*` en nombres nuevos (legacy a migrar).
- Prohibido hardcodear el nombre del producto fuera de `platformBrand.config.js`.
- Un grep de `aurixa|controltime|mapas_backend` debe dar 0 en código/infra nuevos (audit de Phase 12).

## Consecuencias

### Positivas
- Nombres predecibles: dado un servicio/tabla/ruta se infiere a qué pertenece (plataforma vs componente).
- Hace legible la arquitectura de ADR-031 en infra y APIs.

### Negativas / Trade-offs
- Renombrado transversal inicial (CMake, package.json, compose, claves de storage) — tarea de Sprint 0.

### Neutras
- Convención editable: si un prefijo no convence, se ajusta en revisión antes de fijar el estándar.

## Alternativas descartadas

### No estandarizar (status quo)
Cada componente/contenedor reintroduce inconsistencia; la separación plataforma/componente se vuelve ilegible. Rechazado.

### Incluir versión en los nombres (`beemetry2-*`)
"2.0" es la etapa de reconstrucción, no parte de la identidad de runtime; meter versión en nombres de servicio/DB envejece mal. Se omite.

## Referencias
- ADR-000 (rebrand), ADR-031 (plataforma vs componente), ADR-005/032 (DBs), ADR-009 (MinIO), ADR-008 (Redpanda)
- `plan.md` § 1 (estructura) y § 7 (convenciones operativas)
