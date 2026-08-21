# Paquete de distribución — Sustentación a Gerencia de TI · AURIXA v36.1

**Proyecto:** AURIXA — Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA
**Versión:** v36.1 (sincronizada con SOW Maestro v3.0 y planes v36)
**Calendario:** 1 jun – 30 nov 2026 · 13 sprints · 6 gates · 2 etapas · 10 recursos
**Fecha de corte:** 23 de junio de 2026 (Sprint S2)
**Preparado por:** Arquitectura TI / PMO (ARQ)

---

## Cómo usar este paquete

| Si necesitas… | Abre |
|---|---|
| **Exponer ante la Gerencia de TI** | `Sustentacion_Gerencia_TI_AURIXA_v36.pdf` (o `.pptx` para editar) |
| **Circular / firmar la aprobación** | `Resumen_Sprints_Entregables_Gerencia_TI_v36.pdf` (o `.docx`) |
| **Revisar con el máximo detalle** | `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` |
| **Auditar tareas, dependencias y carga** | `Plan_Detallado_Etapas_1_y_2_v36.xlsx` |
| **Revisar sprints, gates, riesgos y KPIs** | `Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx` |
| **Ver costos** | `Matriz_Costos_Cronograma_26_Semanas.md` |

---

## Contenido del paquete

### Presentación (exposición)
- **`Sustentacion_Gerencia_TI_AURIXA_v36.pptx`** — deck de 14 diapositivas para proyectar.
- **`Sustentacion_Gerencia_TI_AURIXA_v36.pdf`** — el mismo deck en PDF (distribución).

### Documento resumen
- **`Resumen_Sprints_Entregables_Gerencia_TI_v36.docx`** — Word formal con portada y 11 tablas.
- **`Resumen_Sprints_Entregables_Gerencia_TI_v36.pdf`** — versión PDF para circular.
- **`Resumen_Sprints_Entregables_Gerencia_TI_v36.md`** — versión Markdown (la más detallada).

### Planes fuente (Excel)
- **`Plan_Detallado_Etapas_1_y_2_v36.xlsx`** — 425 tareas; hoja nueva **`v36_1_Arq_Datos`**.
- **`Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx`** — sprints/gates/riesgos/KPIs; hoja nueva **`14_Arquitectura_Datos_v36_1`**.

### Soporte
- `Cronograma_Maestro_AURIXA_v36.md`, `Resumen_Ejecutivo_Proyecto_AURIXA.md`, `Matriz_Costos_Cronograma_26_Semanas.md`.

---

## Qué cambió en v36.1 (mensaje central de la sustentación)

Se incorpora al alcance la **arquitectura de datos v36.1**, ya construida en código, que fortalece O3/O4/O5 y el SLA *Zero Data Loss* **sin costo ni plazo adicional**:

| Componente | Función | Sprint de validación |
|---|---|---|
| Pipeline de ingesta de alta tasa (C++, `COPY` por lote) | 10.000 sensores sin caídas ni pérdida | S3–S6 |
| Cola durable Redpanda (Kafka) | Commit por lote → cero pérdida de telemetría | S4 · S12 |
| Réplica de lectura (streaming replication) | Dashboards/KPIs leen de la réplica; primario solo escribe | S6 · S9–S10 |
| PgBouncer (transaction pooling) | ~10k clientes con ~200 conexiones reales | S4 · S9 |
| TimescaleDB chunks 6h + compresión columnar | Más velocidad de ingesta, menos disco | S6 |
| Tier frío MinIO/S3 (Parquet ZSTD) | Datos > 1 año fuera del disco caliente | S10 |
| Observabilidad `/api/metrics` | Probar el SLA con datos, no con opiniones | S4 · S9–S13 |

**Efecto en riesgos:** los riesgos nuevos R-E1-09 (pérdida de telemetría), R-E1-10 (agotamiento de conexiones) y R-E2-08 (costo de almacenamiento) quedan **mitigados por diseño**; R-E2-02 (DR) y R-E2-03 (carga 10k) quedan **atenuados**.

---

## Decisión solicitada hoy

1. Ratificar el plan de 13 sprints y 6 gates (R1–R6).
2. Aprobar el **Gate R1** (cierre Mes 1): diseño de datos y arquitectura objetivo.
3. Incorporar al alcance la **arquitectura de datos v36.1** (sin costo ni plazo adicional).
4. Confirmar a la Gerencia de TI como aprobador de los gates **R5 y R6**.

> **Recomendación de Arquitectura (ARQ):** los componentes técnicos de mayor riesgo ya están construidos. Se recomienda aprobar el avance.
