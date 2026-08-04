# TASKS 012 — Conversión geoespacial (GDAL/ECW)

| Campo | Valor |
|---|---|
| **Plan** | `specs/012-conversion-geoespacial-gdal/plan.md` |
| **Sprint·Release** | S5-S7 · R3 |
| **Responsables** | BE1 (routes/async), ML (GDAL/ONNX), SYS (Docker/build), QA |
| **Última revisión** | 2026-06-24 (plan y tasks revisados — T1-T13 confirmados ☑ por plan.md) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Build GDAL en Dockerfile (con/sin ECW SDK según licencia) | CA-3,CA-4 | SYS | Haiku | ☑ |
| **T2** | `gdalSupportsEcw()` — detectar en runtime si ECW disponible | CA-3,CA-4 | BE1 | Haiku | ☑ |
| **T3** | `conversion_service.cpp`: `runConversionJob` (GDALOpen → translate → actualizar Job) | CA-1,CA-2 | BE1 | **Opus** (GDAL API) | ☑ |
| **T4** | `gdal_routes.cpp`: `handleCapabilities`, `handleConvert` (202 + detach thread) | CA-1,CA-2 | BE1 | Sonnet | ☑ |
| **T5** | `handleJobStatus` — polling de estado + logs + progress | CA-2 | BE1 | Sonnet | ☑ |
| **T6** | `handleJobDownload` — stream del archivo resultado | CA-2 | BE1 | Sonnet | ☑ |
| **T7** | `onnx_cartoon.cpp`: style transfer stub (opcional, ONNX_MODEL_PATH) | opcional | ML | Sonnet | ☑ |
| **T8** | Struct `Job` + mutex `gJobs` (in-memory, thread-safe) | CA-2 | BE1 | Sonnet | ☑ |
| **T9** | **Test CA-1**: POST convert GeoTIFF → 202 + job_id | CA-1 | QA | — | ☑ |
| **T10** | **Test CA-2**: polling job/{id} → status llega a done, output descargable | CA-2 | QA | — | ☑ |
| **T11** | **Test CA-3/4**: GET capabilities → `ecw_supported` correcto | CA-3,CA-4 | QA | — | ☑ |
| **T12** | **Test CA-5**: SHP → GeoJSON → features válidas | CA-5 | QA | — | ☑ |
| **T13** | **Test edge**: src no existe → Job error + log | edge | QA | — | ☑ |
| **T14** | Thread pool (no detach) si jobs concurrentes > 20 — ADR-012-3 | futuro | BE1 | Sonnet | ☐ |
| **T15** | Jobs en BD entre reinicios — ADR-012-2 | futuro | BE3 | Sonnet | ☐ |

## Secuencia

```
T1 ─► T2                   (build + detección ECW)
T3 ─► T4 ─► T5 ─► T6 ─► T8  (core: convert → status → download)
T7 (opcional, paralelo)
(T1-T8) ─► T9-T13 (tests)
T14, T15 (futuro/Etapa 2)
```

## Definition of Done

- [x] T1-T13 completadas.
- [x] CA-1..5 demostrados.
- [ ] T14-T15 (thread pool + BD) — Etapa 2.
- [x] ADR-012-1..3 registrados.
