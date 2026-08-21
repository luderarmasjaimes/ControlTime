# ARQUITECTURA OBJETIVO POR CAPAS — PLATAFORMA AURIXA

## Reorganización de la Solución de Telemetría y Automatización Minera con IA (LATAM)

**Versión:** v36 — alineada al SOW Maestro v3.0 y al estado real del código
**Fecha:** 19 de junio de 2026
**Audiencia:** Gerencia TI, Arquitectura y equipo técnico (10 recursos)
**Propósito:** Definir la arquitectura objetivo, organizada por capas, para una plataforma **en tiempo real, escalable y resiliente**, e incorporar un **motor de ML predictivo** aplicado a minería metálica.

> Este documento complementa a `Arquitectura_Solucion_AURIXA_v36.md` (vista actual) con la **vista objetivo por capas** y el plan de reorganización para la Etapa 2.

---

## 1. Principio de organización

La solución se reorganiza en **7 capas funcionales** + **3 capas transversales**, con una frontera clara entre lo **orientado a backend** (datos, ingesta, motor C++, IA) y lo **orientado a frontend** (experiencia, dashboards, mapas). Cada capa tiene un dueño en el equipo de 10 y un sprint de Etapa 2.

```
┌──────────────────────────────────────────────────────────────────────┐
│  TRANSVERSAL: Seguridad (edge TLS, secrets, redes segmentadas)         │
│  TRANSVERSAL: Observabilidad (Prometheus · Grafana · Loki)             │
│  TRANSVERSAL: Orquestación / CI-CD (Docker, registry, blue-green)      │
├──────────────────────────────────────────────────────────────────────┤
│  C6 FRONTEND (React/Vite)        │  C7 GIS / GEOLOCALIZACIÓN AVANZADA   │
│  ReportStudio · dashboards · 3D  │  tileserver · WMS LATAM · GDAL       │
├──────────────────────────────────┴──────────────────────────────────┤
│  C3 BACKEND C++ (Boost.Asio/Beast + OpenCV)  — gateway por dominios     │
│  auth · mining/telemetría · map · gdal · biometric · reports · formula │
├──────────────────────────────────┬──────────────────────────────────┤
│  C4 IA APLICADA (visión/biometría)│  C5 ML PREDICTIVO (NUEVO)          │
│  InsightFace · MediaPipe · ONNX   │  forecasting · anomalías · report  │
├──────────────────────────────────┴──────────────────────────────────┤
│  C2 INGESTA TIEMPO REAL — Redpanda (Kafka API), 10.000 sensores        │
├──────────────────────────────────────────────────────────────────────┤
│  C1 DATOS — TimescaleDB (hypertables) · MinIO (objetos)                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. C1 · Capa de Datos

**Hoy:** TimescaleDB (PostgreSQL 15) con hypertables `telemetry_raw(captured_at)` y `telemetry_multivariate(ts)`; modelo multitenant UUID, RBAC granular (`sec_role`, `sec_permission`, `auth_user_role`), auditoría forzada (`platform_audit_log`, contexto desde login) y 28+ migraciones versionadas (`db_scripts/`). BD separada para el motor FORMULA.

**Objetivo:**
- **Políticas de compresión y retención** en hypertables (TimescaleDB) para sostener 10k sensores.
- **Continuous aggregates** (vistas materializadas incrementales) para KPIs y dashboards sub-segundo.
- **MinIO** como almacén de objetos soberano: informes exportados, imágenes de informes, modelos ML versionados, respaldos.
- **Réplica + PITR** (pgBackRest/wal-g) para DR < 15 min (objetivo O5).

**Dueño:** BE3 (DBA/AWS/ETL/Recovery). **Sprints:** S10 (DR), S11 (tuning).

---

## 3. C2 · Capa de Ingesta en Tiempo Real (nueva)

**Hoy:** los sensores llegarían directo al backend C++ (sockets/gateway). No escala a picos de 10k/seg.

**Objetivo:** **Redpanda** (API Kafka, C++, sin JVM) como bus de ingesta:
- Topics por **tenant/zona** (`telemetry.<tenant>.<zona>`), particionados para paralelismo.
- **Productores**: gateway TLS C++ (`mining_gateway`) y credenciales de ingesta (`sensor_ingest_credential`).
- **Consumidores**: servicio C++ que persiste a `telemetry_raw` y publica a `ml_engine`.
- Desacopla picos, da **back-pressure** y resiliencia (si cae un consumidor, el dato no se pierde).

**Dueño:** BE1 (Core C++) + Infra/SYS. **Sprints:** S9–S12 (estrés 10k).

---

## 4. C3 · Capa Backend C++ (orientada a backend)

**Hoy (ya modular, base sólida):** gateway Boost.Asio/Beast con TLS (`mining_gateway`, 8443), router por `{método, ruta}`, pool de 15k WebSockets (`server/connection_pool`), y módulos por dominio:

| Módulo | Responsabilidad | Endpoints |
|---|---|---|
| `auth/` | Usuarios, sesiones, multitenant (file/pg), face login | `/api/auth/*` |
| `mining/` | Telemetría, KPIs, vigilancia, gateway TLS, vision_pipeline (RQD/fracturas) | `/api/sensors/*`, `/api/mining/kpis`, `/api/dashboard/metrics` |
| `map/` | Geoespacial, point-in-polygon, compliance | `/api/map/markers`, `/official-zones`, `/compliance-intersections` |
| `gdal/` | Conversión raster ECW/GeoTIFF (job queue) | `/api/gdal/*` |
| `biometric/` | OpenCV Haar+DNN, cliente ai_engine, ICAO | `/api/face/register`, `/verify` |
| `reports/` · `formula/` · `text/` | Informes, diccionario de fórmulas, ortografía | `/api/reports/*`, `/api/formula/dictionary`, `/api/text/*` |

**Objetivo:**
- **Réplicas horizontales** de `web` (stateless) detrás del edge proxy.
- Mover la ingesta directa de sensores a **consumir desde Redpanda** (C2).
- Límites de recursos y métricas Prometheus (`/metrics`).

**Dueños:** BE1 (core/telemetría), BE2 (seguridad/biometría). **Sprints:** S9–S11.

---

## 5. C4 · Capa de IA Aplicada (visión/biometría)

**Hoy:** `ai_engine` (Flask :5000) — MediaPipe Face Landmarker, InsightFace (embeddings 512-d), clasificador ONNX de gafas (fusión CV+ONNX), avatar cartoon. Frame-a-frame, stateless.

**Objetivo:** réplicas + cola; visión EPP por CCTV (casco/chaleco) en Etapa 2; modelos ONNX versionados en MinIO.

**Dueño:** IA + BE2. **Sprints:** S6 (base), S11 (producción).

---

## 6. C5 · Capa de ML Predictivo (NUEVA) — `ml_engine`

Motor **nuevo y separado** del `ai_engine` de visión. Servicio **FastAPI/Python** (puerto 5001) con el stack de ciencia de datos: **pandas, numpy, scikit-learn, statsmodels/Prophet, PyTorch (LSTM), XGBoost, Isolation Forest**. Lee las hypertables de TimescaleDB, persiste predicciones a la BD y modelos/artefactos a MinIO.

### Casos de uso (minería metálica LATAM)

| # | Caso | Técnica | Fuente de datos | Salida |
|---|---|---|---|---|
| 1 | **Forecasting de telemetría** | Prophet / LSTM | `telemetry_raw`, `telemetry_multivariate` | Predicción de temperatura, vibración, caudal, gases (n horas) |
| 2 | **Anomalías geotécnicas** | Isolation Forest / autoencoder | series de taludes, inclinómetros, piezómetros | Alerta temprana de inestabilidad |
| 3 | **Mantenimiento predictivo** | XGBoost / survival models | telemetría + historial de equipos | Probabilidad de falla / RUL de equipos críticos |
| 4 | **Leyes y metalurgia** | Regresión / gradient boosting | leyes de cabeza, recuperación, `mining_runtime_kpis` | Predicción de recuperación y optimización de AISC/tonelaje/TRIFR |
| 5 | **Reportabilidad ML** | NLG + plantillas (con Ollama) | predicciones + KPIs + hallazgos | Generación/aumento de **informes técnicos avanzados** en ReportStudio (`report_ai_run`) |

### Integración
- **Entrada:** consume features desde TimescaleDB (continuous aggregates) y eventos de Redpanda.
- **Salida:** tabla de predicciones (`ml_predictions`) + alertas a `org_notification_outbox`; modelos versionados en MinIO; resultados de informes vía `report_ai_run` (ya existe en el esquema).
- **MLOps:** entrenamiento offline (jobs), servir online (FastAPI), versionado de modelos, métricas de drift a Prometheus.

**Estructura propuesta** (`ml_engine/`, a scaffoldear en Etapa 2):
```
ml_engine/
├── app/                 FastAPI (endpoints /forecast, /anomaly, /maintenance, /grade, /report-insights, /health)
├── pipelines/           ingestión de features desde TimescaleDB
├── models/              forecasting/ anomaly/ maintenance/ metallurgy/ (entrenamiento + inferencia)
├── reporting/           NLG de informes (integra Ollama local)
├── store/               persistencia a BD + MinIO (artefactos/modelos)
├── requirements.txt     pandas, numpy, scikit-learn, prophet, torch, xgboost, fastapi, psycopg, minio
└── Dockerfile.ml
```

**Dueño:** IA (lead) + BE1 (integración telemetría) + BE3 (datos). **Sprints:** S6 (PoC), S11 (afinamiento), S12 (validación).

---

## 7. C6 · Capa Frontend (orientada a frontend)

**Hoy:** Vite + React 18. `ReportStudioV2/` (editor TipTap, autosave, export PDF/DOCX/PPTX, widgets de sensores/KPI, versionado), dashboards ECharts, 3D Three.js, Konva, CCTV HLS, estado Zustand.

**Objetivo:** consumo de **streams en vivo** (WS/Redpanda bridge) para 10k sensores; panel de predicciones del `ml_engine`; UX offline (tablet/socavón).

**Dueños:** FE1 (editor/mapas/dashboards), FE2 (UX/campo/UAT). **Sprints:** S5–S8, S12.

---

## 8. C7 · Capa GIS / Geolocalización Avanzada

**Hoy:** `tileserver` (mbtileserver, MBTiles offline), `MapViewer.jsx` (Leaflet + **WMS oficial LATAM**: MINAM, INGEMMET, MINEM vía `wmsCorporateCatalog.json`), `DetailedMap.jsx` (mbtiles), GeoJSON de polígonos oficiales (`data/map_official_polygons.geojson`), compliance por intersección punto-polígono, GDAL (ECW/GeoTIFF).

**Objetivo:** capas operativas adicionales (geocercas dinámicas, rutas de acarreo, zonas de perforación), MapLibre para análisis avanzado, y cruce de **predicciones geotécnicas** del `ml_engine` sobre el mapa.

**Dueños:** FE1 + BE1 (map/gdal). **Sprints:** S5–S6.

---

## 9. Capas transversales

| Transversal | Objetivo | Dueño |
|---|---|---|
| **Seguridad** | Edge proxy (Traefik/Nginx) con TLS + rate-limit; **Docker secrets** (fin de passwords en texto); **redes segmentadas** edge/app/datos/ai; Zero-Trust; pentest OWASP | Infra/SYS + BE2 |
| **Observabilidad** | Prometheus (métricas), Grafana (tableros SLA), Loki (logs) → medición real de O1/O5 y alertas 24/7 | Infra/SYS |
| **Orquestación / CI-CD** | Imágenes a registry, despliegue blue/green, healthchecks, límites de recursos | Infra/SYS + ARQ |

---

## 10. Flujo de datos en tiempo real (objetivo)

```
Sensor de campo
   └─(TLS)→ mining_gateway (C++) ──► Redpanda topic telemetry.<tenant>.<zona>
                                          │
              ┌───────────────────────────┼────────────────────────────┐
        Consumidor C++                 ml_engine (FastAPI)        Dashboard (WS)
        persiste a                     forecasting / anomalías    en vivo (frontend)
        TimescaleDB ◄──────────────────►  predicciones a BD/MinIO
                                          │
                                   alerta (anomalía) ──► org_notification_outbox ──► Grafana / app
                                          │
                                   Reportabilidad ML ──► report_ai_run ──► ReportStudio (informe técnico avanzado)
```

---

## 11. Mapeo al equipo de 10 y a la Etapa 2

| Capa | Rol responsable | Sprints |
|---|---|---|
| C1 Datos / DR | BE3 (DBA) | S10–S11 |
| C2 Ingesta Redpanda | BE1 + Infra | S9–S12 |
| C3 Backend C++ | BE1 (core), BE2 (seguridad) | S9–S11 |
| C4 IA visión | IA + BE2 | S6, S11 |
| C5 ML predictivo (nuevo) | IA (lead) + BE1 + BE3 | S6, S11, S12 |
| C6 Frontend | FE1, FE2 | S5–S8, S12 |
| C7 GIS | FE1 + BE1 | S5–S6 |
| Seguridad / Observabilidad / CI-CD | Infra-SYS + BE2 | S9–S13 |
| Gobierno (gates, QA 10k, trazabilidad) | ARQ, QA, PAF | S9–S13 |

> Equipo: 3 Backend (BE1/BE2/BE3), 2 Frontend (FE1/FE2), 1 IA, 1 Infra/Linux+Seguridad (SYS) + ARQ, QA, PAF (SOW) = **10**.

---

## 12. Implementado vs Objetivo (honestidad de ingeniería)

| Componente | Hoy | Objetivo Etapa 2 |
|---|---|---|
| TimescaleDB hypertables | ✅ | + compresión/retención + continuous aggregates |
| Backend C++ modular | ✅ | + réplicas + consumir Redpanda |
| ai_engine visión/biometría | ✅ | + visión EPP CCTV |
| **ml_engine predictivo** | ❌ no existe | ✅ **nuevo servicio FastAPI** (5 casos) |
| Redpanda (ingesta 10k) | ❌ | ✅ |
| MinIO (objetos) | ❌ | ✅ |
| Réplica BD + DR | ❌ | ✅ (DR < 15 min) |
| Edge proxy + secrets + redes segmentadas | ❌ | ✅ |
| Prometheus/Grafana/Loki | ❌ | ✅ |

---

## 12.b Estándar de nombres y decisiones de consolidación / split

**Estándar:** `aurixa-<función>` (el nombre del servicio es también el hostname DNS). En el compose dev se aplica vía `container_name` sin cambiar los hostnames (no rompe el código); en `docker-compose.scale.yml` se usa como nombre de servicio.

| Nombre estándar | Servicio | Decisión |
|---|---|---|
| `aurixa-db` / `aurixa-db-replica` | TimescaleDB | **Replicar** (HA + DR) |
| `aurixa-store` | MinIO | Nuevo (objetos) |
| `aurixa-ingest` (+ `-console`) | Redpanda | Nuevo (1 broker → 3 en prod) |
| `aurixa-api` | Backend C++ REST | **Split** del backend (rol api) · réplicas ×3 |
| `aurixa-telemetry` | Gateway TLS+WS+Redpanda | **Split** del backend (rol telemetría) · réplicas ×3 — escala con sensores |
| `aurixa-gis-raster` | Worker GDAL | **Independizar** (CPU-intensivo, job queue) |
| `aurixa-ml-serving` / `aurixa-ml-training` | ML predictivo | **Split** inferencia online vs entrenamiento batch |
| `aurixa-ai-vision` | IA biometría/visión | Separado (réplicas ×2) |
| `aurixa-llm` / `aurixa-grammar` | Ollama / LanguageTool | Separados (perfiles de recursos distintos) |
| `aurixa-formula` / `aurixa-formula-db` | Motor FORMULA + BD | Mantener (aislamiento; consolidable si se requiere) |
| `aurixa-gis-tiles` | mbtileserver | Mantener |
| `aurixa-web` | Frontend | Mantener |
| `aurixa-edge` | Traefik | Nuevo (TLS, rate-limit) |
| `aurixa-metrics` / `aurixa-dashboards` / `aurixa-logs` | Prometheus/Grafana/Loki | Nuevos (observabilidad) |

**Criterio rector:** se **divide** lo que tiene perfiles de carga distintos (telemetría 10k/s vs REST de informes; inferencia vs entrenamiento; raster batch vs API) para **escalar y aislar fallas de forma independiente**; se **mantiene separado** lo que ya tiene ciclos de vida y recursos propios; se **replica** la BD para resiliencia. El backend C++ es una sola imagen que asume distintos **roles** (`APP_ROLE`) según el servicio.

## 13. Conclusión

La base actual (backend C++ modular, TimescaleDB, IA local, GIS) es **sólida y no requiere reescritura**. La reorganización objetivo **añade cuatro capas críticas** — ingesta en tiempo real (Redpanda), ML predictivo (`ml_engine`), almacenamiento de objetos (MinIO) y resiliencia/observabilidad — para convertir AURIXA en una plataforma de telemetría minera **en tiempo real, escalable y resiliente**, con analítica predictiva y reportabilidad avanzada aplicada a la minería metálica de LATAM. La topología desplegable está en `docker-compose.scale.yml`.
