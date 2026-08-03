# TASKS 014 — Modo offline con reconciliación

| Campo | Valor |
|---|---|
| **Plan** | `specs/014-modo-offline-reconciliacion/plan.md` |
| **Sprint·Release** | S8 · R4 (FIN Etapa 1) |
| **Responsables** | BE1 (API sync), BE3 (modelo/DB), FE1 (outbox/SW), FE2 (UX offline), QA |
| **Última revisión** | 2026-06-24 (plan y tasks revisados — todo ☐ pendiente, Sprint S8) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Migración SQL: `sync_operations` + columna `version` en tablas de negocio | CA-2,CA-3 | BE3 | Sonnet/Haiku | ☐ |
| **T2** | Endpoint `POST /api/sync` — recepción de lote, validación, auth+tenant de sesión | CA-1,CA-4 | BE1 | **Opus** (concurrencia/TX) | ☐ |
| **T3** | Idempotencia: dedup por `op_id` (insert-or-skip en `sync_operations`) | CA-2 | BE1 | **Opus** | ☐ |
| **T4** | Aplicación atómica por operación (TX individual) + incremento de `version` | CA-2 | BE1 | **Opus** | ☐ |
| **T5** | Resolución de conflicto por entidad (server-wins+rama / append / rechazo) | CA-3 | BE1+BE3 | **Opus** | ☐ |
| **T6** | Auditoría de cada sync y resolución (`result`,`resolution`) | CA-3,Art.6 | BE1 | Sonnet | ☐ |
| **T7** | Cliente `OutboxStore` (IndexedDB): encolar/persistir operaciones | CA-1 | FE1 | Sonnet | ☐ |
| **T8** | Cliente `SyncEngine` (Service Worker + Background Sync + fallback online) | CA-1 | FE1 | Sonnet/Opus | ☐ |
| **T9** | Backoff exponencial + jitter + tope de reintentos (sin descartar) | CA-2 | FE1 | Sonnet | ☐ |
| **T10** | UX offline: indicador de estado, cola pendiente, resolución de conflicto al usuario | CA-1,CA-3 | FE2 | Sonnet/ChatGPT | ☐ |
| **T11** | Feature flag `OFFLINE_SYNC_ENABLED` + versionado del Service Worker | despliegue | FE1/SYS | Haiku | ☐ |
| **T12** | Retención de `sync_operations` (archivar a frío 003 > 90 días) | Art.9 | BE3 | Haiku | ☐ |
| **T13** | **Pruebas** de cada CA (ver plan §9), incl. edge cases | todas | QA | Sonnet | ☐ |
| **T14** | Demo gate R4: editar sin internet → reconectar → sync sin pérdida | CA-5 | QA+ARQ | — | ☐ |
| **T15** | Manual operativo: cómo opera el modo offline + runbook de soporte | Art.8 | PAF | ChatGPT/Haiku | ☐ |

## Secuencia recomendada (dependencias)
```
T1 ─► T2 ─► T3 ─► T4 ─► T5 ─► T6        (servidor: base → idempotencia → conflicto → auditoría)
T1 ─► T7 ─► T8 ─► T9 ─► T10             (cliente: outbox → sync → UX)
(T2..T10) ─► T13 (pruebas) ─► T14 (demo R4)
T11, T12, T15 en paralelo
```

## Definition of Done (feature 014)
- [ ] T1-T15 cerradas y enlazadas a commits/PR.
- [ ] **Cada CA del spec demostrado con evidencia** (plan §9):
  - [ ] CA-1 outbox persistente offline
  - [ ] CA-2 sin pérdida (1.000/1.000) y **sin duplicar** (reenvío doble = `duplicate`)
  - [ ] CA-3 conflicto resuelto + rama recuperable + auditado
  - [ ] CA-4 aislamiento multitenant
  - [ ] CA-5 demo R4 reproducible
- [ ] ADR-014-1..5 registrados (decisiones irreversibles).
- [ ] Sin violar Constitución (Art. 1, 2, 6, 9).
- [ ] Retención y feature flag operativos.

## Estimación gruesa
| Bloque | Esfuerzo aprox. |
|---|---|
| Servidor (T1-T6) | 5-7 d (BE1+BE3) |
| Cliente (T7-T11) | 5-7 d (FE1+FE2) |
| Pruebas + demo (T13-T14) | 3 d (QA+ARQ) |
| Docs (T15) | 1 d (PAF) |
