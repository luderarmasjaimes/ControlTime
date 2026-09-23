# REGISTRO MAESTRO ADR ↔ SPEC · Plataforma Minera Beemetry

> **CORTE VIGENTE 2026-09-23 (ADR-210/211/212).** Este registro cubre **ADR-000 a ADR-212**
> (el largo historial de banners de abajo se conserva por trazabilidad; ya no es la
> referencia del rango). Extensión de la matriz para los ADR posteriores a 186, que
> antes no aparecían por SPEC:
>
> | SPEC | ADR añadidos desde 2026-09-13 |
> |---|---|
> | SPEC-007 (ReportStudio/export) | 172-174, 199, 201, 204-206, 209 — elaboración posterior a T18 **sin `tasks.md` propio** (tarea C5, ADR-212) |
> | SPEC-008 (Biometría/avatar) | 141-143, 150, 156-159, 162-164, 202, 203, 207 — validación visual con registro real pendiente (UAT-2) |
> | SPEC-010 (Fórmulas) | 187-189, 194, 195, 198 |
> | SPEC-009 (GIS) / sensores en mapa | 190, 196, 208 |
> | SPEC-016 (Alertas) | 193 (alarma de inactividad) |
> | SPEC-027 (Sensores directo/gateway) | 192, 194, 197, 198 — 14/22 tareas |
> | SPEC-006 (Auth) | 191, 207 (fotocheck) |
> | SPEC-020 (Telemetría 25k/s) | 200 (latencia; migraciones 107-110) |
> | Transversal | 210 (auditoría), 211 (ledger de migraciones), 212 (plan maestro y decisiones G-1…G-17) |
>
> **Cifras del corte:** 72,5% oficial (148/204) · 73,3% auditado (162/221) · ≈47 tareas de
> backlog fino de salida a producción. **Hallazgos abiertos:** migraciones 115/116 sin
> aplicar en la BD viva; runner bloqueado en versión 81 duplicada; 400 cambios sin commit;
> SPEC-025 y SPEC-026 sin carpeta `specs/`. Ver ADR-210 §Hallazgos.

> **Fuente vigente al 2026-08-21, rango de ADR actualizado 2026-09-13.** Las
> decisiones canónicas están únicamente en
> [`docs/decisions/`](../docs/decisions/README.md), ADR-000 a ADR-200 (huecos
> en 151-152 ya cerrados con archivo mínimo, ver ADR-151/152) *(rango corregido 2026-08-21 —
> este banner decía "ADR-111" pese a que la fila SPEC-024 más abajo ya citaba
> ADR-121/123; ampliado ese día a 128 tras redactar ADR-124 a 128; corregido
> de nuevo 2026-09-10 — la fila SPEC-008 de abajo ya citaba ADR-141 desde
> antes de esta corrección, el banner había quedado rezagado otra vez; corregido
> de nuevo 2026-09-12 tras ADR-171 a 176 — una auditoría de conformidad
> encontró el frontend nuevo entregado sin ADR/SPEC propio, ver la fila SPEC-007
> más abajo y `docs/decisions/README.md` para el detalle completo; ampliado
> de nuevo 2026-09-12 a 178 tras ADR-177 (decomiso de autoasignación de rol en
> autoregistro) y ADR-178 (Operaciones de Campo queda fuera de alcance de este
> proyecto — su fila SPEC-022 se retiró de la matriz de abajo, ver ADR-178);
> ampliado de nuevo 2026-09-13 a 185 tras ADR-179/180/181 (bug real de SSE de
> KPIs, descarte de Dermalog, pool de conexiones para SPEC-005 T19), ADR-182
> (cierre de SPEC-021 T9, export real PDF/PPTX con 2 bugs corregidos),
> ADR-183 (benchmark real de O3/SPEC-007 T15 — medido y NO cumplido),
> ADR-184 (2 fixes reales de rendimiento del export, mejora 6-28% sin
> regresión en documentos grandes, O3 sigue sin cumplirse) y ADR-185
> (decisión de negocio: se cierra SPEC-007 T15/O3 aceptando el tiempo
> medido/optimizado, dado que el export es asíncrono y no bloquea al
> usuario — valor literal de la SOW <5s queda documentado como no
> cumplido, desviación reconocida); ampliado de nuevo 2026-09-13 a 186 tras
> cerrar SPEC-013 T9-T10, SPEC-016 (T1-T12/Constitución) y SPEC-014
> (CA-2/CA-3/cobertura de test) — R4 sube de 80,6% a 90,3% en el día. ADR-186
> documenta un bug real de rendimiento encontrado al intentar el demo en
> vivo de SPEC-016: una consulta de "último valor" sin cota de tiempo
> colapsaba contra los ~10.900 chunks de `telemetry_fact`, afectando tanto
> al evaluador de alarmas como a un endpoint de dashboard general
> (`/api/mining/telemetry/summary`, medido en 45s+ antes, 1179ms después);
> ampliado de nuevo 2026-09-19 a 200 — **nota**: ADR-187 a 199 ya existían en
> el repo antes de esta corrección sin que este banner los reflejara (brecha
> preexistente, no introducida por ADR-200; ver esos archivos directamente
> para su contenido, no cubiertos por esta actualización de banner). ADR-200
> es la auditoría integral de latencia en tiempo real pedida explícitamente
> ("optimizar todas las funcionalidades a tiempo real con la menor latencia
> posible"): 16 hallazgos reales, varios del mismo patrón de bug que
> ADR-186 (consulta sin cota de tiempo sobre hypertable, encontrado esta vez
> en `sensor_formula_evaluator.cpp`/`sensor_formula_routes.cpp`, código
> posterior a esa auditoría); batching de N+1 en los evaluadores de fórmulas
> y alarmas (solo lectura, las escrituras correctness-sensitive quedan
> igual); keepalive + resync de reconexión en el WebSocket de alarmas;
> hallazgo de `TelemetryDashboard.tsx` mostrando telemetría 100% simulada
> rotulada como real (corregido con banner honesto, no con un backend
> inventado); 4 migraciones nuevas de índice/chunking/retención/
> `statement_timeout` (`db_scripts/107-110`), **aplicadas y verificadas en
> vivo** contra `beemetry-db`/`beemetry-api`/`beemetry-pgbouncer` reales
> (redeploy real, 4 migraciones confirmadas por introspección, `sqlRawCounts`
> medido antes/después: de "cancela a los 10s" a 220ms, trigger de alarma
> end-to-end en el camino batcheado, y un hallazgo operativo real no
> anticipado: `pgbouncer` no propaga el nuevo `statement_timeout` de rol a
> conexiones ya abiertas, requiere reciclar el pool). Sin verificar bajo
> carga real: keepalive/resync de WS (#5) y paralelización de
> `MapAggregator`/`protocol_adapters` (#11/#12) — ver ADR-200 § Verificación
> y § Consecuencias para el detalle completo*.
> `specs/adr/` y `docs/docs/decisions/` son copias históricas/no canónicas y no
> deben alimentar decisiones nuevas, RAG ni conteos de avance.

## Reglas de trazabilidad

1. Ningún cambio de producto se integra sin SPEC y ADR vigente o una referencia
   expresa a una decisión existente.
2. `implemented` significa código existente; `accepted` significa decisión
   aprobada; ninguno sustituye la evidencia de criterios de aceptación.
3. Los directorios duplicados `004-replica-alta-disponibilidad` y
   `005-push-tiempo-real-sse` se conservan como alias históricos. Para métricas
   solo cuentan `004-replica-lectura-ha` y `005-push-sse-tiempo-real`.
4. Las decisiones superseded se conservan, pero la relación efectiva usa su
   reemplazo: ADR-028→072, ADR-062→064/065, ADR-104→105 y prioridad de
   ADR-089→105.

## Matriz SPEC → decisiones canónicas principales

| SPEC | Capacidad | ADR canónicos principales | Estado de aceptación al corte |
|---|---|---|---|
| SPEC-001 | Ingesta durable | 001, 007, 008, 023, 032, 034, 108 | Implementada; línea base 25k validada en SPEC-020 |
| SPEC-002 | Dashboard realtime | 002, 006, 031, 057, 108, 200 | Parcialmente aceptada. ADR-200 (2026-09-19) corrigió `TelemetryDashboard.tsx` (mostraba telemetría 100% simulada rotulada como real — ahora con banner honesto) y sincronizó los checkboxes de CA de `spec.md` con `tasks.md`; no cambia el estado de aceptación en sí |
| SPEC-003 | Tier frío | 006, 023, 033 | Parcial; operación/restore pendiente |
| SPEC-004 | Réplica y HA | 006, 032, 033 | Parcial; failover y gate DR pendientes |
| SPEC-005 | Push realtime | 002, 008, 031, 057, 179, 181, 200 | 9/9 tareas (100%, 2026-09-13) — bug real de query SSE corregido (ADR-179); pool de conexiones, test real de caída de réplica (con fix de `connect_timeout`) y prueba de carga real de 200 conexiones SSE (PASS), todo cerrado (ADR-181). ADR-200 (2026-09-19) agregó keepalive/ping activo y resync tras reconexión al WebSocket de alarmas (canal separado, no el SSE de este SPEC, pero mismo dominio de push realtime) |
| SPEC-006 | Auth/RBAC/multitenant | 029, 030, 036, 043, 058, 063, 066, 067, 076-078, 085-088, 100-102, 106-107 | Implementada; pentest externo pendiente |
| SPEC-007 | ReportStudio/export | 009-021, 046-053, 055, 064-065, 068-073, 079-084, 092, 097-098, 139, 172-174, 183-185, 199, 201, 204, 206 (act. 014, 051) | Implementada con regresiones abiertas; **elaboración post-T18 sin tasks.md propio** (motor de tablas ADR-172, importación Word ADR-173, capacidades de editor ADR-174, importación de PDF con OCR avanzado ADR-199, export nativo XLSX/PPTX/PDF ADR-201, fidelidad DOCX flujo/listas/tachado/hipervínculos ADR-204, WordArt/columnas/motor de tablas en PPTX ADR-206) — formalizada retroactivamente 2026-09-12 tras auditoría de conformidad, pendiente de spec/tasks.md formal. **Criterio O3 (export <5s) medido, optimizado, cerrado por decisión de negocio** (T15, 2026-09-13, ADR-183/184/185): benchmark real + 2 fixes reales (fuentes auto-hospedadas, `waitUntil` relajado) mejoraron 6-28% según tamaño, sin regresión en documento de 378 páginas/1120 gráficos — extrapola a ~24s para 50 páginas, sigue sobre el umbral literal de 5s de la SOW. Gerencia decidió (ADR-185) aceptar ese tiempo dado que el export es asíncrono y no bloquea al usuario; T15/SPEC-007 quedan al 100% (6/6) — desviación del valor literal documentada, no oculta |
| SPEC-008 | Biometría | 025, 029, 074, 089, 099, 105, 107, 141, 180 | Implementada, 7/7 tareas (100%, 2026-09-12) — certificación Dermalog hardware descartada por licencia comercial (ADR-180); calibración estadística formal (FMR/FNMR) sigue pendiente, ADR-141 (avatar por difusión) opt-in, CA-15 sin validar |
| SPEC-009 | GIS/mapas | 022, 026-028, 056, 072 | Implementada; pruebas offline de sitio pendientes |
| SPEC-010 | Fórmulas | 031, 034, 200 | Implementada. ADR-200 (2026-09-19) corrigió una consulta sin cota de tiempo contra `telemetry_multivariate` en `sensor_formula_evaluator.cpp`/`sensor_formula_routes.cpp` (mismo patrón que ADR-186, código posterior a esa auditoría) y batcheó el N+1 de lectura en `evaluateFormulasOnce` — sin verificación E2E en vivo todavía |
| SPEC-011 | IA de texto | 024, 068, 093-096 | Implementada; SLA depende del modelo/hardware |
| SPEC-012 | Conversión GDAL | 027, 072 | Implementada |
| SPEC-013 | Videovigilancia | 031, 034, 064-065 | 7/8 tareas (87,5%, 2026-09-13) — CRUD de cámaras y snapshot JPEG reales; T9-T10 (auto-refresh configurable + indicador offline con timestamp) implementados en `VideoDiagram.tsx`. Abierto: T15 (integración visión EPP, Etapa 2 por diseño desde el plan original, ligado a SPEC-017/ADR-025) |
| SPEC-014 | Offline y reconciliación | 022, 026, 045, 056 | 7/9 tareas (77,8%, 2026-09-13) — edición offline de Informes Técnicos implementada y verificada end-to-end desde 2026-07-13 por un camino distinto al `plan.md` original (SQLite/WASM + concurrencia optimista, no cola `sync_operations`/IndexedDB, divergencia documentada). CA-2, CA-3 y cobertura de test automatizado cerrados 2026-09-13 (ver act. ADR-022): CA-2 equivalencia analizada y confirmada; CA-3 bug real de trazabilidad de conflictos corregido; test coverage 0%→cubierto con `offlineSqlite.integration.test.ts` (13 tests, motor sql.js/WASM real + mock fiel de Cache API). Quedan solo 2 notas de divergencia permanentes (`plan.md`/`spec.md`), no son tareas |
| SPEC-015 | DR/continuidad | 032, 033, 059 | No aceptada; ejercicios RTO/RPO pendientes |
| SPEC-016 | Alertas | 002, 008, 031, 034, 057, 140, 186, 200 | 4/5 tareas (80%, 2026-09-13) — motor real de alarmas (ADR-034, extendido por ADR-140: cache, tasa de cambio, debounce, CRUD paginado). T1-T12 y Constitución (Art. 1/2/5/9) cerrados 2026-09-13 — Art. 5 tenía un gap real (sin métricas), corregido con `beemetry_alarm_engine_*` en `/api/metrics`. Al intentar el demo en vivo se encontró y corrigió un bug real de rendimiento (consulta de "último valor" sin cota de tiempo, colapsaba contra ~10.900 chunks de TimescaleDB — ADR-186, afecta también a un endpoint de dashboard general). ADR-200 (2026-09-19) batcheó el N+1 de lectura en `evaluateRulesOnce` (una query por grupo de tipo de regla en vez de una por regla) y agregó keepalive/resync al WebSocket de notificación. Abierto: demo en vivo de gate R5, bloqueado por RBAC (sesión disponible es rol `viewer`, no `alarmas.manage`) — ya no por código ni disponibilidad de sesión |
| SPEC-017 | Visión IA EPP | 025, 105, 110 | Deferred por ADR-025; no implementada |
| SPEC-018 | Dictado STT | 024, 068, 095 | Parcial/experimental |
| SPEC-019 | RP TimeTelemetry/Odoo | 103, 110 | Lectura real validada; integración con Odoo productiva pendiente (CA-4), reprogramada a Etapa 2 posterior a SPEC-007 |
| SPEC-020 | Telemetría 25k/s | 008, 023, 032, 108, 200 | Aceptada a 25k; 100k no aprobado. ADR-200 (2026-09-19) agregó índice `(tenant_id_sk, captured_at)` faltante en `telemetry_fact`, política de compresión/retención para `telemetry_fact_calc`/`telemetry_multivariate` (no tenían ninguna), amplió `telemetry_raw` de vuelta a `chunk_time_interval=6h`, y un `statement_timeout` de rol a nivel de BD como red de seguridad — migraciones (`db_scripts/107-110`) sin aplicar aún contra una BD real |
| SPEC-021 | Zonas y gráficos multiserie | 057, 109, 182 | 10/10 tareas (100%, 2026-09-13) — catálogo de 20 tipos de gráfico, export PDF/PPTX real verificado con 2 bugs reales corregidos (ADR-182) |
| SPEC-023 | Portabilidad/despliegue/restore | 033, 035, 111 | Utilidad 6/11; restore/CI/CD pendientes |
| SPEC-025 | Soporte/WhatsApp | 112-118, 122, 129, 137, 168 | Aprobado al alcance contractual (2026-09-11, ADR-168); sin tasks.md formal todavía; canal SMS de ADR-137 pendiente de cuenta Twilio comercial |
| SPEC-024 | Integración GEOCATMIN INGEMMET | 009, 026, 121, 123 | Implementada; acceso directo por unidad minera. `tasks.md` dado de alta 2026-09-12 (8/12, 66.7%) — parcial: falta búsqueda por Cuadrícula IGN/coordenadas y test automatizado de búsqueda/superposición/identify; catálogo declara 134 servicios REST, tiene 38 reales |
| **SPEC-026** *(propuesta, sin spec.md formal)* | Sitio público / marketing ("Home") | 171 | **Pendiente de alta formal** — entregado sin ADR/SPEC 2026-09-11, formalizado retroactivamente 2026-09-12 (ADR-171, nuevo ámbito `marketing`). Landing pública, roadmap, demo interactiva — 24+ componentes, sin `tasks.md`. Recomendación: dar de alta spec.md/plan.md/tasks.md formal en la próxima ventana de planificación, no bloqueante para producción (es contenido pre-login, no afecta el producto autenticado). |
| **SPEC-027** | Integración de sensores (directo + gateway) — cierre de pendientes | 034, 054, 108, 131, 136, 140, 186, 187, 188, 189, 190, 192 | **Alta 2026-09-16 (ADR-192)** — auditoría con datos reales de `sensors_db`: solo 3/78,780 sensores tienen credencial real (el resto es carga sintética de ADR-108 o semilla/demo), 0 fuentes Modbus/OPC-UA configuradas, 1 sola regla de alarma en todo el sistema, 1/27 plantillas de ADR-189 verificada contra dato real. `tasks.md` fasado (0-6), 12 de 22 tareas ejecutables sin bloqueo externo. 0/22 (0%) — recién dado de alta |

## Decisiones transversales

| Tema | ADR | Aplicación |
|---|---|---|
| Constitución/SDD y log canónico | 090, Constitución | SPEC-001–022 |
| IA multiagente, router, RAG y revisión | 004, 010, 011, 012 | Todo cambio asistido por IA |
| Seguridad y QA | 043, 058-061 | Todos los gates |
| Despliegue y operación | 033, 035 | R5/R6 y expansión LATAM |
| Accesibilidad/i18n | 091, 106, 075 (act. 2026-09-12) | Todas las interfaces nuevas |
| Shell de navegación autenticado | 040, 042, 095, 132, 175 | Toda vista post-login (refactor `NavBar.tsx`, sin cambio de contrato) |
| Deuda técnica catalogada, sin decidir | 176 | `authSessionManager.ts`, `pnpm-workspace.yaml` — evidencia y opciones, decisión de negocio pendiente |

## Conflictos y resolución al 2026-08-18

| Hallazgo | Resolución canónica |
|---|---|
| ADR-089 decía Dermalog primario; ADR-105 usa DeepFace+SilentFace | ADR-089 marcado parcialmente superseded; ADR-105 manda en prioridad |
| ADR-104 SeetaFace default | Superseded por ADR-105; solo rollback heredado |
| ADR-025 difiere EPP, pero SPEC-017 lo planifica | Sigue deferred; ADR-110 exige reactivación y evidencia antes de construir |
| ADR-035 describe LATAM, algunos planes lo tratan como hecho | F0 actual; F1-F4 sin código y sujetas a decisión de negocio |
| Material conceptual declara ROI/IA de campo | Se conserva como hipótesis; SPEC-022 inicia en 0% |
| Prueba 100k podría interpretarse como capacidad | ADR-108 prohíbe el claim; solo 25k está validado |

## Checklist pre-código

Toda rama debe identificar SPEC, ADR, criterios de aceptación, pruebas, agente,
modelo y rollback. El Router y el revisor deben consultar este registro y el
log canónico; ninguna copia histórica puede prevalecer.
