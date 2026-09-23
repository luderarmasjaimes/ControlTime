import React from 'react';
import { Html } from 'react-konva-utils';
import { Text } from 'react-konva';
import {
  Wand2,
  Mic,
  MicOff,
  CheckCheck,
  Save,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Paintbrush,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';
import { useEditorStore, type ReportElement, type ReportPage } from '../../../../store/useEditorStore';
import {
  type TextStyleSpan,
  type BaseTextStyle,
  buildStyledSegments,
  applyStyleToRange,
  remapSpansForTextChange,
  styleToCss,
  getEffectiveStyleAt,
  reindexSpans,
  expandRangeToParagraphs,
  buildParagraphGroups,
} from '../../../../lib/textSpans';
import { applyListToText, stripListMarkers, indentListLine, depthTabsToDisplaySpaces, LIST_INDENT_TAB_SIZE, type ListStyleType } from '../../../../lib/listFormatting';
import { SELECTION_HEADING_OPTIONS, findHeadingStyle } from '../../../../lib/headingStyles';
import { splitTextForHeight } from '../../../../lib/textPagination';
import { parseRichClipboardPaste } from '../../../../lib/richPaste';
import { textCorrectQuick, textCorrectAdvanced, textRewriteOnPremise } from '../../../../lib/api';
import { textForSpellOrRewrite } from '../../../../lib/textSpellUtils';
import { measurePerfAsync } from '../../../../lib/performanceMonitor';
import { generateAnnexData } from '../../AnnexList';
import ColorPalette from '../../../shared/ColorPalette';
import FloatingContextualToolbar from '../../FloatingContextualToolbar';
import { navigateToTocEntry } from '../shared/tocNavigation';
import {
  type TextProps,
  getTextProps,
  getAutoSizedTextBox,
  getSpeechCtor,
  getSpellcheckLang,
  normalizeDictationText,
  isLikelyLowQualityTranscript,
  pickBestTranscriptAlternative,
  computeWrappedTextLines,
  type WrapExclusion,
  type AdvancedSuggestion,
} from './textBlockModel';

/** Comando "/referencia" (pedido explícito 2026-09-04): apenas el texto
 * tecleado hasta el cursor termina en este comando, se abre un picker
 * minimalista (mismo criterio visual que spellMenu) con todos los pies de
 * imagen/tabla/gráfico del documento (ver AnnexList.tsx). */
const SLASH_REF_TRIGGER = '/referencia';
/** AutoFormato de Word (pedido explícito 2026-09-04): "- " al inicio de una
 * línea se convierte sola en viñeta. Espacios de sobra (no solo uno)
 * después del • para un espaciado más parecido al de Word que el "• " a
 * secas del botón manual de lista (lib/listFormatting.ts). */
const BULLET_MARKER = '•   ';

export interface TextBlockProps {
  element: ReportElement;
  page: ReportPage;
  selectedElementId: string | undefined;

  // Métricas de layout de la página (márgenes actuales del usuario incluidos)
  CONTENT_LEFT: number;
  CONTENT_RIGHT: number;
  CONTENT_TOP: number;
  CONTENT_BOTTOM: number;
  PAGE_WIDTH: number;
  PAGE_HEIGHT: number;

  onRequestImageReplace?: (pageNumber: number, elementId: string, initialTab?: string) => void;

  // Acciones del store
  selectElement: (id: string | undefined) => void;
  updateElement: (pageNumber: number, elementId: string, patch: Partial<ReportElement>) => void;
  addElement: (type: string, patch?: any) => void;
  removeElement: (pageNumber: number, elementId: string) => void;
  splitOverflowingText: (args: any) => void;
  pasteTextAcrossPages: (args: any) => void;

  /** Estado "singleton" de edición de texto de la PÁGINA (dueño real:
   * PageCanvas.tsx -- coordina con el loop de selección/arrastre y con
   * otros tipos de bloque, ver los `useEffect` de esa sección, dejados ahí
   * a propósito). Cada `TextBlock` recibe el mismo valor/setter; el que
   * de verdad "hace algo" con él es siempre el bloque cuyo
   * `element.id === openTextEditorId`. */
  openTextEditorId: string | null;
  setOpenTextEditorId: (id: string | null) => void;
  liveEdit: { id: string; text: string; width: number; height: number; spans: TextStyleSpan[] } | null;
  setLiveEdit: React.Dispatch<React.SetStateAction<{ id: string; text: string; width: number; height: number; spans: TextStyleSpan[] } | null>>;
  pendingTypingStyle: { elementId: string; style: Partial<BaseTextStyle> } | null;
  setPendingTypingStyle: React.Dispatch<React.SetStateAction<{ elementId: string; style: Partial<BaseTextStyle> } | null>>;
  selectionTick: number;
  setSelectionTick: React.Dispatch<React.SetStateAction<number>>;
  caretRect: { left: number; top: number; height: number } | null;

  // Dictado por voz
  isDictating: boolean;
  setIsDictating: (v: boolean) => void;
  speechError: string | null;
  setSpeechError: (v: string | null) => void;
  interimDictation: string;
  setInterimDictation: (v: string) => void;
  recognitionRef: React.MutableRefObject<any>;
  dictationTargetRef: React.MutableRefObject<string | null>;
  stopDictation: () => void;

  // Corrección / mejora con IA
  correctionInfo: string | null;
  setCorrectionInfo: React.Dispatch<React.SetStateAction<string | null>>;
  isImproving: boolean;
  runAIImprovement: (currentText: string, updateFn: (patch: { text: string }) => void) => Promise<void> | void;
  advancedSuggestions: AdvancedSuggestion[];
  setAdvancedSuggestions: React.Dispatch<React.SetStateAction<AdvancedSuggestion[]>>;
  isAnalyzingSpelling: boolean;
  setIsAnalyzingSpelling: (v: boolean) => void;

  // Subrayado rojo en vivo (LanguageTool en segundo plano, ver el
  // `useEffect` de debounce en PageCanvas.tsx)
  inlineSpellIssues: AdvancedSuggestion[];
  setInlineSpellIssues: React.Dispatch<React.SetStateAction<AdvancedSuggestion[]>>;
  spellMenu: { issue: AdvancedSuggestion; left: number; top: number } | null;
  setSpellMenu: React.Dispatch<React.SetStateAction<{ issue: AdvancedSuggestion; left: number; top: number } | null>>;
  spellMenuRef: React.RefObject<HTMLDivElement>;

  // "Separar en bloque nuevo" (clic derecho con selección)
  splitBlockMenu: { elementId: string; start: number; end: number; left: number; top: number } | null;
  setSplitBlockMenu: React.Dispatch<React.SetStateAction<{ elementId: string; start: number; end: number; left: number; top: number } | null>>;
  // Picker "/referencia"
  slashRefMenu: { elementId: string; triggerStart: number; triggerEnd: number } | null;
  setSlashRefMenu: React.Dispatch<React.SetStateAction<{ elementId: string; triggerStart: number; triggerEnd: number } | null>>;

  // "Copiar formato" (pincel)
  copiedTextFormat: BaseTextStyle | null;
  setCopiedTextFormat: (format: BaseTextStyle | null) => void;

  // Refs varios (cursor visual propio, selección con mouse, IME, etc.)
  isComposingRef: React.MutableRefObject<boolean>;
  activeTextareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  textSplitInProgressRef: React.MutableRefObject<boolean>;
  selectionRangeRef: React.MutableRefObject<{ start: number; end: number } | null>;
  activeFormatBridgeRef: React.MutableRefObject<((patch: Partial<BaseTextStyle>) => boolean) | null>;
  activeCaseBridgeRef: React.MutableRefObject<(() => boolean) | null>;
  activeRefInsertBridgeRef: React.MutableRefObject<((targetId: string) => boolean) | null>;
  ghostWrapRef: React.RefObject<HTMLDivElement>;
  textMouseAnchorRef: React.MutableRefObject<number | null>;
  textSelectionFrameRef: React.MutableRefObject<number | null>;
  liveEditCommitTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  wrapAutoHeightRef: React.MutableRefObject<Map<string, { y: number; height: number }>>;

  getIndexFromClickPoint: (clientX: number, clientY: number) => number;
  resolveTextRef: (targetId: string) => string | undefined;
}

/**
 * Bloque de texto -- el más grande y delicado del lienzo (liveEdit con
 * commit diferido de 600ms, spans de formato por selección, ajuste
 * alrededor de objetos estilo Word, auto-paginación mientras se escribe,
 * dictado por voz, corrección ortográfica en vivo, referencias cruzadas...
 * ver los comentarios de cada sección más abajo, todos con su bug real
 * documentado). Extraído mecánicamente de PageCanvas.tsx (antes ~2600
 * líneas de las ~7200 del archivo) -- el prop bag es grande a propósito:
 * el estado "singleton" de qué bloque está en edición (dueño real:
 * PageCanvas.tsx, coordinado con el resto del lienzo -- selección, otros
 * tipos de bloque, atajos globales) se queda ahí, este componente solo lo
 * recibe. Mismo criterio que ya usa TableBlock.tsx (props de callbacks en
 * vez de estado propio) a una escala mayor, acorde a la complejidad real
 * de editar texto enriquecido dentro del lienzo.
 */
export default function TextBlock({
  element, page, selectedElementId,
  CONTENT_LEFT, CONTENT_RIGHT, CONTENT_TOP, CONTENT_BOTTOM, PAGE_WIDTH, PAGE_HEIGHT,
  onRequestImageReplace,
  selectElement, updateElement, addElement, removeElement, splitOverflowingText, pasteTextAcrossPages,
  openTextEditorId, setOpenTextEditorId,
  liveEdit, setLiveEdit,
  pendingTypingStyle, setPendingTypingStyle,
  selectionTick, setSelectionTick,
  caretRect,
  isDictating, setIsDictating, speechError, setSpeechError, interimDictation, setInterimDictation,
  recognitionRef, dictationTargetRef, stopDictation,
  correctionInfo, setCorrectionInfo, isImproving, runAIImprovement,
  advancedSuggestions, setAdvancedSuggestions, isAnalyzingSpelling, setIsAnalyzingSpelling,
  inlineSpellIssues, setInlineSpellIssues, spellMenu, setSpellMenu, spellMenuRef,
  splitBlockMenu, setSplitBlockMenu, slashRefMenu, setSlashRefMenu,
  copiedTextFormat, setCopiedTextFormat,
  isComposingRef, activeTextareaRef, textSplitInProgressRef, selectionRangeRef,
  activeFormatBridgeRef, activeCaseBridgeRef, activeRefInsertBridgeRef,
  ghostWrapRef, textMouseAnchorRef, textSelectionFrameRef, liveEditCommitTimerRef, wrapAutoHeightRef,
  getIndexFromClickPoint, resolveTextRef,
}: TextBlockProps) {
  const spellcheckLang = getSpellcheckLang();
  const speechSupported = Boolean(getSpeechCtor());
              const textProps = getTextProps(element);
              // Ancho de columna completo (margen a margen) — bug real
              // reportado: el ancho que se RENDERIZA (CSS de
              // .text-editor-rich-wrap, ver liveWidth abajo) es un ancho
              // DISTINTO al que getAutoSizedTextBox usa internamente para
              // decidir dónde envuelve cada línea (ver comentario largo en
              // getAutoSizeForPatch: el ancho devuelto se ajusta a la línea
              // más larga que apareció, puede quedar más angosto que la
              // columna completa). El NAVEGADOR envuelve el texto visible
              // según el CSS (el ancho angosto), mientras mi cálculo de
              // partición asume el ancho completo — cuando divergen, el
              // navegador salta de línea ANTES de lo que mi cálculo espera,
              // y el usuario ve el alto "saltar" a mitad de lo que él
              // percibe como la misma línea. Usar este mismo valor para
              // TODO (render Y cálculo) elimina la divergencia de raíz.
              // Caja de una página réplica de PDF (ADR-209): su ancho ES el del
              // texto original, no "hasta el margen" -- editar no debe
              // ensancharla (rompería el centrado/justificado y la columna vecina).
              const isExactLayout = !!(element.props as any)?.exactLayout;
              // La hoja de estilos global de la app fija `span { line-height:
              // 1.35 }` -- en una réplica cada tramo debe heredar el
              // interlineado REAL del párrafo (paso de línea del PDF), si no
              // cada línea crece y las últimas se montan sobre el bloque de abajo.
              const exactSpanCss = isExactLayout ? { lineHeight: 'inherit' } : {};
              // Réplica: interlineado en px ABSOLUTOS (paso real del PDF). Un
              // factor sin unidad se multiplicaría por el tamaño de CADA tramo
              // -- un título de 9pt junto a un superíndice de 5pt agrandaba la
              // línea y corría todo lo de abajo.
              const effectiveLineHeight: number | string = isExactLayout
                ? `${textProps.lineHeight * textProps.fontSize}px`
                : textProps.lineHeight;
              const fullColumnWidth = isExactLayout ? element.width : CONTENT_RIGHT - element.x - textProps.indentRight;
              const mergedProps = { ...(element.props || {}) };
              const isPageTextElement = page.plainTextElementId === element.id;
              // El elemento de "texto plano" de la página (ver
              // ReportPage.plainTextElementId) usa el MISMO mecanismo real
              // de edición que cualquier bloque de texto (openTextEditorId),
              // no un "siempre abierto" forzado -- bug real reportado: forzar
              // isEditorOpen=true sin pasar por openTextEditorId dejaba
              // huérfanos el cursor visual (caretRect, efecto keyed en
              // openTextEditorId más arriba), el resaltado de selección
              // (getLiveSelectionRange lee activeTextareaRef, que closeAndProcess
              // pone en null en cualquier blur sin que nada lo reasigne — la
              // ref de React no se re-invoca si el nodo no se desmonta) y la
              // barra de formato flotante (montada sin importar si el usuario
              // estaba realmente escribiendo). Con el flag real, este bloque
              // se abre con UN solo clic en vez de doble (ver Rect onClick más
              // abajo) pero por lo demás se comporta exactamente como
              // cualquier otro bloque en edición -- que es lo único que
              // necesitaba ser distinto era el contenedor visual, ya resuelto
              // aparte (borde/recuadro punteado/asas, ver isEditingText,
              // el filtro del recuadro punteado y isPageTextEl más arriba).
              const isEditorOpen = openTextEditorId === element.id;
              const isElementSelected = selectedElementId === element.id;
              const isCurrentDictationTarget = isDictating && dictationTargetRef.current === element.id;
              // Mientras se edita, el texto/tamaño "reales" son los del
              // estado local (lo último tecleado) — el store puede estar
              // hasta 600ms desactualizado por el debounce de Fase 2.
              const isLiveEditingThis = isEditorOpen && liveEdit?.id === element.id;
              const liveText = isLiveEditingThis ? liveEdit.text : textProps.text;
              // fullColumnWidth (no liveEdit.width) mientras se edita: debe
              // ser el MISMO valor que usa el cálculo de partición/altura,
              // para que el CSS que realmente envuelve el texto en pantalla
              // coincida con lo que ese cálculo asume (ver comentario largo
              // en la definición de fullColumnWidth, más arriba).
              const liveWidth = isLiveEditingThis ? fullColumnWidth : element.width;
              const liveHeight = isLiveEditingThis ? liveEdit.height : element.height;
              const liveSpans = isLiveEditingThis ? liveEdit.spans : textProps.spans;
              const textBaseStyle: BaseTextStyle = {
                bold: textProps.bold,
                italic: textProps.italic,
                underline: textProps.underline,
                // Sin toggle de bloque para tachado (a diferencia de negrita/
                // cursiva/subrayado) -- el único origen real hoy es texto
                // importado de Word, que SIEMPRE llega como span, nunca como
                // estilo base del bloque completo; ver TextStyleSpan.strikethrough.
                strikethrough: false,
                color: textProps.fontColor,
                fontSize: textProps.fontSize,
                fontFamily: textProps.fontFamily,
                // Resaltado BASE del bloque (ribbon fijo, sin selección
                // activa) — los spans por selección (barra flotante) lo
                // sobreescriben solo en su rango, igual que con `color`.
                // Distinto de props.backgroundColor (el fondo de TODO el
                // cuadro/caja de texto, no del texto en sí).
                highlightColor: textProps.highlightColor,
                headingStyle: textProps.headingStyle,
                textAlign: textProps.textAlign,
              };
              // Los valores de párrafo se guardan sobre el globo de texto
              // para conservar el modelo actual de Konva, pero se renderizan
              // como espacio interior del contenido: no desplazan ni alteran
              // tablas, imágenes, gráficos u otros elementos del lienzo.
              const paragraphLeft = textProps.indentLeft;
              const paragraphRight = textProps.indentRight;
              const paragraphBefore = textProps.spacingBefore;
              const paragraphAfter = textProps.spacingAfter;
              const specialIndentOffset = textProps.specialIndent === 'firstLine'
                ? textProps.specialIndentBy
                : textProps.specialIndent === 'hanging'
                  ? -textProps.specialIndentBy
                  : 0;
              // exactLayout (réplica de PDF, ADR-209): el HTML se dibuja en
              // element.x/y sin relleno interno, así que el ancho de envoltura
              // debe ser el de la caja completa -- con el -16 de siempre, cada
              // línea del PDF (que ya viene cortada en su lugar) se volvía a
              // partir y el párrafo crecía sobre lo que tenía debajo.
              const paragraphWidth = isExactLayout
                ? Math.max(1, element.width - paragraphLeft - paragraphRight)
                : Math.max(120, element.width - 16 - paragraphLeft - paragraphRight);
              const paragraphHeight = isExactLayout
                ? Math.max(1, element.height - paragraphBefore - paragraphAfter)
                : Math.max(28, element.height - 16 - paragraphBefore - paragraphAfter);

              const getAutoSizeForPatch = (patch: Partial<TextProps>) => {
                const nextProps = { ...textProps, ...patch };
                const maxWidth = CONTENT_RIGHT - element.x - nextProps.indentRight;
                // El ancho NUNCA se encoge por debajo del que ya tiene el
                // bloque (mínimo = element.width, no un piso fijo de 120px)
                // — un bloque creado a todo el ancho de la columna (ribbon o
                // doble clic, ver createElement/onDblClick) debe SEGUIR
                // ocupando todo el ancho aunque el texto tecleado sea corto;
                // solo la ALTURA debe auto-ajustarse línea a línea, como un
                // párrafo normal de Word, no como una etiqueta que se ciñe
                // al contenido. Sigue pudiendo crecer más allá si una
                // palabra sin cortes es más ancha que el bloque (maxWidth).
                const minWidthForPatch = Math.min(maxWidth, Math.max(120, element.width));
                // Mientras se escribe (y también al cerrar, ver
                // closeAndProcess — isEditorOpen sigue true en ese momento),
                // el límite de alto es el borde FÍSICO de la hoja, no el
                // margen de contenido antes del pie de página: con el límite
                // angosto anterior, un cuadro ubicado en la mitad inferior
                // de la página dejaba de crecer apenas se acercaba al pie, y
                // como el textarea tenía overflow:hidden, las líneas
                // siguientes que el usuario seguía escribiendo quedaban
                // ocultas (el texto SÍ se guardaba, pero no se veía) — "no
                // avanza a la siguiente línea". El límite ajustado al área
                // de contenido solo se usa para el <Text> estático (no
                // editando) que nunca debería llegar a necesitarlo, porque
                // ya se guardó con el tamaño físico de hoja.
                const maxHeight = isEditorOpen
                  ? PAGE_HEIGHT - element.y - 8
                  : CONTENT_BOTTOM - element.y;

                const autoSized = getAutoSizedTextBox(
                  nextProps.text,
                  nextProps.fontSize,
                  nextProps.fontFamily,
                  nextProps.bold,
                  nextProps.italic,
                  nextProps.lineHeight,
                  minWidthForPatch,
                  28,
                  maxWidth,
                  maxHeight,
                  isEditorOpen,
                  nextProps.spans,
                  {
                    bold: nextProps.bold, italic: nextProps.italic, underline: nextProps.underline, strikethrough: false,
                    color: nextProps.fontColor, fontSize: nextProps.fontSize, fontFamily: nextProps.fontFamily,
                    highlightColor: nextProps.highlightColor, headingStyle: nextProps.headingStyle,
                    textAlign: nextProps.textAlign,
                  },
                );
                // El bloque de "texto plano" de la página nunca se encoge
                // por debajo del alto de la hoja completa -- bug real
                // encontrado probando: con poco texto, el auto-ajuste lo
                // reducía a solo el alto de esas líneas, y como el hit-area
                // del bloque (el Rect que abre el editor) usa ese mismo
                // alto, un clic más abajo (área en blanco del resto de la
                // "hoja") caía fuera del bloque, contaba como clic en lienzo
                // vacío y cerraba el editor sin volver a abrirlo -- rompía
                // la premisa de "toda la hoja es el bloque de texto". Es un
                // PISO (nunca un techo): sigue pudiendo crecer más si el
                // contenido real supera el alto de la hoja.
                if (isPageTextElement) {
                  const minPageHeight = CONTENT_BOTTOM - element.y;
                  return { ...autoSized, height: Math.max(autoSized.height, minPageHeight) };
                }
                return autoSized;
              };

              // Usado por dictado/corrección/mejora con IA — acciones
              // infrecuentes (no por tecla), así que confirman al store DE
              // INMEDIATO como antes. También sincronizan `liveEdit` para
              // que el textarea controlado (que ya no lee del store mientras
              // se escribe, ver handleLiveTyping) muestre el resultado sin
              // parpadeo de vuelta al valor viejo.
              const updateTextProps = (patch: Partial<TextProps>) => {
                const nextText = patch.text !== undefined ? String(patch.text) : textProps.text;
                // Dictado/corrección IA pueden reemplazar el texto entero —
                // recolocar los spans de formato al nuevo string (diff de
                // prefijo/sufijo común, ver lib/textSpans.ts) para que negrita/
                // color/etc. aplicados antes no se pierdan ni queden mal
                // ubicados tras el cambio.
                const nextSpans = patch.text !== undefined
                  ? remapSpansForTextChange(liveText, nextText, liveSpans)
                  : liveSpans;
                if (liveEditCommitTimerRef.current) {
                  clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = null;
                }
                if (isComposingRef.current) {
                  updateElement(page.page_number, element.id, {
                    props: { ...mergedProps, ...patch, spans: nextSpans },
                  });
                  setLiveEdit({ id: element.id, text: nextText, width: fullColumnWidth, height: liveEdit?.height ?? element.height, spans: nextSpans });
                  return;
                }
                const autoSize = getAutoSizeForPatch(patch);
                // Anti-parpadeo (guardia estilo LastReplaceText de sdkjs): si
                // la medición no cambió el tamaño del cuadro, no tocar
                // width/height — evita re-layouts de Konva sin efecto visual.
                const sizeUnchanged =
                  fullColumnWidth === element.width && autoSize.height === element.height;
                updateElement(page.page_number, element.id, {
                  props: {
                    ...mergedProps,
                    ...patch,
                    spans: nextSpans,
                  },
                  ...(sizeUnchanged ? {} : { width: fullColumnWidth, height: autoSize.height }),
                });
                setLiveEdit({ id: element.id, text: nextText, width: fullColumnWidth, height: autoSize.height, spans: nextSpans });
              };

              // "Separar en bloque nuevo" -- pedido explícito 2026-09-09:
              // clic derecho sobre texto SELECCIONADO dentro del editor
              // (ver splitBlockMenu/onContextMenu del textarea, más abajo)
              // abre un menú con esta opción; nunca se dispara solo con el
              // clic derecho. Extrae el rango [start,end) del texto actual
              // a un bloque de texto COMPLETAMENTE NUEVO e independiente,
              // dejando el resto en el bloque original -- pensado como
              // complemento MANUAL a la partición automática por salto de
              // página de la importación de .docx, para cuando el usuario
              // quiere separar algo que esa partición no detectó.
              const splitSelectionIntoNewBlock = (start: number, end: number) => {
                if (end <= start) return;
                const extractedText = liveText.slice(start, end);
                if (!extractedText.trim()) return;
                // `reindexSpans` (lib/textSpans.ts) ya hace exactamente esto
                // -- recorta y re-basa los spans a [0, end-start) -- mismo
                // uso que la partición automática de texto entre páginas
                // más arriba en este archivo.
                const extractedSpans = reindexSpans(liveSpans, start, end);
                const remainingText = liveText.slice(0, start) + liveText.slice(end);

                const splitBaseStyle: BaseTextStyle = {
                  bold: textProps.bold, italic: textProps.italic, underline: textProps.underline, strikethrough: false,
                  color: textProps.fontColor, fontSize: textProps.fontSize, fontFamily: textProps.fontFamily,
                  highlightColor: 'transparent', headingStyle: '', textAlign: textProps.textAlign,
                };
                // maxHeight GENEROSO (PAGE_HEIGHT, NUNCA un espacio chico)
                // a propósito -- mismo bug real ya corregido en
                // insertTextWithPagination más abajo: un maxHeight chico
                // hace que getAutoSizedTextBox recorte SIEMPRE el
                // resultado a ese tope, sin importar el contenido real.
                const extractedSize = getAutoSizedTextBox(
                  extractedText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                  textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, PAGE_HEIGHT, false,
                  extractedSpans, splitBaseStyle,
                );
                // Mismo colchón de seguridad (+15%, mínimo 24px) que el
                // resto de las inserciones de texto de este archivo -- el
                // canvas nunca mide exactamente igual que el navegador.
                const newHeight = Math.ceil(extractedSize.height * 1.15) + 24;

                // Encoge el bloque ORIGINAL primero -- addElement (abajo,
                // sin x/y explícitos) apila el bloque nuevo debajo de TODO
                // el contenido de la página leyendo el estado del store en
                // ese momento, así que encogerlo antes evita un hueco entre
                // el bloque original (ya más corto) y el nuevo.
                updateTextProps({ text: remainingText });
                selectElement(undefined);
                addElement('text', {
                  props: {
                    text: extractedText, spans: extractedSpans, fontSize: textProps.fontSize,
                    fontFamily: textProps.fontFamily, fontColor: textProps.fontColor, lineHeight: textProps.lineHeight,
                  },
                  width: fullColumnWidth, height: newHeight,
                });
                setSplitBlockMenu(null);
              };

              // Fase 2 — el manejador real de cada tecla. NO escribe al store
              // Zustand de inmediato (eso re-renderiza toda la app suscrita
              // al documento en cada pulsación): actualiza solo el estado
              // LOCAL de esta página (medición ya barata gracias al caché de
              // Fase 1) y confirma al store recién tras una pausa de
              // escritura de 600ms — el equivalente a los "flags de sucio"
              // de sdkjs, pero implementado como debounce simple.
              const handleLiveTyping = (newText: string) => {
                // El menú de reemplazo quedaría apuntando a un offset que ya
                // no corresponde a nada apenas el usuario sigue tecleando.
                if (spellMenu) setSpellMenu(null);
                // Recoloca los spans de formato al string recién tecleado
                // ANTES de tocar el store — así negrita/color aplicados a
                // una porción del texto no "saltan" de lugar cuando el
                // usuario sigue escribiendo antes/después/en medio de ella.
                let nextSpans = remapSpansForTextChange(liveText, newText, liveSpans);
                const pendingStyle = pendingTypingStyle?.elementId === element.id ? pendingTypingStyle.style : null;
                // Si hubo inserción y el usuario eligió formato sin tener una
                // selección, aplicar ese formato exclusivamente al fragmento
                // recién escrito. Así funciona como Word: el texto anterior
                // no se toca y se puede seguir escribiendo con el estilo activo.
                if (pendingStyle && newText.length > liveText.length) {
                  let start = 0;
                  while (start < liveText.length && start < newText.length && liveText[start] === newText[start]) start += 1;
                  let oldEnd = liveText.length;
                  let newEnd = newText.length;
                  while (oldEnd > start && newEnd > start && liveText[oldEnd - 1] === newText[newEnd - 1]) {
                    oldEnd -= 1;
                    newEnd -= 1;
                  }
                  if (newEnd > start) {
                    nextSpans = applyStyleToRange(newText, nextSpans, textBaseStyle, start, newEnd, pendingStyle);
                  }
                }
                if (isComposingRef.current) {
                  setLiveEdit({ id: element.id, text: newText, width: fullColumnWidth, height: liveEdit?.height ?? element.height, spans: nextSpans });
                  return;
                }
                const autoSize = getAutoSizeForPatch({ text: newText });

                // Auto-paginación (pedido explícito 2026-08-27): mientras se
                // escribe, si el bloque ya no entra en lo que resta de ESTA
                // hoja (más allá del margen inferior — no del borde físico,
                // que getAutoSizeForPatch tolera adrede mientras se edita),
                // se PARTE en dos en vez de dejarlo desbordar hasta el
                // commit/blur, que antes movía el bloque ENTERO a la página
                // siguiente (ver reflowTextColumnAfterChange). La parte que
                // cabe se queda; el resto continúa en un bloque nuevo al
                // inicio de la página siguiente, con el foco de edición
                // trasladado ahí mismo (ver useEffect de pendingTextContinuation).
                //
                // El disparador usa un alto "real" (reserveTrailingLine =
                // false), NO `autoSize.height` (que sí reserva una línea en
                // blanco de cortesía mientras se edita, ver getAutoSizeForPatch
                // más arriba): si comparáramos con ese alto inflado, el
                // disparador podía saltar un keystroke ANTES de que
                // splitTextForHeight (que solo mide contenido real) tuviera
                // algo que partir — splitTextForHeight devolvía null (nada
                // realmente desborda todavía), el bloque seguía creciendo sin
                // partirse, y el commit diferido de 600ms terminaba
                // confirmando ese alto inflado al store, disparando el
                // reflow VIEJO (mover el bloque entero) en vez del split.
                // Margen de seguridad (pedido explícito 2026-08-27): nunca
                // dejar que el cálculo llegue al límite exacto del margen
                // inferior — se resta media línea (según el fontSize/
                // lineHeight ACTUALES del bloque, no un número fijo, para
                // que se ajuste solo si cambian fuente/interlineado) antes
                // de decidir si algo entra. Así la partición dispara con
                // aire de sobra en vez de por una fracción de píxel, y dos
                // cálculos que midan con una pizca de diferencia (canvas
                // vs. render real) nunca van a discrepar sobre si algo
                // "justo" entra o no.
                const heightSafetyMargin = (textProps.fontSize * textProps.lineHeight) / 2;
                const pageAvailableHeight = CONTENT_BOTTOM - element.y - heightSafetyMargin;
                // Ancho: fullColumnWidth (definido al tope del .map de
                // este elemento) — el MISMO valor que ahora también usa el
                // CSS real del cuadro (ver liveWidth/setLiveEdit), nunca un
                // ancho auto-ajustado a la línea más larga tecleada.
                // Medir la partición contra un ancho más angosto que el
                // margen real contaba más saltos de línea de los que
                // realmente ocurrían en pantalla, y el bloque se partía
                // ANTES de que la última línea llegara al margen — bug
                // real reportado.
                const realHeight = getAutoSizedTextBox(
                  newText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                  textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, PAGE_HEIGHT - element.y - 8, false,
                  nextSpans, textBaseStyle,
                ).height;
                // Réplica de PDF: posición absoluta, nunca se parte a la hoja
                // siguiente (un pie de página del PDF ya está bajo el margen).
                if (!isExactLayout && realHeight > pageAvailableHeight) {
                  const split = splitTextForHeight(
                    newText,
                    textProps.fontSize,
                    textProps.fontFamily,
                    textProps.bold,
                    textProps.italic,
                    textProps.lineHeight,
                    fullColumnWidth,
                    pageAvailableHeight,
                    nextSpans,
                    textBaseStyle,
                  );
                  if (split) {
                    const fittingSpans = reindexSpans(nextSpans, 0, split.fittingEnd);
                    const overflowSpans = reindexSpans(nextSpans, split.overflowStart, newText.length);
                    // "Cerrado" (ya no se edita aquí), pero SÍ con la misma
                    // línea de cortesía que closeAndProcess deja a
                    // cualquier bloque al cerrar el editor normalmente —
                    // como margen de seguridad, NUNCA relajando el tope
                    // (sigue siendo pageAvailableHeight, no el borde físico
                    // de la hoja): si hay hueco, se usa; si el contenido ya
                    // llena todo el presupuesto, Math.min lo deja igual de
                    // ajustado que antes, PERO nunca más allá de
                    // CONTENT_BOTTOM (relajar ese tope fue lo que volvió a
                    // disparar el reflow viejo — mover el bloque entero —
                    // en el intento anterior).
                    const fittingSize = getAutoSizedTextBox(
                      split.fittingText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                      textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, pageAvailableHeight, true,
                      fittingSpans, textBaseStyle,
                    );
                    // La edición CONTINÚA aquí (se abre en cuanto se monte,
                    // ver useEffect de pendingTextContinuation) — sí reserva
                    // la línea en blanco, igual que cualquier editor abierto.
                    const overflowSize = getAutoSizedTextBox(
                      split.overflowText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                      textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, CONTENT_BOTTOM - CONTENT_TOP, true,
                      overflowSpans, textBaseStyle,
                    );

                    if (liveEditCommitTimerRef.current) {
                      clearTimeout(liveEditCommitTimerRef.current);
                      liveEditCommitTimerRef.current = null;
                    }
                    textSplitInProgressRef.current = true;
                    splitOverflowingText({
                      pageNumber: page.page_number,
                      elementId: element.id,
                      fittingText: split.fittingText,
                      fittingSpans,
                      fittingWidth: fittingSize.width,
                      fittingHeight: fittingSize.height,
                      overflowText: split.overflowText,
                      overflowSpans,
                      overflowWidth: overflowSize.width,
                      overflowHeight: overflowSize.height,
                    });
                    setLiveEdit(null);
                    setOpenTextEditorId(null);
                    return;
                  }
                }

                // width: fullColumnWidth, NUNCA autoSize.width — bug real
                // reportado ("el alto aumenta a mitad de línea"): el CSS
                // real del cuadro (.text-editor-rich-wrap) usa este valor
                // para su `width`, y es lo que el NAVEGADOR usa para
                // envolver el texto visible. autoSize.width se ajusta a la
                // línea más larga tecleada hasta ahora (puede ser más
                // angosto que la columna completa) — si el navegador
                // envuelve con ESE ancho angosto mientras mi cálculo de
                // altura/partición asume la columna completa, ambos
                // divergen: el navegador salta de línea antes de lo que mi
                // cálculo espera, y el alto del cuadro "salta" a mitad de
                // lo que el usuario percibe como la misma línea.
                setLiveEdit({ id: element.id, text: newText, width: fullColumnWidth, height: autoSize.height, spans: nextSpans });

                if (liveEditCommitTimerRef.current) clearTimeout(liveEditCommitTimerRef.current);
                liveEditCommitTimerRef.current = setTimeout(() => {
                  liveEditCommitTimerRef.current = null;
                  // Se relee el elemento DESDE el store en el momento de
                  // confirmar (no desde el cierre/closure de este render)
                  // para nunca pisar props cambiadas por otra vía mientras
                  // el usuario escribía.
                  const state = useEditorStore.getState();
                  const livePage = state.doc.pages.find((p) => p.page_number === page.page_number);
                  const liveElement = livePage?.elements.find((e) => e.id === element.id);
                  if (!liveElement) return;
                  const finalAutoSize = getAutoSizeForPatch({ text: newText });
                  const sizeUnchanged =
                    finalAutoSize.width === liveElement.width && finalAutoSize.height === liveElement.height;
                  updateElement(page.page_number, element.id, {
                    props: { ...(liveElement.props || {}), text: newText, spans: nextSpans },
                    ...(sizeUnchanged ? {} : { width: finalAutoSize.width, height: finalAutoSize.height }),
                  });
                }, 600);
              };

              // Pegar contenido rico (Word/Google Docs, ya convertido a
              // texto+spans por parseRichClipboardPaste en el onPaste de más
              // abajo) en el punto [selStart,selEnd) del texto actual. A
              // diferencia de handleLiveTyping (piensa en UN caracter
              // tecleado y recalcula spans por diff de texto vía
              // remapSpansForTextChange), acá los spans del contenido
              // pegado YA vienen calculados de antemano y hay que insertarlos
              // tal cual, sin pasar por ese diff (que asumiría que el tramo
              // nuevo hereda el estilo de lo que había justo antes, perdiendo
              // el formato real del origen).
              const handlePasteRichText = (pastedText: string, pastedSpans: TextStyleSpan[], selStart: number, selEnd: number) => {
                if (!pastedText) return;
                if (spellMenu) setSpellMenu(null);

                const start = Math.min(selStart, selEnd);
                const end = Math.max(selStart, selEnd);
                const beforeSpans = reindexSpans(liveSpans, 0, start);
                const afterSpansRel = reindexSpans(liveSpans, end, liveText.length);
                const afterSpans = afterSpansRel.map((s) => ({
                  ...s, start: s.start + start + pastedText.length, end: s.end + start + pastedText.length,
                }));
                const pastedSpansAbs = pastedSpans.map((s) => ({ ...s, start: s.start + start, end: s.end + start }));

                let remainingText = liveText.slice(0, start) + pastedText + liveText.slice(end);
                let remainingSpans: TextStyleSpan[] = [...beforeSpans, ...pastedSpansAbs, ...afterSpans];

                // Corta el contenido pegado en tantos trozos como hagan
                // falta para que cada uno quepa en su página -- a diferencia
                // de handleLiveTyping (que corta UNA sola vez porque el
                // próximo desborde recién se detecta si el usuario sigue
                // escribiendo en la continuación), un pegado grande puede
                // desbordar varias páginas de una sola vez y hay que
                // resolverlas TODAS aquí (ver pasteTextAcrossPages en
                // useEditorStore.ts, que aplica el resultado en un solo
                // golpe atómico).
                const heightSafetyMargin = (textProps.fontSize * textProps.lineHeight) / 2;
                const chunks: { text: string; spans: TextStyleSpan[]; width: number; height: number }[] = [];
                let isFirst = true;
                const MAX_CHUNKS = 500; // salvaguarda -- un pegado patológicamente largo no debe crear páginas sin fin

                while (chunks.length < MAX_CHUNKS - 1) {
                  const anchorY = isFirst ? element.y : CONTENT_TOP;
                  const pageAvailableHeight = CONTENT_BOTTOM - anchorY - heightSafetyMargin;
                  const realHeight = getAutoSizedTextBox(
                    remainingText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                    textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, PAGE_HEIGHT - anchorY - 8, false,
                    remainingSpans, textBaseStyle,
                  ).height;
                  if (realHeight <= pageAvailableHeight) break; // el resto entero cabe -- se cierra fuera del loop
                  const split = splitTextForHeight(
                    remainingText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                    textProps.lineHeight, fullColumnWidth, pageAvailableHeight,
                    remainingSpans, textBaseStyle,
                  );
                  if (!split) break;
                  const fittingSpans = reindexSpans(remainingSpans, 0, split.fittingEnd);
                  const fittingSize = getAutoSizedTextBox(
                    split.fittingText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                    textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, pageAvailableHeight, true,
                    fittingSpans, textBaseStyle,
                  );
                  chunks.push({ text: split.fittingText, spans: fittingSpans, width: fittingSize.width, height: fittingSize.height });
                  remainingSpans = reindexSpans(remainingSpans, split.overflowStart, remainingText.length);
                  remainingText = split.overflowText;
                  isFirst = false;
                }

                if (chunks.length === 0) {
                  // Nunca desbordó -- el pegado entra completo en el bloque
                  // actual, la edición sigue aquí mismo (igual que el cierre
                  // final de handleLiveTyping cuando split=null).
                  const autoSize = getAutoSizeForPatch({ text: remainingText, spans: remainingSpans });
                  setLiveEdit({ id: element.id, text: remainingText, width: fullColumnWidth, height: autoSize.height, spans: remainingSpans });
                  if (liveEditCommitTimerRef.current) clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = setTimeout(() => {
                    liveEditCommitTimerRef.current = null;
                    const state = useEditorStore.getState();
                    const livePage = state.doc.pages.find((p) => p.page_number === page.page_number);
                    const liveElement = livePage?.elements.find((e) => e.id === element.id);
                    if (!liveElement) return;
                    const finalAutoSize = getAutoSizeForPatch({ text: remainingText, spans: remainingSpans });
                    const sizeUnchanged = finalAutoSize.width === liveElement.width && finalAutoSize.height === liveElement.height;
                    updateElement(page.page_number, element.id, {
                      props: { ...(liveElement.props || {}), text: remainingText, spans: remainingSpans },
                      ...(sizeUnchanged ? {} : { width: finalAutoSize.width, height: finalAutoSize.height }),
                    });
                  }, 600);
                  return;
                }

                // Último trozo: mide con la misma línea de cortesía que
                // closeAndProcess deja a cualquier bloque cerrado.
                const lastAnchorY = isFirst ? element.y : CONTENT_TOP;
                const lastMaxHeight = CONTENT_BOTTOM - lastAnchorY - heightSafetyMargin;
                const lastSize = getAutoSizedTextBox(
                  remainingText, textProps.fontSize, textProps.fontFamily, textProps.bold, textProps.italic,
                  textProps.lineHeight, fullColumnWidth, 28, fullColumnWidth, lastMaxHeight, true,
                  remainingSpans, textBaseStyle,
                );
                chunks.push({ text: remainingText, spans: remainingSpans, width: lastSize.width, height: lastSize.height });

                if (liveEditCommitTimerRef.current) {
                  clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = null;
                }
                textSplitInProgressRef.current = true;
                pasteTextAcrossPages({ pageNumber: page.page_number, elementId: element.id, chunks });
                setLiveEdit(null);
                setOpenTextEditorId(null);
              };

              const closeAndProcess = () => {
                setSlashRefMenu(null);
                // Por si el editor se cierra a mitad de una composición IME
                // (blur sin compositionend) — que no quede la guardia pegada.
                isComposingRef.current = false;
                if (liveEditCommitTimerRef.current) {
                  clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = null;
                }
                // El bloque se acaba de partir hacia la página siguiente
                // (ver handleLiveTyping) y el foco se movió ahí — este blur
                // es efecto colateral de ese traslado, no un cierre real del
                // usuario. El store YA tiene el texto correcto (partido);
                // confirmar aquí pisaría ese split con el texto COMPLETO
                // (sin partir) que todavía vive en `liveEdit`/`textProps` de
                // este render.
                if (textSplitInProgressRef.current) {
                  textSplitInProgressRef.current = false;
                  activeTextareaRef.current = null;
                  setOpenTextEditorId(null);
                  return;
                }
                // El texto vigente es el del estado local (lo último
                // tecleado), no `mergedProps.text` — ese pudo quedar
                // desactualizado si aún no se disparaba la confirmación
                // diferida de handleLiveTyping.
                const finalText = liveEdit?.id === element.id ? liveEdit.text : textProps.text;
                const finalSpans = liveEdit?.id === element.id ? liveEdit.spans : textProps.spans;
                // Si el usuario abrió el editor (doble clic) y cerró sin
                // escribir NADA, no confirmar nada al store — ver bug real
                // reportado: closeAndProcess recalcula el alto con el
                // criterio de "editor abierto" (más holgado, sin tope en el
                // margen de contenido), así que un bloque recién partido
                // que quedó justo en ese límite volvía a medir de más al
                // reabrirlo y cerrarlo sin cambios, y eso disparaba de
                // nuevo el reflow que mueve el bloque ENTERO a la página
                // siguiente — un simple "doble clic y clic afuera" lo
                // teletransportaba sin que el usuario tocara nada.
                if (finalText === textProps.text) {
                  activeTextareaRef.current = null;
                  stopDictation();
                  setOpenTextEditorId(null);
                  selectElement(undefined);
                  return;
                }
                const autoSize = getAutoSizeForPatch({ text: finalText });
                updateElement(page.page_number, element.id, {
                  width: fullColumnWidth,
                  height: autoSize.height,
                  props: {
                    ...mergedProps,
                    text: finalText,
                    spans: finalSpans,
                  },
                });
                activeTextareaRef.current = null;
                stopDictation();
                setOpenTextEditorId(null);
                selectElement(undefined);
              };

              // Formato por selección (negrita/cursiva/subrayado/color/
              // tamaño/fuente aplicados SOLO al rango que el usuario marcó
              // con el mouse/teclado dentro del textarea) — pedido explícito:
              // "necesito que lo que seleccione con el cursor del mouse se
              // pueda cambiar sin afectar al resto del texto". Requiere una
              // selección real (start !== end), igual que Word: con el
              // cursor colapsado no hay nada que "solo esa porción" cambiar.
              // Captura el rango seleccionado en el textarea. Necesario para
              // el picker de color: abrir su popover y elegir un swatch son
              // varios clics que, pese al preventDefault, podían colapsar la
              // selección — se "congela" el rango al abrir el picker y se usa
              // ese al aplicar. Para negrita/cursiva basta el rango vivo.
              const captureSelection = () => {
                const ta = activeTextareaRef.current;
                if (!ta) return;
                selectionRangeRef.current = { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
              };

              // Devuelve `true` si había una selección real y se aplicó el
              // formato; `false` si no (cursor colapsado) — usado tanto por
              // la barra flotante propia como por el puente con el ribbon
              // (activeTextFormatBridge.ts): si no hay selección, el ribbon
              // cae a su comportamiento histórico de "todo el bloque".
              const applyFormatToSelection = (patch: Partial<BaseTextStyle>, options?: { toggle?: boolean }): boolean => {
                const ta = activeTextareaRef.current;
                if (!ta) return false;
                // Preferir el rango congelado (picker de color); si no hay,
                // el rango vivo del textarea (botones directos).
                const captured = selectionRangeRef.current;
                const start = captured ? captured.start : (ta.selectionStart ?? 0);
                const end = captured ? captured.end : (ta.selectionEnd ?? 0);
                selectionRangeRef.current = null;
                if (start === end) {
                  const styleAtCursor = {
                    ...getEffectiveStyleAt(liveSpans, textBaseStyle, Math.max(0, start - 1)),
                    ...(pendingTypingStyle?.elementId === element.id ? pendingTypingStyle.style : {}),
                  };
                  const nextPatch = { ...patch } as Partial<BaseTextStyle>;
                  if (options?.toggle) {
                    (Object.keys(nextPatch) as Array<keyof BaseTextStyle>).forEach((key) => {
                      if (typeof styleAtCursor[key] === 'boolean') {
                        (nextPatch as any)[key] = !styleAtCursor[key];
                      }
                    });
                  }
                  setPendingTypingStyle((current) => ({
                    elementId: element.id,
                    style: { ...(current?.elementId === element.id ? current.style : {}), ...nextPatch },
                  }));
                  requestAnimationFrame(() => ta.focus());
                  return true;
                }
                const nextSpans = applyStyleToRange(liveText, liveSpans, textBaseStyle, start, end, patch, options);
                setLiveEdit({ id: element.id, text: liveText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: liveText, spans: nextSpans },
                });
                // El clic en el botón de formato le quita el foco al
                // textarea — se lo devolvemos y restauramos la selección
                // para que el usuario pueda seguir aplicando formatos
                // encadenados (p.ej. negrita y luego color) sin tener que
                // volver a seleccionar el texto cada vez.
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(start, end);
                });
                return true;
              };

              // Alinea el/los PÁRRAFO(S) que toca la selección actual (o el
              // que contiene el cursor, si está colapsado) -- nunca todo el
              // bloque. Pedido explícito 2026-09-11: "solo quiero que lo
              // aplique al texto seleccionado" (los botones de alineación de
              // la barra contextual aplicaban a TODO el bloque vía
              // `updateElement(..., { textAlign })` directo sobre las props
              // del elemento). A diferencia de `applyFormatToSelection`
              // arriba, SIEMPRE expande el rango a los límites de párrafo
              // primero (ver `expandRangeToParagraphs`, lib/textSpans.ts) --
              // la alineación nunca tiene sentido a mitad de línea, igual
              // que en Word -- y se aplica de inmediato aunque el cursor
              // esté colapsado (sin la espera de "próxima escritura" que sí
              // tiene sentido para negrita/cursiva vía `pendingTypingStyle`):
              // el párrafo donde está el cursor ya existe, no hay nada que
              // esperar a que se escriba.
              const applyAlignToSelection = (align: string) => {
                const ta = activeTextareaRef.current;
                if (!ta) return;
                const captured = selectionRangeRef.current;
                const start = captured ? captured.start : (ta.selectionStart ?? 0);
                const end = captured ? captured.end : (ta.selectionEnd ?? 0);
                selectionRangeRef.current = null;
                const [paraStart, paraEnd] = expandRangeToParagraphs(liveText, start, end);
                const nextSpans = applyStyleToRange(
                  liveText, liveSpans, textBaseStyle, paraStart, paraEnd, { textAlign: align }, { toggle: false },
                );
                setLiveEdit({ id: element.id, text: liveText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: liveText, spans: nextSpans },
                });
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(start, end);
                });
              };

              // Registrar esta función como el handler activo del puente
              // ribbon↔selección MIENTRAS este bloque está en edición — el
              // ribbon (App.tsx) intenta primero este camino; si no hay
              // selección real, cae a aplicar sobre todo el bloque (código
              // ya existente en App.tsx, sin cambios).
              if (isEditorOpen) {
                activeFormatBridgeRef.current = applyFormatToSelection;
              }

              // "Copiar formato" (pincel, como Word) — se llama al TERMINAR
              // de seleccionar (mouseup/keyup), nunca durante el arrastre:
              // solo entonces se sabe cuál es la selección FINAL. Si el
              // "modo pintar" está armado (copiedTextFormat !== null) y hay
              // una selección real (no un simple clic con el cursor
              // colapsado), aplica el estilo copiado ahí mismo y desarma el
              // modo — "una vez deje de seleccionar se aplica y se acaba la
              // función", pedido explícito. Si solo fue un clic sin
              // arrastrar nada, no consume el modo (el usuario puede seguir
              // buscando dónde pegar el formato, igual que en Word).
              const maybeApplyFormatPainter = () => {
                if (!copiedTextFormat) return;
                const ta = activeTextareaRef.current;
                if (!ta) return;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return;
                // { toggle: false } es OBLIGATORIO aquí: por defecto,
                // applyFormatToSelection/applyStyleToRange interpreta
                // bold/italic/underline como un TOGGLE (activa/desactiva
                // según lo que ya tenga la selección DESTINO, ignorando el
                // valor recibido) — pensado para el botón directo de la
                // barra ("clic en Negrita = alternar"). El pincel de
                // formato necesita lo contrario: fijar el valor EXACTO
                // copiado, sin importar el estado previo del destino.
                applyFormatToSelection(copiedTextFormat, { toggle: false });
                setCopiedTextFormat(null);
              };

              // Fuente de la selección actual, para el cuadro indicador junto
              // al selector de fuente: recorre cada carácter del rango
              // marcado y compara su estilo efectivo (span que lo cubre, o el
              // base del bloque — ver getEffectiveStyleAt). Si todos los
              // caracteres comparten la misma fuente, se muestra su nombre;
              // si hay dos o más fuentes distintas en la selección, se
              // devuelve '' (el cuadro queda en blanco, pero el selector de
              // al lado sigue permitiendo aplicar una fuente nueva a toda la
              // selección, igual que en Word). selectionTick fuerza que esto
              // se recalcule cuando la selección cambia solo con el mouse
              // (evento que no toca ningún estado de React por sí solo).
              const getSelectionFontFamily = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return '';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return '';
                let common: string | null = null;
                for (let offset = start; offset < end; offset += 1) {
                  const effective = getEffectiveStyleAt(liveSpans, textBaseStyle, offset);
                  if (common === null) {
                    common = effective.fontFamily;
                  } else if (common !== effective.fontFamily) {
                    return '';
                  }
                }
                return common ?? '';
              };
              const selectionFontFamily = isEditorOpen ? getSelectionFontFamily() : '';
              const handleSelectionMaybeChanged = () => setSelectionTick((tick) => tick + 1);

              // Tamaño de fuente ACTUAL de la selección (no el del bloque):
              // los botones A-/A+ deben partir de lo que YA tiene lo
              // seleccionado (si ya se achicó una vez, el siguiente clic
              // sigue achicando esa porción) en vez de siempre recalcular
              // desde textProps.fontSize (el tamaño base del bloque) — con
              // eso, clics repetidos sobre una selección que ya tenía un
              // tamaño propio no hacían nada (siempre volvían a
              // "base - 2"). Ante una selección con tamaños mezclados se usa
              // el del primer carácter, igual que el resto de los toggles.
              const getSelectionFontSize = (): number => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return textProps.fontSize;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return textProps.fontSize;
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).fontSize;
              };
              const toolbarFontSize = pendingTypingStyle?.elementId === element.id && pendingTypingStyle.style.fontSize
                ? pendingTypingStyle.style.fontSize
                : getSelectionFontSize();

              // Color de TEXTO actual de la selección — el swatch de la
              // paleta de color mostraba siempre textProps.fontColor (el
              // del BLOQUE), nunca el de lo realmente seleccionado. Con
              // cursor colapsado (nada marcado) se sigue mostrando el color
              // del bloque, como "color ambiente" de referencia.
              const getSelectionColor = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return textProps.fontColor;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return textProps.fontColor;
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).color;
              };

              // Color de RESALTADO (fondo detrás del texto, tipo marcador)
              // de la selección actual — 'transparent' si no hay ninguno
              // aplicado o si no hay selección real.
              const getSelectionHighlightColor = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return 'transparent';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return 'transparent';
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).highlightColor || 'transparent';
              };

              // Estilo de encabezado ('title'|'h1'..'h6') de la selección,
              // solo si TODO el rango marcado comparte el mismo — igual
              // criterio que getSelectionFontFamily. '' = sin selección,
              // selección sin encabezado, o encabezados mezclados (el
              // <select> simplemente queda en "Normal").
              const getSelectionHeadingStyle = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return '';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return '';
                let common: string | null = null;
                for (let offset = start; offset < end; offset += 1) {
                  const effective = getEffectiveStyleAt(liveSpans, textBaseStyle, offset).headingStyle || '';
                  if (common === null) {
                    common = effective;
                  } else if (common !== effective) {
                    return '';
                  }
                }
                return common ?? '';
              };

              // Aplica un estilo de encabezado a la selección: además de
              // marcarla para la Tabla de Contenidos (headingStyle, ver
              // TableOfContents.tsx), replica las propiedades de CARÁCTER
              // del estilo (fuente/tamaño/negrita/cursiva/subrayado/color) —
              // NO alineación ni interlineado, esas son de párrafo y no
              // tienen sentido para una porción de texto suelta dentro de
              // un bloque. '' (Normal) limpia el encabezado y vuelve al
              // estilo de cuerpo normal, igual que "Normal" en el ribbon.
              const applyHeadingStyleToSelection = (headingId: string) => {
                const preset = findHeadingStyle(headingId || 'normal') ?? findHeadingStyle('normal')!;
                // toggle:false — bold/italic/underline aquí son valores
                // LITERALES del preset (p.ej. h2 exige italic:false), no
                // un alternar tipo botón; ver comentario en applyStyleToRange.
                applyFormatToSelection({
                  headingStyle: headingId || '',
                  fontFamily: preset.fontFamily,
                  fontSize: preset.fontSize,
                  bold: preset.fontWeight >= 600,
                  italic: preset.italic,
                  underline: preset.underline,
                  color: preset.color,
                }, { toggle: false });
              };

              // "Cambiar MAYÚSCULAS/minúsculas" al estilo Word (Mayús+F3):
              // cicla entre MAYÚSCULAS → minúsculas → Cada Palabra En
              // Mayúscula → MAYÚSCULAS... el siguiente estado se decide por
              // el contenido ACTUAL de la selección (no hay que recordar en
              // qué paso del ciclo iba). A diferencia del resto de los
              // controles de esta barra, esto muta el TEXTO en sí, no un
              // atributo de estilo — se re-mapean los spans igual que en
              // dictado/corrección (remapSpansForTextChange) para que el
              // formato ya aplicado no se pierda ni se desplace.
              const applyCaseToSelection = (): boolean => {
                const ta = activeTextareaRef.current;
                if (!ta) return false;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start === end) return false;
                const original = liveText.slice(start, end);
                const isUpper = original === original.toUpperCase() && original !== original.toLowerCase();
                const isLower = original === original.toLowerCase() && original !== original.toUpperCase();
                let transformed: string;
                if (isUpper) {
                  transformed = original.toLowerCase();
                } else if (isLower) {
                  transformed = original.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
                } else {
                  transformed = original.toUpperCase();
                }
                const nextText = liveText.slice(0, start) + transformed + liveText.slice(end);
                const nextSpans = remapSpansForTextChange(liveText, nextText, liveSpans);
                setLiveEdit({ id: element.id, text: nextText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: nextText, spans: nextSpans },
                });
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(start, start + transformed.length);
                });
                return true;
              };

              // Puente ribbon↔selección para el botón "Aa" (ver
              // lib/activeTextFormatBridge.ts, tryApplyCaseToActiveTextSelection)
              // — mismo criterio que activeFormatBridgeRef para negrita/color/
              // tamaño: mientras el editor de ESTE bloque está abierto, el
              // ribbon fijo intenta primero aplicar el ciclo de mayúsculas a
              // la selección; si no hay selección real, cae a "todo el
              // bloque" (App.tsx).
              if (isEditorOpen) {
                activeCaseBridgeRef.current = applyCaseToSelection;
              }

              // Inserta una referencia cruzada (ADR-019) en el cursor —a
              // diferencia de negrita/mayúsculas, NO exige una selección con
              // texto: con el cursor colapsado simplemente inserta el
              // placeholder ahí (mismo criterio que "insertar campo" en
              // Word). Si hay texto seleccionado, lo reemplaza (igual que
              // tipear encima de una selección). El placeholder ('#') nunca
              // se edita a mano: solo existe para que el span `.ref` tenga
              // un rango real donde anclarse; lo que se VE se sustituye en
              // cada render por el número resuelto (ver
              // textSpans.ts::buildStyledSegments, resolveTextRef arriba).
              const applyRefInsertToSelection = (targetId: string): boolean => {
                const ta = activeTextareaRef.current;
                if (!ta) return false;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                const placeholder = '#';
                const nextText = liveText.slice(0, start) + placeholder + liveText.slice(end);
                const remapped = remapSpansForTextChange(liveText, nextText, liveSpans);
                const refSpan: TextStyleSpan = { start, end: start + placeholder.length, ref: { targetId } };
                const nextSpans = [...remapped, refSpan].sort((a, b) => a.start - b.start);
                setLiveEdit({ id: element.id, text: nextText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: nextText, spans: nextSpans },
                });
                const caretAfter = start + placeholder.length;
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(caretAfter, caretAfter);
                });
                return true;
              };

              if (isEditorOpen) {
                activeRefInsertBridgeRef.current = applyRefInsertToSelection;
              }

              // Comando "/referencia" (pedido explícito 2026-09-04): a
              // diferencia de applyRefInsertToSelection (que inserta un
              // placeholder de 1 carácter en el cursor/selección), esto
              // REEMPLAZA un rango ya conocido -- el "/referencia" recién
              // tecleado -- por el rótulo corto elegido en el picker
              // (slashRefMenu, ver el <textarea> más abajo), en negrita y
              // azul oscuro para que se note que es un enlace, igual que
              // pidió el usuario. El texto guardado (`label`) es solo el
              // placeholder estable de esta referencia -- lo que se MUESTRA
              // se resuelve en cada render vía resolveTextRef/
              // resolveAnnexRefLabel, así que renumerar anexos lo actualiza
              // solo.
              const applyAnnexRefInsert = (targetId: string, label: string, start: number, end: number) => {
                const ta = activeTextareaRef.current;
                const nextText = liveText.slice(0, start) + label + liveText.slice(end);
                const remapped = remapSpansForTextChange(liveText, nextText, liveSpans);
                const refSpan: TextStyleSpan = {
                  start, end: start + label.length, ref: { targetId }, bold: true, color: '#1e3a8a',
                };
                const nextSpans = [...remapped, refSpan].sort((a, b) => a.start - b.start);
                setLiveEdit({ id: element.id, text: nextText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: nextText, spans: nextSpans },
                });
                const caretAfter = start + label.length;
                requestAnimationFrame(() => {
                  ta?.focus();
                  ta?.setSelectionRange(caretAfter, caretAfter);
                });
              };

              const selectionFontColor = isEditorOpen ? getSelectionColor() : textProps.fontColor;
              const selectionHighlightColor = isEditorOpen ? getSelectionHighlightColor() : 'transparent';
              const selectionHeadingStyle = isEditorOpen ? getSelectionHeadingStyle() : '';
              const activeTextarea = activeTextareaRef.current;
              const selectionStart = activeTextarea?.selectionStart ?? 0;
              const selectionEnd = activeTextarea?.selectionEnd ?? 0;
              const hasTextSelection = isEditorOpen && selectionStart < selectionEnd;
              const cursorStyle = getEffectiveStyleAt(liveSpans, textBaseStyle, Math.max(0, selectionStart - 1));
              const pendingStyle = pendingTypingStyle?.elementId === element.id ? pendingTypingStyle.style : {};
              // Estado que se PINTA en la barra: la selección real tiene
              // prioridad; con el cursor colapsado se muestra el formato que
              // recibirá el siguiente carácter escrito.
              const toolbarStyle = hasTextSelection
                ? getEffectiveStyleAt(liveSpans, textBaseStyle, selectionStart)
                : { ...cursorStyle, ...pendingStyle };
              const toolbarFontColor = hasTextSelection ? selectionFontColor : toolbarStyle.color;
              const toolbarHighlightColor = hasTextSelection ? selectionHighlightColor : (toolbarStyle.highlightColor || 'transparent');
              const toolbarHeadingStyle = hasTextSelection ? selectionHeadingStyle : (toolbarStyle.headingStyle || '');
              const toolbarFontFamily = hasTextSelection ? selectionFontFamily : toolbarStyle.fontFamily;

              // Rango [start,end) de la selección REAL viva del textarea, o
              // null si no hay nada marcado. Bug real reportado: al agrandar
              // el tamaño de un rango seleccionado con A+/A-, el área de
              // selección "se perdía" — no encogía ni crecía junto con el
              // texto. Causa real: el <textarea> invisible (que es quien
              // dueño de la selección NATIVA del navegador, el rectángulo
              // azul/celeste que el usuario ve) SIEMPRE usa un único
              // fontSize uniforme (el del bloque, textProps.fontSize) para
              // TODO su contenido — un textarea no puede tener tamaños de
              // fuente mixtos por carácter. El overlay "fantasma" de abajo
              // SÍ pinta cada span a su propio tamaño real (por eso
              // highlightColor por ejemplo SÍ escala bien, ver
              // getSelectionHighlightColor). Cuando la selección tiene un
              // tamaño de fuente distinto al del bloque, el textarea sigue
              // ajustando líneas (wrap) según el tamaño PEQUEÑO/uniforme
              // mientras el overlay ajusta líneas según el tamaño real
              // (grande) de ese span — los dos layouts divergen y el
              // rectángulo de selección nativo del navegador queda
              // desalineado/diminuto respecto al texto grande que se ve.
              // Fix: no depender de la selección nativa del navegador para
              // la señal visual — pintar un indicador de selección PROPIO
              // dentro del mismo overlay que ya calcula el tamaño real por
              // span (ver el render del "ghost overlay" más abajo), así
              // hereda automáticamente el tamaño correcto. La selección
              // nativa se oculta vía CSS (.text-editor-area-seamless::selection
              // { background: transparent }, ver styles.css).
              const getLiveSelectionRange = (): [number, number] | null => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return null;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start === end) return null;
                return [Math.min(start, end), Math.max(start, end)];
              };

              const startDictation = async (): Promise<boolean> => {
                const speechCtor = getSpeechCtor();
                if (!speechCtor) {
                  setSpeechError('Tu navegador no soporta dictado por voz.');
                  return false;
                }

                const runningOnLocalhost =
                  typeof window !== 'undefined' &&
                  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                const secureContext = typeof window !== 'undefined' ? window.isSecureContext : false;

                if (!secureContext && !runningOnLocalhost) {
                  setSpeechError('El dictado por voz requiere HTTPS o localhost.');
                  return false;
                }

                if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
                  try {
                    const permission = await (navigator as any).permissions.query({ name: 'microphone' });
                    if (permission.state === 'denied') {
                      setSpeechError('Micrófono bloqueado. Habilita permisos de audio para usar escritura por voz.');
                      return false;
                    }
                  } catch {}
                }

                stopDictation();
                setSpeechError(null);

                const recognition = new speechCtor();
                const baseText = liveText;
                const separator = baseText.trim().length > 0 ? '\n' : '';
                let accumulatedFinal = '';
                const minAcceptedConfidence = 0.46;

                recognition.lang = 'es-PE';
                recognition.continuous = true;
                // Antes en `false`: el motor de voz solo entregaba un
                // resultado tras detectar una PAUSA en el habla (silencio),
                // así que no aparecía NADA en pantalla durante varios
                // segundos mientras el usuario seguía hablando — de ahí la
                // diferencia de velocidad reportada frente al panel
                // VoiceDictation (interimResults: true desde el inicio, ver
                // VoiceDictation.tsx). Con `true`, el navegador emite
                // resultados parciales en cuasi tiempo real; se muestran de
                // inmediato como vista previa local (interimDictation, ver
                // más abajo) SIN commitear al store en cada uno — solo la
                // frase FINAL se confirma vía updateTextProps.
                recognition.interimResults = true;
                recognition.maxAlternatives = 3;

                recognition.onresult = (e: any) => {
                  let discardedLowConfidence = false;
                  let latestInterim = '';
                  for (let index = e.resultIndex; index < e.results.length; index += 1) {
                    const result = e.results[index];
                    if (!result?.isFinal) {
                      const interimAlternative = pickBestTranscriptAlternative(result);
                      if (interimAlternative.transcript) {
                        latestInterim = `${latestInterim}${latestInterim ? ' ' : ''}${interimAlternative.transcript}`;
                      }
                      continue;
                    }

                    const bestAlternative = pickBestTranscriptAlternative(result);
                    if (!bestAlternative.transcript) {
                      continue;
                    }

                    const normalizedTranscript = normalizeDictationText(bestAlternative.transcript);

                    if (isLikelyLowQualityTranscript(normalizedTranscript)) {
                      continue;
                    }

                    if (bestAlternative.confidence > 0 && bestAlternative.confidence < minAcceptedConfidence) {
                      discardedLowConfidence = true;
                      continue;
                    }

                    accumulatedFinal += `${normalizedTranscript} `;
                  }

                  setInterimDictation(latestInterim);

                  const spokenText = accumulatedFinal.trim();
                  if (spokenText) {
                    const nextText = `${baseText}${separator}${spokenText}`;
                    updateTextProps({ text: nextText });
                  }

                  if (discardedLowConfidence) {
                    setSpeechError('Se filtró audio con baja confianza para reducir errores de transcripción.');
                  } else {
                    setSpeechError(null);
                  }
                };

                recognition.onerror = (event: any) => {
                  const reason = String(event?.error || 'unknown');
                  if (reason === 'not-allowed' || reason === 'service-not-allowed') {
                    setSpeechError('Permiso denegado para micrófono. Debes habilitarlo en el navegador.');
                  } else if (reason === 'no-speech') {
                    setSpeechError('No se detectó voz. Intenta nuevamente hablando más cerca del micrófono.');
                  } else if (reason === 'audio-capture') {
                    setSpeechError('No se detecta micrófono disponible en el equipo.');
                  } else {
                    setSpeechError('No se pudo capturar audio. Revisa permisos de micrófono.');
                  }
                  setIsDictating(false);
                  setInterimDictation('');
                };

                recognition.onend = () => {
                  recognitionRef.current = null;
                  dictationTargetRef.current = null;
                  setIsDictating(false);
                  setInterimDictation('');
                };

                recognitionRef.current = recognition;
                dictationTargetRef.current = element.id;
                setIsDictating(true);
                try {
                  recognition.start();
                  return true;
                } catch {
                  setIsDictating(false);
                  setSpeechError('No se pudo iniciar dictado. Intenta otra vez.');
                  return false;
                }
              };

              const toggleDictation = async (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();

                if (isCurrentDictationTarget) {
                  stopDictation();
                  setSpeechError(null);
                  return;
                }

                if (isDictating && dictationTargetRef.current !== element.id) {
                  stopDictation();
                }

                await startDictation();
              };

              const runQuickCorrection = async () => {
                const payload = textForSpellOrRewrite(liveText);
                if (!payload) {
                  setCorrectionInfo('Escribe o pega el texto a corregir (no uses solo el texto de ayuda vacío).');
                  setTimeout(() => setCorrectionInfo(null), 4000);
                  return;
                }
                setCorrectionInfo('Servidor: corrección rápida…');
                try {
                  const data = await measurePerfAsync('ia_correction', () => textCorrectQuick(payload));
                  if (data?.error) {
                    if (data.error === 'empty_text') {
                      setCorrectionInfo('No hay texto válido para corregir.');
                    } else {
                      setCorrectionInfo(typeof data.error === 'string' ? data.error : 'Error en servidor.');
                    }
                    setTimeout(() => setCorrectionInfo(null), 4000);
                    return;
                  }
                  const correctedText = String(data?.text ?? payload);
                  updateTextProps({ text: correctedText });
                  if (correctedText !== payload) {
                    setCorrectionInfo('Se aplicaron correcciones rápidas (backend).');
                  } else {
                    setCorrectionInfo('No se detectaron correcciones rápidas pendientes.');
                  }
                } catch (e: any) {
                  const msg = e?.response?.data?.error || e?.message || '';
                  setCorrectionInfo(msg ? `Error: ${msg}` : 'No se pudo contactar al servidor.');
                } finally {
                  setTimeout(() => setCorrectionInfo(null), 4000);
                }
              };

              const runAdvancedCorrection = async () => {
                const sourceText = textForSpellOrRewrite(liveText);
                if (!sourceText) {
                  setAdvancedSuggestions([]);
                  setCorrectionInfo('No hay texto para analizar (escribe contenido real, no solo la ayuda).');
                  return;
                }

                setIsAnalyzingSpelling(true);
                setCorrectionInfo('Servidor: análisis ortográfico y gramatical…');

                try {
                  const data = await measurePerfAsync('ia_correction', () => textCorrectAdvanced(sourceText, {
                    language: 'es-PE',
                    level: 'picky',
                  }));
                  if (data?.error) {
                    setAdvancedSuggestions([]);
                    setCorrectionInfo(
                      data.error === 'languagetool_unavailable'
                        ? 'LanguageTool no disponible en el servidor.'
                        : data.error === 'empty_text'
                          ? 'No hay texto válido para analizar.'
                          : String(data.error),
                    );
                    return;
                  }
                  const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
                  const suggestions: AdvancedSuggestion[] = raw
                    .map((row: any) => ({
                      offset: Number(row?.offset ?? 0),
                      length: Number(row?.length ?? 0),
                      message: String(row?.message ?? 'Posible corrección'),
                      replacements: Array.isArray(row?.replacements)
                        ? row.replacements.map((r: unknown) => String(r ?? '').trim()).filter(Boolean).slice(0, 5)
                        : [],
                      context: String(row?.context ?? ''),
                    }))
                    .filter((item: AdvancedSuggestion) => item.length > 0);

                  setAdvancedSuggestions(suggestions);
                  if (suggestions.length > 0) {
                    setCorrectionInfo(`Se detectaron ${suggestions.length} sugerencias (backend).`);
                  } else {
                    setCorrectionInfo('No se detectaron errores ortográficos/gramaticales relevantes.');
                  }
                } catch (e: any) {
                  setAdvancedSuggestions([]);
                  const msg = e?.response?.data?.error || e?.message || '';
                  setCorrectionInfo(msg ? `Corrector avanzado: ${msg}` : 'No se pudo ejecutar el corrector avanzado.');
                } finally {
                  setIsAnalyzingSpelling(false);
                }
              };

              const applyAdvancedSuggestion = (suggestion: AdvancedSuggestion, replacement: string) => {
                const currentText = String(liveText || '');
                if (!replacement.trim()) {
                  return;
                }

                const before = currentText.slice(0, suggestion.offset);
                const after = currentText.slice(suggestion.offset + suggestion.length);
                const nextText = `${before}${replacement}${after}`;
                updateTextProps({ text: nextText });

                setAdvancedSuggestions((prev) => prev.filter((item) => item !== suggestion));
                setCorrectionInfo('Se aplicó una sugerencia ortográfica.');
              };

              /** Reemplazo desde el menú del subrayado rojo en vivo (clic sobre
               * la palabra marcada) — mismo mecanismo que applyAdvancedSuggestion
               * pero para inlineSpellIssues, y reposiciona el cursor justo
               * después del reemplazo en vez de dejarlo donde cayó el clic. */
              const applySpellSuggestion = (issue: AdvancedSuggestion, replacement: string) => {
                const currentText = String(liveText || '');
                if (!replacement.trim()) return;

                const before = currentText.slice(0, issue.offset);
                const after = currentText.slice(issue.offset + issue.length);
                const nextText = `${before}${replacement}${after}`;
                updateTextProps({ text: nextText });

                setInlineSpellIssues((prev) => prev.filter((item) => item !== issue));
                setSpellMenu(null);

                const caretPos = issue.offset + replacement.length;
                requestAnimationFrame(() => {
                  activeTextareaRef.current?.focus({ preventScroll: true });
                  activeTextareaRef.current?.setSelectionRange(caretPos, caretPos);
                });
              };

              const dismissSpellIssue = (issue: AdvancedSuggestion) => {
                setInlineSpellIssues((prev) => prev.filter((item) => item !== issue));
                setSpellMenu(null);
              };

              const handleTextShortcuts = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                const withModifier = event.ctrlKey || event.metaKey;
                if (!withModifier) {
                  return;
                }

                const key = event.key.toLowerCase();

                if (key === 'b') {
                  event.preventDefault();
                  updateTextProps({ bold: !textProps.bold });
                  return;
                }

                if (key === 'i') {
                  event.preventDefault();
                  updateTextProps({ italic: !textProps.italic });
                  return;
                }

                if (key === 'u') {
                  event.preventDefault();
                  updateTextProps({ underline: !textProps.underline });
                  return;
                }

                if (event.shiftKey && key === '7') {
                  event.preventDefault();
                  updateTextProps({ listType: 'bullet', text: applyListToText(textProps.text, 'bullet') });
                  return;
                }

                if (event.shiftKey && key === '8') {
                  event.preventDefault();
                  updateTextProps({ listType: 'number', text: applyListToText(textProps.text, 'number') });
                  return;
                }

                if (event.shiftKey && key === '0') {
                  event.preventDefault();
                  updateTextProps({ listType: 'none', text: stripListMarkers(textProps.text) });
                }
              };

              // ADR-049 (revisado) — ajuste de texto alrededor de objetos,
              // réplica de las 7 opciones de "Opciones de diseño" de Word:
              //   square/tight/through → excluyen el rectángulo del objeto
              //     (izquierda/derecha), con margen decreciente (12/4/0px —
              //     sin polígono de silueta, 'through' se resuelve igual que
              //     'tight' para un rectángulo, pero se expone aparte por
              //     fidelidad con el menú de Word),
              //   topbottom → excluye la franja vertical completa,
              //   behind/infront/inline/none → no excluyen nada (el objeto
              //     flota libremente; behind/infront solo cambian el z-order
              //     via el div wrapper, ver filtro type==='image' más abajo).
              // Si no hay solapes, se usa el <Text> único de Konva de
              // siempre (más barato) en vez de partir el párrafo en líneas.
              const TEXT_PAD = 8;
              const WRAP_GAP_BY_MODE: Record<string, number> = { square: 12, tight: 4, through: 0, topbottom: 12 };
              const wrapExclusions: WrapExclusion[] = page.elements
                .filter((o) =>
                  o.id !== element.id &&
                  (o.wrapMode === 'square' || o.wrapMode === 'tight' || o.wrapMode === 'through' || o.wrapMode === 'topbottom') &&
                  o.x < element.x + element.width && o.x + o.width > element.x &&
                  o.y < element.y + element.height && o.y + o.height > element.y)
                .map((o) => {
                  const gap = WRAP_GAP_BY_MODE[o.wrapMode as string] ?? 12;
                  const exclusionMode = o.wrapMode === 'topbottom' ? 'topbottom' : 'square';
                  return {
                    x0: o.x - gap - (element.x + TEXT_PAD),
                    x1: o.x + o.width + gap - (element.x + TEXT_PAD),
                    yTop: o.y - gap - (element.y + TEXT_PAD),
                    yBot: o.y + o.height + gap - (element.y + TEXT_PAD),
                    mode: exclusionMode as 'square' | 'topbottom',
                  };
                });
              const wrappedLayout = !isEditorOpen && wrapExclusions.length > 0
                ? computeWrappedTextLines(
                    textProps.text,
                    textBaseStyle,
                    textProps.lineHeight,
                    Math.max(120, element.width - TEXT_PAD * 2 - paragraphLeft - paragraphRight),
                    wrapExclusions,
                    textProps.spans,
                  )
                : null;

              // Registrar dónde y cuánto necesita el recuadro para
              // envolver EXACTAMENTE el texto ya renderizado (ver
              // wrapAutoHeightRef arriba) — pedido explícito: al hacer
              // clic en el texto, el recuadro para moverlo/agrandarlo
              // tiene que estar AHÍ MISMO, como cualquier globo de texto
              // normal, no en un lugar random. Se calcula como la caja que
              // envuelve los renglones REALMENTE dibujados (de
              // wrappedLayout.segments), no una estimación aparte — si
              // todo el texto quedó DESPUÉS del salto (el caso típico:
              // nada de texto cabe antes del objeto), el recuadro entero
              // se reubica ahí, no se queda pegado arriba. Solo si hay
              // contenido real a AMBOS lados del salto el recuadro vuelve
              // a cruzar el hueco (ahí sí es geométricamente imposible
              // evitarlo con un solo rectángulo) — caso raro, aceptado.
              if (wrappedLayout && wrappedLayout.segments.length > 0) {
                const lineH = Math.max(textBaseStyle.fontSize, ...textProps.spans.map((s) => s.fontSize ?? textBaseStyle.fontSize)) * textProps.lineHeight;
                const segTops = wrappedLayout.segments.map((seg) => seg.y);
                const minSegY = Math.min(...segTops);
                const maxSegBottom = Math.max(...segTops) + lineH;
                wrapAutoHeightRef.current.set(element.id, {
                  y: element.y + minSegY,
                  height: (maxSegBottom - minSegY) + TEXT_PAD * 2,
                });
              } else {
                wrapAutoHeightRef.current.delete(element.id);
              }

                // 1. Definimos constantes de margen y dimensiones estimadas
                  const TOOLBAR_WIDTH = 274;  // Ancho promedio de la barra flotante
                  const TOOLBAR_HEIGHT = 46;  // Alto promedio de la barra
                  const GAP = 8;              // Separación con el elemento

                  // 2. Extraemos dimensiones del elemento
                  const elemWidth = element.width ?? (element as any).w ?? 100;
                  const elemHeight = element.height ?? (element as any).h ?? 100;

                  // 3. CÁLCULO EJE X (Evitar que se salga a la derecha)
                  let toolbarX = element.x;
                  const canvasWidth = PAGE_WIDTH ?? 794; // Ancho base de tu lienzo blanco

                  if (toolbarX + TOOLBAR_WIDTH > canvasWidth - GAP) {
                    // Ajustar para que no desborde el margen derecho del canvas
                    toolbarX = canvasWidth - TOOLBAR_WIDTH - GAP;
                  }
                  if (toolbarX < GAP) {
                    toolbarX = GAP;
                  }

                  // 4. CÁLCULO EJE Y (Arriba o Abajo según espacio)
                  let toolbarY = element.y - TOOLBAR_HEIGHT - GAP;

                  // Si se sale por la parte superior del lienzo (< GAP), mandarlo ABAJO de la caja
                  if (toolbarY < GAP) {
                    toolbarY = element.y + elemHeight + GAP;
                  }

              return [
                wrappedLayout
                  ? wrappedLayout.segments.map((seg, segIndex) => (
                      <Text
                        key={`${element.id}-render-seg-${segIndex}`}
                        x={element.x + TEXT_PAD + paragraphLeft + seg.x}
                        y={element.y + TEXT_PAD + paragraphBefore + seg.y}
                        rotation={element.rotation || 0}
                        text={seg.text}
                        fontFamily={seg.style.fontFamily}
                        fontSize={seg.style.fontSize}
                        fill={seg.style.color}
                        lineHeight={textProps.lineHeight}
                        fontStyle={`${seg.style.bold ? 'bold ' : ''}${seg.style.italic ? 'italic' : ''}`.trim() || 'normal'}
                        textDecoration={seg.style.underline ? 'underline' : ''}
                        wrap="none"
                        listening={false}
                        hitStrokeWidth={0}
                      />
                    ))
                  : (!isEditorOpen && (textProps.spans.length > 0 || textProps.specialIndent !== 'none')) ? (
                      // Formato por selección (spans): al menos un tramo del
                      // texto tiene un estilo distinto al del bloque — ya no
                      // se puede pintar con un solo <Text> de Konva
                      // (estilo uniforme). Se renderiza como HTML real
                      // (mismo mecanismo que tablas/imágenes/KPIs de este
                      // editor) para que negrita/color/tamaño/fuente por
                      // tramo se vean exactamente igual que en el overlay de
                      // edición — WYSIWYG entre "editando" y "estático".
                      <Html
                        key={`${element.id}-render-rich`}
                        groupProps={{ x: element.x + paragraphLeft, y: element.y + paragraphBefore, rotation: element.rotation || 0, listening: false }}
                        divProps={{ style: { pointerEvents: 'none' } }}
                      >
                        <div
                          style={{
                            width: paragraphWidth,
                            minHeight: paragraphHeight,
                            fontFamily: textProps.fontFamily,
                            fontSize: `${textProps.fontSize}px`,
                            color: textProps.fontColor,
                            lineHeight: effectiveLineHeight,
                            fontWeight: textProps.bold ? 700 : 400,
                            fontStyle: textProps.italic ? 'italic' : 'normal',
                            textDecoration: textProps.underline ? 'underline' : 'none',
                            wordWrap: 'break-word',
                            // Mismo ancho de sangría por TAB que el textarea de
                            // edición -- ver comentario junto a tabSize ahí.
                            tabSize: LIST_INDENT_TAB_SIZE,
                          }}
                        >
                          {/* Un <div> de bloque POR PÁRRAFO (no un solo div
                            con '\n' embebidos) -- necesario para que cada
                            párrafo pueda tener su PROPIA alineación (ver
                            `TextStyleSpan.textAlign`/`applyAlignToSelection`)
                            en vez de una sola para todo el bloque. */}
                          {buildParagraphGroups(textProps.text, textProps.spans, textBaseStyle, resolveTextRef).map((group, groupIndex) => (
                            <div
                              key={groupIndex}
                              style={{
                                textAlign: group.align as any,
                                // Línea justificada del PDF: cada línea es su
                                // propio párrafo (salto explícito), así que
                                // 'justify' solo no la estira -- hace falta
                                // también en la última (única) línea.
                                ...(isExactLayout && group.align === 'justify' ? { textAlignLast: 'justify' as const } : {}),
                                whiteSpace: 'pre-wrap',
                                textIndent: `${specialIndentOffset}px`,
                              }}
                            >
                              {group.segments.length === 0
                                ? <br />
                                : group.segments.map((seg, segIndex) => (
                                  seg.refTargetId ? (
                                    <span
                                      key={segIndex}
                                      style={{ ...(styleToCss(seg.style) as any), ...exactSpanCss, cursor: 'pointer', pointerEvents: 'auto' }}
                                      title="Ctrl + clic para ir a la imagen/tabla/gráfico referenciada"
                                      onClick={(event) => navigateToTocEntry(event, seg.refTargetId as string, 0)}
                                    >
                                      {seg.text}
                                    </span>
                                  ) : seg.href ? (
                                    // Mismo criterio de pointerEvents:'auto' que
                                    // refTargetId arriba -- el contenedor `<Html>`
                                    // tiene pointerEvents:'none' a propósito (no
                                    // interceptar clics del lienzo), solo este
                                    // elemento puntual lo reactiva.
                                    <a
                                      key={segIndex}
                                      href={seg.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ ...(styleToCss(seg.style) as any), ...exactSpanCss, pointerEvents: 'auto' }}
                                      title={seg.href}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {seg.text}
                                    </a>
                                  ) : (
                                    <span key={segIndex} style={{ ...(styleToCss(seg.style) as any), ...exactSpanCss }}>{seg.text}</span>
                                  )
                                ))}
                            </div>
                          ))}
                        </div>
                      </Html>
                    ) : (
                    <Text
                      key={`${element.id}-render`}
                      x={element.x + paragraphLeft}
                      y={element.y + paragraphBefore}
                      rotation={element.rotation || 0}
                      width={paragraphWidth}
                      height={paragraphHeight}
                      text={depthTabsToDisplaySpaces(textProps.text)}
                      fontFamily={textProps.fontFamily}
                      fontSize={textProps.fontSize}
                      fill={textProps.fontColor}
                      align={textProps.textAlign}
                      lineHeight={textProps.lineHeight}
                      fontStyle={`${textProps.bold ? 'bold ' : ''}${textProps.italic ? 'italic' : ''}`.trim() || 'normal'}
                      textDecoration={textProps.underline ? 'underline' : ''}
                      listening={false}
                      hitStrokeWidth={0}
                      visible={!isEditorOpen}
                    />
                    ),
                !isEditorOpen && isElementSelected ? (
                  <Html 
                    key={`${element.id}-floating-toolbar`} 
                    groupProps={{ x: toolbarX, y: toolbarY }}
                  >
                    <FloatingContextualToolbar
                      element={element}
                      onUpdate={(patch) => updateElement(page.page_number, element.id, patch)}
                      onRemove={() => removeElement(page.page_number, element.id)}
                      onOpenInspector={() => {
                        window.dispatchEvent(new CustomEvent('mining-studio-open-inspector'));
                      }}
                      onAction={(action) => {
                        if (action === 'edit' && element.type === 'text') {
                          setOpenTextEditorId(element.id);
                        }
                        if (action === 'replace' && element.type === 'image') {
                          onRequestImageReplace?.(page.page_number, element.id, 'file');
                        }
                        if (action === 'dictate' && element.type === 'text') {
                          setOpenTextEditorId(element.id);
                          if (isCurrentDictationTarget) {
                            stopDictation();
                            setSpeechError(null);
                          } else {
                            if (isDictating && dictationTargetRef.current !== element.id) {
                              stopDictation();
                            }
                            void startDictation();
                          }
                        }
                        if (action === 'spellcheck-quick' && element.type === 'text') {
                          setOpenTextEditorId(element.id);
                          void runQuickCorrection();
                        }
                        if (action === 'spellcheck-advanced' && element.type === 'text') {
                          setOpenTextEditorId(element.id);
                          void runAdvancedCorrection();
                        }
                      }}
                    />
                  </Html>
                ) : null,
                isEditorOpen ? (
                    <Html key={`${element.id}-text`} groupProps={{ x: element.x + paragraphLeft, y: element.y + paragraphBefore, rotation: element.rotation || 0 }}>
                      <div
                        className="text-editor-seamless-container"
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        style={{
                          position: 'relative', 
                          width: element.width ? `${Math.max(120, element.width - paragraphLeft - paragraphRight)}px` : 'auto', 
                        }}
                      >
                        {/* Formato por selección — negrita/cursiva/subrayado/
                           color/tamaño/fuente SOLO al texto que el usuario
                           tenga seleccionado en el textarea de abajo (ver
                           applyFormatToSelection). Requiere una selección
                           real; con el cursor colapsado no hace nada, igual
                           que en Word. */}
                        <div 
                          style={{
                            position: 'absolute',
                            bottom: '100%',       // La empuja hacia arriba del todo
                            left: 0,
                            marginBottom: '10px', // Espacio entre la barra y el cuadro punteado
                            zIndex: 9999,
                            whiteSpace: 'nowrap'  // Evita que la barra se rompa en varias líneas
                          }}
                        >

                          <div
                            className="text-editor-format-row"
                            onMouseDown={(event) => {
                              // preventDefault evita que el mousedown le quite el
                              // foco/selección al textarea al hacer clic en los
                              // BOTONES de esta barra (Negrita/Cursiva/A-/A+/etc,
                              // ver applyFormatToSelection). Pero en Chrome/Edge
                              // ese mismo preventDefault en el mousedown de un
                              // <select> NATIVO bloquea que el navegador abra su
                              // lista de opciones — bug real reportado: "Estilo"
                              // y "Fuente" quedaban fijos, ningún clic los abría.
                              // Los <select> (Estilo, Fuente) manejan su propio
                              // mousedown (ver más abajo, captureSelection) para
                              // seguir capturando la selección antes de perder
                              // foco, sin bloquear su apertura nativa.
                              if (['SELECT', 'INPUT'].includes((event.target as HTMLElement).tagName)) return;
                              event.preventDefault();
                            }}
                          >
                            {/* Estilo de documento (Título/Heading 1-6) sobre la
                              SELECCIÓN — no todo el bloque. Marca el rango con
                              headingStyle (ver lib/textSpans.ts) para que la
                              Tabla de Contenidos lo detecte igual que un
                              bloque entero (TableOfContents.tsx ya escanea
                              ambos). "Normal" (valor "") es la opción por
                              defecto: sin encabezado, no aparece en el TOC. */}
                            <select
                              className="text-editor-format-select text-editor-format-heading-select"
                              title="Estilo de documento de la selección (para la Tabla de Contenidos)"
                              value={toolbarHeadingStyle}
                              onMouseDown={captureSelection}
                              onChange={(event) => {
                                applyHeadingStyleToSelection(event.target.value);
                                handleSelectionMaybeChanged();
                              }}
                            >
                              <option value="">Normal</option>
                              {SELECTION_HEADING_OPTIONS.map((h) => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                              ))}
                            </select>
                            <div className="text-editor-format-divider" />
                            {/* "Copiar formato" (pincel, como Word): copia el
                              estilo EFECTIVO completo (negrita/cursiva/
                              subrayado/color/resaltado/fuente/tamaño/
                              encabezado — literalmente toolbarStyle, el mismo
                              objeto que ya alimenta el resto de esta barra)
                              de la selección o posición del cursor actual.
                              Queda armado (botón resaltado) hasta que el
                              usuario TERMINE de seleccionar texto en
                              cualquier bloque (ver maybeApplyFormatPainter,
                              enganchado a mouseup/keyup) — ahí se aplica y se
                              desarma solo. Clic de nuevo mientras está armado
                              lo cancela. */}
                            <button
                              className={copiedTextFormat ? 'is-active' : ''}
                              type="button"
                              title={copiedTextFormat
                                ? 'Modo pincel activo — selecciona el texto donde pegar el formato (clic para cancelar)'
                                : 'Copiar formato — luego selecciona el texto donde pegarlo'}
                              onClick={() => setCopiedTextFormat(copiedTextFormat ? null : toolbarStyle)}
                            >
                              <Paintbrush size={12} />
                            </button>
                            <div className="text-editor-format-divider" />
                            <button className={toolbarStyle.bold ? 'is-active' : ''} type="button" title="Negrita: selección o próxima escritura" onClick={() => applyFormatToSelection({ bold: true }, { toggle: true })}>
                              <Bold size={12} />
                            </button>
                            <button className={toolbarStyle.italic ? 'is-active' : ''} type="button" title="Cursiva: selección o próxima escritura" onClick={() => applyFormatToSelection({ italic: true }, { toggle: true })}>
                              <Italic size={12} />
                            </button>
                            <button className={toolbarStyle.underline ? 'is-active' : ''} type="button" title="Subrayado: selección o próxima escritura" onClick={() => applyFormatToSelection({ underline: true }, { toggle: true })}>
                              <Underline size={12} />
                            </button>
                            <div className="text-editor-format-divider" />
                            {/* Alineación del PÁRRAFO -- a diferencia de negrita/
                              cursiva/subrayado (que son por rango de caracteres,
                              ver `applyFormatToSelection`/`applyStyleToRange` en
                              lib/textSpans.ts), la alineación no es representable
                              por span: el modelo de texto de este bloque solo
                              admite un `textAlign` por BLOQUE completo (mismo
                              valor que ya usan los botones de alineación del
                              ribbon, ver RibbonToolbar.tsx -- "Párrafo"). Pedido
                              explícito 2026-09-11: la barra contextual que sale al
                              seleccionar texto en edición no tenía forma de
                              alinear sin salir a buscar el botón del ribbon. */}
                            <button className={toolbarStyle.textAlign === 'left' ? 'is-active' : ''} type="button" title="Alinear a la izquierda el párrafo de la selección" onClick={() => applyAlignToSelection('left')}>
                              <AlignLeft size={12} />
                            </button>
                            <button className={toolbarStyle.textAlign === 'center' ? 'is-active' : ''} type="button" title="Centrar el párrafo de la selección" onClick={() => applyAlignToSelection('center')}>
                              <AlignCenter size={12} />
                            </button>
                            <button className={toolbarStyle.textAlign === 'right' ? 'is-active' : ''} type="button" title="Alinear a la derecha el párrafo de la selección" onClick={() => applyAlignToSelection('right')}>
                              <AlignRight size={12} />
                            </button>
                            <button className={toolbarStyle.textAlign === 'justify' ? 'is-active' : ''} type="button" title="Justificar el párrafo de la selección" onClick={() => applyAlignToSelection('justify')}>
                              <AlignJustify size={12} />
                            </button>
                            <div className="text-editor-format-divider" />
                            <button
                              type="button"
                              title="Cambiar MAYÚSCULAS/minúsculas/Cada Palabra (como Word)"
                              onClick={applyCaseToSelection}
                            >
                              Aa
                            </button>
                            <ColorPalette
                              value={toolbarFontColor}
                              title="Color del texto de la selección"
                              onOpen={captureSelection}
                              onChange={(color) => { applyFormatToSelection({ color }); handleSelectionMaybeChanged(); }}
                            />
                            <Highlighter size={13} className="text-editor-format-highlight-icon" />
                            <ColorPalette
                              value={toolbarHighlightColor}
                              title="Color de resaltado de fondo de la selección"
                              allowClear
                              onOpen={captureSelection}
                              onChange={(color) => { applyFormatToSelection({ highlightColor: color }); handleSelectionMaybeChanged(); }}
                              onClear={() => { applyFormatToSelection({ highlightColor: 'transparent' }); handleSelectionMaybeChanged(); }}
                            />
                            {/* Cuadro indicador: muestra la fuente de lo que hay
                              seleccionado con el mouse. En blanco si la
                              selección mezcla dos o más fuentes distintas (no
                              hay UNA fuente que mostrar) — igual que Word deja
                              ese campo vacío ante una selección mixta. Es solo
                              lectura; el cambio de fuente se hace con el
                              selector de al lado. */}
                            <span
                              className="text-editor-format-current-font"
                              title={
                                selectionFontFamily
                                  ? `Fuente de la selección: ${selectionFontFamily}`
                                  : 'La selección mezcla varias fuentes'
                              }
                            >
                              {toolbarFontFamily || '—'}
                            </span>
                            <select
                              className="text-editor-format-select"
                              title="Cambiar la fuente de la selección o de la próxima escritura"
                              defaultValue=""
                              // Bug real: al mover el foco de verdad al <select>
                              // (mousedown→focus, no solo un evento sintético),
                              // el navegador COLAPSA ta.selectionStart/End a la
                              // posición del cursor — para cuando onChange se
                              // dispara (el usuario ya eligió una opción, el
                              // foco lleva rato en el select), la selección
                              // "viva" del textarea ya no existe. captureSelection
                              // guarda el rango ANTES de ese blur (mousedown
                              // ocurre primero), y applyFormatToSelection lo usa
                              // en vez de la selección ya colapsada — mismo
                              // arreglo que ya tenía el selector de Estilo.
                              onMouseDown={captureSelection}
                              onChange={(event) => {
                                if (!event.target.value) return;
                                applyFormatToSelection({ fontFamily: event.target.value });
                                event.target.value = '';
                                handleSelectionMaybeChanged();
                              }}
                            >
                              <option value="" disabled>Fuente…</option>
                              {['Arial', 'Inter', 'Times New Roman', 'Georgia', 'Calibri', 'Verdana'].map((f) => (
                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={7}
                              max={200}
                              className="text-editor-format-select text-editor-format-size-select"
                              title="Tamaño de fuente de la selección o de la próxima escritura"
                              value={toolbarFontSize}
                              onMouseDown={captureSelection}
                              onChange={(event) => {
                                const size = Number(event.target.value);
                                if (!Number.isFinite(size)) return;
                                applyFormatToSelection({ fontSize: Math.min(200, Math.max(7, size)) });
                                handleSelectionMaybeChanged();
                              }}
                            />
                            <button
                              type="button"
                              title="Reducir tamaño de la selección o de la próxima escritura (mínimo 7)"
                              onClick={() => applyFormatToSelection({ fontSize: Math.max(7, toolbarFontSize - 2) })}
                            >
                              A-
                            </button>
                            <button
                              type="button"
                              title="Aumentar tamaño de la selección o de la próxima escritura (máximo 200)"
                              onClick={() => applyFormatToSelection({ fontSize: Math.min(200, toolbarFontSize + 2) })}
                            >
                              A+
                            </button>
                          </div>
                        </div>

                        {/* Floating mini-toolbar for AI and Speech - non-intrusive */}
                        <div style={{ position: 'relative' /* Actúa como ancla para el textarea absolute */ }}>
                        
                          <div className="text-editor-mini-actions">
                            <button
                              type="button"
                              className={isCurrentDictationTarget ? 'active' : ''}
                              title="Dictado por voz"
                              disabled={!speechSupported}
                              onClick={toggleDictation}
                            >
                              {isCurrentDictationTarget ? <MicOff size={12} /> : <Mic size={12} />}
                            </button>
                            <button
                              type="button"
                              title="Corregir ortografía"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void runQuickCorrection();
                              }}
                            >
                              <CheckCheck size={12} />
                            </button>
                            <button
                              type="button"
                              title="Mejorar con IA"
                              className={isImproving ? 'loading' : ''}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                runAIImprovement(String(liveText || ''), (patch) => updateTextProps(patch));
                              }}
                            >
                              <Wand2 size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-close-seamless"
                              onClick={closeAndProcess}
                            >
                              <Save size={12} />
                            </button>
                          </div>
                          <div className="text-editor-rich-wrap" style={{ position: 'relative', width: `${Math.max(120, liveWidth - 16 - paragraphLeft - paragraphRight)}px`, height: `${Math.max(28, liveHeight - paragraphBefore - paragraphAfter)}px` }}>
                            {/* Overlay "fantasma": pinta el texto con el formato
                              real (por span) DEBAJO del textarea. El textarea
                              de encima queda con texto invisible (solo se ve
                              su caret) para que el usuario siga escribiendo/
                              seleccionando con el comportamiento nativo del
                              navegador (IME, doble-clic para elegir palabra,
                              flechas, etc.) mientras VE el resultado con
                              formato mixto en tiempo real — la técnica clásica
                              de "textarea con resaltado" (usada por editores
                              de código embebidos), sin reescribir toda la
                              máquina de tecleo/IME ya afinada en Fase 1/2. */}
                            <div
                              aria-hidden
                              ref={ghostWrapRef}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%', // Asegúrate de que tu componente padre esté recalculando esta altura dinámicamente
                                fontFamily: textProps.fontFamily,
                                fontSize: `${textProps.fontSize}px`,
                                lineHeight: effectiveLineHeight,
                                fontWeight: textProps.bold ? 700 : 400,
                                fontStyle: textProps.italic ? 'italic' : 'normal',
                                textDecoration: textProps.underline ? 'underline' : 'none',
                                wordWrap: 'break-word',
                                border: 'none',
                                outline: 'none',
                                boxShadow: 'none',             // Elimina el resplandor azul en Chrome/Safari
                                appearance: 'none',            // Elimina los estilos de formulario del SO
                                WebkitAppearance: 'none',      // Soporte para Safari/iOS
                                resize: 'none',                // Evita que el usuario pueda cambiar el tamaño de la caja manual
                                overflow: 'hidden',            // Elimina la barra de desplazamiento lateral
                                padding: 0,
                                margin: 0,
                                display: 'block',
                                textRendering: 'optimizeLegibility',
                                WebkitFontSmoothing: 'antialiased',
                                MozOsxFontSmoothing: 'grayscale',
                                fontKerning: 'none',
                                fontVariantLigatures: 'none',
                                letterSpacing: '0px',
                              }}
                            >
                              {(() => {
                                const selRange = getLiveSelectionRange();

                                // Renderiza UN segmento de estilo (ya con offsets
                                // ABSOLUTOS dentro de todo `liveText`) partiéndolo
                                // en tramos de selección/ortografía -- misma lógica
                                // de siempre, ahora factorizada para poder llamarse
                                // una vez POR PÁRRAFO (ver más abajo) en vez de una
                                // sola vez para todo el texto de corrido.
                                const renderSegment = (seg: ReturnType<typeof buildStyledSegments>[number], segStart: number, segEnd: number, keyPrefix: string) => {
                                  const baseCss = {
                                    ...styleToCss(seg.style),
                                    ...exactSpanCss,
                                    display: 'inline',
                                    margin: 0,
                                    padding: 0,
                                    fontKerning: 'none',
                                    fontVariantLigatures: 'none',
                                    letterSpacing: '0px',
                                  } as any;

                                  // Subrayado rojo en vivo: marcas de inlineSpellIssues
                                  // que caen dentro de este segmento (solo en el
                                  // bloque que se está editando ahora mismo).
                                  const segIssues = isLiveEditingThis
                                    ? inlineSpellIssues.filter((iss) => iss.offset < segEnd && iss.offset + iss.length > segStart)
                                    : [];

                                  if ((!selRange || selRange[0] === selRange[1] || selRange[1] <= segStart || selRange[0] >= segEnd) && segIssues.length === 0) {
                                    return <span key={keyPrefix} style={baseCss}>{seg.text}</span>;
                                  }

                                  // Puntos de corte combinados (selección + marcas
                                  // ortográficas) para partir el segmento en trozos
                                  // que cada uno tenga un único estado (seleccionado
                                  // y/o marcado) — igual idea que antes, generalizada.
                                  const cutpoints = new Set<number>([segStart, segEnd]);
                                  if (selRange && selRange[0] !== selRange[1]) {
                                    if (selRange[0] > segStart && selRange[0] < segEnd) cutpoints.add(selRange[0]);
                                    if (selRange[1] > segStart && selRange[1] < segEnd) cutpoints.add(selRange[1]);
                                  }
                                  segIssues.forEach((iss) => {
                                    const issStart = iss.offset;
                                    const issEnd = iss.offset + iss.length;
                                    if (issStart > segStart && issStart < segEnd) cutpoints.add(issStart);
                                    if (issEnd > segStart && issEnd < segEnd) cutpoints.add(issEnd);
                                  });
                                  const sortedCuts = Array.from(cutpoints).sort((a, b) => a - b);

                                  const parts: { text: string; selected: boolean; issue: AdvancedSuggestion | null }[] = [];
                                  for (let i = 0; i < sortedCuts.length - 1; i += 1) {
                                    const partStart = sortedCuts[i];
                                    const partEnd = sortedCuts[i + 1];
                                    if (partEnd <= partStart) continue;
                                    const selected = !!selRange && selRange[0] !== selRange[1] && partStart < selRange[1] && partEnd > selRange[0];
                                    const issue = segIssues.find((iss) => partStart < iss.offset + iss.length && partEnd > iss.offset) || null;
                                    parts.push({
                                      text: seg.text.slice(partStart - segStart, partEnd - segStart),
                                      selected,
                                      issue,
                                    });
                                  }

                                  return parts.map((part, partIndex) => {
                                    if (!part.text) return null;
                                    const partStyle = part.selected
                                      ? baseCss.backgroundColor
                                        ? { ...baseCss, outline: '2px solid rgba(37,99,235,0.65)', outlineOffset: -1 }
                                        : { ...baseCss, backgroundColor: 'rgba(37,99,235,0.35)' }
                                      : baseCss;
                                    return (
                                      <span
                                        key={`${keyPrefix}-${partIndex}`}
                                        className={part.issue ? 'spell-flag' : undefined}
                                        style={partStyle}
                                      >
                                        {part.text}
                                      </span>
                                    );
                                  });
                                };

                                const paragraphGroups = buildParagraphGroups(liveText, liveSpans, textBaseStyle);

                                const extraElements: React.ReactNode[] = [];
                                if (liveText === '') {
                                  extraElements.push(<span key="empty-placeholder" style={{ opacity: 0, display: 'inline', margin: 0, padding: 0 }}>&nbsp;</span>);
                                }
                                if (isCurrentDictationTarget && interimDictation) {
                                  extraElements.push(
                                    <span key="dictation-placeholder" style={{ opacity: 0.5, fontStyle: 'italic', display: 'inline', margin: 0, padding: 0 }}>
                                      {(liveText.trim().length > 0 ? ' ' : '') + interimDictation}
                                    </span>
                                  );
                                }

                                // Un <div> de bloque POR PÁRRAFO -- mismo criterio
                                // que el render estático más arriba (ver
                                // `buildParagraphGroups`) -- para que cada párrafo
                                // tenga su propia alineación durante la edición en
                                // vivo también (si no, el fantasma no coincidiría
                                // visualmente con el render estático apenas se
                                // deja de editar). El separador '\n' ENTRE párrafos
                                // se pinta igual como un carácter real (tamaño 0,
                                // sin alto) -- nunca se omite -- porque
                                // `getIndexFromClickPoint`/el cálculo de `caretRect`
                                // (PageCanvas.tsx) cuentan caracteres recorriendo el
                                // DOM de este mismo contenedor: si el '\n' no
                                // existiera como nodo de texto acá, todo offset
                                // después del primer párrafo quedaría corrido.
                                return paragraphGroups.map((group, groupIndex) => {
                                  let localOffset = 0;
                                  const spans = group.segments.map((seg, segIndex) => {
                                    const segStart = group.start + localOffset;
                                    const segEnd = segStart + seg.text.length;
                                    localOffset += seg.text.length;
                                    return renderSegment(seg, segStart, segEnd, `${groupIndex}-${segIndex}`);
                                  });
                                  const isLastGroup = groupIndex === paragraphGroups.length - 1;
                                  // Párrafo VACÍO (línea en blanco -- p.ej. justo
                                  // después de pulsar Enter dos veces seguidas):
                                  // sin ningún span de texto real, un <div> sin
                                  // contenido colapsa a alto CERO -- bug real
                                  // reportado en vivo 2026-09-11 ("si coloco enter
                                  // ... no veo que se genere ese espaciado, solo
                                  // se puede ver fuera del modo edición" -- el
                                  // render ESTÁTICO ya reservaba un <br/> para
                                  // este caso, pero este overlay "fantasma" de
                                  // edición en vivo no, así que el salto de línea
                                  // recién tecleado quedaba invisible hasta salir
                                  // de edición). Se omite solo si el placeholder
                                  // de "bloque vacío"/dictado (`extraElements`) ya
                                  // le da contenido/alto a este mismo párrafo.
                                  const needsBr = spans.length === 0 && !(isLastGroup && extraElements.length > 0);
                                  return (
                                    <React.Fragment key={groupIndex}>
                                      <div style={{ display: 'block', textAlign: group.align as any, whiteSpace: 'pre-wrap', textIndent: `${specialIndentOffset}px` }}>
                                        {needsBr ? <br /> : spans}
                                        {isLastGroup ? extraElements : null}
                                      </div>
                                      {!isLastGroup && (
                                        <span aria-hidden style={{ fontSize: 0, lineHeight: 0 }}>{'\n'}</span>
                                      )}
                                    </React.Fragment>
                                  );
                                });
                              })()}
                            </div>
                            
                            <textarea
                              ref={activeTextareaRef}
                              className="text-editor-area-seamless"
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%', // Asegúrate de que tu componente padre esté recalculando esta altura dinámicamente

                                fontFamily: textProps.fontFamily,
                                fontSize: `${textProps.fontSize}px`,
                                textAlign: textProps.textAlign as any,
                                lineHeight: effectiveLineHeight,
                                fontWeight: textProps.bold ? 700 : 400,
                                fontStyle: textProps.italic ? 'italic' : 'normal',
                                textDecoration: textProps.underline ? 'underline' : 'none',
                                
                                whiteSpace: 'pre-wrap',
                                wordWrap: 'break-word',
                                
                                // --- ESTOS SON LOS CAMBIOS CLAVE PARA DESAPARECER EL BLOQUE ---
                                color: 'transparent',
                                background: 'transparent',
                                caretColor: 'transparent',
                                
                                border: 'none',
                                outline: 'none',
                                boxShadow: 'none',             // Elimina el resplandor azul en Chrome/Safari
                                appearance: 'none',            // Elimina los estilos de formulario del SO
                                WebkitAppearance: 'none',      // Soporte para Safari/iOS
                                resize: 'none',                // Evita que el usuario pueda cambiar el tamaño de la caja manual
                                overflow: 'hidden',            // Elimina la barra de desplazamiento lateral
                                
                                padding: 0,
                                margin: 0,
                                display: 'block',
                                textRendering: 'optimizeLegibility',
                                WebkitFontSmoothing: 'antialiased',
                                MozOsxFontSmoothing: 'grayscale',
                                fontKerning: 'none',
                                fontVariantLigatures: 'none',
                                letterSpacing: '0px',
                                textIndent: `${specialIndentOffset}px`,
                                // Mismo ancho de sangría por TAB que la vista sin
                                // edición (ver depthTabsToDisplaySpaces/
                                // LIST_INDENT_TAB_SIZE en listFormatting.ts) --
                                // por spec CSS, tab-size:N equivale exactamente
                                // al ancho de N espacios, así que usar el mismo N
                                // en ambos lados hace que la sangría se vea
                                // idéntica editando y fuera de edición (antes el
                                // textarea usaba el tab-size:8 por defecto del
                                // navegador, mucho más ancho que lo que Konva
                                // pintaba fuera de edición).
                                tabSize: LIST_INDENT_TAB_SIZE,
                              }}
                              autoFocus
                              value={liveText}
                              placeholder="Empieza a escribir..."
                              onMouseDown={(event) => {
                                if (event.button !== 0) return;
                                // Al posicionarse manualmente en otra parte
                                // del texto, dejar de mostrar el formato
                                // pendiente y leer el estilo REAL de ese
                                // punto (fuente, tamaño, color, etc.).
                                setPendingTypingStyle(null);
                                const target = event.currentTarget;
                                const index = getIndexFromClickPoint(event.clientX, event.clientY);
                                textMouseAnchorRef.current = event.shiftKey
                                  ? (target.selectionDirection === 'backward' ? target.selectionEnd : target.selectionStart)
                                  : index;
                                target.focus({ preventScroll: true });
                                if (event.shiftKey) {
                                  target.setSelectionRange(textMouseAnchorRef.current, index);
                                  setSpellMenu(null);
                                } else {
                                  target.setSelectionRange(index, index);
                                  // Clic simple posado sobre una palabra marcada
                                  // con el subrayado rojo (mismo comportamiento
                                  // que el corrector nativo del SO): abrir el
                                  // menú de reemplazo justo ahí.
                                  const hitIssue = inlineSpellIssues.find(
                                    (iss) => index >= iss.offset && index <= iss.offset + iss.length,
                                  );
                                  if (hitIssue) {
                                    const wrapRect = ghostWrapRef.current?.getBoundingClientRect();
                                    setSpellMenu({
                                      issue: hitIssue,
                                      left: wrapRect ? event.clientX - wrapRect.left : 0,
                                      top: wrapRect ? event.clientY - wrapRect.top + 16 : 16,
                                    });
                                  } else {
                                    setSpellMenu(null);
                                  }
                                }
                              }}
                              onContextMenu={(event) => {
                                // Solo abre el menú "Separar en bloque
                                // nuevo" si hay una SELECCIÓN real (no un
                                // simple clic derecho sobre el cursor) --
                                // pedido explícito: nunca automático, y
                                // solo tiene sentido con texto seleccionado.
                                // Sin selección, se deja pasar el menú
                                // nativo del navegador (copiar/pegar, etc.)
                                // tal cual.
                                const target = event.currentTarget;
                                const { selectionStart, selectionEnd } = target;
                                if (selectionStart === selectionEnd) {
                                  setSplitBlockMenu(null);
                                  return;
                                }
                                event.preventDefault();
                                setSpellMenu(null);
                                const wrapRect = ghostWrapRef.current?.getBoundingClientRect();
                                setSplitBlockMenu({
                                  elementId: element.id,
                                  start: Math.min(selectionStart, selectionEnd),
                                  end: Math.max(selectionStart, selectionEnd),
                                  left: wrapRect ? event.clientX - wrapRect.left : 0,
                                  top: wrapRect ? event.clientY - wrapRect.top + 16 : 16,
                                });
                              }}
                              onBlur={(event) => {
                                // Bug real: hacer clic en un <select> NATIVO
                                // (Estilo/Fuente) mueve el foco del navegador
                                // del textarea hacia el select — eso SIEMPRE
                                // dispara onBlur del textarea, sin importar el
                                // preventDefault del mousedown. Cerrar el editor
                                // en cualquier blur significaba que abrir esos
                                // selects cerraba TODO el bloque de edición
                                // (textarea + barra flotante) antes de poder
                                // elegir una opción. Ahora solo se cierra si el
                                // foco sale COMPLETAMENTE del editor (afuera de
                                // .text-editor-seamless-container, que incluye
                                // la barra de formato y sus selects/popovers de
                                // color) — igual que Word no cierra el cursor
                                // de edición al usar su propia barra flotante.
                                const next = event.relatedTarget as Node | null;
                                const container = event.currentTarget.closest('.text-editor-seamless-container');
                                if (next && container?.contains(next)) {
                                  return;
                                }
                                closeAndProcess();
                              }}
                              onChange={(event) => {
                                const target = event.target;
                                const val = target.value;

                                // 1. Guardamos dónde estaba el cursor exactamente
                                const cursorStart = target.selectionStart;
                                const cursorEnd = target.selectionEnd;

                                // AutoFormato de Word (pedido explícito 2026-09-04):
                                // "- " al inicio de una línea se convierte sola en
                                // viñeta -- se resuelve ANTES de handleLiveTyping
                                // para aplicar directamente el texto YA corregido
                                // en vez de escribir "- " y corregirlo en un
                                // segundo paso. Ver también el Enter en
                                // onKeyDown más abajo, que continúa/corta la
                                // lista igual que Word.
                                let finalVal = val;
                                let finalCursor = cursorStart;
                                let convertedToBullet = false;
                                if (cursorStart === cursorEnd && cursorStart >= 2) {
                                  const lineStart = val.lastIndexOf('\n', cursorStart - 1) + 1;
                                  if (val.slice(lineStart, cursorStart) === '- ') {
                                    finalVal = val.slice(0, lineStart) + BULLET_MARKER + val.slice(cursorStart);
                                    finalCursor = lineStart + BULLET_MARKER.length;
                                    convertedToBullet = true;
                                  }
                                }

                                // 2. Actualizamos tu estado
                                handleLiveTyping(finalVal);
                                if (convertedToBullet && textProps.listType !== 'bullet') {
                                  updateTextProps({ listType: 'bullet' });
                                }

                                // Comando "/referencia" (ver slashRefMenu arriba):
                                // solo con el cursor colapsado (sin selección) --
                                // en cuanto lo que quedó justo antes del cursor
                                // es exactamente el comando, se abre el picker;
                                // si el usuario lo rompe (sigue tecleando, borra)
                                // se cierra solo.
                                if (cursorStart === cursorEnd && !convertedToBullet) {
                                  const before = val.slice(Math.max(0, cursorStart - SLASH_REF_TRIGGER.length), cursorStart);
                                  if (before.toLowerCase() === SLASH_REF_TRIGGER) {
                                    setSlashRefMenu({
                                      elementId: element.id,
                                      triggerStart: cursorStart - SLASH_REF_TRIGGER.length,
                                      triggerEnd: cursorStart,
                                    });
                                  } else if (slashRefMenu?.elementId === element.id) {
                                    setSlashRefMenu(null);
                                  }
                                }

                                // 3. Truco ninja: restauramos la posición del cursor en el siguiente frame
                                // para ganarle al ciclo de renderizado de React
                                requestAnimationFrame(() => {
                                  if (activeTextareaRef.current) {
                                    activeTextareaRef.current.setSelectionRange(
                                      finalCursor,
                                      convertedToBullet ? finalCursor : cursorEnd,
                                    );
                                  }
                                });
                              }}
                              onPaste={(event) => {
                                // Sin este handler, el pegado caía al
                                // comportamiento nativo del textarea: solo
                                // texto plano (todo el formato de Word/
                                // Google Docs se perdía) y, si el contenido
                                // no entraba en el bloque/página actual, se
                                // recortaba en silencio en vez de crear las
                                // páginas que hicieran falta (bug real
                                // reportado).
                                const clipboard = event.clipboardData;
                                if (!clipboard) return;
                                const html = clipboard.getData('text/html');
                                const plain = clipboard.getData('text/plain');
                                const parsed = parseRichClipboardPaste(html, plain);
                                if (!parsed) return;
                                event.preventDefault();
                                const target = event.currentTarget;
                                const selStart = target.selectionStart ?? liveText.length;
                                const selEnd = target.selectionEnd ?? liveText.length;
                                const cursorAfter = Math.min(selStart, selEnd) + parsed.text.length;
                                handlePasteRichText(parsed.text, parsed.spans, selStart, selEnd);
                                requestAnimationFrame(() => {
                                  if (activeTextareaRef.current) {
                                    activeTextareaRef.current.setSelectionRange(cursorAfter, cursorAfter);
                                  }
                                });
                              }}
                              onCompositionStart={() => {
                                isComposingRef.current = true;
                              }}
                              onCompositionEnd={(event) => {
                                isComposingRef.current = false;
                                const val = event.currentTarget.value;
                                updateTextProps({ text: val });
                                handleLiveTyping(val); // Dispara el recálculo inmediato de bounding-box
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  if (slashRefMenu?.elementId === element.id) {
                                    setSlashRefMenu(null);
                                    return;
                                  }
                                  closeAndProcess();
                                }
                                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                                  setPendingTypingStyle(null);
                                }
                                // Tab / Shift+Tab dentro de una lista (SCRUM-31,
                                // listas multinivel con sangria real: 1. -> a. ->
                                // i.) -- indenta/desindenta SOLO la linea del
                                // cursor y renumera todo el bloque (ver
                                // indentListLine en lib/listFormatting.ts). Sin
                                // lista activa, o ya en el limite de sangria,
                                // indentListLine devuelve null y se deja pasar el
                                // Tab normal (cambiar de foco), igual que antes.
                                if (event.key === 'Tab') {
                                  const ta = event.currentTarget;
                                  if (ta.selectionStart === ta.selectionEnd && textProps.listType !== 'none') {
                                    const result = indentListLine(liveText, ta.selectionStart, textProps.listType as ListStyleType, event.shiftKey ? -1 : 1);
                                    if (result) {
                                      event.preventDefault();
                                      handleLiveTyping(result.text);
                                      requestAnimationFrame(() => {
                                        activeTextareaRef.current?.setSelectionRange(result.cursorPos, result.cursorPos);
                                      });
                                      return;
                                    }
                                  }
                                  // Párrafo normal (sin lista activa, en el límite
                                  // de sangría de la lista, o con una selección de
                                  // texto): Tab indenta como cualquier editor --
                                  // inserta un carácter de tabulación en el cursor
                                  // (reemplazando la selección si la hay), en vez
                                  // de dejar que el navegador mueva el foco fuera
                                  // del textarea -- lo que cerraba TODO el bloque
                                  // de edición (bug real reportado). Shift+Tab
                                  // quita UN tab inmediatamente antes del cursor,
                                  // si lo hay.
                                  event.preventDefault();
                                  if (event.shiftKey) {
                                    const before = liveText.slice(0, ta.selectionStart);
                                    if (before.endsWith('\t')) {
                                      const newText = before.slice(0, -1) + liveText.slice(ta.selectionEnd);
                                      const newCursor = ta.selectionStart - 1;
                                      handleLiveTyping(newText);
                                      requestAnimationFrame(() => {
                                        activeTextareaRef.current?.setSelectionRange(newCursor, newCursor);
                                      });
                                    }
                                    return;
                                  }
                                  const newText = liveText.slice(0, ta.selectionStart) + '\t' + liveText.slice(ta.selectionEnd);
                                  const newCursor = ta.selectionStart + 1;
                                  handleLiveTyping(newText);
                                  requestAnimationFrame(() => {
                                    activeTextareaRef.current?.setSelectionRange(newCursor, newCursor);
                                  });
                                  return;
                                }
                                // Continuar la lista (viñetas O numerada/con
                                // letras/romanos, en cualquier nivel de sangria)
                                // al presionar Enter (AutoFormato de Word, pedido
                                // explícito 2026-09-04) -- mismo criterio que
                                // Word: si la línea donde está el cursor es un
                                // item de lista con contenido, Enter agrega un
                                // item nuevo debajo (mismo nivel de sangria,
                                // renumerado); si el item está VACÍO (el usuario
                                // ya no tiene nada que escribir ahí), Enter lo
                                // borra y corta la lista en vez de seguir
                                // apilando items vacíos. No aplica con
                                // Shift/Ctrl/Meta (salto de línea normal dentro
                                // del mismo ítem).
                                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                                  const ta = event.currentTarget;
                                  const cursor = ta.selectionStart;
                                  if (cursor === ta.selectionEnd) {
                                    const lineStart = liveText.lastIndexOf('\n', cursor - 1) + 1;
                                    const currentLine = liveText.slice(lineStart, cursor);
                                    const listMatch = textProps.listType !== 'none'
                                      ? currentLine.match(/^(\t*)(•\s*|◦\s*|▪\s*|[a-z]+\.\s*|[ivxlcdm]+\.\s*|\d+\.\s*)/i)
                                      : null;
                                    if (listMatch) {
                                      event.preventDefault();
                                      const [fullMarker, tabs] = listMatch;
                                      const hasContent = currentLine.slice(fullMarker.length).trim().length > 0;
                                      if (hasContent) {
                                        // Inserta una linea nueva vacia (solo la
                                        // sangria, sin marcador todavia -- lo pone
                                        // applyListToText al renumerar) y renumera.
                                        const withNewLine = liveText.slice(0, cursor) + '\n' + tabs + liveText.slice(cursor);
                                        const renumbered = applyListToText(withNewLine, textProps.listType as ListStyleType, { onlyExistingListLines: true });
                                        const caretAfter = cursor + 1 + tabs.length;
                                        handleLiveTyping(renumbered);
                                        requestAnimationFrame(() => {
                                          activeTextareaRef.current?.setSelectionRange(caretAfter, caretAfter);
                                        });
                                      } else {
                                        const withoutLine = liveText.slice(0, lineStart) + liveText.slice(cursor);
                                        const renumbered = applyListToText(withoutLine, textProps.listType as ListStyleType, { onlyExistingListLines: true });
                                        handleLiveTyping(renumbered);
                                        requestAnimationFrame(() => {
                                          activeTextareaRef.current?.setSelectionRange(lineStart, lineStart);
                                        });
                                      }
                                      return;
                                    }
                                  }
                                }
                                handleTextShortcuts(event);
                              }}
                              // Marcar/mover la selección con el mouse (arrastre,
                              // doble clic para elegir palabra) o con flechas +
                              // Shift no dispara onChange — sin estos tres, el
                              // cuadro indicador de fuente de la barra de
                              // formato quedaba desactualizado hasta la próxima
                              // tecla que sí modificara el texto.
                              onSelect={handleSelectionMaybeChanged}
                              onMouseMove={(event) => {
                                const anchor = textMouseAnchorRef.current;
                                if (event.buttons !== 1 || anchor === null) return;
                                const target = event.currentTarget;
                                const index = getIndexFromClickPoint(event.clientX, event.clientY);
                                if (textSelectionFrameRef.current !== null) return;
                                textSelectionFrameRef.current = requestAnimationFrame(() => {
                                  textSelectionFrameRef.current = null;
                                  target.setSelectionRange(
                                    Math.min(anchor, index),
                                    Math.max(anchor, index),
                                    index < anchor ? 'backward' : 'forward',
                                  );
                                  handleSelectionMaybeChanged();
                                });
                              }}
                              onMouseUp={(event) => {
                                const anchor = textMouseAnchorRef.current;
                                if (anchor !== null) {
                                  if (textSelectionFrameRef.current !== null) {
                                    cancelAnimationFrame(textSelectionFrameRef.current);
                                    textSelectionFrameRef.current = null;
                                  }
                                  const index = getIndexFromClickPoint(event.clientX, event.clientY);
                                  event.currentTarget.setSelectionRange(
                                    Math.min(anchor, index),
                                    Math.max(anchor, index),
                                    index < anchor ? 'backward' : 'forward',
                                  );
                                  textMouseAnchorRef.current = null;
                                }
                                handleSelectionMaybeChanged();
                                maybeApplyFormatPainter();
                              }}
                              onKeyUp={(event) => {
                                handleSelectionMaybeChanged();
                                // Solo teclas de navegación/selección (flechas
                                // con o sin Shift, Home/End) pueden dejar una
                                // selección "recién terminada" — evita que
                                // escribir texto normal con el pincel armado
                                // (cursor colapsado) dispare el chequeo en
                                // cada tecla sin necesidad.
                                if (
                                  event.key.startsWith('Arrow') ||
                                  event.key === 'Home' ||
                                  event.key === 'End'
                                ) {
                                  maybeApplyFormatPainter();
                                }
                              }}
                              onScroll={() => {
                                // Recalcular caretRect para seguir el desplazamiento del texto
                                handleSelectionMaybeChanged();
                              }}
                              spellCheck={true}
                              lang={spellcheckLang}
                              // Higiene sdkjs (text_input.js:211-215): impedir que
                              // el navegador/SO mute el texto por su cuenta bajo
                              // el modelo — el corrector propio de la plataforma
                              // (LanguageTool) es el único autorizado a corregir.
                              autoCorrect="off"
                              autoCapitalize="off"
                              autoComplete="off"
                            />
                            {caretRect && (
                              <div
                                aria-hidden
                                className="text-editor-custom-caret"
                                style={{
                                  position: 'relative',
                                  left: `${caretRect.left}px`,
                                  top: `${caretRect.top}px`,
                                  width: '1.5px',
                                  height: `${caretRect.height}px`,
                                  backgroundColor: textProps.fontColor,
                                  pointerEvents: 'none',
                                  zIndex: 10,
                                }}
                              />
                            )}
                            {spellMenu && isLiveEditingThis && (
                              <div
                                ref={spellMenuRef}
                                className="spell-suggest-menu"
                                style={{ left: `${spellMenu.left}px`, top: `${spellMenu.top}px` }}
                                onMouseDown={(event) => {
                                  // Evita que el clic dentro del menú le quite el
                                  // foco al textarea (mismo patrón que la barra de
                                  // formato flotante, ver text-editor-format-row).
                                  event.preventDefault();
                                }}
                              >
                                <div className="spell-suggest-title">{spellMenu.issue.message}</div>
                                {spellMenu.issue.replacements.length > 0 ? (
                                  spellMenu.issue.replacements.map((replacement, index) => (
                                    <button
                                      key={`${replacement}-${index}`}
                                      type="button"
                                      className="spell-suggest-option"
                                      onClick={() => applySpellSuggestion(spellMenu.issue, replacement)}
                                    >
                                      {replacement}
                                    </button>
                                  ))
                                ) : (
                                  <span className="spell-suggest-empty">Sin sugerencias automáticas.</span>
                                )}
                                <button
                                  type="button"
                                  className="spell-suggest-ignore"
                                  onClick={() => dismissSpellIssue(spellMenu.issue)}
                                >
                                  Omitir
                                </button>
                              </div>
                            )}
                            {splitBlockMenu && splitBlockMenu.elementId === element.id && isLiveEditingThis && (
                              <div
                                className="spell-suggest-menu"
                                style={{ left: `${splitBlockMenu.left}px`, top: `${splitBlockMenu.top}px` }}
                                onMouseDown={(event) => {
                                  // Mismo patrón que spellMenu (no perder el
                                  // foco del textarea) MÁS stopPropagation:
                                  // el efecto de cierre de arriba escucha
                                  // 'mousedown' en window, sin esto el clic
                                  // en el propio botón cerraría el menú
                                  // antes de que su onClick llegue a correr
                                  // (mismo criterio que canvas-context-menu).
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                              >
                                <button
                                  type="button"
                                  className="spell-suggest-option"
                                  onClick={() => splitSelectionIntoNewBlock(splitBlockMenu.start, splitBlockMenu.end)}
                                >
                                  Separar en bloque nuevo
                                </button>
                              </div>
                            )}
                            {slashRefMenu && slashRefMenu.elementId === element.id && isLiveEditingThis && (() => {
                              const annexItems = generateAnnexData(useEditorStore.getState().doc);
                              return (
                                <div
                                  className="slash-ref-menu"
                                  style={{
                                    left: `${caretRect?.left ?? 0}px`,
                                    top: `${(caretRect?.top ?? 0) + (caretRect?.height ?? 18) + 4}px`,
                                  }}
                                  onMouseDown={(event) => {
                                    // Mismo patrón que spellMenu: no perder el
                                    // foco/selección del textarea al clickear.
                                    event.preventDefault();
                                  }}
                                >
                                  <div className="slash-ref-menu-title">Referenciar imagen/tabla/gráfico</div>
                                  {annexItems.length === 0 ? (
                                    <span className="slash-ref-menu-empty">
                                      Sin pies de imagen/tabla/gráfico con Leyenda todavía.
                                    </span>
                                  ) : (
                                    annexItems.map((item) => (
                                      <button
                                        key={item.id}
                                        type="button"
                                        className="slash-ref-menu-option"
                                        onClick={() => {
                                          applyAnnexRefInsert(item.id, item.label, slashRefMenu.triggerStart, slashRefMenu.triggerEnd);
                                          setSlashRefMenu(null);
                                        }}
                                      >
                                        <span className="slash-ref-menu-label">{item.label}</span>
                                        <span className="slash-ref-menu-caption">{item.caption}</span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>


                        {advancedSuggestions.length > 0 && (
                          <div 
                          className="text-advanced-list"
                          style={{
                            position: 'absolute',
                            top: '100%', // Para que floten por DEBAJO del cuadro de texto
                            left: 0,
                            zIndex: 9999,
                            marginTop: '8px'
                          }}
                          >
                            {advancedSuggestions.slice(0, 6).map((suggestion, index) => (
                              <div key={`${suggestion.offset}-${suggestion.length}-${index}`} className="text-advanced-item">
                                <div className="text-advanced-message">{suggestion.message}</div>
                                {suggestion.context && <div className="text-advanced-context">{suggestion.context}</div>}
                                <div className="text-advanced-actions">
                                  {suggestion.replacements.length > 0 ? (
                                    suggestion.replacements.map((replacement, replacementIndex) => (
                                      <button
                                        key={`${replacement}-${replacementIndex}`}
                                        type="button"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          applyAdvancedSuggestion(suggestion, replacement);
                                          // Reenfocar inmediatamente para no perder el cursor de edición
                                          requestAnimationFrame(() => {
                                            activeTextareaRef.current?.focus();
                                          });
                                        }}
                                      >
                                        {replacement}
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-editor-hint">Sin sugerencias automáticas.</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {speechError && <div className="text-editor-error">{speechError}</div>}
                        {correctionInfo && <div className="text-editor-info">{correctionInfo}</div>}
                      </div>
                    </Html>
                  ) : null,
              ];
}
