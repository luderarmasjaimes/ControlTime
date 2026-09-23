import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { Html } from 'react-konva-utils';
import { ArrowLeftRight } from 'lucide-react';
import { useEditorStore, defaultBorderByType, resolvePagePaperSetup, type ReportComment, type ReportElement, type ReportPage } from '../../store/useEditorStore';
import { parseHtmlClipboardTable, parsePlainTextClipboardGrid, escapeHtml, computeAdaptiveTableFit } from '../../lib/tableClipboard';
import { serializeElementsForClipboard, extractInternalElementsFromHtml, stripLiveBindingForCrossUserPaste } from '../../lib/elementsClipboard';
import { getSession } from '../../../../auth/authStorage';
import { usePopover } from '../../lib/usePopover';
import { resolveHeadingRefLabel } from './TableOfContents';
import { resolveAnnexRefLabel } from './AnnexList';
import { getReportLayoutMetrics } from '../../lib/reportLayoutMetrics';
import { WRAP_MODE_OPTIONS, normalizeWrapMode } from '../layout/RightInspector';
import {
  textCorrectAdvanced,
  textRewriteOnPremise,
} from '../../lib/api';
import { textForSpellOrRewrite } from '../../lib/textSpellUtils';
import { measurePerfAsync } from '../../lib/performanceMonitor';
import { resolveReportImageSrc } from '../../lib/reportImageSrc';
import TableBlock from './InsertBlocks/TableBlock';
import CreateChartFromTableModal from '../modals/CreateChartFromTableModal';
import HeaderBlock from './InsertBlocks/HeaderBlock';
import FooterBlock from './InsertBlocks/FooterBlock';
import CoverBlock from './InsertBlocks/CoverBlock';
import ImageBlock from './InsertBlocks/ImageBlock';
import VideoBlock from './InsertBlocks/VideoBlock';
import ChartBlock from './InsertBlocks/ChartBlock';
import TocBlock from './InsertBlocks/TocBlock';
import { navigateToTocEntry } from './InsertBlocks/shared/tocNavigation';
import KpiBlock from './InsertBlocks/KpiBlock';
import SeismicReportBlock from './InsertBlocks/SeismicReportBlock';
import SensorBlock from './InsertBlocks/SensorBlock';
import SensorMultiChartBlock from './InsertBlocks/SensorMultiChartBlock';
import ShapeVisual from './InsertBlocks/ShapeBlock';
import TextBlock from './InsertBlocks/TextBlock/TextBlock';
import WordArtVisual from './InsertBlocks/WordArtBlock';
import {
  DEFAULT_TEXT_PROPS,
  getTextProps,
  getAutoSizedTextBox,
  getSpeechCtor,
  type AdvancedSuggestion,
} from './InsertBlocks/TextBlock/textBlockModel';
import {
  type TextStyleSpan,
  type BaseTextStyle,
  sanitizeSpans,
  reindexSpans,
} from '../../lib/textSpans';
import { registerActiveTextFormatHandler, registerActiveCaseHandler, registerActiveRefInsertHandler } from '../../lib/activeTextFormatBridge';
import { splitTextForHeight } from '../../lib/textPagination';
import { parseRichClipboardBlocks, pairCaptionsWithMedia, readImageSize, type PasteBlock, type ParagraphFormat } from '../../lib/richPaste';
import { useDragPreviewStore } from '../../store/useDragPreviewStore';

const GRID = 12;

function snap(value: number, enabled: boolean): number {
  if (!enabled) {
    return value;
  }
  return Math.round(value / GRID) * GRID;
}

// Debe coincidir con CONTENT_FLOW_GAP en useEditorStore.ts
// (pushDownContentAfterChange) — mismo margen que el empuje persistido, para
// que la vista previa en vivo de applyLivePushBelow no "salte" al soltar.
const LIVE_PUSH_GAP = 12;

function dominantImportedFontSize(spans: TextStyleSpan[], fallback = 12): number {
  const votes = new Map<number, number>();
  spans.forEach((span) => {
    if (typeof span.fontSize !== 'number' || span.fontSize <= 0) return;
    const size = Math.max(6, Math.min(72, Math.round(span.fontSize)));
    votes.set(size, (votes.get(size) || 0) + Math.max(1, span.end - span.start));
  });
  let bestSize = fallback;
  let bestVotes = -1;
  votes.forEach((chars, size) => {
    if (chars > bestVotes) {
      bestVotes = chars;
      bestSize = size;
    }
  });
  return bestSize;
}

function scaleImportedSpans(spans: TextStyleSpan[], ratio: number): TextStyleSpan[] {
  if (Math.abs(ratio - 1) < 0.01) return spans;
  return spans.map((span) => (
    typeof span.fontSize === 'number' && span.fontSize > 0
      ? { ...span, fontSize: Math.max(6, Math.round(span.fontSize * ratio)) }
      : span
  ));
}

function isFlowChromeElement(type: string): boolean {
  return type === 'header' || type === 'footer' || type === 'cover';
}

/** Misma tolerancia de 24px que sameFlowColumn en useEditorStore.ts. */
function sharesFlowColumn(anchorX: number, anchorWidth: number, x: number, width: number): boolean {
  return x < anchorX + anchorWidth - 24 && anchorX < x + width - 24;
}

/** Descarga y convierte una URL http(s) de imagen (Google Docs sirve las
 * suyas así, desde su CDN) a data: URI -- compartida por el pegado del
 * portapapeles (imagen suelta y documento mixto, ver el `useEffect` de
 * `onSystemPaste` más abajo). Sin dependencias de React, módulo-nivel. */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    // Imagen no descargable desde acá (CORS/expiró/requiere sesión) -- no
    // se pega nada, sin romper el resto del flujo.
    return null;
  }
}

async function resolveImagePasteSize(
  src: string,
  hintWidth: number | undefined,
  hintHeight: number | undefined,
  maxWidth: number,
  maxHeight: number,
): Promise<{ width: number; height: number } | null> {
  let width = hintWidth;
  let height = hintHeight;
  if (width === undefined || height === undefined) {
    const natural = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
    if (natural && natural.w > 0 && natural.h > 0) {
      if (width === undefined && height === undefined) {
        width = natural.w;
        height = natural.h;
      } else if (width === undefined) {
        width = Math.round(height! * (natural.w / natural.h));
      } else if (height === undefined) {
        height = Math.round(width! * (natural.h / natural.w));
      }
    }
  }
  if (!width || !height) return null;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Galería de transiciones (SCRUM-36, PageCanvas.tsx::page-transition-control)
 * — antes un <select> nativo invisible superpuesto al botón circular
 * (truco "select transparente encima"), pedido explícito 2026-09-08:
 * reemplazarlo por un popover con miniatura animada por opción. Ampliado
 * 2026-09-11 (pedido explícito, feedback de cliente "mas detallado"): 3
 * transiciones nuevas (cover/uncover/circle, ver TRANSITION_XML en
 * pdf-export-service/server.js para el mapeo real a PowerPoint) y la
 * miniatura pasó de reproducirse solo al pasar el cursor a reproducirse en
 * bucle sola (ver TransitionPreview) -- "a veces se traban" era justamente
 * que, al ser un `transition:` de una sola pasada gatillado por :hover, la
 * miniatura quedaba congelada en el estado final hasta un nuevo hover. */
const TRANSITION_OPTIONS: { value: NonNullable<ReportPage['transition']>; label: string; desc: string }[] = [
  { value: 'none', label: 'Ninguna', desc: 'Corte directo, sin animación' },
  { value: 'fade', label: 'Desvanecer', desc: 'La diapositiva se disuelve en la siguiente' },
  { value: 'push', label: 'Empujar', desc: 'La siguiente empuja a la actual fuera de pantalla' },
  { value: 'wipe', label: 'Barrido', desc: 'La siguiente cubre a la actual de izquierda a derecha' },
  { value: 'cover', label: 'Cubrir', desc: 'La siguiente entra encima sin desplazar a la actual' },
  { value: 'uncover', label: 'Descubrir', desc: 'La actual se retira dejando ver a la siguiente' },
  { value: 'circle', label: 'Círculo', desc: 'La siguiente aparece desde un círculo que crece en el centro' },
];

/** Contenido genérico de relleno (barra de título + líneas de texto, y un
 * cuadrado tipo imagen/gráfico solo en la diapositiva "B") -- pedido
 * explícito 2026-09-11: antes cada capa era un rectángulo de color sólido
 * sin nada adentro, así que la transición no se leía como "una diapositiva
 * reemplaza a otra", solo como un bloque de color tapando a otro. */
function TransitionMockSlide({ variant }: { variant: 'a' | 'b' }) {
  return (
    <div className={`tp-mock tp-mock--${variant}`}>
      <div className="tp-mock-bar" />
      <div className="tp-mock-line tp-mock-line--1" />
      <div className="tp-mock-line tp-mock-line--2" />
      {variant === 'b' && <div className="tp-mock-square" />}
    </div>
  );
}

function TransitionPreview({ kind }: { kind: NonNullable<ReportPage['transition']> }) {
  return (
    <div className={`transition-option-preview transition-option-preview--${kind}`}>
      <div className="tp-layer tp-layer-a">
        <TransitionMockSlide variant="a" />
      </div>
      <div className="tp-layer tp-layer-b">
        <TransitionMockSlide variant="b" />
      </div>
    </div>
  );
}

export interface PageCanvasProps {
  page: ReportPage;
  viewportScale?: number;
  totalPages?: number;
  onRequestImageReplace?: (pageNumber: number, elementId: string, initialTab?: string) => void;
  onRequestCoverImage?: (pageNumber: number, elementId: string) => void;
  tenantId?: string;
}

// React.memo: cada página es un objeto propio en el store (useEditorStore
// solo reemplaza la referencia de la página editada — ver
// updateElement/removeElement, etc.), así que memoizar por props evita
// re-renderizar TODAS las páginas del documento en cada tecla escrita en
// UNA sola página.
const PageCanvas = React.memo(function PageCanvas({ page, viewportScale = 1, totalPages, onRequestImageReplace, onRequestCoverImage, tenantId }: PageCanvasProps) {
  const transformerRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const stageRef = useRef<any>(null);
  const dragInProgressRef = useRef(false);
  const multiDragStartRef = useRef<Record<string, { x: number; y: number }>>({});
  // Ancla + su caja ORIGINAL (antes del gesto) para la vista previa en vivo
  // del empuje hacia abajo (ver applyLivePushBelow más abajo) — solo se
  // arma en arrastre/redimensionado de UN elemento (nunca en selección
  // múltiple, donde "quién empuja a quién" es ambiguo); el empuje
  // definitivo (que además encadena entre páginas) lo sigue calculando
  // pushDownContentAfterChange en el store al confirmar.
  const dragPushAnchorRef = useRef<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  const transformPushAnchorRef = useRef<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  // IDs de elementos que applyLivePushBelow movió imperativamente (solo
  // visual) durante el gesto en curso — ver resetLivePushPreview más abajo.
  const livePushedIdsRef = useRef<Set<string>>(new Set());
  const wasSelectedRef = useRef(false);
  // Último punto (coordenadas de contenido de la página, no de pantalla)
  // donde el usuario hizo clic dentro de este lienzo — pedido explícito:
  // "pegar" (Ctrl+V) debe soltar el contenido AHÍ, no en un punto
  // auto-calculado del flujo del documento. Se actualiza en CADA mousedown
  // sobre el Stage (tanto en área vacía como sobre un objeto existente, ver
  // más abajo), y lo usan tanto el pegado interno de objetos (pasteElement)
  // como el pegado de imagen/tabla desde el portapapeles del sistema.
  const lastCanvasClickRef = useRef<{ x: number; y: number } | null>(null);
  // Offset (en unidades LÓGICAS de página, sin escala) entre dónde agarró
  // el usuario el bloque y su esquina superior izquierda -- capturado en
  // onDragStart, usado en onDragMove para que el fantasma flotante
  // (DragPreviewOverlay, ver useDragPreviewStore.ts) siga al cursor
  // alineado con el punto exacto donde se hizo clic, en vez de saltar a que
  // su esquina quede bajo el cursor.
  const dragGhostGrabOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const scale = Math.min(4, Math.max(0.1, Number(viewportScale) || 1));
  const recognitionRef = useRef<any>(null);
  const dictationTargetRef = useRef<string | null>(null);
  const selectedElementIds = useEditorStore(s => s.selectedElementIds);
  const toggleSelection = useEditorStore(s => s.toggleSelection);
  const moveElementsBetweenPages = useEditorStore(s => s.moveElementsBetweenPages);
  const applyLivePushBelow = (
    anchorId: string,
    anchorOriginal: { x: number; y: number; width: number; height: number },
    anchorLive: { x: number; y: number; width: number; height: number },
  ) => {
    const layer = layerRef.current;
    if (!layer) return;
    const candidates = page.elements
      .filter((el) =>
        el.id !== anchorId &&
        !isFlowChromeElement(el.type) &&
        !el.locked &&
        !selectedElementIds.includes(el.id) &&
        el.y > anchorOriginal.y &&
        sharesFlowColumn(anchorOriginal.x, anchorOriginal.width, el.x, el.width),
      )
      .sort((a, b) => a.y - b.y);
    if (candidates.length === 0) return;

    let cursorY = anchorLive.y + anchorLive.height + LIVE_PUSH_GAP;
    for (const el of candidates) {
      const desiredY = Math.max(el.y, cursorY);
      const node = layer.findOne(`#${el.id}`);
      if (node) {
        node.position({ x: node.x(), y: desiredY });
        livePushedIdsRef.current.add(el.id);
      }
      cursorY = desiredY + el.height + LIVE_PUSH_GAP;
    }
    layer.batchDraw();
  };

  /**
   * Deshace el desplazamiento visual de applyLivePushBelow al terminar el
   * gesto. react-konva solo reaplica una prop a un nodo si su VALOR
   * cambió respecto al render anterior — si el ancla termina yéndose a
   * OTRA página (moveElementsBetweenPages), estos elementos empujados en
   * vivo nunca son tocados por el commit del store (su `y` real nunca
   * cambió), así que React jamás vuelve a fijar su posición real y el
   * nodo Konva queda "fantasma" en la posición de la vista previa. Bug
   * reportado 2026-09-04: "cuando muevo un objeto a esa hoja libre, todo
   * lo que esta en la hoja de abajo se descuadra". Se corrige forzando
   * cada nodo tocado de vuelta a su `y` verdadero, leído fresco del store
   * (no de `page`, que puede estar desactualizado en este cierre).
   */
  const resetLivePushPreview = () => {
    if (livePushedIdsRef.current.size === 0) return;
    const ids = livePushedIdsRef.current;
    livePushedIdsRef.current = new Set();
    const layer = layerRef.current;
    if (!layer) return;
    const freshPage = useEditorStore.getState().doc.pages.find((p) => p.page_number === page.page_number);
    if (!freshPage) return;
    ids.forEach((id) => {
      const node = layer.findOne(`#${id}`);
      const el = freshPage.elements.find((e) => e.id === id);
      if (node && el) {
        node.position({ x: node.x(), y: el.y });
      }
    });
    layer.batchDraw();
  };
  const splitOverflowingText = useEditorStore(s => s.splitOverflowingText);
  const pasteTextAcrossPages = useEditorStore(s => s.pasteTextAcrossPages);
  const splitOverflowingTable = useEditorStore(s => s.splitOverflowingTable);
  const addChartFromTable = useEditorStore(s => s.addChartFromTable);
  const pendingTextContinuation = useEditorStore(s => s.pendingTextContinuation);
  const clearPendingTextContinuation = useEditorStore(s => s.clearPendingTextContinuation);
  const copiedTextFormat = useEditorStore(s => s.copiedTextFormat);
  const setCopiedTextFormat = useEditorStore(s => s.setCopiedTextFormat);
  const isComposingRef = useRef(false);
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textSplitInProgressRef = useRef(false);
  const pendingCaretToEndRef = useRef<string | null>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const activeFormatBridgeRef = useRef<((patch: Partial<BaseTextStyle>) => boolean) | null>(null);
  const activeCaseBridgeRef = useRef<(() => boolean) | null>(null);
  // Mismo patrón, para el puente de "Insertar referencia" (ADR-019, ver
  // activeTextFormatBridge.ts::tryInsertRefAtActiveTextSelection).
  const activeRefInsertBridgeRef = useRef<((targetId: string) => boolean) | null>(null);
  const [selectionTick, setSelectionTick] = useState(0);
  const ghostWrapRef = useRef<HTMLDivElement | null>(null);
  const textMouseAnchorRef = useRef<number | null>(null);
  const textSelectionFrameRef = useRef<number | null>(null);
  const [caretRect, setCaretRect] = useState<{ left: number; top: number; height: number } | null>(null);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  // Tamaño/orientación EFECTIVOS de esta página: su propio override si lo
  // tiene (ADR-052: tamaño/orientación por página), si no el del
  // documento — ver `resolvePagePaperSetup`.
  const docPaperSize = useEditorStore((s) => s.doc.meta?.paperSize);
  const docOrientation = useEditorStore((s) => s.doc.meta?.orientation);
  const marginLeft = useEditorStore((s) => s.doc.meta?.marginLeft);
  const marginRight = useEditorStore((s) => s.doc.meta?.marginRight);
  const marginTop = useEditorStore((s) => s.doc.meta?.marginTop);
  const marginBottom = useEditorStore((s) => s.doc.meta?.marginBottom);
  const { paperSize, orientation } = resolvePagePaperSetup(
    { paperSize: page.paperSize, orientation: page.orientation },
    { paperSize: docPaperSize, orientation: docOrientation },
  );
  // El bloque de índice (TOC) lee encabezados de TODAS las páginas via
  // getState() (ver más abajo) — sin esta suscripción, React.memo bloqueaba
  // el re-render de esta página cuando el encabezado editado vivía en OTRA
  // página, dejando el índice desactualizado hasta que algo más forzara un
  // re-render por otro motivo ("a veces parecía no haber aplicado el cambio").
  const docVersion = useEditorStore((s) => s.doc.meta?.version);
  const linkedComments = useEditorStore((s) => ((s.doc.meta.comments as ReportComment[] | undefined) || []).filter(
    (comment) => comment.pageNumber === page.page_number && Boolean(comment.elementId),
  ));
  const hoveredCommentId = useEditorStore((s) => s.hoveredCommentId);
  // Resolver de referencias cruzadas (ADR-019) — mismo patrón que el bloque
  // TOC: lee el doc completo via getState() (imperativo) en vez de
  // suscribirse a `doc.pages` entero (evitaría re-renderizar TODAS las
  // páginas ante cualquier cambio en cualquier página), y se recalcula solo
  // cuando `docVersion` cambia. El closure vuelve a leer getState() en cada
  // invocación (no captura el doc), así que siempre refleja la numeración
  // vigente aunque el usuario mueva/inserte una sección después de este render.
  const resolveTextRef = useMemo(
    () => (targetId: string) => {
      const doc = useEditorStore.getState().doc;
      return resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc, targetId);
    },
    [docVersion],
  );
  const {
    PAGE_WIDTH,
    PAGE_HEIGHT,
    HEADER_HEIGHT,
    FOOTER_HEIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
    CONTENT_LEFT,
    CONTENT_RIGHT,
  } = useMemo(
    () => getReportLayoutMetrics(layoutMode, paperSize, orientation, marginLeft, marginRight, marginTop, marginBottom),
    [layoutMode, paperSize, orientation, marginLeft, marginRight, marginTop, marginBottom],
  );
  // Métricas (CONTENT_TOP/BOTTOM/LEFT/RIGHT, PAGE_WIDTH/HEIGHT) de OTRA
  // página del documento -- necesario para el fantasma de arrastre
  // (DragPreviewOverlay): mientras se arrastra cerca del límite de ESTA
  // página, hay que saber los límites de la página vecina bajo el cursor
  // para recortar el fantasma ahí y no dejarlo "flotar" sobre su
  // encabezado/pie. Mismo criterio que `paperSize`/`orientation` arriba,
  // pero resuelto para el número de página que se pida, no solo `page`.
  const getMetricsForPageNumber = (targetPageNumber: number) => {
    if (targetPageNumber === page.page_number) {
      return { PAGE_WIDTH, PAGE_HEIGHT, CONTENT_LEFT, CONTENT_RIGHT, CONTENT_TOP, CONTENT_BOTTOM };
    }
    const docState = useEditorStore.getState().doc;
    const targetPage = docState.pages.find((p) => p.page_number === targetPageNumber);
    const targetSetup = resolvePagePaperSetup(
      { paperSize: targetPage?.paperSize, orientation: targetPage?.orientation },
      { paperSize: docState.meta?.paperSize, orientation: docState.meta?.orientation },
    );
    return getReportLayoutMetrics(
      layoutMode, targetSetup.paperSize, targetSetup.orientation,
      docState.meta?.marginLeft, docState.meta?.marginRight, docState.meta?.marginTop, docState.meta?.marginBottom,
    );
  };
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectPage = useEditorStore((s) => s.selectPage);
  const updateElement = useEditorStore((s) => s.updateElement);
  const relocateWrapAdjustedText = useEditorStore((s) => s.relocateWrapAdjustedText);
  const removeElement = useEditorStore((s) => s.removeElement);
  const removeElements = useEditorStore((s) => s.removeElements);
  const copyElement = useEditorStore((s) => s.copyElement);
  const pasteElement = useEditorStore((s) => s.pasteElement);
  const addElement = useEditorStore((s) => s.addElement);
  const addPage = useEditorStore((s) => s.addPage);
  const clipboardElement = useEditorStore((s) => s.clipboardElement);
  const copySelection = useEditorStore((s) => s.copySelection);
  const pasteSelection = useEditorStore((s) => s.pasteSelection);
  const selectAllDocument = useEditorStore((s) => s.selectAllDocument);
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const pendingImportBlocks = useEditorStore((s) => s.pendingImportBlocks);
  const setPendingImportBlocks = useEditorStore((s) => s.setPendingImportBlocks);
  const gridEnabled = useEditorStore((s) => s.gridEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setPageTransition = useEditorStore((s) => s.setPageTransition);
  const transitionPopover = usePopover();
  const [openTextEditorId, setOpenTextEditorId] = useState<string | null>(null);
  const [liveEdit, setLiveEdit] = useState<{ id: string; text: string; width: number; height: number; spans: TextStyleSpan[] } | null>(null);
  const [pendingTypingStyle, setPendingTypingStyle] = useState<{ elementId: string; style: Partial<BaseTextStyle> } | null>(null);
  const liveEditCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tabla: edición en lienzo solo tras doble clic; si no, el DOM bloquea selección como con KPI. */
  const [canvasTableEditId, setCanvasTableEditId] = useState<string | null>(null);
  const [canvasVideoInteractId, setCanvasVideoInteractId] = useState<string | null>(null);
  /** Menú contextual (click derecho) sobre un bloque: bloquear/desbloquear y
   * eliminar — pedido explícito del negocio ("borrarse por medio del menú
   * contextual"). Posicionado en coordenadas de viewport (fixed), no de
   * lienzo, porque vive fuera del Stage de Konva (es un overlay HTML). */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string } | null>(null);
  /** Submenú "Ajustar texto" del menú contextual — alternativa adicional al
   * picker del panel derecho, pedida explícitamente ("clic derecho sobre el
   * objeto seleccionado" para cambiar el modo más rápido). */
  const [contextWrapSubmenuOpen, setContextWrapSubmenuOpen] = useState(false);
  /** Modal "Crear gráfico desde esta tabla", abierto desde el menú contextual
   * de celda de TableBlock (clic derecho) -- pedido explícito 2026-09-11. */
  const [chartFromTableRequest, setChartFromTableRequest] = useState<{ tableElementId: string } | null>(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => { setContextMenu(null); setContextWrapSubmenuOpen(false); };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  /** Menú contextual para bloques con contenido HTML superpuesto al lienzo
   * (chart/kpi/table/image/cover/toc/sensor) — el div visible de esos
   * bloques está POR ENCIMA del Rect de Konva que ya tiene su propio
   * onContextMenu, así que un click derecho ahí nunca llegaría a Konva sin
   * este handler nativo en el propio div. */
  const handleHtmlBlockContextMenu = (elementId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    selectElement(elementId);
    setContextMenu({ x: event.clientX, y: event.clientY, elementId });
  };
  const [isDictating, setIsDictating] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  // Vista previa de dictado (resultados NO finales de SpeechRecognition):
  // estado local puro, nunca toca el store/updateTextProps. Confirmar cada
  // resultado interino al store (remapSpansForTextChange + updateElement,
  // ver updateTextProps) costaría un relayout de Konva por cada palabra
  // parcial que el motor de voz emite mientras el usuario aún habla —
  // updateTextProps ya documenta que asume conmits INFRECUENTES. Mostrar el
  // interino aquí (barato, local a este bloque) da feedback instantáneo sin
  // ese costo; solo el resultado FINAL de la frase se confirma al store.
  const [interimDictation, setInterimDictation] = useState('');
  const [correctionInfo, setCorrectionInfo] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);

  /** Redacción on-premise: backend (LanguageTool + rápido + Ollama opcional). */
  const runAIImprovement = async (currentText: string, updateFn: (patch: { text: string }) => void) => {
    const sourceText = textForSpellOrRewrite(currentText);
    if (!sourceText) {
      setCorrectionInfo('Escribe primero el texto técnico (el cuadro no puede estar vacío ni ser solo el texto de ayuda).');
      setTimeout(() => setCorrectionInfo(null), 5000);
      return;
    }

    setIsImproving(true);
    setCorrectionInfo('Servidor: ortografía, gramática y redacción asistida…');

    try {
      // O6 de ADR-023: IA local por párrafo < 1s.
      const data = await measurePerfAsync('ia_correction', () => textRewriteOnPremise(sourceText, {
        language: 'es-PE',
        level: 'picky',
        use_llm: true,
      }));
      if (data?.error) {
        if (data.error === 'empty_text') {
          setCorrectionInfo('No hay texto válido para reescribir.');
        } else {
          setCorrectionInfo(typeof data.error === 'string' ? data.error : 'Error en el servidor.');
        }
        return;
      }
      const improvedText = String(data?.text ?? sourceText);
      updateFn({ text: improvedText });
      const llm = data?.llm_applied ? ' IA local (Ollama) aplicada.' : ' Solo corrección automática (LanguageTool + reglas); la IA no devolvió un resultado válido.';
      setCorrectionInfo(improvedText !== sourceText ? `Listo.${llm}` : `Sin cambios automáticos.${llm}`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'error';
      setCorrectionInfo(`No se pudo mejorar el texto: ${msg}`);
    } finally {
      setIsImproving(false);
      setTimeout(() => setCorrectionInfo(null), 5000);
    }
  };
  const [advancedSuggestions, setAdvancedSuggestions] = useState<AdvancedSuggestion[]>([]);
  const [isAnalyzingSpelling, setIsAnalyzingSpelling] = useState(false);
  // Subrayado rojo en vivo (estilo corrector nativo del SO): mientras se
  // edita, cada pausa de tecleo dispara un análisis en segundo plano
  // (mismo backend LanguageTool que "Corrección avanzada") y las palabras/
  // frases marcadas se subrayan directamente en el overlay fantasma (ver
  // buildStyledSegments más abajo). Clic sobre una marca abre el menú de
  // reemplazo — ver spellMenu.
  const [inlineSpellIssues, setInlineSpellIssues] = useState<AdvancedSuggestion[]>([]);
  const [spellMenu, setSpellMenu] = useState<{ issue: AdvancedSuggestion; left: number; top: number } | null>(null);
  /** Menú "Separar en bloque nuevo" -- clic derecho con texto SELECCIONADO
   * dentro del editor (pedido explícito 2026-09-09: "facilitará el proceso
   * para arreglar la estructura al importar Word" -- complemento MANUAL a
   * la partición automática por salto de página que ya hace la importación
   * de .docx). Solo abre el menú, nunca separa de una vez con el clic
   * derecho -- pedido explícito. Mismo criterio visual/posicional que
   * spellMenu arriba: `left`/`top` relativos al wrap del editor, no al
   * viewport (vive dentro del mismo <Html> que el textarea).
   */
  const [splitBlockMenu, setSplitBlockMenu] = useState<{ elementId: string; start: number; end: number; left: number; top: number } | null>(null);
  // Mismo patrón de cierre que contextMenu (clic afuera/scroll/Esc).
  useEffect(() => {
    if (!splitBlockMenu) return undefined;
    const close = () => setSplitBlockMenu(null);
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [splitBlockMenu]);
  // Comando "/referencia" (pedido explícito 2026-09-04): apenas el texto
  // tecleado hasta el cursor termina en este comando, se abre un picker
  // minimalista (mismo criterio visual que spellMenu) con todos los pies de
  // imagen/tabla/gráfico del documento (ver AnnexList.tsx). `triggerStart`/
  // `triggerEnd` son el rango [start,end) del propio "/referencia" tecleado
  // -- se reemplaza entero por el rótulo corto elegido ("Imagen 3") al
  // hacer clic en una opción, ver applyAnnexRefInsert más abajo.
  const SLASH_REF_TRIGGER = '/referencia';
  const BULLET_MARKER = '•   ';
  const [slashRefMenu, setSlashRefMenu] = useState<{ elementId: string; triggerStart: number; triggerEnd: number } | null>(null);
  const liveEditSnapshotRef = useRef(liveEdit);
  liveEditSnapshotRef.current = liveEdit;
  const spellMenuRef = useRef<HTMLDivElement | null>(null);
  const wrapAutoHeightRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  const speechSupported = Boolean(getSpeechCtor());
  const getIndexFromClickPoint = (clientX: number, clientY: number): number => {
    const ghost = ghostWrapRef.current;
    if (!ghost) return 0;

    let range: Range | null = null;
    const textarea = activeTextareaRef.current;
    const previousPointerEvents = textarea?.style.pointerEvents;

    // El textarea está encima del ghost y, aunque su texto sea transparente,
    // el navegador puede devolver un caretRange dentro de él. Desactívalo
    // solo durante la medición para consultar las métricas del texto visible.
    if (textarea) textarea.style.pointerEvents = 'none';

    try {
      // Obtener el rango nativo del DOM bajo el puntero del ratón.
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      } else if ((document as any).caretPositionFromPoint) {
        const pos = (document as any).caretPositionFromPoint(clientX, clientY);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
    } finally {
      if (textarea) textarea.style.pointerEvents = previousPointerEvents || '';
    }

    if (!range || !ghost.contains(range.startContainer)) return 0;

    // Recorrer los nodos del ghost hasta la posición clickeada para contar el total de caracteres
    let charCount = 0;
    const targetNode = range.startContainer;
    const targetOffset = range.startOffset;

    const walk = (node: Node): boolean => {
      if (node === targetNode) {
        charCount += targetOffset;
        return true;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        charCount += node.textContent?.length ?? 0;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walk(child)) return true;
        }
      }
      return false;
    };

    walk(ghost);
    return charCount;
  };

  useEffect(() => {
    if (!transformerRef.current || !layerRef.current) {
      return;
    }

    // El Transformer actual se mantiene únicamente para selección única.
    // La multiselección visual se representa mediante los Rect individuales.
    if (selectedElementIds.length !== 1) {
      transformerRef.current.nodes([]);
      layerRef.current.batchDraw();
      return;
    }

    const selectedId = selectedElementIds[0];
    const node = layerRef.current.findOne(`#${selectedId}`);
    const selectedEl = page.elements.find((el) => el.id === selectedId);
    // El elemento de "texto plano" de la página (ver
    // ReportPage.plainTextElementId) nunca lleva asas de redimensión --
    // está siempre en edición, igual que si openTextEditorId lo apuntara.
    const isPageTextEl = selectedEl?.type === 'text' && page.plainTextElementId === selectedId;

    if (
      node &&
      openTextEditorId !== selectedId &&
      !isPageTextEl &&
      !selectedEl?.locked
    ) {
      transformerRef.current.nodes([node]);
    } else {
      transformerRef.current.nodes([]);
    }

    layerRef.current.batchDraw();
  }, [selectedElementIds, page.elements, openTextEditorId, page.plainTextElementId]);

  const stopDictation = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    }
    dictationTargetRef.current = null;
    setIsDictating(false);
    setInterimDictation('');
  };

  useEffect(() => {
    if (!openTextEditorId) {
      stopDictation();
      setSpeechError(null);
      setCorrectionInfo(null);
      setAdvancedSuggestions([]);
      setIsAnalyzingSpelling(false);
      if (liveEditCommitTimerRef.current) {
        clearTimeout(liveEditCommitTimerRef.current);
        liveEditCommitTimerRef.current = null;
      }
      setLiveEdit(null);
      activeTextareaRef.current = null;
      return;
    }
    // Se abrió un editor — sembrar el estado local con el texto/tamaño
    // actuales del store, para que el textarea controlado parta del valor
    // correcto (incluye reaperturas del mismo bloque tras cerrarlo antes).
    const el = page.elements.find((e) => e.id === openTextEditorId);
    if (el) {
      const seedText = String(el.props?.text ?? '');
      const tp = getTextProps(el);
      const fullColumnWidthForEl = CONTENT_RIGHT - el.x - tp.indentRight;
      const seedSpans = sanitizeSpans(el.props?.spans, seedText.length);
      // Con spans (p.ej. un encabezado pegado dentro de un párrafo, ver
      // lib/richPaste.ts) hay que pasarle a la medición el mismo estilo
      // "base" que ve el resto del bloque -- si no, una porción en fuente
      // más grande que la base queda subestimada y el cuadro reabre más
      // chico de lo que el contenido real necesita (bug real reportado).
      const seedBaseStyle: BaseTextStyle = {
        bold: tp.bold, italic: tp.italic, underline: tp.underline, strikethrough: false, color: tp.fontColor,
        fontSize: tp.fontSize, fontFamily: tp.fontFamily,
        highlightColor: tp.highlightColor, headingStyle: tp.headingStyle, textAlign: tp.textAlign,
      };
      const seededSize = getAutoSizedTextBox(
        seedText, tp.fontSize, tp.fontFamily, tp.bold, tp.italic, tp.lineHeight,
        fullColumnWidthForEl, 28, fullColumnWidthForEl, PAGE_HEIGHT - el.y - 8, true,
        seedSpans, seedBaseStyle,
      );

      const seededHeight = Math.max(seededSize.height, el.height);
      setLiveEdit({
        id: el.id,
        text: seedText,
        width: fullColumnWidthForEl,
        height: seededHeight,
        spans: seedSpans,
      });
    }
    // No depende de `page.elements` a propósito: solo se resiembra al ABRIR
    // un editor, nunca por cambios externos mientras se escribe (eso
    // pisaría lo que el usuario está tecleando).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTextEditorId]);


  useEffect(() => {
    if (!pendingTextContinuation || pendingTextContinuation.pageNumber !== page.page_number) return;
    const el = page.elements.find((e) => e.id === pendingTextContinuation.elementId);
    clearPendingTextContinuation();
    if (!el) return;
    selectElement(el.id);
   
    pendingCaretToEndRef.current = el.id;
    setOpenTextEditorId(el.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTextContinuation]);

  // Coloca el cursor al FINAL del texto trasladado en cuanto `liveEdit`
  // realmente contenga ese texto (no antes) — el usuario seguía escribiendo
  // hacia adelante justo cuando el bloque se partió, así que el cursor debe
  // quedar donde él se quedó, no al inicio (lo que pasaría con el
  // autoFocus por defecto de un textarea recién montado).
  // useLayoutEffect (NO useEffect) a propósito: useEffect corre DESPUÉS de
  // que el navegador pinta, y para entonces el usuario (que sigue
  // escribiendo rápido, sin pausar) ya puede haber mandado la SIGUIENTE
  // tecla — el navegador la procesa contra el cursor por defecto del
  // autoFocus (posición 0) ANTES de que mi efecto llegara a corregirlo,
  // insertando esa tecla al INICIO en vez de al final (bug real
  // reportado: "se" apareciendo antes de "observando" en vez de después).
  // useLayoutEffect corre SÍNCRONO, en el mismo commit que monta el
  // textarea, antes de pintar y antes de que el navegador pueda procesar
  // cualquier tecla nueva — cierra esa ventana de carrera.
  useLayoutEffect(() => {
    const targetId = pendingCaretToEndRef.current;
    if (!targetId || !liveEdit || liveEdit.id !== targetId) return;
    const ta = activeTextareaRef.current;
    if (!ta) return;
    pendingCaretToEndRef.current = null;
    ta.focus({ preventScroll: true });
    const end = liveEdit.text.length;
    ta.setSelectionRange(end, end);
  }, [liveEdit]);

  useEffect(() => {
    if (!openTextEditorId) return undefined;
    registerActiveTextFormatHandler((patch) => {
      const fn = activeFormatBridgeRef.current;
      return fn ? fn(patch) : false;
    });
    registerActiveCaseHandler(() => {
      const fn = activeCaseBridgeRef.current;
      return fn ? fn() : false;
    });
    registerActiveRefInsertHandler((targetId) => {
      const fn = activeRefInsertBridgeRef.current;
      return fn ? fn(targetId) : false;
    });
    return () => {
      registerActiveTextFormatHandler(null);
      registerActiveCaseHandler(null);
      registerActiveRefInsertHandler(null);
    };
  }, [openTextEditorId]);

  useEffect(() => {
    if (!openTextEditorId) {
      setCaretRect(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const ta = activeTextareaRef.current;
      const ghost = ghostWrapRef.current;
      if (!ta || !ghost) {
        setCaretRect(null);
        return;
      }
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      if (start !== end) {
        setCaretRect(null);
        return;
      }
      try {
        let remaining = start;
        let targetNode: Node | null = null;
        let targetOffset = 0;
        
        const walk = (node: Node): boolean => {
          if (node.nodeType === Node.TEXT_NODE) {
            const len = node.textContent?.length ?? 0;
            if (remaining <= len) {
              targetNode = node;
              targetOffset = remaining;
              return true;
            }
            remaining -= len;
            return false;
          }
          for (const child of Array.from(node.childNodes)) {
            if (walk(child)) return true;
          }
          return false;
        };
        
        walk(ghost);
        
        if (!targetNode) {
          setCaretRect(null);
          return;
        }

        const range = document.createRange();
        range.setStart(targetNode, targetOffset);
        range.collapse(true);

        const hasGeometry = (candidate: DOMRect) =>
          candidate.width > 0 || candidate.height > 0 || candidate.x !== 0 || candidate.y !== 0;
        let rect: DOMRect = range.getBoundingClientRect();

        if (!hasGeometry(rect)) {
          const rects = range.getClientRects();
          if (rects.length > 0) rect = rects[0];
        }

        if (!hasGeometry(rect)) {
          const marker = document.createElement('span');
          marker.textContent = '\u200b';
          marker.style.display = 'inline-block';
          marker.style.width = '0';
          marker.style.height = '1em';
          marker.style.padding = '0';
          marker.style.margin = '0';
          range.insertNode(marker);
          rect = marker.getBoundingClientRect();
          marker.remove();
        }

        const ghostRect = ghost.getBoundingClientRect();
        
        const ghostStyles = window.getComputedStyle(ghost);
        const paddingLeft = parseFloat(ghostStyles.paddingLeft) || 0;
        const paddingTop = parseFloat(ghostStyles.paddingTop) || 0;

        const editingEl = page.elements.find((e) => e.id === openTextEditorId);
        const fallbackFontSize = editingEl
          ? getTextProps(editingEl).fontSize
          : DEFAULT_TEXT_PROPS.fontSize;

        setCaretRect({
          left: (rect.left - ghostRect.left) - paddingLeft,
          top: (rect.top - ghostRect.top) - paddingTop,
          height: rect.height || (fallbackFontSize * 1.2),
        });
      } catch (err) {
        console.warn("Error calculando el cursor:", err);
        setCaretRect(null);
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTextEditorId, selectionTick, liveEdit]);

  // Dispara el análisis ortográfico en vivo tras 900ms sin teclear (no en
  // cada tecla — LanguageTool es un backend real, no un chequeo local).
  // Se limpia solo al cerrar el editor o cambiar de bloque; una respuesta
  // que llega tarde para un bloque que ya se cerró/cambió simplemente no
  // se aplica (guardia por id abajo).
  useEffect(() => {
    if (!openTextEditorId || !liveEdit || liveEdit.id !== openTextEditorId) {
      setInlineSpellIssues([]);
      setSpellMenu(null);
      return;
    }
    const sourceText = textForSpellOrRewrite(liveEdit.text);
    if (!sourceText) {
      setInlineSpellIssues([]);
      return;
    }
    const targetId = liveEdit.id;
    const targetText = liveEdit.text;
    const timer = setTimeout(async () => {
      try {
        const data = await textCorrectAdvanced(sourceText, { language: 'es-PE', level: 'picky' });
        if (data?.error) return;
        // El bloque pudo cerrarse, cambiarse, o el texto pudo seguir
        // editándose mientras la petición viajaba — ver comentario de
        // liveEditSnapshotRef más arriba.
        const current = liveEditSnapshotRef.current;
        if (!current || current.id !== targetId || current.text !== targetText) return;
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
        setInlineSpellIssues(suggestions);
      } catch {
        // Silencioso: un fallo de red durante el tecleo en vivo no debe
        // interrumpir ni notificar al usuario, a diferencia del botón
        // manual "Corrección avanzada".
      }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTextEditorId, liveEdit?.id, liveEdit?.text]);

  useLayoutEffect(() => {
    if (!spellMenu) return;
    const el = spellMenuRef.current;
    if (!el) return;
    el.style.transform = '';
    const menuRect = el.getBoundingClientRect();
    const pageShell = document.querySelector<HTMLElement>(
      `.multipage-page-shell[data-page-number="${page.page_number}"]`,
    );
    const bounds = (pageShell ?? document.documentElement).getBoundingClientRect();
    const margin = 8;

    let translateX = 0;
    let translateY = 0;
    if (menuRect.right > bounds.right - margin) {
      // Voltea hacia la izquierda: el borde derecho del menú queda donde
      // antes estaba su borde izquierdo (el punto de clic).
      translateX = -menuRect.width;
    }
    if (menuRect.bottom > bounds.bottom - margin) {
      // Voltea hacia arriba, con aire extra para no tapar la palabra.
      translateY = -(menuRect.height + 24);
    }

    el.style.transform = `translate(${translateX}px, ${translateY}px)`;
    const flipped = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (flipped.right > bounds.right - margin) dx = (bounds.right - margin) - flipped.right;
    if (flipped.left + dx < bounds.left + margin) dx = (bounds.left + margin) - flipped.left;
    if (flipped.bottom > bounds.bottom - margin) dy = (bounds.bottom - margin) - flipped.bottom;
    if (flipped.top + dy < bounds.top + margin) dy = (bounds.top + margin) - flipped.top;
    if (dx || dy) {
      el.style.transform = `translate(${translateX + dx}px, ${translateY + dy}px)`;
    }
  }, [spellMenu, page.page_number]);

  // Aplica DESPUÉS de pintar (ver wrapAutoHeightRef arriba) dónde y cuánto
  // necesita el recuadro para envolver el texto REALMENTE dibujado con
  // ajuste alrededor de un objeto — incluye Y, no solo el alto: si todo el
  // texto terminó cayendo DESPUÉS del objeto (nada cupo antes), el
  // recuadro entero se reubica ahí, para poder hacer clic justo sobre el
  // texto y moverlo/agrandarlo como cualquier globo normal. A diferencia
  // del resto del empuje automático (que solo CRECE, nunca encoge/mueve
  // algo que el usuario puso a mano), acá SÍ se corrige libremente — pero
  // solo para bloques con ajuste de texto activo AHORA MISMO (los únicos
  // que entran en este mapa; uno sin ajuste nunca se toca), porque esta
  // posición/alto no son una medida manual del usuario, son un valor que
  // el propio sistema de ajuste ya recalcula en cada render — mantenerlo
  // exacto es corregir, no "mover algo por su cuenta". Solo si la
  // diferencia es real (>0.5px, margen para ruido de punto flotante). Usa
  // `relocateWrapAdjustedText` (no `updateElement` a secas): el cálculo de
  // arriba es puramente geométrico, sin ninguna noción de dónde termina la
  // página — si el objeto crece tanto que el texto ajustado ya no entra en
  // lo que resta de la hoja, esa acción lo pasa entera a la siguiente en
  // vez de dejarlo superpuesto al pie de página (bug real reportado).
  useEffect(() => {
    wrapAutoHeightRef.current.forEach(({ y, height }, elementId) => {
      const current = page.elements.find((el) => el.id === elementId);
      if (!current || current.type !== 'text') return;
      if (Math.abs(y - current.y) > 0.5 || Math.abs(height - current.height) > 0.5) {
        relocateWrapAdjustedText(page.page_number, elementId, y, height);
      }
    });
  }, [page.elements, page.page_number, relocateWrapAdjustedText]);

  useEffect(() => {
    return () => {
      stopDictation();
    };
  }, []);

  useEffect(() => {
    if (!selectedElementId) {
      setCanvasTableEditId(null);
      setCanvasVideoInteractId(null);
      return;
    }
    if (canvasTableEditId && selectedElementId !== canvasTableEditId) {
      setCanvasTableEditId(null);
    }
    if (canvasVideoInteractId && selectedElementId !== canvasVideoInteractId) {
      setCanvasVideoInteractId(null);
    }
  }, [selectedElementId, canvasTableEditId, canvasVideoInteractId]);

  useEffect(() => {
    if (!canvasTableEditId && !canvasVideoInteractId) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCanvasTableEditId(null);
        setCanvasVideoInteractId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasTableEditId, canvasVideoInteractId]);

  useEffect(() => {
    const clearDrag = () => {
      dragInProgressRef.current = false;
      try {
        const stage = stageRef.current;
        if (stage && typeof stage.stopDrag === 'function') {
          stage.stopDrag();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  // Copiar de objetos del lienzo (Ctrl/Cmd+C) — pedido explícito
  // ("seleccionar un objeto, copiar y pegarlo en el mismo lienzo") — y
  // Ctrl/Cmd+A para seleccionar TODO el contenido del DOCUMENTO COMPLETO
  // (todas las páginas, pedido explícito 2026-09-09: "extenderlo a todo el
  // documento" -- antes solo abarcaba la página actual). Solo la página
  // "actual" (selectedPage) atiende el evento de teclado, para no
  // copiar/seleccionar N veces (una por cada PageCanvas montado) -- pero la
  // selección/copia en sí ya no está acotada a esta página. Se ignora si el
  // foco está en un campo de texto/celda (ahí Ctrl+C/Ctrl+A son la
  // copia/selección nativa de TEXTO, no del objeto).
  // Copiar ahora ADEMÁS escribe HTML real al portapapeles del SISTEMA
  // (navigator.clipboard.write) -- pedido explícito: poder pegar en Word o
  // Google Docs, con tablas e imágenes, no solo dentro de este editor (ver
  // lib/elementsClipboard.ts). El pegado interno (Ctrl+V dentro de la app)
  // sigue funcionando aunque esa escritura falle (permiso denegado,
  // navegador sin soporte): el portapapeles INTERNO (clipboardElements) se
  // actualiza siempre, aparte -- por eso se lee de vuelta del store justo
  // después de copySelection en vez de recalcular los grupos acá (una sola
  // fuente de verdad para el agrupado por página).
  // El PEGADO (Ctrl/Cmd+V) se maneja aparte, en el efecto de más abajo
  // (onSystemPaste) que escucha el evento nativo `paste` en vez de
  // `keydown` — a diferencia de copiar, pegar necesita poder leer el
  // portapapeles real del sistema (imagen/tabla/marcador interno) antes de
  // decidir qué crea.
  useEffect(() => {
    if (page.page_number !== selectedPage) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }
      const key = event.key.toLowerCase();

      if (key === 'a') {
        event.preventDefault();
        selectAllDocument();
        return;
      }

      if (key !== 'c') return;
      const ids = selectedElementIds.length > 0 ? selectedElementIds : (selectedElementId ? [selectedElementId] : []);
      if (!ids.length) return;
      event.preventDefault();
      copySelection(ids);
      const groups = useEditorStore.getState().clipboardElements;
      if (!groups || !groups.length) return;
      try {
        const { html, text } = serializeElementsForClipboard(groups);
        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          void navigator.clipboard
            .write([
              new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
              }),
            ])
            // Permiso denegado o navegador sin soporte -- el pegado interno
            // (dentro de este editor) igual funciona vía copySelection.
            .catch(() => { /* no-op */ });
        }
      } catch {
        /* nunca romper el copiado interno por un fallo al escribir al portapapeles del sistema */
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page.page_number, selectedPage, selectedElementId, selectedElementIds, copySelection, selectAllDocument]);

  const processPasteBlocks = async (pasteBlocks: PasteBlock[]): Promise<void> => {
    // Estilo base para el texto pegado en el lienzo vacío (sin bloque
    // existente del que heredar formato) -- mismo criterio que un bloque
    // de texto nuevo cualquiera (14px/Inter/1.35).
    const pasteTextBaseStyle: BaseTextStyle = {
      bold: false, italic: false, underline: false, strikethrough: false, color: '#1a1a1a',
      fontSize: 14, fontFamily: 'Inter', highlightColor: 'transparent', headingStyle: '', textAlign: 'left',
    };
    const fullColumnWidth = CONTENT_RIGHT - CONTENT_LEFT;
    const waitForRender = () => new Promise<void>((resolve) => { setTimeout(resolve, 30); });
    const insertTextWithPagination = async (fullText: string, fullSpans: TextStyleSpan[], paragraphFormat: ParagraphFormat = {}) => {
      let remainingText = fullText;
      let remainingSpans = fullSpans;
      const MAX_CHUNKS = 500; // salvaguarda -- nunca páginas sin fin
      // Id compartido por TODOS los fragmentos que produzca esta llamada
      // (un solo párrafo pegado puede terminar partido en 2+ páginas) --
      // pedido explícito 2026-09-09: "que siga perteneciendo al mismo
      // bloque original... si lo muevo, se mueve todo en conjunto".
      // `updateElement` (useEditorStore.ts) usa este id para desplazar a
      // los demás fragmentos por el mismo delta al mover uno. Si al
      // final resulta en un solo fragmento (no hubo partición), queda
      // sin hermanos y el enlace no tiene ningún efecto -- inofensivo.
      const linkedGroupId = `linked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      for (let i = 0; i < MAX_CHUNKS; i += 1) {
        const state = useEditorStore.getState();
        const pageObj = state.doc.pages.find((p) => p.page_number === state.selectedPage);
        const contentEls = (pageObj?.elements || []).filter((e) => e.type !== 'header' && e.type !== 'footer');
        const maxBottom = contentEls.length ? Math.max(...contentEls.map((e) => e.y + e.height)) : CONTENT_TOP - 12;
        const anchorY = Math.max(CONTENT_TOP, maxBottom + 12);
        const availableHeight = CONTENT_BOTTOM - anchorY;
        // Techo GENEROSO acá a propósito -- bug real encontrado en vivo
        // 2026-09-11 con un documento real ("su recuadro del objeto solo
        // abarca un poquito pero el texto sigue fluyendo hacia abajo"):
        // esta primera medición es para saber cuánto alto NECESITA el
        // texto de verdad, ANTES de decidir dónde ponerlo -- pasarle como
        // techo `PAGE_HEIGHT - anchorY - 8` (lo que queda de ESTA página,
        // que cerca del fondo puede ser bien chico) hacía que
        // `getAutoSizedTextBox` RECORTARA la medición a ese resto en vez
        // de devolver el alto real -- ese número chico y artificial
        // después SÍ pasaba la comprobación de "¿entra en una página
        // vacía?" (`fullPageAvailable` de abajo, cualquier número chico
        // entra ahí), así que el bloque se insertaba COMPLETO con un alto
        // muy por debajo del que en verdad necesitaba: el cuadro quedaba
        // chico y el texto seguía fluyendo visualmente por debajo, sin
        // caja. Un techo grande y fijo (nunca depende de dónde va a
        // terminar cayendo el bloque) deja que las comprobaciones de más
        // abajo (`availableHeight`/`fullPageAvailable`) decidan bien con
        // el alto REAL, no con uno ya recortado de antemano.
        const realSize = getAutoSizedTextBox(
          remainingText, 14, 'Inter', false, false, 1.35, fullColumnWidth, 28, fullColumnWidth,
          50000, false, remainingSpans, pasteTextBaseStyle,
        );
        // Deselecciona ANTES de cada inserción: `addElement` ancla el
        // bloque nuevo a la posición del elemento SELECCIONADO (estilo
        // Word, "insertar en el cursor") si hay uno -- y como cada
        // `addElement` deja seleccionado lo que acaba de crear, sin este
        // deselect cada bloque de este pegado múltiple se ancla al
        // ANTERIOR en vez de apilarse debajo (bug real: tabla/imagen
        // quedaban todas superpuestas en la misma posición). Sin
        // selección, `addElement` cae solo a su apilado normal debajo de
        // todo el contenido existente.
        selectElement(undefined);
        const withSafetyMargin = (h: number) => Math.ceil(h * 1.15) + 24;
        const paddedRealHeight = withSafetyMargin(realSize.height);
        if (paddedRealHeight <= availableHeight) {
          addElement('text', {
            props: { text: remainingText, spans: remainingSpans, fontSize: 14, fontFamily: 'Inter', fontColor: '#1a1a1a', lineHeight: 1.35, ...paragraphFormat },
            width: fullColumnWidth, height: paddedRealHeight, linkedGroupId,
          });
          await waitForRender();
          return;
        }
        // No cabe en lo que queda de ESTA página -- pedido explícito
        // 2026-09-09: si el bloque completo SÍ entraría entero en una
        // página nueva (vacía), es mejor pasarlo entero a la siguiente
        // que partirlo acá: partir cerca del borde de la hoja producía
        // un pedacito chico en esta página + el resto en la otra, que
        // es justo el "descuadre" reportado (a veces con el resto de la
        // página nueva empezando en una posición rara). Solo tiene
        // sentido partir cuando ni siquiera una página entera y vacía
        // alcanzaría. `addElement` ya sabe saltar de página sola
        // cuando lo que le pasamos no entra en el flujo actual -- no
        // hace falta forzarlo a mano, solo NO intentar partirlo primero.
        const fullPageAvailable = CONTENT_BOTTOM - CONTENT_TOP;
        if (paddedRealHeight <= fullPageAvailable) {
          addElement('text', {
            props: { text: remainingText, spans: remainingSpans, fontSize: 14, fontFamily: 'Inter', fontColor: '#1a1a1a', lineHeight: 1.35, ...paragraphFormat },
            width: fullColumnWidth, height: paddedRealHeight, linkedGroupId,
          });
          await waitForRender();
          return;
        }
        // Reserva el colchón de seguridad ANTES de pedir el trozo que
        // "cabe" -- bug real que encontré probando esto: pedía a
        // splitTextForHeight un trozo que llenara TODO availableHeight
        // y RECIÉN DESPUÉS le sumaba el colchón (+15%/24px) al alto ya
        // ajustado al límite -- ese colchón lo empujaba otra vez POR
        // ENCIMA del límite que se suponía debía respetar (un trozo que
        // ya llenaba una página entera terminaba con un alto MAYOR a lo
        // que cabía en cualquier página, dejando availableHeight
        // NEGATIVO en la iteración siguiente -- ahí es de donde salía
        // el desapareamiento). Pidiendo un presupuesto ya achicado para
        // el colchón, el resultado final (ya con colchón) sí respeta
        // availableHeight de verdad.
        const marginBudget = (budget: number) => Math.max(40, (budget - 24) / 1.15);
        const splitBudget = marginBudget(availableHeight);
        const split = splitTextForHeight(
          remainingText, 14, 'Inter', false, false, 1.35, fullColumnWidth, splitBudget, remainingSpans, pasteTextBaseStyle,
        );
        if (!split) {
          // No se pudo partir (p.ej. availableHeight demasiado chico) --
          // se deja el trozo completo, que addElement mande a una
          // página nueva por su cuenta antes que perder contenido.
          addElement('text', {
            props: { text: remainingText, spans: remainingSpans, fontSize: 14, fontFamily: 'Inter', fontColor: '#1a1a1a', lineHeight: 1.35, ...paragraphFormat },
            width: fullColumnWidth, height: paddedRealHeight, linkedGroupId,
          });
          await waitForRender();
          return;
        }
        const fittingSpans = reindexSpans(remainingSpans, 0, split.fittingEnd);
        const fittingSize = getAutoSizedTextBox(
          split.fittingText, 14, 'Inter', false, false, 1.35, fullColumnWidth, 28, fullColumnWidth,
          splitBudget, true, fittingSpans, pasteTextBaseStyle,
        );
        addElement('text', {
          props: { text: split.fittingText, spans: fittingSpans, fontSize: 14, fontFamily: 'Inter', fontColor: '#1a1a1a', lineHeight: 1.35, ...paragraphFormat },
          width: fullColumnWidth, height: withSafetyMargin(fittingSize.height), linkedGroupId,
        });
        await waitForRender();
        remainingSpans = reindexSpans(remainingSpans, split.overflowStart, remainingText.length);
        remainingText = split.overflowText;
      }
    };
    for (const { block, caption } of pairCaptionsWithMedia(pasteBlocks)) {
      if (block.kind === 'text') {
        if (!block.text.trim()) continue;
        // Solo incluye las claves que el HTML de origen SÍ traía --
        // esparcir `{ textAlign: undefined, ... }` en `props` pisaría el
        // default sensato ('left', etc.) con `undefined` en vez de dejarlo
        // como estaba.
        const paragraphFormat: ParagraphFormat = {};
        if (block.textAlign !== undefined) paragraphFormat.textAlign = block.textAlign;
        if (block.indentLeft !== undefined) paragraphFormat.indentLeft = block.indentLeft;
        if (block.specialIndent !== undefined) paragraphFormat.specialIndent = block.specialIndent;
        if (block.specialIndentBy !== undefined) paragraphFormat.specialIndentBy = block.specialIndentBy;
        await insertTextWithPagination(block.text, block.spans, paragraphFormat);
      } else if (block.kind === 'table') {
        const escapedRows = block.rows.map((row) => row.map((cell) => escapeHtml(cell)));
        const toStringGrid = (g: (string | undefined)[][]): string[][] => g.map((row) => row.map((v) => v ?? ''));
        selectElement(undefined); // ver nota de deselección en insertTextWithPagination
        // Autoajuste ADAPTATIVO ya calculado ANTES de insertar (no solo al
        // apretar el botón manual "Autoajustar") -- pedido explícito
        // 2026-09-10: una tabla ancha importada de un .docx (o pegada de
        // Word/Excel) no debe depender de que el usuario se acuerde de
        // ajustarla a mano, se salía de CONTENT_RIGHT sin nada que lo
        // evitara. El padding YA NO queda fijo en 10 ("eso no es una
        // regla"): `computeAdaptiveTableFit` prueba de 10 a 3px, usa el
        // mayor con el que las columnas quepan sin apretarse, y solo aprieta
        // proporcionalmente si ni 3px alcanza. El tamaño de fuente se toma
        // del documento de origen si se detectó alguno (color/tamaño real
        // de Word, o el marcador de nuestro import de .docx -- ver
        // `detectCellFontSizePx` en tableClipboard.ts), con 14 como default
        // solo si la tabla no trae ninguna señal.
        const colCount = escapedRows[0]?.length || 0;
        const detectedFontSize = block.fontSize && Number.isFinite(block.fontSize) ? block.fontSize : 14;
        const adaptiveFit = computeAdaptiveTableFit(escapedRows, colCount, {
          fontSize: detectedFontSize, maxTableWidth: fullColumnWidth,
        });
        addElement('table', {
          // El ANCHO DEL ELEMENTO (no solo colWidths) también debe reflejar
          // el autoajuste -- si se deja en el default (`Math.min(420, contentW)`,
          // ver createElement en useEditorStore.ts), una tabla cuyas
          // columnas ajustadas suman más de 420px quedaría con colWidths
          // correctos pero un contenedor más angosto que ellos, el mismo
          // "se rompe" que se está corrigiendo.
          ...(adaptiveFit ? { width: adaptiveFit.colWidths.reduce((sum, w) => sum + w, 0) } : {}),
          props: {
            rows: escapedRows,
            mergedCells: block.merges,
            cellBackgrounds: toStringGrid(block.backgrounds),
            cellAligns: toStringGrid(block.aligns),
            fontSize: detectedFontSize,
            // Color de texto del ENCABEZADO detectado en la tabla de origen
            // -- pedido explícito 2026-09-11 ("no esta trayendo bien el
            // color del header que lo deja en negro el texto"). La fila de
            // encabezado SÍ es un solo color representativo válido (todas
            // sus celdas suelen compartir el mismo, p.ej. blanco sobre un
            // fondo oscuro), así que una sola medida global para toda la
            // fila tiene sentido acá.
            ...(block.headerTextColor ? { headerTextColor: block.headerTextColor } : {}),
            // Color de texto POR CELDA del cuerpo -- bug real reportado en
            // vivo 2026-09-11: una tabla con distintos colores según el
            // valor de cada celda (p.ej. una columna "Estado" con verde/
            // ámbar/azul según CUMPLE/PARCIAL/POR ACLARAR) se importaba con
            // el color de la PRIMERA celda coloreada aplicado como
            // `textColor` GLOBAL a las demás -- pintaba de ese único color
            // hasta columnas que nunca tuvieron color propio en el
            // documento. A diferencia del encabezado, el CUERPO no admite
            // "una sola medida representativa": se usa la grilla por celda
            // (ver `cellTextColors` en tableClipboard.ts) y NO se toca el
            // `textColor` global de la tabla -- las celdas sin color propio
            // simplemente heredan el default normal (negro), en vez de
            // heredar el de otra celda cualquiera.
            cellTextColors: toStringGrid(block.cellTextColors || []),
            ...(adaptiveFit ? { colWidths: adaptiveFit.colWidths, cellPadding: adaptiveFit.cellPadding } : {}),
            // Leyenda ("Tabla N. ...") emparejada por `pairCaptionsWithMedia`
            // -- pedido explícito 2026-09-11: va en el campo dedicado para
            // eso, no como un párrafo suelto que además arrastraba su
            // alineación centrada al contenido siguiente.
            ...(caption ? { caption } : {}),
          },
        });
        // Espera a que TableBlock mida su alto REAL (filas reales,
        // no el default de 200px) y lo reporte -- ver nota de
        // waitForRender más arriba. Sin esto, el siguiente bloque se
        // posiciona antes de que la tabla termine de "crecer" a su
        // alto verdadero, y la tabla acaba creciendo ENCIMA de él.
        await waitForRender();
      } else if (block.kind === 'image') {
        const resolvedSrc = block.src.startsWith('data:image/')
          ? block.src
          : /^https?:\/\//i.test(block.src)
            ? await fetchImageAsDataUrl(block.src)
            : null;
        if (resolvedSrc) {
          selectElement(undefined); // ver nota de deselección en insertTextWithPagination
          const size = await resolveImagePasteSize(resolvedSrc, block.width, block.height, fullColumnWidth, CONTENT_BOTTOM - CONTENT_TOP);
          // Leyenda ("Figura N. ...") emparejada por `pairCaptionsWithMedia`
          // -- pedido explícito 2026-09-11, va al campo dedicado de
          // ImageBlock.tsx (ya la renderizaba, nunca la recibía del import).
          // +30 de alto extra cuando hay leyenda: mismo fijo que
          // ImageBlock.tsx ya asume para su propio MediaCaption (a
          // diferencia de una tabla, una imagen no tiene medición real de
          // DOM que ajuste el alto del bloque sola) -- sin este ajuste el
          // cuadro del elemento quedaría más chico que lo que en verdad se
          // dibuja, el mismo síntoma que el bug de texto que no crecía con
          // su contenido.
          const captionExtra = caption ? 30 : 0;
          addElement('image', {
            ...(size ? { src: resolvedSrc, width: size.width, height: size.height + captionExtra } : { src: resolvedSrc }),
            ...(caption ? { props: { caption } } : {}),
          });
          await waitForRender();
        }
      } else if (block.kind === 'shape') {
        // Línea horizontal de un .docx importado (borde de párrafo `w:pBdr`,
        // ver lib/docxPageBreaks.ts::markHorizontalRuleParagraphs +
        // lib/richPaste.ts) -- se traduce al mismo bloque de forma tipo
        // línea que ya existe en la barra de inserción, a todo el ancho de
        // columna, en vez de perderse o colarse como texto.
        selectElement(undefined); // ver nota de deselección en insertTextWithPagination
        addElement('shape', {
          width: fullColumnWidth,
          height: 20,
          props: { shapeType: 'line', stroke: '#94a3b8', strokeWidth: 1.5 },
        });
        await waitForRender();
      }
    }
  };

  // Importación de PDF+OCR con posición REAL (pedido explícito: "no pierdas
  // las ubicaciones, mapas, fotos, tablas, fondos de hoja... documentos con
  // secciones de 2 o más columnas"). A diferencia de `processPasteBlocks`
  // (auto-flujo de una sola columna, pensado para .docx/portapapeles que
  // NUNCA traen posición real de origen), acá cada bloque ya trae
  // `geometry` (x/y/width/height en px, calculados en
  // pdfOcrImport.ts::bboxToGeometry desde el bbox real del PDF, escalado al
  // tamaño de hoja del editor) -- se coloca ahí tal cual con `addElement`
  // (que YA soporta posición explícita, ver `hasExplicitPosition` en
  // useEditorStore.ts, solo que ningún importador lo usaba hasta ahora).
  // Reproduce layout multi-columna GRATIS (cada párrafo cae en su columna
  // real, no hace falta modelar "secciones" -- el editor no tiene ese
  // concepto, ver investigación previa) y posición relativa imagen/texto.
  // Un `{kind:'page-break'}` por cada salto de página de ORIGEN fuerza una
  // hoja nueva del lienzo por cada página del PDF (fidelidad de paginación
  // 1:1, en vez de que el auto-flujo decida cuántas hojas hacen falta).
  const processPositionedBlocks = async (pasteBlocks: PasteBlock[]): Promise<void> => {
    const pasteTextBaseStyle: BaseTextStyle = {
      bold: false, italic: false, underline: false, strikethrough: false, color: '#1a1a1a',
      fontSize: 14, fontFamily: 'Inter', highlightColor: 'transparent', headingStyle: '', textAlign: 'left',
    };
    const waitForRender = () => new Promise<void>((resolve) => { setTimeout(resolve, 30); });
    // Ceder el hilo cada tantos bloques (no en cada uno -- a diferencia de
    // `processPasteBlocks`, ningún bloque acá depende de medir el resultado
    // RENDERIZADO del anterior, cada uno trae su propia posición absoluta
    // independiente, así que esperar 30ms después de CADA `addElement`
    // volvía la importación de un PDF de ~1300 párrafos en varios minutos
    // sin necesidad real -- probado en vivo). Solo se cede after cada
    // página nueva (`addPage`) y cada tantos bloques dentro de la misma
    // página, lo justo para que el navegador no se sienta trabado.
    let opsSinceYield = 0;
    const maybeYield = async () => {
      opsSinceYield += 1;
      if (opsSinceYield >= 40) {
        opsSinceYield = 0;
        await waitForRender();
      }
    };
    // El bbox del PDF es relativo a la esquina física de SU hoja (0,0 =
    // borde superior izquierdo real, incluido el margen) -- el lienzo del
    // editor reserva además una franja fija de encabezado/pie (ADR-046,
    // `HEADER_HEIGHT`/`FOOTER_HEIGHT`, fuera del área de contenido) que el
    // PDF de origen no tiene. Se resta el margen ya aplicado
    // (`marginLeft`/`marginTop`, puntos->px, ver App.tsx::handleImportPdfOcr)
    // y se suma `CONTENT_LEFT`/`CONTENT_TOP` (que YA incluyen esa franja) --
    // así el primer bloque de contenido cae justo debajo del encabezado en
    // vez de encima, sin tocar el bbox original en sí.
    const marginLeftPx = marginLeft ?? 0;
    const marginTopPx = marginTop ?? 0;
    const toEditorX = (x: number) => x - marginLeftPx + CONTENT_LEFT;
    const toEditorY = (y: number) => y - marginTopPx + CONTENT_TOP;
    const MIN_TEXT_WIDTH = 24;
    const placedBoxesByPage = new Map<number, { x: number; y: number; width: number; height: number }[]>();
    const overlapsX = (a: { x: number; width: number }, b: { x: number; width: number }) => {
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      return overlap > Math.min(a.width, b.width) * 0.25;
    };
    const reserveBox = (pageNumber: number, box: { x: number; y: number; width: number; height: number }) => {
      const boxes = placedBoxesByPage.get(pageNumber) || [];
      let y = box.y;
      let guard = 0;
      while (guard < 200) {
        const hit = boxes.find((other) => overlapsX(box, other) && y < other.y + other.height + 2 && y + box.height > other.y + 2);
        if (!hit) break;
        y = hit.y + hit.height + 2;
        guard += 1;
      }
      const resolved = { ...box, y };
      boxes.push(resolved);
      boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      placedBoxesByPage.set(pageNumber, boxes);
      return resolved;
    };
    let targetPageNumber = selectedPage;

    for (const block of pasteBlocks) {
      if (block.kind === 'page-break') {
        targetPageNumber += 1;
        await maybeYield();
        continue;
      }
      if (block.kind === 'text' && block.geometry) {
        if (!block.text.trim()) continue;
        const width = Math.max(MIN_TEXT_WIDTH, block.geometry.width);
        const targetHeight = Math.max(12, block.geometry.height);
        const importedFontSize = dominantImportedFontSize(block.spans, 12);
        const fontFamily = block.spans.find((span) => span.fontFamily)?.fontFamily || 'Inter';
        const lineHeight = 1.18;
        let fittedFontSize = importedFontSize;
        let fittedSpans = block.spans;
        let size = getAutoSizedTextBox(
          block.text, fittedFontSize, fontFamily, false, false, lineHeight, width, 12, width, 50000, false, fittedSpans,
          { ...pasteTextBaseStyle, fontSize: fittedFontSize, fontFamily },
        );
        while (size.height > targetHeight + 3 && fittedFontSize > 7) {
          fittedFontSize -= 1;
          const ratio = fittedFontSize / importedFontSize;
          fittedSpans = scaleImportedSpans(block.spans, ratio);
          size = getAutoSizedTextBox(
            block.text, fittedFontSize, fontFamily, false, false, lineHeight, width, 12, width, 50000, false, fittedSpans,
            { ...pasteTextBaseStyle, fontSize: fittedFontSize, fontFamily },
          );
        }
        const height = Math.max(12, Math.min(Math.max(size.height, targetHeight), targetHeight + 3));
        const box = reserveBox(targetPageNumber, { x: toEditorX(block.geometry.x), y: toEditorY(block.geometry.y), width, height });
        addElement('text', {
          pageNumber: targetPageNumber,
          x: box.x, y: box.y,
          width: box.width, height: box.height,
          props: {
            text: block.text,
            spans: fittedSpans,
            fontSize: fittedFontSize,
            fontFamily,
            fontColor: '#1a1a1a',
            lineHeight,
          },
        });
        await maybeYield();
      } else if (block.kind === 'table' && block.geometry) {
        const escapedRows = block.rows.map((row) => row.map((cell) => escapeHtml(cell)));
        const toStringGrid = (g: (string | undefined)[][]): string[][] => g.map((row) => row.map((v) => v ?? ''));
        const colCount = escapedRows[0]?.length || 0;
        const width = Math.max(40, block.geometry.width);
        const adaptiveFit = computeAdaptiveTableFit(escapedRows, colCount, { fontSize: 14, maxTableWidth: width });
        const tableWidth = adaptiveFit ? adaptiveFit.colWidths.reduce((sum, w) => sum + w, 0) : width;
        const tableBox = reserveBox(targetPageNumber, { x: toEditorX(block.geometry.x), y: toEditorY(block.geometry.y), width: tableWidth, height: Math.max(20, block.geometry.height) });
        addElement('table', {
          pageNumber: targetPageNumber,
          x: tableBox.x, y: tableBox.y,
          width: tableBox.width,
          props: {
            rows: escapedRows,
            mergedCells: block.merges,
            cellBackgrounds: toStringGrid(block.backgrounds),
            cellAligns: toStringGrid(block.aligns),
            fontSize: 14,
            cellTextColors: toStringGrid(block.cellTextColors || []),
            ...(adaptiveFit ? { colWidths: adaptiveFit.colWidths, cellPadding: adaptiveFit.cellPadding } : {}),
          },
        });
        // La tabla SÍ necesita este respiro (no el yield liviano de arriba):
        // TableBlock mide su alto real recién después de renderizar (mismo
        // motivo que processPasteBlocks) -- sin esto, su `height` en el
        // store se queda en el default chico, aunque acá ningún bloque
        // siguiente dependa de esa medición para su PROPIA posición.
        await waitForRender();
      } else if (block.kind === 'image' && block.geometry) {
        const resolvedSrc = block.src.startsWith('data:image/') ? block.src : null;
        if (!resolvedSrc) continue;
        const isBackground = !!block.geometry.isBackground;
        const imageBox = isBackground
          ? { x: block.geometry.x, y: block.geometry.y, width: block.geometry.width, height: block.geometry.height }
          : reserveBox(targetPageNumber, { x: toEditorX(block.geometry.x), y: toEditorY(block.geometry.y), width: block.geometry.width, height: block.geometry.height });
        addElement('image', {
          // El fondo de página completa NO se corre por el margen (ocupa la
          // hoja entera de borde a borde, ver bboxToGeometry) -- restarle
          // marginLeft/Top acá lo desplazaría lejos de 0,0.
          pageNumber: targetPageNumber,
          x: imageBox.x,
          y: imageBox.y,
          width: imageBox.width,
          height: imageBox.height,
          src: resolvedSrc,
          // Detrás de todo lo demás en esta página -- se inserta ANTES que
          // el resto de bloques de su misma página (orden de lectura real
          // del backend), así que ya cae primero en el z-order; zIndex 0
          // explícito lo asegura aunque el orden de inserción cambiara.
          ...(isBackground ? { zIndex: 0 } : {}),
        });
        await maybeYield();
      }
    }
  };

  // Importación de un .docx (ribbon Datos > Importación) -- App.tsx convierte
  // el archivo a HTML con mammoth.js y lo deja en
  // useEditorStore::pendingImportBlocks ya parseado a bloques (mismo tipo
  // `PasteBlock` del pegado). Solo la página SELECCIONADA lo procesa (mismo
  // criterio que el `useEffect` de `onSystemPaste` debajo) y lo limpia de
  // inmediato para no procesarlo dos veces.
  //
  // PDF+OCR (App.tsx::handleImportPdfOcr) es la ÚNICA fuente que deja
  // bloques con `geometry`/`page-break` (ver pdfOcrImport.ts) -- alcanza con
  // mirar el primero para elegir el camino de posición real en vez del
  // auto-flujo de una columna (ver processPositionedBlocks arriba).
  useEffect(() => {
    if (page.page_number !== selectedPage) return;
    if (!pendingImportBlocks || pendingImportBlocks.length === 0) return;
    const blocksToImport = pendingImportBlocks;
    setPendingImportBlocks(null);
    const isPositioned = blocksToImport.some(
      (b) => b.kind === 'page-break' || (b.kind !== 'shape' && 'geometry' in b && b.geometry),
    );
    void (isPositioned ? processPositionedBlocks(blocksToImport) : processPasteBlocks(blocksToImport));
  }, [pendingImportBlocks, page.page_number, selectedPage]);

  // Pegado desde el portapapeles del SISTEMA (Ctrl/Cmd+V) cuando NO hay un
  // campo de texto o una celda de tabla enfocados (esos casos ya tienen su
  // propio manejo de `paste`, más abajo en este archivo y en
  // TableBlock.tsx). Pedido explícito: (1) copiar una imagen de un Word o
  // Google Docs (clic en la imagen + Ctrl+C) y pegarla directo en el
  // lienzo, sin pasar por el modal de "Insertar imagen"; (2) pegar una
  // selección de celdas de Excel/Sheets SIN tener que crear una tabla antes
  // -- hasta ahora el pegado inteligente de tablas (SCRUM-30, ver
  // parseHtmlClipboardTable) solo funcionaba pegando DENTRO de una celda ya
  // existente. Si el portapapeles no trae ni imagen ni datos con forma de
  // tabla, cae al pegado interno de objetos de siempre (pasteElement) --
  // mismo comportamiento que antes para "copiar un objeto del lienzo y
  // pegarlo". TODO lo que se pega (imagen, tabla nueva, u objeto interno)
  // se ancla en `lastCanvasClickRef` -- el último punto donde el usuario
  // hizo clic en ESTE lienzo -- en vez del auto-acomodo genérico, pedido
  // explícito ("pegar donde esté el cursor/último clic, sin excepción").
  useEffect(() => {
    if (page.page_number !== selectedPage) return undefined;
    const onSystemPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }
      const cd = event.clipboardData;
      const html = cd?.getData('text/html') ?? '';
      const dropPoint = lastCanvasClickRef.current;
      const clampToPage = (x: number, y: number, width: number, height: number) => ({
        x: Math.min(Math.max(x, 0), Math.max(0, PAGE_WIDTH - width)),
        y: Math.min(Math.max(y, 0), Math.max(0, PAGE_HEIGHT - height)),
      });
      // Reancla al último clic solo lo que cayó en ESTA página (el grupo de
      // offset 0) -- lo que haya generado páginas NUEVAS (offset > 0, ver
      // pasteSelection) no tiene sentido reanclarlo a un clic hecho en una
      // página distinta, conserva su propia disposición relativa. Comparte
      // esta lógica el pegado por marcador interno (0) y el respaldo cuando
      // el portapapeles del sistema no traía nada útil (más abajo).
      const repositionPastedGroupToClick = (pastedIds: string[]) => {
        if (!pastedIds.length || !dropPoint) return;
        const freshPage = useEditorStore.getState().doc.pages.find((p) => p.page_number === page.page_number);
        const pastedEls = pastedIds
          .map((id) => freshPage?.elements.find((e) => e.id === id))
          .filter((e): e is ReportElement => Boolean(e));
        if (!pastedEls.length) return;
        const curMinX = Math.min(...pastedEls.map((e) => e.x));
        const curMinY = Math.min(...pastedEls.map((e) => e.y));
        pastedEls.forEach((el) => {
          const next = clampToPage(dropPoint.x + (el.x - curMinX), dropPoint.y + (el.y - curMinY), el.width, el.height);
          updateElement(page.page_number, el.id, next);
        });
      };

      // 0) Marcador interno propio (Ctrl+A/Ctrl+C de VARIOS elementos de
      // ESTA app, ver lib/elementsClipboard.ts) -- se revisa ANTES que
      // cualquier otro detector: el mismo copiado también escribió HTML
      // visual real (tablas/imágenes) para que Word/Docs lo entiendan, y sin
      // esta comprobación el detector de tabla de más abajo
      // (parseHtmlClipboardTable) tomaría solo la PRIMERA tabla de ese HTML
      // como si fuera una tabla suelta nueva, descartando el resto de lo
      // copiado (texto, imágenes, otras tablas).
      const internalPayload = html ? extractInternalElementsFromHtml(html) : null;
      if (internalPayload && internalPayload.groups.length) {
        event.preventDefault();
        // ADR-051 (actualización 2026-09-11): un sensor/KPI/gráfico en vivo
        // solo se reconstruye "vivo" si quien pega es quien copió -- de otro
        // autor, se degrada a nota de texto (mismo trato que Word/Excel/
        // PowerPoint, ver stripLiveBindingForCrossUserPaste). El bloqueo por
        // informe firmado/archivado ya lo cubre pasteSelection (documentLocked).
        const currentUserId = getSession()?.userId ?? null;
        const isSameAuthor = internalPayload.ownerUserId !== null && internalPayload.ownerUserId === currentUserId;
        const groupsToPaste = isSameAuthor
          ? internalPayload.groups
          : stripLiveBindingForCrossUserPaste(internalPayload.groups);
        repositionPastedGroupToClick(pasteSelection(page.page_number, groupsToPaste));
        return;
      }

      const insertImage = async (src: string, hintWidth?: number, hintHeight?: number) => {
        if (!src) return;
        const patch: { src: string; x?: number; y?: number; width?: number; height?: number } = { src };
        if (dropPoint) { patch.x = dropPoint.x; patch.y = dropPoint.y; }
        // Tamaño real de la imagen (pedido explícito 2026-09-09: "el mismo
        // tamaño en el que se encuentra la imagen") -- ver
        // resolveImagePasteSize más arriba. Sin esto, quedaba el
        // default fijo (360x220) de cualquier bloque imagen nuevo.
        const size = await resolveImagePasteSize(src, hintWidth, hintHeight, CONTENT_RIGHT - CONTENT_LEFT, CONTENT_BOTTOM - CONTENT_TOP);
        if (size) { patch.width = size.width; patch.height = size.height; }
        addElement('image', patch);
      };
      const imageItem = cd ? Array.from(cd.items || []).find((it) => it.kind === 'file' && it.type.startsWith('image/')) : null;
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          event.preventDefault();
          const reader = new FileReader();
          reader.onload = () => { void insertImage(String(reader.result || '')); };
          reader.readAsDataURL(file);
        }
        return;
      }
      const pasteBlocks = html ? parseRichClipboardBlocks(html) : [];
      const isMixedOrTextOnly = pasteBlocks.length > 1 || (pasteBlocks.length === 1 && pasteBlocks[0].kind === 'text');
      if (isMixedOrTextOnly) {
        event.preventDefault();
        void processPasteBlocks(pasteBlocks);
        return;
      }

      const htmlDoc = html ? new DOMParser().parseFromString(html, 'text/html') : null;
      // Si el HTML trae una <table> real, eso se maneja en el punto 2 de
      // abajo -- no tratar como imagen un <img> decorativo dentro de una
      // celda.
      const htmlImgEl = htmlDoc && !htmlDoc.querySelector('table') ? htmlDoc.querySelector('img') : null;
      const htmlImgSrc = htmlImgEl?.getAttribute('src') || '';
      // Tamaño MOSTRADO en el documento de origen, si el HTML lo trae (ver
      // readImageSize en lib/richPaste.ts) -- mismo criterio que el pegado
      // de documento mixto/importación de .docx más abajo.
      const htmlImgSize = htmlImgEl ? readImageSize(htmlImgEl) : {};
      if (htmlImgSrc.startsWith('data:image/')) {
        event.preventDefault();
        void insertImage(htmlImgSrc, htmlImgSize.width, htmlImgSize.height);
        return;
      }
      if (/^https?:\/\//i.test(htmlImgSrc)) {
        event.preventDefault();
        void fetchImageAsDataUrl(htmlImgSrc).then((dataUrl) => { if (dataUrl) void insertImage(dataUrl, htmlImgSize.width, htmlImgSize.height); });
        return;
      }

      // 2) Selección de celdas de Excel/Sheets (o cualquier tabla HTML/TSV
      // de más de una celda) sin una tabla en foco -- crea la tabla desde
      // cero con esos datos, en vez de exigir insertar una tabla vacía
      // primero. Mismo parser que el pegado dentro de una celda existente
      // (ver TableBlock.tsx::handlePasteGrid) — lib/tableClipboard.ts.
      const parsedTable = html ? parseHtmlClipboardTable(html) : null;
      const grid = parsedTable ? parsedTable.rows : parsePlainTextClipboardGrid(cd?.getData('text/plain') ?? '');
      const isMultiCell = !!grid && (grid.length > 1 || (grid[0]?.length ?? 0) > 1);
      if (grid && isMultiCell) {
        event.preventDefault();
        const escapedRows = grid.map((row) => row.map((cell) => escapeHtml(cell)));
        const toStringGrid = (g: (string | undefined)[][]): string[][] => g.map((row) => row.map((v) => v ?? ''));
        const patch: { props: Record<string, unknown>; x?: number; y?: number } = {
          props: {
            rows: escapedRows,
            ...(parsedTable ? {
              mergedCells: parsedTable.merges,
              cellBackgrounds: toStringGrid(parsedTable.backgrounds),
              cellAligns: toStringGrid(parsedTable.aligns),
              ...(parsedTable.headerTextColor ? { headerTextColor: parsedTable.headerTextColor } : {}),
              cellTextColors: toStringGrid(parsedTable.cellTextColors || []),
            } : {}),
          },
        };
        if (dropPoint) { patch.x = dropPoint.x; patch.y = dropPoint.y; }
        addElement('table', patch);
        return;
      }

      event.preventDefault();
      if (useEditorStore.getState().clipboardElements?.length) {
        repositionPastedGroupToClick(pasteSelection(page.page_number));
        return;
      }
      const newId = pasteElement(page.page_number);
      if (newId && dropPoint) {
        const created = useEditorStore.getState().doc.pages
          .find((p) => p.page_number === page.page_number)?.elements.find((e) => e.id === newId);
        if (created) {
          updateElement(page.page_number, newId, clampToPage(dropPoint.x, dropPoint.y, created.width, created.height));
        }
      }
    };
    window.addEventListener('paste', onSystemPaste);
    return () => window.removeEventListener('paste', onSystemPaste);
  }, [page.page_number, selectedPage, addElement, pasteElement, pasteSelection, updateElement, PAGE_WIDTH, PAGE_HEIGHT]);

  useEffect(() => {
    // No hay nada seleccionado.
    if (selectedElementIds.length === 0) {
      return;
    }

    // Si estamos editando texto, una tabla, o interactuando con un video
    // (barra espaciadora para play/pausa, flechas para adelantar/atrasar),
    // las teclas siguen perteneciendo al editor/reproductor, no al manejo de
    // objetos del lienzo.
    if (openTextEditorId || canvasTableEditId || canvasVideoInteractId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target) {
        const tag = target.tagName?.toLowerCase();

        if (
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      // ─────────────────────────────────────
      // ELIMINAR SELECCIÓN
      // ─────────────────────────────────────
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();

        const deletableIds = selectedElementIds.filter((id) => {
          const element = page.elements.find((el) => el.id === id);
          return element && !element.locked;
        });

        if (deletableIds.length > 0) {
          removeElements(page.page_number, deletableIds);
        }

        return;
      }

      // ─────────────────────────────────────
      // MOVIMIENTO CON FLECHAS
      // ─────────────────────────────────────
      if (
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'ArrowDown'
      ) {
        return;
      }

      event.preventDefault();

      const step = event.shiftKey ? GRID : 1;

      const deltaX =
        event.key === 'ArrowLeft'
          ? -step
          : event.key === 'ArrowRight'
            ? step
            : 0;

      const deltaY =
        event.key === 'ArrowUp'
          ? -step
          : event.key === 'ArrowDown'
            ? step
            : 0;

      // Caso de un solo objeto.
      if (selectedElementIds.length === 1) {
        const selectedElement = page.elements.find(
          (element) => element.id === selectedElementIds[0],
        );

        if (!selectedElement || selectedElement.locked) {
          return;
        }

        const w = Math.max(20, selectedElement.width ?? 120);
        const h = Math.max(20, selectedElement.height ?? 56);

        const boundedX = Math.min(
          Math.max(
            (selectedElement.x ?? CONTENT_LEFT) + deltaX,
            CONTENT_LEFT,
          ),
          CONTENT_RIGHT - w,
        );

        const boundedY = Math.min(
          Math.max(
            (selectedElement.y ?? CONTENT_TOP) + deltaY,
            CONTENT_TOP,
          ),
          CONTENT_BOTTOM - h,
        );

        updateElement(page.page_number, selectedElement.id, {
          x: snap(boundedX, snapEnabled),
          y: snap(boundedY, snapEnabled),
        });

        return;
      }

      // Caso de selección múltiple.
      selectedElementIds.forEach((id) => {
        const element = page.elements.find((el) => el.id === id);

        if (!element || element.locked) {
          return;
        }

        const w = Math.max(20, element.width ?? 120);
        const h = Math.max(20, element.height ?? 56);

        const boundedX = Math.min(
          Math.max(
            (element.x ?? CONTENT_LEFT) + deltaX,
            CONTENT_LEFT,
          ),
          CONTENT_RIGHT - w,
        );

        const boundedY = Math.min(
          Math.max(
            (element.y ?? CONTENT_TOP) + deltaY,
            CONTENT_TOP,
          ),
          CONTENT_BOTTOM - h,
        );

        updateElement(page.page_number, id, {
          x: snap(boundedX, snapEnabled),
          y: snap(boundedY, snapEnabled),
        });
      });
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    openTextEditorId,
    canvasTableEditId,
    canvasVideoInteractId,
    page.elements,
    page.page_number,
    selectedElementIds,
    snapEnabled,
    removeElements,
    updateElement,
    layoutMode,
    CONTENT_LEFT,
    CONTENT_RIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
  ]);

  const pageLabel =
    layoutMode === 'presentation'
      ? totalPages != null && totalPages > 1
        ? `Diapositiva ${page.page_number} de ${totalPages}`
        : `Diapositiva ${page.page_number}`
      : totalPages != null && totalPages > 1
        ? `Página ${page.page_number} de ${totalPages}`
        : `Página ${page.page_number}`;

  return (
    <div
      className="page-wrapper"
      style={{
        width: PAGE_WIDTH * scale,
        minWidth: PAGE_WIDTH * scale,
      }}
    >
      <div className="page-meta">{pageLabel}</div>
      {layoutMode === 'presentation' && (
        // El ref de posicionamiento del popover (usePopover) necesita una
        // caja real y medible vía getBoundingClientRect() -- un wrapper
        // "display: contents" (como estaba antes) no genera caja propia y
        // devuelve un rect vacío en (0,0), por eso el popover aparecía en
        // la esquina superior izquierda de la pantalla en vez de junto al
        // botón. Se resuelve poniendo el ref DIRECTAMENTE en el elemento
        // que ya es "el botón circular" visualmente (antes era un <button>
        // envuelto en ese div fantasma).
        <div
          ref={transitionPopover.rootRef}
          role="button"
          tabIndex={0}
          className={`page-transition-control${page.transition && page.transition !== 'none' ? ' page-transition-control--active' : ''}`}
          title="Transición de ESTA diapositiva al exportar a PPTX (no se anima acá, solo en PowerPoint)"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); transitionPopover.toggle(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              transitionPopover.toggle();
            }
          }}
        >
          <ArrowLeftRight size={13} />
          {transitionPopover.isOpen && createPortal(
            <div
              ref={transitionPopover.popoverRef}
              className="transition-gallery-dropdown"
              style={{ position: 'fixed', top: `${transitionPopover.coords.top}px`, left: `${transitionPopover.coords.left}px`, zIndex: 99999 }}
            >
              <span className="transition-gallery-title">Transición de esta diapositiva</span>
              <span className="transition-gallery-hint">Se aplica al exportar a PPTX — cada miniatura muestra el efecto en bucle</span>
              <div className="transition-gallery-grid">
                {TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`transition-option-card${(page.transition || 'none') === opt.value ? ' transition-option-card--active' : ''}`}
                    onClick={() => {
                      setPageTransition(page.page_number, opt.value);
                      transitionPopover.close();
                    }}
                  >
                    <TransitionPreview kind={opt.value} />
                    <span className="transition-option-label">{opt.label}</span>
                    <span className="transition-option-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
        </div>
      )}
      <div className="report-page-capture-surface" data-report-page-capture="true">
      <Stage
        ref={stageRef}
        width={PAGE_WIDTH * scale}
        height={PAGE_HEIGHT * scale}
        onMouseDown={(event: any) => {
          selectPage(page.page_number);
          // Recordar dónde fue este clic (sea sobre un objeto o sobre área
          // vacía) para que un Ctrl+V posterior sepa dónde soltar el
          // contenido pegado -- ver lastCanvasClickRef arriba.
          const pointerPos = event.target.getStage()?.getPointerPosition();
          if (pointerPos) {
            lastCanvasClickRef.current = { x: pointerPos.x / scale, y: pointerPos.y / scale };
          }
          if (event.target === event.target.getStage()) {
            wasSelectedRef.current =
              useEditorStore.getState().selectedElementIds.length > 0 ||
              openTextEditorId != null ||
              canvasTableEditId != null ||
              canvasVideoInteractId != null;
            setCanvasTableEditId(null);
            setCanvasVideoInteractId(null);
            selectElement(undefined);
            setOpenTextEditorId(null);
          }
        }}
        onMouseUp={() => {
          dragInProgressRef.current = false;
        }}
        onMouseLeave={() => {
          dragInProgressRef.current = false;
        }}
        onDblClick={(event: any) => {
          if (event.target === event.target.getStage()) {
            const pos = event.target.getStage().getPointerPosition();
            if (pos) {
              const y = snap(pos.y / scale, snapEnabled);
              if (openTextEditorId) {
                setOpenTextEditorId(null);
              }
              useEditorStore.getState().addElement('text', {
                x: CONTENT_LEFT,
                y,
                width: CONTENT_RIGHT - CONTENT_LEFT,
                height: 35,
                props: { text: '' }
              });
              const newId = useEditorStore.getState().selectedElementId;
              setOpenTextEditorId(newId ?? null);
            }
          }
        }}
      >
        <Layer ref={layerRef} scaleX={scale} scaleY={scale}>
          <Rect x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT} fill="#fff" stroke="#dbe3f1" strokeWidth={1} perfectDrawEnabled={false} listening={false} />

          {/* Header & Footer reference areas (optional light background, no text blocking) */}
          <Rect x={0} y={0} width={PAGE_WIDTH} height={HEADER_HEIGHT} fill="#f8fbff" stroke="#dbe3f1" strokeWidth={1} perfectDrawEnabled={false} listening={false} />
          <Rect
            x={0}
            y={PAGE_HEIGHT - FOOTER_HEIGHT}
            width={PAGE_WIDTH}
            height={FOOTER_HEIGHT}
            fill="#f8fbff"
            stroke="#dbe3f1"
            strokeWidth={1}
            perfectDrawEnabled={false}
            listening={false}
          />

          <Rect
            x={CONTENT_LEFT}
            y={CONTENT_TOP}
            width={CONTENT_RIGHT - CONTENT_LEFT}
            height={CONTENT_BOTTOM - CONTENT_TOP}
            // stroke="#e2e8f0"
            // dash={[4, 4]}
            listening={false}
          />

          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_WIDTH / GRID) }).map((_, index) => (
              <Rect key={`gv-${index}`} x={index * GRID} y={0} width={1} height={PAGE_HEIGHT} fill="#f2f5fb" listening={false} perfectDrawEnabled={false} />
            ))}
          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_HEIGHT / GRID) }).map((_, index) => (
              <Rect key={`gh-${index}`} x={0} y={index * GRID} width={PAGE_WIDTH} height={1} fill="#f2f5fb" listening={false} perfectDrawEnabled={false} />
            ))}

          {[...page.elements]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((element) => {
              const isTextElement = element.type === 'text';
              // Modo "texto plano" de la página (pedido explícito
              // 2026-09-08, ver ReportPage.plainTextElementId): ESTE bloque
              // en particular se comporta como si estuviera SIEMPRE en
              // edición -- nunca muestra el borde de selección sólido (más
              // abajo, en el if/else que arma strokeColor/strokeW a partir
              // de isEditingText). Cualquier OTRO bloque de texto conserva
              // su comportamiento normal, esto compara por id, no por tipo.
              const isPageTextElement = isTextElement && page.plainTextElementId === element.id;
              const isEditingText = isTextElement && (openTextEditorId === element.id || isPageTextElement);
              const openTextEditorOnDoubleClick = () => {
                if (!isTextElement) {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setSpeechError(null);
                setOpenTextEditorId(element.id);
              };

              const openTableEditorOnDoubleClick = () => {
                if (element.type !== 'table') {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setCanvasTableEditId(element.id);
              };

              const openImageReplaceOnDoubleClick = () => {
                if (element.type !== 'image') {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                if (typeof onRequestImageReplace !== 'function') {
                  return;
                }
                selectElement(element.id);
                onRequestImageReplace(page.page_number, element.id);
              };

              const openVideoInteractOnDoubleClick = () => {
                if (element.type !== 'video') {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setCanvasVideoInteractId(element.id);
              };

              const onRectDoubleClick = () => {
                openTextEditorOnDoubleClick();
                openTableEditorOnDoubleClick();
                openImageReplaceOnDoubleClick();
                openVideoInteractOnDoubleClick();
              };

              // Borde configurable por el usuario (panel de propiedades) —
              // independiente del resaltado de selección, que siempre gana
              // visualmente mientras el bloque está seleccionado. Fallback a
              // defaultBorderByType para documentos guardados ANTES de que
              // este campo existiera (element.border === undefined).
              const isSelectedEl = selectedElementIds.includes(element.id);
              const isLineShape = element.type === 'shape' && element.props?.shapeType === 'line';
              const effectiveBorder = element.border || defaultBorderByType(element.type);
              let strokeColor: string;
              let strokeW: number;
              let strokeDash: number[] | undefined;
              if (isEditingText) {
                // Mientras se escribe, el <textarea> ya trae su propio borde
                // fino — el recuadro de selección (grueso, con resplandor)
                // detrás de él se veía como "dos cuadros" superpuestos, nada
                // parecido a la experiencia limpia de Word al escribir.
                strokeColor = 'transparent';
                strokeW = 0;
                strokeDash = undefined;
              } else if (isSelectedEl && !isLineShape) {
                strokeColor = 'var(--accent)';
                strokeW = 2;
                strokeDash = undefined;
              } else if (effectiveBorder.enabled) {
                strokeColor = effectiveBorder.color;
                strokeW = effectiveBorder.width;
                strokeDash =
                  effectiveBorder.style === 'dashed'
                    ? [effectiveBorder.width * 4, effectiveBorder.width * 2]
                    : effectiveBorder.style === 'dotted'
                      ? [effectiveBorder.width, effectiveBorder.width * 2]
                      : undefined;
              } else if (isTextElement) {
                // Guía de edición sutil para cuadros de texto sin borde propio
                // configurado — no es el borde del usuario, solo una ayuda
                // visual para ubicar el cuadro vacío en el lienzo.
                strokeColor = 'transparent';
                strokeW = 0;
                strokeDash = undefined;
              } else {
                strokeColor = 'transparent';
                strokeW = 0;
                strokeDash = undefined;
              }

              return (
              <React.Fragment key={element.id}>
              {element.type === 'shape' && normalizeWrapMode(element.wrapMode) !== 'infront' && (
                <ShapeVisual element={element} />
              )}
              <Rect
                id={element.id}
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                rotation={element.rotation || 0}
                fill={
                  isTextElement || element.type === 'chart' || element.type === 'shape'
                    ? 'transparent'
                    : element.type === 'kpi'
                      ? '#e8eefb'
                      : '#f8fbff'
                }
                stroke={strokeColor}
                strokeWidth={strokeW}
                shadowColor={isSelectedEl && !isEditingText ? 'var(--accent)' : 'transparent'}
                shadowBlur={isSelectedEl && !isEditingText ? 8 : 0}
                shadowOpacity={0.3}
                cornerRadius={8}
                dash={strokeDash}
                draggable={!element.locked && !isEditingText}
                onClick={(event: any) => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }

                  // El bloque de "texto plano" de la página se abre con UN
                  // solo clic (no doble) -- se supone que se comporta como
                  // escribir directo sobre la hoja, no como seleccionar un
                  // cuadro de texto aparte primero.
                  if (isPageTextElement) {
                    openTextEditorOnDoubleClick();
                    return;
                  }

                  toggleSelection(element.id, Boolean(event.evt.ctrlKey || event.evt.metaKey));
                  // Un solo clic ya desbloquea la interacción con las celdas
                  // (selección múltiple estilo Excel, ver TableBlock.tsx) --
                  // antes hacía falta doble clic. TableBlock.tsx distingue
                  // internamente "celdas seleccionadas" de "editando el
                  // texto de una celda puntual" (esto último sigue
                  // requiriendo doble clic EN una celda).
                  if (element.type === 'table' && !element.locked) setCanvasTableEditId(element.id);
                }}
                onTap={(event: any) => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }

                  if (isPageTextElement) {
                    openTextEditorOnDoubleClick();
                    return;
                  }

                  toggleSelection(element.id, Boolean(event.evt.ctrlKey || event.evt.metaKey));
                  if (element.type === 'table' && !element.locked) setCanvasTableEditId(element.id);
                }}
                onDblClick={onRectDoubleClick}
                onDblTap={onRectDoubleClick}
                onContextMenu={(event: any) => {
                  event.evt.preventDefault();
                  selectElement(element.id);
                  setContextMenu({ x: event.evt.clientX, y: event.evt.clientY, elementId: element.id });
                }}
                onDragStart={(event: any) => {
                  dragInProgressRef.current = true;

                  const isPartOfMultiSelection =
                    selectedElementIds.length > 1 &&
                    selectedElementIds.includes(element.id);

                  // Si arrastramos un objeto que ya pertenece a la selección múltiple,
                  // conservamos toda la selección.
                  if (!isPartOfMultiSelection) {
                    selectElement(element.id);
                  }

                  // Ancla para la vista previa en vivo del empuje hacia abajo
                  // (applyLivePushBelow) — solo en arrastre de UN elemento.
                  dragPushAnchorRef.current = isPartOfMultiSelection
                    ? null
                    : { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height };

                  // Guardamos la posición inicial de todos los seleccionados.
                  multiDragStartRef.current = {};

                  const idsToDrag = isPartOfMultiSelection
                    ? selectedElementIds
                    : [element.id];

                  for (const id of idsToDrag) {
                    const selected = page.elements.find((el) => el.id === id);

                    if (selected) {
                      multiDragStartRef.current[id] = {
                        x: selected.x,
                        y: selected.y,
                      };
                    }
                  }

                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }

                  // Fantasma flotante (DragPreviewOverlay) -- pedido
                  // explícito 2026-09-09: "al querer pasarlo a otra página
                  // no se ve el bloque, como que desaparece". Solo para el
                  // elemento PRINCIPAL del gesto (no cada uno de una
                  // selección múltiple) -- ver useDragPreviewStore.ts.
                  const stageForGhost = event?.target?.getStage?.();
                  const pointerForGhost = stageForGhost?.getPointerPosition?.();
                  dragGhostGrabOffsetRef.current = pointerForGhost
                    ? { x: pointerForGhost.x / scale - element.x, y: pointerForGhost.y / scale - element.y }
                    : { x: 0, y: 0 };
                  const stageRectForGhost = stageForGhost?.container?.().getBoundingClientRect();
                  const ghostLeft = stageRectForGhost ? stageRectForGhost.left + element.x * scale : 0;
                  const ghostTop = stageRectForGhost ? stageRectForGhost.top + element.y * scale : 0;
                  if (element.type === 'text') {
                    useDragPreviewStore.getState().show({
                      kind: 'text',
                      text: String(element.props?.text || ''),
                      fontSize: Number(element.props?.fontSize || 14) * scale,
                      fontFamily: element.props?.fontFamily || 'Inter',
                      fontColor: element.props?.fontColor || '#1a1a1a',
                      lineHeight: Number(element.props?.lineHeight || 1.35),
                      width: element.width * scale,
                      height: element.height * scale,
                      left: ghostLeft,
                      top: ghostTop,
                    });
                  } else if (element.type === 'image') {
                    useDragPreviewStore.getState().show({
                      kind: 'image',
                      src: resolveReportImageSrc(element),
                      width: element.width * scale,
                      height: element.height * scale,
                      left: ghostLeft,
                      top: ghostTop,
                    });
                  } else {
                    const typeLabels: Record<string, string> = {
                      table: 'Tabla', chart: 'Gráfico', kpi: 'KPI', shape: 'Forma', video: 'Video',
                    };
                    useDragPreviewStore.getState().show({
                      kind: 'generic',
                      label: typeLabels[element.type] || 'Elemento',
                      width: element.width * scale,
                      height: element.height * scale,
                      left: ghostLeft,
                      top: ghostTop,
                    });
                  }
                }}
                onDragMove={(event: any) => {
                  const node = event.target;

                  const start = multiDragStartRef.current[element.id];

                  if (!start) {
                    return;
                  }

                  const boundedX = Math.min(
                    Math.max(node.x(), CONTENT_LEFT),
                    CONTENT_RIGHT - element.width,
                  );

                  const boundedY = Math.min(
                    Math.max(node.y(), CONTENT_TOP),
                    CONTENT_BOTTOM - element.height,
                  );

                  const x = snap(boundedX, snapEnabled);
                  const y = snap(boundedY, snapEnabled);

                  node.position({ x, y });

                  if (dragPushAnchorRef.current && dragPushAnchorRef.current.id === element.id) {
                    applyLivePushBelow(
                      element.id,
                      dragPushAnchorRef.current,
                      { x, y, width: element.width, height: element.height },
                    );
                  }

                  const deltaX = x - start.x;
                  const deltaY = y - start.y;

                  // Si hay selección múltiple, mover visualmente todos los nodos.
                  if (
                    selectedElementIds.length > 1 &&
                    selectedElementIds.includes(element.id)
                  ) {
                    for (const id of selectedElementIds) {
                      if (id === element.id) {
                        continue;
                      }

                      const otherStart = multiDragStartRef.current[id];
                      if (!otherStart) {
                        continue;
                      }

                      const otherElement = page.elements.find((el) => el.id === id);
                      if (!otherElement) {
                        continue;
                      }

                      const otherNode = layerRef.current?.findOne(`#${id}`);
                      if (!otherNode) {
                        continue;
                      }

                      const nextX = Math.min(
                        Math.max(otherStart.x + deltaX, CONTENT_LEFT),
                        CONTENT_RIGHT - otherElement.width,
                      );

                      const nextY = Math.min(
                        Math.max(otherStart.y + deltaY, CONTENT_TOP),
                        CONTENT_BOTTOM - otherElement.height,
                      );

                      otherNode.position({
                        x: snap(nextX, snapEnabled),
                        y: snap(nextY, snapEnabled),
                      });
                    }
                  }

                  // Fantasma flotante -- a diferencia del `node.position`
                  // de arriba (recortado a los límites de ESTA página), acá
                  // se sigue el cursor SIN ese recorte, cruzando visualmente
                  // hacia la página vecina bajo el puntero -- recién
                  // recortado a los límites de contenido de la página que
                  // esté REALMENTE bajo el cursor en este instante (nunca
                  // entre su encabezado/pie, "siempre dentro del lienzo").
                  const stage = event.target.getStage();
                  const pointerPos = stage?.getPointerPosition();
                  if (pointerPos) {
                    const containerRect = stage.container().getBoundingClientRect();
                    const clientX = containerRect.left + pointerPos.x;
                    const clientY = containerRect.top + pointerPos.y;
                    const hoverShell = document.elementFromPoint(clientX, clientY)?.closest('[data-page-number]');
                    const hoverPageNumber = hoverShell ? Number(hoverShell.getAttribute('data-page-number')) : page.page_number;
                    const hoverStageEl = (hoverShell?.querySelector('.konvajs-content') as HTMLElement | null) || (hoverShell as HTMLElement | null);
                    const hoverStageRect = hoverStageEl?.getBoundingClientRect();
                    if (hoverStageRect && hoverStageRect.width > 0) {
                      const hoverMetrics = getMetricsForPageNumber(hoverPageNumber || page.page_number);
                      const grabOffset = dragGhostGrabOffsetRef.current || { x: 0, y: 0 };
                      const rawLocalX = (clientX - hoverStageRect.left) / scale - grabOffset.x;
                      const rawLocalY = (clientY - hoverStageRect.top) / scale - grabOffset.y;
                      const clampedLocalX = Math.min(
                        Math.max(rawLocalX, hoverMetrics.CONTENT_LEFT),
                        Math.max(hoverMetrics.CONTENT_LEFT, hoverMetrics.CONTENT_RIGHT - element.width),
                      );
                      const clampedLocalY = Math.min(
                        Math.max(rawLocalY, hoverMetrics.CONTENT_TOP),
                        Math.max(hoverMetrics.CONTENT_TOP, hoverMetrics.CONTENT_BOTTOM - element.height),
                      );
                      useDragPreviewStore.getState().move(
                        hoverStageRect.left + clampedLocalX * scale,
                        hoverStageRect.top + clampedLocalY * scale,
                      );
                    }
                  }
                }}
                onDragEnd={(e: any) => {
                  useDragPreviewStore.getState().hide();
                  // La vista previa en vivo del empuje termina con el gesto
                  // — el resultado definitivo lo decide el store al confirmar.
                  dragPushAnchorRef.current = null;
                  resetLivePushPreview();

                  const stage = e.target.getStage();
                  const pointerPos = stage.getPointerPosition();
                  if (!pointerPos) return;

                  // Convertir a coordenadas globales de la pantalla
                  const containerRect = stage.container().getBoundingClientRect();
                  const clientX = containerRect.left + pointerPos.x;
                  const clientY = containerRect.top + pointerPos.y;

                  // Detectar si el puntero cayó en otra página
                  const elementUnderPointer = document.elementFromPoint(clientX, clientY);
                  const targetPageWrapper = elementUnderPointer?.closest('[data-page-number]');

                  if (targetPageWrapper) {
                    const targetPageNum = Number(targetPageWrapper.getAttribute('data-page-number'));

                    if (targetPageNum !== page.page_number) {
                      // Se soltó en otra página — si el elemento soltado
                      // pertenece a una selección múltiple, TODA la
                      // selección cruza junto conservando su distancia
                      // original respecto al ancla (pedido explícito
                      // 2026-09-04: antes solo cruzaba el que recibía el
                      // evento de soltar).
                      const targetRect = targetPageWrapper.getBoundingClientRect();
                      const newX = clientX - targetRect.left;
                      const newY = clientY - targetRect.top;

                      const isMultiDrag =
                        selectedElementIds.length > 1 &&
                        selectedElementIds.includes(element.id);

                      moveElementsBetweenPages(
                        isMultiDrag ? selectedElementIds : [element.id],
                        element.id,
                        targetPageNum,
                        newX,
                        newY,
                      );
                      multiDragStartRef.current = {};
                      return;
                    }
                  }

                  // Si no cambió de página, aplicar lógica normal de movimiento
                  // (Aquí puedes incluir la lógica de mover múltiples elementos a la vez si están en `selectedElementIds`)
                  const start = multiDragStartRef.current[element.id];

                  if (!start) {
                    updateElement(page.page_number, element.id, {
                      x: e.target.x(),
                      y: e.target.y(),
                    });
                    return;
                  }

                  const deltaX = e.target.x() - start.x;
                  const deltaY = e.target.y() - start.y;

                  const isMultiDrag =
                    selectedElementIds.length > 1 &&
                    selectedElementIds.includes(element.id);

                  if (!isMultiDrag) {
                    updateElement(page.page_number, element.id, {
                      x: e.target.x(),
                      y: e.target.y(),
                    });

                    multiDragStartRef.current = {};
                    return;
                  }

                  // Guardamos cada elemento con el mismo desplazamiento.
                  selectedElementIds.forEach((id) => {
                    const selected = page.elements.find((el) => el.id === id);
                    const initial = multiDragStartRef.current[id];

                    if (!selected || !initial) {
                      return;
                    }

                    const nextX = Math.min(
                      Math.max(initial.x + deltaX, CONTENT_LEFT),
                      CONTENT_RIGHT - selected.width,
                    );

                    const nextY = Math.min(
                      Math.max(initial.y + deltaY, CONTENT_TOP),
                      CONTENT_BOTTOM - selected.height,
                    );

                    updateElement(page.page_number, id, {
                      x: snap(nextX, snapEnabled),
                      y: snap(nextY, snapEnabled),
                    });
                  });

                  multiDragStartRef.current = {};

                  if (selectedElementIds.includes(element.id)) {
                    selectedElementIds.forEach(id => {
                      // Llama a tu función actual para actualizar posición sumando deltaX y deltaY
                      // updateElementPosition(page.page_number, id, deltaX, deltaY);
                    });
                  } else {
                    updateElement(page.page_number, element.id, { x: e.target.x(), y: e.target.y() });
                  }
                }}
                onTransformStart={() => {
                  // Ancla para la vista previa en vivo del empuje hacia abajo
                  // (applyLivePushBelow) mientras se redimensiona — el
                  // Transformer solo se adjunta con selección única (ver el
                  // useEffect de transformerRef más arriba), así que nunca
                  // hay ambigüedad de "cuál elemento empuja" aquí.
                  transformPushAnchorRef.current = {
                    id: element.id, x: element.x, y: element.y, width: element.width, height: element.height,
                  };
                }}
                onTransform={(event: any) => {
                  // Igual que onDragMove: solo vista previa visual, nunca
                  // toca el store — Konva ya escala el nodo en vivo por su
                  // cuenta (scaleX/scaleY), acá solo se lee esa escala para
                  // saber dónde cae el borde inferior EN VIVO.
                  const node = event.target;
                  if (!transformPushAnchorRef.current || transformPushAnchorRef.current.id !== element.id) return;
                  applyLivePushBelow(
                    element.id,
                    transformPushAnchorRef.current,
                    {
                      x: node.x(),
                      y: node.y(),
                      width: node.width() * node.scaleX(),
                      height: node.height() * node.scaleY(),
                    },
                  );
                }}
                onTransformEnd={(event: any) => {
                  transformPushAnchorRef.current = null;
                  resetLivePushPreview();
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  const minWidth = isTextElement ? 120 : 60;
                  const minHeight = isTextElement ? 28 : 40;
                  const nextX = Math.min(Math.max(node.x(), CONTENT_LEFT), CONTENT_RIGHT - minWidth);
                  const nextY = Math.min(Math.max(node.y(), CONTENT_TOP), CONTENT_BOTTOM - minHeight);
                  const nextWidth = Math.min(
                    Math.max(minWidth, node.width() * scaleX),
                    CONTENT_RIGHT - nextX,
                  );
                  const nextHeight = Math.min(
                    Math.max(minHeight, node.height() * scaleY),
                    CONTENT_BOTTOM - nextY,
                  );
                  node.scaleX(1);
                  node.scaleY(1);
                  node.x(nextX);
                  node.y(nextY);
                  node.width(nextWidth);
                  node.height(nextHeight);
                  updateElement(page.page_number, element.id, {
                    x: nextX,
                    y: nextY,
                    width: nextWidth,
                    height: nextHeight,
                    rotation: node.rotation(),
                  });
                }}
              />
              </React.Fragment>
              );
            })}

          {page.elements
            .filter(
              // El elemento de "texto plano" de la página (ver
              // ReportPage.plainTextElementId) nunca muestra este recuadro
              // punteado -- pedido explícito: "siempre en modo edición pero
              // sin ver el contenedor de líneas discontinuas".
              (element) => element.type === 'text' && selectedElementId === element.id && openTextEditorId === element.id && page.plainTextElementId !== element.id,
            )
            .map((element) => {
              // El recuadro punteado de edición debe crecer EN VIVO con
              // cada tecla, no solo cuando el store confirma (debounce de
              // 600ms) — por eso usa liveEdit.width/height (estado local,
              // actualizado en cada pulsación por handleLiveTyping) en vez
              // de element.width/height (el store, desactualizado hasta el
              // commit). Pedido explícito: "eso es lo que debe de ir
              // creciendo mientras el usuario va escribiendo... en tiempo
              // real".
              const isLive = liveEdit?.id === element.id;
              const boxWidth = isLive ? liveEdit.width : element.width;
              const boxHeight = isLive ? liveEdit.height : element.height;
              return (
                <Rect
                  key={`${element.id}-text-selected`}
                  x={element.x}
                  y={element.y}
                  width={boxWidth}
                  height={boxHeight}
                  rotation={element.rotation || 0}
                  stroke="#2d6cdf"
                  strokeWidth={1}
                  dash={[4, 4]}
                  fill="rgba(0,0,0,0)"
                  cornerRadius={4}
                  listening={false}
                />
              );
            })}

          {page.elements
            .filter((element) => element.type === 'chart')
            .map((element) => (
              <ChartBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'wordart')
            .map((element) => (
              <WordArtVisual key={element.id} element={element} />
            ))}

          {page.elements
            .filter((element) => element.type === 'kpi')
            .map((element) => (
              <KpiBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'seismic-report')
            .map((element) => (
              <SeismicReportBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'table')
            .map((element) => {
              const rows: string[][] = element.props?.rows || [];
              const colCount = rows[0]?.length || 3;
              const caption = String(element.props?.caption ?? '').trim();

              // Crecimiento automático del BLOQUE (nunca lo encoge solo —
              // encoger es manual, vía resize de columna) al tamaño natural
              // real de la tabla renderizada (ver TableBlock.tsx::onNaturalSize).
              // El techo vertical usa `CONTENT_BOTTOM` (borde del área de
              // contenido, antes del pie de página), NUNCA `PAGE_HEIGHT` --
              // bug real reportado en vivo 2026-09-11 ("el recuadro... se
              // sobrepone en el footer"): con `PAGE_HEIGHT - element.y - 8`
              // como techo, una tabla cuyo contenido real es alto (p.ej.
              // recién después de partirse por desborde, ver
              // `handleOverflowRows` más abajo) podía crecer hasta el borde
              // FÍSICO de la hoja -- 30-40px más abajo de donde realmente
              // empieza el pie de página -- dejando su borde inferior
              // literalmente encima del footer. `maxTableHeight` (abajo, la
              // misma medida que usa la detección de desborde) ya usa
              // `CONTENT_BOTTOM` correctamente; este techo debe coincidir
              // con ese mismo límite para no contradecirlo.
              const handleNaturalSize = (naturalW: number, naturalH: number) => {
                const maxW = CONTENT_RIGHT - element.x;
                const maxH = CONTENT_BOTTOM - element.y;
                const nextW = Math.min(maxW, Math.max(element.width, naturalW + 8));
                const nextH = Math.min(maxH, Math.max(element.height, naturalH + 8));
                if (nextW !== element.width || nextH !== element.height) {
                  updateElement(page.page_number, element.id, { width: nextW, height: nextH });
                }
              };

              const setRows = (newRows: string[][]) => {
                updateElement(page.page_number, element.id, { props: { ...element.props, rows: newRows } });
              };

              // Auto-paginación de tabla (mismo principio que el texto):
              // cuántas filas caben lo mide TableBlock.tsx contra el alto
              // disponible REAL de esta página (hasta el borde del área de
              // contenido, no el borde físico de la hoja como el auto-grow
              // de arriba) -- si sobran filas, se parten en una tabla
              // continuación al inicio de la página siguiente.
              const maxTableHeight = CONTENT_BOTTOM - element.y;
              const handleOverflowRows = (fittingRowCount: number, fittingHeightPx: number, totalHeightPx: number) => {
                splitOverflowingTable({
                  pageNumber: page.page_number,
                  elementId: element.id,
                  fittingRowCount,
                  fittingHeightPx,
                  overflowHeightPx: totalHeightPx - fittingHeightPx,
                });
              };

              return (
                <Html
                  key={`${element.id}-table`}
                  groupProps={{ x: element.x + 4, y: element.y + 4, rotation: element.rotation || 0, listening: false }}
                  divProps={{
                    style: {
                      pointerEvents: canvasTableEditId === element.id ? 'auto' : 'none',
                      zIndex: selectedElementIds.includes(element.id) ? 500 : undefined,
                    },
                  }}
                >
                  <div
                    className={
                      canvasTableEditId === element.id ? 'report-canvas-table-edit-host' : 'report-canvas-html-shield'
                    }
                    onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                    style={{ width: element.width - 8, height: element.height - 8, overflow: 'visible' }}
                  >
                    <TableBlock
                      {...element.props}
                      containerWidth={element.width - 8}
                      maxTableWidth={CONTENT_RIGHT - element.x - 8}
                      elementId={element.id}
                      // Fragmentos de una tabla partida entre páginas
                      // comparten `linkedGroupId` y por eso YA quedan
                      // juntos en `selectedElementIds` al hacer clic en
                      // cualquiera de los dos (ver selectElement en
                      // useEditorStore.ts) -- este prop usaba la variante
                      // SINGULAR (`selectedElementId`), así que solo el
                      // fragmento realmente clickeado mostraba su barra de
                      // herramientas/resaltado propio, el otro parecía
                      // "no seleccionado" hasta que se arrastraba (recién
                      // ahí `updateElement` sí los movía juntos). Bug real
                      // reportado en vivo 2026-09-10.
                      selected={selectedElementIds.includes(element.id)}
                      editing={canvasTableEditId === element.id}
                      onExitEdit={() => setCanvasTableEditId(null)}
                      onUpdateCells={setRows}
                      onUpdateCellBackgrounds={(backgrounds) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, cellBackgrounds: backgrounds } });
                      }}
                      onUpdateRowBackgrounds={(backgrounds) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, rowBackgrounds: backgrounds } });
                      }}
                      onUpdateColumnBackgrounds={(backgrounds) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, columnBackgrounds: backgrounds } });
                      }}
                      onUpdateMergedCells={(mergedCells) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, mergedCells } });
                      }}
                      onMergeCells={({ rows: nextRows, cellBackgrounds, mergedCells }) => {
                        updateElement(page.page_number, element.id, {
                          props: { ...element.props, rows: nextRows, cellBackgrounds, mergedCells },
                        });
                      }}
                      onPasteCellFormat={({ rows: nextRows, cellBackgrounds, cellAligns }) => {
                        updateElement(page.page_number, element.id, {
                          props: { ...element.props, rows: nextRows, cellBackgrounds, cellAligns },
                        });
                      }}
                      onSplitCell={(next) => {
                        const patch: Record<string, unknown> = {};
                        Object.entries(next).forEach(([key, value]) => {
                          if (value !== undefined) patch[key] = value;
                        });
                        updateElement(page.page_number, element.id, {
                          props: { ...element.props, ...patch },
                        });
                      }}
                      onSmartPasteGrid={(next) => {
                        const patch: Record<string, unknown> = {};
                        Object.entries(next).forEach(([key, value]) => {
                          if (value !== undefined) patch[key] = value;
                        });
                        updateElement(page.page_number, element.id, {
                          props: { ...element.props, ...patch },
                        });
                      }}
                      onUpdateColWidths={(widths) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, colWidths: widths } });
                      }}
                      onUpdateRowHeights={(heights) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, rowHeights: heights } });
                      }}
                      onUpdateCellAligns={(aligns) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, cellAligns: aligns } });
                      }}
                      onUpdateCellNumberFormats={(formats) => {
                        updateElement(page.page_number, element.id, { props: { ...element.props, cellNumberFormats: formats } });
                      }}
                      onAddRow={() => {
                        setRows([...rows, Array(colCount).fill('')]);
                      }}
                      onRemoveRow={(rowIndex) => {
                        if (rows.length <= 1) return;
                        setRows(rows.filter((_, i) => i !== rowIndex));
                      }}
                      onAddColumn={() => {
                        const newRows = rows.map((row) => [...row, '']);
                        const prevWidths: number[] = element.props?.colWidths;
                        const patch: Record<string, unknown> = { rows: newRows };
                        if (Array.isArray(prevWidths) && prevWidths.length === colCount) {
                          patch.colWidths = [...prevWidths, 120];
                        }
                        updateElement(page.page_number, element.id, { props: { ...element.props, ...patch } });
                      }}
                      onRemoveColumn={(colIndex) => {
                        if (colCount <= 1) return;
                        const newRows = rows.map((row) => row.filter((_, i) => i !== colIndex));
                        const prevWidths: number[] = element.props?.colWidths;
                        const patch: Record<string, unknown> = { rows: newRows };
                        if (Array.isArray(prevWidths) && prevWidths.length === colCount) {
                          patch.colWidths = prevWidths.filter((_, i) => i !== colIndex);
                        }
                        updateElement(page.page_number, element.id, { props: { ...element.props, ...patch } });
                      }}
                      onNaturalSize={handleNaturalSize}
                      maxTableHeight={maxTableHeight}
                      onOverflowRows={handleOverflowRows}
                      onTitleMouseDown={(event) => {
                        if (element.locked) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const stage = layerRef.current?.getStage();
                        const node = layerRef.current?.findOne(`#${element.id}`);
                        if (!stage || !node) return;
                        stage.setPointersPositions(event.nativeEvent);
                        node.startDrag();
                      }}
                      onCreateChartFromTable={() => setChartFromTableRequest({ tableElementId: element.id })}
                    />
                    {caption && (
                      <div
                        className="report-media-caption"
                        style={{
                          width: '100%',
                          alignSelf: 'center',
                          marginTop: 6,
                          textAlign: 'center',
                          fontFamily: 'Arial, sans-serif',
                          fontSize: 12,
                          lineHeight: 1.25,
                          fontStyle: 'italic',
                          color: '#4F81BD',
                          whiteSpace: 'normal',
                          overflowWrap: 'break-word',
                        }}
                      >
                    {caption}
                    </div>
                    )}
                  </div>
                </Html>
              );
            })}

          {page.elements
            .filter((element) => element.type === 'header')
            .map((element) => (
              <HeaderBlock key={element.id} element={element} tenantId={tenantId} />
            ))}

          {page.elements
            .filter((element) => element.type === 'footer')
            .map((element) => (
              <FooterBlock key={element.id} element={element} pageNumber={page.page_number} totalPages={totalPages} />
            ))}

          {page.elements
            .filter((element) => element.type === 'cover')
            .map((element) => (
              <CoverBlock key={element.id} element={element} tenantId={tenantId} onContextMenu={handleHtmlBlockContextMenu} />
            ))}
          {page.elements
            .filter((element) => element.type === 'image')
            .map((element) => (
              <ImageBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}
          {page.elements
            .filter((element) => element.type === 'video')
            .map((element) => (
              <VideoBlock
                key={element.id}
                element={element}
                onContextMenu={handleHtmlBlockContextMenu}
                isInteracting={canvasVideoInteractId === element.id}
              />
            ))}

          {page.elements
            .filter((element) => element.type === 'toc')
            .map((element) => (
              <TocBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'sensor')
            .map((element) => (
              <SensorBlock key={element.id} element={element} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'sensor_multi_chart')
            .map((element) => (
              <SensorMultiChartBlock key={element.id} element={element} tenantId={tenantId} onContextMenu={handleHtmlBlockContextMenu} />
            ))}

          {page.elements
            .filter((element) => element.type === 'text')
            .map((element) => (
              <TextBlock
                key={element.id}
                element={element}
                page={page}
                selectedElementId={selectedElementId}
                CONTENT_LEFT={CONTENT_LEFT}
                CONTENT_RIGHT={CONTENT_RIGHT}
                CONTENT_TOP={CONTENT_TOP}
                CONTENT_BOTTOM={CONTENT_BOTTOM}
                PAGE_WIDTH={PAGE_WIDTH}
                PAGE_HEIGHT={PAGE_HEIGHT}
                onRequestImageReplace={onRequestImageReplace}
                selectElement={selectElement}
                updateElement={updateElement}
                addElement={addElement}
                removeElement={removeElement}
                splitOverflowingText={splitOverflowingText}
                pasteTextAcrossPages={pasteTextAcrossPages}
                openTextEditorId={openTextEditorId}
                setOpenTextEditorId={setOpenTextEditorId}
                liveEdit={liveEdit}
                setLiveEdit={setLiveEdit}
                pendingTypingStyle={pendingTypingStyle}
                setPendingTypingStyle={setPendingTypingStyle}
                selectionTick={selectionTick}
                setSelectionTick={setSelectionTick}
                caretRect={caretRect}
                isDictating={isDictating}
                setIsDictating={setIsDictating}
                speechError={speechError}
                setSpeechError={setSpeechError}
                interimDictation={interimDictation}
                setInterimDictation={setInterimDictation}
                recognitionRef={recognitionRef}
                dictationTargetRef={dictationTargetRef}
                stopDictation={stopDictation}
                correctionInfo={correctionInfo}
                setCorrectionInfo={setCorrectionInfo}
                isImproving={isImproving}
                runAIImprovement={runAIImprovement}
                advancedSuggestions={advancedSuggestions}
                setAdvancedSuggestions={setAdvancedSuggestions}
                isAnalyzingSpelling={isAnalyzingSpelling}
                setIsAnalyzingSpelling={setIsAnalyzingSpelling}
                inlineSpellIssues={inlineSpellIssues}
                setInlineSpellIssues={setInlineSpellIssues}
                spellMenu={spellMenu}
                setSpellMenu={setSpellMenu}
                spellMenuRef={spellMenuRef}
                splitBlockMenu={splitBlockMenu}
                setSplitBlockMenu={setSplitBlockMenu}
                slashRefMenu={slashRefMenu}
                setSlashRefMenu={setSlashRefMenu}
                copiedTextFormat={copiedTextFormat}
                setCopiedTextFormat={setCopiedTextFormat}
                isComposingRef={isComposingRef}
                activeTextareaRef={activeTextareaRef}
                textSplitInProgressRef={textSplitInProgressRef}
                selectionRangeRef={selectionRangeRef}
                activeFormatBridgeRef={activeFormatBridgeRef}
                activeCaseBridgeRef={activeCaseBridgeRef}
                activeRefInsertBridgeRef={activeRefInsertBridgeRef}
                ghostWrapRef={ghostWrapRef}
                textMouseAnchorRef={textMouseAnchorRef}
                textSelectionFrameRef={textSelectionFrameRef}
                liveEditCommitTimerRef={liveEditCommitTimerRef}
                wrapAutoHeightRef={wrapAutoHeightRef}
                getIndexFromClickPoint={getIndexFromClickPoint}
                resolveTextRef={resolveTextRef}
              />
            ))}

          {/* Formas con "Delante del texto" (ADR-049, pedido explícito
              2026-09-04: "que realmente funcionen"). El loop principal de
              arriba (ordenado por zIndex) solo decide el orden ENTRE formas
              y sus propios recuadros de selección -- texto/imagen/tabla/
              gráfico/etc. se pintan en sus propios pases FIJOS más abajo en
              este mismo Layer, siempre en el mismo orden relativo sin
              importar zIndex, así que subir el zIndex de una forma nunca
              bastaba para que se viera "delante" de un bloque de texto. Acá
              se redibuja SOLO la parte visual (sin escucha de eventos -- el
              Rect real que se arrastra/selecciona sigue en su lugar de
              siempre en el loop principal, intacto) al final de TODOS los
              pases de contenido, para que la opción realmente se vea
              delante de todo lo demás de la página. */}
          {page.elements
            .filter((element) => element.type === 'shape' && normalizeWrapMode(element.wrapMode) === 'infront')
            .map((element) => (
              <ShapeVisual key={`${element.id}-front`} element={element} />
            ))}

          {/* Anclas de comentario: capa translúcida encima del objeto
              comentado, pero sin interceptar selección, arrastre ni edición. */}
          {linkedComments.filter((comment) => comment.id === hoveredCommentId).map((comment) => {
            const target = page.elements.find((element) => element.id === comment.elementId);
            if (!target) return null;
            return (
              <Rect
                key={`comment-highlight-${comment.id}`}
                x={target.x}
                y={target.y}
                width={target.width}
                height={target.height}
                fill="rgba(192, 38, 211, 0.14)"
                stroke="#c026d3"
                strokeWidth={1.5}
                dash={[5, 4]}
                cornerRadius={3}
                listening={false}
              />
            );
          })}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            resizeEnabled
            keepRatio={false}
            centeredScaling={false}
            boundBoxFunc={(oldBox: any, newBox: any) => {
              const selected = page.elements.find((item) => item.id === selectedElementId);
              if (!selected || selected.locked) return oldBox;
              const minWidth = selected.type === 'text' ? 120 : 60;
              const minHeight = selected.type === 'text' ? 28 : 40;
              const x = Math.min(Math.max(newBox.x, CONTENT_LEFT), CONTENT_RIGHT - minWidth);
              const y = Math.min(Math.max(newBox.y, CONTENT_TOP), CONTENT_BOTTOM - minHeight);
              return {
                ...newBox,
                x,
                y,
                width: Math.min(Math.max(minWidth, newBox.width), CONTENT_RIGHT - x),
                height: Math.min(Math.max(minHeight, newBox.height), CONTENT_BOTTOM - y),
              };
            }}
            anchorSize={14}
            anchorCornerRadius={4}
            anchorStroke="#1d4ed8"
            anchorFill="#ffffff"
            anchorStrokeWidth={2}
            borderStroke="#2563eb"
            borderStrokeWidth={1.2}
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right',
            ]}
          />
        </Layer>
      </Stage>
      </div>

      {contextMenu && (() => {
        const menuElement = page.elements.find((el) => el.id === contextMenu.elementId);
        if (!menuElement) return null;
        return (
          <div
            className="canvas-context-menu"
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 2000,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
              padding: 4,
              minWidth: 180,
              display: 'flex',
              flexDirection: 'column',
              fontSize: 13,
            }}
          >
            {menuElement.type === 'cover' && (
              <button
                type="button"
                onClick={() => {
                  onRequestCoverImage?.(page.page_number, menuElement.id);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a', fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Insertar imagen empresa
              </button>
            )}
            {menuElement.type === 'toc' && (
              <button
                type="button"
                onClick={() => {
                  updateElement(page.page_number, menuElement.id, {
                    props: { ...menuElement.props, _refreshedAt: Date.now() },
                  });
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a', fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Actualizar índice
              </button>
            )}
            {['image', 'chart', 'table', 'kpi', 'sensor', 'map', 'shape', 'wordart'].includes(menuElement.type) && (
              <div
                onMouseEnter={() => setContextWrapSubmenuOpen(true)}
                onMouseLeave={() => setContextWrapSubmenuOpen(false)}
                style={{ position: 'relative' }}
              >
                <button
                  type="button"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '8px 10px', width: '100%',
                    border: 'none', background: contextWrapSubmenuOpen ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', borderRadius: 6, color: '#0f172a',
                  }}
                >
                  Ajustar texto
                  <span style={{ opacity: 0.5 }}>▸</span>
                </button>
                {contextWrapSubmenuOpen && (
                  <div
                    style={{
                      position: 'absolute', left: '100%', top: 0, marginLeft: 2,
                      background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)', padding: 4, minWidth: 190,
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    {WRAP_MODE_OPTIONS.map((o) => {
                      const active = normalizeWrapMode(menuElement.wrapMode) === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          title={o.hint}
                          onClick={() => {
                            updateElement(page.page_number, menuElement.id, { wrapMode: o.value });
                            setContextMenu(null);
                            setContextWrapSubmenuOpen(false);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                            border: 'none', background: active ? '#eff6ff' : 'transparent',
                            cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                            color: active ? '#1d4ed8' : '#0f172a', fontWeight: active ? 700 : 400,
                          }}
                          onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#f1f5f9'; }}
                          onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {active ? '✓' : ''} {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {menuElement.type !== 'header' && menuElement.type !== 'footer' && menuElement.type !== 'cover' && (
              <button
                type="button"
                onClick={() => {
                  copyElement(page.page_number, menuElement.id);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Copiar bloque <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Ctrl+C</span>
              </button>
            )}
            {clipboardElement && (
              <button
                type="button"
                onClick={() => {
                  pasteElement(page.page_number);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Pegar bloque <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Ctrl+V</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                updateElement(page.page_number, menuElement.id, { locked: !menuElement.locked });
                setContextMenu(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                borderRadius: 6, color: '#0f172a',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {menuElement.locked ? 'Desbloquear bloque' : 'Bloquear bloque'}
            </button>
            <button
              type="button"
              onClick={() => {
                removeElement(page.page_number, menuElement.id);
                setContextMenu(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                borderRadius: 6, color: '#b91c1c', fontWeight: 600,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Eliminar bloque
            </button>
          </div>
        );
      })()}

      {chartFromTableRequest && (() => {
        const tableElement = page.elements.find((el) => el.id === chartFromTableRequest.tableElementId);
        if (!tableElement) return null;
        const rows: string[][] = Array.isArray(tableElement.props?.rows) ? tableElement.props.rows : [];
        return (
          <CreateChartFromTableModal
            rows={rows}
            hasHeader={!!tableElement.props?.hasHeader}
            onCreate={(config) => addChartFromTable(tableElement.id, config)}
            onClose={() => setChartFromTableRequest(null)}
          />
        );
      })()}
    </div>
  );
});

export default PageCanvas;
