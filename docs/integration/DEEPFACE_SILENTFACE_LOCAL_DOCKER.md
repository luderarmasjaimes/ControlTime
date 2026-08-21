# DeepFace + Silent-Face-Anti-Spoofing local en Docker Linux — instalación, operación y conformidad

## Resultado y alcance real

Esta integración permite registro y verificación facial 1:1 completamente
locales: liveness pasivo (Silent-Face-Anti-Spoofing / MiniFASNet, PyTorch) e
identidad (DeepFace / Facenet512, detector YuNet). No se conecta a RENIEC y
no consulta servicios externos durante la operación.

No debe rotularse como "certificado RENIEC", "ISO certificado" o "NIST
certificado". Las normas técnicas describen formatos o métodos de ensayo; una
afirmación de conformidad necesita evidencia del producto/build y, cuando
corresponda, un laboratorio acreditado. Ver ADR-105 (supersede a ADR-104).

## Componentes y procedencia

| Componente | Uso | Procedencia fijada |
|---|---|---|
| Silent-Face-Anti-Spoofing | detector RetinaFace + liveness MiniFASNetV1SE/V2 | commit `b6d5f04ad78778917853b25c778acef6d5626d15`, código vendorizado en `ai_engine/silentface/` |
| DeepFace / Facenet512 | embedding de identidad de 512 componentes | paquete `deepface` (PyPI), pesos oficiales del proyecto |
| YuNet | detector de rostro para DeepFace.represent() | descargado por DeepFace bajo `DEEPFACE_HOME/weights` |
| Backend C++ | orquestación, aislamiento por tenant y comparación 1:1 | SPEC-008 |

Repositorio oficial Silent-Face: <https://github.com/minivision-ai/Silent-Face-Anti-Spoofing>
Licencia: MIT.
Repositorio oficial DeepFace: <https://github.com/serengil/deepface> — MIT.

## Requisitos de host

- Linux x86_64 o Docker Desktop/WSL2 con contenedores Linux.
- Docker Engine/Compose v2.
- GPU opcional: para usar CUDA, el host necesita driver NVIDIA +
  [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
  Sin GPU, el servicio corre en CPU automáticamente (más lento, no falla) —
  quitar el bloque `deploy.resources.reservations.devices` de `ai_engine` en
  `docker-compose.yml` si el host no tiene GPU, o Docker rechazará el `up`.
- Al menos 6 GB de RAM disponibles para el contenedor `ai_engine`
  (TensorFlow + PyTorch + MediaPipe + InsightFace + SeetaFace6 en el mismo
  proceso; ver el límite `memory: 6144M` ya fijado en `docker-compose.yml`).
- Internet solo para instalar dependencias Python en el build y para la
  descarga inicial manual de los pesos (paso siguiente). La operación es
  offline.

## Preparar los modelos

A diferencia de SeetaFace6 (que publica un único ZIP con hash fijo conocido
por el equipo), aquí hay tres orígenes de pesos distintos. **Cada uno debe
descargarse una vez, verificarse con `sha256sum`/`Get-FileHash`, y el hash
resultante debe documentarse en este archivo o en el registro interno del
despliegue antes de usarse en producción** — el mismo control de ADR-104
punto 3, aplicado aquí porque a la fecha de esta integración no existe un
hash oficial único publicado por los tres proyectos de origen.

### 1. Silent-Face-Anti-Spoofing (detección + anti-spoofing)

```bash
mkdir -p biometric-models/deepface_silentface/detection
mkdir -p biometric-models/deepface_silentface/anti_spoof
```

Descargar desde el repo oficial (commit fijado arriba), carpeta `resources/`:

- `resources/detection_model/Widerface-RetinaFace.caffemodel` → `biometric-models/deepface_silentface/detection/`
- `resources/detection_model/deploy.prototxt` → `biometric-models/deepface_silentface/detection/`
- `resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth` → `biometric-models/deepface_silentface/anti_spoof/`
- `resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth` → `biometric-models/deepface_silentface/anti_spoof/`

```bash
sha256sum biometric-models/deepface_silentface/detection/*.caffemodel \
          biometric-models/deepface_silentface/detection/*.prototxt \
          biometric-models/deepface_silentface/anti_spoof/*.pth
# Registrar estos cuatro hashes en el inventario de despliegue antes de producción.
```

### 2. DeepFace / Facenet512 + YuNet

```bash
mkdir -p biometric-models/deepface
```

La forma soportada por la librería es dejar que `deepface` descargue los
pesos una única vez apuntando `DEEPFACE_HOME` a esta carpeta (en una máquina
con salida a Internet, no en el contenedor final de producción):

```bash
DEEPFACE_HOME=./biometric-models/deepface python -c \
  "from deepface import DeepFace; DeepFace.build_model('Facenet512')"
DEEPFACE_HOME=./biometric-models/deepface python -c \
  "import cv2; cv2.FaceDetectorYN.create('', '', (0,0))" 2>/dev/null || true
```

Verificar que `biometric-models/deepface/weights/facenet512_weights.h5` (y el
`.onnx` de YuNet que DeepFace descarga junto a él) existan, calcular su
SHA-256 y documentarlo igual que en el paso anterior. Copiar esa carpeta al
host de despliegue — el contenedor de producción nunca debe tener salida a
Internet para este paso.

## Construir y arrancar

```bash
cp .env.example .env
# completar todos los secretos obligatorios del compose
docker compose build ai_engine web
docker compose up -d ai_engine web
docker compose ps
```

Configuración recomendada para la prueba local (ya son los valores por
defecto en `docker-compose.yml`/`.env.example`):

```dotenv
BEEMETRY_BIOMETRIC_PROVIDER=deepface_silentface
BEEMETRY_DEEPFACE_SILENTFACE_REQUIRED=true
BEEMETRY_DEEPFACE_SILENTFACE_TIMEOUT_MS=25000
BEEMETRY_FACE_DEEPFACE_COSINE_THRESHOLD=0.70
BEEMETRY_SILENTFACE_LIVENESS_THRESHOLD=0.60
BEEMETRY_DEEPFACE_SILENTFACE_DERMALOG_FALLBACK=false
DEEPFACE_WEIGHTS_HOST_DIR=./biometric-models/deepface
DEEPFACE_SILENTFACE_DETECTION_HOST_DIR=./biometric-models/deepface_silentface/detection
DEEPFACE_SILENTFACE_ANTISPOOF_HOST_DIR=./biometric-models/deepface_silentface/anti_spoof
```

`REQUIRED=true` evita degradar silenciosamente a un algoritmo más débil. Para
un entorno que solo quiera demostrar la UI puede ponerse `false` (y
opcionalmente `BEEMETRY_DEEPFACE_SILENTFACE_DERMALOG_FALLBACK=true` si hay
Dermalog configurado), pero no debe usarse así en producción.

## Verificaciones técnicas

Estado del sidecar desde el host:

```bash
docker compose exec ai_engine curl -s http://localhost:5000/health
```

Debe mostrar (recorte relevante):

```json
{
  "deepface_silentface": {
    "available": true,
    "provider": "deepface_silentface",
    "missing_detection_models": [],
    "deepface_ready": true,
    "cuda_available": true,
    "external_apis": false,
    "certification_claim": false
  }
}
```

`cuda_available: false` es válido (corre en CPU) pero implica latencia mayor
al objetivo `<1s` de SPEC-008 — medir antes de producción.

Prueba directa de una imagen autorizada:

```bash
curl -s -F mode=verify -F image=@retrato-prueba.jpg \
  http://localhost:5000/deepface_analyze
```

Una respuesta aceptada debe tener `pass:true`, `liveness.real:true` y
`dim:512`. Una fotografía impresa, pantalla, imagen borrosa, cero/múltiples
rostros o fallo del motor debe producir `pass:false`.

Verificación end-to-end completa (registro + login reales vía UI, rechazo por
spoof, comportamiento fail-closed y cascada opcional a Dermalog) en el plan de
implementación de esta integración — ver commits asociados a ADR-105.

## Matriz frente a estándares habitualmente solicitados

Idéntica a la matriz de `SEETAFACE6_LOCAL_DOCKER.md` — ningún hallazgo de esta
integración cambia las brechas de conformidad documentadas allí (ICAO,
ISO/IEC 39794-5/19794-5/29794-5/19795/30107-3/24745/27001, NIST FRTE/FATE,
RENIEC, Ley 29733). Consultar ese archivo para el detalle completo.

## Plan mínimo de validación antes de producción

Igual al de `SEETAFACE6_LOCAL_DOCKER.md`, agregando:

1. Confirmar `cuda_available:true` en `/health` si el despliegue objetivo
   asume GPU — de lo contrario, recalibrar el objetivo de latencia `<1s`.
2. Medir el impacto de RAM real (TensorFlow + PyTorch + MediaPipe +
   InsightFace + SeetaFace6 cargados en el mismo proceso) contra el límite
   `memory: 6144M` del servicio antes de fijar el límite final.
3. Ejecutar ataques con pantalla, impresión, replay, máscara 2D/3D y
   deepfake contra `/deepface_analyze` específicamente (el ensamble
   MiniFASNetV1SE + MiniFASNetV2 es distinto del PAD de SeetaFace6 y debe
   recalibrarse por separado).

## Limitaciones operativas actuales

- Liveness es pasivo y de un solo frame; no sustituye un reto activo ni un
  sensor de profundidad/IR.
- El umbral `0.70` de similitud (distancia `0.30`) es el valor documentado
  por el equipo, no una cifra certificada.
- Cambiar de SeetaFace6/InsightFace/Dermalog a DeepFace exige reenrolar: las
  plantillas de algoritmos distintos no son interoperables.
- La cascada a Dermalog (`BEEMETRY_DEEPFACE_SILENTFACE_DERMALOG_FALLBACK`)
  solo cubre fallos de infraestructura, nunca rechazos de seguridad — ver
  ADR-105 punto 6.
