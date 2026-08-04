# PLAN 012 — Conversión geoespacial (GDAL/ECW)

| Campo | Valor |
|---|---|
| **Spec** | `specs/012-conversion-geoespacial-gdal/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S5-S7 · R3 |
| **Constitución** | Art. 9 (recursos: jobs asincrónicos acotados) |

---

## 1. Enfoque técnico

**Conversión asincrónica de formatos GIS** (ECW, GeoTIFF, SHP → GeoJSON/PNG/GeoTIFF)
usando GDAL como biblioteca nativa en C++. Los trabajos de conversión se procesan en
threads background (no bloquean el thread de Boost.Asio del servidor).

## 2. Arquitectura

```
 Cliente
   ├── POST /api/gdal/convert  ──► aceptado inmediatamente (202 Accepted)
   │   { src_path, src_format, dst_format, options }       job_id devuelto
   │
   ├── GET /api/gdal/job/{id}  ──► estado: queued/running/done/error + logs
   │
   └── GET /api/gdal/capabilities ──► { ecw_supported: bool }
                                        (ECW requiere licencia Erdas)

 gdal_routes.cpp
   ├── handleCapabilities() → gdalSupportsEcw()
   ├── handleConvert()
   │    ├── parseConvertRequest → ConvertRequest
   │    ├── Job{id, status="queued"} en gJobs (in-memory map)
   │    └── std::thread(runConversionJob, id, cReq, dataRoot).detach()
   └── handleJobStatus() → gJobs[id]

 conversion_service.cpp
   └── runConversionJob(id, cReq, dataRoot)
         ├── GDALOpen(src) → GDALDataset
         ├── GDALTranslate / GDALVectorTranslate → dst
         ├── actualizar Job.status / logs / progress
         └── ONNX cartoon stub (style transfer opcional)
```

## 3. Modelo de Job

```cpp
struct Job {
  std::string id;          // UUID v4
  std::string status;      // queued | running | done | error
  std::string createdAt;
  std::string updatedAt;
  std::vector<std::string> logs;
  double progress = 0.0;  // 0.0 - 1.0
  std::string outputPath;
};
static std::mutex gJobsMutex;
static std::unordered_map<std::string, Job> gJobs;  // in-memory (reinicio limpia jobs)
```

**Nota:** en-memoria es suficiente para v1 (jobs son efímeros). Para persistencia
de jobs entre reinicios → PostgreSQL jobs table (ADR-012-2).

## 4. Endpoints

| Método | Ruta | Lógica |
|---|---|---|
| GET | `/api/gdal/capabilities` | `gdalSupportsEcw()` → `{ecw_supported:bool}` |
| POST | `/api/gdal/convert` | acepta job → 202 + `{job_id, status:"queued"}` |
| GET | `/api/gdal/job/{id}` | polling de estado + logs + progress |
| GET | `/api/gdal/job/{id}/download` | descargar resultado si `status=done` |

## 5. Formatos soportados

| Entrada | Salida | Notas |
|---|---|---|
| ECW | GeoTIFF, PNG | requiere ECW SDK (licencia) |
| GeoTIFF | PNG, GeoJSON bounds, GeoTIFF (reproyectado) | siempre disponible |
| SHP (Shapefile) | GeoJSON | `GDALVectorTranslate` |
| GeoJSON | SHP | reversible |

## 6. ONNX cartoon stub

`onnx_cartoon.cpp` — estilo transfer (imagen satelital → estilo cartográfico).
Es opcional, se activa con `ONNX_MODEL_PATH`. Sin modelo, el endpoint devuelve
la imagen original. No bloquea la feature principal de conversión.

## 7. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-012-1 | Jobs en **memoria** (no BD) para v1 — reinicio limpia; suficiente para uso interno | Aceptado |
| ADR-012-2 | Migrar jobs a BD si jobs concurrentes > 20 o entre reinicios — forward | Propuesto |
| ADR-012-3 | `detach()` por thread — jobs cortos (<60s); thread pool en v2 | Aceptado |

## 8. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | POST convert GeoTIFF → 202 + job_id | curl |
| CA-2 | GET job/{id} polling → status pasa a done | curl loop |
| CA-3 | Capabilities con ECW SDK → `ecw_supported:true` | curl |
| CA-4 | Capabilities sin ECW SDK → `ecw_supported:false` | curl (build normal) |
| CA-5 | Convertir SHP → GeoJSON → verificar features válidas | jq `.features | length` |
| Edge | Fichero src no existe → Job status=error + log descriptivo | test |
