# ADR-209 — Importación de PDF en modo réplica (fondo + texto en posición exacta)

**Status**: implemented
**Fecha**: 2026-09-23
**Autores**: Luder Armas, con Claude Code
**Ámbito**: reports
**Amplía**: [ADR-199](199-importacion-pdf-ocr-avanzado.md)

## Contexto

Pedido explícito 2026-09-23: el borrador "Informe sin título" (23/9/2026
04:02, resultado de importar un PDF con la v1 de ADR-199) tenía objetos
superpuestos que volvían ilegibles partes del documento. Se pidió comparar
punto a punto contra los PDF de origen y lograr una réplica exacta, con 3
documentos de referencia: la guía de políticas nacionales de CEPLAN (112
páginas, 8 horizontales), el diagnóstico de riesgos mineros de la red de 56
sensores (132 páginas) y el Reglamento de Protección Ambiental (68 páginas,
tamaño no estándar 312x454 pt, todas con `/Rotate 90`).

Medición sobre el borrador real (92 páginas, 1370 elementos): **750 pares de
elementos superpuestos** y **37 cajas fuera de la hoja**.

## Causas raíz encontradas

1. **Ancho de render distinto al importado**: el texto con formato se dibuja
   en `element.x` sin relleno interno pero con ancho `element.width - 16`
   (mínimo 120px). Cada línea del PDF, que ya venía cortada en su lugar, se
   volvía a partir y el párrafo crecía sobre lo que tenía debajo.
2. **Escalado deformado**: la posición se escalaba con factores x/y
   distintos a la hoja A4/A3 más cercana, pero el tamaño de fuente no se
   escalaba (Reglamento: posiciones x1.9, letra x1.0).
3. **Franja de encabezado/pie de plataforma**: toda posición se corría hacia
   abajo por `CONTENT_TOP` (72px) — el contenido del final de cada hoja
   quedaba fuera de ella.
4. **Imágenes con ajuste de texto `square`** (el valor por defecto de una
   imagen nueva): todo texto encima de una figura o del fondo de página se
   desplazaba hacia los costados.
5. **Tablas reconstruidas a 14px fijos** (no el tamaño real), más altas que
   el original, montándose sobre el contenido siguiente.
6. **Una orientación para todo el documento**: las 8 páginas horizontales
   de CEPLAN se deformaban a vertical.
7. **Tabuladores y huecos dentro de una línea** (índices con número de
   página a la derecha, columnas, celdas) se dibujaban con el ancho de tab
   del editor, corriendo todo lo que seguía.
8. **Portadas y fotos a página completa mandadas a OCR** (menos de 40
   caracteres de texto digital): el OCR "borraba" el diseño para superponer
   texto aproximado. Páginas con poco texto y dibujos vectoriales (CEPLAN
   p. 3, 37, 83) tomaban el mismo camino.
9. **Páginas con `/Rotate`**: PyMuPDF entrega el texto en coordenadas sin
   rotar con dirección (0,-1) — el Reglamento completo salía sin texto.
10. **Dibujos vectoriales perdidos**: bordes/sombreados de tabla, cajas de
    color, reglas, subrayados y gráficos vectoriales (14.043 dibujos en el
    diagnóstico) no se importaban.

## Decisión

Cada página del PDF se importa como una **página réplica** en dos capas:

1. **Fondo**: la página renderizada (144 DPI, PNG si es liviano, JPEG si es
   fotográfico) **sin ningún texto** — redacción de solo texto de PyMuPDF
   sobre la hoja completa (`images=NONE, graphics=NONE`; el texto rotado se
   repone desde el render original, ver hallazgo 3 abajo). Imágenes, dibujos
   vectoriales, tablas, subrayados, gráficos y texto rotado quedan en su
   posición y orden de apilado exactos. Se omite si la página queda en
   blanco. Bloqueado, detrás de todo, ajuste de texto `behind`.
2. **Texto editable**: una caja por grupo de líneas con igual tamaño, paso
   de línea constante e igual alineación (izquierda/centro/derecha),
   agrupadas a nivel de página. Los saltos de línea del PDF se conservan; un
   hueco de más de 1,5 em o un tabulador parte la línea en segmentos que se
   posicionan por separado. Cada caja se ubica por la **línea base real** de
   su primera línea usando el ascenso/descenso medidos (canvas) de la fuente
   que el navegador realmente usa, con un único factor de escala uniforme
   por página (posición y fuente). Si con la fuente de pantalla una línea
   mide más que en el PDF, se reduce la fuente del párrafo lo justo para que
   entre. Las líneas justificadas se marcan `justify` y se estiran a su ancho
   original (`text-align-last: justify`).

La página lleva `fixedLayout: true`: sin encabezado/pie de plataforma (el
PDF trae los suyos) y excluida de todo auto-flujo del editor
(`pushDownContentAfterChange`, `reflowTextColumnAfterChange`,
`resolveDirectOverlapsOnLanding`, partición de texto a la hoja siguiente).
Cada página conserva su tamaño y orientación propios. El texto lleva
`exactLayout: true`: ancho de envoltura = ancho de la caja, sin relleno ni
recorte, en el editor y en el visor/exportación.

Otras correcciones: la familia de fuente PDF se mapea a la familia CSS real
(`TimesNewRomanPSMT` → `Times New Roman, serif`, `ArialNarrow` →
`Arial Narrow`, ...) decidiendo serif/sans por nombre (el bit serif del
descriptor no es confiable: Roboto viene marcada serif en CEPLAN); una
página sin texto digital solo pasa por OCR si es un **escaneo de documento**
(imagen a hoja completa, fondo claro, casi sin color saturado) — portadas y
fotos se reproducen tal cual como fondo. En páginas escaneadas el fondo es
el propio escaneo con las líneas reconocidas borradas (inpainting) y el
texto OCR se posiciona línea a línea igual que el digital.

## Hallazgos de la verificación en vivo (2026-09-23)

Verificado importando los 3 PDF por el flujo real de la plataforma (ribbon
Datos → Importar PDF/Imagen) y auditando el DOM del visor de solo lectura (el
mismo que usa la exportación) página por página: líneas re-envueltas, texto
que se sale de su caja y tinta de un bloque encima de otro.

1. **Regla global `span { line-height: 1.35 }`** de la hoja de estilos de la
   app: cada tramo ignoraba el interlineado del párrafo, las líneas medían
   23px en vez de 17,3px y las últimas quedaban recortadas o sobre el bloque
   siguiente (389 solapes en el Reglamento). En `exactLayout` los tramos
   heredan (`lineHeight: 'inherit'`) y el interlineado va en **px absolutos**
   (un factor sin unidad se multiplicaba por el tamaño de cada tramo: un
   título de 9pt con superíndice de 5pt agrandaba la línea).
2. **Sangría francesa tomada como "alineado a la derecha"**: un párrafo
   justificado "27.1 …" tiene el borde derecho parejo. Ahora solo se agrupan
   líneas con el mismo x inicial, y toda línea que llega al borde derecho de
   su caja (o la única línea de la caja) se estira a su ancho original.
3. **Redacción parcial de MuPDF corre el texto restante** (reportado por el
   usuario en la hoja 14 del Reglamento: texto encima de la barra gris del
   pie). Al borrar solo parte de un objeto de texto con posicionamiento
   relativo, lo que queda se reescribe ~34pt más abajo. Afectaba 7 páginas
   del Reglamento (14, 27, 34, 40, 48, 64, 65). Ahora el fondo se genera
   borrando TODO el texto de una vez; el texto rotado (que no se emite como
   editable) se repone recortándolo del render original. Verificado: 0
   páginas con texto residual en el fondo en los 3 documentos.
4. **Texto oculto en el original**: capa de texto tapada por una imagen
   dibujada después (portada de CEPLAN: "GUÍA DE POLÍTICAS NACIONALES"
   encima del logo; números de página bajo fotos en 7 páginas) o blanco sobre
   blanco. Solo se emite una línea si en su caja el render original difiere
   del fondo sin texto (hay tinta visible).
5. Ligaduras rotas adicionales del Reglamento: comilla + espacio como "ti"
   (`ar" culos`), "•" entre dígitos como guion (`042-2017-EM`), espacio
   espurio tras "fi"/"fl" (`modifi cación`). De 45 casos quedan 3 ambiguos.

Resultado final (visor de solo lectura, todas las páginas):

| Documento | Págs. | Cajas de texto | Re-envueltas | Desborde | Solapes de tinta |
|---|---|---|---|---|---|
| Reglamento | 68 | 1149 | 0 | 0 | 4 (pág. 28, inherentes al original: interlineado 7,5pt con letra de 9pt) |
| Diagnóstico | 132 | 3343 | 0 | 0 | 0 |
| CEPLAN | 112 | 2262 | 0 | 0 | 0 |

## Alternativas descartadas

- **Seguir reconstruyendo tablas como elemento tabla**: su render (relleno,
  tamaño de fuente, bordes propios) nunca coincide con el original y fue una
  de las fuentes de superposición. En la réplica los bordes/sombreados van
  en el fondo y el texto de cada celda es editable en su lugar exacto. Se
  pierde la edición estructural de la tabla (agregar filas), aceptado a
  cambio de la fidelidad pedida.
- **Figuras como elementos sueltos**: exige reproducir recortes, rotaciones
  (portada del Reglamento, imagen girada 90°) y máscaras del PDF; en el
  fondo quedan exactas por construcción.
- **Incrustar las fuentes del PDF** (`extract_font` + `@font-face`): daría
  métricas idénticas, pero muchas vienen en CFF/Type1 no cargables por el
  navegador y habría que persistirlas por informe. Queda como mejora futura;
  el encaje por medición cubre el caso de sustitución de fuente.

## Consecuencias

- Tamaño: fondos de 1,1 a 3,5 MB por documento en los 3 PDF de referencia
  (respuesta completa de 1,8 a 5,1 MB), dentro del tope de 64 MB.
- Tiempo de extracción digital: 5 s (68 págs.), 10 s (132), 14 s (112).
- Editar un bloque de texto réplica no reacomoda nada a su alrededor; si el
  texto editado crece, puede solapar lo de abajo (decisión consciente: la
  réplica es de posición fija, como un PDF editable).
- Texto rotado queda como parte del fondo (no editable).
- Exportar a DOCX/PPTX de páginas réplica no se verificó en este ADR.

## Referencias

- `ocr_engine/pdf_ocr_pipeline.py` (`_extract_replica_page`,
  `_page_segments`, `_group_segments`, `_page_is_scanned_document`,
  `_rotate_rawdict`, `_css_font_family`)
- `backend/src/reports/pdf_ocr_client.hpp/.cpp`, `report_routes.cpp`
  (`layout`, `background`, `PdfOcrTextLayout`)
- `frontend/.../lib/pdfOcrImport.ts` (`buildReplicaPages`)
- `frontend/.../store/useEditorStore.ts` (`importReplicaPages`,
  `ReportPage.fixedLayout`, `isOnFixedLayoutPage`)
- `frontend/.../TextBlock/TextBlock.tsx`, `viewers/ReadOnlyViewer.tsx`
  (`exactLayout`)
