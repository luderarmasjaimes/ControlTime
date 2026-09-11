# Bake-off InspireFace (Opción C) — spike aislado, no producción

Contenedor y script separados de `ai_engine/` y `backend/` a propósito: esto
es I+D interno para decidir con números reales si vale la pena invertir en
integrar `InspireFace` (github.com/HyperInspire/InspireFace) como proveedor
biométrico alternativo/complementario al actual (DeepFace/Facenet512 +
Silent-Face-Anti-Spoofing, ver ADR-105). No wirea nada en `biometric_routes.cpp`
ni en el `CMakeLists.txt` de producción.

## ⚠️ Hallazgo de licencia (léase antes de considerar producción)

El propio README de InspireFace dice, textual:

> "The licensing of the open-source models employed by InspireFace adheres to
> the same requirements as InsightFace, specifying their use solely for
> academic purposes and explicitly prohibiting commercial applications."

No hay un archivo `LICENSE` separado para los modelos — esa línea del README
**es** la licencia real de los pesos. El código del SDK es Apache-2.0, pero
sin los packs de modelos (Pikachu/Megatron/etc., los que este spike descarga)
el SDK no hace nada. Beemetry es un producto comercial (plataforma vendida a
empresas mineras) — usar estos packs en producción, sin contactar a
`contact@insightface.ai` por una licencia comercial, viola esa condición.
Mismo patrón de riesgo ya identificado con AnimeGANv2 en
[ADR-074](../../docs/decisions/074-avatar-biometrico-local-hd-bajo-demanda.md).

**Este spike existe solo para medir y documentar** (ver
[ADR-144](../../docs/decisions/144-inspireface-evaluacion-licencia-academica.md)).
No promover InspireFace a proveedor por defecto ni exponerlo a un cliente sin
resolver la licencia primero.

## Qué mide este spike

- **Precisión de verificación 1:1** sobre pares mismo-rostro/distinto-rostro
  armados desde [`vilsonrodrigues/lfw`](https://huggingface.co/datasets/vilsonrodrigues/lfw)
  (HuggingFace, Apache-2.0, 9164 imágenes en formato imagefolder). No es el
  protocolo oficial de pares de LFW (ese dataset no trae `pairs.txt`, y el host
  oficial `vis-www.cs.umass.edu` no era alcanzable desde el sandbox donde se
  escribió este spike) — el nombre de archivo original de LFW
  (`Person_Name_0001.jpg`) sí se conserva en la columna `image.path`, así que
  el script arma sus propios pares genuinos/impostores agrupando por ese
  nombre. Resultado: un número real y reproducible, pero **no comparable bit
  a bit** con cifras publicadas de "accuracy en LFW" de otros modelos — sí es
  comparable en igualdad de condiciones si se corre el mismo manifiesto de
  pares contra el proveedor actual (ver más abajo).
- **Latencia** de detección + extracción de embedding por imagen (CPU).
- **Tasa de no-detección** — proxy de qué tan exigente es el detector de
  InspireFace frente a fotos LFW sin alinear (a diferencia del pipeline ICAO
  propio, que ya filtra encuadre/frontalidad antes de llegar a este punto).

## Qué NO mide (y por qué)

**Liveness / PAD (anti-spoofing)** — ningún dataset de ataques de presentación
(CelebA-Spoof, CASIA-FASD, OULU-NPU, SiW, NUAA) resultó descargable desde el
entorno sandbox usado para armar este spike: la red ahí está restringida a
`github.com`, `huggingface.co` y `pypi.org` (el host oficial de LFW y
Figshare, por ejemplo, no resolvían DNS). Esto es una limitación del entorno
donde se escribió el spike, no de InspireFace ni de la infraestructura real
de Beemetry — el Dockerfile/script está listo para correr en cualquier
entorno con acceso normal a internet.

`bakeoff_lfw.py` no incluye código de PAD todavía. Antes de escribirlo,
conseguir un manifiesto real de imágenes vivo/spoof:

| Dataset | Uso | Licencia |
|---|---|---|
| **CelebA-Spoof** | Live + varios tipos de spoof, gran escala | Investigación, revisar términos exactos |
| **CASIA-FASD**, **Replay-Attack (Idiap)**, **OULU-NPU**, **SiW/SiW-M** | Generalización cross-dataset del PAD | Requieren firmar EULA de investigación |
| **NUAA Photograph Imposter** | Smoke test simple de ataque por foto impresa | Pequeño, rápido de conseguir |

Recordatorio del mismo hallazgo que ya se documentó al proponer esta
investigación: estos datasets son rostros de personas reales sin consentimiento
explícito para este uso — solo QA interno de ingeniería, nunca entrenar/derivar
plantillas de producción ni redistribuir las imágenes.

## Cómo correrlo

```bash
docker build -t inspireface-bakeoff spikes/inspireface_bakeoff
docker run --rm -v "$(pwd)/spikes/inspireface_bakeoff/data:/data" inspireface-bakeoff
```

Primera corrida: descarga el pack `Pikachu` (~16 MB, GitHub Release oficial,
bypasea el downloader por defecto de `isf.launch()` que apunta a ModelScope/OSS)
y el parquet de `vilsonrodrigues/lfw` (~130 MB) hacia `./data/` (persistidos
entre corridas, nunca hacia la imagen). Salida: `data/bakeoff_report.json` con
precisión, latencia y metadatos — impreso también por consola.

Para subir la confianza estadística, subir `PAIRS_PER_CLASS` en
`bakeoff_lfw.py` (por defecto 300 pares por clase, ~600 comparaciones).

## Comparar contra el proveedor actual

El reporte incluye el umbral coseno operativo actual
(`gFaceDeepfaceCosineThreshold=0.70`, ADR-105) solo como referencia — **no**
es una corrida equivalente. Para una comparación real en igualdad de
condiciones: exportar el mismo manifiesto de pares (mismas imágenes, mismos
índices) y correrlo contra `ai_engine/deepface_silentface_adapter.py` (o
`seetaface6_adapter.py`) fuera de este spike, con el mismo criterio de mejor
umbral (`find_best_threshold` en `bakeoff_lfw.py`).
