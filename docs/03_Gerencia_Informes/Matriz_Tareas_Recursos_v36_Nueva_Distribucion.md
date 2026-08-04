# Matriz de Tareas y Carga Laboral — Nueva Distribución v36
## Proyecto AURIXA · 6 meses · Meta: 90–100% en meses activos

**Fecha:** Junio 2026 (reestructuración roles backend)  
**Fuente de verdad:** `scripts/generate_clickup_import.py` → `Plataforma_Minera_ClickUp_v19.xlsx`  
**Modelo de capacidad:** 8,5 h/día × días netos Perú 2026 (feriados excluidos). Tope **100%** mensual.

---

## Roster de recursos (10 roles)

| Cód. | Rol | Etapa 1 (Jun–Sep) | Etapa 2 (Oct–Nov) | Inicio |
|------|-----|-------------------|-------------------|--------|
| **BE1** | Core C++ / OpenCV / Sockets tiempo real | Núcleo servidor, telemetría, APIs paridad FE | Optimización tiempo real, estabilización core | Mes 1 |
| **BE2** | Seguridad, biometría, usuarios e IA aplicada | Auth, facial, RBAC, gateway IA local/cloud | Hardening, pentest, certificación UAT | Mes 1 |
| **BE3** | Semi-Senior DBA / AWS / ETL / Recovery | Esquema BD, sync AWS, ETL, backups | Simulacro DR, replicación, archivado | Mes 1 |
| **FE1** | Interfaces / Editor Maestro | Shell UI, ReportStudio, dashboards | Refinamiento UI, offline cliente | Mes 1 |
| **FE2** | UX y Soporte | Pruebas tablet, accesibilidad | UAT campo, marcha blanca | Mes 2 |
| **ARQ** | Arquitecto TI / PMO | Gobierno técnico, gates | DRP, go-live, cierre | Mes 1 |
| **SYS** | Infraestructura / DevOps | Docker, CI/CD, monitoreo | Hardening, HA, producción | Mes 2 |
| **QA** | Calidad | Plan pruebas, regresión | UAT, carga, certificación | Mes 2 |
| **IA** | Modelos ML (entrenamiento) | ONNX, NLP, OCR, STT | Afinamiento, precisión | Mes 2 |
| **PAF** | Analista funcional / PMO | ClickUp, actas, trazabilidad | Manuales, cierre, capacitación | Mes 1 |

**Fracción IA:** recurso **IA** entrena/afina modelos; **BE2** integra y sirve (VPS + cloud).

---

## Distribución por etapa

- **Etapa 1 (Meses 1–4 · Jun–Sep):** construcción funcional core, editor, sensores, integración AWS, QA base.
- **Etapa 2 (Meses 5–6 · Oct–Nov):** hardening, DR, optimización, UAT ejecutivo y Go-Live.

- Tareas técnicas: **422** | Backend BE1: **90** | BE2: **64** | BE3: **89**

---

## Carga mensual por recurso (% meses activos)

> FE2, SYS, QA e IA no tienen carga en junio (mes 1) por diseño. El **promedio activos** es la métrica de validación PMO.

| Recurso | Rol | Jun | Jul | Ago | Sep | Oct | Nov | Prom. activos | Total h |
|---------|-----|-----|-----|-----|-----|-----|-----|---------------|---------|
| **BE1** | BACKEND 1 — Core C++ / OpenCV / Sockets Ti | 94.3% | 92.2% | 90.0% | 90.0% | 93.1% | 92.4% | **92.0%** | 978h |
| **BE2** | BACKEND 2 — Seguridad, Biometria, Usuarios | 95.0% | 90.0% | 90.0% | 90.0% | 97.3% | 93.9% | **92.7%** | 985h |
| **BE3** | BACKEND 3 — Semi-Senior DBA / AWS / ETL /  | 95.9% | 98.5% | 95.6% | 90.9% | 95.9% | 93.4% | **95.0%** | 1009h |
| **FE1** | FRONTEND 1 — Interfaces (mes 1 al 6) | 90.0% | 98.7% | 99.6% | 100.0% | 100.0% | 99.9% | **98.0%** | 1042h |
| **FE2** | FRONTEND 2 — UX y Soporte (desde mes 2) | — | 90.0% | 90.8% | 100.0% | 94.0% | 97.5% | **94.5%** | 836h |
| **ARQ** | ARQ-Arquitecto TI / PMO | 99.7% | 94.3% | 90.0% | 95.2% | 100.0% | 99.8% | **96.5%** | 1026h |
| **SYS** | SYS-Infraestructura | — | 91.3% | 90.0% | 100.0% | 100.0% | 100.0% | **96.3%** | 852h |
| **QA** | QA-Calidad (desde mes 2) | — | 94.3% | 96.2% | 90.9% | 100.0% | 99.3% | **96.1%** | 850h |
| **IA** | IA-ML — Modelos e Inteligencia Artificial  | — | 99.0% | 96.3% | 97.5% | 99.9% | 97.0% | **97.9%** | 866h |
| **PAF** | Soporte PMO — Analista Funcional y Documen | 90.0% | 90.2% | 98.6% | 94.6% | 99.6% | 90.0% | **93.8%** | 997h |

---

## Tareas multi-recurso (muestra — lider + apoyos)

| ID | Tarea | Lider | Apoyos | Horas |
|----|-------|-------|--------|-------|
| QA-T04 | Gestión de bugs: triage, priorización y seguimiento | QA | PAF, ARQ | 76h |
| QA-004 | Revisión de código y estándares de calidad (continuo) | BE2 | BE1, QA | 57h |
| PAF-012 | Coordinacion de reuniones ejecutivas y seguimiento de action items ger | BE2 | PAF, ARQ | 56h |
| QA-T02 | Testing de regresión continuo por sprint (quincenal) | QA | PAF | 52h |
| FE2-U03 | Mantenimiento continuo del Design System y componentes | FE2 | PAF, ARQ | 51h |
| P1-ALC-QA1 | Suite QA: offline, borradores, paste imagen, shortcuts, menu y ribbon  | QA | FE2, PAF | 51h |
| QA-T06 | Pruebas de accesibilidad WCAG 2.1 nivel AA | QA | FE2, PAF | 51h |
| ARQ-G01 | Revisión semanal de arquitectura con equipo técnico | ARQ | PAF | 50h |
| PAF-001 | Actualizacion semanal ClickUp: estados, responsables, fechas y depende | PAF | ARQ | 50h |
| PAF-002 | Coordinacion de reuniones: convocatorias, agendas, salas y recordatori | PAF | ARQ | 50h |
| FE2-U02 | Investigación UX continua: sesiones de usabilidad quincenal | FE2 | QA, FE1 | 48h |
| IA-M01 | Recopilar y preparar datos reales de la mina para entrenar los modelos | BE1 | ARQ, BE2 | 48h |
| QA-003 | Automatización de tests de regresión | QA | PAF | 48h |
| BE2-S01 | Auditoría de seguridad por sprint (revisión quincenal) | BE2 | PAF, QA | 47h |
| FE2-U14 | Material de capacitación para usuarios finales | FE2 | QA, PAF | 47h |
| PAF-003 | Actas, action items y seguimiento de acuerdos entre sprints | PAF | ARQ | 47h |
| RSK-003 | Revisión quincenal de riesgos con comité técnico | PAF | ARQ | 47h |
| QA-T03 | Verificación diaria de builds y smoke testing | QA | PAF, FE1 | 46h |
| ARQ-G09 | Mentoring técnico y transferencia de conocimiento al equipo | ARQ | IA, PAF | 45h |
| ARQ-G04 | Gestión de stakeholders y comunicación ejecutiva | PAF | ARQ, IA | 40h |
| BE3-I04 | Agregación centralizada de logs (ELK/Loki) | BE1 | BE3, SYS | 40h |
| P1-ALC-A1 | Motor offline informe tecnico: BD local en terminal y cola de sincroni | BE3 | BE1, IA | 40h |
| P1-M4-034 | IA: Detectar automaticamente si los trabajadores usan casco y chaleco  | BE2 | IA, BE3 | 40h |
| P2-M6-004 | Pruebas UAT con usuarios de operaciones mineras | QA | FE2, ARQ | 40h |
| PAF-004 | Correos de seguimiento a equipo y gerencia (avance, riesgos, bloqueos) | PAF | IA, ARQ | 40h |
| … | *(15 tareas multi-recurso adicionales en Excel)* | | | |

---

## Validación PMO

- **Estado:** LISTO PARA IMPORTAR ClickUp (v19)
- **Tareas:** 422 técnicas + 60 indicadores CAP = 482 filas import
- **Carga >100% mensual:** 0 casos
- **Fechas asignadas:** 422/422
- **Violaciones dependencias:** 0
- **Paridad FE↔BE:** 45 correspondencias verificadas
- **Promedio equipo (meses activos):** 95.3%
- *Aviso:* Recursos sobre objetivo 95%: [('FE1', 1041.7), ('ARQ', 1026.2), ('SYS', 852.2)]

## Regeneración

```powershell
python scripts/generate_clickup_import.py
python scripts/generate_reportes_mensuales_y_convocatorias.py
python scripts/generate_documento_gerencia_recursos.py
```
