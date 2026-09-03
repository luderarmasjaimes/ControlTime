<!-- Slide number: 1 -->
PRESENTACIÓN GERENCIA Y TI
Cronograma Actualizado del Proyecto
Plataforma Integral de Telemetría y Automatización Minera con IA — Beemetry
Corte: 21 de agosto de 2026
Base: ADR-000 a ADR-128 (129 registros) · SPEC-001 a SPEC-024 · Cronograma v36.1
Cliente: TimeTelemetry

Sprint S6 en cierre (10–21 ago) · Gate de release R3 vence el 31 de agosto

### Notes:

<!-- Slide number: 2 -->
RESUMEN EJECUTIVO
El proyecto en cuatro cifras, al corte de hoy

129
24
54,1%
S6 / 13
ADR (000–128)
SPEC canónicas
avance de ejecución
sprint en cierre hoy
decisiones arquitectónicas registradas; +17 en los últimos 3 días
23 formalizadas + SPEC-024 GEOCATMIN, nueva
106 / 196 tareas canónicas cerradas (medición por tasks.md, no por ADR)
gate de release R3 vence el 31-ago-2026 (en 10 días)
Lectura gerencial
La base técnica es sustancial, pero el avance real de producto es 54,1%, no el volumen de ADR — un ADR documenta una decisión, no un entregable aceptado.
La preparación por gate es desigual: R2 90,9%, R3 75,8%, R4 58,1%, R5 37,7%. Offline, alertas y DR siguen casi sin tareas cerradas.
Entre el 18 y el 21 de agosto se agregaron 17 ADR nuevos (112–128), incluyendo un módulo completo — bot de WhatsApp / soporte — que hoy no tiene SPEC ni sprint asignado en el cronograma v36.
Capacidad de telemetría comprobada: 25.000 eventos/s por edge, cero pérdida. 100.000 eventos/s no está aprobado.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
2

### Notes:

<!-- Slide number: 3 -->
CÓMO SE MIDE
Metodología de medición del avance
El avance se cuenta por tareas, no por ADR

1
Cada tarea canónica de specs/NNN-*/tasks.md se cuenta una sola vez (script scripts/project-status-metrics.ps1). Resultado al corte: 106/196 = 54,1%. No equivale a horas, presupuesto ni aceptación productiva.
Un ADR mide decisión y coherencia, no producto

2
proposed = existe dirección, puede cambiar · accepted = decisión aprobada, no prueba implementación · implemented = existe código, no prueba aceptación integral. Solo un criterio de aceptación con evidencia cierra una tarea.
El readiness mensual es una fotografía, no una proyección

3
Los porcentajes de julio–octubre son tareas cerradas / planificadas de las SPEC de ese release, tomadas hoy. No se contabiliza avance futuro que todavía no ocurrió; noviembre usa 10 controles de salida distintos (ver diapositiva 9).

Regla de actualización: cada viernes se corre el script de métricas, se adjunta evidencia de pruebas y un porcentaje solo cambia cuando cambia una tarea o un criterio de aceptación.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
3

### Notes:

<!-- Slide number: 4 -->
CRONOGRAMA MAESTRO
13 sprints · 6 releases · 1 jun – 30 nov 2026
HOY

S1
S2
S3
S4
S5
S6
S7
S8
S9
S10
S11
S12
S13
01–12 jun
15–26 jun
29 jun–10 jul
13–24 jul
27 jul–07 ago
10–21 ago
24 ago–04 sep
07–18 sep
21 sep–02 oct
05–16 oct
19–30 oct
02–13 nov
16–27 nov
R1
R1
R2
R2
R3
R3
R4
R4
R5
R5
R5
R6
R6
Completado (S1–S5)
En cierre hoy (S6)
Planificado

| Release | Cobertura | Foco |
| --- | --- | --- |
| R1 | S1–S2 · jun | Planificación, arquitectura, diseño de datos, shell base |
| R2 | S3–S4 · jul | Motor central, accesos seguros, telemetría, VPS desarrollo |
| R3 | S5–S6 · ago | Editor, mapas, sensores, IA base, dictado por voz |
| R4 | S7–S8 · sep | Exportación, integraciones, modo offline, QA del core |
| R5 | S9–S11 · oct | Hardening, DR, optimización, preparación de UAT |
| R6 | S12–S13 · nov | Estrés 10k, UAT, marcha blanca, Go-Live y transferencia |
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
4

### Notes:

<!-- Slide number: 5 -->
PUERTAS DE CONTROL GERENCIAL
Releases y gates: fecha, criterio y estado real
| Release | Gate | Criterio de aprobación | Estado al 21-ago |
| --- | --- | --- | --- |
| R1 | 2026-06-30 | Diseño y arquitectura aprobados | Cumplido — 100% |
| R2 | 2026-07-31 | Motor operacional + seguridad base | 90,9% (10/11) — cierre formal pendiente |
| R3 | 2026-08-31 | Editor + sensores + IA base — FIN vence en 10 días | 75,8% (50/66) — en curso, aceptación integrada abierta |
| R4 | 2026-09-30 | Sistema integrado e2e — FIN ETAPA 1 | 58,1% (36/62) readiness — offline y alertas críticos |
| R5 | 2026-10-31 | Hardening + DR + optimización | 37,7% (26/69) readiness — sin pentest/DR aún |
| R6 | 2026-11-30 | Go-Live producción — FIN PROYECTO | 40% (4/10 controles) — no habilita producción |

Por qué gates y no percepción:  el avance se aprueba con evidencia (build, tests, pentest, DR, UAT), no por avance de calendario. Un gate no superado detiene el avance y evita el descontrol de alcance.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
5

### Notes:

<!-- Slide number: 6 -->
AVANCE MES A MES
Readiness disponible al corte, desde el inicio hasta el cierre

### Chart

| Category | Avance / readiness al corte (%) |
|---|---|
| Junio
R1 | 100.0 |
| Julio
R2 | 90.9 |
| Agosto
R3 | 75.8 |
| Septiembre
R4 | 58.1 |
| Octubre
R5 | 37.7 |
| Noviembre
R6* | 40.0 |
0%
Operaciones de campo (0/14)
Proyecto derivado, sin fecha en el cronograma v36 — diseño conceptual formalizado (ADR-110), sin implementación.
* Noviembre usa un criterio distinto: 4 de 10 controles de salida (pentest, DR, UAT, go-live — diapositiva 9), no tareas de SPEC.
Estos valores son la preparación disponible al 21-ago, no una proyección de trabajo futuro.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
6

### Notes:

<!-- Slide number: 7 -->
DETALLE POR DOMINIO
Estado por frente funcional
| Frente | Estado | Pendiente decisivo |
| --- | --- | --- |
| Ingesta / telemetría | Verde | Soak 1h/24h y nueva topología para 100k |
| Auth / RBAC / auditoría | Amb.-verde | Pentest externo, runbooks, evidencia productiva |
| RP / Odoo (TimeTelemetry) | Amb.-verde | CA-4: create/write productivo autorizado |
| Dashboard / realtime | Amarillo | Regresión, SLA e integración de sitio |
| Reportabilidad | Amarillo | Regresión completa, export multigráfico, UAT |
| Sensores / zonas | Amarillo | Anti-IDOR, contrato API, render/export en CI |
| GIS / 3D / GEOCATMIN | Amarillo | Datos reales, performance, aceptación operacional |
| Biometría | Amarillo | FMR/FNMR, PAD, DPIA, hardware real, reenrolamiento |
| AWS / ThingsBoard legacy | Amarillo | Validación contra entorno/credenciales del cliente |
| Soporte / WhatsApp (nuevo) | Amarillo | Sin SPEC formal; credenciales Meta de producción |
| Alertas | Rojo | SPEC-016 en 0/5 y prueba extremo a extremo |
| Offline | Rojo | SPEC-014 en 0/10 como flujo integral |
| DR / HA | Rojo | SPEC-015 en 0/11; promoción, restore, RTO/RPO |
| Operaciones de campo | Rojo | Producto en 0/14; aprobar ADR-110 y reprogramar |
| EPP / Enterprise LATAM | Gris | Deferred (ADR-025) / solo F0 propuesto (ADR-035) |
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
7

### Notes:

<!-- Slide number: 8 -->
PUERTA DE SALIDA A PRODUCCIÓN
Controles de salida R6 — Go-Live
| # | Control | Estado al corte |
| --- | --- | --- |
| 1 | TypeScript sin errores | Cumplido |
| 2 | Unit tests frontend | Cumplido — 47/47 |
| 3 | Build productivo frontend | Cumplido (advertencias no bloqueantes) |
| 4 | Build + CTest backend (árbol actual) | Cumplido — build 100%, CTest 1/1 |
| 5 | E2E Playwright de flujos críticos | No ejecutado en esta auditoría |
| 6 | Pentest externo, P0/P1 cerrados | Pendiente |
| 7 | Simulacro DR — RTO<15 min / RPO≈0 | Pendiente |
| 8 | UAT firmado por operadores | Pendiente |
| 9 | Despliegue/rollback automatizado probado | Pendiente |
| 10 | Marcha blanca 48–72 h y acta go-live | Pendiente |

4/10
controles cumplidos
= 40% de readiness de salida

Los controles técnicos aprobados no sustituyen pentest, DR, UAT, despliegue/rollback ni marcha blanca.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
8

### Notes:

<!-- Slide number: 9 -->
DESDE EL INFORME DEL 18-AGO
17 ADR nuevos en 3 días (112 a 128)

8
4
3
2
ADR nuevos
ADR nuevos
ADR nuevos
ADR nuevos
Soporte / WhatsApp
IA / Biometría
Geo / Mapas
Reportabilidad
Bot conversacional (menú, reclamos, IA), multilínea por área, administración de números, chat web persistente, RRHH y scoring de CVs.
Fusión ONNX solo-veto, pool de conexiones a ai_engine, thread-safety de eye_analyzer, liveness activo reactivado.
Batching TLS en mining-gateway, coordenadas geográficas de empresa, integración nativa GEOCATMIN/INGEMMET.
Aislamiento del caché offline por usuario/tenant, plantillas nativas de presentación 16:9.

MÓDULO NUEVO — SIN SPEC
ADR-112 a 118, 122
ADR-119, 124–126
ADR-120, 121, 123
ADR-127, 128
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
9

### Notes:

<!-- Slide number: 10 -->
REQUIERE DECISIÓN DE GERENCIA
Alcance nuevo aún no incorporado al cronograma v36

DECISIÓN PENDIENTE

DECISIÓN PENDIENTE
Soporte / WhatsApp
GEOCATMIN (SPEC-024)
8 ADR implementados y verificados por build/tests. Sin número de SPEC, sin sprint asignado. Entrega real a un teléfono depende de credenciales de producción de Meta.
ADR-121/123 implementados — integración nativa con INGEMMET. Tiene spec.md pero no tasks.md: queda fuera del conteo de 196 tareas hasta que se descomponga.

DECISIÓN PENDIENTE

DECISIÓN PENDIENTE
Operaciones de campo (SPEC-022)
Enterprise LATAM (ADR-035)
0/14 tareas. Ya reconocido como proyecto derivado desde el informe del 18-ago. Sigue sin product owner, arquitecto ni presupuesto asignado.
Solo la fase F0 está vigente. F1–F4 (topología edge/hub multipaís) siguen sin código ni decisión comercial.
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
10

### Notes:

<!-- Slide number: 11 -->
GESTIÓN DE RIESGO
Riesgos gerenciales, priorizados
| Prio. | Riesgo | Impacto | Acción / decisión |
| --- | --- | --- | --- |
| P0 | 365 archivos sin commitear (234 el 18-ago); CHANGELOG sin tocar desde el 27-jul pese a 61 ADR nuevos | Pérdida de trabajo y trazabilidad | Segmentar ramas/commits por SPEC y respaldar ya |
| P0 | Offline, alertas y DR casi sin tareas cerradas | R4/R5 no alcanzables por inercia | Equipo dedicado y plan semanal con evidencia |
| P0 | Sin pentest externo, UAT ni DR agendados | No habilita go-live | Agendar proveedores/usuarios y ventanas ahora |
| P1 | Soporte/WhatsApp sin SPEC ni presupuesto formal | Alcance no contractual sin decisión | Aprobar SPEC-025 o posponer explícitamente |
| P1 | AWS real depende de acceso del cliente | Puede bloquear R4 | Responsable, credenciales, ventana y dataset de aceptación |
| P1 | Escritura Odoo no probada productivamente | Integración solo parcialmente aceptada | Ventana controlada con registro de rollback |
| P1 | Biometría sin calibración/cumplimiento | Riesgo de seguridad/privacidad | Dataset representativo, laboratorio y DPIA |
| P1 | Operaciones de campo fuera del cronograma actual | Sobrecarga R6 y expectativas | Aprobar rebaseline, personal y piloto separados |
| P2 | Bundles >500 kB y warnings CSS | UX en enlaces lentos / PDA de campo | Code splitting, limpiar @apply, presupuesto de bundle |
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
11

### Notes:

<!-- Slide number: 12 -->
CAMINO A PRODUCCIÓN
Plan de recuperación, mes a mes

18–31 AGO
SEPTIEMBRE
OCTUBRE
NOVIEMBRE
Cerrar R3 con evidencia
R4 integrado — 3 equipos en paralelo
R5 sin negociación de evidencia
R6 — Go-Live
CA pendientes de SPEC-021, regresión de ReportStudio, CI con build+CTest backend y Playwright crítico, acta de gate R3. Decidir alcance de Soporte/WhatsApp.
Equipo A: offline (SPEC-014) y pruebas WAN/replay. Equipo B: alertas (SPEC-016) e integración dashboard/informe. Equipo C: AWS/ThingsBoard real + Odoo CA-4 autorizada.
Simulacro failover/restore cronometrado, pentest externo con cierre de P0/P1, soak de telemetría, calibración biométrica o exclusión formal de alcance.
UAT con operadores, marcha blanca 48–72 h, rollback probado. Go-live solo si los 10 controles de la diapositiva 8 están completos.

Proyectos derivados, sin fecha en v36:  Operaciones de campo (aprobar ADR-110 + SPEC-022, equipo y piloto) y Soporte/WhatsApp (formalizar SPEC-025, sprint destino si se aprueba).
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
12

### Notes:

<!-- Slide number: 13 -->
SE SOLICITA A GERENCIA Y TI
Decisiones pendientes para no bloquear el cronograma
Aprobar o diferir explícitamente la incorporación del módulo Soporte/WhatsApp al alcance contractual (SPEC-025) y su sprint destino.

1
Aprobar el rebaseline de Operaciones de Campo como proyecto derivado: product owner, equipo y presupuesto de piloto.

2
Autorizar pentest externo, simulacro DR y UAT con fechas y proveedores concretos — sin esto R5/R6 no pueden cerrar.

3
Exigir commits y CHANGELOG al día: 365 archivos sin trazar es un riesgo de pérdida de trabajo, no solo de higiene.

4
Definir postura comercial sobre Enterprise LATAM (ADR-035 F1–F4) y sobre la validación externa de RUC/SUNAT.

5
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
13

### Notes:

<!-- Slide number: 14 -->

Próxima revisión
Cierre de gate R3 — 31 de agosto de 2026
Métricas actualizadas cada viernes con scripts/project-status-metrics.ps1. Próximo corte: viernes 28-ago-2026, previo al gate.

Fuentes de verdad:
docs/decisions/README.md (ADR-000–128)  ·  specs/REGISTRY.md  ·  specs/BACKLOG.md
scripts/project-status-metrics.ps1  ·  docs_/01_Planificacion/Cronograma_Maestro_AURIXA_v36.md
Beemetry · Plataforma Minera  |  Corte 21-ago-2026  |  Confidencial — uso interno Gerencia / TI
14

### Notes: