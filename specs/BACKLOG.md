# BACKLOG DE SPECS · Plataforma Minera Beemetry

> **ACTUALIZACION GERENCIAL FINAL 2026-09-23.** Repositorio limpio y sincronizado con
> `origin/2026-08-21`; commits de cierre `2d7b439` (versionado integral) y `f6334a8`
> (cierre ejecutivo), etiqueta remota `corte-2026-09-23-gerencia` publicada. La
> observacion de cambios sin commit / sin subir queda **cerrada**. `backend_image.tar`
> queda fuera por limite tecnico de GitHub (519.69 MB) y fue ignorado en `.gitignore`.
> Fuente ejecutable vigente: `scripts/project-status-metrics.ps1`.
>
> | Lectura | Valor vigente | Uso |
> |---|---:|---|
> | Oficial historica | **148/204 = 72,5%** | Comparabilidad con cortes anteriores |
> | Auditada estricta | **162/221 = 73,3%** | Cifra recomendada para Gerencia |
> | Backlog fino salida a produccion | **47 tareas** | Bloqueantes reales de go-live |
> | Releases | R2 100% · R3 97,1% · R4 90,3% · R5 45,2% | Producto construido; hardening y certificacion pendientes |
>
> Para presentacion: no usar cifras historicas posteriores de este archivo como estado vigente
> si contradicen esta cabecera. Las secciones antiguas quedan como bitacora para trazabilidad.
> **CORTE VIGENTE 2026-09-23 (ADR-210/212).** La tabla de abajo es el corte histórico
> 2026-09-12/13; se conserva sin reescribir. Estado actual por SPEC con avance material
> posterior o abierto:
>
> | SPEC | Estado 2026-09-23 | Pendiente |
> |---|---|---|
> | 027 Sensores | **14/22 (63,6%)** — corregido en `project-status-metrics.ps1` como override auditado | T6, T9, T15 (parcial), T16, T18, T20, T21, T22 |
> | 015 DR | 0/14 detalladas (0/11 normalizadas) | Todo; simulacro en S12 |
> | 003 / 004 | 7/13 · 8/13 | T2, T9, T10, T12, T16-T18 · T8, T14-T16 |
> | 023 | 6/11 | T7-T11 |
> | 024 | 8/12 | T6, T15-T19 |
> | 016 | 4/5 | T14 y demo con `alarmas.manage` |
> | 014 | 7/9 | T13, T15 (manual) |
> | 017 / 018 | 0/5 · 0/7 (20 y 21 tareas detalladas) | Etapa 2 (G-16) |
>
> **Métrica vigente:** oficial 72,5% (148/204) · auditada estricta 73,3% (162/221) · backlog fino
> 47 tareas. R2 100% · R3 97,1% · R4 90,3% · R5 45,2% (la hipótesis ≈54% depende de G-16 y no es cifra vigente)
> Sprint vigente: **S9 (2026-09-21 -> 10-02, R5)**. Plan por sprint y registro de
> decisiones: `docs/PLAN_MAESTRO_2026-09-23.md` y ADR-212.

> Corte auditado: **2026-09-12** (anterior: 2026-08-18, ver histórico abajo). Dentro de este mismo corte se dio de alta `tasks.md` de SPEC-024/GEOCATMIN (antes solo tenía `spec.md`) y se excluyó SPEC-022/Operaciones de Campo del seguimiento de este proyecto (ver [ADR-178](../docs/decisions/178-operaciones-campo-fuera-de-alcance-implementacion-futura-independiente.md)) — recalculado con el script.
> Catálogo canónico: 23 SPEC con `tasks.md` medible por checkbox; para
> métricas se excluyen los dos directorios alias de SPEC-004 y SPEC-005, y
> SPEC-022 (fuera de alcance de este proyecto, ADR-178).
> Fuente: `scripts/project-status-metrics.ps1` (recalculado en esta pasada,
> no reescrito a mano) + revisión de conformidad ADR (docs/decisions/,
> auditoría 2026-09-11/12 sobre el frontend nuevo, ADR-171 a 176) +
> `CHANGELOG.md` (cierre de decisiones del corte gerencial 2026-09-10/11).

| ID | Capacidad | Gate | Ejecución normalizada | Δ vs. 08-18 | Estado verificable |
|---|---|---|---:|---:|---|
| 001 | Ingesta durable | R2 | 4/4 · 100% | = | Implementada |
| 002 | Dashboard realtime | R3 | 10/10 · 100% | = | Implementada |
| 003 | Tier frío | R5 | 7/13 · 53.8% | +1 tarea | Parcial |
| 004 | Réplica/HA | R5 | 8/13 · 61.5% | +1 tarea | Parcial |
| 005 | Push realtime | R3 | 9/9 · 100% | **cerrado, antes 55.6%** | T9/T10/T11/T12 cerrados 2026-09-12 — bug real encontrado y corregido: la query SSE pedía columnas `name`/`value`/`tenant_id` que nunca existieron en `mining_runtime_kpis` (verificado en vivo contra Postgres real: la query original falla, la corregida devuelve las 13 filas reales); nunca había servido un KPI real desde que se escribió. Cliente `useLiveKpi.ts` nuevo (13/13 tests) wireado a `KpiOperationsView.tsx`. Ver ADR-179. **T17 cerrado 2026-09-13** (ADR-181): réplica tumbada de verdad (`docker stop`) — degradación confirmada con datos reales, sin cortes. Causa raíz de la recuperación lenta (~7,4 min) encontrada y corregida en vivo (`connect_timeout=5` faltante en `BEEMETRY_REPLICA_DATABASE_URL`) — reverificado con una segunda caída real: recuperación en ~24s (~18× más rápido). **T19 cerrado 2026-09-13**: prueba de carga real de 200 conexiones SSE simultáneas ejecutada por el usuario contra el stack real — PASS (200/200 conectadas, sin degradación real del resto del tráfico, backend sin errores, pool limpio post-test). SPEC-005 al 100% |
| 006 | Auth/RBAC/multitenant | R2 | 7/7 · 100% | **+14pp, completada** | Implementada — cierre operativo cerrado |
| 007 | ReportStudio/export | R3-R4 | 6/6 · 100% | **cerrado, antes 83.3%** | Export PDF (T11) verificado 2026-09-12 — pipeline real (`usePdfExport.ts`, job asíncrono + fallback síncrono, ADR-016/080), no la ruta genérica que describía la tarea original; de paso se retiró `exportEngine.ts::exportPDF()`, código muerto con un bug real (enmascaraba fallos del servidor). **T15 medido 2026-09-13 (ADR-183): benchmark real de O3 (<5s/50 páginas) — NO cumple**: causa raíz, cualquier informe >25 páginas activa el modo "virtualizado" del sidecar (monta y espera cada página una por una) — decisión de arquitectura, no medición pendiente. **Optimizado 2026-09-13 (ADR-184)**: instrumentación real reveló que el diagnóstico inicial ("arranque de Chromium ~3,5-4s") era impreciso — el arranque real toma ~200-300ms; el costo real estaba en una espera de red (`networkidle0`) redundante con la verificación de "listo" que el código ya hacía después. 2 fixes reales: fuentes auto-hospedadas (antes descargaban de Google en cada worker sin caché) + `waitUntil` relajado a `domcontentloaded` en las 4 páginas del sidecar (PDF/DOCX/PPTX). Medido antes→después: 11 pág. 6,3s→4,6s (-28%), 56 pág. 29,4s→26,8s (-9%), 63 pág. 28,9s→27,2s (-6%), **378 pág./1120 gráficos 278s→272s (-2%, SIN regresión, 0 fallos de captura)** — mejora real en todos los tamaños, documentos grandes protegidos. **T15 cerrado por decisión de negocio 2026-09-13 (ADR-185)**: dado que el export es asíncrono (job + polling, no bloquea al usuario) y las alternativas restantes para llegar a <5s tienen costo/riesgo real sin caso de negocio hoy, se acepta el tiempo medido y optimizado (~24s extrapolado a 50 páginas con gráficos de sensor) como resultado final — el valor literal de la SOW (<5s) queda documentado como NO cumplido, desviación reconocida, no oculta. SPEC-007 cierra al 100% (6/6). **Nota de proceso**: ADR-172/173/174/175/051(act.)/014(act.) documentan una elaboración real muy superior al alcance original T1-T18 de este `tasks.md` (motor de tablas, importación Word, capacidades de editor, NavBar) — sin tasks.md propio todavía, ver "Prioridad de cierre" |
| 008 | Biometría | R3-R5 | 7/7 · 100% | **completada, antes 85.7%** | Verificación funcional con cámara real ya realizada (2 laptops, cámaras web de producción, 2 personas distintas — cierra el pendiente de ADR-119/162). T16 (certificación Dermalog hardware) **descartado 2026-09-12** (ADR-180): SDK comercial con licencia de costo adicional, sin caso de negocio que la justifique frente a DeepFace+SilentFace ya vigente sin costo (ADR-105). Queda pendiente, fuera de este conteo por checkbox: calibración estadística formal (FMR/FNMR, PAD ISO/IEC 30107-3), que exige una muestra representativa mayor |
| 009 | GIS/mapas | R3 | 5/6 · 83.3% | **corregido, antes 66.7%** | T11 (highlight de zona) cerrado 2026-09-12 — el endpoint evolucionó de "check-point" a `compliance-intersections` (más amplio, ya consumido para el panel agregado); se agregó el resaltado visual real de la zona en el mapa (`MapViewer.tsx`, borde 2x + relleno 2x), con test unitario nuevo (6/6). Abierto: T17, migración a PostGIS, Etapa 2 |
| 010 | Fórmulas | R3 | 7/7 · 100% | = | Implementada |
| 011 | IA texto | R3-R5 | 5/6 · 83.3% | **corregido, antes 66.7%** | Verificación de privacidad (T15) cerrada 2026-09-12 por inspección de configuración — LanguageTool/Ollama corren en `http://languagetool:8010`/`http://ollama:11434`, nombres de servicio internos de Docker, ninguna URL externa en el código. Abierto: T17, fine-tuning de modelo especializado, Etapa 2/S11 (deliberadamente diferido) |
| 012 | GDAL | R4 | 3/4 · 75% | = | Implementada; T14-T15 (thread pool >20 jobs, persistencia de jobs entre reinicios) deliberadamente "futuro/Etapa 2" desde el plan original — no bloquea R4 |
| 013 | CCTV | R4 | 7/8 · 87.5% | **cerrado T9-T10, antes 75%** | T9-T10 implementados 2026-09-13: `VideoDiagram.tsx` — auto-actualización configurable (Manual/15/30/60s, persistida) y placeholder dedicado de cámara sin señal con timestamp del último poll. Verificado: `tsc --noEmit` limpio, build productivo OK, 444/444 tests sin regresión, desplegado (`beemetry-web` healthy). Abierto: T15 (integración EPP, Etapa 2 por diseño) |
| 014 | Offline/reconciliación | R4 | 7/9 · 77.8% | **cerrado CA-2/CA-3/tests, antes 44.4%** | Edición offline de Informes Técnicos (ReportStudioV2) implementada y verificada end-to-end desde 2026-07-13 (ADR-022/045). **CA-2, CA-3 y cobertura de test cerrados 2026-09-13** (ver actualización de ADR-022): CA-2, el snapshot versionado con `expected_version` analizado y confirmado equivalente al objetivo real del criterio; CA-3, bug/gap real corregido — la resolución de un conflicto offline ahora se etiqueta explícitamente en el historial de versiones (`offline_conflict_overwrite`/`offline_conflict_kept_as_new`), antes indistinguible de un autosave normal; **cobertura de test automatizado**, antes 0%, cerrada con `offlineSqlite.integration.test.ts` (13 tests nuevos) usando el motor sql.js/WASM **real** (no mockeado) y un mock fiel de la Cache API — cubre round-trip, upsert, la regla de `base_version_number` de ADR-022, aislamiento por usuario, migración de esquema y ambas ramas de `purgeOfflineCacheOnLogout`. Verificado: build backend real (CTest 1/1), deploy real, suite frontend 457/457 sin regresión. **Quedan solo 2 notas de divergencia permanentes** (`plan.md`/`spec.md` vs. lo construido) que por diseño nunca se marcan "hechas" — no son tareas pendientes, son constancia histórica de una decisión de arquitectura ya tomada |
| 015 | DR/continuidad | R5 | 0/11 · 0% | = | No aceptada — sin movimiento desde 08-18 |
| 016 | Alertas | R4 | 4/5 · 80% | **cerrado bookkeeping+Art.5+bug real, antes 40%** | **2026-09-13**: T1-T12 cerrado (11/12 reales; T7/T8 no se construyen por decisión YA tomada en ADR-140). Constitución (Art. 1/2/5/9) cerrado: Art. 1 y 9 ya probados en vivo; Art. 2 verificado por lectura de código; **Art. 5 — gap real corregido**: el motor de alarmas no exponía ninguna métrica pese a estar en producción desde ADR-034 — se agregaron 5 métricas reales (`beemetry_alarm_engine_*`) a `/api/metrics`. **Segunda pasada, mismo día**: al intentar el demo en vivo con una sesión autenticada real, se encontró y corrigió un **bug real de rendimiento** en el propio camino de polling del evaluador — la consulta de "último valor" sin cota de tiempo no completaba ni con `statement_timeout` de 10s contra los ~10.900 chunks de `telemetry_fact` (mismo bug encontrado también en `/api/mining/telemetry/summary`, dashboard general, confirmado colgado 45s+; y en `simulation_status_routes.cpp`) — los 3 corregidos y verificados (`GET /api/mining/telemetry/summary`: 45s+ → 1179ms real), ver [ADR-186](../docs/decisions/186-bug-real-timescaledb-chunk-scan-sin-cota-tiempo.md). El intento de crear la regla real de prueba fue bloqueado correctamente por RBAC (`403 forbidden: alarmas.manage` — la sesión disponible tiene rol `viewer`). **Abierto, con un bloqueo preciso**: la demo visual en el dashboard requiere repetir el intento con una cuenta que tenga `alarmas.manage` — ya no es un problema de código, mecanismo, ni disponibilidad de sesión |
| 017 | Visión EPP | R5 | 0/5 · 0% | = | Deferred por ADR-025, decisión de negocio sin cambios |
| 018 | Dictado STT | R5 | 0/7 · 0% | = | Parcial en código, sin tareas aceptadas — sin movimiento |
| 019 | RP/Odoo | R4 | 19/20 · 95% | = | Falta integración con Odoo productiva autorizada (ventana CA-4) — reprogramada a Etapa 2 del proyecto, posterior a la implementación de reportabilidad (SPEC-007); no bloquea gates de la Etapa 1 |
| 020 | Telemetría 25k/s | R3 | 9/9 · 100% | = | Aceptada a 25k; 100k no aprobado (ADR-108 lo prohíbe como claim) |
| 021 | Zonas/multiserie | R3-R4 | 10/10 · 100% | **cerrado 2026-09-13** | T8/T10 cerrados 2026-09-12 — catálogo real de 20 tipos de gráfico (no 10); `SensorMultiChartWidget.smoke.test.tsx` (41/41 passed) monta los 20 tipos vacíos + 19/20 con datos reales sin lanzar excepción. T9 cerrado 2026-09-13 (ADR-182): PDF (378 pág.) y PPTX (378 diapositivas) reales generados y verificados contra el stack completo con los 20 tipos — 2 bugs reales encontrados y corregidos con test de regresión nuevo (`SensorMultiChartWidget.histogram.test.tsx`, 42/42 passed): `histogram` mostraba las 10 etiquetas de bucket idénticas "0.0–0.0" para sensores de magnitud pequeña, `pie`/`donut`/`funnel` recortaban el nombre del sensor a mitad de palabra en el layout de export. `sunburst` queda con un hallazgo de solapamiento documentado, sin corregir (alcance acotado) |
| 023 | Portabilidad/restore/CI-CD | R5-R6 | 6/11 · 54.5% | = | Utilidad; restore y despliegue no aceptados |
| 024 | GEOCATMIN/INGEMMET | R3 | 8/12 · 66.7% | **nuevo, antes N/A** | Código real verificado (suite nativa + ArcGIS en vivo); parcial: falta búsqueda por Cuadrícula IGN/coordenadas (T6) y test automatizado de búsqueda/superposición/identify (T15-T17); catálogo declara 134 servicios, tiene 38 reales (T18, ver nota) |
| 025 | Soporte/WhatsApp | Sin sprint asignado | Sin tasks.md · N/A | — | Aprobado al alcance contractual (2026-09-11, ADR-168) — 9 ADR ya implementados (112-118, 122, 129); canal SMS pendiente de cuenta Twilio comercial, WABA de Meta pendiente para el bot |
| 027 | Integración sensores directo+gateway | Sin sprint asignado | **14/22 · 63,6% vigente** (3/22 fue el alta inicial 2026-09-16) | **actualizado por ADR-212 / script 2026-09-23** | ADR-192: auditoría con datos reales de `sensors_db` (no solo lectura de código) — de 78,780 filas en `sensors`, solo **3** tienen credencial real (el resto es carga sintética ADR-108 o semilla/demo); 0 fuentes Modbus/OPC-UA configuradas pese a los 3 adaptadores activos; 1 sola regla de alarma en todo el sistema; 1/27 plantillas de ADR-189 verificada contra dato real. T1-T3 (inventario base) cerradas en la misma sesión que dio de alta la spec. Incluida en la métrica auditada vigente por override de `project-status-metrics.ps1`; sigue fuera de un bucket de release histórico |

> **SPEC-022 (Operaciones de Campo) removida de esta tabla el 2026-09-12** —
> fuera de alcance de este proyecto por decisión de Gerencia, ver
> [ADR-178](../docs/decisions/178-operaciones-campo-fuera-de-alcance-implementacion-futura-independiente.md).
> Su carpeta (`specs/022-operaciones-campo-offline-erp/`) se conserva
> intacta como referencia técnica para una futura iniciativa independiente,
> excluida explícitamente de `scripts/project-status-metrics.ps1`.

## Métrica consolidada

- **Corte vigente 2026-09-23:** `scripts/project-status-metrics.ps1` devuelve 24 SPEC canónicas medibles, **162/221 = 73,3%** en lectura auditada estricta. La lectura oficial histórica se conserva como **148/204 = 72,5%** para comparabilidad. El backlog fino de salida a producción es **47 tareas**.
- Por release: **R2 100% (11/11) · R3 97,1% (68/70) · R4 90,3% (56/62) · R5 45,2% (33/73)**. R5 permanece como foco de hardening, DR, restore, pentest, campo real y UAT.
- Sprint vigente al corte: **S9 (2026-09-21 -> 10-02, R5)** — "Congelar, sanear y contratar".
- La cifra mide ejecución documentada, no aceptación productiva ni horas.
- SPEC-019 y SPEC-020 usan tablas; sus estados se normalizaron en el conteo.
- Una tarea solo se considera completa cuando `tasks.md` aporta estado/evidencia.

## Qué avanzó entre el 08-18 y el 09-12 (evidencia, no solo el número)

- **SPEC-006 (Auth/RBAC) llegó a 100%** — cierre operativo completado.
- **SPEC-016 (Alertas) pasó de 0% a 40%** — dejó de ser backlog puro.
- Mejoras de +10 a +20pp en 003/004/007/008/009/011/013/021 — trabajo real distribuido, no concentrado en un solo módulo.
- **Corrección importante (2026-09-12): 014 (Offline) NO estaba en 0%.** Esta pasada encontró que el `tasks.md` de SPEC-014 seguía completo con checkboxes vacíos desde 2026-06-24, pese a que `ADR-022` ya declaraba el modo offline de Informes Técnicos **implementado y verificado end-to-end desde 2026-07-13** (backend real vía curl + navegador real, incluida edición concurrente simulada), y a que el 2026-09-12 se repitió la verificación manual con varios tipos de documento. Recalculado a 4/9 (44,4%) — abierto: sin test automatizado, sin auditoría dedicada de la resolución de conflicto, y sin cubrir "registrar datos" de campo genérico en general (ese alcance más amplio quedó fuera de este proyecto el 12-sep, ver SPEC-022/ADR-178 abajo). **015 (DR) sigue en 0%**, ese sí sin movimiento — sigue siendo el mayor riesgo real de cronograma de cara a R5.
- **SPEC-022 (Operaciones de Campo) excluida del seguimiento de este proyecto (2026-09-12, ADR-178)** — Gerencia decidió que no es alcance de esta plataforma, en ningún grado: se retira de esta tabla, de `specs/REGISTRY.md` y de los reportes gerenciales. Su carpeta se conserva intacta como referencia para una futura iniciativa independiente.
- **6 ADR nuevos (171-176) y 6 actualizados (014, 019, 051, 075, 080, 139)** formalizaron una auditoría de conformidad completa del frontend nuevo — 3 conflictos críticos de seguridad/integridad encontrados y corregidos (aislamiento de caché offline entre técnicos, portapapeles del sistema sin control de autor, falta de bloqueo de edición en informes firmados). Detalle: `docs/decisions/README.md`.
- **Cierre real (no solo análisis) del gate R3, de 81,2% a 90,0%** (2026-09-12): bug real encontrado y corregido en el push SSE de KPIs (SPEC-005, nunca había servido un dato real, ver ADR-179), highlight de zona activa en el mapa (SPEC-009), export PDF confirmado + código muerto retirado (SPEC-007), 20 tipos de gráfico verificados sin crash (SPEC-021) — 60 tests automatizados nuevos, todos passed, más los 443 de la suite completa sin regresión.
- **Cierre del corte gerencial del 2026-09-10** (documentado 2026-09-11, `CHANGELOG.md`): 9 de 10 decisiones pendientes cerradas — motor biométrico secundario decomisionado por licencia no comercial (ADR-166), alcance v1 del avatar de soporte (ADR-167), validación SUNAT activada vía Chequea (act. ADR-087), postura Enterprise LATAM confirmada (act. ADR-035), rebaseline de Operaciones de Campo aprobado (act. ADR-110, luego superado el 12-sep por su exclusión total del proyecto, ver ADR-178); queda 1 abierta (pentest/DR/UAT sin proveedor). Mismo corte documentó el hallazgo de seguridad más grave del proyecto hasta ahora — escalada de privilegios vía autoregistro contra empresa existente (ADR-134), corregido el mismo día del hallazgo (2026-08-26); Gerencia confirmó el 11-sep que no requiere auditoría/notificación retroactiva (sin clientes reales expuestos a la fecha).

## Cierre real del gate R3 (venció 2026-08-31) — 81,2% → 90,0%

Pedido explícito de Gerencia (2026-09-12): "máxima resolución" para cerrar
o reducir el % faltante de R3, implementando lo que se pudiera y probando
en forma automatizada. No fue solo un re-análisis — se implementó código
real, se corrigió un bug real, y se agregaron 60 tests automatizados
nuevos (todos passed) para dejar evidencia verificable.

**Implementado y cerrado esta pasada:**

- **SPEC-005 (T9, T10, T11, T12) — el hueco más grande, resuelto.** Al
  construir el cliente SSE que faltaba se encontró que el propio backend
  **nunca había funcionado**: `handleLiveKpiSse` (`main.cpp`) pedía columnas
  `name`/`value`/`tenant_id` que nunca existieron en `mining_runtime_kpis`
  (PK real: `code`; valor: `current_value`; sin `tenant_id`). Verificado en
  vivo contra un Postgres 15 real: la query original falla con `column
  "name" does not exist`; la corregida devuelve las 13 filas reales. El
  stream llevaba, en apariencia, "funcionando" (conexión abierta, sin
  error) desde que se escribió, sin servir un solo KPI real jamás. Corregido
  + cliente nuevo `frontend/src/lib/useLiveKpi.ts` (13/13 tests, mock real
  de `EventSource`) + integración en `KpiOperationsView.tsx` (badge "En
  vivo", refresco cada ~2s en vez de 60s). T9 (degradación graceful) y T12
  (nginx) resultaron ya estar implementados, solo sin actualizar en el
  `tasks.md`. Ver [ADR-179](../docs/decisions/179-push-sse-kpis-bug-real-query-y-cliente-frontend.md).
- **SPEC-009 (T11)** — highlight real de zona en el mapa: el endpoint
  evolucionó de "check-point" a `compliance-intersections` (ya consumido
  para un panel agregado, pero sin resaltar la zona en el mapa mismo).
  Agregado en `MapViewer.tsx` (borde 2x, relleno 2x sobre la zona con un
  marcador real adentro), con test unitario nuevo (6/6 passed).
- **SPEC-007 (T11)** — export PDF: confirmado que el pipeline real
  (`usePdfExport.ts`, job asíncrono + fallback síncrono) ya funciona y está
  conectado al botón real; de paso se encontró y retiró
  `exportEngine.ts::exportPDF()`, código muerto con un bug real (el `catch`
  devolvía `success:true` aunque el servidor fallara, enmascarando el
  error) que ya no aplicaba por estar fuera de uso.
- **SPEC-011 (T15)** — privacidad verificada por inspección de
  `docker-compose.yml`: LanguageTool/Ollama corren en nombres de servicio
  internos de Docker, ninguna URL externa en el código.
- **SPEC-021 (T8, T10)** — el catálogo de tipos de gráfico creció de 10 a
  20 (`CHART_TYPE_LABELS`); `SensorMultiChartWidget.smoke.test.tsx` nuevo
  (41/41 passed) monta los 20 tipos vacíos + 19/20 con datos reales sin
  lanzar ninguna excepción. Encontrado de paso: jsdom no implementa
  `ResizeObserver` — agregado un stub a `setupTests.js`. `ci.yml` ya corre
  `npm run test:run` sin condición en cada push/PR, así que este test queda
  incluido en el gate de CI sin wiring adicional (T10).
- **Regresión verificada**: los 443 tests de la suite completa de frontend
  pasan tras todos estos cambios (`npx vitest run`, 37 archivos, 0 fallos) —
  ningún cambio de esta pasada rompió algo existente.
- **SPEC-008 (T16) — descartado, no reprogramado.** Certificación Dermalog
  con hardware real: decisión de negocio (2026-09-12) de no adquirir la
  licencia comercial por su costo adicional, sin caso de negocio que la
  justifique frente a DeepFace+SilentFace (ADR-105), ya vigente y sin
  costo. Cierra SPEC-008 al 100% (7/7). Ver [ADR-180](../docs/decisions/180-descarte-dermalog-licencia-comercial-costo-adicional.md).

**Correctamente fuera de alcance de R3 — no bloquean el cierre** (tareas
reales, programadas deliberadamente para una etapa/sprint posterior):
SPEC-009 T17 (PostGIS, "Etapa 2"), SPEC-011 T17 (fine-tuning, "Etapa
2/S11"), SPEC-005 T19 (escalar >200 conexiones, enlazado a SPEC-016
futuro).

**SPEC-021 T9 — cerrado 2026-09-13** (ver [ADR-182](../docs/decisions/182-verificacion-export-20-tipos-grafico-bugs-histograma-funnel.md)):
PDF (378 pág.) y PPTX (378 diapositivas) reales generados y verificados
contra el stack completo con los 20 tipos de gráfico — 2 bugs reales
encontrados y corregidos (`histogram` con etiquetas de bucket idénticas
"0.0–0.0" para sensores de magnitud pequeña; `pie`/`donut`/`funnel`
recortando el nombre del sensor a mitad de palabra), test de regresión
nuevo (42/42 passed).

**SPEC-005 T17 — cerrado 2026-09-13** (ver [ADR-181](../docs/decisions/181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md)):
réplica de Postgres tumbada de verdad (`docker stop beemetry-db-replica`)
contra el stack completo, dos veces. El SSE nunca se cortó en ninguna de
las dos, siguió sirviendo KPIs reales con `degraded:true` durante la
caída. **Primera corrida**: al restaurar la réplica, el SSE tardó ~7,4
minutos (no el próximo tick) en dejar de reportar `degraded`. **Causa raíz
encontrada y corregida**: `BEEMETRY_REPLICA_DATABASE_URL` nunca tuvo
`connect_timeout` (a diferencia de las otras 2 URLs del backend, que ya lo
tenían por el mismo motivo). **Segunda corrida** (con el fix desplegado):
recuperación real en ~24 segundos — mejora de ~18×.

**SPEC-007 T15 — medido 2026-09-13, criterio NO cumplido** (ver
[ADR-183](../docs/decisions/183-benchmark-real-o3-export-pdf-falla-umbral-5s.md)):
benchmark real contra 3 informes (11, 56 y 63 páginas) — 29,4s/28,9s para
56/63 páginas (~5,9× el umbral de 5s). Incluso un informe mayormente texto
(11 páginas) extrapola a ~11-14s para 50 páginas (~2,5-3× el umbral) — el
costo fijo de arrancar cada uno de los 4 Chromium dedicados (~3,5-4s) ya
consume el 70-80% del presupuesto de 5s por sí solo. Es un techo de
arquitectura real, no un bug puntual; queda como decisión de Gerencia/
arquitectura (script de benchmark reutilizable:
`scripts/benchmark-export-o3.browser.js`).

**SPEC-005 T19 — cerrado 2026-09-13**: el usuario corrió
`sse-load-test.js` en su propia terminal contra el stack real (el login
programático quedó bloqueado dentro de esta sesión de Claude Code por el
clasificador de permisos, que no ejecuta acciones de autenticación con
contraseña bajo ninguna circunstancia). **PASS**: 200/200 conexiones SSE
reales conectadas sin error, 1235 eventos con datos reales (0 degradados),
10/10 mediciones de control bajo carga OK (2,8ms promedio vs. 3,8ms
baseline — sin degradación real), backend sin errores en logs, pool de
conexiones limpio post-test. SPEC-005 cierra al 100% (9/9).

**SPEC-007 T15/O3 — optimizado 2026-09-13 (ADR-184), criterio aún NO
cumplido**: se investigó a fondo si era factible mejorar el tiempo sin
perjudicar documentos grandes — sí lo era. Se encontraron y corrigieron 2
ineficiencias reales (fuentes auto-hospedadas en vez de Google Fonts;
`waitUntil: 'domcontentloaded'` en vez de `'networkidle0'`, redundante con
la verificación de "listo" que el código ya hacía después). Mejora medida
en los 4 tamaños probados, incluido el documento de 378 páginas/1120
gráficos (**-2%, sin regresión, 0 fallos de captura** — confirma que
documentos grandes quedaron protegidos). O3 sigue sin cumplirse (~24s
extrapolado para 50 páginas con gráficos de sensor, vs. <5s exigido) — el
resto es un techo de arquitectura real (arranque de Chromium + captura por
página), no una ineficiencia corregible sin un rediseño mayor.

**SPEC-007 T15/O3 — cerrado por decisión de negocio 2026-09-13** (ver
[ADR-185](../docs/decisions/185-decision-negocio-cierre-o3-export-async-tolerancia-espera.md)):
Gerencia (Luder Armas) decidió aceptar el tiempo medido y optimizado
(ADR-184) como resultado final, en vez de seguir invirtiendo en cerrar la
brecha restante hacia <5s. Razonamiento documentado: el export es un
proceso **asíncrono** (job + polling, `usePdfExport.ts`) que no bloquea al
usuario, que puede seguir trabajando mientras se genera; un tiempo de
espera de fondo de ~24-27s para el caso más pesado (informe grande con
gráficos de sensor en vivo) se considera operacionalmente aceptable; y las
3 alternativas restantes para llegar a <5s (subir el umbral de
virtualización, más paralelismo, rediseño del camino virtualizado) tienen
cada una costo o riesgo real (la primera arriesga reproducir el mismo
incidente de documentos gigantes que motivó la arquitectura actual, ver
ADR-170) sin un caso de negocio que lo justifique hoy — no hay queja de
usuario real registrada sobre el tiempo de export. **Se documenta
explícitamente que el valor literal de la SOW (<5s, `spec.md` CA-2/O3) NO
se cumple** — es una desviación reconocida y aceptada, no un cumplimiento
del criterio original; la puerta queda abierta a retomar cualquiera de las
alternativas descartadas si en el futuro cambia el caso de negocio. Con
este cierre, **T15 pasa a ☑ y SPEC-007 llega a 100% (6/6)**.

**Recomendación**: emitir el acta de cierre de R3 al **97,1% (68/70)** —
el único ítem que impedía el 100% (SPEC-007 T15/O3) ya está formalmente
cerrado; el 2,9% restante son 2 tareas de SPEC-009/SPEC-011 ya
identificadas como "Etapa 2" y correctamente fuera de alcance de R3 (ver
"Correctamente fuera de alcance de R3" más arriba), no un pendiente real.

## Prioridad de cierre vigente para Gerencia

1. **Cerrado 2026-09-23: repositorio y trazabilidad Git.** Todo lo versionable fue commiteado y subido a `origin/2026-08-21`; etiqueta `corte-2026-09-23-gerencia` publicada. Observacion de cambios sin commit/sin push retirada.
2. **Cerrado 2026-09-23: fuentes y metrica gerencial.** `project-status-metrics.ps1` publica `Official`, `AuditedStrict` y `ProductionExitBacklog`; SPEC-027 incluida como 14/22.
3. **Cerrar P0 operativo:** pentest externo (G-1), DR cronometrado (G-2/SPEC-015), restore en host limpio (SPEC-023 T9), rollback y migraciones verificadas (ADR-211).
4. **Cerrar aceptacion:** UAT y marcha blanca con acta (G-4), go/no-go con fecha base o contingencia (G-14).
5. **Cerrar campo real:** inventario de sensores, credenciales, reglas minimas por tenant y decision de cadenas de alarma legado (G-7, SPEC-027).
6. **Cerrar riesgo tecnico puntual:** `linear_settlement_cell` corregida o excluida por escrito antes de uso productivo (G-8).
7. **Mantener Etapa 2 separada:** EPP/STT, Odoo productivo, PostGIS, GDAL persistente, fine-tuning LLM y Operaciones de Campo no deben mezclarse con el go-live condicionado actual salvo decision explicita.

## Nota sobre avance

No se usa «número de ADR escritos» como avance. Los ADR miden cobertura y
coherencia de decisiones; el porcentaje se obtiene de tareas y se acompaña de
readiness por evidencia en el informe de estado del 2026-09-12 (histórico:
2026-08-18).



