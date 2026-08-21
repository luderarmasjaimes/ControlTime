# Resumen de Sprints y Entregables por Etapa — Exposición a Gerencia de TI

## Proyecto AURIXA · Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Documento:** Resumen ejecutivo de sprints y entregables para aprobación gerencial
**Versión:** v36.1 (sincronizado con SOW Maestro v3.0 y los planes `Plan_Detallado_Etapas_1_y_2_v36.xlsx` / `Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx`)
**Calendario:** 1 de junio – 30 de noviembre de 2026 (6 meses · 26 semanas · 13 sprints)
**Fecha de corte de este informe:** 23 de junio de 2026 (en Sprint S2)
**Audiencia:** Gerencia de TI (aprobación de continuidad y gates de release)
**Preparado por:** Arquitectura TI / PMO (ARQ)

> **Propósito de la exposición.** Presentar, sin ambigüedad, *qué entrega cada sprint*, *qué se demuestra a Gerencia*, *qué puerta de control (gate) habilita el avance* y *qué riesgos se gestionan*. La novedad de esta versión v36.1 es que **los componentes técnicos más riesgosos del proyecto ya fueron construidos y validados a nivel de arquitectura por adelantado** (ingesta durable de 10K sensores, alta disponibilidad, escalamiento de conexiones y ciclo de vida de datos). Esto **reduce materialmente el riesgo de ejecución** de los gates R2 a R5.

---

## 1. Lectura ejecutiva en una página

| Dimensión | Estado v36.1 |
|---|---|
| **Etapas** | 2 — Etapa 1 *Core funcional* (Jun–Sep) · Etapa 2 *Hardening + Go-Live* (Oct–Nov) |
| **Sprints** | 13 quincenales (S1–S13), cada uno con demo de cierre (Sprint Review) |
| **Releases / Gates** | 6 puertas de control gerencial (R1–R6), cada una con criterio y evidencia |
| **Equipo** | 10 recursos especializados, carga validada 90–100% en meses activos |
| **Tareas** | 422 tareas planificadas · 0 violaciones de dependencias · 0 sobrecarga >100% |
| **Inversión** | USD 214,781.20 (RR.HH. + cargas + equipamiento + contingencia 12% + reserva 5%) |
| **Infraestructura** | VPS Linux soberano en Lima (no AWS); AWS solo como fuente externa de datos |
| **Adelanto técnico v36.1** | Pipeline de ingesta durable, réplica de lectura (HA), pooling de conexiones, compresión columnar y tier frío **ya implementados en código** |

**Pedido de aprobación a Gerencia de TI:** ratificar el plan de 13 sprints / 6 gates, aprobar el **Gate R1** (cierre de Mes 1: arquitectura y diseño de datos) e **incorporar formalmente al alcance la arquitectura de datos v36.1** descrita en la Sección 4, que fortalece los objetivos O3, O4 y O5 sin alterar plazo ni costo.

---

## 2. Por qué este plan da confianza (criterios de defensa)

1. **Avance por evidencia, no por percepción.** Cada release (R1–R6) es una *puerta*: si el criterio no se cumple con evidencia (demo + acta + métricas), el avance se detiene. Esto evita el descontrol de alcance.
2. **Valor temprano.** La Etapa 1 (4 meses) entrega un sistema funcional completo (login seguro, editor, mapas, sensores, IA base, offline). La Etapa 2 (2 meses) concentra seguridad, continuidad y salida a producción.
3. **Riesgo técnico adelantado.** Lo más difícil de un sistema de telemetría minera —ingerir 10.000 sensores sin perder datos, sostener disponibilidad y no colapsar la base— **ya está resuelto a nivel de arquitectura y código** (Sección 4). El equipo no está apostando a construirlo bajo presión en S6/S12.
4. **Soberanía de datos.** Todo corre sobre VPS en Lima. Al cierre (S13) se transfieren llaves maestras, runbooks y documentación a la Gerencia de TI del cliente.
5. **Trazabilidad 100%.** Cada entregable del SOW está mapeado a sprint → release → gate (Sección 8).

---

## 3. Mapa de las dos etapas

| Etapa | Cobertura | Sprints | Releases | Foco | Cierre |
|---|---|---|---|---|---|
| **Etapa 1 — Core funcional** | Jun–Sep 2026 (sem 1–16) | S1–S8 | R1, R2, R3, R4 | Editor, motor central, GIS, sensores, IA base, offline, integración AWS | **R4 (30 sep):** sistema integrado e2e |
| **Etapa 2 — Hardening + Go-Live** | Oct–Nov 2026 (sem 17–26) | S9–S13 | R5, R6 | Rendimiento, seguridad, DR, estrés 10k, UAT, marcha blanca | **R6 (30 nov):** Go-Live producción |

```
Jun        Jul        Ago        Sep        | Oct        Nov
S1  S2  |  S3  S4  |  S5  S6  |  S7  S8     | S9 S10 S11 | S12  S13
└─ R1 ─┘   └─ R2 ─┘   └─ R3 ─┘   └─ R4 ─┘   └──── R5 ───┘  └─ R6 ─┘
ETAPA 1 — CORE FUNCIONAL (valor temprano)   | ETAPA 2 — HARDENING + GO-LIVE
```

---

## 4. Adelanto de arquitectura v36.1 — la capa de plataforma de datos (NUEVO)

Esta es la actualización central respecto al plan v36. El equipo **ya construyó la columna vertebral de datos** que sostiene los objetivos de capacidad (O4), rendimiento (O3) y disponibilidad (O5). Se incorpora formalmente al alcance y se distribuye en los sprints donde corresponde validarla.

### 4.1 Componentes incorporados

| # | Componente | Qué resuelve (lenguaje gerencial) | Evidencia en código |
|---|---|---|---|
| 1 | **Pipeline de ingesta de alta tasa** (`TelemetryIngestor`, C++) | Recibe 10.000 sensores, los valida contra una caché en memoria y los escribe a la base en lotes por el camino más rápido (`COPY`). No se cae ni pierde datos en ráfagas. | `backend/src/mining/telemetry_ingest.{hpp,cpp}` |
| 2 | **Cola durable Kafka (Redpanda)** | Si la base se ralentiza o reinicia, los datos de sensores **quedan en cola y se confirman (commit) por lote**: cero pérdida de telemetría. Habilita el SLA de *Zero Data Loss* del SOW. | `docker-compose.yml` (servicio `redpanda`), modo `TELEMETRY_INGEST_MODE=kafka` |
| 3 | **Réplica de lectura** (streaming replication) | Los dashboards, reportes y KPIs en vivo leen de una **copia espejo**; el servidor primario queda dedicado solo a escribir telemetría. Pantallas rápidas (O1/O3) aun bajo carga máxima. | `docker-compose.yml` (`db_replica`), `main.cpp` SSE `/api/live/kpi` lee de réplica |
| 4 | **Pooling de conexiones (PgBouncer)** | Permite ~**10.000 clientes** concurrentes usando solo ~200 conexiones reales a la base. Sin esto, 10k sensores agotarían la base. Sin cambios de código. | `docker-compose.yml` (`pgbouncer`, `POOL_MODE=transaction`, `MAX_CLIENT_CONN=10000`) |
| 5 | **Optimización TimescaleDB + compresión columnar** | Trozos de datos de 6 h, poda de índices que frenan la escritura y **compresión por sensor**: más velocidad de ingesta y menos disco. | `db_scripts/64_telemetry_ingest_optimization.sql` |
| 6 | **Tier frío en MinIO/S3 (ciclo de vida de datos)** | Los datos de **más de 1 año** se archivan automáticamente a almacenamiento de objetos en formato comprimido (Parquet ZSTD) y se liberan del disco caliente; siguen siendo consultables. Controla el costo de almacenamiento a largo plazo. | `scripts/archive_cold_tier.sh`, `docker-compose.yml` (`minio`) |
| 7 | **Observabilidad de ingesta** (`/api/metrics`) | Métricas Prometheus en vivo: filas recibidas/insertadas/descartadas, tamaño de cola, commits Kafka, estado del pool. Permite probar el SLA con datos, no con opiniones. | `backend/src/main.cpp` (`handleMetrics`) |
| 8 | **Modo Postgres productivo activado** (HAS_LIBPQ) | El backend ya **persiste de verdad** en PostgreSQL/TimescaleDB, no en memoria. | Commit `4d39c24`, tuning de `db` en `docker-compose.yml` |

### 4.2 Arquitectura objetivo (flujo de datos)

```
  10.000 sensores
        │  TLS (mining_gateway, 6 hilos)
        ▼
┌──────────────────────┐     produce      ┌──────────────┐
│  TelemetryIngestor   │ ───────────────▶ │   Redpanda    │  (cola durable Kafka)
│  caché + cola C++    │                  │  topic:       │
└──────────────────────┘ ◀─────────────── │  telemetry    │
        │  consume + COPY por lote          └──────────────┘
        ▼
┌──────────────────────┐   streaming repl.  ┌────────────────────┐
│  TimescaleDB PRIMARIO │ ─────────────────▶│  RÉPLICA DE LECTURA │
│  (solo escritura)     │                   │  dashboards/KPIs/   │
│  chunks 6h + compres. │                   │  reportes (SSE)     │
└──────────────────────┘                    └────────────────────┘
        │  > 1 año (DuckDB → Parquet ZSTD)
        ▼
┌──────────────────────┐
│  MinIO / S3 TIER FRÍO │  (drop_chunks en primario; consultable con DuckDB/Athena)
└──────────────────────┘

  ~10.000 clientes app ──▶ PgBouncer (transaction pooling) ──▶ ~200 conexiones reales ──▶ PRIMARIO
```

### 4.3 Impacto sobre los objetivos del SOW

| Objetivo SOW | Cómo lo refuerza v36.1 |
|---|---|
| **O3 — Reportes < 5 s** | Reportes leen de la réplica → no compiten con la ingesta. |
| **O4 — 10.000 sensores** | Ingesta `COPY` por lote + Redpanda + PgBouncer + chunks 6h + compresión. |
| **O5 — > 99.9% uptime** | Réplica de lectura (base para failover) + cola durable + observabilidad. |
| **SLA Zero Data Loss** | Cola Kafka con commit por lote: la telemetría sobrevive a reinicios de la base. |
| **Continuidad / DR (R5)** | Réplica + tier frío + runbooks son los cimientos del simulacro DR de S10. |

---

## 5. Etapa 1 — Sprints y entregables (S1–S8)

**Objetivo gerencial:** entregar una plataforma funcional integrada — login seguro, editor de informes, mapas, sensores, exportación, modo offline y sincronización con AWS.
**Recursos clave:** BE1 (core), BE2 (seguridad/IA aplicada), BE3 (BD/AWS), FE1, ARQ, PAF; FE2/SYS/QA/IA se incorporan desde el Mes 2.

| Sprint | Fechas | Rel. | Objetivo | Entregables a Gerencia | Demo (Sprint Review) | Gate / Hito |
|---|---|---|---|---|---|---|
| **S1** | 01–12 jun | R1 | Arranque y alcance acordado | Acta de kick-off firmada; SOW y cronograma aprobados; equipo de 10 confirmado; mapa de arquitectura inicial; backlog ClickUp cargado | Presentación ejecutiva de alcance, hitos y responsables | **Gate PM-0:** aprobación de inicio |
| **S2** | 15–26 jun | R1 | Base técnica y diseño de datos | Esquema PostgreSQL aprobado (BE3); pipeline CI/CD operativo (SYS); diseño UX + shell navegable del editor (FE1); matriz RBAC inicial (BE2) | Recorrido del shell ReportStudio + diagrama de datos + ambiente dev levantado | **Gate R1 (30 jun):** diseño y arquitectura aprobados — cierre Mes 1 |
| **S3** | 29 jun–10 jul | R2 | Motor del servidor y acceso seguro | Núcleo C++ operativo (BE1); APIs REST + canal en vivo de sensores; login con usuarios y perfiles (BE2); sync inicial AWS (BE3). **v36.1: ingesta durable (Redpanda) y PgBouncer ya integrados** | Ingreso al sistema + recepción de datos de sensores en tiempo real | Inicio Mes 2 — FE2/SYS/QA/IA incorporados |
| **S4** | 13–24 jul | R2 | Permisos, guardado y telemetría base | Roles operativos (BE2); auto-guardado del editor en servidor (BE1); **telemetría base validada con métricas `/api/metrics`**; plan maestro de pruebas QA | Perfiles diferenciados + informe guardado sin pérdida | **Gate R2 (31 jul):** motor operacional + RBAC + Git/Docker + VPS desarrollo |
| **S5** | 27 jul–07 ago | R3 | Editor de informes y mapa minero | Editor ReportStudio (texto, tablas, imágenes — FE1); servicios equivalentes en servidor (BE1); mapa interactivo con puntos y zonas | Crear informe minero con formato corporativo + ubicar sensores en mapa | Mes 3 — foco UX y sensores |
| **S6** | 10–21 ago | R3 | Sensores, voz e IA base | **10.000 sensores simulados sobre el pipeline v36.1** (chunks 6h + compresión); dictado por voz minero (IA+BE2); modelos IA locales en VPS; ETL programado desde AWS (BE3) | Dashboard de 10k sensores en vivo (leído de réplica) + dictado + corrección IA | **Gate R3 (31 ago):** editor + GIS + dashboards operativos |
| **S7** | 24 ago–04 sep | R4 | Exportación e integraciones | Exportar a PDF/Word (FE1+BE1); panel gerencial con KPIs; integraciones externas estables (BE3); auditoría de accesos (BE2) | Descargar informe PDF + dashboard gerencial + log de accesos | Mes 4 — integración e2e |
| **S8** | 07–18 sep | R4 | Modo offline y validación integral E1 | Trabajo offline con sincronización al reconectar (FE1+BE1+BE3); regresión completa Etapa 1 (QA); acta de cierre funcional core | Editar sin internet, reconectar y sincronizar; informe QA Etapa 1 | **Gate R4 (30 sep) / FIN ETAPA 1:** sistema integrado e2e — aprobación paso a Etapa 2 |

**Releases de Etapa 1:** R1 *Arquitectura* (S2) · R2 *Motor operacional + seguridad base* (S4) · R3 *UX + sensores + IA base* (S6) · R4 *Integración e2e* (S8, fin de etapa).

---

## 6. Etapa 2 — Sprints y entregables (S9–S13)

**Objetivo gerencial:** sistema endurecido, probado bajo carga, UAT aprobado, en producción con transferencia a operaciones.
**Recursos clave:** SYS (infra), BE2 (seguridad), BE3 (DR/BD), QA (UAT/carga), ARQ (sign-off); todo el equipo en marcha blanca.

| Sprint | Fechas | Rel. | Objetivo | Entregables a Gerencia | Demo (Sprint Review) | Gate / Hito |
|---|---|---|---|---|---|---|
| **S9** | 21 sep–02 oct | R5 | Rendimiento y seguridad aplicativa | Optimización de consultas y sockets (BE1); **pentest interno OWASP** (BE2+QA); inicio hardening de servidores (SYS); pruebas de carga progresivas. **v36.1: réplica + poda de índices + pooling ya en línea** | Informe de rendimiento + hallazgos de seguridad priorizados con plan de cierre | Inicio Etapa 2 — hardening |
| **S10** | 05–16 oct | R5 | Continuidad y recuperación (DR) | Backups automáticos + prueba de restauración BD (BE3); **simulacro disaster recovery** (BE3+SYS+ARQ) apoyado en la réplica y el tier frío; IA cloud con respaldo; monitoreo 24/7 | Simulacro controlado de recuperación + tablero de monitoreo en vivo | **Gate parcial R5:** infra productiva con DR demostrado (restauración < 15 min) |
| **S11** | 19–30 oct | R5 | Optimización final pre-UAT | Afinamiento de modelos IA; optimización final core C++ (BE1); cierre de hallazgos seguridad P0/P1 (BE2); certificación interna de calidad (QA) | Comparativa antes/después de rendimiento + matriz de cierre de hallazgos | **Gate R5 (31 oct):** infraestructura productiva lista — aprobación UAT ejecutivo |
| **S12** | 02–13 nov | R6 | Estrés, UAT y marcha blanca | **Prueba de 10.000 sensores simultáneos** (QA+BE1) sobre el pipeline durable; UAT con operadores mineros (QA+FE2+ARQ); marcha blanca controlada en ambiente real | UAT en campo + reporte de estrés 10k + operación en marcha blanca 48–72 h | Mes 6 — validación con usuarios reales |
| **S13** | 16–27 nov | R6 | Go-Live y transferencia | Lanzamiento oficial en producción VPS Lima; transferencia a operaciones TI del cliente (ARQ+SYS); manuales y capacitación (PAF); acta de cierre y lecciones aprendidas | Sistema en producción + acta Go-Live firmada + kit de entrega documental | **Gate R6 (30 nov) / FIN PROYECTO:** Go-Live aprobado por Gerencia General |

**Releases de Etapa 2:** R5 *Hardening + DR + optimización* (S11) · R6 *Go-Live producción* (S13, fin del proyecto).

---

## 7. Puertas de control (gates PM) — qué se aprueba y con qué evidencia

| Release | Etapa | Sprint cierre | Fecha gate | Criterio de aprobación | Aprueba | Evidencia requerida |
|---|---|---|---|---|---|---|
| **R1** | 1 | S2 | 30 jun | Diseño y arquitectura aprobados | ARQ | Acta gate + demo shell + esquema BD |
| **R2** | 1 | S4 | 31 jul | Motor operacional + seguridad base | ARQ | Demo telemetría + RBAC + VPS dev |
| **R3** | 1 | S6 | 31 ago | Editor + sensores + IA base | ARQ | Demo editor + mapa + sensores en vivo |
| **R4** | 1 | S8 | 30 sep | Sistema integrado e2e — **FIN ETAPA 1** | Gerencia + ARQ | Demo offline + informe QA Etapa 1 |
| **R5** | 2 | S11 | 31 oct | Hardening + DR + optimización | ARQ + **Gerencia TI** | Informe pentest + simulacro DR + carga |
| **R6** | 2 | S13 | 30 nov | Go-Live producción — **FIN PROYECTO** | Gerencia General | Acta Go-Live + handover + kit documental |

---

## 8. KPIs medibles del SOW (O1–O7) y sprint de validación

| Código | Objetivo | Meta | Validación | Refuerzo v36.1 |
|---|---|---|---|---|
| **O1** | Rapidez de pantalla | < 20 ms (local) | S9, S11 | Lecturas desde réplica |
| **O2** | Auto-guardado seguro | < 0.5 s | S4 | — |
| **O3** | Generación de reportes | < 5 s | S7 | Réplica aislada de la ingesta |
| **O4** | Capacidad de monitoreo | 10,000 sensores | S6 (sim), S12 (estrés) | Pipeline `COPY` + Redpanda + PgBouncer + compresión |
| **O5** | Estabilidad | > 99.9% uptime | S10 (DR), S13 | Réplica + cola durable + observabilidad |
| **O6** | IA local | < 1 s por párrafo | S6, S11 | — |
| **O7** | Trazabilidad | 100% acciones auditadas | S4, S8 | — |

**SLA contractuales:** Respuesta < 20 ms · Uptime 99.9% · **0% pérdida de datos (Zero Data Loss)** · IA < 1 s/respuesta. El SLA de Zero Data Loss queda respaldado por la cola durable Redpanda con commit por lote.

---

## 9. Riesgos gestionados (consolidado de ambas etapas)

> El plan v36.1 **reduce** la severidad de varios riesgos técnicos al haber adelantado su solución. La columna *Estado v36.1* lo indica.

### Etapa 1

| ID | Imp. | Riesgo | Mitigación | Resp. | Estado v36.1 |
|---|---|---|---|---|---|
| R-E1-01 | Alto | Retraso en aprobación de arquitectura/alcance (Mes 1) | Gate ARQ semana 4 (S2); comité ejecutivo semanal; escalamiento de bloqueos en 24h | ARQ, PAF | Vigente |
| R-E1-02 | Alto | Complejidad del núcleo C++ tiempo real | Modularización implementada; revisiones quincenales; pruebas de humo diarias en WebSocket | BE1, ARQ | **Mitigado:** ingesta de alta tasa ya construida y modularizada |
| R-E1-03 | Medio | Integración con AWS y datos legacy | BE3 lidera ETL incremental; POC sync en S3; jobs con alertas | BE3, SYS | Vigente |
| R-E1-04 | Medio | Datos insuficientes para entrenar IA | Tarea IA-M01 en S2; datasets sintéticos de respaldo | IA, BE2 | Vigente |
| R-E1-05 | Alto | Ampliación de alcance (A–G) sin control | Change control formal ARQ; comité aprueba cambios; matriz de trazabilidad PAF | ARQ, PAF | Vigente |
| R-E1-06 | Medio | Conflictos al sincronizar offline | Cola ordenada BE1+BE3; pruebas offline en S8; resolución visual en UI | BE1, BE3, FE1 | Vigente |
| R-E1-07 | Medio | QA/IA/SYS/FE2 inician en Mes 2 | Comunicar métrica 'promedio meses activos'; carga 90–100% desde julio | ARQ, PAF | Vigente (informativo) |
| R-E1-08 | Alto | Seguridad/RBAC/biometría incompleta antes de demo Mes 4 | BE2 líder desde S3; gate de seguridad antes de R4; QA valida RBAC en S7 | BE2, QA | Vigente |
| **R-E1-09 (NUEVO)** | Medio | **Pérdida de telemetría en ráfagas de 10k sensores** | **Cola durable Redpanda con commit por lote; cola acotada con métricas de descarte en `/api/metrics`** | BE1, BE3 | **Mitigado por diseño** |
| **R-E1-10 (NUEVO)** | Medio | **Agotamiento de conexiones de BD con 10k clientes** | **PgBouncer transaction pooling (10k clientes / ~200 conexiones); ingestor con conexión persistente dedicada** | BE3, SYS | **Mitigado por diseño** |

### Etapa 2

| ID | Imp. | Riesgo | Mitigación | Resp. | Estado v36.1 |
|---|---|---|---|---|---|
| R-E2-01 | Alto | Hallazgos críticos en pentest OWASP (S9) | Pentest progresivo desde S9; buffer S11 para cierre P0/P1 | BE2, QA | Vigente |
| R-E2-02 | Alto | Fallo en simulacro DR (sistema + BD) | Simulacro BE3+SYS en S10; runbooks; segundo simulacro si falla | BE3, SYS, ARQ | **Atenuado:** réplica + tier frío ya disponibles como cimiento del DR |
| R-E2-03 | Alto | Carga 10.000 sensores no cumple SLA | Load test incremental S9–S12; tuning sockets; SYS escala infra; QA certifica | BE1, QA, SYS | **Atenuado:** pipeline de ingesta ya validado en arquitectura |
| R-E2-04 | Medio | Rechazo parcial en UAT por usuarios de mina | FE2 acompaña UAT; marcha blanca S12; hotfix sprint S13 reservado | FE2, QA, ARQ | Vigente |
| R-E2-05 | Medio | Inestabilidad de infraestructura en producción | Blue/green SYS; monitoreo Prometheus/Grafana; guardia 24/7 post Go-Live | SYS, ARQ | Vigente |
| R-E2-06 | Medio | Equipo al 95–100% sin margen | S13 dedicado a hotfixes; ARQ prioriza P0; PAF coordina | ARQ, PAF | Vigente |
| R-E2-07 | Alto | Incumplimiento documental/trazabilidad para auditoría | ARQ-G12 auditoría SOW; PAF kit cierre; matriz requisito→entregable | ARQ, PAF, QA | Vigente |
| **R-E2-08 (NUEVO)** | Medio | **Crecimiento de almacenamiento a largo plazo (costo)** | **Tier frío automático a MinIO/S3 (Parquet ZSTD) + `drop_chunks`; datos > 1 año consultables sin ocupar disco caliente** | BE3, SYS | **Mitigado por diseño** |

---

## 10. Equipo y carga (validación PMO)

10 recursos especializados, carga validada **90–100%** en meses activos (promedio por meses activos, no por calendario completo). FE2, SYS, QA e IA inician en el Mes 2 — su menor promedio anual es esperado y está comunicado a Gerencia.

| Recurso | Rol | Prom. activos | Etapa |
|---|---|---|---|
| BE1 | Core C++ / tiempo real / sockets | 92.0% | E1+E2 |
| BE2 | Seguridad / biometría / IA aplicada | 92.7% | E1+E2 |
| BE3 | DBA / AWS / ETL / recovery | 95.0% | E1+E2 |
| FE1 | Interfaces / ReportStudio | 98.0% | E1+E2 |
| FE2 | UX y soporte (desde Mes 2) | 94.5% | E1+E2 |
| ARQ | Arquitecto TI / PMO | 96.5% | E1+E2 |
| SYS | Infraestructura VPS (desde Mes 2) | 96.3% | E1+E2 |
| QA | Calidad / auditoría (desde Mes 2) | 96.1% | E1+E2 |
| IA | Modelos ONNX/NLP/STT (desde Mes 2) | 97.9% | E1+E2 |
| PAF | Soporte PMO / analista funcional | 93.8% | E1+E2 |

---

## 11. Trazabilidad SOW → Sprint → Release → Gate (cobertura 100%)

| Etapa | Entregable / alcance SOW | Sprint(s) | Release | Gate / criterio |
|---|---|---|---|---|
| 1 | SOW maestro y paquete de arranque | S1 | R1 | Gate PM-0: aprobación de inicio |
| 1 | Arquitectura objetivo, conectividad y SLA | S2 | R1 | Gate R1: diseño y arquitectura aprobados |
| 1 | Infraestructura base en Lima | S2–S4 | R1–R2 | Gate R2: VPS desarrollo operativo |
| 1 | Motor central: servicios, seguridad, trazabilidad | S3–S4 | R2 | Gate R2: motor operacional + RBAC |
| 1 | Editor maestro de informes | S5 | R3 | Editor ReportStudio en demo |
| 1 | Visualización GIS: sensores, capas, zonas | S5–S6 | R3 | Gate R3: editor + GIS + dashboards |
| 1 | Integración con fuentes históricas (AWS) | S3–S7 | R2–R4 | ETL POC S3, e2e S7 |
| 1 | Modo offline con reconciliación | S8 | R4 | Demo offline + sync sin pérdida |
| 1 | Pruebas funcionales del núcleo | S7–S8 | R4 | Gate R4: e2e + acta QA |
| 2 | Hardening de plataforma e infraestructura | S9 | R5 | Pentest OWASP + cierre P0/P1 |
| 2 | Canales seguros, cifrado, segmentación | S9–S10 | R5 | WireGuard/Nginx + cifrado validado |
| 2 | IA avanzada, biometría, detección EPP | S6, S11 | R3, R5 | Modelos afinados pre-UAT |
| 2 | Monitoreo intensivo 10k sensores | S6, S12 | R3, R6 | Estrés 10k cumple SLA |
| 2 | Plan de recuperación ante desastres (DR) | S10 | R5 | Simulacro DR < 15 min |
| 2 | Evidencia de pruebas de estrés/seguridad | S9–S12 | R5–R6 | Load test incremental + informe |
| 2 | UAT, marcha blanca y salida controlada | S12–S13 | R6 | UAT aprobado + marcha blanca |
| 2 | Capacitación, transferencia y cierre | S13 | R6 | Gate R6 / FIN: Go-Live + handover |
| **1–2** | **Ciclo de vida de datos (hot/warm/cold) y alta disponibilidad (NUEVO v36.1)** | **S3–S4, S6, S9–S10** | **R2, R3, R5** | **Ingesta durable, réplica y tier frío demostrados** |

---

## 12. Pedido de aprobación a la Gerencia de TI

Se solicita a la Gerencia de TI:

1. **Ratificar** el plan de 13 sprints y 6 gates de release (R1–R6) tal como se presenta.
2. **Aprobar el Gate R1** (cierre de Mes 1): diseño de datos y arquitectura objetivo.
3. **Incorporar al alcance, sin costo ni plazo adicional, la arquitectura de datos v36.1** (Sección 4): ingesta durable, réplica de lectura, pooling de conexiones, compresión columnar y tier frío. Esta capa **adelanta y reduce** el riesgo de los gates R2–R5.
4. **Confirmar a la Gerencia de TI como aprobador de los gates R5 y R6** (hardening/DR y Go-Live), conforme a la matriz de gates.

**Recomendación de Arquitectura (ARQ).** El programa está ordenado por resultados verificables, con el equipo real de 10 recursos, economía recalculada y trazabilidad 1:1 con el SOW. Los componentes técnicos de mayor riesgo ya están construidos. **Se recomienda aprobar el avance.**

---

### Anexo — Documentos fuente y de referencia

| Documento | Uso |
|---|---|
| `Plan_Detallado_Etapas_1_y_2_v36.xlsx` | 422 tareas, dependencias, carga por recurso (fuente operativa) |
| `Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx` | Sprints, gates, riesgos, KPIs, trazabilidad (revisión ejecutiva) |
| `Cronograma_Maestro_AURIXA_v36.md` | Vista legible del cronograma de 13 sprints |
| `Cronograma_Implementacion_VPS_Lima.md` | Línea de tiempo de infraestructura por sprint |
| `Matriz_Costos_Cronograma_26_Semanas.md` | Inversión recalculada sobre 10 recursos |
| `Resumen_Ejecutivo_Proyecto_AURIXA.md` | Resumen de una página para Gerencia General |
| `docs/00_SOW/SOW_Maestro_AURIXA_2026_v4` | Contrato de alcance (trazabilidad 1:1) |
| `docker-compose.yml`, `db_scripts/29_*.sql`, `backend/src/mining/telemetry_ingest.*`, `scripts/archive_cold_tier.sh` | Evidencia técnica de la arquitectura de datos v36.1 |
