# Architecture Decision Records (ADRs)

Memoria arquitectónica persistente de Beemetry 2.0. Una decisión arquitectónica sin ADR **no existe**.

> Este es el **único log vigente**. Existe un segundo directorio,
> [`specs/adr/`](../../specs/adr/README.md) (12 registros, metodología SDD
> temprana bajo la marca "AURIXA"), que se conserva por trazabilidad histórica
> pero **no recibe decisiones nuevas** — marcado como tal desde 2026-07-13.

## Convención

- Numerados sin gaps: `NNN-slug.md`, **log único cronológico** (orden de decisión, no por tema).
- Cada ADR lleva un campo **`Ámbito`** que indica el dominio al que pertenece: `plataforma`,
  `core-iot`, `datos`, `reports`, `ia`, `geo`, `realtime`, `soporte` (y, a futuro, ámbitos de
  componentes nuevos). El índice de abajo se **agrupa por ámbito**; la numeración sigue siendo global.
- Plantilla mínima: **Contexto / Decisión / Consecuencias / Alternativas descartadas / Referencias**.
- Status: `proposed` | `accepted` | `implemented` | `superseded by NNN` | `deferred` | `partial`.
- Cambiar una decisión NO edita el ADR original: crea uno nuevo con `Supersedes ADR-NNN`, o agrega
  un bloque de "Actualización"/"Corrección de auditoría" fechado ARRIBA del texto original (nunca
  se borra la nota anterior — ver ejemplo real en ADR-022/034).
- Numeración cronológica: una decisión fundacional puede tener número alto (p.ej. ADR-031/034 refinan/reencuadran ADR-002).

> ¿Por qué log único + ámbito y no carpetas por dominio? Las carpetas fragmentarían la
> numeración global y la vista de orden, y complicarían las refs cruzadas entre dominios. El
> campo `Ámbito` da ownership de dominio sin romper el log único, y escala a componentes futuros.

## Índice de ADRs

> **Actualización 2026-09-11: 165 → 166 ADR.** A pedido explícito del
> developer de justificar formalmente el decomiso de InspireFace como motor
> biométrico secundario (licencia académica, sin permiso de despliegue
> comercial) y evaluar su reemplazo entre SeetaFace6Open y libfacedetection.
> Se agrega **ADR-166**
> (`decomiso-insightface-secundario-adopcion-seetaface6`, ámbito
> `ia`/`seguridad`/`biometría`/`plataforma`): investigando la licencia de
> InspireFace se encontró que **InsightFace** (`buffalo_l`) — el motor
> biométrico secundario que sí corre en producción desde ADR-089/099, no
> InspireFace, que nunca se desplegó — tiene la misma restricción de
> licencia no comercial en sus modelos pre-entrenados (verificado contra la
> página de licenciamiento de InsightFace y `deepinsight/insightface#2587`).
> ADR-166 decomisiona InsightFace, cierra formalmente la decisión comercial
> pendiente de ADR-144 (misma justificación, extendida), y adopta
> SeetaFace6Open (ya integrado desde ADR-104, licencia BSD verificada) como
> reemplazo. Se evaluó libfacedetection (BSD-3-Clause) y se descartó como
> sustituto directo: es únicamente un detector de rostros, sin componente de
> reconocimiento/embedding de identidad — no cumple el rol que hoy cumple
> InsightFace. Se agregan bloques de actualización fechados a ADR-089,
> ADR-099 y ADR-144 (sin editar su texto original) cruzando la referencia a
> ADR-166. Las cuentas `face_template_provider='insightface_onnx'`
> existentes son de prueba (entorno de desarrollo, confirmado por el
> developer) — se eliminan o reinscriben sin impacto de negocio; el wiring
> de implementación (retirar la llamada auxiliar de `face_analysis.cpp`,
> quitar la dependencia `insightface` de `ai_engine`) queda pendiente,
> documentado en el propio ADR-166, fuera de alcance de esta pasada
> (decisión de producto/licencia, no cambio de código).

> **Auditoría 2026-09-10: 140 → 165 ADR de archivo (000-165, huecos reales en
> 151 y 152 — no existen esos dos números).** A pedido explícito del developer
> de revisar todas las mejoras/actualizaciones del proyecto, actualizar los
> ADR, verificar compatibilidad sin conflictos de implementación y cerrar lo
> cerrable para sustentar el cronograma ante Gerencia. Alcance de esta pasada:
> auditoría **estática** (lectura de código/ADR/specs; sin build, sin levantar
> el stack ni pruebas E2E — decisión explícita del developer para esta
> sesión). Hallazgos, de mayor a menor impacto:
>
> 1. **25 ADR nuevos desde el 2026-09-02 (141-165), todos ámbito `ia`/
>    `plataforma`, ninguno commiteado todavía**: cubren cuatro frentes —
>    avatar generativo (074→141→155→157→158→159→164, más 150/160 de avatar
>    animado/cuerpo completo), endurecimiento de liveness/anti-spoofing
>    (142→145→146→148→149→153→156, más 143/144 como infraestructura/
>    evaluación), guardrails de registro (147/153/154/161) y tooling
>    MediaPipe/ONNX (162/163/165). **No se encontraron conflictos de decisión
>    incompatible** entre estos 25 ADR ni contra el resto del log vigente — la
>    cadena de liveness es secuencial/en capas tal como se documenta a sí
>    misma (145 revierte explícitamente el conteo de frames de 142; 149
>    reabre explícitamente la secuencia de 148), no decisiones duplicadas.
> 2. **ADR-144 (`inspireface-evaluacion-licencia-academica`) existía completo
>    en disco pero no tenía fila en esta tabla** — mismo patrón de brecha de
>    trazabilidad que este log viene encontrando desde julio; agregada hoy a
>    la tabla `ia`. El resto de la tanda 141-165 (excepto 144) ya había sido
>    agregada a las tablas por ámbito en sesiones anteriores sin un bloque de
>    auditoría propio que lo narrara — este bloque cierra esa brecha
>    narrativa.
> 3. **Error real de referencia cruzada, no un conflicto de arquitectura**:
>    ADR-146, 148, 149 y 156 citan "ADR-143" como origen del parpadeo natural
>    pasivo — pero ADR-143 es `silentface-servicio-aislado-cudnn` (aislamiento
>    de proceso, sin relación); el ADR correcto es **145**
>    (`parpadeo-natural-simultaneo-5-lecturas`). ADR-158 sí cita 145
>    correctamente. No se edita el texto original de los 4 archivos en esta
>    pasada (auditoría estática, no se tocó el código ni se abrió cada archivo
>    para reescribirlo) — queda documentado acá para que quien commitee esta
>    tanda corrija la cita antes de mergear, evitando que quien navegue desde
>    esos 4 ADR llegue al archivo equivocado.
> 4. **Brecha de coordinación real, no una decisión contradictoria**: ADR-156
>    documenta sin resolver un bug real del heurístico de lentes ("con esa
>    combinación la sesión marcada `con_lentes` no puede volver a salir de esa
>    condición nunca", pendiente de rediseño); ADR-163/165 reentrenan y
>    afinan el mismo clasificador ONNX de lentes en el mismo período (v4
>    documenta un sesgo real de 31,4% de falsos positivos hacia "con lentes")
>    sin que ninguno de los dos cite al otro pese a tocar la misma ruta de
>    código. Ninguno de los tres ADR queda cerrado por esta observación — se
>    documenta para quien mantenga biometría, no se resuelve unilateralmente.
> 5. **Resumen del ámbito `ia` desactualizado** (línea de subtotal al final de
>    la tabla): decía 29 ADR, la tabla real tiene 35 filas hoy — corregido con
>    nota de auditoría fechada arriba de la línea original, sin editarla
>    (misma convención de este log).
> 6. **`specs/REGISTRY.md` con banner desactualizado**: declara "ADR-000 a
>    ADR-128" (corregido la última vez el 2026-08-21) pero su propia fila de
>    SPEC-008 ya cita ADR-141 — el banner no se actualizó junto con el
>    contenido. No es un conflicto de decisión, es el mismo patrón de
>    documentación rezagada que este archivo. Corrección de rango pendiente
>    para quien mantenga `specs/`.
> 7. **Métrica de ejecución recalculada hoy**:
>    `scripts/project-status-metrics.ps1` → **118/201 = 58,7%** (subía desde
>    117/200 = 58,5% del 2026-09-02: +1 tarea, +1 total en 8 días). Por etapa:
>    R2-Jul 11/11 (100%), R3-Ago 56/69 (81,2%, subía desde 75,8% al cierre
>    formal del gate el 31-ago — **sin evidencia en este árbol de que se haya
>    publicado el acta de gate R3** que el informe del 30-ago pedía como
>    decisión de Gerencia), R4-Sep 41/62 (66,1%, gate vence 2026-09-30, **20
>    días desde hoy**), R5-Oct 31/73 (42,5%).
> 8. **Ningún informe de estado formal
>    (`docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_*`) desde el
>    2026-08-30** — 11 días sin corte gerencial pese a 25 ADR nuevos y 3
>    subsistemas nuevos (`avatar_animation_engine`, `silentface_engine`,
>    fotocheck). `CHANGELOG.md` sigue sin tocar desde el 2026-08-21 (20 días).
>    Ver el dashboard gerencial de esta fecha para el detalle de avance mes a
>    mes y las decisiones pendientes de Gerencia — mismas 8 preguntas del
>    informe del 30-ago, ninguna con respuesta registrada en este árbol
>    todavía, más la autorización de producción de ADR-141/143 y la decisión
>    de licencia comercial de ADR-144.
> 9. **Riesgo de trazabilidad sin cambios de fondo desde el 30-ago, mayor en
>    volumen**: 62 archivos modificados + 165 sin rastrear sin commitear
>    (incluye los 25 ADR de este bloque). De los no rastreados, ~30 son
>    archivos personales ajenos al proyecto en la raíz del repo (CVs, exámenes
>    técnicos, hojas de candidatos) mezclados con el árbol de trabajo real —
>    no es un hallazgo de arquitectura, pero se señala porque un
>    `git add`/commit descuidado los subiría al repositorio del proyecto.
>
> **Conclusión de esta pasada**: no hay conflictos de arquitectura entre
> decisiones — todos los hallazgos son de higiene documental (fila faltante,
> referencia cruzada mal citada, resumen desactualizado, banner rezagado) o de
> coordinación entre ADR que tocan el mismo código sin citarse. Lo que sí
> bloquea "cerrar sprints" no son los ADR (25/25 de esta tanda tienen decisión
> y evidencia de código propia, aunque varios con verificación en cámara/GPU
> real todavía pendiente) sino la falta de decisión de Gerencia sobre R3/R4 y
> el trabajo sin commitear — ver §7-9 arriba.

> **Auditoría 2026-09-02: 137 → 139 ADRs de archivo.** A pedido explícito del
> developer de investigar a fondo el estado del proyecto, qué ADR faltan por
> actualizar, qué decisiones siguen pendientes y qué se puede cerrar para
> avanzar más rápido, sin introducir conflictos con el log vigente. Hallazgos,
> de mayor a menor impacto:
>
> 1. **ADR-139 nuevo** (`exportacion-docx-nativa-cliente`, ámbito `reports`):
>    pipeline completo de exportación a `.docx` real (OpenXML vía librería
>    `docx`+`jszip`, 5 archivos en `frontend/.../lib/docx/`) existía sin ADR —
>    100% client-side, sin endpoint backend nuevo, divergencia consciente del
>    patrón "export server-side canónico" de ADR-016. Verificado con su propio
>    test unitario: `buildReportDocx.test.ts` **9/9 tests passed** (corrido
>    junto con `reportShareLink.test.ts` y `sensorMultiChartLayout.test.ts` en
>    el mismo lote). Sin verificación E2E de apertura en Word/LibreOffice real
>    — queda documentado como pendiente en el propio ADR.
> 2. **ADR-109 recibe un bloque de actualización** (no se edita el texto
>    original): la prueba anti-IDOR que la Decisión §6 declaraba pendiente ya
>    existe (`backend/tests/test_sensor_anti_idor.cpp`, nuevo); el catálogo de
>    gráficos del widget multiserie creció a mapa geográfico (Leaflet),
>    superficie 3D (`@react-three/fiber`) y combinado línea+barra con eje
>    secundario — los tres cableados de punta a punta (`ChartTypePicker.tsx`,
>    `SensorMultiChartInspector.tsx`, `App.tsx`), lo que **contradice
>    directamente** la frase original "no se declara todavía exportación 3D
>    dentro del documento". Ninguno de los tres tiene verificación en vivo de
>    render/export con datos reales todavía.
> 3. **Regresión real de `tsc` encontrada y parcialmente cerrada**: `npx tsc
>    --noEmit` sobre el árbol actual arroja 3 errores — 2 nuevos en
>    `SensorSurface3DPanel.tsx` y 1 preexistente (no introducido en esta
>    sesión) en `Viewer3D.tsx`, los tres por una duplicación real de
>    `@types/three` (`0.183.1` top-level vs. `0.185.4` resuelto vía `.pnpm/`
>    — el árbol tiene una mezcla real de instalación npm+pnpm,
>    `pnpm-workspace.yaml` nuevo sin commitear). `npx vite build` (Rolldown)
>    compila igual — mismo patrón exacto que ADR-093 ya cerró una vez
>    (gap esbuild/Rolldown-vs-`tsc`), reabierto acá en archivos distintos; no
>    corregido en esta pasada porque requiere decidir versión objetivo de
>    `@types/three` o consolidar en un solo gestor de paquetes (npm o pnpm,
>    no ambos a la vez) — decisión de tooling, no de arquitectura, se deja
>    para quien mantenga el toolchain de `frontend/`. De paso, investigando
>    este hallazgo, se encontró y **corrigió** un bug real independiente en
>    `GeocatminWorkbench.tsx` (ADR-121): leía `remote.location_zoom` y
>    `remote.company_name`, campos que `GET /api/map/company-location` nunca
>    devuelve (el campo real es `zoom`, sin `company_name`) — el zoom
>    configurado por el admin para la mina del tenant nunca se aplicaba
>    dentro del Geoportal, siempre caía al valor por defecto `14`. Corregido a
>    `remote.zoom`; verificado que los 2 errores de `tsc` de ese archivo
>    desaparecen y que `company_name` no era necesario (ya existía
>    `activeCompanyName` como fuente correcta).
> 4. **El bug del `Cutoff` hardcodeado de `scripts/project-status-metrics.ps1`
>    (señalado en la auditoría 2026-08-30 de abajo) ya está corregido** en el
>    árbol de trabajo actual (usa `Get-Date` dinámico, sin commitear todavía).
>    Corrido hoy: **113/200 = 56,5%** (antes 106/196 = 54,1% al 18/30-ago) —
>    avance real de +7 tareas/+4 al total en los `specs/*/tasks.md` de 003,
>    004, 006, 008, 009, 011, 013 y 021 (todos modificados sin commitear). Las
>    specs 014 (offline+reconciliación de campo), 015 (DR/continuidad), 016
>    (alertas por umbral, tabla `alert_rules`/SSE — **distinta** del sistema
>    de alarmas de dispositivo ya implementado en `alarm_notifier.cpp`/
>    `device_alarm_routes.cpp`, no verificado si son redundantes o
>    complementarias), 017 (EPP, diferida por diseño desde ADR-025) y 018
>    (dictado por voz) siguen en 0%; 022 (offline+ERP) sigue en 0%,
>    consistente con ADR-110 `proposed`.
> 5. **No se encontraron conflictos de decisión incompatible** entre ADR-130 a
>    139 y el resto del log vigente — mismo resultado que ya reportó la
>    auditoría 2026-08-30 de abajo, ahora extendido a incluir 138/139. Los
>    `db_scripts/72` a `88` sin commitear se verificaron contra sus ADR
>    citados (72→130, 74-79→131, 81→135, 86→137, 87→136, 88→138); `73` y
>    `80`-`85` son hallazgos operativos/seeds de datos ya autodocumentados en
>    su propio encabezado SQL, no decisiones de arquitectura nuevas.
>
> **Auditoría 2026-09-02 (segunda pasada, mismo día): ejecución del plan de
> cierre acordado con el developer.** Dos verificaciones reales, no solo
> lectura de código:
> 1. **Build de verificación del backend, nunca corrido antes sobre este
>    árbol**: `docker build -f backend/Dockerfile.verify --no-cache` (contexto
>    `backend/`) compiló limpio — target completo `beemetry_backend` (todos
>    los módulos nuevos sin commitear: `mfa_routes`, `org_access_routes`,
>    `totp`, `simulation_status_routes`, `report_share_links`,
>    `security_alerts`) y `beemetry_backend_tests` (Catch2): **742
>    aserciones en 50 test cases, 100% passed**. Confirma con evidencia de
>    build real (no solo lectura) que ADR-130, 133-138 y la actualización de
>    109 se apoyan en código que efectivamente compila junto.
> 2. **Prueba anti-IDOR de SPEC-021 T7 cerrada**: `resolveAllowedSensorTenant`
>    se extrajo de `sensor_service.cpp` a `sensor_tenant_resolver.cpp` (unidad
>    de compilación propia, ver actualización de ADR-109) para que
>    `test_sensor_anti_idor.cpp` compile en el target liviano de tests sin
>    arrastrar la cadena OpenCV/ONNX que había bloqueado el intento del
>    2026-08-30. Las 742 aserciones de arriba ya incluyen sus 4 casos.
> 3. **Auditoría de checkboxes canónicos** (los que sí cuenta
>    `scripts/project-status-metrics.ps1`, no las tablas T1-T20 con "☐") sobre
>    11 specs con avance intermedio (003, 004, 005, 007, 008, 009, 011, 012,
>    013, 021, 023), hecha con 3 pasadas independientes evidencia-primero: se
>    cerró **1** checkbox real (spec 007, T12/T13 — editor Tiptap/Konva ya
>    implementado, ADR-010/013, y autoguardado real vía `autosaveEngine.ts`) +
>    el T7 de spec 021 ya contado en el punto 2. El resto de los ítems
>    abiertos revisados (specs 003, 004, 005, 008, 009, 011, 012, 013, 023) se
>    confirmaron genuinamente abiertos con evidencia negativa específica por
>    ítem (sin inferencia) — ver el detalle en cada `tasks.md`. Hallazgo
>    notable sin resolver unilateralmente: spec 005 (`push-sse-tiempo-real`)
>    exige HTTP 503 ante réplica caída, pero el código real
>    (`handleLiveKpiSse`, `main.cpp`) hace fallback a la primaria con
>    `degraded:true` — el mismo patrón que spec 002 ya acepta como cerrado
>    para su ítem equivalente. Posible inconsistencia de texto entre specs
>    002/005, no de código; queda para quien decida si se homologa el texto o
>    se exige 503 literal.
> 4. Métrica recalculada tras estos cierres:
>    `scripts/project-status-metrics.ps1` — **115/200 (57,5%)**, subiendo
>    desde 113/200 (56,5%) al inicio de esta pasada.
>
> **Auditoría 2026-09-02 (tercera pasada, mismo día): Fase C/D del plan de
> cierre acordado con el developer — motor de alarmas de SPEC-016.**
> **ADR-034 recibe un bloque de actualización** reconciliando su motor de
> alarmas ya implementado con el diseño que SPEC-016 describía (evaluación
> embebida en Kafka + SSE, nunca construido tal cual) contra la arquitectura
> real (hilo de fondo por polling + push WebSocket). Se agrega **ADR-140**
> (`alertas-umbral-cache-tasa-debounce-sensor`, ámbito `core-iot`/
> `plataforma`) cerrando 5 de las 6 brechas reales que quedaban: cache de
> reglas con TTL 60s (T3/T12), condición por tasa de cambio (T4),
> debounce por ventana de tiempo (T5, complementa — no reemplaza — el índice
> único parcial ya existente), `PUT /api/mining/alarms/rules/{id}` (T9), y
> paginación + filtro de severidad en `GET /api/mining/alarms` (T10).
> Verificado con `docker build -f backend/Dockerfile.verify` limpio: **762
> aserciones en 59 test cases, 100% passed** (subiendo de 742/50 tras Fase A
> — incluye `test_alarm_rule_evaluator.cpp`, nuevo, cubriendo los 5
> operadores de umbral, fail-closed ante operador desconocido, cálculo de
> tasa y las 4 combinaciones de la ventana de debounce). El canal SSE
> dedicado que SPEC-016 pedía (T7/T8) se documenta como decisión consciente
> de NO construirse — el push real ya es WebSocket, duplicarlo no tiene
> pedido de negocio. `specs/016-alertas-umbrales-sensores/tasks.md` se
> actualiza en su tabla completa (11/12 de T1-T12, el resto T7/T8) y su
> Definition of Done sube de 0/5 a 1/5 (el ADR ya está registrado; los
> ítems de evidencia con medición en vivo — CA-1 latencia, CA-3 tiempo
> real, demo de Gate R5 — quedan honestamente sin marcar, requieren un
> entorno con Postgres/stack corriendo, no ejecutado en esta pasada). Métrica
> recalculada: **116/200 (58,0%)**.
>
> **Auditoría 2026-09-02 (cuarta pasada, mismo día): Fase E — deduplicación
> npm/pnpm.** El árbol de `frontend/` tenía una instalación mixta real (
> `package-lock.json` trackeado, pero `node_modules` con estructura `.pnpm/`
> de una instalación pnpm posterior, `pnpm-workspace.yaml` nuevo sin
> commitear) — causa raíz de los 3 errores de `tsc` que la segunda pasada de
> hoy documentó (2 en `SensorSurface3DPanel.tsx`, 1 preexistente en
> `Viewer3D.tsx`). Se borró `node_modules` + `pnpm-workspace.yaml` (ninguno
> commiteado, nada que perder) y se reinstaló limpio con `npm install`
> (735 paquetes, único gestor). Verificado: `npx tsc --noEmit` → **0
> errores** (antes 3); `npx vite build` → verde; 4 suites de Vitest
> (`buildReportDocx`, `reportShareLink`, `sensorMultiChartLayout`,
> `authApi`) → **24/24 tests passed**. No cambia el % de checkboxes
> (tooling, no producto).
>
> **Auditoría 2026-09-02 (quinta pasada, mismo día): Fase F — verificación
> E2E en vivo contra el stack real.** `docker compose build web` + redeploy
> de `beemetry-api` con TODO el código de esta sesión (Fases A-D incluidas);
> arrancó sin errores, `[ALARM-ENGINE] Evaluador iniciado` en el log. Se
> aplicó a mano `db_scripts/89` (no se auto-aplica sobre un volumen ya
> corriendo, patrón conocido de este proyecto). Con sesiones reales de dos
> tenants demo (`db_scripts/51`) se verificó en vivo: CRUD completo de
> reglas de alarma (incl. `condition_type`/`debounce_secs` nuevos), un ciclo
> real del evaluador creando una alarma a partir de un valor real en BD, ack
> real, paginación real, y **aislamiento multitenant con dos usuarios
> reales** (un tenant no ve ni puede borrar la regla del otro — 404, no
> 200/403). Detalle completo en la actualización de ADR-140. Hallazgo real
> encontrado (no corregido, documentado): la SLA "<2s" que SPEC-016 pedía
> para CA-1 es estructuralmente incompatible con el intervalo de polling de
> 10s que ADR-034 ya había decidido deliberadamente — queda para Gerencia
> decidir si se baja el intervalo o se redefine la métrica. No se probaron
> ADR-137 (4 canales de notificación — requiere credenciales reales de
> WhatsApp Business/SMTP que no están disponibles en este entorno) ni
> ADR-139 (abrir el `.docx` en un lector real — requiere flujo de navegador
> completo con un informe real, no ejecutado por presupuesto de tiempo de
> esta pasada). Métrica sin cambios respecto a la pasada anterior: **116/200
> (58,0%)** — la verificación en vivo confirmó evidencia real pero no marcó
> checkboxes nuevos que ya no estuvieran justificados por diseño.
>
> **Auditoría 2026-09-02 (sexta pasada, mismo día): evaluación de alarmas en
> tiempo real — a pedido explícito del developer.** El hallazgo de la pasada
> anterior (SLA "<2s" de CA-1 incompatible con el polling de 10s de
> ADR-034) se cerró implementando la opción de evaluación por evento que
> SPEC-016 pedía originalmente: `TelemetryIngestor::copyBatch()`
> (`telemetry_ingest.hpp/cpp`) gana un hook `setOnBatchCommitted()`,
> invocado justo después del `COMMIT` de cada lote (nunca antes, para no
> generar alarmas fantasma de un lote que pudiera hacer rollback),
> envuelto en `try/catch` para que nunca pueda tumbar la ingesta de 25k/s.
> `device_alarm_routes.cpp` registra el nuevo camino, que evalúa reglas de
> `sensor_id` real contra el valor ya en memoria del lote (sin volver a leer
> Postgres) usando la MISMA función que ya usaba el polling (extraída como
> pieza compartida, `evaluateRuleAgainstValue`). El polling de 10s sigue
> intacto como red de seguridad y como única vía para reglas de
> `mining_sensor_id` (el dashboard de simulación no pasa por
> `TelemetryIngestor`). Se encontró y corrigió, en la misma pasada, un bug
> real de la primera versión: el índice `sensor_id → reglas` no se
> refrescaba antes de mirarlo, así que una regla recién creada no era
> visible hasta el próximo ciclo de polling — exactamente la latencia que
> se quería eliminar. **Verificado en vivo con timestamps exactos** (no
> aproximados): regla creada → lectura real empujada 1s después → alarma
> con `triggered_at` **179ms** después del push, contra `beemetry-api`/
> `beemetry-db` reales tras rebuild y redeploy completos. Build de
> verificación limpio en las 3 iteraciones de esta pasada (762 aserciones,
> 100% passed, sin cambios en el conteo — el cambio no agregó tests nuevos
> propios, reutiliza la cobertura ya existente). `specs/016/tasks.md`
> actualizado: T15 cierra con evidencia real; el ítem "CA-1..6 demostrados"
> del Definition of Done pasa a solo depender de CA-6 (prueba de carga real,
> T20, sin hacer). Métrica de checkboxes sin cambios: **116/200 (58,0%)**
> (T15 es una tarea de la tabla, no del Definition of Done contado por el
> script).
>
> **Auditoría 2026-09-02 (séptima pasada, mismo día): cierre de 4 ítems más,
> a elección explícita del developer entre las opciones restantes del plan.**
> Con el stack real corriendo (backend redesplegado con el código de hoy) y
> sesiones reales de los tenants demo:
> 1. **ADR-130 cierra su E2E pendiente**: grant/revoke de acceso cruzado
>    probado con dos tenants `organization` reales, un tenant `mining_client`
>    real, y un guardia negativo confirmado (`403` a un tenant minero que
>    intenta auto-otorgarse la capacidad). Ver actualización en el ADR.
> 2. **SPEC-016 T20 cierra**: prueba de carga real, 100 lecturas
>    concurrentes cruzando el umbral en 1.31s → exactamente 1 alarma
>    (debounce + índice único trabajando juntos bajo carga real, no solo en
>    el test unitario). Con esto, el Definition of Done "CA-1..6
>    demostrados" de SPEC-016 se marca completo (CA-3 excepción de diseño
>    documentada, sin canal SSE). Métrica: **117/200 (58,5%)**.
> 3. **ADR-139 cierra su E2E pendiente**: export DOCX real interceptado
>    desde el navegador (`URL.createObjectURL` parcheado) y validado
>    estructuralmente EN EL NAVEGADOR (sin relayar el binario por texto, que
>    resultó frágil para ~11KB de base64) — ZIP + 26 partes OOXML reales +
>    `word/document.xml` descomprimido con `DecompressionStream` nativo y
>    XML bien formado. No se abrió en una instalación real de Word (no
>    disponible en este entorno), pero la validación estructural completa es
>    una prueba más fuerte que una apertura visual sin inspección de
>    contenido.
> 4. **ADR-137 sube de 0/4 a 2/4 canales verificados en vivo**: `in_app` y
>    `email` confirmados con filas reales en `notification_dispatch_log`
>    (`status=sent` en ambos) — el hallazgo de que había SMTP real
>    configurado en este entorno fue una sorpresa, no algo asumido de
>    antemano. `whatsapp` falló por falta de teléfono en el usuario de
>    prueba (dato, no necesariamente credenciales); `sms` confirmado
>    genuinamente sin proveedor configurado (con evidencia de una fila
>    histórica del 2026-08-29). Ninguno de los dos se declara cerrado.
>
> Sin cambios de código en esta pasada — las cuatro verificaciones fueron
> puramente de investigación/prueba en vivo contra código y ADR ya
> existentes. Métrica final de la sesión: **117/200 (58,5%)**.
>
> Pendientes de decisión de Gerencia que siguen abiertos sin cambios en esta
> pasada (no se resuelven unilateralmente aquí): pentest externo sin agendar,
> dominio de producción para `BEEMETRY_CORS_ALLOWED_ORIGIN`, notificación
> retroactiva a tenants preexistentes al fix crítico de ADR-134, sprint/SPEC
> formal para el ámbito `soporte` completo (SPEC-025), y si el cómputo de
> `telemetry_fact_calc` (ADR-136) migra al backend C++ cuando deje de ser un
> script interino.

> **Auditoría 2026-08-20: 119 → 120 ADRs.** Brecha de trazabilidad real
> encontrada al analizar el árbol de trabajo actual (proyecto minero +
> sistema de soporte de campo): **ADR-103, 106 y 112-118** existían como
> archivos completos en `docs/decisions/` (redactados entre 2026-08-09 y
> 2026-08-19) pero **ninguno tenía fila en este índice**, y el ámbito
> `soporte` — declarado en la cabecera de los 7 ADR del bot de WhatsApp/chat
> web de campo (112-118) — no tenía sección propia en la tabla por ámbito,
> pese a que la convención de arriba solo mencionaba `plataforma, core-iot,
> datos, reports, ia, geo, realtime`. Se agregan las filas faltantes de
> 103/106 a sus tablas existentes y una tabla nueva "### Ámbito `soporte`"
> más abajo con 112-118. Se agrega **120**
> (`lote-lineas-lectura-tls-mining-gateway`, ámbito `core-iot`): decisión
> real sin ADR encontrada en `backend/src/mining/mining_gateway.cpp`
> (`MiningSession::read_line` agrupa hasta `max_lines_per_read` líneas por
> `async_write`, reduciendo E/S por sesión bajo ráfaga) — operaba por debajo
> de la topología de consumidores que sí cubre ADR-108, sin ADR propio hasta
> ahora. Se corrigieron además, con bloque de actualización fechado (sin
> editar el texto original, misma convención de este log): **ADR-109**
> citaba `backend/src/reports/sensor_telemetry_wizard.*` (ruta inexistente;
> el archivo real vive en `backend/src/mining/`) y un rango de `db_scripts/`
> que era ambiguo por una colisión de numeración real (**dos** archivos
> `54_*.sql` — `54_sensor_zones_and_grouping.sql` y
> `54_deepface_silentface_provider_comment.sql` — y **dos** `56_*.sql` —
> `56_seed_realistic_sensor_catalog_all_tenants.sql` y
> `56_telemetry_25k_hardening.sql`, este último ajeno a ADR-109; resuelta en
> la segunda pasada de abajo); **ADR-116** declaraba la persistencia del
> chat web y los endpoints de búsqueda como pendientes, pero
> `persistChatMessagePg` ya está conectado en `main.cpp`/`support_routes.cpp`
> y `handleSearchTickets`/`handleSearchChatMessages` ya están registrados —
> verificado por grep directo sobre el código real, no solo por lectura del
> propio ADR.
>
> **Auditoría 2026-08-20 (segunda pasada, mismo día): resolución de la
> colisión de numeración en `db_scripts/`.** A pedido explícito del
> developer ("no quiero pendientes"), se investigó a fondo el hallazgo de
> arriba y resultó ser **más grande de lo reportado inicialmente**: no eran
> 2 pares duplicados, eran **4** — `db_scripts/` también tenía dos archivos
> `29_*.sql` (`29_mining_locations_official_gps.sql`,
> `29_telemetry_ingest_optimization.sql`) y dos `44_*.sql`
> (`44_adr006_alinear_retencion_archivado.sql`,
> `44_report_export_narration.sql`) ya **commiteados** desde sesiones
> anteriores, sin que ningún ADR previo los hubiera señalado. Se renombraron
> los 4 archivos "perdedores" (el más nuevo de cada par, o el de decisión
> más reciente cuando ambos se commitearon juntos) a los siguientes números
> libres, conservando contenido íntegro:
> - `29_telemetry_ingest_optimization.sql` → **`64_telemetry_ingest_optimization.sql`**
>   (`29_mining_locations_official_gps.sql`, más antiguo, conserva `29`).
> - `44_report_export_narration.sql` → **`65_report_export_narration.sql`**
>   (`44_adr006_alinear_retencion_archivado.sql`, decisión más antigua —
>   ADR-006 — conserva `44`). De paso se corrigió su comentario interno,
>   que seguía diciendo "ADR pendiente" pese a estar cerrado por ADR-083/084.
> - `54_deepface_silentface_provider_comment.sql` → **`66_deepface_silentface_provider_comment.sql`**
>   (`54_sensor_zones_and_grouping.sql`, de ADR-109, conserva `54`).
> - `56_telemetry_25k_hardening.sql` → **`67_telemetry_25k_hardening.sql`**
>   (`56_seed_realistic_sensor_catalog_all_tenants.sql`, de ADR-109, conserva
>   `56`).
>
> `docker-compose.yml` montaba `29_telemetry_ingest_optimization.sql` y
> `56_telemetry_25k_hardening.sql` por ruta literal en
> `docker-entrypoint-initdb.d` — de no corregirse, el rename habría roto el
> primer arranque de un volumen `db_data` nuevo; se actualizaron ambas
> líneas de montaje a los nombres nuevos y se verificó que ningún otro
> compose/Dockerfile/script de aplicación referenciaba los 4 nombres
> viejos. Todas las menciones en prosa encontradas (ADR-084, ADR-109,
> `specs/002-dashboards-tiempo-real/`, `specs/003-tier-frio-historico/`,
> `MIGRACION_NUEVA_LAPTOP_2026-08-12.md`, planificación de Gerencia TI) se
> actualizaron al nombre nuevo. Verificado tras el rename: `ls db_scripts/*.sql`
> ya no tiene ningún número repetido.
>
> **Auditoría 2026-08-18: 108 → 112 ADRs (000-111).** Se agregaron ADR-108
> (capacidad demostrada de telemetría 25k/s y prohibición de afirmar 100k sin
> nueva evidencia), ADR-109 (zonas/catálogo y gráficos multiserie) y ADR-110
> (propuesta de operaciones de campo offline e integración ERP) y ADR-111
> (portabilidad export/import, sin confundirla con DR/CI-CD aceptados). Se resolvió
> el conflicto de prioridad biométrica: ADR-105 supersede parcialmente a
> ADR-089; DeepFace+SilentFace es el default y Dermalog queda secundario bajo
> fail-closed. SPEC-017/EPP continúa deferred por ADR-025. El registro maestro
> vigente se actualizó a 23 SPEC y excluye aliases históricos del conteo.

> **Auditado al 2026-07-13**: 46 ADRs (000-045). La columna Status de esta
> tabla se corrigió para reflejar el estado REAL verificado en cada archivo
> (antes decía "proposed" para casi todos los ADRs 000-035, aunque la
> mayoría ya estaban implementados y verificados en sesiones anteriores —
> la tabla índice había quedado desactualizada respecto al contenido real
> de cada ADR). `implemented` = verificado contra código/stack real
> (rebuild, logs, DB, o navegador real), no solo "se escribió el código".
> Ver el reporte de progreso del proyecto de reportabilidad más abajo.
>
> **Actualización 2026-07-17**: 46 → **54 ADRs**. Se agregaron 8 (046-053),
> todos ámbito `reports`: 4 formalizan decisiones que el código ya tenía
> implementadas desde antes de esta fecha pero sin ADR escrito (046-049 —
> encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y
> 4 documentan trabajo nuevo de esta sesión (050-053 — formato de texto por
> selección, copiar/pegar, navegación/zoom/página, estilos de tabla). De
> paso se corrigió una divergencia real entre documentación y código:
> ADR-010/013 declaraban Tiptap/ProseMirror-JSON para el texto de
> ReportStudioV2, pero el código real (desde antes de esta sesión) usa
> string plano — ver el bloque de "Actualización 2026-07-17" agregado a
> ambos ADR (no se editó el texto original, según la convención de este
> log) y el detalle completo en ADR-050.
>
> **Actualización 2026-07-17 (segunda pasada, mismo día)**: 54 → **55 ADRs**.
> Se agregó ADR-054 (`sync-thingsboard-legacy-aws`, ámbito `core-iot`),
> implementando el entregable "sync inicial con AWS" del release R2 —
> confirmado como una instancia ThingsBoard real, no un servicio AWS
> genérico. No hay conflicto con ADR-034: esa decisión ya anticipaba
> explícitamente que "ThingsBoard puede convivir detrás del gateway mientras
> se estrangula" y solo descartaba el híbrido *permanente*, no la
> coexistencia transitoria — ADR-054 es la implementación concreta de esa
> coexistencia. De paso se encontró y corrigió un bug real preexistente en
> `TelemetryIngestor::enqueue()` (ADR-008): en modo Kafka nunca producía al
> bus, dejando filas varadas en memoria sin insertar ni reportar error — ver
> el bloque de "Actualización 2026-07-17" agregado arriba del texto original
> de ADR-008. Ambos hallazgos se verificaron con una prueba de carga real de
> 6.000.000 de puntos en 10 minutos (~10.000/seg sostenidos) contra un
> ThingsBoard local aislado: 0 errores, 0 pérdida en cola, réplica
> `db_replica` sincronizada al 100% al cierre.
>
> **Actualización 2026-07-20**: 55 → **59 ADRs**. `CHANGELOG.md` ya
> documentaba, con fecha y evidencia de verificación E2E, cuatro bloques de
> trabajo de los días 2026-07-18/19 citándolos como "ADR-055" a "ADR-058" —
> pero ninguno tenía todavía un archivo real en este directorio ni fila en
> este índice (brecha de trazabilidad detectada en la auditoría de
> arquitectura del 2026-07-20, ver el informe de avance de esa fecha). Se
> formalizaron los cuatro con esos mismos números, sin reordenar ni
> renumerar nada ya citado en commits/changelog: **055**
> (`editor-indicador-seleccion-propio`, ámbito `reports`, 2026-07-18),
> **056** (`csp-service-worker-tiles-mapa`, ámbito `geo`, 2026-07-18),
> **057** (`dashboard-widgets-estilo-thingsboard`, ámbito `realtime` —
> primer ADR real de ese ámbito, reservado desde 2026-07-13 sin ADR propio
> hasta hoy, 2026-07-19), **058**
> (`auditoria-seguridad-integral-jul2026`, ámbito `plataforma`, 2026-07-19).
> Se revisó cada uno contra los ADR ya existentes buscando contradicciones:
> ninguna encontrada — 056 extiende el hardening de ADR-043 sin reabrirlo,
> 057 inaugura `realtime` sin chocar con ADR-031, y 058 documenta (dentro de
> su propio bloque PENDIENTE) la misma divergencia de ADR-029 (refresh token
> en `localStorage`) que ya se había cerrado ese mismo día con su propia
> actualización — ver ADR-058 § PENDIENTE para la referencia cruzada
> explícita entre ambos.
>
> **Actualización 2026-07-21**: 59 → **61 ADRs**. Se agregaron **059**
> (`plan-maestro-pruebas-qa`) y **060** (`framework-pruebas-backend-catch2`),
> ambos ámbito `plataforma`, cerrando el entregable contractual "plan
> maestro de pruebas QA" del Sprint S4/R2. No quedaron solo en papel: se
> compiló y corrió el primer target de tests automatizados del backend
> (`beemetry_backend_tests`, Catch2 v3, 27 aserciones/7 test cases, 100%
> passed), y — más importante — se detectó y corrigió un hallazgo real de
> resiliencia operativa: el contenedor `beemetry-api` en ejecución corría
> una imagen construida el 2026-07-20T21:37, **antes** del fix de
> cookies/CSRF de ADR-029 — verificado desde una imagen de prueba aislada
> pero nunca desplegado al sistema real. Se reconstruyó (`docker compose
> build web`) y redesplegó, y se corrió `scripts/smoke-auth-e2e.ps1`
> completo (registro→login→refresh con cookie+CSRF→logout) contra el
> contenedor real ya actualizado: `Resultado: OK`. De paso se corrigieron 2
> bugs reales preexistentes en ese mismo script (campo `token` desactualizado
> tras el cambio a `access_token`; lectura de cookies con un `Path` de URI
> incorrecto que nunca iba a encontrar las cookies de sesión).
>
> **Actualización 2026-07-21 (segunda pasada, mismo día)**: 61 → **62 ADRs**.
> Se agregó **061** (`catalogo-casos-prueba-qa`, ámbito `plataforma`) — 69
> casos de prueba sobre las 14 funcionalidades que Gerencia pidió controlar
> (usuarios, empresas, auth password/facial, multitenant, RBAC, menú,
> reportabilidad completa, carátula, TOC, encabezados, texto libre,
> atributos de texto, imágenes, video), es la Capa 5 de ADR-059 adelantada
> del Sprint S7 al sprint actual. Al verificar cada funcionalidad contra
> código real (no se asumió "implementado" por igual para las 14) se
> encontraron 2 brechas reales — inserción de video **no existe** como tipo
> de bloque en ReportStudioV2 (solo hay captura de webcam a imagen fija, no
> video embebido); creación de empresas **no tiene endpoint** (`GET
> /api/auth/companies` solo lee, no hay `POST` — se provisionan por seed de
> BD) — y 1 defecto real no pedido: `frontend/src/auth/roleConstants.ts`
> define 6 roles pero el backend valida 7 (falta `viewer`), lo que matiza
> parcialmente el cierre de ADR-036 ("7 roles unificados"): el backend sí
> soporta los 7, la pantalla de administración de usuarios no expone uno.
> Ninguna de las tres queda "corregida" en este ADR — se documentan con
> evidencia como decisión pendiente de Gerencia/producto, no se resuelven
> unilateralmente.
>
> **Actualización 2026-07-21 (tercera pasada, mismo día)**: 62 → **64 ADRs**.
> De las 3 brechas/defecto que dejó ADR-061 documentadas como pendientes,
> Gerencia pidió cerrar 2 el mismo día: **062**
> (`insercion-video-grabado-webcam-pantalla`, ámbito `reports`) cierra el
> hallazgo G1 — nuevo tipo de bloque `video` con grabación por cámara web o
> pantalla/ventana, insertable en el lienzo (verificado en vivo hasta el
> límite de hardware del entorno de pruebas: no se pudo grabar una toma real
> por sandboxing, pero sí el flujo completo de UI y manejo de errores).
> **063** (`correccion-rbac-siete-roles-asignables`, ámbito `plataforma`)
> cierra TC-RBAC-05 — `ADMIN_ASSIGNABLE_ROLES` (7 roles) reemplaza el uso de
> `USER_ROLES` (6) en las 3 pantallas de administración, y se corrigió un
> bug real independiente en el backend (`notification_routes.cpp`) que solo
> devolvía 4 de 7 roles en la matriz de permisos. La brecha de creación de
> empresas (G2, sin endpoint) y la auditoría completa del flujo RUC/tenant
> quedaron en un documento aparte
> (`Auditoria_Registro_RUC_Tenant_2026-07-21.md`, no un ADR — es un hallazgo
> pendiente de decisión de producto, no una decisión ya tomada).
>
> **Actualización 2026-07-21 (cuarta pasada, mismo día)**: 64 → **67 ADRs**.
> Gerencia tomó dos decisiones más el mismo día sobre lo que había quedado
> pendiente en la pasada anterior: (1) separar ADR-062 en dos ADR
> independientes por origen de grabación — **064** (`grabacion-video-camara-
> web-lienzo`) y **065** (`grabacion-video-pantalla-ventana-lienzo`); ADR-062
> queda `superseded`, su contenido no se editó, se conserva íntegro. (2)
> **066** (`login-usa-razon-social-minera-no-contratista`, ámbito
> `plataforma`) resuelve el hallazgo principal de
> `Auditoria_Registro_RUC_Tenant_2026-07-21.md`: el registro de un
> contratista ya no sobreescribe `company` con su propia razón social —
> conserva la de la empresa MINERA asociada, que es la que determina el
> tenant real. Verificado contra el backend real: un registro con el nuevo
> comportamiento resuelve `tenant_id` real (antes de este fix, el mismo
> escenario resolvía vacío). El hallazgo G2 (creación de empresas sin
> endpoint) sigue sin decisión — no se tocó en esta pasada.
>
> **Actualización 2026-07-21 (quinta pasada, mismo día)**: 67 → **68 ADRs**.
> Durante la verificación con login real (commit `9782c09`) se detectó que
> `POST /api/auth/register` nunca creaba una fila real en `auth_user_tenant`
> — 23 de 28 usuarios reales de la base caían en un tenant de "fallback"
> compartido que resultó ser el tenant REAL de otra empresa (Compañía Minera
> Antamina), no un tenant demo aislado como sugería su nombre de constante.
> **067** (`autoregistro-provisiona-tenant-real`, ámbito `plataforma`) agrega
> `findOrCreateTenantForCompanyPg` (tenant dedicado + membresía real en el
> registro, backend reconstruido y redesplegado) y hace backfill de los 23
> usuarios legacy (5 empresas) con su propio tenant aislado
> (`db_scripts/48_...sql`). Verificado: una empresa nunca antes vista se
> autoregistra y crea un informe en el primer login, sin intervención manual.
> El hallazgo G2 (creación de empresas sin endpoint dedicado, deduplicación
> de nombres) sigue sin decisión — este ADR corrige el aislamiento, no
> reemplaza ese flujo pendiente.
>
> **Auditoría integral 2026-07-24**: 68 → **73 ADRs**. Se formalizaron:
> **068** IA editorial multimodelo + referencia externa acotada; **069**
> migración de producción frontend a TypeScript estricto; **070** bloques y
> plantillas técnicas por composición; **071** TOC fijo en página 2 con
> continuaciones; **072** conversión GDAL runtime administrada, que supersede
> el diferimiento de ADR-028. Se corrigieron contradicciones reales:
> `specs/adr` era histórico pero RAG/agents/CI aún lo trataban como vigente;
> O6 `<1s` no coincidía con los benchmarks LLM; el índice afirmaba
> `sections[]` y MapLibre aunque el runtime usa páginas planas y Leaflet; y
> los documentos de brecha seguían declarando TypeScript 0%. La fuente
> canónica queda `docs/decisions/`, sin renumerar ni borrar historia.
>
> **Auditoría integral 2026-07-25**: 73 → **74 ADRs**. Se agregó **073**
> (`modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon`, ámbito
> `reports`): modal propio (`SaveTitleModal`, mismas clases `ra-*` que el
> resto de la plataforma) reemplaza `window.prompt()` al nombrar un informe
> nuevo; contraste corregido en la barra flotante contextual; `.ribbon-body`
> pasa a `flex-wrap` para que los grupos de ADR-070 no queden ocultos tras
> scroll horizontal. Se auditó el código real contra 3 ADRs que YA
> afirmaban decisiones específicas, y se encontraron 3 divergencias reales
> entre lo documentado y el runtime (no solo trabajo nuevo sin ADR, sino
> ADRs cuyo texto no coincidía con el código):
> - **ADR-053** declaraba solo estilos de tabla; el control funcional
>   (resize de columnas, autoajuste, insertar/eliminar fila/columna,
>   auto-crecimiento) se había implementado el 2026-07-22 sin ADR, junto con
>   dos bugs reales cerrados (bucle de versión descontrolado v1→v103 por
>   realimentación de `colWidths`; controles nuevos bloqueados por el shield
>   CSS `pointer-events:none`) — documentado retroactivamente en su propia
>   actualización.
> - **ADR-068** (§1, "Corrección fiel") afirmaba que LanguageTool era la
>   autoridad de la corrección rápida — el código real usaba un reemplazo de
>   13 palabras hardcodeadas sin relación con LanguageTool. Cerrado:
>   `handleCorrectQuick` ahora sí llama a LanguageTool. Además se verificó
>   Tavily con una API key real del usuario (antes solo se había probado el
>   camino "no configurado").
> - **ADR-071** afirmaba "Ribbon y biblioteca llaman al mismo
>   `addTocElement()`" — el botón del ribbon en realidad solo abría un panel
>   de navegación flotante sin insertar nada. Cerrado: ambos disparan la
>   misma acción real.
>
> Ninguna de las tres era un conflicto *entre* ADRs (ninguna decisión previa
> quedó contradicha por otra) — las tres eran **el ADR afirmando algo que el
> código no hacía todavía**, encontrado únicamente al probar la aplicación
> real en navegador (no por lectura de código ni de la documentación misma).
> No se dejó ningún hallazgo de esta pasada sin cerrar en su propio ADR.
>
> **Auditoría 2026-08-30: 123 (tablas) → 137 ADRs de archivo (000-136, sin
> huecos).** A pedido explícito del developer de actualizar todos los ADR,
> incluidos los pendientes de definición/respuesta/actualización, para
> sustentar el cronograma ante Gerencia TI/General: **ADR-129 a 136**
> existían como archivos completos (redactados entre 2026-08-21 y
> 2026-08-29) sin fila en este índice — se agregan abajo. Se encontraron y
> corrigieron además dos problemas reales que no son decisiones nuevas:
> **(1)** el archivo **ADR-013** estaba corrompido en el árbol de trabajo —
> la palabra "Konva" había sido borrada por algún proceso automatizado en
> las 11 apariciones del texto (`react-konva` → `react-`, "Konva para
> layout" → " para layout", etc.), dejando frases rotas; restaurado desde
> `HEAD` sin pérdida de contenido real (el archivo no tenía cambios
> intencionales pendientes). **(2)** `scripts/project-status-metrics.ps1`
> tiene el campo `Cutoff` hardcodeado a `'2026-08-18'` — no se actualizó en
> las auditorías del 21 ni del 30 de agosto pese a que el script sí
> recalcula `Done`/`Total` en vivo desde los checkboxes reales de
> `specs/*/tasks.md`. Corrido hoy: **el resultado es idéntico al del
> 18-ago (106/196 = 54,1%)** — en los 12 días transcurridos, con 7 ADR
> nuevos (130-136) todos `implemented`/verificados, **ningún checkbox de
> `tasks.md` se marcó**. No es una regresión de código; es una brecha real
> entre "se implementó y se verificó en vivo" (lo que dicen los ADR) y "se
> marcó como tarea cerrada" (lo que cuenta el gate de release) — ver el
> informe de estado del 30-ago para el detalle gerencial.
>
> Los 7 ADR nuevos son, en su mayoría, ámbito `plataforma`/`datos`/
> `core-iot` (a diferencia de la tanda 112-129, mayormente `soporte`/`ia`):
> **130** (`rbac-empresas-minera-organizacion-acceso-cruzado`, plataforma,
> 2026-08-23) formaliza acceso cruzado empresa minera vs. empresa de
> organización, extiende ADR-036/063/085/086; pendiente de verificación E2E
> con datos reales. **131**
> (`consolidacion-modelo-telemetria-unificado`, datos/core-iot, 2026-08-23)
> consolida `dim_*`/`telemetry_fact*` para sostener 25k/s continuos y 5-10
> años de crecimiento — fases 0-5/9-10 aplicadas contra `beemetry-db` local;
> fases 6-8/13 (dual-write, cutover de lecturas, retiro de tablas legacy)
> **pendientes de deploy backend C++**, fuera de alcance de esa sesión. **132**
> (`bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend`,
> plataforma, 2026-08-27) aísla frontends en el mismo host, verificado E2E
> en vivo. **133**
> (`endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada`,
> plataforma, 2026-08-26) cierra hallazgos de un ejercicio de red-team
> propio (CSP, cookie cross-site, validación de entrada), verificado en
> vivo. **134**
> (`fix-critico-escalada-privilegios-autoregistro-empresa-existente`,
> plataforma, 2026-08-26) — **severidad CRÍTICA, el hallazgo más grave de la
> sesión**: `POST /api/auth/register` (público, sin sesión previa) aceptaba
> `"role": "admin"` en el body contra una empresa **ya existente con
> usuarios reales** (verificado en vivo contra "Minera Raura") y devolvía
> una sesión admin completa con permisos `org.cross_tenant.manage` sobre el
> tenant real de esa empresa — cerrado y verificado contra el stack
> corriendo. Al ser una vulnerabilidad de escalada de privilegios ya
> corregida pero potencialmente explotable antes del fix, **queda pendiente
> de decisión de Gerencia si corresponde notificación/auditoría retroactiva**
> a los tenants que existían antes del 2026-08-26. **135**
> (`mfa-totp-alertas-seguridad-ruc-bootstrap`, plataforma, 2026-08-27) agrega
> MFA/TOTP, alertas de seguridad y RUC obligatorio en el bootstrap de admin,
> verificado E2E de punta a punta. **136**
> (`telemetria-calculada-dashboard-simulacion`, datos/core-iot/frontend,
> 2026-08-29) agrega `telemetry_fact_calc` (métrica derivada por lectura de
> sensor) y un panel de monitoreo de la simulación de 1h contra
> `board.beemetry.com`; el cómputo lo puebla un **script externo interino**,
> decisión explícita para no agregar un scheduler al backend sin pedido de
> negocio — **pendiente decidir si el cómputo migra al backend C++** si deja
> de ser interino. Ningún conflicto de decisión incompatible encontrado
> entre los 7 ADR nuevos y el resto del log vigente.
>
> **Auditoría 2026-08-30 (segunda pasada, mismo día): "cerrar todo lo
> cerrable", a pedido explícito del developer.** Con el stack real
> corriendo (`docker ps` verificado, todos los servicios `healthy`), se hizo
> una pasada de verificación EN VIVO (no solo lectura) sobre los pendientes
> documentados y se buscó explícitamente "ADR pendiente"/"sin ADR" en todo
> el código modificado del árbol actual. Resultado, de mayor a menor
> impacto:
>
> 1. **ADR-137 nuevo** (`envio-informes-notificaciones-multicanal`, ámbito
>    `reports`/`plataforma`): el código de `report_routes.cpp` llevaba
>    literalmente el comentario `// ADR pendiente` sobre una feature ya
>    implementada, commiteable y verificada por build — envío de informes a
>    otros usuarios (reemplaza un mock que no tocaba el backend) + un
>    servicio de notificación multi-canal (`in_app`/`email`/`whatsapp`/`sms`)
>    reutilizable, con trazabilidad completa en `notification_dispatch_log`.
>    De paso cierra un bug real independiente: `reports.created_by` nunca se
>    llenaba, así que el propio autor de un borrador nunca podía reabrirlo
>    para editar. Deja documentado un pendiente real sin resolver
>    unilateralmente: el guardia de aislamiento de
>    `POST /api/notifications/send` filtra por `company_name`, no por
>    `tenant_id` (que ADR-039 estableció como la única clave autoritativa) —
>    posible divergencia, no corregida a ciegas porque ADR-130 (acceso
>    cruzado empresa minera/organización) puede hacer de esa restricción una
>    elección consciente, no un bug; queda para quien mantenga ADR-039/130.
> 2. **ADR-115 sube de `accepted` a `implemented`**: los 3 pendientes que el
>    propio ADR documentaba el 2026-08-19 (bot sin manejar `rrhh`, RBAC de
>    ticket status/contact-numbers sin la alternativa por departamento)
>    estaban cerrados en el código real pero el ADR nunca se actualizó — y
>    se encontró y cerró en la misma pasada un cuarto gap real que ningún
>    ADR había señalado: `handleListContactNumbers` exigía `soporte.manage`
>    estricto sin la alternativa `soporte.view`/`department` de sus
>    contrapartes de escritura, dejando a un agente de RRHH
>    departamentalizado sin forma de VER el número que sí podía editar.
>    Corregido y verificado con `docker build -f backend/Dockerfile.verify`
>    (build limpio, CTest 1/1).
> 3. **ADR-131 recibe un bloque de actualización**: `GET
>    /api/platform/archive/query` (lectura on-demand del tier frío
>    Parquet/MinIO vía DuckDB, con guardia anti-IDOR) ya existe en el código
>    citando "ADR-131" en su propio comentario, pero el ADR nunca documentó
>    esta decisión — cerrado por lectura directa de código, no verificado en
>    vivo contra datos reales archivados en esta pasada.
> 4. **ADR-111 cierra su sub-pendiente de checksum**: los 4 scripts de
>    export/import del stack ahora generan y verifican `checksums.sha256`
>    (fail-closed, aborta antes de tocar Docker/BD ante cualquier archivo
>    modificado) — verificado en vivo con export real contra `sensors_db`/
>    `formula` y una prueba de corrupción deliberada que el import detecta y
>    rechaza correctamente. Cifrado, restore limpio en host nuevo y CI/CD
>    siguen sin resolver — no se atacaron, requieren decisión de gestión de
>    claves.
> 5. **ADR-082 recibe fila nueva en el índice** (nunca la tuvo, pese a estar
>    "formalizado" según la nota de auditoría del 2026-08-03) y un bloque de
>    actualización que lo cruza con ADR-132, que lo revisita conscientemente
>    — brecha de trazabilidad del mismo patrón que este log viene
>    encontrando desde julio, ahora en un ADR de seguridad central que
>    llevaba 4 semanas sin fila.
> 6. **ADR-013 restaurado**: el archivo estaba corrompido en el árbol de
>    trabajo (la palabra "Konva" borrada en las 11 apariciones del texto por
>    algún proceso ajeno a este log, sin relación con ninguna decisión) —
>    recuperado desde `HEAD` sin pérdida de contenido real.
> 7. **No se encontraron conflictos de decisión incompatible** entre ningún
>    par de ADR revisados en esta pasada (130-137 contra el resto del log
>    vigente) — ADR-132 documenta su propia revisión consciente de ADR-082,
>    y es el único caso de "una decisión reabre otra" encontrado; el resto
>    son extensiones aditivas sin contradicción.
> 8. **No cambia el 54,1% de avance de ejecución**
>    (`scripts/project-status-metrics.ps1`, corrido de nuevo tras esta
>    pasada): ningún cierre de ADR de esta lista marca un checkbox de
>    `specs/*/tasks.md` — la separación de criterio de este proyecto ("los
>    ADR miden decisión, no producto") sigue aplicando incluso cuando el ADR
>    se cierra con evidencia de código real y build verificado. Ver el
>    informe de estado del 30-ago para el detalle gerencial de esta
>    distinción.
>
> **Actualización 2026-07-27**: 74 → **75 ADRs**. Se agregó **074**
> (`avatar-biometrico-local-hd-bajo-demanda`, ámbito `ia`): avatar generado
> localmente, miniatura de sesión separada del maestro 4K, endpoint
> autenticado self-only y visor accesible bajo demanda. ADR-074 reconcilia
> explícitamente las frases históricas de ADR-004/027 (“biometría latente”)
> con el runtime y con la actualización vigente de ADR-025: login/avatar
> facial existen, pero EPP continúa diferida y el gate legal no se elimina.
>
> **Actualización 2026-07-27 (segunda pasada)**: 75 → **76 ADRs**. Se agregó
> **075** (`internacionalizacion-pais-idioma-acceso`, ámbito `plataforma`):
> selector inicial país/idioma, cuatro locales, acceso/registro y navegación
> traducidos, teléfonos E.164 y validación fiscal por país. Se revisó
> compatibilidad con ADR-035/040/042/066/067/073; no cambia tenant, RBAC,
> soberanía ni alcance biométrico.
>
> **Actualización 2026-07-27 (tercera pasada)**: 76 → **78 ADRs**. La
> verificación E2E descubrió un fallo intermitente de UUID y una revisión de
> seguridad mostró que `makeId()` también alimentaba secretos. Se agregaron
> **076** (`separacion-identificadores-secretos-csprng`, implemented) y **077**
> (`migracion-password-argon2id-versionada`, implemented). El primero separa IDs
> DB-safe de secretos CSPRNG; el segundo convierte el pendiente de salt/
> `std::hash` de ADR-043 en una migración gradual ejecutable. La matriz
> completa está en `AUDITORIA_ACCESO_I18N_2026-07-27.md`.
>
> **Actualización 2026-07-27 (cuarta pasada)**: 78 → **79 ADRs**. ADR-078
> cierra el alta administrada de empresas: autorización admin, deduplicación
> case-insensitive, tenant real y auditoría.
>
> **Nota de auditoría 2026-08-03 (antes de la pasada de abajo)**: al llegar a
> esta sesión ya existían **081 archivos reales** (000-081, sin huecos) pero
> este log narrativo y las tablas por ámbito seguían citando 79 — **079**
> (`rbac-workflow-informes-inmutabilidad-firma`), **080**
> (`marca-de-agua-y-password-pdf`) y **081**
> (`cors-multiorigen-frontend-externo`) nunca se agregaron acá ni a la tabla
> de `reports`/`plataforma` correspondiente, pese a tener contenido completo
> y `Status: implemented/accepted` en su propio archivo. Brecha de
> trazabilidad preexistente, no introducida en esta pasada — se documenta acá
> (mismo criterio que este log ya usó para el hallazgo G2 de ADR-061: nombrar
> el gap con evidencia, no resolverlo unilateralmente fuera de su propio
> alcance) para que quien haga la próxima auditoría integral las incorpore a
> las tablas. No se tocó el contenido de 079/080/081, solo se deja constancia
> de que existen y de que el índice está desactualizado respecto a ellas.
>
> **Actualización 2026-08-03**: 79 (narrativa) → **85 ADRs de archivo**
> (existían 81 sin gaps + ADR-082 formalizado + 2 nuevos de esta pasada; ver
> nota de arriba sobre 079-081). Se agregaron **083**
> (`exportacion-pptx-modo-presentacion-sidecar-hibrido`) y **084**
> (`conversion-pptx-video-narracion-diapositiva`), ambos ámbito `reports`:
> exportación del informe a PPTX en modo presentación (mismo sidecar
> Chromium del PDF, texto de bloques `text` editable/buscable en PowerPoint
> vía overlay nativo) y conversión de ese PPTX a video con narración opcional
> por diapositiva (`ffmpeg`, audio grabado o notas de orador). También se
> formalizó **082**
> (`autenticacion-cookie-httponly-csrf-double-submit`), decisión ya
> implementada y citada en el código pero sin archivo propio: access token
> en cookie `HttpOnly`, CSRF double-submit en mutaciones y compatibilidad
> Bearer para integraciones.
>
> Dos correcciones de auditoría se agregaron a ADR previos (sin editar su
> texto original, con bloque fechado arriba, según la convención de este
> log): **ADR-016** — declaraba almacenamiento en MinIO para el export server
> side; verificado que el PDF nunca persistió a MinIO (proxy síncrono puro,
> bytes reenviados en la misma respuesta) — ADR-083/084 son el primer export
> que sí persiste un artefacto, y usan disco local confinado
> (`BEEMETRY_EXPORT_DATA_ROOT`), el mismo patrón ya real de ADR-047/072, no
> MinIO. **ADR-023** — el presupuesto O3 (`<5s`) no encaja tal cual con un
> export asíncrono de job+polling (PPTX hasta 60s, video hasta 180s
> configurados); se propone (sin implementar todavía) un código de
> presupuesto separado para este tipo de export, mismo criterio que ADR-068
> ya usó para partir O6. Ninguna de las dos es un conflicto *entre* ADRs —
> ambas son el mismo patrón ya varias veces encontrado en este log: el ADR
> afirmando algo (MinIO, un presupuesto único) que el código real no hacía o
> no podía cumplir tal cual.
>
> De paso se encontró y cerró una brecha RBAC real durante la propia
> implementación de ADR-084 (mismo criterio de ADR-079/063 — cerrar el
> hallazgo en el mismo cambio que lo detecta): subir narración de audio/notas
> a una diapositiva usaba el mismo umbral `informes.view` que exportar un
> PDF/PPTX de solo lectura; como contribuye contenido nuevo al informe, se
> corrigió a exigir `informes.edit`, dejando la generación/descarga de
> export sin cambios. Se encontraron además dos defectos reales durante la
> verificación de ADR-084 (documentados en su propio archivo, no aquí):
> `pptxgenjs` no nombra las imágenes de forma secuencial simple como se
> supuso al principio, y mezclar el video mudo con audio usando `-c:v copy`
> truncaba contenido visual real pese a que la duración reportada por
> `ffprobe` parecía correcta — ambos verificados y corregidos contra
> herramientas reales (`ffmpeg`/`ffprobe`, inspección de un `.pptx` real),
> no solo por lectura de código.
>
> **Actualización 2026-08-05**: se cierra la brecha de trazabilidad señalada
> en la nota de auditoría del 2026-08-03 — **ADR-079**
> (`rbac-workflow-informes-inmutabilidad-firma`) recibe su fila en la tabla
> de ámbito `plataforma` (no tenía ninguna hasta ahora, pese a tener
> contenido completo y `Status: implemented` en su propio archivo desde
> 2026-08-02). El subtotal de `plataforma` se recalcula a **29/31
> implemented, 1 partial, 1 proposed** (los 27 ya contados + ADR-081, que ya
> tenía fila pero no se sumaba al subtotal, + ADR-079 ahora agregado). No se
> modificó el contenido de ADR-079 ni de ningún otro ADR — solo se corrigió
> el índice para que refleje lo que ya existía como archivo.
>
> **Actualización 2026-08-05 (segunda pasada)**: 85 → **88 ADRs**. Se cierra
> por completo el Hallazgo G2 de ADR-061 (creación/mantenimiento de empresas
> sin endpoint dedicado), que ADR-078 (2026-07-29) solo había resuelto a
> medias (alta con dedup, sin mantenimiento ni RBAC granular). Se agregaron
> **085** (`crud-empresas-y-pantalla-administracion`, ámbito `plataforma`):
> `PUT`/`DELETE` (soft delete) sobre empresas, RUC, pantalla de
> administración; **086** (`rbac-granular-empresas-view-manage`, ámbito
> `plataforma`): permisos `empresas.view`/`empresas.manage` reemplazan el
> `role=="admin"` hardcodeado original; **087**
> (`validacion-ruc-registro-externo-opcional`, ámbito `plataforma`): fix de
> un bug real (el nombre de empresa nunca se comparaba en
> `validate-company`) + consulta externa opcional al padrón SUNAT
> documentada como excepción explícita y acotada a ADR-001 (no existe API
> oficial gratuita de SUNAT — se investigó antes de asumirlo); **088**
> (`seed-empresas-distribuidoras-usuarios-demo`, ámbito `datos`): datos de
> prueba (empresas reales con RUC sintético marcado como tal, usuarios
> ficticios) validando las 4 combinaciones RBAC de 086. Se agregó el bloque
> de "Actualización 2026-08-05" a ADR-061 (no se editó su texto original)
> marcando G2 como cerrado. Ver el detalle completo de hallazgos técnicos
> (condición de carrera en el dedup original, semántica de override
> completo de `role_permissions`, restricción del `CHECK` de hash de
> ADR-077 sobre el seed) en cada ADR individual.
>
> **Actualización 2026-08-07**: auditoría solicitada por Gerencia sobre
> ADRs pendientes de resolución, conflictos, respuestas pendientes y
> trabajo implementado sin ADR. 88 → **92 ADRs** (colisión de numeración
> resuelta) → **95 ADRs**. Hallazgos, de mayor a menor severidad:
>
> 1. **Colisión de numeración real en 089**: dos archivos distintos
>    reclamaban el mismo número (`089-biometria-dermalog-cli-integration.md`
>    y `089-plantilla-corporativa-timetelemetry-referencia-diseno.md`, este
>    último creado en la sesión anterior). Se renumeró el segundo a
>    **ADR-092** (mismo contenido, solo cambia el número — ninguno de los
>    dos estaba commiteado, así que el rename no afecta historial de git).
> 2. **~739 archivos sin commitear en `frontend/`** desde al menos el
>    2026-07-24 — la migración JS→TS completa que **ADR-069** ya declara
>    "implemented, verificado" citando `npm run build: OK`, pero ese estado
>    nunca llegó a un commit real. Sobre ese árbol, cambios más recientes
>    (2-3 de agosto, sin ADR): Vite 5→8 (nuevo bundler Rolldown), Vitest
>    1→4, y un swap de `plotly.js` completo por `plotly.js-basic-dist-min`
>    — **rompían el módulo Informes para cualquier usuario/tenant** (bug de
>    interop CJS→ESM, distinto entre el esbuild de dev y el Rolldown de
>    build). Verificado en vivo y corregido — ver **ADR-093**
>    (`vite8-rolldown-migracion-parcial-interop-plotly`). Esto también
>    **descarta** la hipótesis sin confirmar de la sección "3 specs siguen
>    fallando" de la nota de 2026-08-05 arriba (gate de permisos de
>    ADR-079): verificado por SQL directo que `operator`/`manager` sí tienen
>    `informes.edit`; la causa real era este árbol roto sirviéndose en
>    dev/dist, no un problema de RBAC. El árbol de 739 archivos **sigue sin
>    commitear** — queda fuera del alcance de este ADR (gestión de
>    repositorio, no arquitectura) pero es la brecha más grande encontrada:
>    todo ese trabajo se pierde ante cualquier `git checkout`/`reset`/clon
>    nuevo mientras no se commitee.
> 3. Dos features ya implementadas y verificadas en sesiones anteriores sin
>    ADR: lectura de DNI por cámara (PDF417+MRZ, sin consulta a RENIEC) —
>    **ADR-094** (`lectura-dni-camara-pdf417-mrz`) — y el fix real de
>    code-splitting de `UserMaintenanceModal` (se montaba sin su CSS la
>    primera vez, justo tras login) — **ADR-095**
>    (`usermaintenancemodal-css-autocontenida-marca`).
> 4. Fila de ADR-058 corregida: decía "pendiente `echarts@6`" pese a que el
>    propio archivo de ADR-058 ya registraba ese CVE cerrado el 2026-07-27
>    (migrado a 6.1.x) — desalineación entre el texto del ADR y la fila del
>    índice, no un hallazgo de código nuevo.
> 5. Mismo patrón que la brecha de ADR-079 cerrada el 2026-08-05: **ADR-089
>    (`biometria-dermalog-cli-integration`), 090
>    (`deprecacion-adr-tempranos-ia`) y 091 (`opencv-composicion-raii`)** ya
>    existían como archivos completos (2026-08-05, ámbito `ia`) pero sin fila
>    en esta tabla — agregadas, sin editar su texto original. De paso se
>    verificó que la supersesión que declara ADR-089 sobre
>    `specs/adr/ADR-005` (InsightFace/ONNX) es real y ya tiene su banner
>    `SUPERSEDED` correcto — no es una referencia rota.
> 6. No se encontraron conflictos reales entre decisiones arquitectónicas
>    vigentes en el resto del set (ADR-033/035 revisados: sus estados
>    `partial`/`proposed` son honestos y deliberados, no brechas).
>
> **Auditoría 2026-08-21: 120 → 123 ADRs, mismo patrón de brecha de
> trazabilidad repetido.** A pedido explícito del developer de revisar todos
> los cambios/funcionalidades nuevas del árbol de trabajo actual y verificar
> conflictos entre ADRs: **ADR-121, 122 y 123** existían como archivos
> completos (redactados 2026-08-20, el mismo día de la auditoría anterior
> pero posteriores a ella) sin fila en este índice — ADR-121/123 agregados a
> la tabla `geo` de arriba, ADR-122 agregado a la tabla `soporte` de abajo.
> Se corrigió además, con bloque de actualización fechado (sin editar el
> texto original): **ADR-117**, que declaraba "sin parámetro `channel`
> todavía aceptado por el backend" — verificado por grep directo sobre
> `backend/src/support/support_routes.cpp` (líneas ~353-360, 394-402, 454 en
> el árbol de trabajo actual) que el parámetro ya se lee, valida y persiste;
> sube de `proposed` a `partial` (sigue sin existir la app MovilMinero en
> sí). No se encontraron conflictos nuevos de decisión incompatible entre
> ADRs vigentes. Se identificaron 5 piezas de funcionalidad genuinamente
> nueva sin ADR propio, ya redactadas y agregadas en esta misma pasada como
> **ADR-124 a 128** (ver tablas `ia`/`reports` arriba): pool de conexiones
> TCP hacia `ai_engine`; recalibración EAR por resolución de cámara +
> thread-safety de MediaPipe + groundwork de `head_yaw_ratio` en
> `eye_analyzer.py`; liveness activo por desafío-respuesta (construido
> 2026-08-19, desactivado tras pruebas fallidas, **reactivado y recalibrado
> el 2026-08-21** a pedido explícito del developer); aislamiento por
> usuario/tenant del caché offline SQLite con purga en logout; y plantillas
> nativas de documento tipo "presentación". Un sexto candidato inicial,
> `frontend/src/auth/geolocation.ts`, resultó ser un **falso positivo** de
> esta misma auditoría: ya está completamente cubierto por **ADR-107**
> (`geolocalizacion-cliente-login-contrasena`, ya con fila en la tabla
> `plataforma`) — se corrige acá para que quien lea este log no repita la
> misma verificación.

### Ámbito `plataforma` — fundaciones transversales
| # | Slug | Status | Resumen |
|---|---|---|---|
| 000 | `rebrand-aurixa-a-beemetry` | ✅ implemented (2026-07-07) | El producto se llama Beemetry; AURIXA/ControlTime/`mapas_backend` deprecados. |
| 001 | `despliegue-soberano-on-prem` | ✅ implemented (2026-07-06) | Todo on-prem (VPS Lima, Docker); sin nube externa para dato crítico. |
| 002 | `backend-cpp-gateway-central` | ✅ implemented (2026-07-06) | Gateway C++ único autenticado; proxy a sidecars (refinado por 031). |
| 004 | `arquitectura-poliglota-cpp-sidecars` | ✅ implemented (2026-07-06) | Hot path C++; IA/ML/CV en sidecars (Python/Ollama/LanguageTool) por HTTP. |
| 023 | `presupuestos-rendimiento-slas` | ✅ implemented, refinado por 068 (2026-07-24) | SLAs como restricciones; O6 <1s aplica a corrección automática. Rewrite/APA local son asíncronos con latencia medida (p50 ~7s/~18s). |
| 029 | `rbac-identidad-plataforma-jwt` | ✅ implemented, corregido (2026-07-19) | Identidad de plataforma: RBAC multitenant + JWT; login user/pass en v0.1. Refresh token migrado de `localStorage` a cookie `HttpOnly`+CSRF double-submit — ver actualización en el ADR. |
| 030 | `auditoria-100-acciones-server` | ✅ implemented (2026-07-07) | Auditoría 100% autoritativa en servidor, transversal, con hash encadenado. |
| 031 | `backend-plataforma-compartida-multicomponente` | ✅ implemented (2026-07-06) | Backend = plataforma compartida; ReportStudio es el primer componente por prioridad. |
| 033 | `convencion-nombres-prefijos` | ⚠️ partial (2026-07-07) | Estándar de prefijos: `beemetry-*` contenedores, APIs `/api/v1/...`, DBs/tablas/buckets/env. |
| 035 | `plataforma-enterprise-latam` | 📋 proposed (2026-07-12) | Topología edge+hub de 3 niveles para escalar a todas las unidades mineras de LATAM. |
| 036 | `rbac-siete-roles-unificados` | ✅ implemented (2026-07-13) | Reconcilia el RBAC de 4 roles con los 6 de `roleConstants.ts` + `viewer` = 7 roles únicos. |
| 037 | `alta-usuarios-administrada-sin-biometria` | ✅ implemented (2026-07-13) | Admin crea usuarios remotos sin biometría; enrolamiento diferido al primer login presencial. |
| 038 | `delegacion-acceso-tenant-activo-emisor` | ✅ implemented (2026-07-13) | Otorgar/revocar acceso multitenant siempre escopeado al tenant activo de quien lo emite. |
| 040 | `sistema-diseno-navegacion-enterprise` | ✅ implemented, mejorado (2026-07-27) | Cabecera compacta; carriles contiguos de Áreas/Opciones con iconos grandes, flechas automáticas, scroll y relieve 3D sutil. |
| 041 | `resiliencia-token-fetch-crudo` | ✅ implemented (2026-07-13) | Refresco automático de token en `fetch()` crudo del dashboard; documenta triplicación de la lógica (consolidada 2026-07-13). |
| 042 | `nomenclatura-menus-lenguaje-llano-minero` | ✅ implemented, mejorado (2026-07-27) | Etiquetas operativas cortas: Gestión, Control, Terreno, Mapas, Permisos, Informes; Usuarios, Accesos y Umbrales. |
| 043 | `endurecimiento-seguridad-pre-pentest` | ✅ controles internos implementados | Cierra IDOR/endpoints sin auth/CORS; CSPRNG y Argon2id cerrados por ADR-076/077. Pentest externo sigue independiente. |
| 058 | `auditoria-seguridad-integral-jul2026` | ✅ implemented (2026-07-19) | XSS almacenado e IDOR sin auth cerrados; CVEs altas llevadas a 0 y HSTS agregado. `echarts@6` cerrado 2026-07-27 (migrado a 6.1.x). Pendiente: pentest externo. |
| 059 | `plan-maestro-pruebas-qa` | ✅ accepted, primera fase implementada (2026-07-21) | 5 capas de prueba formalizadas (unit frontend, unit backend, e2e frontend, smoke/integración backend, regresión de cierre de etapa) con cronograma y exit criteria por gate. Verificado en vivo: `smoke-auth-e2e.ps1` extendido corrido de punta a punta contra el `beemetry-api` real, `Resultado: OK`. |
| 060 | `framework-pruebas-backend-catch2` | ✅ implemented, verificado (2026-08-05) | Catch2 v3 (apt) como framework de tests del backend; target `beemetry_backend_tests`. Corrida real contra el contenedor `beemetry-api`: **610 aserciones en 20 test cases, todas passed** (crecimiento real desde las 27/7 de 2026-07-21). |
| 061 | `catalogo-casos-prueba-qa` | ✅ accepted, documentado (2026-07-21) | Catálogo de 69 casos de prueba QA (Capa 5 de ADR-059, adelantada) sobre 14 funcionalidades pedidas por Gerencia. Encontró 2 brechas reales (video no implementado; creación de empresas sin endpoint) y 1 defecto (RBAC: 6 vs 7 roles en `roleConstants.ts`). |
| 063 | `correccion-rbac-siete-roles-asignables` | ✅ implemented, verificado (2026-07-21) | `ADMIN_ASSIGNABLE_ROLES` (7 roles) reemplaza `USER_ROLES` (6) en las 3 pantallas de administración de roles; corrige matriz de permisos del backend que solo devolvía 4 de 7 roles. Cierra TC-RBAC-05 de ADR-061. |
| 066 | `login-usa-razon-social-minera-no-contratista` | ✅ implemented, verificado (2026-07-21) | El registro/login de un contratista usa la razón social de la EMPRESA MINERA asociada (no la propia) para determinar `company`/tenant — antes se sobreescribía con `contractorLegalName`, dejando al contratista sin tenant real. Verificado: `tenant_id` ahora resuelve real. Cierra el hallazgo de `Auditoria_Registro_RUC_Tenant_2026-07-21.md`. |
| 067 | `autoregistro-provisiona-tenant-real` | ✅ implemented, verificado (2026-07-21) | `POST /api/auth/register` nunca creaba una fila real en `auth_user_tenant` — 23/28 usuarios reales caían en un fallback compartido que resultó ser el tenant REAL de otra empresa (Antamina), no un tenant demo aislado. Se agrega `findOrCreateTenantForCompanyPg` (tenant dedicado + membresía real en el registro) y se hace backfill de los 23 usuarios legacy con su propio tenant. Verificado: empresa nunca antes vista se autoregistra y crea un informe en el primer login sin intervención manual. |
| 069 | `migracion-frontend-typescript-estricto` | ✅ implemented, verificado (2026-07-24) | Producción frontend migrada a TypeScript estricto: 111 `.ts/.tsx`; los 6 `.js/.jsx` restantes son tests/config. `tsc`, build y Vitest verdes. |
| 075 | `internacionalizacion-pais-idioma-acceso` | ✅ implemented · probado · desplegado | País→idioma ES/EN/FR/PT-BR, fiscal/prefijo y diálogos propios; imágenes activas y smoke aprobado. |
| 076 | `separacion-identificadores-secretos-csprng` | ✅ implemented · probado · desplegado | OpenSSL CSPRNG para ID/refresh/`jti`/API keys; Catch2 y E2E aprobados. |
| 077 | `migracion-password-argon2id-versionada` | ✅ implemented · inventario legacy en cero, verificado (2026-08-07) | Argon2id + rehash oportunista; 82/82 cuentas `$argon2id$`, 0 legacy — reset administrado de las 40 restantes con la misma función Argon2id real (`libargon2` vía ctypes), verificado con login real end-to-end y reinicio del backend sin ningún hallazgo de migración pendiente. |
| 078 | `alta-administrada-empresa-tenant-deduplicada` | ✅ implemented · probado · desplegado | POST admin, deduplicación de razón social, tenant real y auditoría; smoke E2E aprobado el 2026-07-29. |
| 079 | `rbac-workflow-informes-inmutabilidad-firma` | ✅ implemented (backend), 2026-08-02 *(fila agregada 2026-08-05 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba)* | Permiso por transición de workflow en `/api/reports/*` (`draft`/`rejected` → `informes.edit`; `in_review`/`approved` → `informes.sign`), resuelto bajo el mismo lock de fila que la máquina de estados; inmutabilidad absoluta de `signed`/`archived` sin excepción de rol (ni `admin`); hook `usePermissions()` reutilizable en frontend. Cierra el hallazgo donde cualquier rol autenticado (incluido `viewer`) podía aprobar, firmar o eliminar un informe técnico minero. |
| 081 | `cors-multiorigen-frontend-externo` | ✅ implemented (2026-08-02) | `BEEMETRY_CORS_ALLOWED_ORIGIN` admite lista separada por comas; `router::Router::dispatch()` refleja por request el origen que matchea. Habilita una segunda app frontend (repo propio) contra el mismo backend, sin tocar cookies/CSRF (despliegue same-site). |
| 082 | `autenticacion-cookie-httponly-csrf-double-submit` | ✅ implemented, revisitado por ADR-132 *(fila agregada 2026-08-30 — el ADR ya existía "formalizado" desde 2026-08-03 según la nota de auditoría de esa fecha, pero nunca tuvo fila en esta tabla)* | Access token en cookie `HttpOnly`, protección CSRF double-submit. ADR-132 (2026-08-27) revisita conscientemente la parte del access token por un hallazgo real de colisión de cookies entre frontends en el mismo host; el refresh token sigue exclusivamente en cookie `HttpOnly` sin cambios. |
| 085 | `crud-empresas-y-pantalla-administracion` | ✅ implemented (2026-08-05) | `PUT`/`DELETE` (soft delete) sobre `/api/auth/companies/{id}`, campo RUC, `company_id` surrogate, pantalla `CompanyManagementView.tsx` — cierra la mitad de G2 (ADR-061) que ADR-078 había dejado pendiente. |
| 086 | `rbac-granular-empresas-view-manage` | ✅ implemented (2026-08-05) | Permisos `empresas.view`/`empresas.manage` reemplazan el `role=="admin"` hardcodeado de ADR-078; propagación a tenants con matriz de permisos propia. |
| 087 | `validacion-ruc-registro-externo-opcional` | ✅ implemented (2026-08-05) | Checksum de RUC extraído a módulo reutilizable + fix de bug real (nombre de empresa nunca se comparaba); consulta externa opcional al padrón SUNAT documentada como excepción explícita y acotada a ADR-001 (apagada por defecto, sin proveedor contratado aún). |
| 093 | `vite8-rolldown-migracion-parcial-interop-plotly` | ✅ implemented (cerrado 2026-08-08) | Vite 8/Rolldown + swap a `plotly.js-basic-dist-min` encontrados sin ADR y sin commitear (junto con toda la migración TS de ADR-069); rompían el módulo Informes para cualquier usuario (bug de interop CJS→ESM entre esbuild dev y Rolldown build). Corregido y verificado en ambos bundlers. Cerrado tras commitear el árbol completo de `frontend/` (750 archivos, sesión de 2026-08-08). |
| 094 | `lectura-dni-camara-pdf417-mrz` | ✅ implemented, verificado con datos sintéticos (2026-08-07) | Lectura de DNI (antiguo PDF417 + MRZ de todas las versiones) vía cámara web en sidecar `ai_engine`, sin consulta a RENIEC. Alternativa elegida tras descartar validación online por riesgo de cumplimiento. QR del DNI-e 3.0 diferido. Falta prueba contra documento físico real. |
| 095 | `usermaintenancemodal-css-autocontenida-marca` | ✅ implemented, verificado (2026-08-07) | Fix real de code-splitting: el modal se monta desde `App.tsx` fuera del chunk lazy de ReportStudioV2 y no cargaba su CSS; hoja propia autocontenida + marca corporativa `#F07E41`. |
| 096 | `opencv-4-12-vcpkg-backend` | ✅ implemented, verificado (2026-08-08) | Backend C++ compila OpenCV 4.12.0 estático vía vcpkg manifest, reemplazando `libopencv-dev` 4.6.0 (apt/Ubuntu, congelado desde 2022). Runtime sin cambios (cascades Haar del pipeline legacy). |
| 101 | `fix-bucle-reintento-registro` | ✅ implemented, verificado (2026-08-08) | El `useEffect` de auto-envío de registro reintentaba cada ~2.7s con los mismos datos tras cualquier error del servidor, borrando el mensaje casi al instante (`setError('')`) — se veía como pantalla parpadeando sin error visible. Un rechazo confirmado del servidor ya no rearma el auto-reintento. |
| 102 | `validacion-fiscal-ecuador-chile-costa-rica-fallback` | ✅ implemented, verificado (2026-08-09) | RUC Ecuador (13 dígitos, algoritmo SRI real) y RUT Chile (módulo 11, incluida `K`) con dígito verificador real; cédula jurídica Costa Rica y el resto del catálogo (~24 países) con fallback estructural — antes rechazaban siempre el registro. Motivado por proyectos activos en Ecuador/Chile y un proveedor de Costa Rica que no podían registrarse. 625/625 aserciones passed. |
| 106 | `accesibilidad-contraste-formularios-ui` | ✅ implemented, aprobado (2026-08-14) *(fila agregada 2026-08-20 — el ADR ya existía sin fila en esta tabla, ver auditoría arriba)* | Estándares de contraste y accesibilidad para formularios y UI en todo el frontend (ReportStudio, Dashboard, todas las vistas). |
| 107 | `geolocalizacion-cliente-login-contrasena` | ✅ implemented (2026-08-17) | Campo opcional `location` (lat/lon del dispositivo cliente, vía `navigator.geolocation`, nunca IP/servidor) extendido a `POST /api/auth/login/password` — ya existía solo en `login/face`, sin ADR ni documentación. Helper de parseo compartido entre ambos handlers; página de prueba HTTP/HTTPS y guía de integración externa actualizadas. |
| 130 | `rbac-empresas-minera-organizacion-acceso-cruzado` | ✅ implemented, verificado E2E en vivo (2026-09-02) | Formaliza acceso cruzado empresa minera vs. empresa de organización, caso que ADR-029 anticipó y descartó por falta de necesidad de negocio; extiende ADR-036/063 (7 roles) y ADR-085/086 (CRUD empresas/RBAC granular). Grant/revoke/guardia/switch probados en vivo con tenants reales. |
| 132 | `bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend` | ✅ implemented, verificado E2E en vivo (2026-08-27) | Bearer token en memoria (no `localStorage`) + cookies namespaced por frontend; aísla sesiones entre múltiples apps frontend en el mismo host, verificado con build Docker real + login por navegador. |
| 133 | `endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada` | ✅ implemented, verificado en vivo (2026-08-26) | Cierra hallazgos de un ejercicio de red-team propio: CSP, cookie cross-site y validación de entrada endurecidas; re-ejecución exacta de los ataques probados, verificado contra build Docker real. |
| 134 | `fix-critico-escalada-privilegios-autoregistro-empresa-existente` | ✅ implemented, verificado en vivo (2026-08-26) — **CRÍTICA** | `POST /api/auth/register` (público) aceptaba `"role": "admin"` contra una empresa **ya existente con usuarios reales** (explotado en vivo contra "Minera Raura") y devolvía sesión admin completa con `org.cross_tenant.manage` sobre el tenant real. El hallazgo más grave del ejercicio de seguridad de esta sesión; cerrado y verificado. Pendiente decisión de Gerencia sobre notificación/auditoría retroactiva a tenants preexistentes al fix. |
| 135 | `mfa-totp-alertas-seguridad-ruc-bootstrap` | ✅ implemented, verificado E2E de punta a punta (2026-08-27) | MFA/TOTP, alertas de seguridad y RUC obligatorio en el bootstrap del primer admin de una empresa nueva; verificado API + navegador real. |
| 153 | `reintento-login-facial-no-transitorio-y-precheque-username` | ✅ implemented, verificado en vivo contra la base real (2026-09-04) | Dos hallazgos reales en la misma sesión: (1) `handleFaceLogin` liberaba el trigger de auto-reintento ante CUALQUIER rechazo, incluidos los deterministas ("Se detectaron lentes/gafas puestos" nunca va a coincidir sin quitárselos) — reintentaba cada 2.5s hasta agotar el rate limit de la cuenta (5 intentos), tapando el mensaje real con el genérico "demasiados intentos"; ahora sólo reintenta solo ante error transitorio (mismo criterio que ADR-147 ya aplicaba al registro). (2) `username` (UNIQUE por empresa, a diferencia del DNI global) no tenía pre-chequeo antes de la cámara — mismo patrón exacto que `check-dni` de ADR-147, nuevo `checkUsernameExistsPg`/`POST /api/auth/register/check-username`, verificado con curl contra `auth_users` real (`exists:true` para un username realmente duplicado). |

| 154 | `beacon-diagnostico-client-incident` | ✅ implemented (2026-09-04) | Varios reportes reales de "la captura biométrica se cierra sola" no dejaban rastro en `docker logs` — se rastreó a que `frontend/src/lib/logger.ts` (`log.info`/`log.warn`, usados en decenas de líneas `[AUTH_REGISTER_FLOW]`/`[AUTH_FACE_UI]` ya escritas para depurar justo esto) sólo imprime en la consola del NAVEGADOR, gateado a DEV/VITE_DEBUG — nunca llegaba al servidor. La ausencia de rastro nunca fue evidencia de que el fallo fuera puramente del cliente. Nuevo `POST /api/client-incident` (público, sin sesión) + `reportClientIncident()` + tres watchdogs en `AuthGateway.tsx` que detectan la transición a "vuelta al formulario sin éxito real" (registro persona/empresa, sesión de login facial) y reportan contexto completo al servidor. |
| 161 | `otp-validacion-contacto-pre-registro` | 🟡 implemented en código, pendiente verificación E2E (requiere rebuild del backend) (2026-09-07) | OTP de 6 dígitos por email/SMS antes de habilitar la cámara del registro biométrico — cierra el registro con contacto ajeno o inventado (`contact_otp_routes.{hpp,cpp}`, en memoria, TTL 10 min, rate-limit 3/15min, reutiliza `notify_service`/`sms_client`). En la misma entrega se corrigieron dos hallazgos reales: `backend/CMakeLists.txt` no compilaba el nuevo `.cpp` (símbolo sin definición) y `authApi.ts` tenía un fallback que daba por válido cualquier OTP si el backend no respondía — bypass de seguridad real, eliminado (falla cerrado). |
| 162 | `tracking-facial-local-mediapipe-wasm` | 🟡 implemented en código; verificado sin cámara real (WASM/modelo self-hosted cargan y `FaceLandmarker` inicializa en el navegador), pendiente prueba visual con cámara real (2026-09-07) | El óvalo guía del rostro era lento (`window.FaceDetector` nativo de Chromium serializaba el bitmap completo por IPC en cada llamada, hasta 1920×1440, sin ROI) e impreciso (tres heurísticas de bbox-inflado distintas —cliente, Haar cascade del backend, bbox-ellipse del backend sobre MediaPipe Python— compitiendo sin geometría real). Además `ovalForStage` priorizaba el óvalo Haar del servidor (`opencv_realtime_tracker`) atándolo a la cadencia de red pese a ser menos preciso. Reemplazo: MediaPipe Tasks Vision (WASM) corriendo en el navegador, mismos 478 landmarks/índices que `ai_engine/eye_analyzer.py` (`FACE_OVAL_INDICES`, EAR de 6 puntos, MAR de boca) — el óvalo sale del contorno real (`FACEMESH_FACE_OVAL`, incluye la línea de nacimiento del pelo) en vez de un factor inventado. Assets (~26MB WASM+modelo) self-hosted en `frontend/public/mediapipe/` por el CSP `connect-src 'self'`. Solo frontend — `realtime_face_tracker.cpp`/`ai_engine_client.cpp` sin tocar, el servidor sigue siendo la autoridad de ICAO/liveness. |

**Ámbito `plataforma`: 48/52 implemented/verified, 1 partial, 1 proposed, 2 pendiente verificación E2E** (recalculado 2026-09-02 tras el cierre E2E de ADR-130, +2 el 2026-09-04 con ADR-153/154, +1 el 2026-09-07 con ADR-161, +1 el 2026-09-07 con ADR-162 (pendiente prueba con cámara real); ADR-033 sigue partial deliberadamente, ADR-035 sigue proposed a la espera de decisión de negocio — ver ADRs individuales).

### Decisiones transversales agregadas el 2026-08-18

| # | Slug | Status | Resumen |
|---|---|---|---|
| 108 | `capacidad-telemetria-25k-topologia-escalamiento` | ✅ implemented a 25k; 100k no aprobado | Fija evidencia 1,5M/1,5M, p99 149,8 ms, recuperación y replay; exige nueva arquitectura/soak antes de reclamar 100k. |
| 109 | `catalogo-zonas-sensores-graficos-multiserie` | 🟡 código implementado; aceptación integrada pendiente (actualizado 2026-09-02: prueba anti-IDOR (SPEC-021 T7) cerrada y verificada por build limpio — 742/742 aserciones; catálogo creció a 13 tipos con geo/3D/combo, ver actualización en el ADR) | Catálogo tipo/zona/dispositivo, consulta histórica acotada y trece gráficos insertables (los 10 originales + mapa geográfico, superficie 3D y combinado línea/barra); falta render/export con datos reales y contrato CI. |
| 110 | `operaciones-campo-offline-integracion-erp` | 📋 proposed | Separa fuentes autoritativas ERP/Beemetry, cliente offline con outbox y artefactos auditables; requiere aprobación y reprogramación. |
| 111 | `portabilidad-stack-export-import-perfil-telemetria` | 🟡 utilidad implementada; aceptación operativa pendiente | Export/import multiplataforma y perfil de telemetría; faltan checksum, cifrado, restore limpio, RTO/RPO y CI/CD. |

### Decisiones transversales agregadas el 2026-08-30

| # | Slug | Status | Resumen |
|---|---|---|---|
| 131 | `consolidacion-modelo-telemetria-unificado` | 🟡 implemented (fases 0-5, 9-10); fases 6-8/13 pendientes de deploy backend | Consolida `dim_tenant`/`dim_site`/`dim_sensor`/`telemetry_fact*` para sostener 25k/s continuos, históricos de hasta 5 años y arquitectura a 10 años; extiende ADR-006/007/008/108/009/034. Dual-write, cutover de lecturas y retiro de tablas legacy quedan fuera de alcance de esta sesión. |
| 136 | `telemetria-calculada-dashboard-simulacion` | ✅ implemented (esquema + endpoint de lectura); cómputo vía script externo interino | Nueva hypertable `telemetry_fact_calc` (métrica derivada por lectura de sensor: nivel de alerta, tasa de cambio, delta vs. umbral) + endpoint anti-IDOR de solo lectura + panel `SimulationMonitor.tsx` para observar en vivo la simulación de 1h contra `board.beemetry.com`. El cómputo lo puebla un script externo por decisión explícita del developer (no un scheduler nuevo en el backend); pendiente decidir si migra al backend C++ si deja de ser interino. |

### Ámbito `core-iot` — plataforma IoT del core C++
| # | Slug | Status | Resumen |
|---|---|---|---|
| 003 | `servidor-http-ws-boost-beast` | ✅ implemented (2026-07-06) | HTTP/WS async con Boost.Beast+Asio (C++20), pool ~15k WS. |
| 007 | `ingesta-telemetria-etapa1-libpq` | ✅ implemented (2026-07-06) | Etapa 1: gateway TLS C++ + libpq directo (simulación 10k). |
| 008 | `bus-eventos-redpanda-etapa2` | ✅ implemented (2026-07-07) | Etapa 2: Redpanda + librdkafka + COPY binario para 10k/seg. |
| 027 | `opencv-procesamiento-imagenes` | ✅ implemented, alcance v0.1 (2026-07-06) | OpenCV en v0.1 = imágenes de informe + captura de mapa; EPP diferida (por diseño). |
| 034 | `core-plataforma-iot-reemplazo-thingsboard` | ✅ implemented (actualizado 2026-09-02) | Core C++ = plataforma IoT propia: ingesta + fórmulas + gestión de dispositivos + alarmas + adaptadores MQTT/Modbus/OPC-UA (los adaptadores, dados por diferidos el 2026-07-09, se confirmaron implementados y corriendo el 2026-07-13). Motor de alarmas reconciliado con SPEC-016 (WS real, no SSE) — ver ADR-140. |
| 054 | `sync-thingsboard-legacy-aws` | ✅ implemented (2026-07-17); sync persistente activo contra `board.beemetry.com` desde 2026-08-30 (ver actualización — descrito como réplica, no confirmado si es el AWS real del cliente) | Conector backfill REST + tiempo real WS que sincroniza el ThingsBoard legacy (hoy AWS) hacia la plataforma propia durante la transición de ADR-034; probado con 6M puntos/10min a 10k/seg. |
| 103 | `integracion-rp-timetelemetry-replica-xmlrpc` | ✅ implemented (2026-08-10) *(fila agregada 2026-08-20 — el ADR ya existía sin fila en esta tabla, ver auditoría arriba)* | Réplica local RP (TimeTelemetry/Odoo) reusando el patrón ETL de ADR-034, escritura de vuelta por XML-RPC, `http_client` compartido nuevo y push realtime por WS para el frontend externo. |
| 120 | `lote-lineas-lectura-tls-mining-gateway` | ✅ implemented (2026-08-20) | `MiningSession::read_line` agrupa hasta `max_lines_per_read` (256) líneas por `async_write` en la sesión TLS cruda del gateway, reduciendo E/S por sesión bajo ráfaga sin cambiar el protocolo de línea; opera por debajo de la topología de consumidores de ADR-108, sin modificarla. |
| 140 | `alertas-umbral-cache-tasa-debounce-sensor` | ✅ implemented, verificado E2E en vivo (2026-09-02) | Reconcilia SPEC-016 con el motor de alarmas real de ADR-034: cache de reglas TTL 60s, condición por tasa de cambio, debounce por ventana (complementa el índice único parcial existente), `PUT` de reglas, paginación del historial, y evaluación EN TIEMPO REAL vía hook en `TelemetryIngestor::copyBatch()` (179ms medido en vivo, reemplaza la dependencia exclusiva del polling de 10s para reglas de `sensor_id`). Canal SSE que SPEC-016 pedía, no construido a propósito — el push real ya es WebSocket. |

**Ámbito `core-iot`: 9/9 implemented.**

> ADR-108 es transversal `core-iot/datos/resiliencia`: la cifra comercial
> aprobada es 25.000 eventos/s por edge en la topología ensayada; 100.000/s
> permanece explícitamente no aprobado.

### Ámbito `datos` — bases de datos y almacenamiento
| # | Slug | Status | Resumen |
|---|---|---|---|
| 005 | `dos-bases-de-datos-sensors-formula` | ✅ implemented (2026-07-06) | `sensors_db` (TimescaleDB) + `formula_db`/operacional (PostgreSQL). |
| 006 | `timescaledb-hypertables-retencion` | ✅ implemented (2026-07-07) | Hypertables + retención/compresión + continuous aggregates. |
| 009 | `almacenamiento-objetos-minio-parquet` | ✅ implemented (2026-07-08) | MinIO (S3 on-prem) + archivado Parquet del histórico frío. |
| 032 | `timescaledb-instancias-ingesta-lectura` | ✅ implemented (2026-07-06) | Dos instancias Timescale: primaria (ingesta) + réplica read-only vía streaming replication. |
| 088 | `seed-empresas-distribuidoras-usuarios-demo` | ✅ implemented (2026-08-05) | TimeTelemetry, Beemetry y 4 distribuidoras reales del rubro minero peruano con RUC sintético marcado como tal; 24 usuarios de prueba ficticios (4 perfiles × 6 empresas) validando la matriz RBAC de ADR-086. |

**Ámbito `datos`: 5/5 implemented.**

### Ámbito `reports` — componente ReportStudio ("proyecto de reportabilidad", primero por prioridad)
| # | Slug | Status | Resumen |
|---|---|---|---|
| 010 | `modelo-documento-json-bloques` | ✅ implemented, premisa de texto corregida (2026-07-17) | Documento = JSON tipado de bloques. Texto: string plano + spans (ADR-050) — la premisa original ("ProseMirror-JSON") no aplicaba a ReportStudioV2, ver actualización en el ADR. |
| 011 | `estructura-formal-secciones-cover-toc` | ✅ implemented, alcance revisado (2026-07-07) | `cover`/`toc` serializables + `headingStyle`; no existe árbol `sections[]`, el modelo sigue en páginas planas. |
| 012 | `binding-dato-widget-referencia-versionada` | ✅ implemented, alcance acotado (2026-07-07) | Widget = referencia + snapshot versionado; snapshot al firmar (no en cada tick). |
| 013 | `editor-tiptap-konva` | ✅ implemented, alcance corregido (2026-07-17) | Layout de página con Konva (vigente). Texto: Tiptap solo en el módulo "Report" v1 (fuera de ReportStudioV2) — Report v2 usa el modelo de ADR-050, ver actualización en el ADR. |
| 014 | `estado-editor-zustand` | ✅ implemented (2026-07-06) | Store Zustand único (no Redux); límite claro cliente↔servidor. |
| 015 | `versionado-informe-server-autoritativo` | ✅ implemented (2026-07-06) | Versiones/auditoría autoritativas en servidor (`report_content_revision`). Pendiente menor: política de retención del historial. |
| 016 | `export-server-side-asincrono` | ✅ implemented (2026-07-06) | Export canónico server-side (Chromium headless); cliente solo fallback. |
| 017 | `workflow-canonico-informe` | ✅ implemented (2026-07-06) | Máquina de estados única front↔BD (draft→in_review→approved→signed→archived). |
| 018 | `firma-documental-vs-integridad-archivo` | ✅ implemented, alcance v0.1 (2026-07-06) | Firma de aprobación humana (v0.1); hash SHA-256 de integridad diferido a futuro por diseño. |
| 019 | `resolucion-diferida-numeracion-toc-refs` | ✅ implemented (2026-08-05) | Numeración/TOC/"Página X de Y" implementados; referencias cruzadas automáticas cerradas — ancla (`span.ref.targetId`) resuelta en render vía `generateTocData`, verificado con test que inserta una sección en el medio y confirma el renumerado automático. |
| 020 | `mapa-bloque-tipado-georeferencia` | ✅ implemented, alcance v0.1 (2026-07-06) | v0.1: snapshot a imagen (popup); bloque tipado con geo-ref real diferido a futuro por diseño. |
| 021 | `ownership-metadatos-ciclo-vida` | ✅ implemented (2026-07-07) | `document.meta.version` (contador local) vs `version_number` (BD, autoritativo) — separación resuelta en la UI. |
| 022 | `offline-cola-versionada-indexeddb` | ✅ implemented — cierre completo (2026-07-13) | Persistencia offline real (SQLite/WASM en vez de IndexedDB) + resolución de conflicto real: concurrencia optimista server-side (`expected_version`/409), prompt de reconciliación al reconectar, y elección sobrescribir-vs-guardar-como-nuevo al guardar. Más: checkpoint forzado cada 3 min en línea (pedido de negocio adicional). |
| 039 | `puente-tenant-id-company-name-informes` | ✅ implemented — migración completa (2026-07-13) | `reports` migrado por completo a `tenant_id` (UUID) como única clave de aislamiento; `company_name` queda solo como display legacy. De paso se corrigió un hallazgo real: `session.tenantId` podía traer un tenant DEMO de fallback para usuarios sin tenant real, evadiendo el chequeo `tenant_required` — cerrado con `userHasRealTenantMembership`. |
| 044 | `exportacion-portatil-cifrada-informes` | ✅ implemented (2026-07-13) | Export/import `.mreport` cifrado AES-256-GCM server-side; mismo tenant sin cambios, otro tenant solo estructura. |
| 045 | `edicion-offline-sqlite-cliente` | ✅ implemented (2026-07-13) | Edición offline: SQLite (sql.js/WASM) local descargada del servidor, banner con fecha/hora del corte, reconciliación al reconectar. |
| 046 | `encabezado-pie-elementos-plataforma-fijos` | ✅ implemented (formalizado 2026-07-17) | Header/footer fijos, no editables; datos de empresa/unidad/usuario calculados en vivo de sesión, nunca en `props`. |
| 047 | `galeria-imagenes-tenant` | ✅ implemented (formalizado 2026-07-17) | Galería de fotos JPEG por tenant, insertable bajo demanda en cualquier página del informe. |
| 048 | `caratula-toda-pagina-imagen-libre` | ✅ implemented (formalizado 2026-07-17) | Carátula ocupa toda la hoja; la foto de empresa es un bloque `image` libre (movible/redimensionable), no un fondo fijo. |
| 049 | `ajuste-texto-alrededor-objetos` | ✅ implemented, extendido (2026-07-17) | 7 modos de ajuste de texto estilo Word alrededor de objetos; extendido para soportar formato mixto (spans, ADR-050) dentro del texto que envuelve. |
| 050 | `formato-texto-por-seleccion-spans` | ✅ implemented (2026-07-17) | Negrita/cursiva/subrayado/color/tamaño/fuente aplicables solo al texto seleccionado (spans sobre string plano) — corrige la premisa ProseMirror de ADR-010/013. |
| 051 | `copiar-pegar-objetos-lienzo` | ✅ implemented (2026-07-17) | Copiar/pegar de bloques dentro del mismo lienzo (portapapeles interno de la app, no del sistema operativo). |
| 052 | `navegacion-zoom-tamano-pagina` | ✅ implemented (2026-07-17) | Navegación de teclado (PageUp/PageDown/flechas), zoom 10%-400%, tamaño de hoja/orientación configurable por página individual. |
| 053 | `estilos-visuales-tabla` | ✅ implemented (2026-07-17) | Galería de temas de color, filas alternadas, bordes configurables, título de tabla; formato por selección en celdas (`contentEditable`+`execCommand`). |
| 055 | `editor-indicador-seleccion-propio` | ✅ implemented (2026-07-18) | Indicador de selección propio (ya no el nativo del navegador) para que el resaltado escale correctamente con tamaño de fuente mixto por tramo; resaltado y ciclo de mayúsculas llevados al mismo criterio "selección o bloque completo" de ADR-050. |
| 062 | `insercion-video-grabado-webcam-pantalla` | 🔄 superseded by 064, 065 (2026-07-21) | Decisión original de inserción de video (ambos orígenes juntos). Separada a pedido de Gerencia en dos ADR independientes por origen de grabación — contenido conservado sin editar, ver nota en el archivo. |
| 064 | `grabacion-video-camara-web-lienzo` | ✅ implemented (2026-07-21) | Grabación de video por cámara web (`getUserMedia`, nuevo — no existía ninguna grabación de video por cámara antes), insertable en el lienzo. Mitad de ADR-062, separada. |
| 065 | `grabacion-video-pantalla-ventana-lienzo` | ✅ implemented (2026-07-21) | Grabación de pantalla/ventana (`getDisplayMedia`, reutiliza el mecanismo del botón "Grabar" preexistente — antes solo exportaba/descargaba), insertable en el lienzo. Mitad de ADR-062, separada. |
| 070 | `bloques-tecnicos-plantillas-semanticas-composicion` | ✅ implemented (2026-07-24) | Callouts, KPI, captions, 10 secciones y 3 gráficos por composición de `text/table/chart`; tablas con semántica/tamaño natural compartidos por editor y visor. |
| 071 | `toc-pagina-dos-continuaciones-automaticas` | ✅ implemented, corregido (2026-07-25) | TOC único en página 2, paginado automáticamente en continuaciones serializadas. El botón del ribbon SÍ inserta el bloque real ahora (antes solo abría un panel de navegación, ver actualización). |
| 073 | `modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon` | ✅ implemented, ampliado (2026-07-27) | `SaveTitleModal` y host global accesible reemplazan todos los `prompt/alert/confirm` activos; contraste corregido y ribbon con `flex-wrap`. |
| 080 | `marca-de-agua-y-password-pdf` | ✅ accepted (2026-08-02) | Vista previa de impresión real, marca de agua por tenant/usuario/fecha y PDF cifrado con contraseña generada por descarga (`qpdf`). *(Fila agregada 2026-08-03 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba.)* |
| 083 | `exportacion-pptx-modo-presentacion-sidecar-hibrido` | ✅ implemented (2026-08-03) | Export a PPTX (modo presentación, mismo sidecar Chromium del PDF): captura por página + overlay de texto NATIVO editable/buscable para bloques `text`, gateado por `layoutMode`, job asíncrono real sobre `report_export_job`. Corrige de paso un bug preexistente en `ReadOnlyViewer` (sin `layoutMode`) que también afectaba al PDF. |
| 084 | `conversion-pptx-video-narracion-diapositiva` | ✅ implemented (2026-08-03) | Convierte el PPTX de ADR-083 a MP4 (`ffmpeg`, corte o fundido) con narración opcional por diapositiva (audio grabado o notas de orador, TTS diferido). Bug real de truncado de video corregido (`-c:v copy` con VFR) y brecha RBAC cerrada (narración exige `informes.edit`, no solo `informes.view`). |
| 092 | `plantilla-corporativa-timetelemetry-referencia-diseno` | ✅ accepted (2026-08-07) | Registro de referencia de diseño (no una decisión de arquitectura): colores, tipografía (Roboto, no Aptos), estilo de tabla e inventario de 26 layouts extraídos de `Plantilla Telemetry.potx` (entregada por Gerencia). Insumo directo para una futura generación de PPTX con identidad visual oficial (ADR-083/084). |
| 127 | `aislamiento-cache-offline-sqlite-por-usuario` | ✅ implemented (2026-08-20, ADR redactado 2026-08-21) | Caché offline SQLite del navegador (Cache API) aislado por `userId`+`tenantId` en vez de un único nombre global compartido por todo el origen; migración de una sola vez del caché legado; purga en logout salvo cambios `dirty=1` sin sincronizar. Corrige exposición real de datos entre técnicos que comparten tablet de campo. |
| 128 | `plantillas-documento-tipo-presentacion` | ✅ implemented (2026-08-20, ADR redactado 2026-08-21) | `docType: 'presentation'` en el catálogo de plantillas — autoría nativa de presentaciones 16:9 (`forceNewSlide`, sin TOC) desde el wizard, distinto de exportar un informe ya existente a PPTX (ADR-083/084). |
| 137 | `envio-informes-notificaciones-multicanal` | 🟡 implemented, verificado E2E en vivo para in_app/email (2/4 canales); WhatsApp/SMS bloqueados por infraestructura externa (2026-09-02) | `POST /api/reports/{id}/share` reemplaza un mock que no tocaba el backend; servicio `notify::dispatch()` reutilizable (`in_app`/`email`/`whatsapp`/`sms`) con traza en `notification_dispatch_log`. Cierra de paso un bug real: `reports.created_by` nunca se llenaba, bloqueando al propio autor de reabrir su borrador. Pendiente documentado: guardia de `/api/notifications/send` filtra por `company_name`, no `tenant_id` (ADR-039) — posible divergencia, no resuelta unilateralmente. |
| 138 | `enlace-directo-pdf-qr-sin-password` | ✅ implemented, verificado en vivo (export real + QR decodificado con lector independiente + PDF abierto con la contraseña resultante) (2026-08-31) | Segundo mecanismo de QR, complementario a ADR-080 (no lo reemplaza): `report_pdf_share_links` (token opaco, expira 48h) + `GET /api/reports/share/{token}/pdf` sin sesión (mintea una sesión interna efímera solo para el render) sirve el PDF SIN cifrar con `Content-Disposition: inline` — logra "escanear y se abre solo". Documenta por qué "QR que auto-completa la contraseña de un PDF cifrado" es imposible en cualquier lector (restricción de todos los sistemas operativos, no de esta app). |
| 139 | `exportacion-docx-nativa-cliente` | ✅ implemented, verificado E2E en vivo (2026-09-02) | Pipeline de exportación a `.docx` (OpenXML real, librerías `docx`+`jszip`) 100% client-side, sin endpoint backend — diverge conscientemente del patrón server-side de ADR-016. Contenido nativo editable (texto/tabla/spans/TOC); solo `chart`/`sensor_multi_chart`/fondo de carátula se capturan como imagen. Verificado vía Browser pane: 26 partes OOXML reales validadas estructuralmente (ZIP+DEFLATE+XML), export real interceptado y parseado en el navegador. |

**Ámbito `reports`: 37/39 implemented/accepted, 1 pendiente E2E y 1 superseded** (ADR-019 pasó de partial a implemented el 2026-08-05, ver su actualización; ADR-139 cerró su pendiente E2E el 2026-09-02; ADR-079 es ámbito `plataforma`, no `reports` — su fila ya está reconciliada en la tabla de `plataforma` arriba). Ver "Progreso del proyecto de reportabilidad" abajo (cálculo no recalculado en esta pasada para 080/083/084 — cubre 010-073 + 019).

### Ámbito `ia` — inteligencia artificial local
| # | Slug | Status | Resumen |
|---|---|---|---|
| 024 | `ia-local-ollama-languagetool` | ✅ implemented, refinado por 068 | Redacción/corrección local con Ollama + LanguageTool; ADR-068 agrega búsqueda bibliográfica externa acotada, no IA cloud para redactar. |
| 025 | `biometria-vision-epp-diferidas` | 🚫 EPP deferred; login facial activo con gate legal (2026-07-24) | Se reconcilia el runtime: login facial existe; visión EPP y ampliaciones biométricas siguen diferidas. |
| 068 | `ia-editorial-multimodelo-referencias-externas-controladas` | ✅ implemented (2026-07-24) | LanguageTool + `gemma2:2b` rewrite + `qwen2.5:7b` APA. Búsqueda bibliográfica externa opt-in, explícita y acotada; nunca cuerpo del informe/telemetría. |
| 074 | `avatar-biometrico-local-hd-bajo-demanda` | ✅ implemented, verificado (2026-07-27) | MediaPipe/OpenCV local + fallback ONNX, miniatura en sesión y maestro 2880×3840 privado bajo demanda; modal doble clic/cierre exterior. |
| 089 | `biometria-dermalog-cli-integration` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba)* | SDK comercial Dermalog Face (`BiometricProvider::DermalogCli`, subproceso vía `dermalog-face-cli`) como validador biométrico principal por exigencia de cumplimiento/certificación; InsightFace (ArcFace) pasa a fallback automático si el binario Dermalog falla. Sustituye formalmente `specs/adr/ADR-005` (que ya tiene el banner `SUPERSEDED` correcto apuntando aquí). |
| 090 | `deprecacion-adr-tempranos-ia` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07)* | Formaliza que `specs/adr/` (metodología SDD temprana) queda deprecado como fuente para el router de IA/RAG a favor de `docs/decisions/` — consistente con la nota ya existente de este mismo README (2026-07-24, "`docs/decisions/` pasa a ser la fuente canónica efectiva para RAG, agentes y CI"). |
| 091 | `opencv-composicion-raii` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07)* | Procesamiento/composición de imágenes en C++ con OpenCV vía patrón RAII (gestión determinista de recursos nativos); implementa CANDIDATE E6. |
| 097 | `numpy2-onnxruntime-opencv-python-ai-engine` | ✅ implemented, verificado (2026-08-08) | `ai_engine` migrado a NumPy 2.x, onnxruntime 1.23.2, opencv-python-headless 4.14.x; mediapipe e insightface se mantienen sin cambio (releases mayores demasiado recientes, sin ciclo de prueba). Shim de compatibilidad `np.int` para InsightFace 0.7.3 (bug confirmado upstream, sin release en PyPI). |
| 098 | `aislamiento-sesion-captura-biometrica` | ✅ implemented, verificado (2026-08-08) | `X-Capture-Session-Id` por pestaña, propagado frontend→backend→ai_engine. `gBiometricCaptureState` y la histéresis de lentes/EAR en `eye_analyzer.py` eran globales de proceso compartidas por todas las capturas concurrentes. |
| 099 | `fallback-insightface-no-bloqueante` | ✅ implemented, verificado (2026-08-08) | `analyzeFaceImage()` intentaba InsightFace primero y, si fallaba, retornaba sin caer al pipeline legacy — contradecía ADR-089 (InsightFace es motor secundario). Fallback real restaurado. |
| 100 | `onnxruntime-thread-limit-insightface` | ✅ implemented, verificado (2026-08-08) | `/face_embedding` tardaba 4-7s con 398% CPU por sobre-suscripción de hilos de onnxruntime (host vs. cuota de cgroup del contenedor). `intra_op_num_threads=2` inyectado vía parche de `InferenceSession`: 0.6-0.8s, 8.7% CPU. |
| 104 | `seetaface6-proveedor-biometrico-local` | 🔄 superseded by 105 (2026-08-12) | SeetaFace6Open, libre y chino, como proveedor Docker seleccionable con reconocimiento 1:1 de 1024 componentes y PAD fail-closed. No afirma certificación RENIEC/ISO/NIST; exige calibración y evidencia externa antes de producción. Queda en el enum por rollback pero deja de ser el default. |
| 105 | `deepface-silentface-proveedor-biometrico-primario` | ✅ implemented (2026-08-12) | DeepFace (Facenet512) + Silent-Face-Anti-Spoofing (MiniFASNet) como proveedor biométrico local por defecto, con Dermalog como secundario explícito solo ante fallos de infraestructura (nunca ante rechazos de seguridad). Corrige además la rama de despacho faltante en `loginFaceTargetedPg` que bloqueaba el login facial Postgres de cuentas SeetaFace6. |
| 119 | `validacion-lentes-biometria-login-y-fusion-onnx` | ✅ implemented (2026-08-19), pendiente verificación con cámara real | Tres causas independientes de "deja pasar con lentes puestos": (1) login facial (los tres proveedores) nunca llamaba a `/analyze_eyes`, sin chequeo ICAO en servidor; (2) captura de registro completaba en 3 frames, por debajo de la ventana de histéresis de lentes (5); (3) fusión CV+ONNX en modo `cv_primary` solo dejaba que ONNX vetara, nunca confirmara — 100% de 3515 falsos negativos reales en `glasses_probe.jsonl` tenían ONNX en 0.7-0.9 pero CV sin señal. Los tres corregidos; replay contra el log real confirma detección en el frame 3 en las 5 sesiones registradas. |
| 124 | `pool-conexiones-tcp-ai-engine` | ✅ implemented (2026-08-20, ADR redactado 2026-08-21) | Pool en memoria de conexiones TCP idle hacia `ai_engine` (`AiEngineConnPool`, 16 idle/destino, reuso optimista con reintento único), reemplaza abrir/cerrar una conexión por cada verify-frame (cada 175ms) en el hot path biométrico. |
| 125 | `recalibracion-thread-safety-eye-analyzer` | ✅ implemented (2026-08-19, ADR redactado 2026-08-21) | Recalibración de EAR por resolución de cámara 640×480→960×720 (`EAR_IED_REF_PX` 95→143, `EAR_IED_SCALE_MAX` 1.12→1.00); `combined_ear` (mejor de los dos ojos); `_mediapipe_lock` sobre `FaceLandmarker` compartido (única línea del hot path sin serializar); `head_yaw_ratio_from_points` — groundwork expuesto de punta a punta pero sin gate que lo consuma (ver ADR-126). |
| 126 | `liveness-activo-desafio-respuesta` | ✅ implemented y activo (construido 2026-08-19, reactivado y recalibrado 2026-08-21) | Liveness activa (ISO/IEC 30107-3): 2 de 4 desafíos sorteados (parpadear/boca/girar cabeza) por sesión. Desactivado el 2026-08-19 tras 0% de finalización real con ventana de 4.5s; reactivado 2026-08-21 con ventana 8s/4 intentos (recalibración conservadora, sin telemetría de campo nueva — requiere monitoreo post-despliegue). |
| 141 | `avatar-estilizado-difusion-local-sd15-controlnet` | 🟡 build, GPU, integración y carga validados **vía imagen de prueba aislada**; el bloqueante de cuDNN que impedía el build oficial de `ai_engine` quedó resuelto de raíz por ADR-143 (no por este ADR); apagado por defecto mediante flag + perfil Compose; pendiente CA-15(a), calidad con retratos reales autorizados (2026-09-03) | Estilizador opcional (`AVATAR_STYLE_ENGINE=diffusion` + perfil `avatar-diffusion`) sobre ADR-074: SD1.5 img2img + ControlNet-Canny bajo OpenRAIL, en un servicio Docker propio sin TensorFlow. Smoke sintético e integración `ai_engine → avatar_engine` verificados de punta a punta (`generator:"local_sd15_controlnet"`, contadores incrementados en ambos servicios); carga de 5 solicitudes confirmó 3 serializadas + 2 `503 busy`. Corrigió además una afirmación previa (de una edición concurrente) que daba esta integración por completada sin evidencia — era falsa, el contenedor real corría una imagen del 20-ago sin el cliente nuevo. Pendiente validar semejanza con 10-20 retratos consentidos. Registrado en SPEC-008 (CA-11..CA-15, T20). |
| 144 | `inspireface-evaluacion-licencia-academica` | ⚪ evaluado, no adoptado (spike de I+D autorizado, 2026-09-03) | Evalúa InspireFace (Opción C) como alternativa a ADR-105/099: SDK Apache-2.0, pero los packs de modelos gratuitos heredan la restricción "solo uso académico" de InsightFace (mismo patrón de riesgo de licencia ya identificado con AnimeGANv2 en ADR-074) — Beemetry es producto comercial, no se integra como `BiometricProvider`. Spike aislado en `spikes/inspireface_bakeoff/` (nunca importado por `ai_engine/`/`backend/`): 99,17% precisión / ~21ms CPU sobre un subconjunto no oficial de LFW, pero 17% de imágenes con más de un rostro detectado (señal de alerta, no dato menor) y sin medición de liveness/PAD — preliminar, no evidencia de calibración (CA-10 de SPEC-008 sigue pendiente para cualquier proveedor). |
| 142 | `liveness-challenge-verificado-en-servidor` | ✅ implemented (2026-09-03); desafío activo reactivado por ADR-145 tras un apagado temporal puntual | Los 2 desafíos de liveness de ADR-126 ahora los decide y verifica el **servidor** (`liveness_challenge.hpp/.cpp`, sin OpenCV para testear con Catch2), no el cliente — cierra un bypass real: antes `POST /api/auth/login/face`/`register` no consultaban la sesión de captura en absoluto, así que un cliente scripteado podía loguearse/registrarse con una imagen estática sin haber demostrado nunca parpadeo/boca/giro reales. Interruptor operativo `AppConfig::gLivenessChallengeRequired` (env `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED`). El número de lecturas ICAO (3→5) fue revisado de nuevo por ADR-145. |
| 145 | `parpadeo-natural-simultaneo-5-lecturas` | ✅ implemented (2026-09-03); gestos del desafío activo revisados de nuevo por ADR-146 | `kRequiredValidCaptureFrames` vuelve a 5 (había bajado a 3 en ADR-142). Durante esa misma ventana se evalúa parpadeo NATURAL (pasivo, sin pedir gesto) como prueba de vida simultánea con el resto de chequeos ICAO — a diferencia del desafío activo, que por naturaleza sólo puede correr en secuencia. `NaturalBlinkState`/`updateNaturalBlink` (`liveness_challenge.hpp/.cpp`) toleran un cierre de ojos breve (< 1500ms) sin penalizar el streak de captura, y registran el ciclo cerrado→abierto como prueba de vida. Nuevo toggle `gNaturalBlinkRequired` (siempre activo por defecto, independiente del desafío activo). Reactiva además `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=true` a pedido explícito del usuario (defensa en profundidad contra video pre-grabado de celular, que el parpadeo solo no detecta). |
| 146 | `desafio-1-gesto-acercarse-alejarse-camara` | ✅ implemented (2026-09-03) | El desafío activo de ADR-142/145 baja de 2 gestos a 1, y el pool deja de incluir blink/mouth (el parpadeo ya lo cubre, mejor, el parpadeo natural pasivo de ADR-143) a favor de `move_closer`/`move_away` (acercarse/alejarse de la cámara) — más manejable que abrir la boca o inclinar la cabeza (probado y descartado en la misma sesión), junto con `turn_left`/`turn_right` que ya existían. Nuevo eje de medición `inter_eye_px` (`ai_engine/eye_analyzer.py`, ya calculado internamente, sólo se expone en la respuesta), con la distancia de referencia (`baselineInterEyePx`) capturada al sortear la cola: el umbral es proporcional a esa referencia de sesión, no absoluto (la distancia interocular varía mucho entre personas/cámaras). Umbrales (`kLivenessMoveCloserRatio=1.25`, `kLivenessMoveAwayRatio=0.80`) sin validar todavía con datos reales de producción — vigilar `liveness_challenge_metrics` tras el despliegue. |
| 147 | `buffer-nginx-reintento-transitorio-precheque-dni` | ✅ implemented (2026-09-04) | Tres hallazgos de una misma sesión de depuración real: (1) `client_body_buffer_size` nunca configurado en `frontend/nginx.conf` — cada `/api/process_frame` (JPEG 1280x960, ADR-145/146) se bufereaba a disco antes de reenviarse al backend, agregando latencia real a un endpoint de cadencia ~175ms (confirmado por el warning de nginx en cada request); fix: `client_body_buffer_size 2m`. (2) Un timeout de red durante el registro dejaba `registerAutoSubmitTriggeredRef` trabado para siempre (regla pensada para NO reintentar tras un rechazo determinístico del servidor, ej. username duplicado) — contradecía el propio mensaje de error ("intente de nuevo"); fix: `postJson` marca errores sin respuesta del servidor como `.transient`, y sólo esos liberan el trigger. (3) El DNI es UNIQUE GLOBALMENTE en `auth_users` (una persona, una cuenta en toda la plataforma, no por empresa) — se detectaba recién al final de los ~1-2 min de captura facial; nuevo `POST /api/auth/register/check-dni` (`checkDniExistsPg`, misma query exacta que el chequeo real de `registerUserPg`) llamado ANTES de abrir la cámara. Resuelto el mismo día: `UserManagementView.tsx`/`MaintenanceBiometricModal.tsx` no tenían UI para el desafío activo de ADR-146 (rechazo silencioso con `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=true`) — fix vía hook compartido `useLivenessChallengeSync` (extraído de `AuthGateway.tsx` sin tocar su implementación ya probada), ahora usado en las dos pantallas de admin. |
| 148 | `fusion-parpadeo-sensible-y-candado-lecturas-icao` | ✅ implemented (2026-09-04) | Dos bugs reales compuestos causaban el reporte "tras 5/5 el desafío se demora demasiado o nunca llega a salir", diagnosticados con logs reales de una sesión afectada (EAR/blink de un parpadeo real y sostenido que el sistema nunca detectaba). (1) `both_open_robust`/`bothOpen` fusiona `max(EAR)`/`min(blink)` entre ambos ojos a propósito, para proteger el chequeo ICAO real de falsos rechazos por ruido de un solo ojo — pero `updateNaturalBlink` (ADR-143) reutilizaba esa misma señal para detectar el parpadeo, y con ese sesgo un parpadeo real casi nunca la hacía caer a "cerrado"; fix: nueva señal dedicada `blink_signal_open` (`ai_engine/eye_analyzer.py`), fusión opuesta `min(EAR)`/`max(blink)`, usada SÓLO por `updateNaturalBlink` — el chequeo ICAO en pantalla sigue en `bothOpen`, sin cambios. (2) El candado que evita que `captureInvalidStreak` resetee `captureCount` dependía de `qualityGateReached` (ICAO + parpadeo), que se queda en `false` mientras se espera el parpadeo — así que un fallo ICAO transitorio DURANTE esa espera podía resetear un 5/5 ya logrado, en silencio; fix: nuevo candado `icaoReadsLocked` desacoplado del parpadeo (sólo depende de `captureCount`/`totalFramesSeen`), con la evaluación de `qualityGateReached` movida fuera del bloque de reseteo para que siga corriendo cada frame. |
| 149 | `desafio-activo-en-paralelo-con-espera-de-parpadeo` | ✅ implemented (2026-09-04) | Reporte real de seguimiento a ADR-148 (mismo día): "hizo rápido 5/5 pero se demoró en activar el reto" (lo llegó a pasar, pero con demora). Causa: el desafío sólo se armaba con `qualityGateReached` (ICAO + parpadeo natural), encadenando ambas pruebas de vida EN SECUENCIA — pero un parpadeo involuntario tarda en promedio 2-4s, muy por encima de los ~875ms que toman las 5 lecturas ICAO, así que casi siempre había una espera real y silenciosa entre "5/5 en pantalla" y la aparición del reto. Como el gate FINAL de login/registro ya exige ambas pruebas por separado (`qualityGateReached && challenge.complete`, sin cambios), no hace falta que el desafío espere a que el parpadeo ya haya ocurrido — se desacopla el arranque del desafío a `icaoReadsCompleted(st)` (sólo ICAO, nuevo helper en `biometric_types.hpp`), corriendo en PARALELO con la espera del parpadeo, sin bajar el nivel de exigencia de seguridad. |
| 155 | `avatar-diffusion-desactiva-safety-checker-nsfw` | ✅ implemented (2026-09-04) | El avatar por difusión (ADR-141) salía siempre como la foto real sin estilizar — logs reales de `avatar_engine` confirmaron el safety checker NSFW por defecto de SD1.5 rechazando repetidamente ("Potential NSFW content was detected... A black image will be returned instead") fotos de registro normales, un falso positivo conocido de ese checker fuera de su diseño original (generación libre de texto). Decisión explícita del usuario: desactivarlo (`safety_checker=None, requires_safety_checker=False`) — la entrada siempre pasó ya por el liveness/anti-spoofing real, este checker no aportaba protección adicional en este flujo. Verificado: el pipeline pasó de cargar 7 a 6 componentes al arrancar. |
| 156 | `contador-icao-sin-tolerancia-y-retos-variados-con-reinicio` | ✅ implemented (2026-09-04) | Tres síntomas reportados juntos en el registro facial en vivo: el contador 1/5..5/5 subía sin cumplirse las 4 condiciones ICAO, el reto no variaba, y el proceso quedaba colgado hasta el timeout. Causas: (a) el contador toleraba 4 frames inválidos seguidos antes de resetear (`captureInvalidStreak >= 5`), tolerancia que ya no hacía falta desde que ADR-143 trata el parpadeo aparte — así el progreso sobrevivía a frames malos; (b) al vencer la ventana se reintentaba 4 veces el MISMO tipo y luego se sorteaba un reemplazo con reintentos frescos: un bucle infinito que nunca se rendía. Decisión: `kIcaoInvalidFramesBeforeReset = 1` (cualquier condición que falle devuelve el contador a 0/5), cada intento sortea un tipo DISTINTO al que venció, y `kLivenessChallengeMaxAttempts = 5` pedidos como máximo — agotados se marca `exhausted` y `handleProcessFrame` reinicia toda la captura a la etapa 1. La UI pasa a mostrar "Intento N de 5" en vez del inútil "Desafío 1 de 1". |
| 157 | `avatar-encuadre-y-visibilidad-en-primera-sesion` | ✅ implemented (2026-09-04), validación visual con registro real pendiente | Dos reportes reales sobre la misma cuenta nueva. (1) El avatar no aparecía hasta cerrar sesión y volver a entrar: el registro devuelve la sesión SIN avatar a propósito (se genera en el hilo detached `AUTH_REGISTER_CARTOON_BG`, 15-40s) y el frontend nunca volvía a consultar; nuevo `GET /api/auth/avatar/thumb` (`ready`/`pending`, resuelto por sesión como `/avatar/hd`) + sondeo acotado (6s, 20 intentos, sólo si falta el avatar) que completa la sesión sin re-login. (2) El avatar llegaba como la foto cruda pese a que ADR-155 ya estaba operativo: logs reales muestran las 3 seeds con `stylize ok` y las 3 rechazadas con `face_too_large(h=0.81..0.83)` — `AVATAR_QUALITY_MAX_FACE_FRACTION=0.55` se calibró sobre lienzos COMPUESTOS pero se aplicaba también sobre el recorte de busto, donde el rostro ocupa 0.7-0.85 por construcción; umbral propio para la etapa raw (`..._RAW=0.88`, el control del compuesto final sigue en 0.55) y reencuadre previo a la difusión sólo por padding blanco y reversible (`_diffusion_reframe_pad`, rostro a ~0.45 del alto con headroom). Se suman penalizaciones de encuadre en la captura (demasiado cerca, descentrado) que reordenan qué frame ya aprobado por ICAO gana como fuente, sin bloquear ninguno. |
| 158 | `avatar-fuente-solo-etapa-1-icao` | ✅ implemented (2026-09-04), validación con registro real pendiente | Observación del usuario: el avatar debe salir del mejor frame de las 5 lecturas ICAO consecutivas (etapa 1), nunca de la etapa 2 (desafío activo, persona en movimiento). El código hacía exactamente lo contrario: la condición de captura era `challengesPassedRef.current`, o sea que NO se guardaba ningún candidato hasta DESPUÉS de completar el gesto — y como el gesto rompe la frontalidad y resetea el contador a 0/5, la fuente del avatar eran siempre los 5 frames que la persona acumulaba mientras se reacomodaba, que con `move_closer` (ADR-146) empiezan con la cara pegada a la cámara. Es la causa directa del `face_too_large(h=0.81..0.83)` de ADR-157. Nuevo `challengeStartedRef` cierra la ventana en cuanto el servidor sortea el primer reto; la captura pasa a `!challengeStartedRef.current`. La ventana real es holgada: el cliente llega a 5/5 en ~85ms (rAF ~60fps) contra ~875ms del servidor (5 frames a ~175ms). Desempate con `visualQuality * 2` (dentro de la etapa 1 el resto de términos son constantes) y frescura del candidato 20s → 90s (ahora nace antes del desafío, que puede durar 5×8s). NO cambia ninguna garantía de liveness: el desafío sigue gateando el ENVÍO. Aplicado además a TODAS las pantallas de captura facial: nuevo `auth/bestBiometricFrame.ts` (colector compartido + `faceBoxFromServerOval` para pantallas sin MediaPipe local) usado por `UserManagementView` y `MaintenanceBiometricModal`, que antes tomaban directamente el frame en vivo del instante del gate — o sea el final del gesto — sin comparar nada. |
| 159 | `avatar-mejoras-calidad-gfpgan-steps-mejor-seed` | 🟡 implemented en código, build/despliegue pendiente (Docker Desktop no disponible en la sesión) | Tres mejoras pedidas explícitamente por el usuario tras validar ADR-157/158. (1) Restauración facial GFPGAN (TencentARC, Apache 2.0, mismos pesos ya vetados para `avatar_animation_engine`/ADR-150) como post-proceso opcional sobre la salida de SD1.5 -- nunca lanza, si falla la carga o el enhance se sirve la imagen sin mejorar; nuevo `requirements-gfpgan.txt` con `--no-build-isolation` (mismo hallazgo real de basicsr ya documentado en avatar_animation_engine). (2) `AVATAR_DIFFUSION_STEPS` 32→40 y `AVATAR_DIFFUSION_MAX_SIDE` 768→896: más detalle fino a costo de tiempo, aceptable en el flujo asíncrono post-registro. (3) `_diffusion_stylize_with_quality_retry` elegía la PRIMERA seed que pasaba ambos controles de calidad aunque una posterior tuviera mejor similitud de identidad real (`identity_sim` ya se calculaba pero sólo como filtro pasa/no-pasa) -- ahora compara las 3 y devuelve la de mayor similitud, sin costo extra de GPU (ya se generaban las 3 cuando hacía falta reintentar). |
| 143 | `silentface-servicio-aislado-cudnn` | ✅ implementado y verificado en runtime real, incluida carga concurrente (2026-09-03); contenedor real sin recrear todavía, corte a producción pendiente de decisión | Silent-Face-Anti-Spoofing (PyTorch/MiniFASNet) movido a servicio propio `silentface_engine`, aislado de TensorFlow/DeepFace — resuelve de raíz (no evita) el bloqueante de cuDNN documentado en ADR-141: con `torch` fuera de `ai_engine`, `docker compose build ai_engine` **resuelve y construye sin conflicto por primera vez**. Contrato HTTP externo (`/deepface_analyze`, backend C++) sin cambios. Verificado con evidencia real: build limpio, health checks, integración de punta a punta reproduciendo el mismo JSON que el código original, prueba de fail-closed (servicio caído → `503 silentface_unavailable`, nunca aprueba por defecto), y carga concurrente real (10/20/50 requests simultáneas) — esta última encontró y corrigió un **bug de concurrencia preexistente** en el detector vendorizado (`cv2.dnn.Net` no es thread-safe, 4/50 fallaban con `OverflowError` antes del fix; 50/50 después). Se descartaron antes: subir TensorFlow a 2.18 (falló en runtime real por falta de kernels CUDA para GPU Blackwell, no por cuDNN) y bajar `torch` a cuDNN 8.x (pierde kernels sm_120 ya confirmados necesarios). |
| 150 | `avatar-animado-reenactment-evaluacion` | 🟡 en evaluación — Fase A (SadTalker) implementada y **verificada end-to-end contra el pipeline real** (dos corridas, 2026-09-04 y 2026-09-07: tono sintético y luego habla real vía TTS local), Fases B/C (LivePortrait, LatentSync) documentadas sin implementar | Diagnóstico externo proponía LivePortrait/Linly-Talker/LatentSync-SadTalker para la deriva de identidad de ADR-141; hallazgo real: son modelos de reenactment/lip-sync (foto+señal conductora), no de estilización — desajuste técnico con el objetivo de ADR-141. Confirmado con el usuario: función nueva de avatar animado, no reemplazo. Licencias: SadTalker (Apache 2.0, sin InsightFace) único directamente viable; LivePortrait y LatentSync dependen de pesos InsightFace/X-Pose "non-commercial research only" (mismo bloqueante que InstantID en ADR-141), pendientes de parche InsightFace→MediaPipe. Servicio nuevo `avatar_animation_engine` (puerto 5003, mismo patrón que `avatar_engine`), gateado por perfil Compose (`avatar-animation`). Dos bugs reales de compatibilidad NumPy 1.24+ en código SadTalker de 2023 encontrados y parchados con verificación de build (`grep -q`). Medición real de pico de VRAM (no solo residente): **7748/8151 MiB con `avatar_engine` activo — solo 403 MiB de margen**, confirma que la exclusión mutua documentada es necesaria, no una precaución excesiva. Fuera de alcance: wiring a `ai_engine`/backend/frontend. |
| 160 | `avatar-cuerpo-completo-pose-driven-descartado-vram` | ❌ descartado para este hardware (2026-09-07) | Extensión de alcance pedida sobre ADR-150: video de cuerpo completo con movimiento real (deporte, trabajo en mina, manejar camión). Desajuste técnico, mismo patrón que motivó ADR-150: SadTalker no hace esto con ningún ajuste, es una categoría de modelo distinta (pose-driven video generation: Moore-AnimateAnyone, Champ, MagicAnimate). Investigación de licencia+VRAM: las tres opciones tienen licencia de código permisiva (Apache 2.0/MIT/BSD-3), sin el bloqueante de InsightFace que sí tuvo ADR-150 — pero Moore-AnimateAnyone exige **≥16GB VRAM** y Champ **~20GB** según sus propios README, muy por encima de los 8151 MiB totales de este host (que además ya mide 7748 MiB de pico solo con SadTalker, ADR-150). Camino real si se prioriza: otro hardware (16-24GB+), API comercial de terceros, o reducir el alcance a imagen estática de contexto (ya resuelto por `avatar_engine`/ADR-141) en vez de video con movimiento corporal real. |
| 164 | `avatar-busto-uniforme-logo-y-wiring-soporte` | 🟡 implementado; `avatar_engine` recreado y verificado con inferencia GPU real (sin PII); backend con tests Catch2 en verde; redeploy de `beemetry-api`/`beemetry-web` y calidad visual sobre rostro real consentido pendientes (2026-09-08) | Extiende ADR-150 (busto animado) sin reabrir ADR-160 (cuerpo completo, descartado): uniforme de campo minero agregado a `_STYLE_PROMPT`, logo Beemetry pegado por compositing determinístico (`apply_logo_badge`, NO generado por difusión — SD1.5 no renderiza logos legibles), verificado sin GPU dentro del contenedor real. `AvatarWidget.tsx` deja de estar hardcodeado a "welcome": nuevo `requestSupportAvatar()` (mismo patrón `CustomEvent` que `ConfirmActionDialog`) cableado a `onboarding` (registro), `report` (export PDF/DOCX/PPTX) y `alarm_loop` (alarma crítica nueva); `kpi` queda diferido a propósito, sin punto de disparo real en la UI. Viewport-clamped drag reusando la mecánica de `TableBlock.tsx` (sin librería nueva). Sin selector de género (innecesario, cada usuario ya ve su propia foto estilizada) ni migración DB nueva. |

| 163 | `curacion-dataset-lentes-reentrenamiento-onnx` | 🟡 partial — curación implementada y verificada (2026-09-07), reentrenamiento v3 en curso (2026-09-08) | Pedido explícito del usuario: curar el pool de entrenamiento gafas/sin-gafas (66,278 imágenes, nunca antes revisadas imagen por imagen) antes de reentrenar el clasificador ONNX consumido por ADR-119. Nuevo `data/curate_glasses_dataset.py` reutiliza InsightFace buffalo_l (mismo paquete de producción, solo los submódulos necesarios) para filtrar por: exactamente 1 rostro, frontalidad (yaw/roll), calidad (brillo/desenfoque), encuadre rostro-hombros, excluye niños/adultos muy mayores (sin filtro de género, pedido explícito), duplicados exactos y archivos corruptos. Corrida completa real: 66,038 procesadas, 53,267 conservadas (80.7%), ~7.1h; pool curado final 23,403 con lentes / 30,052 sin lentes. El clasificador en producción (`glasses_classifier_v2.onnx`) se había entrenado 2 días *antes* de esta curación, sobre el pool crudo sin filtrar — v3 (en curso) reentrena sobre el pool ya curado; pendiente comparar val_acc contra v2 y validar contra `glasses_probe.jsonl` real antes de promover a producción. |
| 165 | `cpu-saturacion-workers-curacion-lentes` | ✅ implemented, verificado en vivo contra el proceso real (2026-09-10) | Capacidad, no el cuelgue puntual de ADR-125: `curate_glasses_dataset.py` (ADR-163) crea su propia `FaceAnalysis` por fuera de `face_embedding_insight.py`, así que nunca heredó el fix de ADR-100 — mismo diagnóstico raíz (onnxruntime sin límite de hilos vía `SessionOptions`, kwargs descartados en silencio por `FaceAnalysis`) más OpenCV con su propio pool de hilos (`cv2.setNumThreads`) sin tocar, más el default de `--workers` calculado sobre `os.cpu_count()` (núcleos del host, 32) en vez de la cuota real del cgroup (12) — con `--workers 8` esto medía 1188% CPU del contenedor `beemetry-ai-vision` (compartido con el login/registro facial real) y `/health` en 90-673ms. Fix: mismo monkeypatch de `onnxruntime.InferenceSession.__init__` que ADR-100, `cv2.setNumThreads(1)`, `os.nice(10)` para priorizar el tráfico en vivo bajo contención, y `_container_cpu_budget()` (lee `/sys/fs/cgroup/cpu.max`/`cpu.cfs_quota_us`) para un default de `--workers` acotado a la cuota real. Verificado contra la corrida real en producción: 1188%→725% CPU total, ~150%→~88% por worker, `/health` 90-673ms→8-10ms. |
| 166 | `decomiso-insightface-secundario-adopcion-seetaface6` | ✅ accepted (decisión de producto/licencia, 2026-09-11); wiring de implementación pendiente | Decomisiona InsightFace (`buffalo_l`) como motor biométrico secundario (ADR-089/099): investigando la licencia de InspireFace (ADR-144) se confirmó que InsightFace tiene la misma restricción no comercial en sus modelos — código MIT, modelos con licencia aparte, sin tier gratuito comercial (verificado contra la página de licenciamiento de InsightFace y `deepinsight/insightface#2587`). A diferencia de InspireFace, InsightFace SÍ está en producción hoy — cierra formalmente la decisión comercial que ADR-144 dejó pendiente. Adopta SeetaFace6Open (ya integrado desde ADR-104, licencia BSD confirmada) como reemplazo; evalúa y descarta libfacedetection (BSD-3-Clause) por desajuste técnico — es solo detector, no genera embeddings de identidad. Cuentas `face_template_provider='insightface_onnx'` existentes son de prueba (desarrollo), se eliminan/reinscriben sin impacto de negocio. |

**Ámbito `ia`: 22 implemented/accepted (1 activo tras recalibración, 1 con verificación de generación real pendiente), 1 superseded, 1 deferred por diseño (EPP no cuenta como pendiente v0.1), 1 en evaluación (ADR-150), 1 descartado por restricción de hardware (ADR-160), 1 parcial con reentrenamiento en curso (ADR-163) y 1 implementado en código con verificación GPU end-to-end pendiente (ADR-164).**
> *(Nota de auditoría 2026-09-10, actualizada 2026-09-11: este subtotal quedó
> desactualizado tras la tanda de avatar/liveness de 2026-09-02 a 2026-09-10 —
> el ámbito `ia` tiene hoy 36 filas reales en esta tabla (contadas por grep de
> filas `| NNN |`, incluidos ADR-144 y ADR-166), no 29. Se deja el texto original sin
> editar por convención de este log; ver el bloque de auditoría 2026-09-10 más
> arriba para el recuento correcto y el detalle de hallazgos de esta pasada.)*

### Ámbito `geo` — cartografía y geoespacial
| # | Slug | Status | Resumen |
|---|---|---|---|
| 026 | `cartografia-offline-mbtiles-maplibre` | ✅ implemented (2026-07-07) | Mapas offline MBTiles + mbtileserver + Leaflet; capas externas solo como enriquecimiento conectado/cachable, no dependencia operativa. |
| 028 | `gdal-conversion-raster-diferida` | 🔄 superseded by 072 (2026-07-24) | Decisión histórica de diferimiento; dejó de reflejar el runtime. |
| 056 | `csp-service-worker-tiles-mapa` | ✅ implemented (2026-07-18) | CSP dedicada para el Service Worker de cacheo de tiles (`tile-cache-sw.js`) — la CSP general de la SPA rompía el 100% de los tiles externos; timeout adaptativo + catálogo WMS saneado. |
| 072 | `gdal-cli-runtime-admin-confinado` | ✅ implemented, verificado E2E (2026-08-05) | GDAL CLI on-demand admin-only, rutas confinadas a `/data`, parámetros allowlist y jobs autenticados/tenant-owned. Pipeline `gdal_translate`+`gdaladdo` verificado contra fixture GeoTIFF real dentro del contenedor: MBTiles válido, tile extraído confirmado JPEG 256×256 real. |
| 121 | `coordenadas-geograficas-empresa-mapa` | ✅ implemented (2026-08-20) *(fila agregada 2026-08-21 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba)* | Columnas `latitude`/`longitude`/`location_zoom` en `auth_companies` (`db_scripts/68`); `GET /api/map/company-location` centra "Mapas" en la mina real del tenant en vez del `FALLBACK_VIEW` fijo (Toquepala); picker con geocodificación Nominatim solo como aproximación + marcador arrastrable para el ajuste fino — nunca coordenadas generadas por IA. |
| 123 | `geocatmin-integracion-plataforma-minera` | ✅ implemented (2026-08-20) *(fila agregada 2026-08-21)* | Reescritura de `MiningGeoportalView.tsx`: ingreso directo (sin pantalla de bienvenida de INGEMMET) centrado en la mina activa (ADR-121), catálogo tipado de 134 servicios GEOCATMIN y `GeocatminWorkbench.tsx` (buscador de derechos mineros, superposiciones, medición, buffers, conversor de coordenadas, descarga de shapefiles), en modo dual junto al portal oficial embebido. |

**Ámbito `geo`: 5 activos implementados y 1 superseded (ADR-028).**

### Ámbito `realtime` — visualización de datos en tiempo real
| # | Slug | Status | Resumen |
|---|---|---|---|
| 057 | `dashboard-widgets-estilo-thingsboard` | ✅ implemented (2026-07-19) | Gauge radial, tarjetas de agregación y doughnut de estado en Monitoreo→Sensores, alimentados por `/api/sensors/data` real (no telemetría simulada). Primer ADR de este ámbito. |

**Ámbito `realtime`: 1/1 implemented.**

### Ámbito `soporte` — sistema de soporte de campo minero (chatbot WhatsApp + chat web)

Primer ámbito nuevo agregado desde `realtime` (2026-07-19). Cubre el bot
conversacional de WhatsApp Business para reclamos/consultas de campo, el
chat web del widget de ReportStudio, y su administración (números de
contacto, departamentos/RRHH, canal de origen). Las 7 filas ya existían como
archivos completos sin sección propia en este índice — ver auditoría
2026-08-20 arriba.

| # | Slug | Status | Resumen |
|---|---|---|---|
| 112 | `chatbot-whatsapp-menu-reclamos-plantillas` | ✅ implemented, verificado por build/tests; webhook de prueba reparado y verificado en vivo 2026-08-30 (túnel Cloudflare recreado, `403 verification_failed` confirmado extremo a extremo); entrega real a un teléfono sigue pendiente de registrar la URL nueva en Meta y de credenciales de producción (2026-08-18) | Bot conversacional de WhatsApp Business (menú, reclamos, IA), `whatsapp_message_log` de auditoría cruda, y validación de firma HMAC-SHA256 (`whatsapp_signature.*`, `X-Hub-Signature-256`) fail-closed sobre el webhook entrante. |
| 113 | `whatsapp-multilinea-enrutamiento-por-area` | ✅ implemented, verificado por build/tests; segunda línea real pendiente de registro en la WABA de Meta (2026-08-19) | Enrutamiento multi-línea por `metadata.phone_number_id`, `defaultWhatsappLine()` como línea de respaldo. |
| 114 | `whatsapp-bot-administracion-numeros-contacto` | ✅ implemented — tabla, allowlist, endpoints web, pantalla de administración y rama `kMenuAdmin` en producción (2026-08-19) | Administración en caliente (sin redeploy) de los números de contacto que el bot ofrece por menú. |
| 115 | `departamento-usuario-rbac-rrhh` | ✅ implemented (sube de accepted 2026-08-30 — wiring de bot/panel admin ya cerrado en código, ver actualización en el ADR); pendiente solo E2E con WhatsApp real | RRHH como quinta categoría de soporte; `department` de usuario + regla `soporte.view`/`soporte.manage` que acota por categoría/canal. |
| 116 | `persistencia-chat-web-panel-admin-busqueda` | ✅ implemented (corregido 2026-08-20 — ver actualización en el propio ADR; el archivo original decía "accepted, pendiente") | Tabla `support_chat_message` (identidad por `tenant_id`/`user_id`, no por teléfono, a diferencia de `whatsapp_message_log`); `persistChatMessagePg` conectado en `main.cpp`/`support_routes.cpp`; endpoints `GET /api/support/admin/tickets` y `GET /api/support/admin/chat-messages` con paginación al estilo `AuditFilter`. |
| 117 | `canal-chatbot-homeminero-movilminero` | 🟡 partial *(actualizado 2026-08-21 — ver nota de auditoría arriba: backend ya lee/valida/persiste `channel`, verificado por grep sobre `support_routes.cpp`; sigue sin existir la app MovilMinero)* | Columna `channel` (`CHECK` explícito) en `support_chat_message`; `POST /api/support/chat/message`/`stream` ya aceptan, validan (`HomeMinero`\|`MovilMinero`) y persisten el campo. Falta solo la app MovilMinero en sí — sección "Diferencias esperadas" del ADR sigue siendo prospectiva. |
| 118 | `chatbot-aceleracion-gpu-ollama` | ✅ implemented (2026-08-19) | Aceleración GPU para Ollama, reduce la latencia del chatbot de soporte. |
| 122 | `cv-postulantes-whatsapp-ia-local-scoring` | 🟡 implemented, pendiente E2E *(fila agregada 2026-08-21 — el ADR ya existía sin fila en esta tabla)* | Postulaciones de CV por WhatsApp: descarga de media, extracción de texto (`ai_engine::/extract_cv_text`, sin LLM), extracción de campos + score 0-100 vía Ollama (`qwen2.5:7b`) con guarda anti-alucinación (`looksPresentInSource`), correo con adjunto MIME multipart, panel admin RRHH. Retención: indefinida por decisión explícita del developer (2026-08-21, ver actualización en el ADR), sin purga automática. Pendiente: aplicar `db_scripts/69_*.sql` a la BD en ejecución y prueba E2E con WhatsApp Business real. |
| 129 | `widget-chat-menu-whatsapp-adjuntos-cv-web` | 🟡 implemented, verificado por build/tests; E2E contra WhatsApp real pendiente de credenciales de producción de Meta (2026-08-21) | Menú real de WhatsApp en el widget de chat web, adjuntos (docx/pptx/pdf/jpg/png), CV desde la web y lectura QR/OCR de imágenes — mismo bloqueo de credenciales Meta que ya afectaba a ADR-112/113. Sin SPEC ni sprint asignado en el cronograma v36 (ver informe de estado). |

**Ámbito `soporte`: 8/9 implemented (3 pendientes de E2E), 1 partial. Todo el ámbito sigue sin SPEC/sprint formal en el cronograma v36 — decisión pendiente de Gerencia (SPEC-025).**

### Ámbitos futuros (componentes por venir)
- *(otros componentes se agregan acá a medida que surgen)*

---

## Progreso del proyecto de reportabilidad (ámbito `reports`)

Cálculo basado **en los 30 ADRs activos de ámbito `reports` redactados hasta
hoy** (010-022, 039, 044-053, 055, 064, 065, 070, 071, 073 — no cuenta
ADR-062, superseded por 064/065) — no incluye trabajo futuro sin ADR
todavía, ni los gates de release que no son decisiones arquitectónicas
(pentest, QA funcional, GO-LIVE — ver más abajo, se rastrean aparte).

| Estado | ADRs | Peso |
|---|---|---|
| Implementado sin reservas (incl. alcance v0.1 explícitamente reducido por diseño) | 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 039, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 055, 064, 065, 070, 071, 073 | 30 × 1.0 = 30.0 |
| Parcial | — | 0 |
| **Total** | **30 ADRs** | **30.0 / 30** |

### → **Avance del proyecto de reportabilidad: 100%** (30 / 30 ADRs activos)

**Actualización 2026-08-05**: ADR-019 cierra el último pendiente
arquitectónico del proyecto (referencias cruzadas automáticas) — ancla
(`TextStyleSpan.ref.targetId`) resuelta en render contra `generateTocData`,
con test que verifica explícitamente el requisito del propio ADR: insertar
una sección en el medio del documento renumera y actualiza la referencia sin
tocarla. **100% arquitectónico no es lo mismo que listo para producción**:
el backlog operativo de abajo (pentest externo sin agendar, QA funcional
firmado pendiente, dominio de producción sin decidir) sigue condicionando el
release real — ver esa sección, sin cambios por este cierre.

**Actualización 2026-07-25**: ADR-073 cierra tres divergencias reales entre
ADR y runtime encontradas al probar la aplicación en vivo (no por lectura de
código): ADR-053 no documentaba el control funcional de tabla ni dos bugs ya
cerrados (bucle de versión, shield CSS bloqueando controles); ADR-068
afirmaba corrección fiel por LanguageTool pero el botón rápido usaba un stub
de 13 palabras; ADR-071 afirmaba que ribbon y biblioteca llamaban a la misma
acción de TOC, pero el botón del ribbon solo abría un panel de navegación.
Las tres quedan corregidas y verificadas en navegador real. Ninguna es un
conflicto *entre* ADRs — todas eran el ADR describiendo una intención que el
código todavía no cumplía.

**Actualización 2026-07-24**: ADR-070 formaliza bloques/plantillas técnicas
por composición y ADR-071 la paginación real del TOC. Ambos reutilizan el
modelo existente y pasan tipos/build. La reclasificación honesta de ADR-019
evita contar referencias cruzadas como terminadas; el porcentaje tampoco
sustituye el gate manual de QA ni el pentest.

**Actualización 2026-07-21 (segunda pasada, mismo día)**: ADR-062 (inserción
de video, ambos orígenes juntos) se separó a pedido de Gerencia en **ADR-064**
(cámara web) y **ADR-065** (pantalla/ventana) — dos decisiones independientes,
cada una con su propio contexto/trade-offs/verificación. ADR-062 queda
`superseded`, contenido conservado sin editar. Ambos ADR nuevos verificados
en vivo hasta el límite de hardware del sandbox de pruebas (no hay cámara ni
posibilidad de compartir pantalla en ese entorno) — una grabación real de
punta a punta de cada origen queda pendiente de prueba manual antes de
certificación QA plena (ADR-061, Capa 5). En el cálculo de esa fecha no
cambiaba el 100%; ADR-019 fue reclasificado partial el 2026-07-24.

**Actualización 2026-07-21 (primera pasada)**: se agregó ADR-062 (inserción
de video grabado por cámara web/pantalla, insertable en el lienzo). Se marcó
"implementado, verificado parcialmente" — el flujo completo de UI se
verificó en vivo contra el backend real, pero una grabación de punta a punta
con hardware real de cámara/pantalla quedó pendiente de una prueba manual.
No cambiaba el 100% calculado entonces porque el propio ADR-059 (Capa 5) ya contempla
la regresión manual completa antes del gate R4 como paso posterior a la
implementación.

**Actualización 2026-07-20**: se agregó ADR-055 (`editor-indicador-seleccion-propio`,
formalizando un bug fix del 2026-07-18 que no tenía ADR escrito — ver §
"Actualización 2026-07-20" arriba del índice). El proyecto de reportabilidad
siguió al 100% en el corte de esa fecha; no cambió el avance, solo el conteo total de ADRs que lo
respaldan.

**Actualización 2026-07-17 (tercera pasada)**: se agregaron 8 ADRs nuevos
(046-053) — 4 formalizan decisiones ya implementadas sin ADR escrito
(encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y 4
documentan trabajo nuevo de esta sesión: formato de texto por selección
(negrita/color/tamaño/fuente solo en la porción seleccionada, corrigiendo
de paso una premisa incorrecta de ADR-010/013 sobre Tiptap/ProseMirror),
copiar/pegar de objetos en el lienzo, navegación de teclado + zoom
10%-400% + tamaño de hoja por página, y estilos visuales de tabla. Los 24
ADRs de `reports` quedaron al 100% en ese corte. ADR-019 fue reclasificado
partial en la auditoría posterior del 2026-07-24.

**Actualización 2026-07-13 (segunda pasada, misma fecha)**: ADR-022 se cerró
por completo — era el único ADR de `reports` que quedaba parcial. El negocio
pidió explícitamente resolver el pendiente documentado ("falta resolución de
conflicto por version-base"): ahora, si otra terminal actualiza un informe
mientras esta edita sin conexión, al reconectar se detecta el conflicto real
(concurrencia optimista server-side, `409 version_conflict`, verificado
contra el backend real) y se pregunta explícitamente al usuario si quiere
traer la versión del servidor o seguir con su copia offline — y si sigue,
al guardar puede elegir sobrescribir o guardar como informe nuevo (nunca se
pierde trabajo silenciosamente). Se agregó además un checkpoint forzado cada
3 minutos en línea, pedido de negocio adicional no contemplado en el ADR
original. Ver ADR-022 para el detalle técnico completo y la verificación
end-to-end (backend real + navegador real, sin recargar la página, con una
"segunda terminal" real vía HTTP directo).

**Con esto, los 29 ADRs activos quedan registrados con evidencia de
implementación.** Las excepciones, riesgos de release y verificaciones manuales
se mantienen declaradas abajo; el índice no usa el conteo para ocultar trabajo
pendiente.

Fuera del cálculo de ADRs (no son decisiones arquitectónicas) pero
**bloqueante para el release real** — backlog operativo:
- ~~**Retirar el verificador legacy ADR-077** cuando su inventario llegue a
  cero.~~ **Cerrado 2026-08-07**: inventario en 0/82 (antes 40 legacy) —
  reset administrado de las 40 cuentas restantes (35 fixtures QA + 3 posibles
  DNI reales + la cuenta del propio usuario, decisión explícita suya, no
  unilateral) con la misma función Argon2id real del backend
  (`libargon2` vía ctypes, mismos parámetros configurados). Verificado con
  login real end-to-end y reinicio del backend sin ningún log de migración
  pendiente. Ver actualización en ADR-077 para el detalle completo. La rama
  de código `legacy1:`/verificador legado en sí **sigue existiendo** — su
  eliminación de código es un cambio aparte, ya sin ninguna fila real que
  la ejercite en este entorno. El código de envoltura automática (ADR-077,
  actualización 2026-08-05) sigue sin commitear en la rama actual — no se
  commiteó unilateralmente en esta pasada.
- **Configurar el dominio real de producción** en
  `BEEMETRY_CORS_ALLOWED_ORIGIN`; el compose productivo ya falla si falta,
  pero el valor depende del DNS/HTTPS definitivo del despliegue.
- Pentest de seguridad pre-release (pendiente, no iniciado).
- QA funcional formal v0.1 (cobertura parcial vía smoke tests repetidos;
  falta un pase exhaustivo firmado). *(Actualización 2026-08-05: la
  conversión raster GDAL con inspección visual ya se verificó E2E — ver
  actualización en ADR-072. Suites automatizadas corridas reales:
  Catch2 backend 610/610 aserciones, Vitest frontend 35/35, `tsc` 0 errores
  — ver actualización en ADR-059/ADR-060. Playwright e2e pasó de 1/8 a 5/8
  tras corregir 2 regresiones reales de navegación (categoría "Reportes"→
  "Informes" de ADR-042, labels "Report"/"Report v2"→"Reporte"/"Informes" de
  i18n ADR-075) sin tocar código de producción, solo los specs desactualizados.
  3 specs con la cuenta real `operator` siguen fallando más adentro del
  editor — posible gate de permiso real de ADR-079, sin confirmar por falta
  de Browser pane disponible en esta sesión; ver detalle en ADR-059. Sigue
  pendiente una grabación real de cámara/pantalla con hardware físico — no
  ejecutable en un entorno sin cámara ni posibilidad de compartir pantalla
  real — y la firma formal exhaustiva del resto del catálogo de 69 casos de
  ADR-061. *(Actualización 2026-08-07: hipótesis del gate de ADR-079
  **descartada** — verificado por SQL directo que tanto `operator` como
  `manager` (rol real de `larmas`/Alpayana, no `operator` como decía este
  párrafo) tienen `informes.edit` en la matriz por defecto y no hay override
  de tenant para Alpayana. La causa real: el árbol de `frontend/` tenía un
  bug de interop CJS→ESM sin commitear que crasheaba el módulo Informes para
  **cualquier** usuario/tenant — corregido, ver ADR-093.)*
- ~~Implementar las referencias cruzadas automáticas pendientes de ADR-019.~~
  Cerrado 2026-08-05 — ver actualización en ADR-019 y el 100% recalculado arriba.
- Release v0.1: Deploy + Documentación + GO-LIVE formal.

### Fecha referencial de término

**Estimado anterior: fines de julio 2026 (referencial, no comprometido).**
La auditoría del 2026-07-24 invalidó tratar esa fecha como lista para
producción por el 1.7% arquitectónico pendiente de ADR-019 más los gates y
bloqueantes del backlog anterior. **Actualización 2026-08-05: el 1.7% de
ADR-019 ya cerró (100% arquitectónico, ver arriba)** — lo único que sigue
condicionando la fecha es el backlog operativo, no decisiones de diseño sin
tomar:
- Pentest externo: típicamente 1-2 semanas de calendario una vez agendado
  (no iniciado a la fecha de este reporte y uno de los factores principales
  de incertidumbre).
- QA funcional + GO-LIVE: 3-5 días una vez el pentest no tenga hallazgos
  críticos abiertos.

La fecha **2026-07-31** solo puede mantenerse como objetivo condicionado, no
como compromiso: Argon2id, ECharts y ADR-019 ya están cerrados, pero exige
completar QA funcional firmado, decidir el dominio de producción y no
recibir hallazgos críticos del pentest (sin agendar aún).

---

## Cómo agregar un ADR nuevo

1. Numerar al siguiente disponible (sin reciclar números, aunque haya ADRs `superseded`).
2. Crear archivo `NNN-slug-corto.md` con el campo **`Ámbito`** en la cabecera.
3. Agregar fila al índice, en el grupo de su ámbito.
4. Mencionar en el commit con `Refs ADR-NNN`.
5. Si supersede uno anterior: editar el anterior agregando `Status: superseded by ADR-NNN` y la fecha.
