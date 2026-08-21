# Documento Gerencial — Distribución de Recursos y Justificación de Obligatoriedad
## Proyecto 6 meses · Junio–Noviembre 2026

### Resumen ejecutivo

Sustenta la necesidad de **10 recursos especializados** con carga **90–100%** en meses activos.

### Matriz consolidada

| Recurso | Código | Total h | Prom. activos % | Junio | Julio | Agosto | Septiembre | Octubre | Noviembre |
|---------|--------|---------|-----------------|---|---|---|---|---|---|
| BACKEND 1 — Core C++ / OpenCV / Sockets  | BE1 | 977.5 | 92.0% | 168.3h (94.3%) | 156.7h (92.2%) | 153.0h (90.0%) | 168.3h (90.0%) | 166.2h (93.1%) | 165.0h (92.4%) |
| BACKEND 2 — Seguridad, Biometria, Usuari | BE2 | 985.2 | 92.7% | 169.5h (95.0%) | 153.0h (90.0%) | 153.0h (90.0%) | 168.3h (90.0%) | 173.7h (97.3%) | 167.7h (93.9%) |
| BACKEND 3 — Semi-Senior DBA / AWS / ETL  | BE3 | 1009.1 | 95.0% | 171.2h (95.9%) | 167.5h (98.5%) | 162.5h (95.6%) | 170.0h (90.9%) | 171.2h (95.9%) | 166.7h (93.4%) |
| FRONTEND 1 — Interfaces (mes 1 al 6) | FE1 | 1041.6 | 98.0% | 160.7h (90.0%) | 167.8h (98.7%) | 169.3h (99.6%) | 187.0h (100.0%) | 178.5h (100.0%) | 178.3h (99.9%) |
| FRONTEND 2 — UX y Soporte (desde mes 2) | FE2 | 836.2 | 94.5% | N/A | 153.0h (90.0%) | 154.4h (90.8%) | 187.0h (100.0%) | 167.8h (94.0%) | 174.0h (97.5%) |
| ARQ-Arquitecto TI / PMO | ARQ | 1026.1 | 96.5% | 178.0h (99.7%) | 160.3h (94.3%) | 153.0h (90.0%) | 178.1h (95.2%) | 178.5h (100.0%) | 178.2h (99.8%) |
| SYS-Infraestructura | SYS | 852.2 | 96.3% | N/A | 155.2h (91.3%) | 153.0h (90.0%) | 187.0h (100.0%) | 178.5h (100.0%) | 178.5h (100.0%) |
| QA-Calidad (desde mes 2) | QA | 849.5 | 96.1% | N/A | 160.3h (94.3%) | 163.5h (96.2%) | 170.0h (90.9%) | 178.5h (100.0%) | 177.2h (99.3%) |
| IA-ML — Modelos e Inteligencia Artificia | IA | 865.9 | 97.9% | N/A | 168.3h (99.0%) | 163.7h (96.3%) | 182.3h (97.5%) | 178.4h (99.9%) | 173.2h (97.0%) |
| Soporte PMO — Analista Funcional y Docum | PAF | 997.1 | 93.8% | 160.7h (90.0%) | 153.4h (90.2%) | 167.7h (98.6%) | 176.9h (94.6%) | 177.7h (99.6%) | 160.7h (90.0%) |

---

## BE1 — BACKEND 1 — Core C++ / OpenCV / Sockets Tiempo Real

**Obligatoriedad:** Rol NO sustituible. Dueño del núcleo C++ (Boost.Asio), visión OpenCV, sockets/WebSocket de telemetría e integraciones internas entre servicios. Todo módulo frontend tiene su equivalente backend aquí (editor, mapas, exportación, panel gerencial, cola offline). Reasignar a BE2 o BE3 generaría conflicto de competencias y dejaría sin dueño el tiempo real.

**Alternativa descartada:** BE2 es seguridad/IA aplicada; BE3 es DBA/AWS. Ninguno tiene ownership del core C++ tiempo real.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 168.3 | 178.5 | 94.3% |
| Mes 2 Julio | 156.7 | 170.0 | 92.2% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 166.2 | 178.5 | 93.1% |
| Mes 6 Noviembre | 165.0 | 178.5 | 92.4% |

**Funciones por mes:**

- **Mes 1:** Arquitectura servidor HTTP/WebSocket, contratos API con FE1, shell core navegable, routing modular.
- **Mes 2:** Canal en vivo sensores, motor editor server-side, telemetría Boost.Asio, APIs core mineras.
- **Mes 3:** Servicios mapa minero, export PDF/Word, OpenCV pipeline, notificaciones in-app WebSocket.
- **Mes 4:** Panel gerencial backend, cola sync sin internet (con BE3), integración e2e informes.
- **Mes 5:** Optimización tiempo real, pruebas de carga sockets, hardening performance producción.
- **Mes 6:** Marcha blanca, estabilización post go-live, transferencia operativa del núcleo C++.

**Riesgo si se reduce:** Retraso en telemetría en vivo; imposibilidad de operación offline; pérdida de paridad FE-BE; degradación de latencia en sensores críticos.

---

## BE2 — BACKEND 2 — Seguridad, Biometria, Usuarios e IA Aplicada

**Obligatoriedad:** Especialización en ciberseguridad (JWT/RBAC/OWASP), biometría facial, administración de usuarios/perfiles/accesos e integración de IA local (VPS) y cloud (pagada/gratuita) vía Servicios Web. IA entrena modelos; BE2 los integra y sirve. BE1 no puede absorber pentesting ni gateway IA sin sacrificar el core.

**Alternativa descartada:** Asignar a BE1: colisión con ruta crítica core. Asignar a IA: IA entrena modelos, no opera gateway ni RBAC.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 169.5 | 178.5 | 95.0% |
| Mes 2 Julio | 153.0 | 170.0 | 90.0% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 173.7 | 178.5 | 97.3% |
| Mes 6 Noviembre | 167.7 | 178.5 | 93.9% |

**Funciones por mes:**

- **Mes 1:** Matriz RBAC, políticas JWT, diseño segregación por tenant, threat modeling inicial.
- **Mes 2:** Acceso facial con prueba de vida, usuarios/perfiles/niveles de acceso, hardening endpoints.
- **Mes 3:** Gateway IA multi-proveedor cloud, motor IA local VPS, corrector integrado con IA.
- **Mes 4:** Auditoría de accesos, pentest pre-producción, OWASP full check, firma digital PKI.
- **Mes 5:** Zero-Trust, simulacros intrusión, cache respuestas IA, validación biométrica producción.
- **Mes 6:** Certificación seguridad UAT, cierre hallazgos, entrega evidencias ISO/auditoría.

**Riesgo si se reduce:** Exposición a fraude de identidad; accesos no autorizados; IA sin plan de respaldo; incumplimiento normativo minero y protección de datos personales.

---

## BE3 — BACKEND 3 — Semi-Senior DBA / AWS / ETL / Recovery

**Obligatoriedad:** Dueño de PostgreSQL (diseño, scripts, backups, replicación), integración plataforma Amazon (AWS), ETL, sincronización de bases de datos y control de recovery/DR del sistema completo y BD. Carga 95% en meses activos; absorber en BE1 bloquea el core C++ tiempo real.

**Alternativa descartada:** BE1 ya dedicado al core C++. BE2 no tiene competencia DBA ni ETL AWS.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 171.2 | 178.5 | 95.9% |
| Mes 2 Julio | 167.5 | 170.0 | 98.5% |
| Mes 3 Agosto | 162.5 | 170.0 | 95.6% |
| Mes 4 Septiembre | 170.0 | 187.0 | 90.9% |
| Mes 5 Octubre | 171.2 | 178.5 | 95.9% |
| Mes 6 Noviembre | 166.7 | 178.5 | 93.4% |

**Funciones por mes:**

- **Mes 1:** Diseño esquema PostgreSQL, ERD multi-tenant, scripts SQL base, datos de prueba.
- **Mes 2:** Creación BD principal, sincronización AWS, procesos ETL programados, índices y triggers.
- **Mes 3:** ETL incremental legacy, replicación, retención datos, monitoreo sync con AWS.
- **Mes 4:** Backups automáticos, prueba restauración, resolución conflictos sync offline (con BE1).
- **Mes 5:** Simulacro DR sistema+BD, monitoreo replicación, archivado histórico, tuning consultas.
- **Mes 6:** Handover DBA operaciones, runbooks recovery, soporte marcha blanca datos.

**Riesgo si se reduce:** Pérdida de datos en sync AWS; imposibilidad de restaurar BD; ETL fallido en cierre de mes; incumplimiento continuidad operativa exigida por auditoría minera.

---

## FE1 — FRONTEND 1 — Interfaces (mes 1 al 6)

**Obligatoriedad:** Indispensable desde junio: es el ÚNICO frontend en mes 1. Sin FE1 no hay shell navegable, contratos UI ni validación temprana con usuarios. FE2 entra en julio; no puede retroactivamente cubrir arquitectura React/Vite ni ReportStudio core. Carga 97,4% promedio meses activos.

**Alternativa descartada:** FE2 desde mes 2 no cubre mes 1. BE/ARQ no tienen competencia frontend React.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 160.7 | 178.5 | 90.0% |
| Mes 2 Julio | 167.8 | 170.0 | 98.7% |
| Mes 3 Agosto | 169.3 | 170.0 | 99.6% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 178.3 | 178.5 | 99.9% |

**Funciones por mes:**

- **Mes 1:** Setup React/Vite, routing, design system, shell ReportStudio, login, integración API BE1.
- **Mes 2:** Editor TipTap base, ribbon toolbar, auth UI, autosave visual, data grid búsqueda.
- **Mes 3:** Offline UI, borradores múltiples, shortcuts, ribbon auto-hide, GIS base, workflow UI.
- **Mes 4:** Paste imagen, print preview, comparador versiones, integración e2e, dashboards KPI.
- **Mes 5:** Streaming cámaras, gráficos live, ajustes UAT, optimización menú (-40% clics).
- **Mes 6:** Estabilización UX marcha blanca, hotfixes campo, documentación componentes y atajos.

**Riesgo si se reduce:** Mes 1 sin frontend = retraso total del cronograma (4+ semanas). Rechazo de usuarios por UX; incumplimiento alcances A–G (offline, borradores, shortcuts, paneles icon-only).

---

## FE2 — FRONTEND 2 — UX y Soporte (desde mes 2)

**Obligatoriedad:** Complemento obligatorio de FE1: pruebas con operadores en tablet, accesibilidad industrial, sidebars icon-only, soporte UAT y NPS post go-live. FE1 al 97% no puede absorber pruebas de campo sin retrasar desarrollo core del editor.

**Alternativa descartada:** FE1 solo: imposible desarrollar y probar en campo simultáneamente al 97% de carga.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | — | 178.5 | N/A |
| Mes 2 Julio | 153.0 | 170.0 | 90.0% |
| Mes 3 Agosto | 154.4 | 170.0 | 90.8% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 167.8 | 178.5 | 94.0% |
| Mes 6 Noviembre | 174.0 | 178.5 | 97.5% |

**Funciones por mes:**

- **Mes 2:** Validación UX login/responsive tablet, paneles retráctiles, accesibilidad modo oscuro.
- **Mes 3:** Iteración alarmas UI, sidebars colapsables, co-desarrollo offline UX con FE1.
- **Mes 4:** QA funcional alcances A–G desde perspectiva usuario, comentarios UI, diff visual.
- **Mes 5:** Soporte UAT presencial/híbrido, encuestas operadores, ajustes fricción UX.
- **Mes 6:** Marcha blanca acompañamiento, NPS post-lanzamiento, capacitación asistida en campo.

**Riesgo si se reduce:** UX no validada en condiciones reales de mina (guantes, poca luz); baja adopción operativa; retrabajo masivo post go-live; incumplimiento pruebas de usabilidad gerenciales.

---

## ARQ — ARQ-Arquitecto TI / PMO

**Obligatoriedad:** Gobierno técnico, aprobación de arquitectura, SOW, hitos gerenciales, DRP, UAT ejecutivo y go-live. Sin ARQ no hay sign-off de fases ni escalamiento de riesgos a directorio. No es rol reemplazable por PAF (documentación) ni por BE1 (implementación).

**Alternativa descartada:** PMO/PAF documenta pero no decide arquitectura. Ningún dev senior puede asumir gobierno + codificar al 100%.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 178.0 | 178.5 | 99.7% |
| Mes 2 Julio | 160.3 | 170.0 | 94.3% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 178.1 | 187.0 | 95.2% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 178.2 | 178.5 | 99.8% |

**Funciones por mes:**

- **Mes 1:** Kick-off C-Level, SOW, NFR, mapa arquitectura, comité aprobación diseño, BRD.
- **Mes 2:** Supervisión ruta crítica backend/frontend, revisión de integraciones, gestión de riesgos.
- **Mes 3:** Defensa hito intermedio, validación GIS/sensores, change control formal.
- **Mes 4:** Demo gerencial core completo, aprobación paso a etapa 2, revisión QA integral.
- **Mes 5:** DRP, hardening sign-off, preparación UAT ejecutivo, comité de gobernanza.
- **Mes 6:** UAT directorio, acta go-live, transferencia llaves, cierre contractual SOW.

**Riesgo si se reduce:** Decisiones técnicas sin dueño; scope creep no controlado; imposibilidad de firmar hitos; rechazo de directorio en UAT por falta de sponsor técnico.

---

## SYS — SYS-Infraestructura

**Obligatoriedad:** Dueño de VPS/Docker, CI/CD, Prometheus/Grafana, Nginx, backups infra, DRP técnico y hardening de servidores. BE1 administra BD pero no red/VPC/contenedores producción. Carga 96,3% en meses activos; mes 5–6 al 100% por go-live.

**Alternativa descartada:** BE1/DBA: enfoque datos, no red ni orquestación. CLD legacy no existe en equipo actual.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | — | 178.5 | N/A |
| Mes 2 Julio | 155.2 | 170.0 | 91.3% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 178.5 | 178.5 | 100.0% |

**Funciones por mes:**

- **Mes 2:** Docker Compose staging, pipeline CI/CD base, secrets management, healthchecks.
- **Mes 3:** Prometheus/Grafana, alertas operativas, tuning Nginx cache/compresión.
- **Mes 4:** Ambiente UAT infra, simulacros failover, optimización VPS Lima.
- **Mes 5:** Red datacenter, segmentación, hardening Zero-Trust infra, cache offline-sync edge.
- **Mes 6:** Blue/green deployment, DNS producción, monitoreo 24/7 post go-live, runbooks infra.

**Riesgo si se reduce:** Caída de plataforma sin recuperación; despliegues manuales propensos a error; sin monitoreo en marcha blanca; incumplimiento SLA de disponibilidad.

---

## QA — QA-Calidad (desde mes 2)

**Obligatoriedad:** Independencia de QA exigida por auditoría: quien desarrolla no puede certificar calidad. 13 suites funcionales, pentest funcional, load test 10k sensores, UAT estructurado. Carga 95,5% meses activos; octubre–noviembre al 100%.

**Alternativa descartada:** Devs auto-probar: conflicto de interés ISO. PAF no tiene competencia técnica de testing.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | — | 178.5 | N/A |
| Mes 2 Julio | 160.3 | 170.0 | 94.3% |
| Mes 3 Agosto | 163.5 | 170.0 | 96.2% |
| Mes 4 Septiembre | 170.0 | 187.0 | 90.9% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 177.2 | 178.5 | 99.3% |

**Funciones por mes:**

- **Mes 2:** Plan maestro TQA01, casos smoke/regression auth y CRUD informes.
- **Mes 3:** Regresión editor TipTap, exportación temprana, pruebas telemetría base.
- **Mes 4:** Suite alcances A–G, integración e2e, export PDF/DOCX calidad, Valgrind coordinado.
- **Mes 5:** Pentest OWASP, load test incremental, pruebas seguridad, preparación UAT.
- **Mes 6:** UAT formal, regresión final, certificado de calidad para directorio, cierre hallazgos P0.

**Riesgo si se reduce:** Go-live con defectos críticos; incumplimiento 13 suites; rechazo de certificación; incidentes en producción no detectados.

---

## IA — IA-ML — Modelos e Inteligencia Artificial (desde mes 2)

**Obligatoriedad:** Competencia especializada no presente en BE2 (seguridad) ni BE3 (integraciones). Dueño de STT, NLP, OCR, biometría ONNX, clasificación de imágenes y modelos locales. Requisito contractual de asistente de redacción y visión EPP.

**Alternativa descartada:** BE2: seguridad, no ML. Externalizar IA: 6–8 sem de onboarding + riesgo de propiedad intelectual.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | — | 178.5 | N/A |
| Mes 2 Julio | 168.3 | 170.0 | 99.0% |
| Mes 3 Agosto | 163.7 | 170.0 | 96.3% |
| Mes 4 Septiembre | 182.3 | 187.0 | 97.5% |
| Mes 5 Octubre | 178.4 | 178.5 | 99.9% |
| Mes 6 Noviembre | 173.2 | 178.5 | 97.0% |

**Funciones por mes:**

- **Mes 2:** PoC LanguageTool + vocabulario sectorial, pipeline STT inicial.
- **Mes 3:** Whisper fine-tuning acento regional, corrector NLP local, integración gRPC con backend.
- **Mes 4:** Clasificación informes, NER entidades, OCR documentos, biometría liveness PoC.
- **Mes 5:** ONNX biometría producción, visión EPP CCTV, auto-tag imágenes pegadas en informes.
- **Mes 6:** Estabilización modelos en marcha blanca, tuning latencia, documentación MLOps.

**Riesgo si se reduce:** Funcionalidades IA del SOW no entregadas; dictado por voz inutilizable en ruido de planta; biometría y EPP vision incumplidos.

---

## PAF — Soporte PMO — Analista Funcional y Documentador

**Obligatoriedad:** Libera 15–20% de carga ARQ y devs en actas, ClickUp, manuales y capacitación. Sin PAF, ARQ pierde 40h/mes en PMO y el cronograma deja de reflejar realidad. Único rol de capacitación a usuarios finales y trazabilidad requisito–entregable.

**Alternativa descartada:** ARQ hace PMO: -18% capacidad arquitectura. Devs documentan: sesgo y baja calidad de manuales.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 160.7 | 178.5 | 90.0% |
| Mes 2 Julio | 153.4 | 170.0 | 90.2% |
| Mes 3 Agosto | 167.7 | 170.0 | 98.6% |
| Mes 4 Septiembre | 176.9 | 187.0 | 94.6% |
| Mes 5 Octubre | 177.7 | 178.5 | 99.6% |
| Mes 6 Noviembre | 160.7 | 178.5 | 90.0% |

**Funciones por mes:**

- **Mes 1:** ClickUp semanal, actas kick-off/SOW, BRD soporte, RACI, boletines avance.
- **Mes 2:** Ceremonias agile, action items, matriz trazabilidad FE↔BE, documentación funcional base.
- **Mes 3:** Manuales borradores/offline, catálogo requerimientos, soporte change requests.
- **Mes 4:** Manuales usuario piloto, soporte UAT documental, dashboard gerencia quincenal.
- **Mes 5:** Plan capacitación A–G, talleres supervisores, soporte comité ejecutivo.
- **Mes 6:** Kit cierre, lecciones aprendidas, acta transferencia, inducción operaciones.

**Riesgo si se reduce:** Descontrol de cronograma; gerencia sin reportes confiables; usuarios sin manuales en go-live; UAT caótico; ARQ sobrecargado y retraso en decisiones técnicas.

---
