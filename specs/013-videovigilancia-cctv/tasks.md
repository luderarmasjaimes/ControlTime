# TASKS 013 — Videovigilancia (muro CCTV)

| Campo | Valor |
|---|---|
| **Plan** | `specs/013-videovigilancia-cctv/plan.md` |
| **Sprint·Release** | Etapa 2 (S9-S10) |
| **Responsables** | BE1 (routes/C++), SYS (cámaras/red), FE1 (muro frontend), QA |
| **Última revisión** | 2026-06-24 v2 (T6+T7+T17 implementados — CRUD cámaras completo) |

---

## Backlog de tareas (revisado contra código real)

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado | Notas auditoría |
|---|---|---|---|---|---|---|
| **T1** | Schema SQL: `surveillance_cameras` (id, name, location, rtmp_url, status, lat, lng, tenant_id) | CA-1,CA-3 | BE3 | Haiku | ✅ | Implementado |
| **T2** | `surveillance_camera_snapshot.py`: conecta URL HTTP/HTTPS → frame → JPEG | CA-2 | ML/BE1 | Sonnet | ✅ | Script externo vía `SURVEILLANCE_SNAPSHOT_SCRIPT` |
| **T3** | `handleGetCameras`: SELECT con scope `?tenant_id=` (requiere auth si scoped) | CA-1,CA-3 | BE1 | Sonnet | ✅ | Implementado; ⚠️ sin validación JWT en modo unscoped |
| **T4** | `handleCameraSnapshot`: auth + SELECT rtmp_url + validar HTTP/HTTPS + exec script | CA-2,CA-4 | BE1 | Sonnet | ✅ | Implementado; solo acepta http:// o https:// |
| **T5** | Placeholder JPEG si script falla o no existe | CA-4 | BE1 | Haiku | ✅ | JPEG 1×1 gris embebido (331 B, JFIF estándar) + env `SURVEILLANCE_OFFLINE_PLACEHOLDER` |
| **T6** | `POST /api/surveillance/cameras` — registrar cámara | CA-1 | BE1 | Haiku | ✅ | `handleCreateCamera`: auth + INSERT + RETURNING, tenant desde sesión |
| **T7** | `PUT /api/surveillance/cameras/{id}` — actualizar URL/estado | CA-1 | BE1 | Haiku | ✅ | `handleUpdateCamera`: SET dinámico, scope por tenant_id (ownership) |
| **T17** | `DELETE /api/surveillance/cameras/{id}` — eliminar cámara | CA-1 | BE1 | Haiku | ✅ | `handleDeleteCamera`: verifica tenant, 404 si no encontrada |
| **T8** | Seed de cámaras de prueba en `db_init/` | dev/test | BE3 | Haiku | ✅ | Seed existe para datos de demo |
| **T9** | Frontend: grid CCTV (16 cámaras, refresh configurable) | CA-5 | FE1 | Sonnet/ChatGPT | ☐ | Pendiente |
| **T10** | Frontend: indicador de cámara offline (placeholder + timestamp) | CA-4 | FE1 | Sonnet | ☐ | Pendiente |
| **T11** | **Test CA-1**: `GET /cameras` → lista con estado/lat/lng | CA-1 | QA | — | ✅ | Validado |
| **T12** | **Test CA-2**: `GET /camera-snapshot` → JPEG > 64 bytes | CA-2 | QA | — | ✅ | Validado con URL HTTP de prueba |
| **T13** | **Test CA-3**: empresa A no ve cámaras de empresa B | CA-3 | QA | — | ✅ | Validado |
| **T14** | **Test CA-4**: URL rtmp:// en BD → error `stream_url_not_http` | CA-4 | QA | — | ✅ | Validado (código retorna 400) |
| **T15** | Integración visión EPP (spec 017) — snapshot pasa por pipeline EPP | 017 | ML | **Opus** | ☐ | Etapa 2 |
| **T16** | Timeout explícito para script Python (`SURVEILLANCE_SNAPSHOT_TIMEOUT_S`, default 15 s) | resiliencia | BE1 | Sonnet | ✅ | `timeout N python3 script.py` en Linux; env var configurable |

> **Nota de auditoría 2026-06-24 v1:** T6/T7 no estaban implementados; solo GET.
>
> **Implementación 2026-06-24 v2:**
> - T6: `handleCreateCamera` en `surveillance_service.cpp` — POST con auth, INSERT con
>   tenant_id desde sesión (fallback a body si file-mode), RETURNING nuevo registro.
> - T7: `handleUpdateCamera` — prefix route `/api/surveillance/cameras/` → extrae ID
>   del path, SET dinámico (solo campos presentes en body), scope por tenant_id.
> - T17 (nuevo): `handleDeleteCamera` — DELETE con verificación de ownership por
>   tenant_id; retorna 404 si no existe o no pertenece al tenant.
> - Routes registradas en `mining_routes.cpp`: POST exact, PUT/DELETE prefix route.
>
> T5 (placeholder JPEG) y T16 (timeout Python) implementados 2026-06-24 v3.

---

## Secuencia

```
T1 ─► T3 ─► T11              (schema → lista → test)
T2 ─► T4 ─► T12 ─► T14      (script → snapshot → tests)
T8                             (seed datos demo)
T5, T16 (resiliencia — pendiente)
T6, T7 (CRUD admin — pendiente)
T9, T10 (frontend — pendiente)
T13 (test multitenant ✅)
T15 (EPP, Etapa 2)
```

---

## Definition of Done

- [x] T1-T4, T8, T11-T14 implementadas y validadas.
- [x] CA-1 (lista cámaras), CA-2 (snapshot JPEG), CA-3 (multitenant).
- [x] CA-4 parcial: rtmp:// rechazado; falta placeholder para error general.
- [x] T5 — placeholder JPEG: JFIF 1×1 gris embebido como fallback + `SURVEILLANCE_OFFLINE_PLACEHOLDER` para imagen personalizable (implementado 2026-06-24).
- [x] T6-T7-T17 — CRUD de cámaras (POST/PUT/DELETE) — implementado 2026-06-24.
- [ ] T9-T10 — frontend grid (grid/offline existen en `VideoDiagram.tsx` con datos reales, pero sin auto-refresh configurable ni timestamp explícito por cámara — no se marca por no cumplir la redacción literal de la tarea, ver auditoría 2026-08-30).
- [x] T16 — timeout Python: contradicción interna del propio archivo corregida — la tabla de arriba y la nota "T5/T16 implementados 2026-06-24 v3" ya lo daban por hecho (`SURVEILLANCE_SNAPSHOT_TIMEOUT_S`, `timeout N python3 script.py`); solo este checklist quedó desactualizado.
- [ ] T15 — integración EPP (Etapa 2).

---

## Modelo de IA usado (Art. 7)

| Task | Modelo | Justificación |
|---|---|---|
| T4 (snapshot + validación URL + I/O temp) | Sonnet | C++ estándar con syscalls |
| T2 (script Python OpenCV) | Sonnet | Python estándar |
| T15 (integración EPP) | **Opus** | Vision pipeline complejo |
| T1, T3, T8 (schema, routes simples) | Haiku | SQL/C++ CRUD |
