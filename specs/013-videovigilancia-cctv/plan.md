# PLAN 013 — Videovigilancia (muro CCTV)

| Campo | Valor |
|---|---|
| **Spec** | `specs/013-videovigilancia-cctv/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | Etapa 2 (S9-S10) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (seguridad), Art. 9 (recursos) |
| **Última revisión** | 2026-06-24 (auditado contra `surveillance_service.cpp`) |

---

## 1. Enfoque técnico

**Snapshots periódicos en vez de video streaming continuo.** El muro CCTV muestra
la última imagen de cada cámara, actualizada bajo demanda desde el frontend.

El catálogo de cámaras vive en PostgreSQL (`surveillance_cameras`, scoped por
`tenant_id`). Los snapshots se generan invocando un script Python externo cuya
ruta se configura con `SURVEILLANCE_SNAPSHOT_SCRIPT` (default:
`/app/scripts/surveillance_camera_snapshot.py`).

---

## 2. Arquitectura (auditada contra `surveillance_service.cpp`)

```
 Cámaras IP / DVR
   └── rtmp://cam1.mina.local/live/stream1  (URL almacenada en BD)
       (La URL debe ser accesible vía HTTP/HTTPS para el snapshot)

 Backend C++
   ├── GET /api/surveillance/cameras
   │   SELECT id, name, location, rtmp_url, status, lat, lng, tenant_id
   │   FROM surveillance_cameras WHERE tenant_id = $tenant_id
   │   (Scope: si ?tenant_id= presente → requiere auth; si admin global → todas)
   │
   └── GET /api/surveillance/camera-snapshot?camera_id=N&tenant_id=X
         1. Requiere auth (resolveAuthSession)
         2. SELECT rtmp_url FROM surveillance_cameras WHERE id=$N AND tenant_id=$X::uuid
         3. Valida URL: solo http:// o https:// aceptados (NO rtmp:// directo)
         4. Escribe URL a archivo temporal: ic_snap_url_<tag>.txt
         5. exec: python3 $SURVEILLANCE_SNAPSHOT_SCRIPT <url_file> <out_file>
         6. Lee resultado JPEG: ic_snap_out_<tag>.jpg
         7. Responde makeJpegResponse(content) — raw JPEG bytes

 Frontend (muro CCTV)
   └── Grid de <img> que llaman GET /api/surveillance/camera-snapshot periodicamente
```

---

## 3. Modelo de datos

```sql
CREATE TABLE surveillance_cameras (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  location   TEXT,
  rtmp_url   TEXT NOT NULL,    -- URL de la cámara (guardada como rtmp/rtsp/http)
  status     TEXT DEFAULT 'active',
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  tenant_id  UUID REFERENCES auth_companies(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON surveillance_cameras (tenant_id);
```

> **Nota:** El campo se llama `rtmp_url` históricamente, pero el backend **solo
> acepta URLs `http://` o `https://`** para snapshots. URLs `rtmp://` o `rtsp://`
> son rechazadas por el handler con error `"stream_url_not_http"`. El script
> Python conecta vía HTTP/HTTPS para capturar frames.

---

## 4. Endpoints (auditados)

| Método | Ruta | Auth | Lógica |
|---|---|---|---|
| GET | `/api/surveillance/cameras` | Opcional (anon ve todas; auth filtra por tenant) | Lista cámaras; scope por `?tenant_id=` si presente |
| GET | `/api/surveillance/camera-snapshot?camera_id=N&tenant_id=X` | **Requerida** | Captura frame JPEG via Python script |
| POST | `/api/surveillance/cameras` | Admin (pendiente) | Registrar cámara (no implementado aún) |
| PUT | `/api/surveillance/cameras/{id}` | Admin (pendiente) | Actualizar URL/nombre (no implementado) |

---

## 5. Mecanismo de snapshot (detalle de implementación real)

```cpp
// surveillance_service.cpp — flujo real
const char* scriptEnv = std::getenv("SURVEILLANCE_SNAPSHOT_SCRIPT");
const std::string script = (scriptEnv && scriptEnv[0]) ? scriptEnv
    : "/app/scripts/surveillance_camera_snapshot.py";

// 1. Verificar script existe
if (!fs::exists(script)) return 503 "snapshot_tool_missing";

// 2. Obtener URL de BD (con tenant scope)
SELECT rtmp_url FROM surveillance_cameras WHERE id=$N AND tenant_id=$X::uuid

// 3. Validar URL: SOLO http:// o https://
if (!httpOk) return 400 "stream_url_not_http";

// 4. I/O via archivos temporales (no stdout piping)
fs::path urlPath = tmpDir / ("ic_snap_url_" + tag + ".txt");   // URL input
fs::path outPath = tmpDir / ("ic_snap_out_" + tag + ".jpg");   // JPEG output
ofs << streamUrl;  // escribir URL al archivo temp

// 5. Ejecutar script
cmd = "python3 " + script + " " + urlPath + " " + outPath + " > /dev/null 2>&1";
int rc = std::system(cmd.c_str());

// 6. Leer JPEG y responder
content = readBinary(outPath);  // mínimo 64 bytes
return makeJpegResponse(content);  // Content-Type: image/jpeg
```

**Variables de entorno:**
- `SURVEILLANCE_SNAPSHOT_SCRIPT` — ruta al script Python (default: `/app/scripts/surveillance_camera_snapshot.py`)

---

## 6. Multitenant (Art. 1)

- `GET /cameras`: sin auth → todas las cámaras; con `?tenant_id=X` → filtra por tenant (requiere auth)
- `GET /camera-snapshot`: requiere auth + `tenant_id` param → fuerza scope

Pendiente: la validación en `/cameras` no verifica sesión activa para el scope — cualquier cliente puede pasar cualquier `tenant_id`. Esto debe corregirse para alinear con Art. 1 (solo se puede ver el propio tenant).

---

## 7. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-013-1 | Snapshots (no video streaming) — costo O(cámaras) vs O(bitrate × N) | Aceptado |
| ADR-013-2 | Script Python para captura — no recompilación del backend | Aceptado |
| ADR-013-3 | Solo HTTP/HTTPS para snapshots — control de URL injection | Aceptado |
| ADR-013-4 | Archivos temporales para I/O (no stdout piping) — compatibilidad cross-platform | Aceptado |
| ADR-013-5 | Analítica de video (EPP) en spec 017 — separación de concerns | Aceptado |

---

## 8. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `GET /cameras` → lista con id/name/lat/lng/status | curl response |
| CA-2 | `GET /camera-snapshot?camera_id=N&tenant_id=X` → JPEG > 64 bytes | `curl -o img.jpg; file img.jpg` |
| CA-3 | Token empresa A → 0 cámaras de empresa B | curl empresa A, comparar IDs |
| CA-4 | URL `rtmp://` en BD → 400 `stream_url_not_http` | curl forzando URL rtmp |
| CA-5 | Script Python no existe → 503 `snapshot_tool_missing` | curl sin script |

---

## 9. Pendientes críticos

| Prioridad | Trabajo |
|---|---|
| 🔴 Alta | Validar sesión en `GET /cameras` con `tenant_id` scope (IDOR actual) |
| 🟡 Media | CRUD de cámaras: POST y PUT endpoints (admin) |
| 🟡 Media | Placeholder JPEG cuando snapshot falla (actualmente retorna 502) |
| 🟡 Media | Timeout explícito para script Python (actualmente bloqueante sin límite) |
