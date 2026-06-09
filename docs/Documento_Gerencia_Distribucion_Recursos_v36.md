# Documento Gerencial — Distribución de Recursos y Justificación de Obligatoriedad
## Proyecto 6 meses · Junio–Noviembre 2026

### Resumen ejecutivo

Sustenta la necesidad de **10 recursos especializados** con carga **90–100%** en meses activos.

### Matriz consolidada

| Recurso | Código | Total h | Prom. activos % | Junio | Julio | Agosto | Septiembre | Octubre | Noviembre |
|---------|--------|---------|-----------------|---|---|---|---|---|---|
| BACKEND 1 — DBA / Arq. Datos y Core | BE1 | 1021.2 | 96.2% | 174.7h (97.9%) | 170.0h (100.0%) | 165.0h (97.1%) | 179.3h (95.9%) | 164.9h (92.4%) | 167.3h (93.7%) |
| BACKEND 2 — Ciberseguridad Backend (JWT/ | BE2 | 1008.2 | 94.8% | 171.2h (95.9%) | 158.2h (93.1%) | 153.0h (90.0%) | 178.8h (95.6%) | 175.7h (98.4%) | 171.3h (96.0%) |
| BACKEND 3 — Integraciones | BE3 | 1021.3 | 96.1% | 165.7h (92.8%) | 170.0h (100.0%) | 163.2h (96.0%) | 187.0h (100.0%) | 174.7h (97.9%) | 160.7h (90.0%) |
| FRONTEND 1 — Interfaces (mes 1 al 6) | FE1 | 1036.6 | 97.6% | 160.7h (90.0%) | 167.5h (98.5%) | 168.9h (99.4%) | 187.0h (100.0%) | 176.3h (98.8%) | 176.2h (98.7%) |
| FRONTEND 2 — UX y Soporte (desde mes 2) | FE2 | 802.2 | 90.7% | N/A | 154.5h (90.9%) | 153.0h (90.0%) | 168.3h (90.0%) | 160.7h (90.0%) | 165.7h (92.8%) |
| ARQ-Arquitecto TI / PMO | ARQ | 1028.2 | 96.8% | 173.3h (97.1%) | 163.5h (96.2%) | 167.3h (98.4%) | 177.3h (94.8%) | 177.0h (99.2%) | 169.8h (95.1%) |
| SYS-Infraestructura | SYS | 853.3 | 96.4% | N/A | 156.3h (91.9%) | 153.0h (90.0%) | 187.0h (100.0%) | 178.5h (100.0%) | 178.5h (100.0%) |
| QA-Calidad (desde mes 2) | QA | 831.6 | 94.0% | N/A | 153.5h (90.3%) | 153.0h (90.0%) | 168.3h (90.0%) | 178.3h (99.9%) | 178.5h (100.0%) |
| IA-ML — Modelos e Inteligencia Artificia | IA | 796.9 | 90.1% | N/A | 154.2h (90.7%) | 153.0h (90.0%) | 168.3h (90.0%) | 160.7h (90.0%) | 160.7h (90.0%) |
| Soporte PMO — Analista Funcional y Docum | PAF | 984.7 | 92.6% | 173.0h (96.9%) | 153.0h (90.0%) | 160.0h (94.1%) | 174.0h (93.0%) | 164.0h (91.9%) | 160.7h (90.0%) |

---

## BE1 — BACKEND 1 — DBA / Arq. Datos y Core

**Obligatoriedad:** Rol NO sustituible. Concentra el 100% del diseño de base de datos, persistencia offline, motor documental server-side, sincronización legacy y APIs core. Reasignar a BE2 o BE3 generaría conflicto de competencias (seguridad vs integraciones) y dejaría sin dueño el esquema PostgreSQL, ETL y reconciliación offline — riesgo crítico de pérdida de datos en campo.

**Alternativa descartada:** Fusionar con BE2/BE3: BE2 es 100% ciberseguridad; BE3 es integraciones/comunicaciones. Ninguno tiene capacidad DBA ni ownership del modelo de datos.

| Mes | Horas | Capacidad | % |
|-----|-------|-----------|---|
| Mes 1 Junio | 174.7 | 178.5 | 97.9% |
| Mes 2 Julio | 170.0 | 170.0 | 100.0% |
| Mes 3 Agosto | 165.0 | 170.0 | 97.1% |
| Mes 4 Septiembre | 179.3 | 187.0 | 95.9% |
| Mes 5 Octubre | 164.9 | 178.5 | 92.4% |
| Mes 6 Noviembre | 167.3 | 178.5 | 93.7% |

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
| Mes 1 Junio | 171.2 | 178.5 | 95.9% |
| Mes 2 Julio | 158.2 | 170.0 | 93.1% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 178.8 | 187.0 | 95.6% |
| Mes 5 Octubre | 175.7 | 178.5 | 98.4% |
| Mes 6 Noviembre | 171.3 | 178.5 | 96.0% |

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
| Mes 1 Junio | 165.7 | 178.5 | 92.8% |
| Mes 2 Julio | 170.0 | 170.0 | 100.0% |
| Mes 3 Agosto | 163.2 | 170.0 | 96.0% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 174.7 | 178.5 | 97.9% |
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
| Mes 2 Julio | 167.5 | 170.0 | 98.5% |
| Mes 3 Agosto | 168.9 | 170.0 | 99.4% |
| Mes 4 Septiembre | 187.0 | 187.0 | 100.0% |
| Mes 5 Octubre | 176.3 | 178.5 | 98.8% |
| Mes 6 Noviembre | 176.2 | 178.5 | 98.7% |

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
| Mes 2 Julio | 154.5 | 170.0 | 90.9% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 160.7 | 178.5 | 90.0% |
| Mes 6 Noviembre | 165.7 | 178.5 | 92.8% |

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
| Mes 1 Junio | 173.3 | 178.5 | 97.1% |
| Mes 2 Julio | 163.5 | 170.0 | 96.2% |
| Mes 3 Agosto | 167.3 | 170.0 | 98.4% |
| Mes 4 Septiembre | 177.3 | 187.0 | 94.8% |
| Mes 5 Octubre | 177.0 | 178.5 | 99.2% |
| Mes 6 Noviembre | 169.8 | 178.5 | 95.1% |

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
| Mes 2 Julio | 156.3 | 170.0 | 91.9% |
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
| Mes 2 Julio | 153.5 | 170.0 | 90.3% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 178.3 | 178.5 | 99.9% |
| Mes 6 Noviembre | 178.5 | 178.5 | 100.0% |

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
| Mes 2 Julio | 154.2 | 170.0 | 90.7% |
| Mes 3 Agosto | 153.0 | 170.0 | 90.0% |
| Mes 4 Septiembre | 168.3 | 187.0 | 90.0% |
| Mes 5 Octubre | 160.7 | 178.5 | 90.0% |
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
| Mes 1 Junio | 173.0 | 178.5 | 96.9% |
| Mes 2 Julio | 153.0 | 170.0 | 90.0% |
| Mes 3 Agosto | 160.0 | 170.0 | 94.1% |
| Mes 4 Septiembre | 174.0 | 187.0 | 93.0% |
| Mes 5 Octubre | 164.0 | 178.5 | 91.9% |
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
