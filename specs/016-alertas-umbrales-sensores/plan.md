# PLAN 016 — Alertas y umbrales por sensor (a construir)

| Campo | Valor |
|---|---|
| **Spec** | `specs/016-alertas-umbrales-sensores/spec.md` (Borrador) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | Etapa 2 (S9-S10 · R5) |
| **Constitución** | Art. 1 (multitenant), Art. 2 (tiempo real), Art. 5 (observabilidad) |
| **Última revisión** | 2026-06-24 (plan revisado — arquitectura evaluación-en-consumidor consistente con `telemetry_ingest.hpp`) |

---

## 1. Enfoque técnico

**Motor de reglas evaluado en el consumidor de Kafka** (spec 001), no como trigger
SQL ni como proceso separado. La razón: el consumidor ya recibe cada mensaje de
telemetría antes del COPY batch — es el punto más temprano y eficiente para evaluar
umbrales. Evaluar en triggers SQL añadiría latencia de escritura al path crítico.

**Flujo:**
```
Redpanda → consumidor C++ → evaluar reglas → alerta → BD + push SSE → dashboard
                          ↓
                          COPY batch (ingesta normal, no bloqueada)
```

## 2. Arquitectura

```
 alert_rules (BD)
   (tenant_id, sensor_id/sensor_type, condition, threshold_min, threshold_max,
    rate_of_change_max, severity, debounce_seconds, active)

 Consumidor Kafka (telemetry_ingest.cpp) — MODIFICADO
   ├── Para cada mensaje M:
   │   ├── loadRules(M.tenant_id, M.sensor_id)    [cache LRU, reload cada 60s]
   │   ├── evaluateRules(M, rules) → []Alert
   │   ├── si Alert && !inDebounce(rule_id, now):
   │   │     INSERT INTO alert_events(tenant_id, rule_id, sensor_id, value, severity, ts)
   │   │     pushAlertSse(tenant_id, alert)        [canal SSE activo]
   │   └── (sin bloquear) → continuar con COPY batch
   │
   └── Cache de reglas: `std::unordered_map<tenant+sensor, vector<Rule>>` con TTL

 alert_events (BD) — historial de alertas
   (id, tenant_id, rule_id, sensor_id, value_at_trigger, severity,
    ack_by, ack_at, ts)

 SSE push de alertas:
   GET /api/live/alerts?tenant=…  (similar a /api/live/kpi, spec 005)
   → data: {rule_id, sensor_id, severity, value, ts}
```

## 3. Modelo de datos

```sql
-- Reglas de umbral (configurables por empresa)
CREATE TABLE alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES auth_companies(id),
  sensor_id       TEXT,             -- NULL = aplica a todo el tipo
  sensor_type     TEXT,
  condition       TEXT NOT NULL,    -- 'above_max' | 'below_min' | 'rate_of_change'
  threshold_min   DOUBLE PRECISION,
  threshold_max   DOUBLE PRECISION,
  rate_of_change  DOUBLE PRECISION, -- max cambio por segundo
  severity        TEXT NOT NULL DEFAULT 'warning',  -- 'info'|'warning'|'critical'
  debounce_secs   INT NOT NULL DEFAULT 30,          -- anti-tormenta
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON alert_rules (tenant_id, sensor_id) WHERE active;

-- Eventos de alerta (historial)
CREATE TABLE alert_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  rule_id     UUID REFERENCES alert_rules(id),
  sensor_id   TEXT NOT NULL,
  value       DOUBLE PRECISION,
  severity    TEXT NOT NULL,
  ack_by      TEXT,             -- username del operador que reconoció
  ack_at      TIMESTAMPTZ,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON alert_events (tenant_id, ts DESC);
```

## 4. Endpoints

| Método | Ruta | Lógica |
|---|---|---|
| GET | `/api/alert/rules` | lista reglas del tenant |
| POST | `/api/alert/rules` | crear regla (admin/supervisor) |
| PUT | `/api/alert/rules/{id}` | actualizar umbral |
| DELETE | `/api/alert/rules/{id}` | desactivar regla (soft: `active=false`) |
| GET | `/api/alert/events` | historial de alertas (paginado, filtrable por severity/sensor) |
| POST | `/api/alert/events/{id}/ack` | reconocer alerta (ack_by, ack_at) |
| GET | `/api/live/alerts` | SSE stream de alertas en tiempo real |

## 5. Debounce / anti-tormenta de alertas

- `debounce_secs` por regla: una vez disparada, la misma regla no dispara de nuevo
  durante N segundos. El estado de debounce se mantiene en memoria del consumidor
  (no en BD — no es crítico sobrevivir un reinicio).
- Agrupación por ventana: si N alertas del mismo `sensor_type` se disparan en < 10 s
  → se agrupa en un solo evento de tipo `"storm"`.

## 6. Cache de reglas (LRU)

- Las reglas se cargan de BD al arrancar y se refrescan cada 60 s (TTL).
- Cache en memoria: `unordered_map<string, pair<vector<Rule>, time_point>>`.
- Tamaño máximo del cache: 10.000 entradas (acotado, Art. 9).
- Invalidación explícita: el endpoint `POST /api/alert/rules` llama
  `ruleCache.invalidate(tenant_id)` después de escribir en BD.

## 7. SSE push de alertas (`/api/live/alerts`)

- Reutiliza el mismo mecanismo que `/api/live/kpi` (spec 005) pero con canal separado.
- El consumidor notifica al canal SSE vía un `std::shared_ptr<AlertChannel>` pasado al
  evaluador de reglas. Si no hay clientes SSE activos, la notificación es un no-op.
- Latencia alerta (sensor → SSE): < 2 s (consumidor batch cada 100 ms + eval + push).

## 8. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-016-1 | Evaluación **en el consumidor Kafka** (no trigger SQL ni proceso aparte) | Propuesto |
| ADR-016-2 | **Cache LRU** de reglas con TTL 60 s — sin round-trip a BD por mensaje | Propuesto |
| ADR-016-3 | **Debounce en memoria** (no en BD) — anti-tormenta ligero | Propuesto |
| ADR-016-4 | SSE separado para alertas (`/api/live/alerts`) | Propuesto |
| ADR-016-5 | Regla desactivada = `active=false` (no DELETE físico) — historial preservado | Propuesto |

## 9. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Lectura que cruza umbral → alerta en `alert_events` en < 2 s | timestamp ingesta vs ts alerta |
| CA-2 | CRUD de reglas → regla activa/inactiva funciona | curl + test umbral |
| CA-3 | Alerta llega por SSE `/api/live/alerts` en tiempo real | `curl -N` |
| CA-4 | Empresa A no ve alertas de empresa B | token A → 0 filas de B |
| CA-5 | Historial auditado: quién reconoció, cuándo, valor en el momento | SELECT alert_events |
| CA-6 | Tormenta: 100 cruces de umbral en 5 s → max 1 alerta por debounce | test de carga |
