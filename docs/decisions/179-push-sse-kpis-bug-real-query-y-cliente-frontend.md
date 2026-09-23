# ADR-179 — Push SSE de KPIs (SPEC-005): bug real de query nunca detectado + cliente frontend completo

**Status**: implemented, verificado por build real, test automatizado (19/19) y ejecución en vivo de la consulta SQL contra Postgres real

**Fecha**: 2026-09-12

**Autores**: Luder Armas (pedido de cierre de R3, "máxima resolución"), con Claude Code

**Ámbito**: reports, plataforma

**Relación**: cierra SPEC-005 (T9, T10, T11, T12) — pendiente desde su
`tasks.md` original (Sprint S6/R3, 2026-06-24). Reemplaza el polling de 60s
de `KpiOperationsView.tsx` por push real cada ~2s para `current_value`.

## Contexto

El análisis de cierre de R3 (2026-09-12, ver `specs/BACKLOG.md`) había
identificado el push SSE de KPIs como el hueco más grande genuinamente
abierto de R3: `GET /api/live/kpi` existía en el backend
(`main.cpp::handleLiveKpiSse`) pero ningún componente del frontend lo
consumía — confirmado por grep, cero `new EventSource(...)` para este flujo
en todo `frontend/src`.

Al construir el cliente para cerrar ese hueco se encontró que el propio
backend **nunca había funcionado**: la consulta SQL pedía columnas
`name`/`value`/`tenant_id` que no existen en `mining_runtime_kpis`
(`db_scripts/26_mining_runtime_kpis.sql`): la clave primaria real es `code`,
el valor es `current_value`, y la tabla **no tiene** columna `tenant_id` — es
un catálogo único de KPIs corporativos, sin partición por tenant, igual que
su endpoint REST hermano `GET /api/mining/kpis`
(`kpi_service.cpp::handleListKpis`, que sí usa las columnas reales y nunca
filtra por tenant).

**Verificado en vivo, no solo por lectura de código** — se levantó un
Postgres 15 desechable, se aplicó `26_mining_runtime_kpis.sql` (13 KPIs
reales seed) y se ejecutaron ambas queries:

```
=== Query original (la que estaba en el código) ===
SELECT name, value, unit, category FROM mining_runtime_kpis
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY category, name;
→ ERROR:  column "name" does not exist

=== Query corregida ===
SELECT code AS name, current_value AS value, unit, category
FROM mining_runtime_kpis WHERE active = TRUE
ORDER BY category, sort_order, title;
→ 13 rows (aisc, costo_minado, tonelaje_movido, ley_cabeza, trifr, ...)
```

Esto confirma que el endpoint llevaba desde su creación devolviendo
`kpis: []` en cada evento SSE, indefinidamente, sin ningún error visible
para el cliente (la conexión se mantenía abierta y "funcionando", solo
que vacía) — el tipo de fallo silencioso más difícil de detectar sin
comparar explícitamente contra el schema real.

## Decisión

1. **Corregir la query de `handleLiveKpiSse`** a las columnas reales
   (`code AS name, current_value AS value, unit, category`), quitando el
   filtro `WHERE tenant_id = $1` (columna inexistente) y usando `WHERE
   active = TRUE` — mismo criterio que ya usa `/api/mining/kpis`. La sesión
   autenticada sigue siendo obligatoria para ABRIR el stream (401 sin
   token válido); ya no participa en la partición de los datos, porque la
   tabla nunca tuvo esa partición.
2. **Loguear el fallo de query una sola vez por conexión** (`std::cerr`,
   no en cada tick de 2s) — antes un fallo de query pasaba
   completamente inadvertido; ahora al menos queda en el log del backend
   si algo vuelve a romper este contrato en el futuro.
3. **Cliente frontend nuevo**: `frontend/src/lib/useLiveKpi.ts` —
   `EventSource` nativo contra `/api/live/kpi`, autenticado vía la cookie
   HttpOnly `beemetry_access_token` (`ADR-082`, ya se fija en cada
   login/refresh junto al Bearer en memoria — mismo patrón ya usado por
   `alarmStream.ts` para el WebSocket de alarmas, `EventSource` no puede
   mandar headers custom). Expone `{kpis, connected, degraded,
   lastUpdate}`; cierra la conexión explícitamente ante un error terminal
   (`readyState === CLOSED`, p.ej. sesión vencida) para no reintentar
   contra un endpoint que ya no va a autorizar.
4. **`KpiOperationsView.tsx` combina** el poll de 60s (metadata rica:
   título, descripción, meta, tendencia) con el push SSE (solo
   `current_value`, cada ~2s) por `code`/`name` — badge "En vivo" (o "En
   vivo (degradado)" si el backend cayó a la BD primaria) junto al título
   de la sección.
5. **T9 (503 si `db_replica` cae) se cierra como ya construido, con un
   diseño mejor al literal del `tasks.md` original**: el código real
   (`main.cpp`, comentario "Degradación graceful... Art.3 relajado") no
   devuelve 503 — cae a la base primaria y marca `degraded: true` en el
   envelope, manteniendo el stream vivo con datos reales en vez de cortar
   la conexión con un error. Verificado por inspección de código (lógica
   simple: `PQstatus != CONNECTION_OK` → reconectar a `cfg.gDatabaseUrl`);
   no se simuló una caída real de réplica contra el stack completo en esta
   pasada (requeriría levantar réplica+primario+backend juntos) — queda
   como verificación manual pendiente en el próximo build completo del
   developer.
6. **T12 (nginx `proxy_buffering off`) ya estaba hecho**, encontrado al
   revisar `frontend/nginx.conf`: el bloque `location /api/` ya tiene
   `proxy_buffering off` con un comentario que nombra explícitamente
   `/api/live/kpi` como una de las dos razones del fix, verificado en vivo
   ("confirmado en vivo: 133 eventos con timestamp idéntico" antes del fix
   de buffering) — el `tasks.md` original nunca se actualizó para
   reflejarlo.

## Verificación

- **Build real**: `backend/Dockerfile.verify`, imagen
  `beemetry-backend-verify:sse-fix` — compila limpio, CTest 100% (1/1).
- **Query SQL**: verificada en vivo contra Postgres 15 real (ver Contexto)
  — la query original falla con `column "name" does not exist`, la
  corregida devuelve las 13 filas reales.
- **Frontend**: `useLiveKpi.test.ts` (13/13 passed) — ciclo de vida
  completo contra un mock fiel de `EventSource` (conectar, mensaje real,
  `degraded`, error no terminal vs. terminal, limpieza al desmontar, JSON
  inválido ignorado sin perder el último estado válido). `MapViewer.test.jsx`
  (smoke test, sin regresión) y `MapViewer.zoneHighlight.test.ts` (6/6,
  hallazgo relacionado de la misma sesión, ver ADR de SPEC-009)
  también corridos.
- **Pendiente real, no resuelto acá**: prueba end-to-end contra el stack
  completo levantado (backend+Postgres+frontend+nginx reales, navegador
  real viendo el badge "En vivo" actualizarse) — esta sesión no tenía el
  stack completo de la plataforma corriendo, solo un Postgres desechable
  para la verificación de la query y el build de verificación del backend.

## Consecuencias

### Positivas
- Cierra 4 de las 5 tareas abiertas de SPEC-005 (T9, T10, T11, T12) con
  evidencia real — solo T17 (test end-to-end del gate CA-5) queda
  pendiente de un stack completo corriendo.
- Encuentra y corrige un bug que llevaba, en apariencia, "funcionando"
  (conexión abierta, sin error) desde que se escribió — el tipo de fallo
  que un smoke test superficial (¿conecta? sí) no detecta.
- El dashboard de KPIs corporativos pasa de refrescar cada 60s a cada ~2s
  para el valor actual, cumpliendo el objetivo real de negocio de SPEC-005
  ("push realtime") por primera vez.

### Negativas / Trade-offs
- `mining_runtime_kpis` sigue sin partición por tenant — cualquier tenant
  autenticado ve el mismo catálogo corporativo único. No es una regresión
  de este fix (el REST hermano ya se comportaba así); si el negocio pide
  KPIs por tenant en el futuro, es un cambio de schema (agregar
  `tenant_id`) que afecta a ambos endpoints por igual, no solo al SSE.
- La verificación de T9 (réplica caída) es por inspección de código, no
  por una prueba de caída real contra el stack completo.

## Referencias
- `backend/src/main.cpp` (`handleLiveKpiSse`, corregida)
- `backend/src/mining/kpi_service.cpp` (`handleListKpis`, query real de
  referencia usada para el fix)
- `db_scripts/26_mining_runtime_kpis.sql` (schema real: `code`,
  `current_value`, sin `tenant_id`)
- `frontend/src/lib/useLiveKpi.ts` (nuevo), `useLiveKpi.test.ts` (nuevo)
- `frontend/src/components/Dashboard/KpiOperationsView.tsx` (integración)
- `frontend/nginx.conf` (`location /api/`, `proxy_buffering off` ya
  existente, comentario que nombra `/api/live/kpi`)
- `frontend/src/lib/alarmStream.ts` (mismo patrón de auth por cookie para
  transporte en vivo, ya establecido)
- ADR-082 (Bearer en memoria + cookie HttpOnly de compatibilidad)
