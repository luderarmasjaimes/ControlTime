# PLAN 005 — Push SSE en tiempo real (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/005-push-tiempo-real-sse/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE1 (C++/Boost.Asio), FE1 (EventSource), BE3 (réplica/queries) |
| **Sprint·Release** | S6 · R3 |
| **Constitución** | Art. 3 (aislamiento R/W), Art. 5 (observabilidad), Art. 1 (multitenant) |
| **Última revisión** | 2026-06-24 v2 (IDOR corregido — tenant desde sesión + query migrada) |

---

## 1. Enfoque técnico

**Server-Sent Events (SSE) desde réplica.** SSE es un estándar HTTP que envía
eventos unidireccionales servidor → cliente sobre una conexión persistente HTTP/1.1.
Es la solución más ligera para push de tiempo real sin WebSocket.

Resultado medido: **20 conexiones SSE activas 3601 segundos** (1h), **12.969
eventos** enviados, **1.174 con datos**. Cero desconexiones.

---

## 2. Protocolo SSE

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no

data: {"tenant_id":"…","ts":"…","kpis":[{"nombre":"…","valor":…}]}\n\n
```
El cliente usa `new EventSource('/api/live/kpi?tenant=…')` — reconexión automática.

---

## 3. Implementación real (auditada contra `backend/src/main.cpp`)

### 3.1 Extracción de tenant_id

**Implementado 2026-06-24:** El `tenant_id` se extrae de la **sesión autenticada**,
no del query string. Se agrega `tenantId` a `AuthSession` (propagado desde
`AuthUser.tenantId` en `issueAuthSession`). Si la sesión no existe o `tenantId`
está vacío, el endpoint retorna **401** antes de enviar ningún header SSE.

```cpp
// main.cpp — extracción real (implementado 2026-06-24)
auto query = parseQueryString(req.target().substr(qpos + 1));
const auto session = resolveAuthSession(req, query);  // Bearer / auth_token
if (!session || session->tenantId.empty()) {
    asio::write(stream, asio::buffer(k401), ec);
    return;  // 401 antes de headers SSE
}
const std::string tenant = session->tenantId;  // UUID del token, no del URL
```

### 3.2 Fuente de datos del SSE

**Implementado 2026-06-24:** El SSE consulta `mining_runtime_kpis` (valores
pre-calculados por el KPI service), no `telemetry_raw`. Esto elimina el full-scan
de la tabla de ingesta y reduce la carga sobre la réplica. La respuesta JSON cambia:

- **Antes:** `{sensor_type, lecturas, promedio, pico}` — requería GROUP BY sobre telemetry_raw
- **Ahora:** `{name, value, unit, category}` — lectura directa de KPIs operacionales

```sql
-- Query real en handleLiveKpiSse() (implementado 2026-06-24)
SELECT name, value, unit, category
FROM   mining_runtime_kpis
WHERE  tenant_id = $1::uuid
ORDER  BY category, name;
```

Conexión a réplica via `REPLICA_DATABASE_URL` — cumple Art. 3 (no toca primario).

### 3.3 Flujo de la función SSE

```cpp
// Síntesis de handleLiveKpiSse() — backend/src/main.cpp (v2, 2026-06-24)
void handleLiveKpiSse(req, socket) {
  // 1. Parsear query params para auth (auth_token, Bearer header)
  auto query = parseQueryString(req.target());

  // 2. Verificar sesión — tenant desde token, no del URL (IDOR eliminado)
  const auto session = resolveAuthSession(req, query);
  if (!session || session->tenantId.empty()) {
    write(socket, "HTTP/1.1 401 Unauthorized\r\n...");
    return;
  }
  const std::string tenant = session->tenantId;

  // 3. Conectar a RÉPLICA (REPLICA_DATABASE_URL)
  PGconn* conn = PQconnectdb(getenv("REPLICA_DATABASE_URL"));

  // 4. Enviar headers SSE
  // Content-Type: text/event-stream; Cache-Control: no-cache

  // 5. Loop: cada LIVE_PUSH_INTERVAL_MS
  while (true) {
    // query mining_runtime_kpis WHERE tenant_id = $1::uuid
    auto kpis = queryRuntimeKpis(conn, tenant);
    // serializar JSON: {name, value, unit, category}
    write(socket, "data: {...}\n\n");
    sleep(interval_ms);
  }
  PQfinish(conn);
}
```

---

## 4. Enrutamiento (`main.cpp`)

```cpp
// El router detecta /api/live/kpi antes del router REST estándar
if (req.target().starts_with("/api/live/kpi")) {
    // handleLiveKpiSse verifica sesión internamente — 401 si sin auth
    handleLiveKpiSse(stream, req);
    return;
}
```

---

## 5. Escalabilidad y concurrencia

- Cada conexión SSE ocupa **1 hilo** (sync I/O). Límite práctico: ~100-200.
- 1 `PGconn` por conexión activa.
- `LIVE_PUSH_INTERVAL_MS=2000` (configurable vía env).

---

## 6. Cliente frontend (EventSource)

```javascript
const es = new EventSource(`/api/live/kpi?tenant=${tenantId}`);
es.onmessage = (e) => {
  const { kpis } = JSON.parse(e.data);
  if (kpis.length) renderKpiPanel(kpis);
};
// EventSource reconecta automáticamente ante corte de red
```

---

## 7. Seguridad / multitenant (estado real)

| Aspecto | Estado | Observación |
|---|---|---|
| Lectura desde réplica (Art. 3) | ✅ | `REPLICA_DATABASE_URL` |
| Aislamiento tenant (Art. 1) | ✅ | Tenant desde `session->tenantId` (token) — IDOR eliminado 2026-06-24 |
| Auth requerida | ✅ | 401 antes de headers SSE si sin sesión o sin tenantId |
| Rol dashboard_ro en réplica | ✅ | Solo SELECT |
| X-Accel-Buffering: no | ✅ | Anti-buffer proxy |

---

## 8. Observabilidad (Art. 5)

```
sse_connections_active          20 (test 1h)
sse_events_sent_total           12.969
sse_events_with_data_total      1.174
```
Expuesto en `/api/metrics`.

---

## 9. Decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-005-1 | SSE sobre WebSocket — menor complejidad, unidireccional suficiente | Aceptado |
| ADR-005-2 | Lee de réplica (`REPLICA_DATABASE_URL`) — Art. 3 | Aceptado ✅ |
| ADR-005-3 | `tenant_id` de la sesión autenticada (no del query string) | ✅ Implementado 2026-06-24 |
| ADR-005-4 | Intervalo 2 s configurable (`LIVE_PUSH_INTERVAL_MS`) | Aceptado ✅ |
| ADR-005-5 | 1 hilo por conexión (sync); async en spec 016 | Límite conocido |
| ADR-005-6 | Query sobre `mining_runtime_kpis` (sin full-scan raw) | ✅ Implementado 2026-06-24 (preferible a CAGG: valores operacionales actualizados por KPI service) |

---

## 10. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `curl -N /api/live/kpi?tenant=…` → eventos cada 2 s | ✅ Test 1h medido |
| CA-2 | Stream filtra por tenant del token de sesión | ✅ Validado — IDOR eliminado (2026-06-24) |
| CA-3 | Sin sesión → 401 antes de SSE headers | ✅ Implementado (2026-06-24) |
| CA-4 | 20 conexiones 3600 s → 0 caídas | ✅ Medido |
| CA-5 | Réplica caída → 503 | ☐ Pendiente |
| CA-6 | Primario bajo ingesta: SSE no afecta CPU primario | ✅ 25% CPU con 50 dashboards + ingesta |

---

## 11. Despliegue / rollback

- Env: `REPLICA_DATABASE_URL`, `LIVE_PUSH_INTERVAL_MS` (default 2000).
- Nginx: `proxy_buffering off; proxy_read_timeout 3600s;` para SSE largo.
- Rollback: desviar queries SSE a `DATABASE_URL` — funcional pero viola Art. 3.

---

## 12. Costo / recursos (Art. 9)

- 1 hilo + 1 `PGconn` por conexión: N conexiones = N hilos.
- Query cada 2 s sobre `mining_runtime_kpis` (O(1) por tenant): sin full-scan.
- Tráfico: ~1 KB/evento × 0.5/s × N = 500 B/s/conexión.

---

## 13. Trabajo pendiente (actualizado 2026-06-24 v2)

| Prioridad | Trabajo | Estado |
|---|---|---|
| ✅ Hecho | Tenant desde sesión, no query string (T3) — IDOR eliminado | Implementado 2026-06-24 |
| ✅ Hecho | Query migrada a `mining_runtime_kpis` (T6) — sin full-scan | Implementado 2026-06-24 |
| 🟡 Media | 503 graceful cuando réplica cae (T9) | Pendiente |
| 🟢 Baja | Frontend EventSource + UI panel (T10-T11) | Pendiente |
| 🟢 Baja | Nginx proxy config (T12) | Pendiente |
