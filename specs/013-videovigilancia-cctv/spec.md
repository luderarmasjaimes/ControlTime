# SPEC 013 — Videovigilancia (muro CCTV)

| Campo | Valor |
|---|---|
| **ID** | 013 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | Seguridad visual / monitoreo (Etapa 2, S9-S10) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (seguridad), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (auditado contra `surveillance_service.cpp`) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-013**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
La operación minera requiere un muro de cámaras (CCTV) integrado a la plataforma,
aislado por empresa, con imágenes bajo demanda sin costo de streaming continuo.

## 2. Objetivo
Listado de cámaras por empresa y captura de snapshots en vivo, render tipo muro
CCTV, sin video streaming continuo (costo O(cámaras) vs O(bitrate × N)).

## 3. Usuarios y contexto
- **Roles:** operador de seguridad, supervisor. **Multitenant:** catálogo de
  cámaras aislado por `tenant_id` (empresa minera).
- **Script externo:** el snapshot se captura invocando `surveillance_camera_snapshot.py`
  (ruta configurable en `SURVEILLANCE_SNAPSHOT_SCRIPT`), que conecta a la URL HTTP/HTTPS
  de la cámara y extrae un frame JPEG.
- **Restricción de URL:** el backend solo acepta URLs `http://` o `https://` para
  snapshots. URLs `rtmp://` o `rtsp://` almacenadas en el campo `rtmp_url` son
  rechazadas con error hasta que se implemente soporte RTMP directo.

## 4. Alcance
**Incluye:** catálogo de cámaras (`GET`), snapshot bajo demanda (auth requerida),
scoping multitenant. **NO incluye:** grabación continua, streaming en tiempo real,
analítica de video (visión EPP → spec 017).

## 5. Criterios de aceptación
- [x] **CA-1:** `GET /api/surveillance/cameras` lista cámaras del tenant con id/name/lat/lng/status.
- [x] **CA-2:** `GET /api/surveillance/camera-snapshot?camera_id=N&tenant_id=X` devuelve imagen JPEG > 64 bytes.
- [x] **CA-3:** (multitenant) Token empresa A retorna solo cámaras de empresa A.
- [ ] **CA-4:** El muro CCTV muestra JPEG placeholder si una cámara no responde (degradación graceful).
- [ ] **CA-5:** Grid frontend: N cámaras sin freezar el browser.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Snapshot URL | Solo HTTP/HTTPS (no RTMP/RTSP directo sin script adaptado) |
| Auth en snapshots | Requerida (`resolveAuthSession`) |
| Timeout de snapshot | Script Python debe terminar en < 5 s (pendiente T16) |
| Multitenant | `tenant_id` UUID como FK en `surveillance_cameras` |

## 7. Contratos (endpoints reales)
- `GET /api/surveillance/cameras[?tenant_id=UUID]` — lista cámaras
- `GET /api/surveillance/camera-snapshot?camera_id=N&tenant_id=X` — JPEG raw
- Var: `SURVEILLANCE_SNAPSHOT_SCRIPT` (default: `/app/scripts/surveillance_camera_snapshot.py`)

## 8. Riesgos
| Riesgo | Estado | Mitigación |
|---|---|---|
| Cámara inaccesible | ⚠️ retorna 502 actualmente | Implementar placeholder JPEG (T5) |
| Script Python sin timeout | ⚠️ bloquea hilo indefinidamente | Añadir timeout con subprocess (T16) |
| URL injection vía rtmp_url | ✅ mitigado | Validación HTTP/HTTPS en handler |
| IDOR en /cameras sin auth | ⚠️ scope sin validar JWT | Validar sesión antes de scope (T3 mejora) |
