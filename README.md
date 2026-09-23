# Beemetry — Plataforma Minera IoT (antes AURIXA)

Software minero empresarial: telemetría en tiempo real, alarmas, mapas/GIS,
biometría de acceso, generación de informes (ReportStudio) y motor de
fórmulas por sensor, para operaciones mineras en Perú/LATAM. Backend propio
en C++ (reemplaza a ThingsBoard, ver ADR-034), frontend React/TypeScript,
Postgres/TimescaleDB, y una decena de sidecars especializados (biometría,
avatares, exportación de documentos, motor de fórmulas legado, etc.).

> Este repositorio también contuvo, en una etapa temprana y ya descartada, un
> prototipo distinto (conversión satelital ECW→MBTiles). Ese código sigue en
> `ecw-plugin/`/`scripts/*ecw*` por si algún día se retoma, pero **no forma
> parte del stack actual** (no está referenciado en `docker-compose.yml`) — no
> lo uses como punto de partida para entender el proyecto.

## Empieza por acá

| Documento | Para qué |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Metodología de desarrollo (ADR + SPEC + Router + RAG + CI) — instalación del portal de IA multi-agente |
| [`docs/decisions/README.md`](docs/decisions/README.md) | **Fuente de verdad del proyecto**: índice de los ~188 ADR (decisiones de arquitectura), agrupados por ámbito |
| [`specs/README.md`](specs/README.md) | Metodología SDD (Spec → Plan → Tasks → Implement → Verify) y catálogo de especificaciones (`specs/NNN-*`) |
| [`docs/GUIA_IMPLEMENTACION_FRONTEND.md`](docs/GUIA_IMPLEMENTACION_FRONTEND.md) | Guía de onboarding para quien vaya a tocar `frontend/`: reglas arquitectónicas, catálogo de ADR frontend-relevantes, gotchas de seguridad ya corregidos |

> Regla del proyecto (ver `docs/decisions/README.md`, línea 3): **una decisión
> arquitectónica sin ADR no existe.** Cualquier cambio de arquitectura nuevo
> se documenta ahí antes/junto con el código, no después.

## Estructura del repositorio

- `backend/` — API C++ (Boost.Beast/Asio), motor de telemetría, alarmas,
  fórmulas, autenticación, reportes.
- `frontend/` — SPA React + TypeScript + Vite (ver la guía de arriba).
- `db_scripts/` — migraciones SQL numeradas, aplicadas en orden.
- `formula_engine/` — sidecar del motor de fórmulas legado (ADR-187/188).
- `ai_engine/`, `avatar_engine/`, `avatar_animation_engine/`, `silentface_engine/` —
  sidecars de biometría/avatar (Python/C++), cada uno con su propio Dockerfile.
- `pdf-export-service/` — export server-side de informes (Chromium headless).
- `specs/` — especificaciones formales (SDD) por funcionalidad.
- `docs/decisions/` — el log de ADR (canónico, único, cronológico).
- `docs/` (resto) — guías e informes puntuales (accesibilidad, cortes de
  proyecto, pruebas de capacidad).
- `docs_/` (con guion bajo — **no confundir con `docs/`**) — material de
  gestión/comercial (SOW, cronogramas, informes gerenciales); no es
  documentación técnica de desarrollo.
- `db_scripts/`, `docker-compose.yml`, `.env.example` — orquestación completa
  del stack.

## Levantar el stack

```bash
cp .env.example .env   # completar los secretos marcados como obligatorios
docker compose up -d --build
```

Son ~20 servicios (backend, frontend, Postgres + réplica + PgBouncer,
Redpanda, MinIO, MQTT, y los sidecars de IA/biometría/export). Para levantar
solo el frontend tras un cambio de código:

```bash
docker compose up -d --no-deps --build frontend
```

(el contenedor de frontend sirve un build estático vía nginx — no tiene
hot-reload; para desarrollo local con recarga en caliente usa `cd frontend &&
npm run dev`, puerto 5180).

## Convenciones

- Toda decisión de arquitectura nueva → ADR en `docs/decisions/` (numeración
  contígua, sin huecos, campo `Ámbito` obligatorio).
- Todo PR referencia el SPEC que implementa (`specs/NNN-*`).
- Ver `AGENTS.md` para la metodología completa y las herramientas del portal
  de IA (`ai_platform/`).
