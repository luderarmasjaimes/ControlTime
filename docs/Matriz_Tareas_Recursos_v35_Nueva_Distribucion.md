# Matriz de Tareas y Carga Laboral — Nueva Distribución v35
## Proyecto AURIXA · 6 meses · Meta: 90–100% en meses activos

**Fecha:** Mayo 2026  
**Fuente de verdad:** `scripts/generate_clickup_import.py` → `Plataforma_Minera_ClickUp_v17.xlsx`  
**Modelo de capacidad:** 8,5 h/día × días netos Perú 2026 (feriados excluidos). Tope **100%** mensual.

---

## 1. Resumen ejecutivo

Se actualizó el cronograma con:

1. **Nuevos alcances A–G** del informe técnico avanzado (offline, borradores, paste imagen, shortcuts, menú, ribbon hide, sidebars icon-only).
2. **FE1 activo desde mes 1** como único frontend en junio.
3. **PAF** consolidado como rol de soporte PMO/documentación/capacitación (reemplaza DOC en cronogramas anteriores).
4. **BE1** como perfil unificado Backend + DBA / Arquitecto de Datos.
5. **Carga 90–100%** en todos los **meses activos** de cada recurso (ver tabla §3).

---

## 2. Nuevos alcances — Tareas incorporadas

| ID | Alcance | Tarea principal | Responsables | Semanas |
|----|---------|-----------------|--------------|---------|
| **A** | Offline informe técnico | P1-ALC-A1 Motor BD local + cola sync | BE1, BE3 | S9–S11 |
| **A** | Offline UI | P1-ALC-A2 Edición local + reconciliación | FE1, FE2 | S9–S12 |
| **B** | Borradores múltiples UI | P1-ALC-B1 Workspace 1..N borradores | FE1 | S8–S10 |
| **B** | Borradores API | P1-ALC-B2 CRUD borradores backend | BE1 | S8–S10 |
| **B** | Manual borradores | P1-ALC-B3 Procedimiento operativo | PAF, FE1 | S9–S11 |
| **C** | Paste imagen web/WhatsApp | P1-ALC-C1 Clipboard al canvas TipTap | FE1 | S10–S12 |
| **C** | Pipeline imágenes | P1-ALC-C2 Upload/sanitización backend | BE3 | S10–S12 |
| **D** | Teclas rápidas | P1-ALC-D1 Sistema shortcuts Ctrl+/ | FE1 | S9–S11 |
| **E** | Menú optimizado | P1-ALC-E1 -40% clics flujos top-10 | FE1, FE2 | S10–S13 |
| **F** | Ribbon auto-hide | P1-ALC-F1 Ocultar barra superior interna | FE1 | S8–S10 |
| **G** | Sidebars icon-only | P1-ALC-G1 Paneles laterales colapsados | FE1, FE2 | S9–S12 |
| — | QA alcances A–G | P1-ALC-QA1 Suite funcional offline/UX | QA, FE2 | S12–S14 |
| — | Infra offline-sync | P2-ALC-SYS1 Cache edge + monitoreo colas | SYS | S18–S20 |
| — | IA imágenes pegadas | P2-ALC-IA1 Auto-tag metadata imágenes | IA, BE3 | S18–S20 |
| — | FE1 mes 1 | P1-ALC-FE1-M1 Setup React/Vite + shell ReportStudio | FE1, BE1 | S1–S4 |
| — | Capacitación A–G | PAF-011 Talleres offline/borradores/shortcuts | PAF, FE1 | S18–S24 |

---

## 3. Carga mensual por recurso (% meses activos)

> **Nota metodológica:** FE2, QA, IA y SYS **no tienen asignación en junio (mes 1)** por diseño del proyecto. Su promedio aritmético 6M aparece menor, pero **todos los meses activos cumplen 90–100%**.

| Recurso | Rol | Jun | Jul | Ago | Sep | Oct | Nov | Prom. 6M* |
|---------|-----|-----|-----|-----|-----|-----|-----|-----------|
| **BE1** | Backend + DBA Core | 99,7% | 100% | 99,3% | 90,0% | 90,2% | 90,0% | 94,9% |
| **BE2** | Ciberseguridad Backend | 90,0% | 90,0% | 90,0% | 96,1% | 92,1% | 90,0% | 91,4% |
| **BE3** | Integraciones | 90,0% | 98,9% | 91,6% | 93,1% | 98,1% | 90,0% | 93,6% |
| **FE1** | Frontend Senior (mes 1–6) | **90,0%** | 99,1% | 98,3% | 99,2% | 100% | 97,8% | 97,4% |
| **FE2** | UX y Soporte (desde mes 2) | — | 90,0% | 90,6% | 90,0% | 90,0% | 93,9% | 75,8%* |
| **ARQ** | Arquitecto / PM | 90%+ | 90%+ | 90%+ | 90%+ | 90%+ | 90%+ | 93,6% |
| **SYS** | Infraestructura (desde mes 2) | — | 92,1% | 90,0% | 100% | 99,6% | 100% | 80,3%* |
| **QA** | Calidad (desde mes 2) | — | 94,3% | 92,1% | 91,4% | 100% | 99,9% | 79,6%* |
| **IA** | ML/IA (desde mes 2) | — | 90,9% | 90,0% | 90,0% | 99,1% | 90,0% | 76,7%* |
| **PAF** | Soporte PMO / Documentación | 90,0% | 93,6% | 96,9% | 90,0% | 96,0% | 90,0% | 92,8% |

\* Promedio 6 meses incluye junio en 0% para recursos que inician en mes 2.

**Validación:** Ningún recurso supera **100%** en ningún mes calendario.

---

## 4. Distribución de tareas por recurso y fase

### BE1 — Backend + Base de Datos (convocatoria doc. 1)

| Mes | Foco principal | Tareas clave |
|-----|----------------|--------------|
| 1 | ERD, multi-tenant, contratos API con FE1 | P1-M1-007/008/009, P1-ALC-FE1-M1 |
| 2 | WebSocket, autosave, libpqxx | P1-M2-003/007/008/012 |
| 3 | Motor documental, JSONB, versionado | P1-M3-001/008, P1-ALC-B2 |
| 4 | Comentarios, cache Redis, integración e2e | P1-M4-020/023/007, P1-ALC-A1 |
| 5 | Performance tuning, Kafka bridge | P2-M5-*, P2-ALC-SYS1 (coordinación) |
| 6 | Go-live, estabilización | P2-M6-*, marcha blanca |

### FE1 — Frontend Senior (convocatoria doc. 2, mes 1–6)

| Mes | Foco principal | Tareas clave |
|-----|----------------|--------------|
| **1** | **Único FE activo:** Vite, routing, shell ReportStudio | P1-ALC-FE1-M1, P1-M1-003/005 |
| 2 | Auth, design system, TipTap base | P1-M2-001/014, P1-M3-007 |
| 3 | Editor core, GIS base, borradores UI | P1-ALC-B1, P1-ALC-F1, P1-ALC-D1 |
| 4 | Offline UI, paste imagen, shortcuts, menú | P1-ALC-A2/C1/D1/E1/G1 |
| 5 | Dashboard KPIs, streaming, ajustes UAT | P1-M4-012/015, FE2-U* |
| 6 | Estabilización UX, soporte marcha blanca | P2-M6-*, PAF-011 capacitación |

### PAF — Soporte Funcional (convocatoria doc. 2)

| Mes | Foco principal | Tareas clave |
|-----|----------------|--------------|
| 1–2 | ClickUp, actas, kick-off, BRD/SOW soporte | PAF-001/002/003/004/005 |
| 3–4 | Manuales funcionales, trazabilidad FE↔BE | PAF-006/007, P1-ALC-B3 |
| 5 | UAT soporte, dashboard gerencia, capacitación | PAF-008/009/011/012 |
| 6 | Kit cierre, lecciones aprendidas, handover | PAF-010 |

### FE2 — UX y Soporte (desde mes 2)

- Paneles retráctiles, alarmas UI, offline UX (P1-ALC-A2, P1-M4-018).
- Sidebars icon-only, menú optimizado (P1-ALC-E1/G1).
- QA alcances A–G, UAT campo, NPS post go-live (P1-ALC-QA1, FE2-U15/17).

### BE2 — Ciberseguridad

- JWT/RBAC, OWASP, audit log, firma digital, rate limiter.
- Apoyo QA pentest (P1-LOAD-QA-03).

### BE3 — Integraciones

- SMTP, webhooks, offline conflict resolution (P1-ALC-A1, P1-M4-028).
- Pipeline imágenes externas (P1-ALC-C2).

### SYS — Infraestructura (desde mes 2)

- Docker staging, Prometheus/Grafana, Nginx cache (P1-LOAD-SYS-*).
- Infra offline-sync (P2-ALC-SYS1), DRP, CI/CD mes 5–6.

### QA — Calidad (desde mes 2)

- TQA01, regresión TipTap, suite A–G (P1-LOAD-QA-*, P1-ALC-QA1).
- Pentest, load test 10k sensores, UAT.

### IA — Inteligencia Artificial (desde mes 2)

- LanguageTool, Whisper STT, LLM local, biometría ONNX (P1-LOAD-IA-*).
- Clasificación imágenes pegadas (P2-ALC-IA1), EPP vision.

---

## 5. Correspondencia Frontend ↔ Backend (nuevos alcances)

| Funcionalidad | Frontend | Backend |
|---------------|----------|---------|
| Offline sync | FE1/FE2: IndexedDB + UI | BE1/BE3: cola ops + merge API |
| Borradores múltiples | FE1: bandeja UI | BE1: CRUD borradores |
| Paste imagen | FE1: clipboard handler | BE3: upload pipeline |
| Shortcuts | FE1: hotkey manager | — |
| Menú optimizado | FE1/FE2: favoritos/breadcrumbs | — |
| Ribbon hide | FE1: layout context | — |
| Sidebars icon-only | FE1/FE2: collapsible panels | — |
| Manual operativo | PAF: documentación | BE1/FE1: validación |

---

## 6. Documentos generados

| Documento | Contenido |
|-----------|-----------|
| `docs/Convocatoria_Laboral_01_Backend_Base_Datos_AURIXA.md` | Convocatoria BE1/DBA |
| `docs/Convocatoria_Laboral_02_Frontend_PAF_AURIXA.md` | Convocatorias FE1 + PAF |
| `Plataforma_Minera_ClickUp_v17.xlsx` | 414+ tareas, hoja `Carga_Mensual_Recursos` |
| `scripts/generate_clickup_import.py` | Generador maestro (regenerar con `python scripts/generate_clickup_import.py`) |

---

## 7. Próximos pasos recomendados

1. Publicar convocatorias tras reemplazar contacto de postulación.
2. Importar Excel actualizado a ClickUp.
3. Validar con ARQ que FE2/QA/IA/SYS sin carga en junio es aceptable para gerencia.
4. Ejecutar kick-off mes 1 con FE1 + BE1 + PAF como tridente de arranque.

---

*Matriz v35 — Plataforma minera enterprise LATAM. Generado mayo 2026.*
