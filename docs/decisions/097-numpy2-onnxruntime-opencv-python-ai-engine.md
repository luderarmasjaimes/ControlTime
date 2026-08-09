# ADR-097 — ai_engine: migración a NumPy 2.x, onnxruntime 1.23.2, opencv-python-headless 4.14.x

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: ia
**Relación**: contraparte Python de ADR-096; precondición de ADR-099 y
ADR-100 (ambos requieren que InsightFace/onnxruntime funcionen primero).

## Contexto

`ai_engine/requirements.txt` no tenía techo de versión en ninguna de sus
dependencias de IA. Un rebuild sin caché trajo, sin que nadie lo decidiera:
mediapipe 0.10.x→**1.0.0**, opencv-python-headless 4.x→**5.0.0**,
onnxruntime→**1.23.2**, insightface 0.7.x→**1.0.1** — versiones mayores
liberadas en las semanas previas a esta sesión (jul-jun 2026), sin ningún
ciclo de prueba propio. Esto rompió la validación facial en producción sin
que ningún commit de código lo causara: el usuario reportó "no valida" y
"antes funcionaba" el mismo día.

Se investigó cada librería por separado (fecha de release, notas de
cambios, compatibilidad de Python) antes de decidir qué actualizar:

- **onnxruntime≥1.24 ya exige Python≥3.11** — este contenedor corre
  Python 3.10 (`Dockerfile.ai:1`). La última versión con wheel `cp310`
  es 1.23.2 (oct-2025), que además es justo lo que `pip` elegía sin
  tope — ya validado en la práctica.
- **opencv-python-headless≥4.12.0.88 ya exige `numpy>=2`** — no fue una
  decisión aislada de subir numpy, fue la consecuencia directa de
  querer una versión reciente de esta librería.
- **mediapipe 1.0.0** (jul-2026, ~11 días de antigüedad al momento de
  evaluar): primera versión que sale de "alpha" según la propia
  documentación del proyecto, con cambios de "namespacing" documentados
  en su changelog para la Tasks API de Python — se decide **no migrar**
  todavía, mantener `<0.11` (resuelve a 0.10.35).
- **insightface 1.0.x** (may-2026): saltó directo de 0.7.3 (abr-2023,
  tres años sin release intermedio) a 1.0/1.0.1, con changelog que
  menciona "relocation of certain requirements to optional extras" —
  riesgo real de que `from insightface.app import FaceAnalysis` deje de
  funcionar con un `pip install insightface` simple. Se decide **no
  migrar**, mantener 0.7.3.

## Decisión

1. **`numpy>=2,<3`**: la migración en sí. Bloqueador real resuelto en
   el punto 3 (no es solo un cambio de pin).
2. **`opencv-python-headless>=4.14,<5`**: última release de la línea
   4.x estable (4.14.0.94, jul-2026). Se descarta 5.0.0 pese a que su
   propia documentación dice "casi sin cambios de API" para Python —
   tiene ~2 meses de antigüedad, sin ciclo de prueba con
   mediapipe/insightface en este proyecto.
3. **`opencv-contrib-python<5`** (pin nuevo, no declarado antes):
   dependencia transitiva no explícita (de `albumentations`, que a su
   vez la trae `insightface`) que comparte el paquete `cv2` con
   `opencv-python-headless` — quien se instale después sobreescribe los
   archivos del otro en `site-packages`. Sin este pin, traía 5.0.0.93 y
   ganaba la carrera de instalación, dejando `cv2.__version__` en 5.0
   pese al `<5` de la línea de arriba (comportamiento reproducido y
   confirmado durante la implementación).
4. **`onnxruntime>=1.16.0,<1.24`**: resuelve a 1.23.2.
5. **`face_embedding_insight.py`**: InsightFace 0.7.3 usa `np.int` en
   `insightface/app/face_analysis.py:84` — alias eliminado por NumPy en
   1.24+ (`AttributeError` en seco, no advertencia). Bug confirmado y ya
   corregido en la rama `master` del proyecto pero nunca publicado a
   PyPI (`github.com/deepinsight/insightface/issues/2404`). Se restauran
   los alias (`np.int`, `np.float`, `np.bool`, `np.object`, `np.str`)
   antes de importar el paquete — shim local, no un fork ni un install
   sin pin desde GitHub.

## Verificación

- `docker exec beemetry-ai-vision python3 -c "import cv2, numpy, ..."`
  confirmó las versiones finales: `numpy 2.2.6`, `cv2 4.14.0`,
  `mediapipe 0.10.35`, `onnxruntime 1.23.2`, `insightface 0.7.3`.
- Logs de arranque: `[FACE_EMB] InsightFace listo: name=buffalo_l...`
  sin traceback — antes del shim, crasheaba en seco con
  `AttributeError: module 'numpy' has no attribute 'int'`.
- Extremo a extremo contra el stack real (`curl` a
  `/api/process_frame`, `/api/status`, `/api/auth/biometric/verify-frame`
  con una imagen de rostro): `provider: "insightface_onnx"`,
  `quality_score: 1.0` — el embedding de alta seguridad funciona de
  punta a punta con las versiones nuevas.
- Se reprodujo el conflicto de `opencv-contrib-python` antes de fijarlo
  (`cv2.__version__` en 5.0.0 pese al pin de `opencv-python-headless`),
  y se confirmó resuelto después (`cv2.__version__` → 4.14.0).

## Consecuencias

- `ai_engine/requirements.txt` queda con comentarios extensos
  documentando el *por qué* de cada techo de versión — decisión
  deliberada dado que esta misma falta de documentación fue la causa
  raíz del incidente que motivó este ADR.
- mediapipe e insightface quedan una generación mayor por detrás de lo
  disponible en PyPI — revisar en 1-2 meses cuando esas versiones
  tengan más uso en producción por terceros.
- Python 3.10 (base de `Dockerfile.ai`) es ahora el límite real que
  impide subir onnxruntime más allá de 1.23.2. Subir a Python 3.11/3.12
  es una migración aparte, con su propia evaluación de compatibilidad
  de wheels para cada librería — no se aborda en este ADR.

## Alternativas descartadas

- **Migrar también mediapipe e insightface a sus últimas versiones
  mayores**: descartado — ambas son releases muy recientes (semanas/
  meses) con cambios de API/paquete documentados por los propios
  proyectos, sin ciclo de prueba. Migrarlas junto con numpy habría
  mezclado una causa raíz confirmada (numpy) con dos apuestas sin
  validar, dificultando diagnosticar cualquier regresión nueva.
- **Fijar `numpy<2` indefinidamente** (evitar la migración): descartado
  a pedido explícito — mantenerlo habría seguido bloqueando
  `opencv-python-headless` en la línea 4.11.x para siempre.

## Referencias

- `ai_engine/requirements.txt`
- `ai_engine/face_embedding_insight.py`
- `ai_engine/Dockerfile.ai` (Python 3.10 base)
- ADR-096 (`opencv-4-12-vcpkg-backend`)
- ADR-100 (`onnxruntime-thread-limit-insightface`)
