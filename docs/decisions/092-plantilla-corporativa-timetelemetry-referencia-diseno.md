# ADR-092 — Plantilla corporativa Beemetry/TimeTelemetry: referencia de diseño (colores, tipografía, layouts)

**Status**: accepted (documentación de referencia — no requiere despliegue)
**Fecha**: 2026-08-07
**Autores**: EC
**Ámbito**: reports
**Relación**: referencia directa para la exportación PPTX (ADR-083 `exportacion-pptx-modo-presentacion-sidecar-hibrido`, ADR-084 `conversion-pptx-video-narracion-diapositiva`) y para cualquier trabajo futuro de identidad visual del proyecto minero; complementa (sin sustituir) la paleta de marca ya vigente en el frontend (`#F07E41`, ver `project_telemetry_rebrand_2026-08-02` en memoria — nota la diferencia de tono, ver Consecuencias).

## Contexto

Gerencia entregó `Plantilla Telemetry.potx` (plantilla oficial de PowerPoint de Beemetry/TimeTelemetry, 9.5 MB, creada 2026-06-10 y revisada por última vez 2026-06-16) como referencia de marca para la preparación de documentación del proyecto minero completo, pidiendo extraer y dejar registrado en un ADR todo lo relevante: colores, tipografía, títulos, estilos, tablas y cualquier otro dato de diseño.

Este ADR **no es una decisión de arquitectura de software** en el sentido habitual del log — es un registro de referencia de diseño, siguiendo el mismo criterio que ya usa este log para decisiones no puramente técnicas (ver Convención en `docs/decisions/README.md`). Se documenta acá para que quede trazable y consultable por cualquiera que necesite generar informes/presentaciones con la identidad visual oficial (en particular, el pipeline de exportación PPTX de ADR-083/084).

## Cómo se extrajo (metodología, para que sea reproducible)

Un `.potx` es un ZIP OOXML. El entorno de esta sesión no tiene LibreOffice instalado (no se pudo generar una miniatura visual), así que la información se extrajo leyendo directamente el XML interno:
- `ppt/theme/theme1.xml` — esquema de color y de fuentes del tema.
- `ppt/slideMasters/slideMaster1.xml` — estilos por defecto de título/cuerpo (**el master pisa el tema**: el tema declara "Aptos"/"Aptos Display" pero el master fija explícitamente `Roboto` — la fuente que realmente se ve es Roboto, no Aptos).
- `ppt/slideLayouts/slideLayout1-26.xml` — los 26 layouts reales de la plantilla (las 5 "diapositivas" del archivo estaban vacías; todo el diseño vive en los layouts).
- `ppt/tableStyles.xml` — estilo de tabla por defecto.
- `docProps/app.xml` — metadata de PowerPoint, confirma independientemente la lista de fuentes usadas.

## Decisión (registro de la referencia extraída)

### 1. Formato

16:9 panorámico, `12192000 × 6858000` EMU = **13.333″ × 7.5″**.

### 2. Paleta de color

**Esquema de tema, nombrado "Telemetry"** (`theme1.xml`):

| Rol del tema | Hex | Uso |
|---|---|---|
| `dk1` / `dk2` | `#EF6535` | Naranja primario — **mapeado como color de texto por defecto** (`tx1→dk1`, ver más abajo) |
| `lt1` / `lt2` | `#FFFFFF` | Blanco — fondo por defecto (`bg1→lt1`) |
| `accent1` | `#DA5C16` | Naranja oscuro/quemado — relleno de encabezados de tabla |
| `accent2` | `#595959` | Gris oscuro neutro |
| `accent3` | `#EF6535` | Igual al primario |
| `accent4` | `#DB3A14` | Rojo-naranja |
| `accent5` | `#EF6535` | Igual al primario |
| `accent6` | `#DB3A14` | Igual a accent4 |
| `hlink` | `#DB3A14` | Color de hipervínculo |
| `folHlink` | `#595959` | Hipervínculo visitado |

**Mapeo de color activo** (`slideMaster1.xml` → `<p:clrMap>`): `tx1→dk1`, `bg1→lt1` — es decir, **el texto por defecto de toda la plantilla es naranja `#EF6535` sobre fondo blanco**, no negro sobre blanco. Es una decisión de marca deliberada y agresiva, coherente con una identidad muy dominada por el naranja.

**Paleta extendida** (slide de referencia dedicado, layout 26 "Paleta de colores" — swatches con hex explícito en el XML):

| Hex | Descripción aproximada |
|---|---|
| `#000000` | Negro |
| `#494949` | Gris oscuro |
| `#522212` | Marrón oscuro / vino |
| `#A34424` | Óxido |
| `#BF6436` | Naranja-marrón medio |
| `#C4C4C4` | Gris claro |
| `#E2E2E2` | Gris muy claro |
| `#EF6535` | **Naranja primario** (= dk1/accent3/accent5) |
| `#FBFBFB` | Casi blanco |
| `#FC6C00` | Naranja vívido/brillante (usado en el layout "Receso") |
| `#FFCDAB` | Melocotón pálido |

### 3. Tipografía

Confirmado por dos fuentes independientes (el override explícito en `slideMaster1.xml` y la lista de "Fuentes usadas" en `docProps/app.xml`): la familia real es **Roboto**, no la que declara el tema (Aptos/Aptos Display — el default de Office post-2023, nunca renderizado porque el master lo pisa).

| Fuente | Dónde se usa |
|---|---|
| **Roboto** (regular) | Cuerpo de texto, títulos por defecto del master |
| **Roboto Light** | Subtítulos, etiquetas secundarias, agenda, comparaciones |
| **Roboto Black** | Títulos de alto impacto (ej. layout "Receso") |
| **Roboto Medium** | (listada en metadata; variante intermedia disponible) |
| **Arial** | Solo como fuente del carácter de viñeta (`•`), no como tipografía de lectura |

**Escala tipográfica** (`p:titleStyle`/`p:bodyStyle` del master, tamaños en pt):

| Elemento | Tamaño | Interlineado | Color |
|---|---|---|---|
| Título | 44pt | 90% | `tx1` (naranja) |
| Cuerpo nivel 1 | 28pt | 90% | `tx1` (naranja) |
| Cuerpo nivel 2 | 24pt | 90% | `tx1` |
| Cuerpo nivel 3 | 20pt | 90% | `tx1` |
| Cuerpo nivel 4-5 | 18pt | 90% | `tx1` |

### 4. Estilo de tabla

Estilo por defecto nombrado **"Estilo medio 2 - Énfasis 1"** (`tableStyles.xml`):
- Encabezado (primera fila), última fila, primera y última columna: relleno `accent1` (`#DA5C16`, naranja oscuro), texto blanco (`lt1`) en **negrita**.
- Bandas alternadas (filas/columnas pares vs. impares): `accent1` al 40% de tinte (naranja claro) alternando con sin relleno.
- Bordes: 1pt (`12700` EMU), color `lt1` (blanco), en las 4 direcciones + líneas internas.
- Texto de celda del cuerpo: fuente `minor` (Roboto), color `dk1` (naranja).

### 5. Inventario completo de layouts (26)

| # | Nombre | Propósito |
|---|---|---|
| 1 | Portada - Bienvenidos | Cover genérico, imagen de fondo de página completa (`image1.png`) |
| 2 | Portada - Perforación | Cover temático de perforación minera (`image2.png`) |
| 3 | Portada - Geoespacial | Cover temático geoespacial (`image3.png`) |
| 4 | Título 1 | Título + subtítulo, variante 1 |
| 5 | Título 2 | Título + subtítulo, variante 2 |
| 6 | Título 3 | Título + subtítulo + numeración de sección (`SX - TEMA XX`) |
| 7 | Índice - Agenda General | Agenda con ítems numerados (`#`/`S`), duración (`XX min`), descripción y expositor |
| 8 | Índice - Agenda General 2 | Variante de agenda |
| 9 | Título y objetos | Título + cuerpo con hasta 5 niveles de viñetas |
| 10 | 1_Solo el título | Slide de sección con doble subtítulo (`SUB-TÍTULO 1`/`2`) |
| 11-14 | Fotografía (1)/(2)/(4)/(8) | Grillas de 1, 2, 4 u 8 fotos |
| 15 | Título + Dos objetos | Layout de dos columnas de contenido |
| 16 | Comparación | Dos columnas con hasta 5 niveles cada una, fondo `#F9F9F9` |
| 17 | Solo el título | Título únicamente |
| 18 | En blanco | Slide vacío |
| 19 | Solo título 2 | Variante de solo título |
| 20 | Contenido con título | Título + cuerpo con niveles |
| 21 | Imagen con título | Imagen + título |
| 22 | Final - Contacto | Slide de cierre con datos de contacto (ver §6) |
| 23 | Final - Contacto 2 | Variante de cierre |
| 24 | Receso | Slide de pausa/break, título en Roboto Black, naranja vívido `#FC6C00` |
| 25 | Íconos 1 | Hoja de referencia de 25 iconos de redes sociales (SVG) |
| 26 | Paleta de colores | Slide de referencia con los swatches de la §2 |

### 6. Identidad de marca extraída del layout "Final - Contacto"

Datos de contacto públicos ya presentes en la plantilla oficial (información de marketing, no dato personal):
- **Dominio**: `timetelemetry.com`
- **Domicilio**: Cal. Mártir José Olaya Nro. 129 Dpto. 1506 – Miraflores - Lima
- **LinkedIn**: `company/timetelemetryperu`
- **Instagram/otra red**: `@Time.telemetry`
- **Otra referencia de cuenta**: `@Timetelemetry-sac` (sugiere razón social con sufijo S.A.C.)

### 7. Activos gráficos

46 archivos en `ppt/media/`: 3 fotografías temáticas de portada (PNG), 1 foto de la sección "Receso", y ~40 iconos vectoriales (SVG) reutilizados en agenda, comparación, contacto y la hoja de iconos de referencia.

## Consecuencias

- **Divergencia de tono a resolver**: el naranja de esta plantilla es `#EF6535`; el naranja de marca ya vigente en el frontend de InformeCliente (rebrand 2026-08-02, ver memoria del proyecto) es `#F07E41` — visualmente muy cercanos pero **no el mismo hex**. Si se busca consistencia perfecta entre el software y el material de presentación corporativo, alguien debe decidir cuál es la fuente de verdad (o si conviven ambos matices en contextos distintos: `#F07E41` para UI de producto, `#EF6535` para material de presentación/marketing). Esta decisión queda pendiente, no se resuelve en este ADR.
- **Roboto vs. la tipografía del producto**: el software usa `Rajdhani`/`Barlow Semi Condensed` (`--font-mining-ui`/`--font-mining-display`, ver `index.css`); la plantilla de presentaciones usa Roboto. Son sistemas de marca para medios distintos (producto de software vs. documento/presentación) — no se unifican acá, solo se deja constancia de que son diferentes.
- Esta referencia queda disponible para cuando se implemente (o se toque) la generación de PPTX narrado de ADR-083/084 con la identidad visual oficial de Beemetry/TimeTelemetry, en vez de un estilo genérico.
- El dígito verificador de "texto por defecto = naranja sobre blanco" (`tx1→dk1`) es agresivo para cuerpos de texto largos (bajo contraste/legibilidad en párrafos extensos) — si se genera contenido real a partir de esta plantilla, vale la pena revisar caso por caso si el cuerpo de cada slide debe quedar en negro/gris oscuro en vez del naranja por defecto, en vez de asumir ciegamente el valor heredado del master.

## Alternativas descartadas

- **Renderizar miniaturas visuales de los 26 layouts** (`scripts/thumbnail.py` de la skill de pptx): descartado por falta de LibreOffice instalado en este entorno Windows (el wrapper de la skill además asume sockets Unix, incompatible con Windows nativo). Se compensó leyendo el XML directamente, que en este caso es más preciso para valores exactos (hex, pt, EMU) que una inspección visual.
- **Usar `markitdown` para el volcado de texto**: falló porque el content-type interno de un `.potx` renombrado a `.pptx` sigue declarándose como plantilla; se optó por extraer los nodos `<a:t>` directamente vía búsqueda en el XML, igual de confiable para este propósito.

## Referencias

- `C:\Users\BEEMETRY\Downloads\Plantilla Telemetry.potx` (archivo original entregado por Gerencia, fuera del repositorio)
- `ppt/theme/theme1.xml`, `ppt/slideMasters/slideMaster1.xml`, `ppt/slideLayouts/slideLayout1-26.xml`, `ppt/tableStyles.xml` (dentro del `.potx`)
- ADR-083 (`exportacion-pptx-modo-presentacion-sidecar-hibrido`)
- ADR-084 (`conversion-pptx-video-narracion-diapositiva`)
- `frontend/src/index.css` (paleta `--primary: #F07E41` y tipografía `--font-mining-*` vigentes del producto, para contraste con esta plantilla)
