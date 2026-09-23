# ADR-199 — Importación de PDF con OCR avanzado (PaddleOCR PP-StructureV2)

**Status**: implemented, verificado end-to-end en vivo (build real del backend C++, imagen Docker real de `ocr_engine`, requests reales contra el sidecar levantado). Ampliado 2026-09-20 con fidelidad de estilos/encabezados/listas/alineación/geometría de página (§7), también verificado en vivo.
**Fecha**: 2026-09-19
**Autores**: Luder Armas, con Claude Code
**Ámbito**: reports

## Contexto

El ribbon "Datos → Importación" ya tenía "Importar Word (.docx)"
([ADR-173](173-importacion-word-docx-mammoth.md)). Pedido explícito
2026-09-19: el mismo botón pero para PDF, con OCR de la máxima calidad
posible -- muchos informes técnicos/geotécnicos que los usuarios quieren
traer al editor son PDFs **escaneados** (fotos de papel), no texto digital,
que es justo donde hace falta OCR de verdad, no solo extracción de texto
embebido (que ya existía, acotado a CVs, en `/extract_cv_text` vía
`pdfplumber`, ADR-122).

## Decisión

### 1. Motor: PaddleOCR PP-StructureV2, en un sidecar aparte

Decisión explícita del usuario tras comparar 3 opciones (self-hosted
Tesseract, self-hosted PaddleOCR, API en la nube tipo Document AI/Textract):
**PaddleOCR self-hosted**, por el mismo motivo que ya llevó a este proyecto a
descartar dependencias de IA en la nube por costo/licencia (ADR-166,
ADR-180) -- ningún documento de un cliente sale de la infraestructura
propia, y no hay costo por página.

PP-StructureV2 (no OCR de texto plano): hace layout + reconocimiento de
tabla + orden de lectura, no solo reconocimiento de caracteres -- es lo que
de verdad da "máxima calidad" en un informe técnico escaneado con tablas y
diagramas, en vez de una sola cadena de texto desordenada.

**Servicio aparte (`ocr_engine/`), no agregado a `ai_engine`**: `paddlepaddle`
tiene su propia matriz de versiones CUDA/cuDNN, exactamente el tipo de
conflicto que este proyecto ya resolvió separando Silent-Face-Anti-Spoofing
(`silentface_engine/`) y el avatar por difusión (`avatar_engine/`) de
TensorFlow/DeepFace en el mismo proceso (ADR-141) -- meter paddlepaddle
directo en `ai_engine/eye_analyzer.py` habría arriesgado reabrir ese mismo
tipo de falla. `ocr_engine/` es CPU-only por defecto (`requirements.txt`
documenta el porqué: no hay evidencia de una wheel `paddlepaddle-gpu`
confirmada para la GPU real de este host, Blackwell/sm_120, que ya causó
fallas reales de kernels CUDA con TensorFlow 2.18 -- ver comentarios de
ADR-141 en `docker-compose.yml`). Aceptable: es una operación de importación
bajo demanda con indicador de progreso, no un camino caliente como el
verify-frame de login de `silentface_engine`.

Arquitectura (backend solo le habla a `ai_engine`, que actúa de gateway
único y delega -- mismo principio ya usado con `avatar_engine`/
`silentface_engine`):

```
frontend (App.tsx::handleImportPdfOcr)
  -> POST /api/reports/import/pdf-ocr (backend, pdf_ocr_client.cpp)
    -> POST {ai_engine}/ocr_pdf (ai_engine/ocr_engine_client.py)
      -> POST {ocr_engine}/ocr_pdf (ocr_engine/server.py + pdf_ocr_pipeline.py)
```

### 2. Extracción híbrida: texto digital primero, OCR solo si hace falta

Por página (`ocr_engine/pdf_ocr_pipeline.py`): se intenta primero la capa de
texto real embebida (PyMuPDF `get_text()`) -- si hay texto digital real (no
es un escaneo), se usa directo (fidelidad perfecta, instantáneo, incluye
intento de detectar tablas nativas con `page.find_tables()` e imágenes
incrustadas). **Solo** si la página no trae texto digital (umbral: menos de
40 caracteres) se rasteriza a 400 DPI y corre PP-Structure completo. Esto
evita pagar el costo de OCR en documentos que son mayormente digitales (el
caso típico de un informe producido por este mismo editor), reservándolo
para las páginas escaneadas reales.

**Se preserva**: texto (digital o vía OCR), estructura de tabla (aplanada a
filas/columnas de texto -- ver limitación abajo), figuras/diagramas
(recortados como imagen en vez de forzados a texto OCR ilegible -- nunca se
pierde información por intentar textualizar algo que no es texto).

**Se pierde/simplifica** (mismo criterio de simplificación ya aceptado en
ADR-173 para tablas anidadas en .docx): tablas se aplanan a `rows: string[][]`
sin `colspan`/`rowspan` ni sombreado/alineación por celda; no hay información
de formato por carácter (negrita/cursiva/tamaño) en el texto extraído --
ni la capa digital de PyMuPDF ni PP-Structure la dan con fidelidad
suficiente. El orden de lectura de páginas escaneadas es una heurística
(top-to-bottom por banda de Y, luego left-to-right), no un análisis de
columnas real.

### 3. Límite explícito de páginas OCR + timeouts de punta a punta

A diferencia de .docx (parseo instantáneo en el navegador), OCR real en CPU
sobre varias páginas escaneadas tarda minutos, no segundos. En vez de un
job asíncrono con polling (que sí existe para export de documentos largos,
ADR-183/184/185), v1 usa una sola request síncrona con:
- `OCR_ENGINE_MAX_OCR_PAGES=80` (ocr_engine): si el documento tiene más
  páginas escaneadas que ese límite, se rechaza temprano con
  `too_many_scanned_pages` (páginas digitales no cuentan, son baratas).
- Timeouts alineados en las 3 capas: `OCR_ENGINE_CLIENT_TIMEOUT_SECONDS`
  (ai_engine, 600s), `BEEMETRY_AI_ENGINE_PDF_OCR_TIMEOUT_MS` (backend,
  600000ms), `proxy_read_timeout 620s` (nginx, location dedicada
  `= /api/reports/import/pdf-ocr` -- el `/api/` genérico tiene solo 180s,
  igual que ya requirió `/export/pdf`, ver ese comentario en `nginx.conf`).
- Límite de tamaño de archivo: 60MB en las 3 capas (frontend implícito por
  el límite de backend, `PDF_OCR_IMPORT_MAX_BYTES` en ai_engine,
  `OCR_ENGINE_MAX_PDF_BYTES` en ocr_engine) -- mismo techo que
  `client_max_body_size`/`body_limit` que ya usa el resto de payloads
  grandes de este backend.

Limitación conocida, documentada en vez de resuelta: un documento
legítimamente largo con más de 80 páginas escaneadas necesitaría dividirse
manualmente. No se construyó el job asíncrono para v1 -- alcance
deliberadamente acotado, mismo criterio que ADR-173 aceptó explícitamente
para .docx (sin indicador de progreso real, sin resumen post-importación en
ese caso; acá SÍ se resolvieron esos dos gaps desde el inicio, ver abajo).

### 4. Seguridad: validación de firma + extracción angosta (resuelto desde el día 1)

ADR-173 dejó pendiente, para .docx, "validación solo por extensión" (un
archivo renombrado llega sin chequeo de firma real). Acá se resolvió desde
el arranque: firma `%PDF-` verificada en el **frontend** (antes de subir,
`App.tsx::handleImportPdfOcr`), en el **backend**
(`report_routes.cpp::handleImportPdfOcr`, antes de reenviar) y en
**ocr_engine** (`server.py`, antes de parsear) -- 3 capas, cada una rechaza
temprano con un error específico (`not_a_pdf`), no un genérico.

Los bloques que produce el pipeline se insertan en el editor por la MISMA
vía que ya usa .docx (`setPendingImportBlocks` -> `PageCanvas.tsx` ->
`processPasteBlocks`, ver `richPaste.ts`): texto vía el campo tipado `text`
(nunca `innerHTML`), imágenes (figuras recortadas de páginas escaneadas o
imágenes digitales incrustadas) solo como `data:image/...` -- mismo
allowlist estricto que ya usa el resto del pegado de imágenes. Sigue
abierto el mismo hallazgo que ADR-173 documentó para .docx: procesar un
archivo externo subido por el usuario sin que este flujo específico haya
pasado por el pentest externo dedicado de ADR-169 (su alcance mínimo
documentado tampoco lo menciona).

### 5. Resumen post-importación + progreso real (gaps de ADR-173 resueltos acá)

`lib/pdfOcrImport.ts::formatPdfOcrSummary` muestra, vía `setAiStatus`, cuántas
páginas fueron texto digital vs. OCR real y la confianza promedio del OCR --
info que el backend ya devuelve por página, así que no hubo que construir
nada extra para dar esta visibilidad (gap que ADR-173 dejó pendiente para
.docx). El estado intermedio ("Extrayendo texto y aplicando OCR... esto
puede tardar varios minutos") es explícito, no un genérico "Importando…".

### 6. Verificación real: bug de `lang` encontrado y corregido, límite de precisión documentado

`docker build -f backend/Dockerfile.verify` compiló el backend completo
(incluido `pdf_ocr_client.cpp`) sin errores, con el único test unitario
existente en verde. `docker build -f ocr_engine/Dockerfile` construyó la
imagen del sidecar sin errores (paddlepaddle==2.6.2/paddleocr==2.7.3/
PyMuPDF==1.28.2 resuelven e instalan limpio).

Al levantar el contenedor real y mandarle un PDF de prueba, `PPStructure(lang='es', layout=True, ...)`
**tronaba el proceso completo** con `sys.exit(-1)` (no una excepción
capturable) apenas se instanciaba: "lang latin is not support, we only
support dict_keys(['en', 'ch']) for layout models". Causa raíz confirmada
leyendo el código fuente real de `paddleocr==2.7.3`
(`PPStructure.__init__`): el modelo de LAYOUT solo existe para `en`/`ch` --
`table_lang` sí tiene el fallback correcto a `'en'` para cualquier idioma no
chino, pero la búsqueda del modelo de `layout` reusa por error la variable
`lang` sin ese mismo fallback (parece un bug/inconsistencia real de la
propia librería, no algo específico de español). Corregido con una
separación de responsabilidades: `PPStructure(lang='en', ...)` para
layout/tabla (visualmente agnóstico del idioma real del documento) +
`PaddleOCR(lang='es', ...)` aparte, real, para reconocer el texto de cada
región que el layout ya localizó (`_get_text_ocr_engine`/
`_ocr_text_region` en `pdf_ocr_pipeline.py`). `server.py::_preload` también
se endureció para atrapar `BaseException` (no solo `Exception`), por si
alguna otra combinación de idioma/modelo dispara el mismo `sys.exit` interno
de la librería -- sin este cambio, ese fallo de configuración tumbaba el
proceso completo en vez de dejar el servicio en `not_ready`.

Verificado además con un PDF sintético (texto renderizado a imagen, sin capa
digital, para forzar el camino de OCR real): el pipeline detecta la región,
la recorta (con un margen de `_ocr_text_region` agregado tras encontrar en
vivo que el bbox exacto de PP-Structure cercenaba la primera letra de una
línea real) y reconoce el texto con confianza real 0.96-0.99. **Limitación
de precisión real, no un bug de código**: el modelo de reconocimiento
multilingüe "latin" de PaddleOCR (el que cubre español) pierde o confunde
diacríticos específicos del español en algunos casos -- confirmado en vivo:
"Niño"→"Nino", "año"→"ano", "señal"→"senal" (la ñ se omite, no solo se lee
mal), "ó"→a veces "6", "¿"/"¡" no se reconocen. Es una característica
documentada del modelo self-hosted elegido (no de una API en la nube
específica para español), coherente con la decisión explícita del usuario
de aceptar ese trade-off por privacidad/costo (ver alternativas
descartadas). Texto sin diacríticos (números, códigos, la mayoría de
palabras técnicas) no se ve afectado.

### 7. Fidelidad ampliada (2026-09-20): estilos, encabezados/TOC, listas, alineación, imágenes en orden real, geometría de página

Pedido explícito del usuario tras usar la v1 (que producía texto plano sin
estilo): "la máxima fidelidad posible... ubicación de textos, imágenes,
índices, pie/superior de página, carátulas, listas... márgenes, colores,
estilos".

**Hallazgo clave que definió el diseño**: el editor YA soporta casi todo
esto sin cambios propios. `PasteBlock` (el tipo que ya consume este
importador) lleva `spans: TextStyleSpan[]` con `bold/italic/underline/
color/fontSize/fontFamily/headingStyle/textAlign` por rango de caracteres
-- el MISMO mecanismo que ya usa la importación de `.docx` (ADR-173). Un
span con `headingStyle` hace que ese texto aparezca solo en la Tabla de
Contenidos del editor (`generateTocData`), sin código nuevo del lado del
editor. `ReportPage`/`DocumentMeta` ya soportan `paperSize`/`orientation`/
márgenes con mutaciones existentes (`setPaperSize`/`setOrientation`/
`setPageMargins`, ADR-174). Por eso esta ampliación es casi enteramente
**extracción más rica del PDF**, no construcción de mecanismos nuevos.

**Lo que se agregó** (`ocr_engine/pdf_ocr_pipeline.py`, reescritura del
camino digital vía `page.get_text("dict")` en vez de `"blocks"`):
- Spans reales de negrita/cursiva/color/tamaño/fuente por carácter (páginas
  digitales, vía los `flags`/`color`/`size`/`font` de PyMuPDF -- nombre de
  fuente limpiado de prefijo de subset, ej. `ABCDEF+Arial-BoldMT` → `Arial`).
- Encabezados: primero se intenta el esquema/marcadores REALES del PDF
  (`doc.get_toc()`, cuando existen) emparejados por página+prefijo de
  texto; si no hay esquema, heurística por tamaño de fuente relativo al
  "cuerpo" de la página (el tamaño que más caracteres acumula).
- Alineación de párrafo por posición horizontal relativa al ÁREA DE
  CONTENIDO real de la página (no al borde físico de la hoja -- ver
  hallazgo abajo).
- Listas: reconoce el mismo patrón de marcador (`LIST_MARKER_RE`) que ya
  usa el editor, con profundidad estimada por sangría relativa al margen
  izquierdo más frecuente de la página.
- Imágenes intercaladas en el mismo orden de lectura que texto/tablas (por
  posición y0/x0), no todas al final de la página como en v1.
- Geometría real de página (tamaño/orientación/márgenes efectivos) para
  configurar el documento importado, en vez de A4 vertical por defecto.
- Camino OCR (páginas escaneadas): encabezados desde el `type` de región
  de PP-Structure ('title'), mismo intercalado de imágenes, misma
  geometría -- sin estilo de carácter real (una imagen rasterizada no lo
  trae, ver limitaciones al inicio del ADR).

**3 bugs reales encontrados y corregidos durante la verificación en vivo**
(con un PDF de prueba con título/subtítulo numerado/párrafo/lista/negrita/
alineación derecha real):
1. **Encabezados numerados excluidos por error**: un encabezado real como
   "1. Introducción" matchea el MISMO patrón regex que un ítem de lista
   numerada ("1. Primer punto") -- la condición inicial excluía cualquier
   párrafo "tipo lista" de la detección de encabezado, así que "1.
   Introducción" (tamaño de fuente claramente mayor al cuerpo) no se
   marcaba como encabezado. Corregido quitando esa exclusión: el umbral de
   TAMAÑO de fuente ya es la señal real que distingue un encabezado de un
   ítem de lista (un ítem de lista genuino nunca tiene un tamaño de fuente
   de encabezado), la exclusión por patrón era redundante y activamente
   incorrecta.
2. **Alineación falsa "centrado"**: la heurística comparaba cada línea
   contra el BORDE FÍSICO de la hoja (x=0 a x=595 en A4), no contra el área
   de contenido real. Con márgenes simétricos (el caso normal, ej. 72pt a
   cada lado), un párrafo normal alineado a la izquierda con líneas casi al
   ancho completo de la columna de texto queda con un hueco similar a
   AMBOS bordes de la hoja por pura coincidencia geométrica -- la heurística
   lo marcaba "centrado" cuando en realidad ni siquiera había margen visible
   para distinguir alineación. Corregido con un pre-pase por página que
   calcula la extensión REAL del contenido de texto (no el borde de la
   hoja) como referencia.
3. **Profundidad de lista siempre 0 en el caso común**: la sangría de cada
   línea se medía contra el borde izquierdo de su propio bloque -- pero un
   ítem de lista suele ser su propio bloque completo (una línea = un
   bloque, caso típico cuando los ítems no están pegados unos a otros), así
   que la línea terminaba comparándose consigo misma (sangría siempre 0).
   Corregido usando el margen izquierdo más frecuente de TODA la página
   como referencia de "nivel superior", no el bloque individual.

**Limitación real observada, no corregida (documentada, no un defecto de
código)**: un carácter de viñeta poco común (ej. punto medio `·` en vez de
la viñeta estándar `•`, según cómo el PDF de origen haya codificado el
glifo) no matchea `LIST_MARKER_RE` y ese ítem queda como párrafo normal en
vez de reconocido como lista -- degradación segura (el texto igual se
importa, solo sin el tratamiento especial de sangría), no una pérdida de
contenido ni un error.

## Consecuencias

### Positivas
- Reutiliza la vía de inserción de bloques ya probada por .docx
  (`setPendingImportBlocks`/`processPasteBlocks`) -- comportamiento
  consistente entre ambos flujos de importación, sin duplicar lógica de
  inserción en el editor.
- Ningún documento de cliente sale de la infraestructura propia (self-hosted
  de punta a punta), sin costo por página.
- Extracción híbrida evita pagar el costo de OCR en páginas que ya tienen
  texto digital real -- solo las páginas escaneadas de verdad pasan por
  PP-Structure.

### Negativas / Trade-offs
- Tope de 80 páginas escaneadas por documento (v1 síncrono, sin job
  asíncrono) -- un documento más grande necesita dividirse manualmente.
- CPU-only: más lento que una wheel GPU, pero sin el riesgo de una falla
  silenciosa de compatibilidad CUDA/Blackwell no verificada.
- Tablas se aplanan sin colspan/rowspan/sombreado -- mismo tipo de
  simplificación ya aceptada en ADR-172/173.

## Alternativas descartadas

### Tesseract reforzado (sin PP-Structure)
Ya estaba instalado en `ai_engine` (usado hoy solo para MRZ de DNI,
`dni_scan.py`) y no habría requerido un sidecar nuevo. Descartado porque
solo da texto plano por región sin layout/tabla real -- muy por debajo de
"máxima calidad" en un informe técnico escaneado con tablas, que es
justamente el caso de uso real.

### API en la nube (Document AI / Textract / Azure Document Intelligence)
Mejor calidad cruda de reconocimiento, pero envía documentos de cliente
(potencialmente confidenciales) a un tercero, tiene costo por página, y
requiere gestionar una API key -- rompe el patrón 100% self-hosted que ya
siguen ADR-166/180 en este proyecto. Descartado por el usuario explícitamente
por este motivo.

### Job asíncrono con polling (como export de documentos largos)
Se consideró (mismo patrón que `/api/reports/{id}/export/jobs/{jobId}`,
ADR-183/184/185) para no depender de una sola request síncrona larga.
Descartado para v1 por alcance: agregaba una tabla de jobs, UI de polling y
semántica de cancelación completa para un caso (documentos con >80 páginas
escaneadas) que se resuelve razonablemente pidiendo al usuario dividir el
archivo. Queda como mejora futura si aparece evidencia real de un caso
bloqueado.

## Referencias
- `ocr_engine/` (sidecar nuevo: `Dockerfile`, `requirements.txt`,
  `pdf_ocr_pipeline.py`, `server.py`)
- `ai_engine/ocr_engine_client.py`, `ai_engine/eye_analyzer.py` (`/ocr_pdf`)
- `backend/src/reports/pdf_ocr_client.hpp/.cpp`,
  `backend/src/reports/report_routes.cpp` (`handleImportPdfOcr`)
- `backend/src/config/app_config.hpp/.cpp`
  (`gAiEnginePdfOcrTimeoutMs`/`BEEMETRY_AI_ENGINE_PDF_OCR_TIMEOUT_MS`)
- `frontend/src/components/ReportStudioV2/lib/pdfOcrImport.ts`,
  `App.tsx` (`handleImportPdfOcr`), `components/layout/RibbonToolbar.tsx`
- Mecanismos del editor reutilizados sin cambios para la fidelidad ampliada
  (§7): `lib/textSpans.ts` (`TextStyleSpan`), `lib/headingStyles.ts`,
  `lib/listFormatting.ts` (`LIST_MARKER_RE`, espejado a mano en
  `pdf_ocr_pipeline.py`), `store/useEditorStore.ts`
  (`setPaperSize`/`setOrientation`/`setPageMargins`, ADR-174)
- `docker-compose.yml` (servicio `ocr_engine`), `frontend/nginx.conf`
  (location dedicada `/api/reports/import/pdf-ocr`)
- ADR-141 (precedente de sidecars separados por conflicto de dependencias ML)
- ADR-166, ADR-180 (precedente de descartar dependencias de IA en la nube)
- ADR-173 (importación de .docx -- mismo punto de ribbon, gaps que este ADR
  resuelve desde el día 1: validación de firma, resumen post-importación)
- ADR-169 (pentest externo -- candidato a ampliar su alcance con este flujo)
- ADR-170 (evidencia real de documentos extensos, relevante para el tope de
  páginas OCR)
- ADR-183/184/185 (patrón de job asíncrono para operaciones largas --
  alternativa descartada para v1)
