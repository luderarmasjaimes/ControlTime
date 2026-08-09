# ADR-048 — Carátula a toda página; la imagen de empresa es un bloque libre, no un fondo fijo

## Ampliación 2026-07-27 (2) — 5 diseños reales por audiencia (Gerencia/Control Interno/Auditoría Interna/Campo/Normativo)

A pedido explícito del negocio: los informes de esta plataforma se dirigen
a audiencias distintas (Gerencia, Control Interno, Auditoría Interna,
Operaciones de campo, Auditoría/regulación minera — MINEM y similares), y
cada una necesita una carátula visualmente distinguible a simple vista, no
solo una etiqueta de menú distinta sobre el mismo fondo (ver corrección de
auditoría arriba, que dejó esto como decisión pendiente de Gerencia).

**Diseño**: se investigaron referencias reales de portadas de informes
mineros/técnicos (NI 43-101, JORC, guías de portada de auditoría interna)
para fundamentar la paleta y composición de cada plantilla — el resultado
completo vive en `frontend/src/components/ReportStudioV2/lib/coverTemplates.ts`
(`COVER_TEMPLATES`, un registro tipado, 100% CSS — gradientes y patrones
repetidos, sin imágenes externas, para que la carátula siga siendo
autocontenida y exportable a PDF sin depender de assets remotos):

| Plantilla | Audiencia | Paleta / composición |
|---|---|---|
| `corporate` (Corporativo) | Gerencia General | Degradé navy + acento dorado — **sin cambios respecto al diseño original**, para no romper informes ya guardados |
| `technical` (Técnico) | Control Interno / Ingeniería | Azul técnico + grilla tipo plano de ingeniería (líneas finas repetidas), acento celeste, título en fuente monoespaciada |
| `executive` (Ejecutivo) | Auditoría Interna | Grises institucionales deliberadamente sin colores vivos, franja de clasificación blanca (no oscura), título en serif (Georgia) |
| `field` (Campo) | Operaciones de campo | Tonos tierra (terracota/caqui) + franja diagonal de alta visibilidad tipo señalización de seguridad, clasificación en amarillo |
| `normative` (Normativo) | Auditoría Minera / regulatorio | Verde institucional oscuro, acento dorado apagado, título en serif — tono de documento oficial |

**Implementación**:
- `useEditorStore.ts`: la rama especial `type === 'cover'` de `addElement()`
  antes ignoraba por completo el `patch` — ahora mergea `patch.props`, así
  el ribbon puede pasar `{ props: { coverTemplate: id } }`. `defaultPropsByType('cover')`
  deja `title`/`classification`/`textColor`/`bgColor` vacíos a propósito
  (antes tenían valores fijos hardcodeados) para que el render caiga al
  fallback de la plantilla elegida cuando el usuario no escribió nada
  propio — `coverTemplate` por defecto es `'corporate'`, así que informes
  guardados antes de este cambio (sin el campo) se siguen viendo idénticos.
- `PageCanvas.tsx`: el render de `cover` busca la plantilla con
  `findCoverTemplate(p.coverTemplate)` y usa sus valores como fallback en
  cada punto donde antes había un color/texto fijo — cualquier
  personalización explícita del usuario (`p.bgColor`, `p.textColor`,
  `p.classification`, `p.title`) sigue ganando siempre sobre la plantilla.
- `App.tsx`: `onInsertCoverPage` ahora recibe el `templateId` real del
  dropdown del ribbon (antes lo ignoraba, insertando siempre el mismo
  diseño pese a que el usuario elegía una de las 5 opciones).
- `RightInspector.tsx` (`CoverInspector`): se agregó un selector "Plantilla"
  para poder cambiar el diseño DESPUÉS de insertar la carátula, sin tener
  que borrarla y reinsertarla.

**Verificado en vivo** (rebuild + redeploy real de `beemetry-web`,
confirmado por hash de bundle nuevo): las 5 plantillas se probaron una por
una vía el selector de "Plantilla" del panel de propiedades — cada una
renderiza con su paleta, patrón de fondo y tipografía de título distintos,
y `corporate` se confirmó visualmente idéntico al diseño original (mismo
degradé navy/dorado, banner "CONFIDENCIAL").

## Corrección de auditoría 2026-07-27 — QA de certificación, TC-COV-01

El botón del ribbon "Carátula" (grupo Documento → dropdown con 5 plantillas:
Corporativo/Técnico/Ejecutivo/Campo/Normativo) no insertaba absolutamente
nada — `RibbonToolbar.tsx` declara `onInsertCoverPage?: (templateId: string)
=> void` y lo invoca correctamente al elegir una plantilla, pero `App.tsx`
nunca pasaba ese prop al componente: era `undefined`, así que el clic no
tenía ningún efecto observable. La biblioteca lateral (sidebar izquierdo)
sí tenía un botón equivalente funcional ("Insertar bloque de portada"),
conectado a `handleAddCover = useCallback(() => addElement('cover'),
[addElement])` — por eso el defecto pasó desapercibido en auditorías
anteriores centradas en esa biblioteca en vez del ribbon.

**Corrección**: `App.tsx` ahora pasa `onInsertCoverPage={() =>
addElement('cover')}` al ribbon — misma lógica que `handleAddCover`, ya
que **no existe (ni existió nunca) una implementación visual distinta por
cada una de las 5 plantillas** del dropdown; las 5 opciones insertan hoy
el mismo diseño único descrito en este ADR. Si el negocio necesita 5
diseños de carátula realmente distintos, es alcance nuevo (mismo criterio
que los hallazgos G1/G2 del catálogo de QA) — decisión pendiente de
Gerencia, no implementada en esta corrección.

Nota de proceso: el primer intento de corregir y verificar este bug
produjo un falso positivo — `docker compose build frontend` falló a mitad
de build (`buildkit: error reading from server: EOF`, típico del mismo
desajuste de Docker Desktop visto antes en esta sesión) pero el wrapper de
la tarea en background reportó "completado, exit 0" de todas formas;
`docker compose up -d --force-recreate` entonces sirvió la imagen VIEJA
sin el fix, y la verificación en vivo (correctamente) siguió fallando. Se
detectó comparando el hash del bundle servido (`main-DGBbMafA.js`, sin
cambios) contra el log de build real, se reconstruyó limpiamente
(confirmado hasta "✓ built" y un hash de bundle nuevo, `main-Bu4E87QI.js`)
y recién ahí se verificó en vivo: la carátula se inserta a toda página con
degradé, franja "CONFIDENCIAL", título "Informe Técnico" y el panel
"CARÁTULA" en Propiedades con el picker de fotos de la unidad minera.
Lección: tras cualquier build en background, confirmar el hash real del
bundle servido antes de dar una verificación por buena — un exit code
reportado no basta cuando BuildKit puede fallar a mitad de camino.

---

**Status**: implemented, revisado (verificado 2026-07-17 contra `useEditorStore.ts`, `RightInspector.tsx` — `CoverInspector`/`CoverGalleryPicker`)
**Fecha**: 2026-07-09 (aprox.; revisado 2026-07-11; formalizado retroactivamente el 2026-07-17)
**Autores**: EC
**Ámbito**: reports

## Contexto

La primera versión de la carátula (`cover`) aplicaba la foto de la unidad minera como **fondo de bloque** (`background-image`), lo que producía un mosaico/repetición visual indeseado y, al ser parte de un bloque bloqueado (`locked: true`, no editable), el usuario no podía mover ni redimensionar esa imagen — quedaba pegada al layout original de la carátula sin control real.

## Decisión

1. **La carátula ocupa siempre toda la hoja** (`x:0, y:0, width:PAGE_WIDTH, height:PAGE_HEIGHT`), recalculado en cada cambio de tamaño de papel/orientación (`applyPageSetup`/`applyPagePaperSetup`).
2. **La imagen de la unidad minera deja de ser fondo del bloque `cover`.** Se inserta como un bloque `image` **normal, libre** (movible/redimensionable, mismas reglas que cualquier imagen del informe) mediante el botón/acción "Insertar Imagen Empresa" — que la centra sobre la carátula con un tamaño inicial generoso pero deja que el usuario la ajuste después.
3. El bloque `cover` en sí solo retiene texto (título, código de documento, autor, fecha) — sigue `locked: true` (no editable/movible/borrable desde la UI estándar, mismo criterio que ADR-046).
4. Se agrega un **selector de galería con miniatura ampliable** (`CoverGalleryPicker`) — clic en la miniatura abre una vista ampliada (lightbox) antes de insertar, para elegir la foto correcta sin adivinar por un thumbnail pequeño.

## Consecuencias

### Positivas
- El usuario tiene control total (mover/redimensionar/eliminar) sobre la foto de portada, igual que con cualquier otra imagen — sin caso especial.
- Se eliminó el bug visual de mosaico/repetición de fondo.
- Visualmente, cualquier imagen insertada sobre la carátula queda **por encima** de su fondo de texto (orden de declaración en el JSX de `PageCanvas.tsx` — el pintado de overlays Html sigue el orden de declaración, no `zIndex`, salvo la excepción de ADR-049 para `wrapMode: 'behind'`).

### Negativas / Trade-offs
- El bloque `cover` y la imagen de empresa son ahora dos bloques independientes — si el usuario borra la imagen por error, no hay "fondo" de respaldo; debe volver a insertarla desde la galería (mitigado por el picker con miniatura ampliable, más rápido que buscar el archivo de nuevo).

## Alternativas descartadas

### Recortar/ajustar el `background-image` con `background-size`/`background-position` configurables
Resolvía el mosaico sin cambiar el modelo de bloques, pero no daba control de posición/tamaño real al usuario (seguía siendo "fondo", no un objeto manipulable) — no resolvía la queja real del negocio ("no puedo moverla ni redimensionarla").

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (`addCenteredImage`, `applyPageSetup`)
- `frontend/src/components/ReportStudioV2/components/layout/RightInspector.tsx` (`CoverInspector`, `CoverGalleryPicker`)
- ADR-046 (mismo criterio de bloqueo para elementos de plataforma fijos), ADR-047 (galería de imágenes), ADR-049 (orden de pintado con `wrapMode`)
