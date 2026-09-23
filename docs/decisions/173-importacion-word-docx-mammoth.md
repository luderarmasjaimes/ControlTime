# ADR-173 — Importación de Word (.docx) vía mammoth: alcance, problemas vigentes y trabajo pendiente

**Status**: implemented, con hallazgos abiertos sin resolver (formalizado retroactivamente 2026-09-12 — el código ya existía sin ADR)
**Fecha**: 2026-09-12
**Autores**: Luder Armas (formalización retroactiva, con Claude Code)
**Ámbito**: reports

## Contexto

El ribbon "Datos → Importación" (pedido explícito 2026-09-09) agregó un
botón "Importar Word" que convierte un `.docx` real en bloques nativos del
editor. Llegó sin ADR propio: [ADR-139](139-exportacion-docx-nativa-cliente.md)
formaliza el pipeline de **exportación** a `.docx` (cliente, OpenXML real),
pero es explícito en que su alcance es solo exportación — nunca contempló
un flujo de importación, y la auditoría de conformidad (2026-09-11) lo
encontró como el segundo hallazgo de mayor superficie nueva sin documentar
después del motor de tablas (ADR-172).

Este ADR formaliza el pipeline real, dejando explícito qué se preserva, qué
se pierde, qué problema de seguridad sigue abierto sin auditoría dedicada, y
qué haría falta para que este flujo esté a la altura del resto de
importación/exportación de documentos de la plataforma (ADR-016, 080,
083/084, 139, 169, 170).

## Decisión

### 1. Qué es y cómo funciona (lo implementado)

`App.tsx::handleImportDocx` — selector de archivo restringido a `.docx`
(re-validado por extensión al elegir, porque un usuario puede forzar "todos
los archivos"), pipeline en 5 pasos sobre el mismo `ArrayBuffer` crudo:

1. **`expandParagraphPageBreaks`** (`lib/docxPageBreaks.ts`) — nivela los
   DOS mecanismos de salto de página manual del formato OOXML (`Ctrl+Enter`
   dentro del texto vs. "salto de página antes" como propiedad de párrafo,
   que **mammoth no entiende en absoluto**) para que ambos lleguen igual al
   paso siguiente.
2. **`enrichDocxTextStyles`** — mammoth no lee color de texto directo ni
   tamaño de fuente a su modelo interno; este paso los extrae del XML crudo
   e inyecta un `styleMap` sintético para rescatarlos.
3. **`mammoth.convertToHtml`** (cargada con `import('mammoth')` **dinámico**
   — librería pesada de parseo OOXML+JSZip, solo se paga su costo de bundle
   si el usuario realmente importa un Word), con `transformDocument` propio
   (`markParagraphAlignment` + `markRunFontSize`, porque mammoth lee
   alineación/tamaño del `.docx` pero nunca los usa) y un `styleMap` que
   convierte `br[type='page']` en un marcador `<hr class="docx-page-break">`
   reconocible después.
4. **`parseRichClipboardBlocks`** (`lib/richPaste.ts`) — el **mismo parser**
   que ya usa el pegado de Word/Google Docs (Ctrl+V): convierte el HTML de
   mammoth en la secuencia de bloques (texto/tabla/imagen) del editor. A
   partir de acá, un `.docx` importado es indistinguible de un pegado real.
5. **`extractDocxTableShading`** — mammoth tampoco trae sombreado de celda/
   encabezado en el HTML; se extrae aparte del XML crudo y se empareja por
   orden de documento con el N-ésimo bloque `table`.

**Se preserva**: texto, negrita/cursiva/subrayado (agregado a mano — el
`styleMap` default de mammoth no lo trae), color de texto directo, tamaño
de fuente, alineación de párrafo, sangría (heurística sobre CSS), saltos de
página manuales (ambos mecanismos OOXML nivelados), línea horizontal
(`w:pBdr`, sintetizada como marcador), color de encabezado de tabla
heredado del **estilo** (no solo `w:color` directo — sigue `w:basedOn`
hasta 8 niveles), sombreado de celda, listas (convertidas al esquema propio
TAB+marcador del editor), leyendas de figura/tabla (heurística de texto
"Figura N."/"Tabla N.").

**Se pierde/simplifica**: tachado (el texto se conserva, el estilo visual
se descarta), resaltado de color (no se preserva el color real), **tablas
anidadas se aplanan a texto plano** (documentado en el propio código), un
salto de página "natural" por desborde (no editado a mano) no es detectable
de forma confiable, y las listas no llegan como numeración nativa de Word
(quedan en el esquema propio del editor, no en `w:numPr`).

### 2. Problema de seguridad vigente, sin auditoría dedicada

El HTML que produce mammoth **nunca pasa por `sanitizeRichHtml`**
(`lib/sanitizeHtml.ts`) — esa allowlist no soporta `<table>`/`<img>` y los
desenvolvería dejando solo texto plano, rompiendo el propósito mismo de la
importación. El comentario en `richPaste.ts::parseRichClipboardBlocks`
documenta por qué se considera seguro procesar el HTML crudo directamente:
cada extracción es angosta y ninguna reinyecta HTML/atributos crudos a un
sink — el texto sale por `.textContent` (nunca `innerHTML`), la tabla por
`parseHtmlClipboardTable` (el mismo parser que ya procesa HTML de
portapapeles sin sanear en `PageCanvas.tsx`), y el `src` de una imagen se
valida contra el mismo allowlist estricto que usa el resto del pegado de
imágenes (`data:image/` o `http(s)://` únicamente — ningún esquema
`javascript:`/`vbscript:` pasa ese filtro).

El razonamiento es sólido y el diseño es deliberado, **no un descuido** —
pero sigue siendo una superficie que procesa contenido de un archivo
**externo, subido por el usuario**, sin haber pasado nunca por una revisión
de seguridad dedicada (a diferencia de, por ejemplo, el red-team interno de
ADR-133 o el pentest externo formalizado en ADR-169, cuyo alcance mínimo —
"portal, APIs" — no menciona explícitamente el parseo de archivos
subidos). Se deja como hallazgo abierto, no como vulnerabilidad confirmada.

### 3. Otros problemas vigentes

- **Validación solo por extensión**: un archivo renombrado a `.docx` que en
  realidad no sea un ZIP/OOXML válido llega a `mammoth.convertToHtml` sin
  ninguna verificación previa de firma/magic bytes — el único manejo de ese
  caso es el `catch` genérico al final de `handleImportDocx`, que muestra
  un mensaje de error pero no distingue "archivo corrupto" de "no es un
  .docx real".
- **Sin límite de tamaño ni aviso de progreso** para archivos grandes —
  relevante en este proyecto en particular: [ADR-170](170-evaluacion-vps-gpu-pendiente-exportacion-documentos-extensos.md)
  ya documentó un caso real de documento técnico de 2104 páginas/6300
  diagramas en el flujo de *exportación*; un `.docx` de esa escala en
  *importación* correría por completo en el hilo principal del navegador
  (mammoth + `parseRichClipboardBlocks` son síncronos sobre el resultado)
  sin ningún indicador salvo el texto genérico "Importando...".
- **Sin resumen post-importación**: el usuario no se entera, dentro de la
  propia UI, de qué se simplificó (tablas anidadas aplanadas, tachado
  perdido) — solo lo sabe quien lea este ADR o el código.
- `.doc` legado (binario, Word 97-2003) no soportado — decisión correcta y
  ya comunicada al usuario (mensaje explícito en `setAiStatus`), no es un
  defecto.

### 4. Soluciones a implementar (para estar acorde a las especificaciones de la plataforma y al resto de ADRs)

Priorizadas de mayor a menor impacto en riesgo/confianza del usuario:

1. **Validación de contenido antes de parsear**: comprobar la firma ZIP
   (`PK\x03\x04`) del `ArrayBuffer` antes de pasarlo a mammoth, y distinguir
   en el mensaje de error "esto no es un .docx real" de "mammoth no pudo
   procesarlo" — mismo estándar de manejo de errores que ya exige
   [ADR-161](161-otp-validacion-contacto-pre-registro.md)/[147](147-buffer-nginx-reintento-transitorio-precheque-dni.md)
   en otros flujos de este proyecto ("fallar cerrado", errores específicos
   en vez de genéricos).
2. **Resumen post-importación visible**: tras insertar los bloques,
   mostrar (vía el mismo mecanismo de `setAiStatus` o un modal breve) un
   recuento de simplificaciones reales aplicadas en ESE archivo — p.ej.
   "N tablas anidadas se aplanaron a texto", "el tachado no se conservó" —
   solo cuando de verdad ocurrieron, no un aviso genérico siempre visible.
3. **Límite de tamaño + indicador de progreso real** para archivos grandes,
   coherente con el trabajo de ADR-170 (que ya subió timeouts de exportación
   por el mismo tipo de documento extenso); considerar mover el parseo a un
   Web Worker si el tamaño lo justifica, para no congelar la UI.
4. **Incluir el parseo de `.docx`/HTML de portapapeles en el alcance del
   pentest externo** de [ADR-169](169-pentest-externo-seguridad-requisito-obligatorio-produccion.md)
   explícitamente — hoy su alcance mínimo documentado no lo menciona, y es
   la única superficie de este flujo que procesa un archivo arbitrario
   subido por el usuario.
5. **Preservar tachado** (`w:strike`) — mismo patrón ya usado para
   subrayado/color/tamaño (`enrichDocxTextStyles`), esfuerzo acotado dado
   el precedente ya construido en `docxPageBreaks.ts`.
6. Evaluar (sin comprometerse todavía, por eso no es una fila del alcance v1
   del ADR-172 de tablas) si vale la pena soportar tablas anidadas en vez de
   aplanarlas — depende de cuánto aparezcan en informes técnicos reales de
   los usuarios; no priorizado sin evidencia de un caso real bloqueado.

## Consecuencias

### Positivas
- Reutiliza el parser de pegado ya probado (`parseRichClipboardBlocks`) en
  vez de construir un camino de importación paralelo — menos superficie de
  mantenimiento, comportamiento consistente entre "pegar desde Word" e
  "importar un .docx".
- Carga diferida de `mammoth` no penaliza el bundle inicial de la app.
- El diseño de seguridad de la extracción (textContent/allowlist de `src`)
  es defendible tal como está documentado en el código, no un descuido.

### Negativas / Trade-offs
- Fidelidad menor que la exportación de ADR-139 en varios aspectos (listas
  no nativas, tachado perdido, tablas anidadas aplanadas) — aceptable como
  v1, pero no comunicado hoy al usuario en el momento de importar.
- Superficie que procesa un archivo externo sin haber pasado por una
  revisión de seguridad dedicada todavía.

## Alternativas descartadas

### Sanear el HTML de mammoth con `sanitizeRichHtml` antes de procesarlo
Se descartó porque esa allowlist no soporta `<table>`/`<img>` — sanearlo
primero habría reproducido exactamente el bug que motivó esta función
("pegué un documento con tabla e imagen y solo se pegó la tabla"),
anulando el propósito de la importación. La alternativa adoptada (extracción
angosta por tipo de nodo, nunca `innerHTML`) cubre el mismo riesgo sin ese
costo — ver "Problema de seguridad vigente" arriba para la salvedad real.

## Referencias
- `frontend/src/components/ReportStudioV2/App.tsx` (`handleImportDocx`)
- `frontend/src/components/ReportStudioV2/lib/docxPageBreaks.ts` (`expandParagraphPageBreaks`, `enrichDocxTextStyles`, `extractDocxTableShading`, `markParagraphAlignment`, `markRunFontSize`)
- `frontend/src/components/ReportStudioV2/lib/richPaste.ts` (`parseRichClipboardBlocks`, `pairCaptionsWithMedia`)
- `frontend/src/components/ReportStudioV2/lib/sanitizeHtml.ts` (`sanitizeRichHtml` — la allowlist que este flujo evita a propósito)
- ADR-139 (exportación docx nativa — alcance explícitamente distinto)
- ADR-169 (pentest externo — candidato a ampliar su alcance con este flujo)
- ADR-170 (evidencia real de documentos extensos, relevante para el límite de tamaño pendiente)
- ADR-172 (motor de tablas — mismo criterio de "alcance v1 documentado explícitamente")
