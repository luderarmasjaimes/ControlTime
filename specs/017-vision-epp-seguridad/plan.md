# PLAN 017 — Visión IA: detección de EPP (a construir)

| Campo | Valor |
|---|---|
| **Spec** | `specs/017-vision-epp-seguridad/spec.md` (Borrador) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S11 · R5 |
| **Constitución** | Art. 7 (IA local), Art. 6 (seguridad), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (plan revisado — arquitectura YOLOv8/ONNX consistente con `face_analysis.cpp` existente) |

---

## 1. Enfoque técnico

**Pipeline de visión por computadora 100% local** (Art. 7) para detectar equipos de
protección personal (EPP) en imágenes de cámaras de la mina: cascos, chalecos,
guantes, botas. La detección se corre sobre los snapshots del sistema CCTV (spec 013)
y/o en frames en tiempo real vía `/api/process_frame`.

**Modelo:** YOLO v8 o RT-DETR exportado a ONNX Runtime — un solo modelo multiclase
(cascos, chalecos, guantes) con inferencia < 200 ms por frame en CPU. En GPU, < 50 ms.

## 2. Arquitectura

```
 Cámara (snapshot cada N s, desde spec 013)
       │
       ▼
 /api/vision/epp-check  (POST, imagen JPEG/PNG base64 o bytes)
       │
 vision_pipeline.cpp
   ├── cv::imdecode → cv::Mat
   ├── onnx_runtime::InferenceSession → modelo EPP
   │   output: [{class_id, label, confidence, bbox}]
   ├── filtrar por confidence_threshold (default 0.6)
   ├── clasificar: cuáles EPP presentes / ausentes
   └── generar resultado: {has_helmet, has_vest, has_gloves, violations[]}

 Si violations[] no vacío:
   ├── INSERT INTO epp_violations (tenant_id, camera_id, ts, worker_id, violations, frame_ref)
   └── pushAlertSse(tenant_id, {type:"epp_violation", violations, camera_id})
         (reutiliza canal SSE de spec 016)
```

## 3. Modelo ONNX

```
Model: yolov8n-epp.onnx   (nano, < 6 MB, optimizado para CPU)
  Classes: ['helmet', 'vest', 'gloves', 'boots', 'no_helmet', 'no_vest']
  Input:  [1, 3, 640, 640]  (RGB normalized)
  Output: [1, N, 84] → boxes + scores por clase
  Export: ultralytics → ONNX opset 17

Requisitos:
  - ONNX Runtime (CPU provider) — sin GPU obligatoria
  - Latencia CPU: < 200 ms por frame (640×640)
  - Precisión mAP@0.5: > 0.75 (dataset minería)
```

## 4. Endpoints

| Método | Ruta | Lógica |
|---|---|---|
| POST | `/api/vision/epp-check` | imagen → detección EPP → resultado + violaciones |
| GET | `/api/vision/epp-violations` | historial de violaciones del tenant |
| GET | `/api/vision/epp-violations/{id}/frame` | frame de la violación (si almacenado) |
| POST | `/api/vision/epp-violations/{id}/dismiss` | descartar falso positivo (auditable) |
| GET | `/api/vision/model-status` | modelo cargado, clases, versión (solo admin) |

## 5. Integración con CCTV (spec 013)

El backend puede configurar un job periódico que toma el snapshot de cada cámara
activa y lo pasa por el pipeline EPP:

```
Cron interno (cada 30 s por cámara):
  1. GET /api/surveillance/camera-snapshot?id=N → JPEG
  2. POST /api/vision/epp-check (interna, sin HTTP) → resultado
  3. Si violación → alerta SSE + INSERT epp_violations
```

## 6. Almacenamiento de frames (privacidad, Art. 7)

- **Opción A (default):** no almacenar el frame — solo los metadatos de la violación.
  Menos costo de disco; sin imágenes de trabajadores en BD.
- **Opción B:** almacenar en MinIO (`telemetry-cold/epp-frames/`) con retención 30 días.
  Requiere consentimiento explícito de los trabajadores.
- Config: `EPP_STORE_FRAMES=false` (default).

## 7. Dataset y entrenamiento (fuera del scope de este plan)

El modelo inicial se entrena con datasets públicos de EPP (COCO-EPP, OpenImages).
El fine-tuning con imágenes de la mina específica es trabajo del sprint S11 (ML team).

## 8. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-017-1 | **ONNX Runtime** (no Torch en prod) — menor huella de memoria | Propuesto |
| ADR-017-2 | **YOLOv8n** (nano) — balance precisión/velocidad en CPU | Propuesto |
| ADR-017-3 | **No almacenar frames** por defecto (privacidad) — opt-in con `EPP_STORE_FRAMES` | Propuesto |
| ADR-017-4 | Integrar alertas EPP en el **canal SSE de spec 016** (no canal separado) | Propuesto |

## 9. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Foto con casco → `{has_helmet:true, violations:[]}` | curl response |
| CA-2 | Foto sin casco → `{has_helmet:false, violations:["no_helmet"]}` | curl response |
| CA-3 | Violación detectada → alerta en SSE `/api/live/alerts` en < 2 s | `curl -N` |
| CA-4 | Empresa A no ve violaciones de empresa B | aislamiento |
| CA-5 | Latencia inferencia < 200 ms en CPU | `time curl` |
| CA-6 | Snapshot CCTV → EPP check automático (integración 013+017) | log de job periódico |
