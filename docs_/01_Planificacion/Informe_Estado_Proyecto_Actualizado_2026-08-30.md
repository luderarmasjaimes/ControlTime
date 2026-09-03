# Informe de estado actualizado — Plataforma Minera Beemetry

**Empresa:** TimeTelemetry

**Corte:** 30 de agosto de 2026, America/Lima

**Base:** código y stack local, ADR-000–136 (137 registros), SPEC-001–024, cronograma v36.1

**Objetivo:** actualizar la línea base del informe del 18-ago con el trabajo real de los últimos
12 días, para sustentar ante Gerencia TI y Gerencia General el cronograma, las fechas de entrega
por sprint y los entregables mes a mes, de cara al cierre del gate R3 (mañana, 31-ago-2026).

## 1. Conclusión ejecutiva

El avance documentado **no se movió desde el 18-ago: sigue en 106 de 196 tareas canónicas =
54,1%**. En los 12 días transcurridos se redactaron y verificaron **7 ADR nuevos (130–136)** —
todos `implemented` con evidencia en vivo — pero **ningún checkbox de `specs/*/tasks.md` se
marcó**. Esa es la brecha central de este informe: hay trabajo real, verificado, que el gate de
release no está contando porque nunca se formalizó como tarea de SPEC.

El gate **R3 vence mañana, 31 de agosto**, con el mismo 75,8% (50/66) de hace 9 días. Sin una
decisión explícita de Gerencia (excepción documentada o extensión de fecha), el gate se declara
formalmente no cumplido en su fecha contractual.

El foco de los ADR nuevos cambió de forma marcada: la tanda anterior (112–129, informe del
21-ago) era mayormente soporte/IA; esta tanda (130–136) es mayormente **plataforma y seguridad**
— incluyendo **el hallazgo más grave de todo el proyecto hasta ahora**: una vulnerabilidad crítica
de escalada de privilegios en el autoregistro público, explotada en vivo contra un tenant real
durante un ejercicio de red-team propio, y cerrada el mismo período (ADR-134).

## 2. Método de medición (sin cambios de criterio)

### 2.1 Avance de ejecución

Se cuenta cada tarea canónica de `tasks.md` una sola vez, con `scripts/project-status-metrics.ps1`
corrido hoy (2026-08-30). **Resultado: 106/196 = 54,1%, idéntico al 18-ago.**

Hallazgo de esta pasada, no de código sino de tooling: el script tenía el campo `Cutoff`
**hardcodeado a `'2026-08-18'`** — no se había actualizado en la auditoría del 21-ago ni podía
haberse detectado solo mirando su salida. El cálculo de `Done`/`Total` en sí es correcto (deriva
en vivo de los checkboxes reales), solo la etiqueta de fecha estaba fija. Corregido hoy
(`Get-Date -Format 'yyyy-MM-dd'`) para que no vuelva a quedar obsoleta.

### 2.2 Estado de decisión

Sin cambios: `proposed` = existe dirección, puede cambiar · `accepted` = decisión aprobada, no
prueba implementación · `implemented` = existe código y evidencia de verificación, no prueba que
la tarea esté marcada cerrada en el gate. **Los 7 ADR nuevos son `implemented`/verificados en vivo
y ninguno movió el 54,1%** — es la evidencia más clara hasta ahora de que ADR y tasks.md pueden
divergir.

### 2.3 Readiness mensual

Sin cambio de metodología. Como los checkboxes no se movieron, **los porcentajes por gate (R2
90,9%, R3 75,8%, R4 58,1%, R5 37,7%, R6 40%) son idénticos a los del 21-ago** — ver §3.

## 3. Avance mes a mes y por etapa

| Mes | Etapa / gate | Alcance principal | Avance al corte | Interpretación |
|---|---|---|---:|---|
| Junio | Etapa 1 · R1 | Arquitectura, SDD, modelo de datos y plan | **100%** | Cerrado desde el 30-jun |
| Julio | Etapa 1 · R2 | Core, ingesta, auth/RBAC y seguridad base | **90,9%** (10/11) | Cierre formal aún pendiente, sin cambio desde el 18-ago |
| Agosto | Etapa 1 · R3 | Editor, dashboards, GIS, sensores, IA base, 25k | **75,8%** (50/66) | **Vence mañana (31-ago). Sin cambio en 9 días** pese a 7 ADR implementados |
| Septiembre | Etapa 1 · R4 | Export, offline, alertas, CCTV, RP/AWS, regresión | **58,1%** (36/62) | Readiness disponible hoy; offline y alertas siguen críticos |
| Octubre | Etapa 2 · R5 | HA/DR, histórico, seguridad, IA avanzada, portabilidad | **37,7%** (26/69) | Sin pentest, DR ni calibraciones agendadas |
| Noviembre | Etapa 2 · R6 | estrés, UAT, marcha blanca, go-live | **40%** (4/10 controles) | Preparación técnica temprana; no habilita producción |
| Rebaseline | Extensión campo | App offline, formularios, ERP, PDA e IA de campo | **0%** (0/14) | Sin product owner ni presupuesto, igual que el 18-ago |

> Estos valores son la preparación disponible al 30-ago, **no una proyección** — y son
> numéricamente idénticos a los del 21-ago porque ninguna tarea canónica cerró en el período.

## 4. Controles de salida R6

Sin cambio desde el 18/21-ago — ninguno de los 6 controles pendientes tiene proveedor o fecha
agendada todavía.

| # | Control | Estado al corte |
|---|---|---|
| 1 | TypeScript sin errores | Cumplido |
| 2 | Unit tests frontend | Cumplido: 47/47 |
| 3 | Build productivo frontend | Cumplido, con advertencias no bloqueantes |
| 4 | Build + CTest backend del árbol actual | Cumplido: build 100%, CTest 1/1 |
| 5 | E2E Playwright de flujos críticos | No ejecutado en esta auditoría |
| 6 | Pentest externo y P0/P1 cerrados | Pendiente — sin proveedor agendado |
| 7 | Simulacro DR con RTO<15 min/RPO≈0 | Pendiente |
| 8 | UAT firmado por operadores | Pendiente |
| 9 | Despliegue productivo/rollback automatizado probado | Pendiente |
| 10 | Marcha blanca 48–72 h y acta go-live | Pendiente |

Readiness R6: 4/10 = **40%**, sin cambio.

## 5. Los 7 ADR nuevos desde el 18/21-ago (130–136)

A diferencia de la tanda 112–129 (soporte/IA/geo), esta tanda es mayormente **plataforma y
seguridad**:

| ADR | Título | Ámbito | Status |
|---|---|---|---|
| 130 | RBAC empresa minera vs. organización + acceso cruzado | plataforma | implemented, pendiente E2E con datos reales |
| 131 | Consolidación del modelo de telemetría (`dim_*`/`telemetry_fact*`) | datos / core-iot | implemented (fases 0-5, 9-10); **fases 6-8/13 pendientes de deploy backend** |
| 132 | Bearer en memoria + cookies namespaced, aislamiento multifrontend | plataforma | implemented, verificado E2E en vivo |
| 133 | Endurecimiento post red-team: CSP, cookie cross-site, validación de entrada | plataforma | implemented, verificado en vivo |
| 134 | **Fix crítico: escalada de privilegios vía autoregistro en empresa existente** | plataforma | implemented, verificado en vivo — **CRÍTICA** |
| 135 | MFA/TOTP, alertas de seguridad, RUC obligatorio en bootstrap de admin | plataforma | implemented, verificado E2E de punta a punta |
| 136 | Telemetría calculada por lectura + dashboard de monitoreo de simulación | datos / core-iot / frontend | implemented (esquema + lectura); cómputo vía script externo interino |

### ADR-134 — el hallazgo más grave del proyecto hasta ahora

`POST /api/auth/register` es público (sin sesión previa) y por diseño provisiona un tenant real
para una empresa nueva (ADR-067/078). El hallazgo: el mismo endpoint, contra una empresa **que ya
existía con usuarios reales** (verificado en vivo contra un tenant real, "Minera Raura"), aceptaba
`"role": "admin"` en el body y devolvía `201 Created` con una sesión administrativa completa —
`is_admin: true`, permisos `usuarios.manage`, `permisos.manage`, `empresas.manage`,
**`org.cross_tenant.manage`** — sobre el tenant real de esa empresa. Cerrado y verificado el mismo
día contra el stack corriendo (2026-08-26).

**No es solo un hallazgo técnico cerrado**: la vulnerabilidad estuvo presente antes del fix, lo
que abre una pregunta de gestión que este informe no puede responder por sí solo — **¿corresponde
auditoría o notificación retroactiva a los tenants que existían antes del 26-ago?** Ver §9.

### ADR-131 — consolidación del modelo de telemetría

Responde a un pedido explícito de sostener 25.000 registros/segundo continuos 24/7, históricos de
hasta 5 años y una arquitectura preparada para 10 años de crecimiento. Las fases 0-5 y 9-10 están
aplicadas contra `beemetry-db` local; **las fases 6-8/13 (dual-write, cutover de lecturas y retiro
de tablas legacy) requieren una ventana de despliegue del backend C++ productivo**, decisión que
no se tomó unilateralmente en la sesión que produjo el ADR.

### ADR-136 — telemetría calculada, decisión de arquitectura interina

Nueva tabla `telemetry_fact_calc` (métrica derivada por lectura: nivel de alerta, tasa de cambio,
delta vs. umbral) con endpoint de solo lectura y panel `SimulationMonitor.tsx`. El cómputo lo
puebla **un script externo, no el backend C++** — decisión explícita para no agregar un scheduler
al proceso que sirve tráfico real sin pedido de negocio. Si deja de ser interino, requiere su
propio ADR de seguimiento.

## 6. Hallazgos de auditoría de esta pasada (no son ADR — son gaps de documentación/tooling)

1. **`docs/decisions/README.md` no tenía fila para ADR-129 a 136** (mismo patrón de brecha de
   trazabilidad de las auditorías del 18/20/21-ago) — corregido hoy, ver README.
2. **`docs/decisions/013-editor-tiptap-konva.md` estaba corrompido en el árbol de trabajo**: la
   palabra "Konva" había sido borrada en las 11 apariciones del texto por algún proceso
   automatizado (dejaba frases rotas: "react-konva" → "react-", "Konva para layout" → " para
   layout"). Restaurado desde `HEAD` — el archivo no tenía cambios intencionales pendientes, así
   que no se perdió contenido real.
3. **`scripts/project-status-metrics.ps1` tenía el `Cutoff` hardcodeado** al 18-ago (ver §2.1) —
   corregido para que se calcule en cada corrida.
4. **`CHANGELOG.md` sin tocar desde el 21-ago** (9 días) pese a 7 ADR nuevos — mismo patrón de
   riesgo que ya se señaló el 21-ago para el período anterior.

## 7. Estado por frente funcional

| Frente | Estado | Pendiente decisivo |
|---|---|---|
| Ingesta/telemetría | Verde | Soak 1h/24h, nueva topología para 100k; fases 6-8/13 de ADR-131 pendientes de deploy |
| Plataforma/seguridad (nuevo) | Verde | ADR-132/133/134/135 verificados en vivo; decidir notificación retroactiva por ADR-134 |
| Auth/RBAC/auditoría | Amarillo-verde | Pentest externo, runbooks, evidencia productiva; ADR-130 pendiente E2E |
| RP/Odoo | Amarillo-verde | CA-4: create/write productivo autorizado |
| Dashboard/realtime | Amarillo | Regresión, SLA, integración de sitio; nuevo panel de simulación (ADR-136) sin CI |
| Reportabilidad | Amarillo | Regresión completa, export multigráfico, UAT |
| Sensores/zonas | Amarillo | Anti-IDOR, contrato API, render/export CI |
| GIS/3D/GEOCATMIN | Amarillo | Datos reales, performance y aceptación operacional |
| Biometría | Amarillo | FMR/FNMR, PAD, DPIA, hardware real, reenrolamiento |
| AWS/ThingsBoard legacy | Amarillo | Validación contra entorno/credenciales del cliente |
| Soporte/WhatsApp | Amarillo | 9 ADR implementados (incl. ADR-129), sin SPEC ni sprint; credenciales Meta de producción |
| Alertas | Rojo | SPEC-016 0/5 y prueba extremo a extremo |
| Offline | Rojo | SPEC-014 0/10 como flujo integral |
| DR/HA | Rojo | SPEC-015 0/11; promoción, restore, RTO/RPO |
| Operaciones de campo | Rojo | Producto 0/14; aprobar ADR-110 y reprogramar |
| EPP / Enterprise LATAM | Gris/deferred | ADR-025 no reactivar sin dataset/privacidad; ADR-035 F1-F4 sin decisión comercial |

## 8. Riesgos gerenciales

| Prioridad | Riesgo | Impacto | Acción/decisión |
|---|---|---|---|
| P0 | R3 vence mañana (31-ago) al mismo 75,8% de hace 9 días — 0 tareas cerradas en el período | Gate en riesgo de no cumplirse en su fecha formal | Decidir: excepción documentada con plan de cierre, o extensión formal |
| P0 | 187 archivos sin commitear (109 nuevos, 78 modificados); CHANGELOG sin tocar desde el 21-ago | Pérdida de trabajo y trazabilidad — mejoró de 365 pero sigue alto | Segmentar ramas/commits por SPEC y respaldar ya; actualizar CHANGELOG |
| P0 | Vulnerabilidad crítica de escalada de privilegios (ADR-134) activa hasta el 26-ago | Exposición retroactiva sobre tenants reales antes del fix | Definir alcance de auditoría/notificación retroactiva |
| P0 | Offline, alertas y DR casi sin tareas cerradas | R4/R5 no alcanzables por inercia | Equipo dedicado y plan semanal con evidencia |
| P1 | Tracking de tasks.md desacoplado del trabajo real: 7 ADR implementados/verificados, 0 checkboxes movidos | El gate mide tareas, no ADR — el 54,1% no refleja el trabajo real de 12 días | Formalizar en tasks.md el trabajo ya implementado en ADR-130-136 |
| P1 | Sin pentest externo/UAT/DR agendados | No habilita go-live | Agendar proveedores/usuarios y ventanas ahora |
| P1 | Soporte/WhatsApp sin SPEC ni presupuesto formal (9 ADR implementados) | Alcance no contractual sin decisión | Aprobar SPEC-025 o posponer explícitamente |
| P1 | Deploy de fases 6-8/13 de ADR-131 sin ventana asignada | Modelo de telemetría consolidado no cierra en producción | Autorizar ventana de despliegue backend |
| P1 | AWS real depende de acceso del cliente | Puede bloquear R4 | Responsable, credenciales, ventana y dataset de aceptación |
| P1 | Biometría sin calibración/cumplimiento | Riesgo de seguridad/privacidad | Dataset representativo, laboratorio y DPIA |
| P2 | Bundles >500 kB y warnings CSS | UX en enlaces lentos/PDA | Code splitting, limpiar `@apply`, presupuesto de bundle |

## 9. Plan de recuperación propuesto

### 30–31 agosto — cerrar R3 con evidencia, o declarar excepción formalmente

- Cerrar CA pendientes de SPEC-005/007/008/009/010/011/020/021/002 y regresión de ReportStudio.
- **Formalizar en `tasks.md` el trabajo ya implementado y verificado en ADR-130 a 136** — es la
  acción de mayor apalancamiento: no requiere código nuevo, cierra la brecha del §2/§6.
- Incorporar build/CTest backend y Playwright crítico a CI.
- Decidir explícitamente el alcance de Soporte/WhatsApp (SPEC-025) antes del cierre de R3.
- Publicar acta de gate R3 con el resultado de la decisión de Gerencia (excepción o extensión).

### Septiembre — R4 integrado

- Equipo A: SPEC-014 offline y pruebas WAN/replay.
- Equipo B: SPEC-016 alertas, sensores reales e integración dashboard/informe.
- Equipo C: AWS/ThingsBoard real + CA-4 Odoo autorizada + ventana de deploy de ADR-131 fases 6-8/13.
- QA independiente: catálogo actualizado, E2E, export y seguridad de tenant.

### Octubre — R5 sin negociación de evidencia

- Simulacro failover/restore con cronómetro y conteos.
- Pentest externo; cierre P0/P1 y retest — **incluir verificación retroactiva del hallazgo ADR-134**.
- Soak de telemetría, capacidad de almacenamiento y pruebas de resiliencia.
- Calibración biométrica o exclusión formal de alcance productivo.

### Noviembre — R6

- UAT con operadores, marcha blanca 48–72 h, rollback y actas.
- Go-live solo si los diez controles de §4 están completos.

### Operaciones de campo — proyecto derivado

Sin cambios respecto al 18-ago: no absorber en los sprints restantes. Aprobar ADR-110 y SPEC-022,
asignar product owner, arquitecto, backend, móvil, QA, seguridad/MDM e integrador ERP.

## 10. Decisiones que se solicitan a Gerencia TI y Gerencia General

1. **Cierre de R3** (vence mañana): excepción documentada con plan de cierre, o extensión formal
   de fecha — el gate no puede declararse cumplido sin una de las dos.
2. Aprobar o diferir explícitamente la incorporación de Soporte/WhatsApp al alcance contractual
   (SPEC-025) y su sprint destino.
3. **Definir el alcance de auditoría/notificación retroactiva** por la vulnerabilidad crítica de
   escalada de privilegios cerrada en ADR-134.
4. Aprobar el rebaseline de Operaciones de Campo como proyecto derivado: product owner, equipo y
   presupuesto de piloto.
5. Autorizar pentest externo, simulacro DR y UAT con fechas y proveedores concretos.
6. Autorizar la ventana de despliegue productivo para las fases 6-8/13 de ADR-131.
7. Definir postura comercial sobre Enterprise LATAM (ADR-035 F1-F4) y sobre la validación externa
   de RUC/SUNAT.
8. Contar con soporte y recursos de IA acordes con la complejidad y los requerimientos del
   proyecto.

## 11. Fuentes de verdad posteriores a esta actualización

- ADR: `docs/decisions/README.md` y ADR-000–136.
- Matriz: `specs/REGISTRY.md`.
- Backlog y métrica: `specs/BACKLOG.md` y `scripts/project-status-metrics.ps1` (Cutoff ya no
  hardcodeado).
- Cronograma contractual: `docs_/01_Planificacion/Cronograma_Maestro_AURIXA_v36.md`.
- Presentación ejecutiva: `docs_/01_Planificacion/Cronograma_Actualizado_Presentacion_Gerencia_TI_2026-08-30.pptx`.

---

**Regla de actualización:** cada viernes se ejecuta el script de métricas, se adjunta evidencia de
pruebas y se cambia un porcentaje solo cuando cambia una tarea/CA. Próximo corte: viernes
04-sep-2026, tras el cierre del gate R3.
