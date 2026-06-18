# Documento Gerencial — Distribución de Recursos y Justificación de Obligatoriedad
## Proyecto 6 meses · Junio–Noviembre 2026

### Resumen ejecutivo

Sustenta la necesidad de **10 recursos especializados** con carga **90–100%** en meses activos.

### Matriz consolidada

| Recurso | Código | Total h | Prom. activos % | Junio | Julio | Agosto | Septiembre | Octubre | Noviembre |
|---------|--------|---------|-----------------|---|---|---|---|---|---|
| BACKEND 1 — DBA / Arq. Datos y Core | BE1 | 1006.8 | 94.9% | 178.0h (99.7%) | 170.0h (100.0%) | 168.8h (99.3%) | 168.3h (90.0%) | 161.0h (90.2%) | 160.7h (90.0%) |
| BACKEND 2 — Ciberseguridad Backend (JWT/ | BE2 | 971.5 | 91.4% | 160.7h (90.0%) | 153.0h (90.0%) | 153.0h (90.0%) | 179.8h (96.1%) | 164.3h (92.0%) | 160.7h (90.0%) |
| BACKEND 3 — Integraciones | BE3 | 994.7 | 93.6% | 160.7h (90.0%) | 168.2h (98.9%) | 155.7h (91.6%) | 174.2h (93.2%) | 175.2h (98.2%) | 160.7h (90.0%) |
| FRONTEND 1 — Interfaces (mes 1 al 6) | FE1 | 1035.1 | 97.4% | 160.7h (90.0%) | 168.5h (99.1%) | 167.2h (98.4%) | 185.5h (99.2%) | 178.5h (100.0%) | 174.7h (97.9%) |
| FRONTEND 2 — UX y Soporte (desde mes 2) | FE2 | 803.7 | 90.9% | N/A | 153.0h (90.0%) | 154.0h (90.6%) | 168.3h (90.0%) | 160.7h (90.0%) | 167.7h (93.9%) |
| ARQ-Arquitecto TI / PMO | ARQ | 995.0 | 93.6% | 174.8h (97.9%) | 160.3h (94.3%) | 155.7h (91.6%) | 179.8h (96.1%) | 163.5h (91.6%) | 160.9h (90.1%) |
| SYS-Infraestructura | SYS | 852.8 | 96.3% | N/A | 156.5h (92.1%) | 153.0h (90.0%) | 187.0h (100.0%) | 177.8h (99.6%) | 178.5h (100.0%) |
| QA-Calidad (desde mes 2) | QA | 844.5 | 95.5% | N/A | 160.3h (94.3%) | 156.5h (92.1%) | 170.9h (91.4%) | 178.5h (100.0%) | 178.3h (99.9%) |
| IA-ML — Modelos e Inteligencia Artificia | IA | 813.4 | 92.0% | N/A | 154.5h (90.9%) | 153.0h (90.0%) | 168.3h (90.0%) | 176.9h (99.1%) | 160.7h (90.0%) |
| Soporte PMO — Analista Funcional y Docum | PAF | 984.9 | 92.8% | 160.7h (90.0%) | 159.2h (93.6%) | 164.7h (96.9%) | 168.3h (90.0%) | 171.3h (96.0%) | 160.7h (90.0%) |

---

## BE1 — BACKEND 1 — DBA / Arq. Datos y Core

**Obligatoriedad:** Rol NO sustituible. Concentra el 100% del diseño de base de datos, persistencia offline, motor documental server-side, sincronización legacy y APIs core. Reasignar a BE2 o BE3 generaría conflicto de competencias (seguridad vs integraciones) y dejaría sin dueño el esquema PostgreSQL, ETL y reconciliación offline — riesgo crítico de pérdida de datos en campo.

**Alternativa descartada:** Fusionar con BE2/BE3: BE2 es 100% ciberseguridad; BE3 es integraciones/comunicaciones. Ninguno tiene capacidad DBA ni ownership del modelo de datos.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 178.0 | 178.5 | 99.7% |
| Mes 2 Julio | 170.0 | 170.0 | 100.0% |
| Mes 3 Agosto | 168.8 | 170.0 | 99.3% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 161.0 | 178.5 | 90.2% |
| Mes 6 Noviembre | 160.7 | 178.5 | 90.0% |

**Funciones por mes:**

- **Mes 1:** ERD multi-tenant, contratos API con frontend, PoC arquitectura, scripts SQL base, integración temprana con FE1.
- **Mes 2:** WebSocket, autosave delta, libpqxx, endpoints documentales JSONB, bitácora forense inicial.
- **Mes 3:** Motor documental, versionado, borradores múltiples (API), offline sync backend, ETL legacy.
- **Mes 4:** Comentarios API, cache Redis, integración e2e informes, resolución conflictos sync, performance tuning.
- **Mes 5:** Kafka bridge, hardening producción, pruebas de carga, optimización consultas Timescale/telemetría.
- **Mes 6:** Marcha blanca, estabilización post go-live, transferencia operativa de esquema y runbooks DBA.

**Riesgo si se reduce:** Retraso ≥4 semanas en hitos H3–H5; imposibilidad de operación offline; corrupción de datos multi-tenant; incumplimiento de trazabilidad forense exigida por auditoría.

---

## BE2 — BACKEND 2 — Ciberseguridad Backend (JWT/RBAC/OWASP)

**Obligatoriedad:** Especialización exclusiva en seguridad aplicativa y cumplimiento. BE1 no puede absorber pentesting, firma digital, rate limiting y audit log sin sacrificar el 94,9% de carga ya comprometida en datos y motor core.

**Alternativa descartada:** Asignar seguridad a BE1: colisión con ruta crítica DBA/motor. Asignar a QA: QA valida pero no implementa controles en código.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 160.7 | 178.5 | 90.0% |
| Mes 2 Julio | 153.0 | 170.0 | 90.0% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 179.8 | 187.0 | 96.1% |
| Mes 5 Octubre | 164.3 | 178.5 | 92.0% |
| Mes 6 Noviembre | 160.7 | 178.5 | 90.0% |

**Funciones por mes:**

- **Mes 1:** Matriz RBAC, políticas JWT, diseño de segregación por tenant, threat modeling inicial.
- **Mes 2:** Middleware de autorización, cifrado at rest, hardening de endpoints, validación OWASP base.
- **Mes 3:** Firma digital PKI, rate limiter, audit log centralizado, revisión de APIs expuestas.
- **Mes 4:** Pentest pre-producción, OWASP full check, corrección hallazgos P0/P1, cifrado en cache.
- **Mes 5:** Zero-Trust DB, políticas IAM, simulacros de intrusión, validación biométrica backend.
- **Mes 6:** Certificación de seguridad para UAT, cierre de hallazgos, entrega de evidencias ISO/auditoría.

**Riesgo si se reduce:** Exposición a inyección SQL/XSS; incumplimiento normativo minero; rechazo de UAT por gerencia de TI; imposibilidad de certificar trazabilidad de acciones sensibles.

---

## BE3 — BACKEND 3 — Integraciones

**Obligatoriedad:** Dueño de notificaciones (email/SMS/webhooks), pipelines de imágenes externas, resolución de conflictos offline, conversión multiformato y conectividad con sistemas legacy. Carga del 93,6% en meses activos; absorber en BE1 bloquea ETL y sync.

**Alternativa descartada:** BE1 ya al 100% en mes 2–3. FE1 no implementa backend de integraciones.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 160.7 | 178.5 | 90.0% |
| Mes 2 Julio | 168.2 | 170.0 | 98.9% |
| Mes 3 Agosto | 155.7 | 170.0 | 91.6% |
| Mes 4 Septiembre | 174.2 | 187.0 | 93.2% |
| Mes 5 Octubre | 175.2 | 178.5 | 98.2% |
| Mes 6 Noviembre | 160.7 | 178.5 | 90.0% |

**Funciones por mes:**

- **Mes 1:** Análisis conectores legacy, diseño de webhooks, mapeo de formatos de integración.
- **Mes 2:** SMTP, push notifications, serialización binaria para baja conectividad, STT bridge.
- **Mes 3:** Motor resolución conflictos offline, upload pipeline imágenes, API gateway interno.
- **Mes 4:** Orquestador export PDF/DOCX/PPTX, webhooks eventos, integración Redpanda/Kafka productor.
- **Mes 5:** WhatsApp/notificaciones críticas, refactor post-QA, estabilización integraciones.
- **Mes 6:** Soporte marcha blanca integraciones, monitoreo de colas sync, handover a operaciones.

**Riesgo si se reduce:** Notificaciones de alarmas críticas no operativas; fallas en paste/upload de evidencias; conflictos offline no resueltos; exportaciones bloqueadas en cierre de mes.

---

## FE1 — FRONTEND 1 — Interfaces (mes 1 al 6)

**Obligatoriedad:** Indispensable desde junio: es el ÚNICO frontend en mes 1. Sin FE1 no hay shell navegable, contratos UI ni validación temprana con usuarios. FE2 entra en julio; no puede retroactivamente cubrir arquitectura React/Vite ni ReportStudio core. Carga 97,4% promedio meses activos.

**Alternativa descartada:** FE2 desde mes 2 no cubre mes 1. BE/ARQ no tienen competencia frontend React.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 160.7 | 178.5 | 90.0% |
| Mes 2 Julio | 168.5 | 170.0 | 99.1% |
| Mes 3 Agosto | 167.2 | 170.0 | 98.4% |
| Mes 4 Septiembre | 185.5 | 187.0 | 99.2% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 174.7 | 178.5 | 97.9% |

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
| Mes 3 Agosto | 154.0 | 170.0 | 90.6% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 160.7 | 178.5 | 90.0% |
| Mes 6 Noviembre | 167.7 | 178.5 | 93.9% |

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
| Mes 1 Junio | 174.8 | 178.5 | 97.9% |
| Mes 2 Julio | 160.3 | 170.0 | 94.3% |
| Mes 3 Agosto | 155.7 | 170.0 | 91.6% |
| Mes 4 Septiembre | 179.8 | 187.0 | 96.1% |
| Mes 5 Octubre | 163.5 | 178.5 | 91.6% |
| Mes 6 Noviembre | 160.9 | 178.5 | 90.1% |

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
| Mes 2 Julio | 156.5 | 170.0 | 92.1% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 177.8 | 178.5 | 99.6% |
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
| Mes 3 Agosto | 156.5 | 170.0 | 92.1% |
| Mes 4 Septiembre | 170.9 | 187.0 | 91.4% |
| Mes 5 Octubre | 178.5 | 178.5 | 100.0% |
| Mes 6 Noviembre | 178.3 | 178.5 | 99.9% |

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
| Mes 2 Julio | 154.5 | 170.0 | 90.9% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 176.9 | 178.5 | 99.1% |
| Mes 6 Noviembre | 160.7 | 178.5 | 90.0% |

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
| Mes 2 Julio | 159.2 | 170.0 | 93.6% |
| Mes 3 Agosto | 164.7 | 170.0 | 96.9% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 171.3 | 178.5 | 96.0% |
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
