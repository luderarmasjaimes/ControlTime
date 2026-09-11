# ADR-163 — Curación del dataset con/sin lentes y reentrenamiento del clasificador ONNX

**Status**: partial — curación v2 (17 reglas) completa y verificada; entrenamiento final (v4) en curso; validación contra `glasses_probe.jsonl` real pendiente antes de promover a producción
**Fecha**: 2026-09-08 (segunda ronda de criterios y resultado final: 2026-09-10)

## Actualización 2026-09-10 — segunda ronda de criterios, piloto, y resultado final

Tras revisar manualmente `glasses_dataset_curated/with_glasses` el usuario encontró 3 problemas
reales que la primera ronda de criterios (sección "Decisión" más abajo) no detectaba: retratos
antiguos/pinturas (incluye literalmente cuadros de museo y fotos sepia de 1800-1900), un recorte
extremo de solo-cara sin hombros/torso, y una silueta a contraluz sin rasgos distinguibles. Se
agregaron 4 reglas nuevas a `data/curate_glasses_dataset.py` (17 en total), cada una calibrada con
muestreo real de 900-2000 imágenes para medir el costo contra el pool ya validado antes de fijar
el umbral (ver detalle de metodología en el código, sección "Nuevos criterios"):

- `grayscale_or_bw` (diferencia media R/G/B < 12.0): atrapa fotos B&W/sepia de archivo.
- `posterized_or_low_color_detail` (colores únicos < 5% de píxeles): atrapa imágenes degradadas.
- `face_features_not_visible` (contraste local en ojos/nariz/boca < 10.0, medido sobre los 5
  puntos de referencia del detector, no sobre el rostro completo): atrapa siluetas/contraluz.
- `face_too_close_no_torso` (`face_h_frac` > 0.90): atrapa recortes de solo-cara — decisión con
  impacto grande (hasta 58.7% del pool original medido en muestreo), el usuario eligió 0.90 a
  propósito para no sacrificar la mayoría del pool ya validado.

**Piloto de validación** (2000 imágenes antes de comprometer la corrida completa): 52.2% de
aprobación, proyectando ~58,000 imágenes finales — validado casi exacto contra el resultado real
final (52.0%, 57,935 imágenes).

**Corrección de rendimiento real encontrada en producción**: el contenedor `beemetry-ai-vision`
también corre `eye_analyzer.py` (el servicio de login/registro facial en producción) — el script
de curación, con su propio `FaceAnalysis` sin límite de hilos, saturaba el contenedor a 1188% CPU
compitiendo por las mismas CPUs que el tráfico de login real. Corregido replicando el mismo patrón
de ADR-100 (monkeypatch de `intra_op_num_threads` en onnxruntime, antes solo aplicado en
`face_embedding_insight.py`) más `cv2.setNumThreads(1)` y detección de la cuota real del cgroup
(en vez de `os.cpu_count()`, que devuelve los núcleos del host, no la cuota del contenedor) —
resultado: **de ~1.9 img/s a ~51.7 img/s, ~25x más rápido**, y sin competir por CPU con el login
real (prioridad de proceso bajada con `os.nice`).

**Resultado final de la corrida completa** (111,246 imágenes, con las fuentes fusionadas de la
sección 2b): **57,935 aprobadas (52.0%)** — 40,533 con lentes / 17,402 sin lentes. Se entrenaron 6
checkpoints incrementales cada 10,000 imágenes válidas (ver también hallazgo y fix de un bug real:
el primer intento de checkpoint salió con 0 imágenes sin lentes porque el pool se procesaba
`with_glasses` completo antes de tocar `without_glasses`; corregido intercalando 1 a 1 entre
ambas etiquetas desde el `todo` list). El `val_acc` de los checkpoints bajó de 98.35% (con
desbalance artificial 68:1, básicamente el atajo de predecir siempre "con lentes") a
**94.37-94.70%, estable**, conforme el balance de clases se acercó a la proporción natural del
pool (~2:1). Entrenamiento final (v4, 8 épocas, mismo pool completo) en curso — resultado y
comparación contra v2/v3 se agregan a la sección "Reentrenamiento sobre el pool curado" más abajo.

## Contexto
**Autores**: Luder Armas (pedido explícito 2026-09-07) + Claude Sonnet 5 (implementación)
**Ámbito**: ia
**Relación**: consume el pool de imágenes usado por `ai_engine/scripts/train_glasses_onnx.py`
(el mismo script que produjo `glasses_classifier.onnx`/`glasses_classifier_v2.onnx`); el
clasificador resultante es uno de los dos componentes que alimenta `apply_glasses_fusion_pipeline`
en `ai_engine/eye_analyzer.py`, corregido por ADR-119 (fusión CV+ONNX, veto→confirmación
simétrica) y ADR-100 (umbral de veto original).

## Contexto

Pedido explícito del usuario (2026-09-07): el pool de entrenamiento `data/glasses_dataset/`
(66,278 imágenes descargadas de Wikimedia Commons + CelebA, ver `data/commons_download_*.py`)
nunca había sido revisado imagen por imagen. Contenía "basura" mezclada con el resto: fotos de
cuerpo entero, varias personas por imagen, rostros de perfil, borrosas, oscuras, niños y adultos
muy mayores (poco representativos del universo de usuarios reales del sistema) — todo etiquetado
solo por la carpeta de origen (`with_glasses`/`without_glasses`), sin ninguna validación de
contenido.

El clasificador ONNX actualmente en producción (`glasses_classifier_v2.onnx`, ver ADR-119 §3 y
`apply_glasses_fusion_pipeline`) se entrenó el 2026-09-05 **directamente sobre ese pool sin
curar** (15,624 con lentes / 20,311 sin lentes, `val_acc`=0.9824) — es decir, la señal ONNX que
hoy promueve "sin lentes"→"con lentes" cuando la CV no dispara (ADR-119) aprendió de un dataset
con una fracción no cuantificada de ejemplos de baja calidad o mal encuadrados.

## Decisión

### 1. Curación automática con criterios explícitos del usuario

Nuevo script `data/curate_glasses_dataset.py`, corrido dentro del contenedor
`beemetry-ai-vision` (mismo entorno que ya tiene InsightFace + pesos precargados). Reutiliza
**InsightFace buffalo_l** — el mismo paquete que ya usa `face_embedding_insight.py` en
producción — pero cargando solo los submódulos necesarios (`detection` + `genderage` +
`landmark_3d_68`, este último da `pose=[yaw,pitch,roll]` sin recalcularlo a mano) y
descartando a propósito `recognition` (el módulo de embedding 512-d, w600k_r50): es, por
lejos, el más caro (~4.2s/imagen en CPU vs. ~1s/imagen sin él — medido en este mismo entorno,
i9-14900HX, antes de decidir esto) y no hace falta para curar.

Criterios de descarte, todos pedidos explícitamente por el usuario salvo el punto (g):

- (a) Exactamente 1 rostro detectado (descarta fotos grupales).
- (b) Rostro de frente: `|yaw| ≤ 25°`, `|roll| ≤ 20°`.
- (c) Calidad: brillo medio del recorte de rostro ≥ 45 (gris 0-255), varianza de Laplaciano
  (200×200, desenfoque) ≥ 60.
- (d) Encuadre rostro-hasta-hombros: `face_h_px / image_h ≥ 0.15` y `face_h_px ≥ 40px`
  (descarta cuerpo entero / foto muy alejada).
- (e) Excluye niños (edad estimada < 14) y adultos muy mayores (edad estimada > 72) —
  margen deliberadamente amplio porque el estimador de InsightFace tiene un error típico de
  ±5-8 años; solo corta los casos claros.
- (f) **Sin filtro por género** — pedido explícito: incluir hombres y mujeres por igual: se
  registra el género estimado solo a fines de auditoría, nunca se usa para descartar.
- (g) Agregado por criterio propio ("cualquier otra condición que permita mejores
  resultados"): duplicados exactos por hash SHA1 y archivos ilegibles/corruptos.

Paralelizado con `multiprocessing` (10 workers en la corrida real, cada uno con su propia
instancia de `FaceAnalysis` y `OMP_NUM_THREADS=1` para no competir por los mismos hilos).
Reanudable: si `glasses_dataset_curation_report.jsonl` ya existe, las rutas ya presentes se
saltan. Las imágenes originales en `glasses_dataset/` **nunca se tocan ni se borran** — el
resultado se escribe aparte, por hardlink (o copia si el filesystem no lo permite), en
`glasses_dataset_curated/{with_glasses,without_glasses}/`.

### 2. Resultado de la corrida completa (no una muestra)

Log completo: `data/glasses_curation_full_run.log`. Reporte por imagen (path, label, kept,
reasons, metrics): `data/glasses_dataset_curation_report.jsonl`.

| | Cantidad |
|---|---|
| Imágenes procesadas (esta corrida) | 66,038 |
| Conservadas | 53,267 (80.7%) |
| Descartadas | 12,771 (19.3%) |
| Tiempo total | ~25,670s (~7.1 h) |

Motivos de descarte (una imagen puede acumular más de uno):

| Motivo | Cantidad |
|---|---|
| `too_blurry` | 6,205 |
| `likely_very_elderly` | 3,648 |
| `likely_child` | 1,145 |
| `multiple_faces` | 985 |
| `too_dark` | 814 |
| `not_frontal_yaw` | 756 |
| `head_tilted_roll` | 144 |
| `duplicate_of` | 115 |
| `no_face` | 19 |

Pool curado final (incluye corridas previas parciales, de ahí que no coincida 1:1 con el
`kept` de esta corrida): `data/glasses_dataset_curated/` — **23,403 con lentes / 30,052 sin
lentes = 53,455 imágenes**.

### 2b. Fusión de fuentes sin usar detectadas al auditar espacio en disco (2026-09-08)

Al investigar por qué `D:` estaba al 100% (crisis aparte, ver sección "Consecuencias
operativas" más abajo), aparecieron dos fuentes de imágenes de rostros **descargadas pero
nunca incorporadas** al pool de entrenamiento:

- `data/commons_glasses/` (15,192 imágenes: 10,145 con lentes / 5,054 sin lentes, con
  `filelist.json`/`licenses.json` de licencias Wikimedia verificadas) — staging de
  `commons_download_with_glasses.py`/`commons_download_no_glasses.py`, nunca copiado a
  `glasses_dataset/`. Confirmado por comparación de nombres de archivo: 0% de coincidencia
  con lo ya existente en `glasses_dataset/`.
- `data/sof_raw/` (42,592 imágenes) — dataset académico **SoF (Specs on Faces**, Afifi &
  Abdelhamed), identificado por el patrón de nombre de archivo
  (`AbdA_00002_m_31_i_fr_nc_sr_2016_2_e0_Gn_e.jpg`).

**Hallazgo crítico de verificación visual, previo a fusionar**: se hipotetizó inicialmente
que el campo de nombre `Gn`/`Gs`/`Ps`/`nl` (posición 11, separado por `_`) codificaba
presencia de lentes (`nl`="no lens"=sin lentes, el resto=con lentes) — análisis de
frecuencia por posición mostró 4 valores con conteos muy sugerentes (`nl`=18,634; `Gn`,
`Ps`, `Gs`≈7,984 cada uno, diseño experimental balanceado). Antes de confiar en esa
hipótesis se verificó VISUALMENTE (Read de las imágenes, no solo el nombre) con 6 sujetos
distintos elegidos al azar, incluyendo las 4 variantes de un mismo sujeto: **en las 6/6
fotos revisadas, incluidas todas las etiquetadas `nl`, el sujeto aparece usando lentes**.
Conclusión: SoF es un dataset donde **todos los sujetos usan lentes en todas sus fotos**
(diseñado para estudiar reconocimiento facial a pesar de la oclusión por lentes, no para
comparar con/sin lentes por sujeto) — el campo `Gn/Gs/Ps/nl` codifica condición de
captura (iluminación/ángulo/efecto), no presencia de lentes. Usar esa hipótesis inicial
sin verificar habría introducido ~18,634 imágenes con lentes mal etiquetadas como "sin
lentes" en el entrenamiento — corrupción silenciosa de datos, del tipo que no se nota
hasta producción. Misma lección que ADR-119 §3: no confiar en una heurística de
nomenclatura/umbral sin verificarla contra evidencia real antes de usarla para decidir.

**Decisión del usuario** (pedido explícito, 2026-09-08): fusionar ambas fuentes al pool
crudo de `glasses_dataset/` para una futura v4 —
`commons_glasses/{with_glasses,without_glasses}` respetando su split real, y **el 100% de
`sof_raw` a la clase `with_glasses`** (única clase válida dado el hallazgo anterior),
aceptando el desbalance resultante (con lentes queda sobrerrepresentada) a cambio de más
variedad real de rostros con lentes — confía en que el entrenamiento compense el
desbalance (class weights / muestreo) en vez de descartar datos válidos.

Movidos (no copiados — mismo filesystem, sin costo de espacio adicional) con prefijo de
procedencia para trazabilidad (`cg_` para Commons, `sof_` para SoF, evita colisiones de
nombre): 10,145 + 42,592 → `with_glasses/`, 5,054 → `without_glasses/`. 0 colisiones, 0
errores. Los JSON de licencias/metadata de `commons_glasses/` NO se movieron ni se
borraron (quedan como registro de auditoría de licencia por archivo, referenciable por
nombre). Pool crudo total tras la fusión: **76,140 con lentes / 35,106 sin lentes =
111,246 imágenes**, de las cuales solo 53,455 (las de la sección 2) ya pasaron curación —
**pendiente**: correr `curate_glasses_dataset.py` sobre las 57,791 imágenes nuevas antes de
usarlas para entrenar (mismos criterios, script sin cambios, reanudable — salta las rutas
ya procesadas).

### 3. Reentrenamiento sobre el pool curado (v3)

`ai_engine/scripts/train_glasses_onnx.py --data_root data/glasses_dataset_curated
--out_onnx ai_engine/models/glasses_classifier_v3.onnx --epochs 8 --batch_size 32
--num_workers 8`, mismo backbone que v1/v2 (MobileNetV2 preentrenado en ImageNet, solo la
cabeza clasificadora entrenable), corrido localmente en CPU (32 hilos disponibles, sin CUDA).

**Resultado (2026-09-08, 88.8 min de entrenamiento, CPU)**:

| | v2 (producción actual) | v3 (pool curado) |
|---|---|---|
| Fecha de entrenamiento | 2026-09-05 | 2026-09-08 |
| Dataset | 15,624 con lentes / 20,311 sin (crudo, sin curar) | 23,403 con lentes / 30,052 sin (curado) |
| `val_acc` | 0.9824 | 0.9630 |

**v3 salió con `val_acc` menor que v2** pese a entrenar sobre datos ya curados. Hipótesis
más probable: la curación eliminó duplicados exactos (hash SHA1) que en v2 podían quedar
repartidos entre train/val (fuga de datos que infla el `val_acc` reportado sin reflejar
generalización real); el split de validación de v3, sin esos duplicados, es más honesto
pero también más exigente — no es necesariamente una señal de que el modelo sea peor en
producción. **Conclusión: `val_acc` por sí solo no alcanza para decidir** — se necesita la
validación contra datos reales de cámara (`glasses_probe.jsonl`, sección "Verificación")
antes de promover `GLASSES_ONNX_PATH` a v3. No se cambió la configuración de producción.

## Verificación

- Curación: corrida completa registrada en `glasses_curation_full_run.log` (línea `[CURATE]
  DONE`), reporte línea-por-imagen íntegro en `glasses_dataset_curation_report.jsonl`
  (25.9 MB, 66k+ líneas), conteos de `glasses_dataset_curated/` verificados contra el log.
- Reentrenamiento v3: pendiente — se completa esta sección con `val_acc`, tiempo total y
  comparación cuantitativa contra `glasses_classifier_v2_training_report.json` una vez
  termine.
- **Validación real completada (2026-09-10, v4)**: `glasses_probe.jsonl` resultó no
  aprovechable para esto — investigado a fondo (inventario completo de sus claves,
  incluido `glasses_debug` anidado): solo guarda métricas ya calculadas por el pipeline
  viejo (roi, scores, `onnx_prob` del modelo QUE ESTABA activo en ese momento), nunca la
  imagen cruda ni una ruta a ella — no hay forma de recalcular qué diría v4 sobre esos
  frames exactos. En su lugar: v4 se desplegó en el entorno de prueba
  (`GLASSES_ONNX_PATH` → v4, contenedor `beemetry-ai-vision` recreado, verificado sin
  error de carga vía `/health`) y se corrieron **171 fotos reales de la misma webcam de
  producción** (Windows Camera Roll, dos sesiones consecutivas reales tomadas por el
  usuario: 69 con lentes, 102 sin lentes) contra el endpoint real `/analyze_eyes` —
  pipeline completo (MediaPipe → ROI real → CV → fusión ONNX), no una aproximación offline.

  | Condición | Frames | Decisión final correcta |
  |---|---|---|
  | Con lentes | 69 | 67/69 (97.1%) |
  | Sin lentes | 102 | 102/102 (100%) |
  | **Total** | **171** | **169/171 (98.8%)** |

  Hallazgo real: **v4 aislado (`glasses_onnx_prob`) es 100% correcto detectando lentes
  puestos** (prob 0.86-1.0, mediana 0.997), pero tiene sesgo real hacia "con lentes" en
  negativos (31.4% falsos positivos en frames sin lentes — coherente con el desbalance
  final del dataset, 40,533 con / 17,402 sin). La fusión CV+ONNX ya existente
  (`cv_primary`, ADR-119) corrige esto en la práctica: en los 5 frames donde v4 fallaba
  con más confianza (prob 0.79-0.88), el CV score bajo (32.0) mantuvo la decisión final
  correcta las 102/102 veces. Los 2 únicos fallos del sistema completo son los frames 1 y
  2 de la sesión con lentes (`onnx_prob=0.999` ya desde el frame 1, corregido en el frame
  3) — efecto de la ventana de confirmación de entrada de ADR-119
  (`GLASSES_ONNX_ENTRY_CONFIRM_FRAMES`), sin impacto real en producción porque el gate de
  registro/login exige 5 lecturas ICAO válidas consecutivas, nunca decide sobre un frame
  aislado. Con esta evidencia, v4 tiene una base real (no solo `val_acc` de entrenamiento)
  para evaluar su promoción a `GLASSES_ONNX_PATH` de producción.

## Consecuencias

- El pool de entrenamiento pasa a tener dos versiones con procedencia distinta:
  `glasses_dataset/` (crudo, nunca se borra, sirve de fuente para futuras curaciones con
  otros criterios) y `glasses_dataset_curated/` (filtrado, es el que se usa para entrenar
  de acá en adelante). `train_glasses_onnx.py` no cambió — solo cambia el `--data_root` que
  se le pasa.
- Ni el script de curación ni sus artefactos (`glasses_dataset_curation_report.jsonl`,
  `glasses_curation_full_run.log`, `glasses_dataset_curated/`) estaban en git al momento de
  escribir este ADR — quedan pendientes de commit (el `.jsonl` y las imágenes curadas son
  pesados; evaluar si corresponden a Git LFS o quedan fuera de control de versiones con solo
  el script y este ADR como fuente de verdad reproducible).
- Los umbrales (yaw/roll/edad/brillo/blur) quedan documentados en el propio script
  (`data/curate_glasses_dataset.py`, sección "Umbrales") como constantes ajustables — no
  hay obligación de re-derivarlos leyendo el reporte si hace falta afinar la curación
  después.

## Alternativas descartadas

- **Revisión manual imagen por imagen**: descartado por escala — 66,278 imágenes hacen
  inviable una revisión humana en tiempo razonable; los criterios pedidos (frontalidad,
  una sola persona, calidad, encuadre, edad) son todos medibles automáticamente con el
  mismo detector ya usado en producción, sin introducir una librería nueva.
- **Cargar el módulo `recognition` de InsightFace durante la curación** (para además
  deduplicar por similitud de identidad, no solo hash exacto): descartado por costo —
  ~4.2s/imagen vs. ~1s/imagen sin él, multiplicado por 66k imágenes habría llevado la
  corrida de ~7h a ~29h sin necesidad, dado que el objetivo de esta curación es calidad de
  imagen/encuadre, no deduplicación de identidad.

## Referencias

- `data/curate_glasses_dataset.py` (criterios, umbrales, paralelización)
- `data/glasses_dataset_curation_report.jsonl` (evidencia línea-por-imagen)
- `data/glasses_curation_full_run.log` (resumen de la corrida completa)
- `ai_engine/scripts/train_glasses_onnx.py` (entrenamiento, sin cambios de lógica)
- `ai_engine/models/glasses_classifier_v2_training_report.json` (baseline pre-curación)
- ADR-119 (`validacion-lentes-biometria-login-y-fusion-onnx`, consumidor del clasificador)
- ADR-100 (`onnxruntime-thread-limit-insightface`, veto ONNX original)
