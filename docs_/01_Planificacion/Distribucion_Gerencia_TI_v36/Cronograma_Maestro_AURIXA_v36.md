# Cronograma Maestro — Proyecto AURIXA

## Plataforma Integral de Telemetría y Automatización Minera con IA

**Versión:** v36.1 — sincronizada con el SOW Maestro v3.0 (SOW_Maestro_AURIXA_2026_v4); incorpora la arquitectura de datos v36.1 (sección 7)
**Calendario:** 1 de junio – 30 de noviembre de 2026 (6 meses / 26 semanas)
**Metodología:** Híbrida — Clásica (PMO + gates) + Scrum (sprints quincenales)
**Fuente operativa:** `Plan_Detallado_Etapas_1_y_2_v36.xlsx` (tareas) y `Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx` (sprints, gates y recursos)

> Este documento es la vista legible del cronograma. Los dos Excel v36 son la fuente operativa y de importación a ClickUp.

---

## 1. Estructura general

| Etapa | Cobertura | Sprints | Releases | Foco |
|---|---|---|---|---|
| **Etapa 1 — Core funcional** | Jun–Sep 2026 (sem 1–16) | S1–S8 | R1, R2, R3, R4 | Editor, motor central, GIS, sensores, IA base, offline |
| **Etapa 2 — Hardening + Go-Live** | Oct–Nov 2026 (sem 17–26) | S9–S13 | R5, R6 | Seguridad, DR, estrés 10k, IA avanzada, UAT, producción |

El cronograma no es una lista plana de actividades: es una secuencia ejecutable gobernada por **gates de release**. Cada etapa entrega valor verificable y habilita formalmente la siguiente.

---

## 2. Cronograma de 13 sprints

| Sprint | Fechas | Release | Objetivo | Demo de cierre (Sprint Review) |
|---|---|---|---|---|
| S1 | 01–12 jun | R1 | Arranque y alcance acordado | Presentación ejecutiva de alcance e hitos |
| S2 | 15–26 jun | R1 | Base técnica y diseño de datos | Shell ReportStudio + diagrama de datos |
| S3 | 29 jun–10 jul | R2 | Motor del servidor y acceso seguro | Login + recepción de sensores en vivo |
| S4 | 13–24 jul | R2 | Permisos, guardado y telemetría base | Perfiles diferenciados + auto-guardado |
| S5 | 27 jul–07 ago | R3 | Editor de informes y mapa minero | Informe con formato + ubicación en mapa |
| S6 | 10–21 ago | R3 | Sensores, voz e IA base | Dashboard de 10k sensores + dictado |
| S7 | 24 ago–04 sep | R4 | Exportación e integraciones | Informe PDF + panel gerencial |
| S8 | 07–18 sep | R4 | Modo offline y validación integral E1 | Editar sin internet, reconectar y sincronizar |
| S9 | 21 sep–02 oct | R5 | Rendimiento y seguridad aplicativa | Informe de rendimiento + pentest |
| S10 | 05–16 oct | R5 | Continuidad y recuperación (DR) | Simulacro de recuperación + monitoreo |
| S11 | 19–30 oct | R5 | Optimización final pre-UAT | Comparativa de rendimiento + matriz de cierre |
| S12 | 02–13 nov | R6 | Estrés, UAT y marcha blanca | UAT en campo + prueba 10k + marcha blanca |
| S13 | 16–27 nov | R6 | Go-Live y transferencia | Sistema en producción + acta Go-Live |

---

## 3. Releases y gates PM (puertas de control gerencial)

| Release | Etapa | Sprint cierre | Fecha gate | Criterio de aprobación | Aprueba | Evidencia |
|---|---|---|---|---|---|---|
| R1 | Etapa 1 | S2 | 2026-06-30 | Diseño y arquitectura aprobados | ARQ | Acta gate + demo shell + esquema BD |
| R2 | Etapa 1 | S4 | 2026-07-31 | Motor operacional + seguridad base | ARQ | Demo telemetría + RBAC + VPS dev |
| R3 | Etapa 1 | S6 | 2026-08-31 | Editor + sensores + IA base | ARQ | Demo editor + mapa + sensores en vivo |
| R4 | Etapa 1 | S8 | 2026-09-30 | Sistema integrado e2e — FIN ETAPA 1 | Gerencia + ARQ | Demo offline + informe QA Etapa 1 |
| R5 | Etapa 2 | S11 | 2026-10-31 | Hardening + DR + optimización | ARQ + Gerencia TI | Pentest + simulacro DR + carga |
| R6 | Etapa 2 | S13 | 2026-11-30 | Go-Live producción — FIN PROYECTO | Gerencia General | Acta Go-Live + handover + kit documental |

---

## 4. Enfoque mensual

| Mes | Sprints | Enfoque principal |
|---|---|---|
| Junio | S1–S2 | Planificación, arquitectura, diseño de datos, shell base |
| Julio | S3–S4 | Motor central, accesos seguros, telemetría, VPS desarrollo |
| Agosto | S5–S6 | Editor, mapas, sensores, IA base, dictado por voz |
| Septiembre | S7–S8 | Exportación, integraciones, modo offline, QA del core |
| Octubre | S9–S11 | Hardening, DR, optimización, preparación de UAT |
| Noviembre | S12–S13 | Estrés 10k, UAT, marcha blanca, Go-Live y transferencia |

---

## 5. KPIs medibles (validación por sprint)

| Código | Objetivo | Meta | Validación |
|---|---|---|---|
| O1 | Rapidez de pantalla | < 20 ms | S9, S11 |
| O2 | Auto-guardado | < 0.5 s | S4 |
| O3 | Generación de reportes | < 5 s | S7 |
| O4 | Capacidad de monitoreo | 10,000 sensores | S6 (sim), S12 (estrés) |
| O5 | Estabilidad | > 99.9% uptime | S10, S13 |
| O6 | IA local | < 1 s por párrafo | S6, S11 |
| O7 | Trazabilidad | 100% acciones auditadas | S4, S8 |

---

## 6. Criterios de defensa del cronograma (lectura gerencial)

1. **Por qué 26 semanas y no menos:** el programa incluye no solo construcción, sino estabilización, UAT, marcha blanca y transferencia formal. Comprimir el calendario aumenta el riesgo de retrabajo en salida a producción.
2. **Por qué 2 etapas:** gerencia lee el programa en bloques de valor (4+2 meses). La Etapa 1 entrega núcleo funcional con valor temprano; la Etapa 2 concentra seguridad, continuidad y salida.
3. **Por qué gates de release:** el avance se aprueba con evidencia, no por percepción. Un gate no superado detiene el avance y evita el descontrol de alcance.
4. **Ocupación del equipo:** la carga se distribuyó al 90–100% en meses activos según camino crítico y dependencias, protegiendo la productividad real (ver `Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx`, hoja Carga de Recursos).

---

## 7. Arquitectura de datos v36.1 (adelanto técnico incorporado al alcance)

Respecto a v36, el equipo **adelantó la construcción de la capa de plataforma de datos** que sostiene los objetivos de capacidad (O4), rendimiento (O3) y disponibilidad (O5). Estos componentes ya existen en código y se distribuyen en los sprints donde corresponde validarlos.

| Componente | Función | Sprint de validación | Evidencia |
|---|---|---|---|
| Pipeline de ingesta de alta tasa (`TelemetryIngestor`, C++) | Caché de sensores + cola acotada + escritura por lotes con `COPY` | S3–S4, S6 | `backend/src/mining/telemetry_ingest.{hpp,cpp}` |
| Cola durable Kafka (Redpanda) | Ingesta durable con commit por lote → SLA *Zero Data Loss* | S4, S12 | `docker-compose.yml` (`redpanda`) |
| Réplica de lectura (streaming replication) | Dashboards/reportes/KPIs en vivo leen de la réplica; primario solo escribe | S6, S9–S10 | `docker-compose.yml` (`db_replica`), SSE `/api/live/kpi` |
| PgBouncer (transaction pooling) | ~10k clientes / ~200 conexiones reales | S4, S9 | `docker-compose.yml` (`pgbouncer`) |
| TimescaleDB: chunks 6h + compresión columnar | Mayor velocidad de ingesta y menos disco | S6 | `db_scripts/64_telemetry_ingest_optimization.sql` |
| Tier frío MinIO/S3 (Parquet ZSTD) | Datos > 1 año archivados y consultables fuera del disco caliente | S10 | `scripts/archive_cold_tier.sh`, `docker-compose.yml` (`minio`) |
| Observabilidad de ingesta (`/api/metrics`) | Métricas Prometheus: recibidas/insertadas/descartadas, cola, commits, pool | S4, S9–S13 | `backend/src/main.cpp` (`handleMetrics`) |

**Lectura gerencial:** los riesgos técnicos de mayor impacto (ingesta de 10k sensores sin pérdida, disponibilidad y escalamiento de conexiones) quedan **mitigados por diseño** antes de los gates R2–R5. El detalle por sprint, entregables y pedido de aprobación está en `Resumen_Sprints_Entregables_Gerencia_TI_v36.md`.
