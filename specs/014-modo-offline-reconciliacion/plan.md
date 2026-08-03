# PLAN 014 — Modo offline con reconciliación (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/014-modo-offline-reconciliacion/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE1 (core C++), BE3 (DBA), FE1/FE2 (cliente) |
| **Sprint·Release** | S8 · R4 (FIN Etapa 1) |
| **Constitución** | Art. 2 (0% pérdida), Art. 1 (multitenant), Art. 6 (trazabilidad) |

---

## 1. Enfoque técnico

Patrón **offline-first con "outbox" e idempotencia**. El cliente nunca escribe
directo a la BD: **registra cada acción como una *operación* en una cola local
persistente (outbox)** con un `op_id` único. Cuando hay red, un *sincronizador*
reenvía las operaciones en orden; el servidor las aplica de forma **idempotente**
(la misma `op_id` aplicada dos veces no duplica). Los conflictos se resuelven con
una política determinista y **todo queda auditado**.

> Principio rector (Art. 2): *una operación confirmada por el usuario nunca se
> pierde; a lo sumo se retrasa hasta reconectar.* El diseño convierte "pérdida"
> en "entrega diferida".

## 2. Arquitectura y flujo

```
 CLIENTE (navegador/tablet, FE1/FE2)                 SERVIDOR (BE1/BE3)
 ┌─────────────────────────────────┐
 │ UI (ReportStudio, registros)    │
 │   │ acción del usuario          │
 │   ▼                             │
 │ OUTBOX (IndexedDB):             │   online   ┌────────────────────────────┐
 │  {op_id, tenant_id, entidad,    │ ─────────► │ POST /api/sync (idempotente)│
 │   tipo, payload, base_version,  │            │  ├ valida op_id (dedup)     │
 │   ts_cliente, estado}           │ ◄───────── │  ├ resuelve conflicto       │
 │   ▲ persiste aunque se cierre   │   ack/conf │  ├ aplica en TX             │
 │ SINCRONIZADOR (Service Worker)  │            │  └ registra en auditoría    │
 │  detecta online → drena en orden│            └──────────┬─────────────────┘
 └─────────────────────────────────┘                       ▼
                                              PostgreSQL: sync_operations (log)
                                              + tablas de negocio (reports, etc.)
```

**Componentes nuevos:**
- **Cliente:** `OutboxStore` (IndexedDB), `SyncEngine` (Service Worker con
  Background Sync API + fallback a `online`/`visibilitychange`).
- **Servidor:** endpoint `POST /api/sync` (lote idempotente), tabla
  `sync_operations`, lógica de resolución de conflictos por entidad.

## 3. Modelo de datos

### 3.1 Cliente (IndexedDB · store `outbox`)
| Campo | Tipo | Nota |
|---|---|---|
| `op_id` | UUID v4 (cliente) | **clave de idempotencia** |
| `tenant_id` | UUID | aislamiento (Art. 1) |
| `entity` | text | `report`, `sensor_note`, … |
| `entity_id` | UUID | recurso afectado |
| `op_type` | text | `create`/`update`/`delete` |
| `payload` | json | datos del cambio |
| `base_version` | int | versión del recurso que el cliente vio (para conflicto) |
| `ts_client` | timestamptz | hora del cliente (informativa, NO autoritativa) |
| `state` | enum | `pending`/`sending`/`acked`/`conflict` |
| `attempts` | int | reintentos (backoff) |

### 3.2 Servidor (`sync_operations` — log idempotente + auditoría)
```sql
CREATE TABLE sync_operations (
  op_id        uuid PRIMARY KEY,           -- dedup: 2ª llegada = no-op
  tenant_id    uuid NOT NULL,
  entity       text NOT NULL,
  entity_id    uuid NOT NULL,
  op_type      text NOT NULL,
  payload      jsonb NOT NULL,
  base_version int,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  result       text NOT NULL,             -- applied | duplicate | conflict_resolved | rejected
  resolution   text,                      -- política aplicada si hubo conflicto
  server_user  text, client_ts timestamptz
);
CREATE INDEX ON sync_operations (tenant_id, entity, entity_id, applied_at DESC);
```
- Las tablas de negocio (`reports`, …) llevan una columna `version int` que se
  incrementa en cada update → base para detección de conflicto (control optimista).

## 4. Contrato del endpoint de sincronización

`POST /api/sync` (auth + tenant de la sesión; Art. 1/6)

```jsonc
// request — lote de operaciones en orden del cliente
{ "operations": [
  { "op_id":"…", "entity":"report", "entity_id":"…", "op_type":"update",
    "payload":{…}, "base_version":7, "ts_client":"…" }
]}
// response — resultado por operación (el cliente actúa según result)
{ "results": [
  { "op_id":"…", "result":"applied",            "new_version":8 },
  { "op_id":"…", "result":"duplicate" },                  // ya aplicada antes
  { "op_id":"…", "result":"conflict_resolved",  "resolution":"server_wins", "server_state":{…} },
  { "op_id":"…", "result":"rejected", "reason":"validation" }
]}
```
Reglas:
- **Idempotencia:** si `op_id` ya está en `sync_operations` → `duplicate`, no se
  reaplica. (Garantiza "sin duplicar" de CA-2.)
- **Atómico por operación:** cada op se aplica en su propia transacción; un fallo
  no arrastra al resto del lote.
- **tenant_id** se toma de la **sesión**, no del payload (anti-suplantación).

## 5. Resolución de conflictos (CA-3)

Conflicto = el `base_version` de la operación ≠ `version` actual del recurso en
servidor (alguien editó mientras el cliente estaba offline).

| Entidad | Política (default) | Por qué |
|---|---|---|
| `report` (documento) | **server-wins con preservación**: se aplica el cambio servidor; el del cliente se guarda como *rama/versión* recuperable | nunca se pierde trabajo (Art. 2); el usuario decide después |
| `sensor_note`, registros de campo | **append-only** (no hay conflicto: son inserciones) | datos de campo no se sobre-escriben |
| datos críticos de seguridad | **rechazo + revisión humana** | seguridad de mina no se auto-resuelve |

Toda resolución se registra en `sync_operations.resolution` y en auditoría (Art. 6).
La política por entidad es **configurable** (no hardcode).

## 6. Detección de online / disparo de sync

1. **Background Sync API** (Service Worker) — reintenta aunque la pestaña esté
   cerrada (mejor opción donde el navegador lo soporte).
2. Fallback: eventos `online`, `visibilitychange`, y un *poll* de conectividad
   (ping ligero a `/health`).
3. **Backoff exponencial** con jitter en `attempts`; tope de reintentos → marca
   `conflict`/alerta al usuario (nunca descarta la operación).

## 7. Seguridad (Art. 1, 6)
- El outbox lleva `tenant_id`; el servidor **ignora** el tenant del payload y usa
  el de la sesión.
- Operaciones firmadas por la sesión; auditoría completa de cada sync.
- No se sincroniza nada sin sesión válida; al expirar la sesión offline, se
  re-autentica (biometría 008 / password 006) antes de drenar el outbox.

## 8. Decisiones de arquitectura (ADR)
| ADR | Decisión | Estado |
|---|---|---|
| ADR-014-1 | Idempotencia por `op_id` generado en cliente (UUID v4) | Propuesto |
| ADR-014-2 | Control de concurrencia **optimista** por `version` (no locks) | Propuesto |
| ADR-014-3 | Conflicto de documento = **server-wins con rama recuperable** (no last-write-wins ciego) | Propuesto |
| ADR-014-4 | Almacenamiento cliente = **IndexedDB** (no localStorage: tamaño/transaccional) | Propuesto |
| ADR-014-5 | Disparo = **Background Sync API** con fallback a eventos online | Propuesto |

## 9. Plan de pruebas (cada CA con evidencia)
| CA | Escenario de prueba | Evidencia esperada |
|---|---|---|
| CA-1 | Cortar red, editar informe y registrar nota | operaciones quedan en outbox (persisten tras recargar) |
| CA-2 | Reconectar; reenviar el MISMO lote 2 veces | 1ª = `applied`, 2ª = `duplicate`; sin filas duplicadas |
| CA-2 | 1.000 operaciones offline → online | 1.000 aplicadas, 0 perdidas (conteo exacto) |
| CA-3 | Editar el mismo informe online y offline | `conflict_resolved` + rama recuperable + auditoría |
| CA-4 | Operación offline de empresa A no afecta B | aislamiento verificado |
| CA-5 | Demo gate R4: editar sin internet → reconectar → sync | sin pérdida, reproducible |
| Edge | Red intermitente (flapping) durante sync | sin duplicados (idempotencia) |
| Edge | Reloj del cliente adelantado/atrasado | resolución usa `version`, no `ts_client` |
| Edge | Outbox supera cuota de IndexedDB | alerta al usuario, no se pierde lo ya encolado |

## 10. Despliegue / rollback
- Migración SQL: `sync_operations` + columna `version` en tablas de negocio.
- `POST /api/sync` detrás de auth; feature flag `OFFLINE_SYNC_ENABLED`.
- Service Worker versionado (cache-busting); rollback = desactivar flag + SW.

## 11. Costo / recursos (Art. 9)
- Carga servidor: el sync es por lotes esporádicos (al reconectar), bajo costo.
- `sync_operations` crece con el nº de operaciones → política de retención (p. ej.
  archivar a frío 003 a los 90 días).
- Cliente: cuota IndexedDB monitoreada; tope configurable.

## 12. Dependencias
- 006 (auth/sesión multitenant) · 007 (editor que produce las operaciones) ·
  001 (idempotencia/ingesta como referencia) · 003 (retención del log).
