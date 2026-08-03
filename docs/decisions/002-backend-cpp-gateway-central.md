# ADR-002 — Backend C++ como gateway central

**Status**: implemented (verificado 2026-07-06: `frontend/nginx.conf` enruta todo `/api/` exclusivamente a `backend:8081`; `formula_engine`/`ai_engine` solo son accesibles internamente, nunca expuestos directo al cliente)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

> Refinado por ADR-031: el gateway no es el backend de una app de reportes, es el backbone de
> una **plataforma compartida** que sirve a múltiples componentes.

## Contexto

El sistema tiene servicios heterogéneos: telemetría en tiempo real (10k sensores), edición documental, IA (LLM, corrección, CV), cartografía y conversión raster. Hay dos formas de articularlos: que el frontend hable directo con cada servicio, o que un componente central los orqueste, autentique y proxee. El código de `Referencias/backend` ya implementa lo segundo: un backend C++ que concentra auth, ruteo y proxy a los servicios satélite (`formula` 8020, `ai_engine` 5000, `languagetool` 8010, `tileserver` 8000).

## Decisión

El **backend C++ es el gateway central** y único punto de entrada autenticado del sistema. Centraliza: terminación TLS, autenticación/sesión (JWT), RBAC, ruteo (`http/router.cpp`), proxy a los sidecars, e ingesta de telemetría. El frontend nunca habla directo con un sidecar; siempre pasa por el gateway. Los sidecars no se exponen a la red pública.

### Reglas duras
- Todo endpoint público pasa por el router del gateway y por el middleware de auth (`security/api_auth.cpp`).
- Los sidecars (Python, Ollama, LanguageTool, tileserver) escuchan solo en la red interna de Docker.
- El gateway es responsable de la auditoría transversal de accesos (ver ADR-030).

## Consecuencias

### Positivas
- Un solo lugar para seguridad, auth y auditoría = superficie de ataque y trazabilidad controladas.
- Soberanía: ningún sidecar queda expuesto; el gateway media todo.
- El hot path de telemetría vive en C++ (ver ADR-003, ADR-004).

### Negativas / Trade-offs
- El gateway es un single point of failure y un cuello potencial — se mitiga con pool de conexiones, diseño async (ADR-003) y, en hardening, réplicas tras Nginx.
- Acoplamiento de responsabilidades en un servicio — mitigado por la modularización ya hecha (`src/auth`, `src/mining`, `src/reports`, etc.).

### Neutras
- Requiere disciplina para no convertir el gateway en un monolito; los sidecars absorben lo pesado (IA/CV/raster).

## Alternativas descartadas

### Frontend hablando directo a cada servicio
Menos saltos, pero multiplica la superficie de auth y expone sidecars. Incompatible con auditoría 100% y soberanía.

### API gateway dedicado (Kong / Nginx+ / Traefik)
Maduro y configurable, pero agrega un componente más, no resuelve la lógica de negocio (sesión biométrica latente, proxy con transformación) y suma latencia. El control fino de WS a 10k pesa a favor del gateway propio en C++.

## Referencias
- `Referencias/backend/src/http/router.cpp`, `src/main.cpp`
- `Referencias/docs/02_Arquitectura/BACKEND_DISENO_ARQUITECTURA.md`
- ADR-003 (Boost.Beast), ADR-004 (políglota), ADR-030 (auditoría)
