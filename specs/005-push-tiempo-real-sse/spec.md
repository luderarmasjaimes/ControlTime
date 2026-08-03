# SPEC 005 — Push de KPIs en tiempo real (SSE / WebSocket)

| Campo | Valor |
|---|---|
| **ID** | 005 · **Estado** | **Aprobado (retroactivo)** |
| **SOW** | KPI **O1** (< 20 ms / actualización viva), O4 |
| **Constitución** | Art. 3 (lee de réplica), Art. 5 (observabilidad) |
| **Depende de** | 002, 004 |
| **Última revisión** | 2026-06-24 v2 (IDOR corregido — T3+T6 implementados) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-005**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
Los dashboards deben mostrar **datos nuevos conforme entran** sin que el navegador
haga *polling* (que multiplica la carga de la BD y añade latencia). Las
conexiones quedan abiertas permanentemente mientras el dashboard esté activo.

## 2. Objetivo
Empujar (server→cliente) los KPIs por empresa **cada N segundos** sobre una
conexión persistente, leyendo de la réplica, sin polling del cliente.

## 3. Usuarios y contexto
- **Roles:** dashboards de operador/gerencia. **Escala:** decenas de conexiones
  persistentes simultáneas (probado: 20 estables 1 h).

## 4. Alcance
**Incluye:** stream SSE `GET /api/live/kpi?tenant=…` que emite eventos JSON con
KPIs recientes desde la réplica; el cliente usa `EventSource` (reconexión nativa).
**NO incluye:** comandos cliente→servidor (no es bidireccional), histórico (007).

## 5. Criterios de aceptación
- [ ] **CA-1:** Una conexión a `/api/live/kpi?tenant=X` permanece **abierta** y emite un evento cada ≤ 2 s con datos del tenant X.
- [ ] **CA-2:** El stream **lee de la réplica**, no del primario.
- [ ] **CA-3:** (multitenant) El stream filtra estrictamente por `tenant_id` del parámetro.
- [ ] **CA-4:** N conexiones persistentes sobreviven ≥ 1 h sin fugas (probado: 20 conexiones, 12.969 eventos/1 h).
- [ ] **CA-5:** Si el cliente cierra, el servidor libera la conexión y su recurso de BD.
- [ ] **CA-6:** El navegador reconecta automáticamente ante corte de red (EventSource).

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Intervalo de push | configurable (`LIVE_PUSH_INTERVAL_MS`, default 2000) |
| Costo por conexión | 1 conexión de réplica; query barata (vía agregado) |
| Persistencia | conexión viva mientras el dashboard esté abierto |

## 7. Contratos
- `GET /api/live/kpi?tenant=<uuid>` → `text/event-stream`, eventos `data: {tenant, ts, kpis[]}`.

## 8. Riesgos (actualizado con hallazgos de auditoría 2026-06-24)

| Riesgo | Estado | Mitigación |
|---|---|---|
| ~~Query del stream escanea `telemetry_raw`~~ | ✅ **Resuelto** | Migrado a `mining_runtime_kpis` — sin full-scan (2026-06-24) |
| ~~Tenant extraído de query string (IDOR)~~ | ✅ **Resuelto** | `session->tenantId` desde token autenticado (2026-06-24) |
| Muchas conexiones agotan pool de réplica | ⚠️ Conocido | Pool + async en spec 016 |
| ~~Sin validación de auth en SSE~~ | ✅ **Resuelto** | 401 antes de headers SSE si sin sesión válida (2026-06-24) |
