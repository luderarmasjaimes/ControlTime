# ADR-105 — DeepFace + Silent-Face-Anti-Spoofing como proveedor biométrico local por defecto

**Status**: implemented (2026-08-12)
**Fecha**: 2026-08-12
**Ámbito**: ia, seguridad, biometría
**Relación**: SPEC-008; **supersede a ADR-104** como proveedor local por defecto
y **supersede parcialmente a ADR-089** en la prioridad de proveedores;
complementa ADR-025 y ADR-099.

## Contexto

ADR-104 eligió SeetaFace6 como proveedor biométrico local por defecto. Durante
la evaluación de esta decisión se encontró que, en modo de almacenamiento
Postgres (el modo real de producción multitenant), `loginFaceTargetedPg()`
nunca tuvo una rama de despacho para `face_template_provider =
'seetaface6_local'` — solo para `insightface_onnx` y `dermalog_cli` — pese a
que el registro sí graba ese valor cuando `BEEMETRY_BIOMETRIC_PROVIDER=seetaface6`.
En la práctica, cualquier cuenta registrada con SeetaFace6 bajo Postgres caía
al `else` de rechazo ("método que ya no se considera seguro") y su login
facial quedaba permanentemente bloqueado, aunque el registro hubiera
funcionado. Este defecto es anterior a esta decisión, no introducido por ella.

En paralelo, se recibió una implementación ya probada por el equipo —
DeepFace (Facenet512) para identidad y Silent-Face-Anti-Spoofing (MiniFASNet)
para vividez pasiva — junto con un documento técnico que fija sus umbrales
operativos. Se decidió adoptarla como proveedor primario en vez de corregir
únicamente el defecto de despacho de SeetaFace6.

## Decisión

1. Incorporar `BiometricProvider::DeepFaceSilent`, seleccionable mediante
   `BEEMETRY_BIOMETRIC_PROVIDER=deepface_silentface` (default en
   `docker-compose.yml`). `SeetaFace6` permanece en el enum por compatibilidad
   y rollback, pero deja de ser el proveedor por defecto.
2. Vendorizar el código de inferencia (MIT) de
   `minivision-ai/Silent-Face-Anti-Spoofing` en `ai_engine/silentface/`,
   commit `b6d5f04ad78778917853b25c778acef6d5626d15`, análogo a cómo ADR-104
   fija el commit de SeetaFace6Open.
3. Ejecutar liveness (ensamble MiniFASNetV1SE + MiniFASNetV2 sobre los
   `.pth` disponibles) **antes** de extraer cualquier embedding. Solo clase 1
   (piel viva) con confianza > 60% permite continuar; de lo contrario se
   rechaza con `spoof_or_screen_detected`, igual principio fail-closed que
   ADR-104 punto 4.
4. Extraer identidad con `DeepFace.represent(model_name="Facenet512",
   detector_backend="yunet")`, 512 componentes. Comparación 1:1 por
   similitud coseno; el documento de referencia especifica "distancia < 0.30",
   que en la convención de este código (similitud, no distancia) equivale a
   `similitud >= 0.70` (`BEEMETRY_FACE_DEEPFACE_COSINE_THRESHOLD`).
5. En este modo se ignora cualquier plantilla suministrada por el cliente: se
   reextrae siempre de la imagen en el servidor (mismo principio que ADR-104
   punto 5) — impide omitir el liveness enviando un vector fabricado.
6. **Dermalog como secundario explícito, nunca como bypass de seguridad**:
   `BEEMETRY_DEEPFACE_SILENTFACE_DERMALOG_FALLBACK=true` solo permite caer a
   Dermalog cuando `BEEMETRY_DEEPFACE_SILENTFACE_REQUIRED=false` **y** el
   fallo fue de infraestructura (ai_engine caído, timeout, error HTTP) — nunca
   ante un rechazo de seguridad (spoof, no-match, sin rostro, calidad
   insuficiente). Ver `analyzeFaceImage()` en `face_analysis.cpp`.
7. Corregir el defecto de despacho descrito en el Contexto **para el nuevo
   proveedor**: `loginFaceTargetedPg()` gana una rama explícita para
   `deepface_silentface` que reevalúa la imagen contra `ai_engine` en cada
   login (nunca confía en `clientProbeTemplate`). La rama faltante de
   `seetaface6_local` no se agrega — ese proveedor queda heredado y sin uso
   por defecto.
8. GPU opcional: `torch`/`tensorflow` se instalan con ruedas CUDA 12.1/12.x
   embebidas vía pip (`requirements.txt`), sin cambiar la imagen base del
   contenedor. Sin GPU visible en el host, `torch.cuda.is_available()` es
   `false` y el servicio corre en CPU sin fallar — este es el primer servicio
   del stack que usa GPU (Ollama corre explícitamente sin GPU mapeada hoy).
9. Modelos (RetinaFace de detección, `.pth` de anti-spoofing, pesos de
   Facenet512/YuNet) se montan read-only desde fuera de la imagen, igual
   patrón que ADR-104 punto 3 — nunca se descargan en runtime.
10. Exponer `certification_claim=false` en `/api/auth/biometric/status`, igual
    principio que ADR-104 punto 8.

## Controles y límites

- Todo el procesamiento facial ocurre dentro de la red Docker local.
- Los `.pth`/`.caffemodel`/pesos de Facenet512 se montan read-only; el
  contenedor no los descarga en runtime (`DEEPFACE_HOME`,
  `SILENTFACE_DETECTION_MODEL_DIR`, `SILENTFACE_ANTISPOOF_MODEL_DIR`).
- Liveness de un solo frame es una capa útil, no prueba suficiente de
  resistencia avanzada (mismo límite ya documentado para SeetaFace6 en
  ADR-104, sección "Controles y límites").
- El umbral `0.70` de similitud (equivalente a distancia `0.30`) es el valor
  documentado por el equipo, no una cifra certificada — requiere calibración
  local con FMR/FNMR antes de producción (SPEC-008 CA-10).
- Cambiar de SeetaFace6/InsightFace/Dermalog a DeepFace exige reenrolar: las
  plantillas de algoritmos distintos no son interoperables.

## Consecuencias

El contenedor `ai_engine` incorpora TensorFlow y PyTorch (con CUDA embebido
vía pip), aumentando su tamaño de imagen y su huella de memoria en runtime
frente al stack previo, deliberadamente liviano (solo ONNX Runtime). El
límite de memoria del servicio en `docker-compose.yml` sube de 3072M a
6144M. El primer arranque con `WARMUP_DEEPFACE=1` paga el cold-start de
ambos frameworks para que el primer login real no lo sufra. Sin GPU en el
host, la latencia puede superar el objetivo de `<1s` de SPEC-008 — medir y,
si es necesario, restringir el uso a hosts con GPU.

## Evidencia necesaria antes de afirmar conformidad

Igual a ADR-104: TDR/especificación RENIEC exacta, ensayo independiente
ISO/IEC 19795 (FMR/FNMR/FTE/FTA), ensayo PAD ISO/IEC 30107-3, perfil de
imagen/intercambio solicitado, DPIA/evaluación de impacto conforme a Perú.
Ningún resultado de este documento sustituye esa evidencia.
