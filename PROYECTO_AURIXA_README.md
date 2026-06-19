# 🛰️ PROYECTO AURIXA — Plataforma Integral de Telemetría y Automatización Minera IA

> **Índice maestro único del proyecto.** Fuente de verdad para alcance, metodología, cronograma y documentación.
> Generado / mantenido como parte de la reorganización documental. Última actualización estructural: 2026-06-17.

---

## 1. Identidad del proyecto

| Campo | Detalle |
|---|---|
| **Nombre** | AURIXA — Plataforma Integral para Monitoreo, Trazabilidad y Gestión Operativa Minera |
| **SOW vigente** | `docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.docx` · `docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` (v3.0, sincronizado con Plan v36) |
| **Arquitectura** | Soberana sobre VPS Linux en Lima · baja latencia (<20 ms) · soberanía de datos |
| **Duración** | 26 semanas / 6 meses (1 jun – 30 nov 2026) |
| **Metodología** | **Híbrida Clásica (PMO/gates) + Scrum (sprints quincenales)** |
| **Equipo** | 10 recursos: 3 Backend, 2 Frontend, ARQ, SYS, QA, IA, PAF/PMO |

## 2. Objetivos medibles (KPIs del SOW)

| # | Objetivo | Meta | Validación |
|---|---|---|---|
| O1 | Rapidez de pantalla | < 20 ms | S9, S11 |
| O2 | Auto-guardado seguro | < 0.5 s | S4 |
| O3 | Generación de reportes | < 5 s | S7 |
| O4 | Capacidad de monitoreo | 10,000 sensores simultáneos | S6 (sim) · S12 (estrés) |
| O5 | Estabilidad | > 99.9% uptime | S10 · S13 |
| O6 | IA local | < 1 s por párrafo | S6, S11 |
| O7 | Trazabilidad / auditoría | 100% acciones auditadas | S4, S8 |

> Detalle completo + SLA + **trazabilidad alcance→sprint→release→gate** en
> `docs/01_Planificacion/Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx` (hojas `12_KPIs_SLA_SOW` y `13_Trazabilidad_SOW`).

## 3. Etapas y metodología híbrida

| Etapa | Cobertura | Sprints | Releases | Foco |
|---|---|---|---|---|
| **Etapa 1 — Core funcional** | Sem 1–16 (Jun–Sep) | S1–S8 | R1, R2, R3, R4 | Editor, motor central, GIS, sensores, IA base, offline |
| **Etapa 2 — Hardening + Go-Live** | Sem 17–26 (Oct–Nov) | S9–S13 | R5, R6 | Seguridad, DR, estrés 10k, IA avanzada, UAT, producción |

**Gates PM (puertas de control gerencial):** R1→S2 · R2→S4 · R3→S6 · R4→S8 (fin Etapa 1) · R5→S11 · R6→S13 (Go-Live / fin proyecto).

## 4. Documentación — mapa de carpetas

| Carpeta | Contenido |
|---|---|
| `docs/00_SOW/` | SOW maestro vigente y guía de exposición |
| `docs/01_Planificacion/` | **Planes v36 (etapas/sprints)**, Cronograma Maestro, Cronograma VPS Lima, Resumen Ejecutivo y Matriz de Costos (1 versión vigente de cada uno) |
| `docs/02_Arquitectura/` | **Arquitectura_Solucion_AURIXA_v36** (estado actual + cambios) y **Arquitectura_Objetivo_Capas_AURIXA_v36** (target por capas + ML predictivo); BD/diagramas/PlantUML, backend, datacenter Lima. Topología objetivo en `docker-compose.scale.yml` (raíz) |
| `docs/03_Gerencia_Informes/` | Distribución de recursos v36, reportes mensuales, memos ejecutivos |
| `docs/04_Convocatorias_RRHH/` | Convocatorias AURIXA + CVs de candidatos (`cv/`) |
| `docs/05_RFQ_Infraestructura/` | RFQ datacenter (Cirion, Claro, GTD, Equinix, WIN), shortlist, comparativas |
| `docs/06_Presentaciones/` | PPTX ejecutivos, speeches, guion de video, `Presentacion_Socrates/` |
| `docs/07_Riesgos_Portafolio/` | Anexos de riesgos, evaluación técnica, scoring, roadmap, propuesta |
| `docs/08_Tareas_ClickUp/` | Import ClickUp v19 vigente, tareas SYS Etapa 1 |
| `docs/09_Manuales_Operativos/` | Manuales de uso (registro, login, informes, mantenimiento) |
| `docs/_archivo/` | Versiones obsoletas (v35, planes previos) — **conservadas, no borradas** |
| `soporte_mantenimiento/scripts_python/` | Scripts utilitarios `.py` (generadores de documentos) |
| `soporte_mantenimiento/scripts_devops/` | Scripts `.ps1` de despliegue |
| `branding/` | Variantes de logo AURIXA (SVG) |
| `_archivo/` | Excels/CSV ClickUp obsoletos de la raíz |

> **Código vivo de la app** (no documentación): `backend/`, `frontend/`, `ai_engine/`,
> `formula_engine/`, `scripts/`, `db_scripts/`, `docker-compose*.yml`, `dashboard.sql`. **No reorganizado.**

## 5. Paneles de navegación rápida

| Archivo | Para qué |
|---|---|
| **`PANEL_PROYECTO.html`** | Explorador visual de toda la documentación, con buscador y filtros por tipo (MD · PY · DOCX · XLSX · PDF · PPTX · HTML). Abrir con doble clic. |
| **`PANEL_SCRIPTS.hta`** | Panel Windows que lista los scripts `.py` y permite **ejecutarlos con doble clic** (botón ▶). |
| **`API_AURIXA.html`** | Documentación navegable de las **81 APIs** (backend C++, formula, ai) con buscador y filtros por servicio/método — para compartir con el equipo. |

**Regenerar los paneles** tras cambios en la documentación:
```
.venv\Scripts\python.exe soporte_mantenimiento\scripts_python\generar_paneles.py
```

## 6. Criterios de aceptación (resumen SOW)

Cada hito se aprueba con: (1) entregable presentado formalmente, (2) evidencia técnica/funcional, (3) validación contra el objetivo del hito, (4) observaciones clasificadas y tratadas, (5) conformidad expresa o tácita en la ventana de revisión (5 días hábiles).
