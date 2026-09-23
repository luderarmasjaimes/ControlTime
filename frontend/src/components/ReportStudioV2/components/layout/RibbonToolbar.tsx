import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Grid, MousePointer2, Download, FileText, Video, ZoomIn, ZoomOut,
  Printer, ScanSearch, Sparkles, FolderOpen, Save, Sigma, RefreshCw,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Type, List, ListOrdered, BoxIcon ,
  Image as ImageIcon, Table as TableIcon, Map as MapIcon, BarChart3,
  Target, Layers, FileDown, FileUp, Undo2, Redo2,
  Copy, Scissors, Clipboard, BookOpen, CheckSquare, Shield, Clock,
  PanelLeftClose, PanelRightClose, Maximize2, LayoutTemplate, FilePlus2,
  Hash, Minus, Camera, Mic, ArrowLeftRight, Gauge, Pin, PinOff, Highlighter,
  Info, LayoutGrid, Captions, Rows3, LineChart, Waves, FileStack, Link2, Radar, Ruler, SlidersHorizontal, MessageSquare,
  BookmarkPlus, X, Play, FileInput, FileSpreadsheet, Unlock, Droplets,
} from 'lucide-react';
import ColorPalette from '../shared/ColorPalette';
import { HEADING_STYLES, type HeadingStyleDef } from '../../lib/headingStyles';
import type { CustomTextStyle } from '../../lib/customTextStyles';
import { FONT_FAMILIES, FONT_SIZES } from '../../lib/fontOptions';
import { SLIDE_LAYOUT_TEMPLATES } from '../../lib/slideLayouts';
import { useEditorStore, type GlobalTextFormat } from '../../store/useEditorStore';
import { generateTocData } from '../document/TableOfContents';
import { tryInsertRefAtActiveTextSelection } from '../../lib/activeTextFormatBridge';
import { createPortal } from 'react-dom';
import { usePopover } from '../../lib/usePopover';

/* ─────────────────────────────────────────────────────────────────────────────
   RIBBON TOOLBAR — Etapa 1 Funcionalidad Core
   Pestañas: Inicio | Insertar | Diseño | Revisar | Datos | Exportar
   Colapsa con doble-click en pestaña activa para maximizar lienzo.
   ───────────────────────────────────────────────────────────────────────── */

const CM_TO_PX = 96 / 2.54;
const PT_TO_PX = 96 / 72;

const MINING_COLORS = [
  '#0f172a','#1e293b','#334155','#64748b','#94a3b8',
  '#dc2626','#ea580c','#d97706','#ca8a04','#65a30d',
  '#059669','#0891b2','#2563eb','#4f46e5','#7c3aed',
  '#c026d3','#e11d48','#ffffff','#f8fafc','#000000',
];

const COVER_TEMPLATES = [
  { id: 'corporate', label: 'Corporativo', desc: 'Diseño ejecutivo formal' },
  { id: 'technical', label: 'Técnico', desc: 'Ingeniería y datos' },
  { id: 'executive', label: 'Ejecutivo', desc: 'Gerencia y directorio' },
  { id: 'field',     label: 'Campo', desc: 'Operación minera' },
  { id: 'normative', label: 'Normativo', desc: 'Cumplimiento legal' },
];

// Cajas de resaltado semánticas del modelo corporativo minero — los tintes
// (bg/border) coinciden con TECH_CALLOUT_VARIANTS del store (useEditorStore).
const CALLOUT_OPTIONS = [
  { id: 'callout-info',     label: 'Nota',                desc: 'Información / referencia', bg: '#EEF3F7', border: '#4F81BD' },
  { id: 'callout-success',  label: 'Conforme',            desc: 'Criterio cumplido',       bg: '#E2F0D9', border: '#70AD47' },
  { id: 'callout-warning',  label: 'Observación',         desc: 'Atención / seguimiento',  bg: '#FFF2CC', border: '#C69214' },
  { id: 'callout-danger',   label: 'Crítico',             desc: 'No conformidad / riesgo', bg: '#F4CCCC', border: '#C0504D' },
  { id: 'callout-dictamen', label: 'Dictamen ejecutivo',  desc: 'Conclusión destacada',    bg: '#17365D', border: '#0F2742' },
];

// Plantillas de sección (tablas especializadas) — ids = SECTION_TEMPLATES del store.
const SECTION_OPTIONS = [
  { id: 'estado-sistema', label: 'Estado por sistema',        desc: 'Tabla semáforo de disponibilidad' },
  { id: 'matriz-riesgo',  label: 'Matriz peligro–sensor',     desc: 'Peligro · mecanismo · sensor' },
  { id: 'inventario',     label: 'Inventario de sensores',    desc: 'Inventario maestro' },
  { id: 'kpi-dict',       label: 'Diccionario de KPI',        desc: 'Definiciones y metas' },
  { id: 'tarp',           label: 'Matriz de alarmas / TARP',  desc: 'Niveles y respuesta' },
  { id: 'hallazgos',      label: 'Registro de hallazgos',     desc: 'No conformidades' },
  { id: 'plan-accion',    label: 'Plan de acción',            desc: 'Seguimiento de acciones' },
  { id: 'ficha-sensor',   label: 'Ficha de sensor',           desc: 'Formulario individual' },
  { id: 'checklist',      label: 'Checklist de campo',        desc: 'Verificación en terreno' },
  { id: 'firmas',         label: 'Registro de firmas',        desc: 'Elaboró · revisó · aprobó' },
];

// Gráficos estáticos con datos — ids = addStaticChart del store.
// Exportado para que CreateChartFromTableModal (crear gráfico a partir de
// una tabla) reutilice el mismo catálogo de tipos en vez de duplicarlo.
export const CHART_OPTIONS = [
  { id: 'chart-line',  label: 'Línea con meta',         desc: 'Tendencia + línea de meta' },
  { id: 'chart-hbar',  label: 'Barras horizontales',    desc: 'Comparación con etiquetas' },
  { id: 'chart-combo', label: 'Combo doble eje',        desc: 'Línea + barras (2 ejes)' },
];

const SHAPE_OPTIONS = [
  { id: 'rectangle', label: 'Rectángulo' },
  { id: 'square', label: 'Cuadrado' },
  { id: 'circle', label: 'Círculo' },
  { id: 'ellipse', label: 'Elipse' },
  { id: 'diamond', label: 'Rombo' },
  { id: 'triangle', label: 'Triángulo' },
  { id: 'star', label: 'Estrella' },
  { id: 'line', label: 'Línea' },
];

interface RibbonBtnProps {
  icon?: React.ElementType;
  label?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: string;
  /** Enganche para atajos de teclado globales (ver accessibility.ts), que
   * ubican el botón real vía document.querySelector('[data-action=...]')
   * en vez de duplicar la lógica del handler. */
  dataAction?: string;
}

/** Botón compacto para ribbon */
function RibbonBtn({ icon: Icon, label, onClick, active, disabled, title, className = '', variant, dataAction }: RibbonBtnProps) {
  return (
    <button
      type="button"
      className={`ribbon-btn ${active ? 'ribbon-btn--active' : ''} ${variant ? `ribbon-btn--${variant}` : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      data-action={dataAction}
    >
      {Icon && <Icon size={14} />}
      {label && <span className="ribbon-btn-label">{label}</span>}
    </button>
  );
}

/** Grupo visual con título inferior */
function RibbonGroup({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-content">{children}</div>
      <div className="ribbon-group-title" style={{color:'#cacaca'}}>{title}</div>
    </div>
  );
}

interface RibbonToolbarProps {
  // Existing TopToolbar props
  onExportPdf?: () => void;
  /** Variante de `onExportPdf` que pide el PDF SIN contraseña de acceso
   * (ADR-080 sigue cifrando por default) -- el botón solo se muestra cuando
   * `canExportPdfUnprotected` es `true` (permission code
   * `informes.export_sin_clave`, perfiles avanzados, db_scripts/112); el
   * backend igual rechaza el pedido con 403 si el rol no lo tiene. */
  onExportPdfUnprotected?: () => void;
  canExportPdfUnprotected?: boolean;
  /** ADR-204: toggle "sin sello de agua" para `onExportPdf`/`onExportPdfUnprotected`
   * (el caller, App.tsx, ya arma esos callbacks leyendo este estado). El
   * checkbox solo se muestra cuando `canToggleWatermark` es `true`
   * (permission code `informes.export_sin_marca_agua`, perfiles avanzados,
   * db_scripts/115) -- usuarios básicos nunca ven esta opción, y el default
   * (`noWatermark` en `false`) sigue exportando CON marca de agua. */
  noWatermark?: boolean;
  onToggleNoWatermark?: () => void;
  canToggleWatermark?: boolean;
  onGenerateShareLink?: () => void;
  onExportVideo?: () => void;
  onPrint?: () => void;
  onReviewDocument?: () => void;
  onOptimizeDocument?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomSet?: (value: number) => void;
  gridEnabled?: boolean;
  snapEnabled?: boolean;
  onToggleGrid?: () => void;
  onToggleSnap?: () => void;
  isOptimizing?: boolean;
  zoomPercent?: number;
  onOpenReportsAdmin?: () => void;
  onNewReport?: () => void;
  onSaveReport?: () => void;
  isSaving?: boolean;
  saveLabel?: string;
  onOpenFormulaAnalysis?: () => void;
  onSyncMiningKpis?: () => void;
  isSyncingKpis?: boolean;
  kpiAutoSyncEnabled?: boolean;
  onToggleKpiAutoSync?: () => void;
  layoutMode?: string;
  onLayoutModeChange?: (mode: string) => void;
  paperSize?: string;
  onPaperSizeChange?: (size: string) => void;
  orientation?: string;
  onOrientationChange?: (orientation: string) => void;
  pageMargins?: { top: number; right: number; bottom: number; left: number };
  onSetPageMargins?: (margins: { top: number; right: number; bottom: number; left: number }) => void;
  globalTextFormat?: GlobalTextFormat;
  onApplyGlobalTextFormat?: (format: GlobalTextFormat) => void;
  onOpenDocumentLayout?: () => void;
  // New Ribbon props
  onInsertElement?: (type: string) => void;
  onAddComment?: () => void;
  onInsertShape?: (shapeType: string) => void;
  onAddPage?: () => void;
  onDuplicatePage?: () => void;
  onAddTemplate?: (template: string) => void;
  onOpenDocumentTemplates?: () => void;
  onAddTechnicalBlock?: (kind: string) => void;
  onAddSectionTemplate?: (kind: string) => void;
  onAddStaticChart?: (kind: string) => void;
  onApplyHeadingStyle?: (style: HeadingStyleDef) => void;
  /** Estilos de texto personalizados guardados por el usuario (ver
   * lib/customTextStyles.ts) -- se muestran como chips extra en Estilos,
   * después de los HEADING_STYLES fijos, y se aplican con el mismo
   * `onApplyHeadingStyle` (misma forma de datos). */
  customTextStyles?: CustomTextStyle[];
  /** Abre el modal "Guardar estilo de texto" (App.tsx captura el formato
   * actual antes de abrirlo). */
  onOpenSaveTextStyle?: () => void;
  onDeleteCustomTextStyle?: (id: string) => void;
  onToggleBold?: () => void;
  onToggleItalic?: () => void;
  onToggleUnderline?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onSetAlignment?: (align: string) => void;
  currentTextAlign?: string;
  onSetListStyle?: (listType: 'none' | 'bullet' | 'number') => void;
  currentListStyle?: string;
  onSetFontFamily?: (family: string) => void;
  onSetFontSize?: (size: number) => void;
  onSetFontColor?: (color: string) => void;
  onSetHighlightColor?: (color: string) => void;
  onApplyCase?: () => void;
  onSetLineHeight?: (lineHeight: number) => void;
  currentLineHeight?: number;
  onInsertTOC?: () => void;
  onInsertCoverPage?: (templateId: string) => void;
  /** Aplica un diseño de la galería de diapositivas (lib/slideLayouts.ts) a
   * la diapositiva actual — solo tiene sentido en modo presentación, ver el
   * `disabled` del botón más abajo. */
  onApplySlideLayout?: (layoutId: string) => void;
  onStartWorkflow?: () => void;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  onExportDocx?: () => void;
  /** Variante de `onExportDocx` que pide al backend el layout 'flow' (texto
   * que fluye y se reflowa, documento Word tradicional) en vez del layout
   * 'absolute' por defecto (cada bloque anclado a su x/y exacto del lienzo,
   * ADR-139) -- ver report_routes.cpp POST /export/docx y
   * reportDocxBuilder.js::buildPageSection. */
  onExportDocxFlow?: () => void;
  /** Exporta a Excel (XLSX) -- alcance explícito: solo las tablas ya
   * insertadas en el informe (una hoja real por tabla + un índice con
   * hipervínculos), sin restricción de layoutMode. */
  onExportXlsx?: () => void;
  onExportPptx?: () => void;
  /** Abre el visualizador de PPT en pantalla completa (App.tsx::
   * handleStartPresentation) — solo tiene sentido con layoutMode
   * 'presentation', ver el `disabled` del botón más abajo. */
  onStartPresentation?: () => void;
  /** Convierte el último PPTX exportado en esta sesión a un MP4 sin
   * narración (Stage 3) — deshabilitado hasta que haya un job PPTX exitoso
   * (`canExportPptxVideo`), ver App.tsx::handleConvertPptxToVideo. */
  onExportPptxVideo?: () => void;
  canExportPptxVideo?: boolean;
  onExportMiningReport?: () => void;
  onImportMiningReport?: () => void;
  /** Importar un documento Word moderno (.docx) y pintarlo en el lienzo --
   * ribbon Datos > Importación, pedido explícito 2026-09-09. App.tsx abre el
   * selector de archivo (restringido a .docx) y arma los bloques con
   * mammoth.js + parseRichClipboardBlocks. */
  onImportDocx?: () => void;
  /** Importar un PDF con OCR AVANZADO (ADR-199) -- misma ubicación de ribbon
   * que onImportDocx. App.tsx sube el archivo al backend, que hace de proxy
   * hacia ai_engine/ocr_engine (PaddleOCR PP-StructureV2): texto digital
   * cuando el PDF ya lo trae, OCR real solo en páginas escaneadas. */
  onImportPdfOcr?: () => void;
  currentFontFamily?: string;
  currentFontSize?: number;
  currentFontColor?: string;
  currentHighlightColor?: string;
  currentHeadingStyle?: string;
  currentAlignment?: string;
  // Version & snapshot
  onCreateSnapshot?: () => void;
  onShowVersionHistory?: () => void;
  // Stage 2 props
  onShowComparator?: () => void;
  onToggleVoiceDictation?: () => void;
  onTogglePerfDashboard?: () => void;
  currentBold?: boolean;
  currentItalic?: boolean;
  currentUnderline?: boolean;
}

/** Miniatura 16:9 de un diseño de la galería de diapositivas (lib/slideLayouts.ts)
 * -- reproduce a escala chica la composición real (barra de acento, título,
 * cuerpo) de cada `kind`, para que la galería se elija por lo que se VE, no
 * solo por el nombre, mismo criterio que la miniatura de 3 barras de la
 * galería de tablas más abajo. */
function SlideLayoutPreview({ layout }: { layout: (typeof SLIDE_LAYOUT_TEMPLATES)[number] }) {
  const bar = (style: React.CSSProperties, key: string) => (
    <span key={key} style={{ position: 'absolute', borderRadius: 1, ...style }} />
  );
  const textBar = (top: number, left: number, width: number, height: number, color: string, key: string) =>
    bar({ top, left, width, height, background: color }, key);

  let content: React.ReactNode = null;
  switch (layout.kind) {
    case 'title-center':
      content = [
        textBar(20, 22, 26, 3, layout.accentColor, 'a'),
        textBar(26, 12, 46, 6, layout.textColor, 'b'),
        textBar(35, 20, 30, 3, layout.mutedColor, 'c'),
      ];
      break;
    case 'title-bar-top':
      content = [
        bar({ top: 0, left: 0, width: 4, height: 46, background: layout.accentColor }, 'a'),
        textBar(16, 10, 40, 6, layout.textColor, 'b'),
        textBar(25, 10, 30, 3, layout.mutedColor, 'c'),
      ];
      break;
    case 'section-divider':
      content = [
        textBar(20, 10, 20, 3, layout.accentColor, 'a'),
        textBar(25, 10, 44, 7, layout.textColor, 'b'),
      ];
      break;
    case 'title-content':
      content = [
        bar({ top: 8, left: 10, width: 16, height: 3, background: layout.accentColor }, 'a'),
        textBar(13, 10, 36, 5, layout.textColor, 'b'),
        textBar(24, 10, 44, 3, layout.textColor, 'c'),
        textBar(29, 10, 38, 3, layout.textColor, 'd'),
        textBar(34, 10, 41, 3, layout.textColor, 'e'),
      ];
      break;
    case 'two-column':
      content = [
        textBar(10, 10, 30, 4, layout.textColor, 'a'),
        bar({ top: 18, left: 34, width: 1, height: 20, background: layout.accentColor }, 'b'),
        textBar(20, 10, 20, 3, layout.textColor, 'c'),
        textBar(25, 10, 20, 3, layout.textColor, 'd'),
        textBar(20, 38, 20, 3, layout.textColor, 'e'),
        textBar(25, 38, 20, 3, layout.textColor, 'f'),
      ];
      break;
    case 'agenda':
      content = [
        textBar(9, 10, 22, 5, layout.textColor, 'a'),
        textBar(20, 10, 40, 3, layout.textColor, 'b'),
        textBar(26, 10, 44, 3, layout.textColor, 'c'),
        textBar(32, 10, 36, 3, layout.textColor, 'd'),
      ];
      break;
    case 'quote':
      content = [
        textBar(12, 14, 8, 8, layout.accentColor, 'a'),
        textBar(24, 16, 40, 3, layout.textColor, 'b'),
        textBar(29, 16, 32, 3, layout.textColor, 'c'),
      ];
      break;
    case 'stat':
      content = [
        textBar(14, 20, 32, 12, layout.textColor, 'a'),
        textBar(30, 26, 20, 3, layout.mutedColor, 'b'),
      ];
      break;
    case 'image-caption':
      content = [
        textBar(6, 10, 30, 4, layout.textColor, 'a'),
        bar({ top: 13, left: 16, width: 40, height: 20, background: layout.accentColor, opacity: 0.35 }, 'b'),
        textBar(35, 20, 32, 2, layout.mutedColor, 'c'),
      ];
      break;
    case 'closing':
      content = [
        textBar(18, 22, 28, 6, layout.textColor, 'a'),
        bar({ top: 27, left: 30, width: 12, height: 2, background: layout.accentColor }, 'b'),
        textBar(32, 22, 28, 2, layout.mutedColor, 'c'),
      ];
      break;
    default:
      break;
  }

  return (
    <span className="slide-layout-swatch-preview" style={{ background: layout.bgColor }}>
      {content}
    </span>
  );
}

export default function RibbonToolbar({
  onExportPdf, onGenerateShareLink, onExportVideo, onPrint, onReviewDocument, onOptimizeDocument,
  onZoomIn, onZoomOut, onZoomSet, gridEnabled, snapEnabled, onToggleGrid, onToggleSnap,
  isOptimizing, zoomPercent, onOpenReportsAdmin, onNewReport, onSaveReport,
  isSaving, saveLabel, onOpenFormulaAnalysis, onSyncMiningKpis, isSyncingKpis,
  kpiAutoSyncEnabled, onToggleKpiAutoSync, layoutMode, onLayoutModeChange,
  paperSize, onPaperSizeChange, orientation, onOrientationChange, pageMargins, onSetPageMargins,
  globalTextFormat, onApplyGlobalTextFormat, onOpenDocumentLayout,
  onInsertElement, onAddComment, onAddPage, onDuplicatePage, onAddTemplate, onOpenDocumentTemplates, onAddTechnicalBlock,
  onAddSectionTemplate, onAddStaticChart,
  onInsertShape,
  onApplyHeadingStyle, customTextStyles = [], onOpenSaveTextStyle, onDeleteCustomTextStyle,
  onToggleBold, onToggleItalic, onToggleUnderline,
  onCopy, onPaste,
  onSetAlignment, currentTextAlign, onSetFontFamily, onSetFontSize, onSetFontColor,
  onSetHighlightColor, onApplyCase,
  onSetListStyle, currentListStyle,
  onSetLineHeight, currentLineHeight,
  onInsertTOC, onInsertCoverPage, onApplySlideLayout, onStartWorkflow,
  onToggleLeftPanel, onToggleRightPanel, leftPanelVisible, rightPanelVisible,
  onExportDocx, onExportDocxFlow, onExportXlsx, onExportPptx, onStartPresentation, onExportPptxVideo, canExportPptxVideo, onExportMiningReport, onImportMiningReport, onImportDocx, onImportPdfOcr,
  onExportPdfUnprotected, canExportPdfUnprotected,
  noWatermark, onToggleNoWatermark, canToggleWatermark,
  currentFontFamily, currentFontSize, currentFontColor, currentHighlightColor, currentHeadingStyle,
  currentAlignment,
  onCreateSnapshot, onShowVersionHistory,
  onShowComparator, onToggleVoiceDictation, onTogglePerfDashboard,
  currentBold, currentItalic, currentUnderline
}: RibbonToolbarProps) {
  const [activeTab, setActiveTab] = useState('inicio');
  const [collapsed, setCollapsed] = useState(false);
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [showLineSpacing, setShowLineSpacing] = useState(false);
  const [showCoverDropdown, setShowCoverDropdown] = useState(false);
  const [showCalloutDropdown, setShowCalloutDropdown] = useState(false);
  const [showSectionDropdown, setShowSectionDropdown] = useState(false);
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showChartDropdown, setShowChartDropdown] = useState(false);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  // Suscripción puramente reactiva -- `canUndo`/`canRedo` son funciones que
  // leen arrays FUERA del store (ver useEditorStore.ts), así que su propia
  // referencia nunca cambia y no alcanza para volver a renderizar este
  // botón cuando el HISTORIAL cambia sin que cambie nada más que este
  // componente ya esté escuchando (bug real reportado 2026-09-10: el botón
  // "Deshacer"/"Rehacer" podía quedar mostrando un estado habilitado/
  // deshabilitado desfasado). No se usa el valor en sí, solo dispara el
  // re-render que hace que `disabled={!canUndo()}` de abajo se reevalúe.
  useEditorStore((s) => s.historyVersion);
  // Anclada por defecto (igual que Word/Office) — al desanclar, la barra se
  // oculta automáticamente al sacar el mouse y reaparece al pasar por encima
  // o al cambiar de pestaña, para ganar altura de lienzo.
  const [isPinned, setIsPinned] = useState(true);
  const shapePopover = usePopover();
  const coverPopover = usePopover();
  const boxhighPopover = usePopover();
  const tecnicPopover = usePopover();
  const charsPopover = usePopover();
  const interPopover = usePopover();
  const marginsPopover = usePopover();
  const slideLayoutPopover = usePopover();

  const applyGlobalParagraphNumber = (key: 'indentLeft' | 'indentRight' | 'spacingBefore' | 'spacingAfter', value: number, unit: 'cm' | 'pt') => {
    onApplyGlobalTextFormat?.({ [key]: Math.max(0, value || 0) * (unit === 'cm' ? CM_TO_PX : PT_TO_PX) });
  };

  const handleTabClick = useCallback((tab: string) => {
    if (activeTab === tab) {
      setCollapsed((c) => !c);
    } else {
      setActiveTab(tab);
      setCollapsed(false);
    }
  }, [activeTab]);

  const tabs = [
    { id: 'inicio',   label: 'Inicio' },
    { id: 'insertar', label: 'Insertar' },
    { id: 'diseno',   label: 'Diseño' },
    { id: 'revisar',  label: 'Revisar' },
    { id: 'datos',    label: 'Datos' },
    { id: 'exportar', label: 'Exportar' },
  ];

  return (
    <header
      className={`ribbon-toolbar ${collapsed ? 'ribbon-toolbar--collapsed' : ''} ocultar-al-imprimir`}
      onMouseLeave={() => { if (!isPinned) setCollapsed(true); }}
      onMouseEnter={() => setCollapsed(false)}
    >
      {/* Tab strip */}
      <div className="ribbon-tab-strip">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`ribbon-tab ${activeTab === t.id ? 'ribbon-tab--active' : ''}`}
            onClick={() => handleTabClick(t.id)}
            onDoubleClick={() => setCollapsed((c) => !c)}
          >
            {t.label}
          </button>
        ))}
        <div className="ribbon-tab-spacer" />
        <div className="ribbon-quick-actions">
          <RibbonBtn
            icon={isPinned ? Pin : PinOff}
            onClick={() => setIsPinned((p) => !p)}
            variant={isPinned ? 'pinned' : undefined}
            title={isPinned
              ? 'Barra de herramientas anclada — clic para que se oculte automáticamente al no usarse'
              : 'Barra de herramientas oculta automáticamente — clic para anclarla siempre visible'}
          />
          <RibbonBtn
            icon={Undo2}
            title="Deshacer el último cambio (Ctrl+Z)"
            onClick={undo}
            disabled={!canUndo()}
          />

          <RibbonBtn
            icon={Redo2}
            title="Rehacer el cambio deshecho (Ctrl+Y)"
            onClick={redo}
            disabled={!canRedo()}
          />
          <RibbonBtn icon={FilePlus2} label="Nuevo" onClick={onNewReport}
            disabled={isSaving} title="Crear un informe nuevo. Se guardará el informe actual antes de continuar." />
          <RibbonBtn icon={Save} label={saveLabel || 'Guardar'} onClick={onSaveReport}
            disabled={isSaving} variant="save" title="Guardar el informe en la base de datos" />
        </div>
      </div>

      {/* Ribbon body — only visible when not collapsed */}
      {!collapsed && (
        <div className="ribbon-body">
          {/* ═══════════════════ INICIO ═══════════════════ */}
          {activeTab === 'inicio' && (
            <>
              <RibbonGroup title="Portapapeles">
                <RibbonBtn icon={Clipboard} label="Pegar" onClick={onPaste} title="Pegar contenido del portapapeles" />
                <div className="ribbon-btn-col">
                  <RibbonBtn icon={Scissors} label="Cortar" title="Cortar la selección al portapapeles" />
                  <RibbonBtn icon={Copy} label="Copiar" onClick={onCopy} title="Copiar la selección al portapapeles" />
                </div>
              </RibbonGroup>

              <RibbonGroup title="Fuente">
                <div className="ribbon-font-row">
                  <select
                    className="ribbon-select ribbon-select--font"
                    value={currentFontFamily || 'Inter'}
                    onChange={(e) => onSetFontFamily?.(e.target.value)}
                    title="Elegir la familia tipográfica del texto"
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                    ))}
                  </select>
                  <select
                    className="ribbon-select ribbon-select--size"
                    value={currentFontSize || 12}
                    onChange={(e) => onSetFontSize?.(Number(e.target.value))}
                    title="Tamaño de la fuente en puntos"
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="ribbon-format-row">
                  <RibbonBtn icon={Bold} title="Aplicar negrita al texto (Ctrl+B)" onClick={onToggleBold} active={currentBold} />
                  <RibbonBtn icon={Italic} title="Aplicar cursiva al texto (Ctrl+I)" onClick={onToggleItalic} active={currentItalic} />
                  <RibbonBtn icon={Underline} title="Subrayar el texto (Ctrl+U)" onClick={onToggleUnderline} active={currentUnderline} />
                  <RibbonBtn
                    label="Aa"
                    title="Cambiar MAYÚSCULAS/minúsculas/Cada Palabra (como Word) — si hay una palabra seleccionada en el editor, se aplica solo a ella"
                    onClick={onApplyCase}
                  />
                  <div className="ribbon-color-btn-wrap">
                    <ColorPalette
                      value={currentFontColor || '#1e293b'}
                      title="Elegir el color del texto — si hay una palabra seleccionada en el editor, se aplica solo a ella"
                      onChange={(color) => onSetFontColor?.(color)}
                    />
                  </div>
                  <Highlighter size={13} className="ribbon-highlight-icon" />
                  <div className="ribbon-color-btn-wrap">
                    <ColorPalette
                      value={currentHighlightColor || 'transparent'}
                      title="Color de resaltado del texto — si hay una palabra seleccionada en el editor, se aplica solo a ella"
                      allowClear
                      onChange={(color) => onSetHighlightColor?.(color)}
                      onClear={() => onSetHighlightColor?.('transparent')}
                    />
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Párrafo">
                <div className="ribbon-format-row">
                  <RibbonBtn icon={AlignLeft} title="Alinear a la izquierda el bloque de texto seleccionado" onClick={() => onSetAlignment?.('left')}
                    active={currentTextAlign === 'left'} />
                  <RibbonBtn icon={AlignCenter} title="Centrar el bloque de texto seleccionado" onClick={() => onSetAlignment?.('center')}
                    active={currentTextAlign === 'center'} />
                  <RibbonBtn icon={AlignRight} title="Alinear a la derecha el bloque de texto seleccionado" onClick={() => onSetAlignment?.('right')}
                    active={currentTextAlign === 'right'} />
                  <RibbonBtn icon={AlignJustify} title="Justificar el bloque de texto seleccionado" onClick={() => onSetAlignment?.('justify')}
                    active={currentTextAlign === 'justify'} />
                </div>
                <div className="ribbon-format-row">
                  <RibbonBtn icon={List} title="Crear lista con viñetas"
                    onClick={() => onSetListStyle?.(currentListStyle === 'bullet' ? 'none' : 'bullet')}
                    active={currentListStyle === 'bullet'} />
                  <RibbonBtn icon={ListOrdered} title="Crear lista numerada"
                    onClick={() => onSetListStyle?.(currentListStyle === 'number' ? 'none' : 'number')}
                    active={currentListStyle === 'number'} />
                  <div ref={interPopover.rootRef} style={{ display: 'inline-block' }}>
                    <RibbonBtn
                      icon={Minus}
                      title={`Interlineado del bloque seleccionado: ${(Number(currentLineHeight) || 1.35).toFixed(2)} — clic para cambiarlo`}
                      onClick={interPopover.toggle}
                      active={showLineSpacing}
                    />
                    {interPopover.isOpen && createPortal (
                      <div
                        ref={interPopover.popoverRef}
                        className="ribbon-cover-dropdown"
                        style={{ position: 'fixed', top: `${interPopover.coords.top}px`, left: `${interPopover.coords.left}px`, zIndex: 99999 }}
                      >
                        <div className="ribbon-line-spacing-popover" onMouseLeave={() => setShowLineSpacing(false)}>
                          <span className="ribbon-line-spacing-title">
                            Interlineado {(Number(currentLineHeight) || 1.35).toFixed(2)}
                          </span>
                          <div className="ribbon-line-spacing-presets">
                            {[
                              { value: 1, label: 'Sencillo' },
                              { value: 1.15, label: '1,15' },
                              { value: 1.35, label: '1,35' },
                              { value: 1.5, label: '1,5' },
                              { value: 2, label: 'Doble' },
                            ].map((preset) => {
                              const active = Math.abs((Number(currentLineHeight) || 1.35) - preset.value) < 0.001;
                              return (
                                <button
                                  key={preset.value}
                                  type="button"
                                  className={`ribbon-line-spacing-preset${active ? ' ribbon-line-spacing-preset--active' : ''}`}
                                  onClick={() => { onSetLineHeight?.(preset.value); setShowLineSpacing(false); }}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                          <input
                            type="number"
                            step={0.05}
                            min={0.8}
                            max={3}
                            className="ribbon-line-spacing-custom"
                            value={Number(currentLineHeight) || 1.35}
                            onChange={(e) => onSetLineHeight?.(Math.max(0.8, Number(e.target.value) || 1.35))}
                          />
                        </div>
                      </div>,
                      document.body
                      
                    )}
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Estilos">
                {/* .ribbon-group-content del padre es un flex ROW — sin este
                   envoltorio en columna, la etiqueta y la fila de chips
                   quedaban como items lado a lado (solo 3px de por medio),
                   no apiladas verticalmente como parecía en el CSS. */}
                <div className="ribbon-styles-block">
                  <div className="ribbon-current-style">
                    <span className="ribbon-current-style-text">
                      Estilo actual: <b>{HEADING_STYLES.find((hs) => hs.id === currentHeadingStyle)?.label
                        || customTextStyles.find((cs) => cs.id === currentHeadingStyle)?.label
                        || 'Normal'}</b>
                    </span>
                    <button
                      type="button"
                      className="ribbon-style-save-btn"
                      onClick={onOpenSaveTextStyle}
                      title="Guardar el formato actual como un estilo personalizado nuevo -- como 'Crear nuevo estilo a partir del formato' en Word"
                    >
                      <BookmarkPlus size={12} />
                    </button>
                  </div>
                  <div className="ribbon-styles-strip">
                    {HEADING_STYLES.map((hs) => (
                      <button
                        key={hs.id}
                        className={`ribbon-style-chip ${currentHeadingStyle === hs.id ? 'ribbon-style-chip--active' : ''}`}
                        onClick={() => onApplyHeadingStyle?.(hs)}
                        title={`Aplicar estilo ${hs.label}`}
                        style={{ fontSize: Math.min(hs.fontSize * 0.55, 13), fontWeight: hs.fontWeight, color: hs.color }}
                      >
                        {hs.label}
                      </button>
                    ))}
                    {customTextStyles.map((cs) => (
                      <div className="ribbon-style-chip-wrap" key={cs.id}>
                        <button
                          className={`ribbon-style-chip ${currentHeadingStyle === cs.id ? 'ribbon-style-chip--active' : ''}`}
                          onClick={() => onApplyHeadingStyle?.(cs)}
                          title={`Aplicar estilo personalizado "${cs.label}"`}
                          style={{ fontSize: Math.min(cs.fontSize * 0.55, 13), fontWeight: cs.fontWeight, color: cs.color }}
                        >
                          {cs.label}
                        </button>
                        <button
                          type="button"
                          className="ribbon-style-chip-delete"
                          title={`Eliminar el estilo personalizado "${cs.label}"`}
                          onClick={(e) => { e.stopPropagation(); onDeleteCustomTextStyle?.(cs.id); }}
                        >
                          <X size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ INSERTAR ═══════════════════ */}
          {activeTab === 'insertar' && (
            <>
              <RibbonGroup title="Páginas">
                <RibbonBtn icon={FilePlus2} label="Nueva página" onClick={onAddPage} title="Añadir una página en blanco al informe" />
                <RibbonBtn icon={Copy} label="Duplicar" onClick={onDuplicatePage} title="Duplicar la página actual con su contenido" />
              </RibbonGroup>

              <RibbonGroup title="Contenido">
                <RibbonBtn icon={Type} label="Texto" onClick={() => onInsertElement?.('text')} title="Insertar un bloque de texto" />
                <div ref={shapePopover.rootRef} style={{ display: 'inline-block' }}>
                  <RibbonBtn icon={BoxIcon} label="Forma" onClick={shapePopover.toggle} title="Insertar una forma" />
                  {shapePopover.isOpen && createPortal(
                    <div
                      ref={shapePopover.popoverRef}
                      className="ribbon-shape-dropdown"
                      style={{ position: 'fixed', top: shapePopover.coords.top, left: shapePopover.coords.left }}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      {SHAPE_OPTIONS.map((shape) => (
                        <button
                          key={shape.id}
                          type="button"
                          className="ribbon-shape-option"
                          onClick={() => { onInsertShape?.(shape.id); shapePopover.close(); }}
                        >
                          <span className={`ribbon-shape-preview ribbon-shape-preview--${shape.id}`} aria-hidden="true" />
                          <span>{shape.label}</span>
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )}
                </div>
                <RibbonBtn icon={ImageIcon} label="Imagen" onClick={() => onInsertElement?.('image')} title="Insertar una imagen en la página" />
                <RibbonBtn icon={Video} label="Video" onClick={() => onInsertElement?.('video')} title="Grabar y insertar un video (cámara web o pantalla/ventana) en la página" />
                <RibbonBtn icon={TableIcon} label="Tabla" onClick={() => onInsertElement?.('table')} title="Insertar una tabla de filas y columnas" />
                <RibbonBtn icon={BarChart3} label="Gráfico" onClick={() => onInsertElement?.('chart')} title="Insertar un gráfico de datos" />
                <RibbonBtn icon={Target} label="KPI" onClick={() => onInsertElement?.('kpi')} title="Insertar un indicador KPI" />
                <RibbonBtn icon={MapIcon} label="Mapa" onClick={() => onInsertElement?.('map')} title="Insertar un mapa detallado de la mina" />
                {/* 'sensor' (lectura única) retirado — reemplazado por
                   'sensor_multi_chart' (wizard con zona/unidad/tipo de
                   gráfico Apache ECharts/rango de fecha), mismo criterio que
                   LeftLibrary.tsx. */}
                <RibbonBtn icon={Radar} label="Sensor" onClick={() => onInsertElement?.('sensor_multi_chart')} title="Insertar un gráfico de sensores en tiempo real: elija tipo, zona, unidad, tipo de gráfico (Apache ECharts) y rango de fecha" />
                <RibbonBtn icon={Waves} label="Sismos" onClick={() => onInsertElement?.('seismic-report')} title="Insertar el reporte sísmico: sismos oficiales IGP/CENSIS y/o microsismicidad de la red propia, con rango de fechas seleccionable" />
              </RibbonGroup>

              <RibbonGroup title="Documento">
                <RibbonBtn icon={BookOpen} label="Índice" onClick={onInsertTOC} title="Insertar tabla de contenidos automática" />
                <RibbonBtn icon={Hash} label="Numeración" title="Activar numeración automática de páginas" />
                <RibbonBtn icon={MessageSquare} label="Comentario" onClick={onAddComment} title="Agregar un comentario al bloque seleccionado o al inicio de la página" />
                <div className="ribbon-cover-wrap">
                  <RibbonBtn
                    icon={Link2}
                    label="Referencia"
                    onClick={() => setShowRefDropdown((v) => !v)}
                    title="Insertar una referencia cruzada a un encabezado (ADR-019) — el número se resuelve solo y se actualiza si el documento se reordena"
                  />
                  {showRefDropdown && (
                    <div className="ribbon-cover-dropdown" onMouseLeave={() => setShowRefDropdown(false)}>
                      {(() => {
                        const tocItems = generateTocData(useEditorStore.getState().doc);
                        if (tocItems.length === 0) {
                          return (
                            <div className="ribbon-cover-option" style={{ cursor: 'default', opacity: 0.7 }}>
                              <span className="ribbon-cover-desc">
                                Sin encabezados en el documento — aplique Título/Heading a un bloque de texto primero.
                              </span>
                            </div>
                          );
                        }
                        return tocItems.map((item) => (
                          <button
                            key={item.id}
                            className="ribbon-cover-option"
                            onClick={() => {
                              tryInsertRefAtActiveTextSelection(item.id);
                              setShowRefDropdown(false);
                            }}
                          >
                            <span className="ribbon-cover-label">{item.number}</span>
                            <span className="ribbon-cover-desc">{item.text}</span>
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                </div>
                <div ref={coverPopover.rootRef} style={{ display: 'inline-block' }}>
                  <RibbonBtn icon={LayoutTemplate} label="Carátula" onClick={coverPopover.toggle} title="Insertar una carátula de informe" />
                  {coverPopover.isOpen && createPortal(
                    <div 
                      ref={coverPopover.popoverRef}
                      className="ribbon-cover-dropdown" 
                      style={{
                        position: 'fixed',
                        top: `${coverPopover.coords.top}px`,
                        left: `${coverPopover.coords.left}px`,
                        bottom: 'auto',
                        right: 'auto',
                        margin: 0,
                        zIndex: 99999,
                      }}
                    >
                      {COVER_TEMPLATES.map((ct) => (
                        <button
                          key={ct.id}
                          className="ribbon-cover-option"
                          onClick={() => { 
                            onInsertCoverPage?.(ct.id); 
                            setShowCoverDropdown(false); 
                          }}
                        >
                          <span className="ribbon-cover-label">{ct.label}</span>
                          <span className="ribbon-cover-desc">{ct.desc}</span>
                        </button>
                      ))}
                    </div>,
                    document.body
                  )}
                </div>
              </RibbonGroup>

              <RibbonGroup title="Plantillas">
                <RibbonBtn icon={FileText} label="Hallazgos" onClick={() => onAddTemplate?.('findings')} title="Insertar plantilla de hallazgos técnicos" />
                <RibbonBtn icon={FileStack} label="Doc. Completo" onClick={() => onOpenDocumentTemplates?.()} variant="ai"
                  title="Elegir una plantilla de documento completo (Informe Técnico, Propuesta, Mantenimiento, etc.) — reemplaza todo el informe, personalizado con tu empresa/unidad minera" />
              </RibbonGroup>

              {/* ── Bloques Técnicos (presentación avanzada del modelo minero) ── */}
              <RibbonGroup title="Bloques Técnicos">
                <div ref={boxhighPopover.rootRef} style={{ display: 'inline-block' }}>
                  <RibbonBtn icon={Info} label="Caja resaltado" onClick={boxhighPopover.toggle}
                    title="Insertar una caja de resaltado semántica (Nota, Conforme, Observación, Crítico, Dictamen)" variant="ai" />
                  {boxhighPopover.isOpen && createPortal (
                    <div 
                      ref={boxhighPopover.popoverRef}
                      className="ribbon-cover-dropdown"
                      style={{ position: 'fixed', top: `${boxhighPopover.coords.top}px`, left: `${boxhighPopover.coords.left}px`, zIndex: 99999 }}
                    >
                      <div className="ribbon-cover-dropdown" onMouseLeave={() => setShowCalloutDropdown(false)}>
                        {CALLOUT_OPTIONS.map((co) => (
                          <button
                            key={co.id}
                            className="ribbon-cover-option"
                            onClick={() => { onAddTechnicalBlock?.(co.id); setShowCalloutDropdown(false); }}
                          >
                            <span className="ribbon-callout-swatch" style={{ background: co.bg, borderColor: co.border }} aria-hidden />
                            <span className="ribbon-cover-label">{co.label}</span>
                            <span className="ribbon-cover-desc">{co.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                <RibbonBtn icon={LayoutGrid} label="Tarjetas KPI" onClick={() => onAddTechnicalBlock?.('kpi-strip')}
                  title="Insertar una tira de 4 tarjetas KPI (valor + meta), como el dashboard ejecutivo del modelo" />
                <RibbonBtn icon={Captions} label="Pie de figura" onClick={() => onAddTechnicalBlock?.('caption')}
                  title="Insertar un pie de figura con estilo (itálica azul, centrado): «Figura N. …»" />
              </RibbonGroup>

              {/* ── Plantillas de sección especializadas del modelo minero ── */}
              <RibbonGroup title="Secciones">
                <div ref={tecnicPopover.rootRef} style={{ display: 'inline-block' }}>
                  <RibbonBtn icon={Rows3} label="Sección técnica" onClick={tecnicPopover.toggle}
                    title="Insertar una sección con tabla especializada pre-armada (estado por sistema, inventario, TARP, hallazgos, plan de acción, ficha de sensor, checklist, firmas…)" variant="reports" />
                  {tecnicPopover.isOpen && createPortal (
                    <div 
                      ref={tecnicPopover.popoverRef}
                      className="ribbon-cover-dropdown"
                      style={{ position: 'fixed', top: `${tecnicPopover.coords.top}px`, left: `${tecnicPopover.coords.left}px`, zIndex: 99999 }}
                    >
                      <div className="ribbon-cover-dropdown ribbon-cover-dropdown--tall" onMouseLeave={() => setShowSectionDropdown(false)}>
                        {SECTION_OPTIONS.map((so) => (
                          <button
                            key={so.id}
                            className="ribbon-cover-option"
                            onClick={() => { onAddSectionTemplate?.(so.id); setShowSectionDropdown(false); }}
                          >
                            <span className="ribbon-cover-label">{so.label}</span>
                            <span className="ribbon-cover-desc">{so.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              </RibbonGroup>

              {/* ── Gráficos estáticos con datos (las 3 figuras del modelo) ── */}
              <RibbonGroup title="Gráficos con datos">
                <div ref={charsPopover.rootRef} style={{ display: 'inline-block' }}>
                  <RibbonBtn icon={LineChart} label="Gráfico de datos" onClick={charsPopover.toggle}
                    title="Insertar un gráfico con datos ingresados: línea con meta, barras horizontales o combo de doble eje" variant="primary" />
                  {charsPopover.isOpen && createPortal (
                    <div 
                      ref={charsPopover.popoverRef}
                      className="ribbon-cover-dropdown"
                      style={{ position: 'fixed', top: `${charsPopover.coords.top}px`, left: `${charsPopover.coords.left}px`, zIndex: 99999 }}
                    >
                      <div className="ribbon-cover-dropdown" onMouseLeave={() => setShowChartDropdown(false)}>
                        {CHART_OPTIONS.map((ch) => (
                          <button
                            key={ch.id}
                            className="ribbon-cover-option"
                            onClick={() => { onAddStaticChart?.(ch.id); setShowChartDropdown(false); }}
                          >
                            <span className="ribbon-cover-label">{ch.label}</span>
                            <span className="ribbon-cover-desc">{ch.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ DISEÑO ═══════════════════ */}
          {activeTab === 'diseno' && (
            <>
              <RibbonGroup title="Formato página">
                <label className="ribbon-field">
                  <span>Formato</span>
                  <select className="ribbon-select"
                    value={layoutMode === 'presentation' ? 'presentation' : 'document'}
                    onChange={(e) => onLayoutModeChange?.(e.target.value)}
                    title="Formato del lienzo: documento o presentación PPT"
                  >
                    <option value="document">Documento</option>
                    <option value="presentation">PPT</option>
                  </select>
                </label>
                {layoutMode !== 'presentation' && (
                  <>
                    <label className="ribbon-field">
                      <span>Tamaño</span>
                      <select className="ribbon-select"
                        value={paperSize === 'A3' ? 'A3' : 'A4'}
                        onChange={(e) => onPaperSizeChange?.(e.target.value)}
                        title="Tamaño de hoja del documento — el ancho del lienzo se ajusta proporcionalmente"
                      >
                        <option value="A4">A4 (210 × 297 mm)</option>
                        <option value="A3">A3 (297 × 420 mm)</option>
                      </select>
                    </label>
                    <label className="ribbon-field">
                      <span>Orientación</span>
                      <select className="ribbon-select"
                        value={orientation === 'landscape' ? 'landscape' : 'portrait'}
                        onChange={(e) => onOrientationChange?.(e.target.value)}
                        title="Orientación de página — intercambia ancho y alto manteniendo el tamaño de hoja"
                      >
                        <option value="portrait">Vertical</option>
                        <option value="landscape">Horizontal</option>
                      </select>
                    </label>
                  </>
                )}
              </RibbonGroup>

              {layoutMode === 'presentation' && (
                <RibbonGroup title="Diseño de Diapositiva">
                  <div ref={slideLayoutPopover.rootRef} style={{ display: 'inline-block' }}>
                    <RibbonBtn icon={LayoutTemplate} label="Galería" onClick={slideLayoutPopover.toggle}
                      title="Elegir un diseño para la diapositiva actual (reemplaza su contenido, conserva encabezado/pie salvo en diseños a pantalla completa)" />
                    {slideLayoutPopover.isOpen && createPortal(
                      <div
                        ref={slideLayoutPopover.popoverRef}
                        className="slide-layout-dropdown"
                        style={{ position: 'fixed', top: `${slideLayoutPopover.coords.top}px`, left: `${slideLayoutPopover.coords.left}px`, zIndex: 99999 }}
                      >
                        {SLIDE_LAYOUT_TEMPLATES.map((sl) => (
                          <button
                            key={sl.id}
                            type="button"
                            className="slide-layout-swatch"
                            title={sl.desc}
                            onClick={() => { onApplySlideLayout?.(sl.id); slideLayoutPopover.close(); }}
                          >
                            <SlideLayoutPreview layout={sl} />
                            <span className="slide-layout-swatch-label">{sl.label}</span>
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                  </div>
                </RibbonGroup>
              )}

              {layoutMode !== 'presentation' && (
                <RibbonGroup title="Márgenes">
                  <div ref={marginsPopover.rootRef} className="ribbon-margin-control">
                    <RibbonBtn icon={Ruler} label="Márgenes" title="Elegir márgenes preestablecidos para todo el documento" onClick={marginsPopover.toggle} />
                    {marginsPopover.isOpen && createPortal(
                      <div ref={marginsPopover.popoverRef} className="ribbon-cover-dropdown ribbon-margins-dropdown" style={{ position: 'fixed', top: `${marginsPopover.coords.top}px`, left: `${marginsPopover.coords.left}px`, zIndex: 99999 }}>
                        {[
                          { id: 'normal', label: 'Normal', detail: '2,54 cm en todos los lados', margins: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 } },
                          { id: 'narrow', label: 'Estrecho', detail: '1,27 cm en todos los lados', margins: { top: 1.27, right: 1.27, bottom: 1.27, left: 1.27 } },
                          { id: 'moderate', label: 'Moderado', detail: '2,54 cm arriba/abajo · 1,91 cm laterales', margins: { top: 2.54, right: 1.91, bottom: 2.54, left: 1.91 } },
                          { id: 'wide', label: 'Ancho', detail: '2,54 cm arriba/abajo · 5,08 cm laterales', margins: { top: 2.54, right: 5.08, bottom: 2.54, left: 5.08 } },
                        ].map((preset) => (
                          <button key={preset.id} type="button" className="ribbon-cover-option" onClick={() => { onSetPageMargins?.({ top: preset.margins.top * CM_TO_PX, right: preset.margins.right * CM_TO_PX, bottom: preset.margins.bottom * CM_TO_PX, left: preset.margins.left * CM_TO_PX }); marginsPopover.close(); }}>
                            <span className="ribbon-cover-label">{preset.label}</span><span className="ribbon-cover-desc">{preset.detail}</span>
                          </button>
                        ))}
                        <button type="button" className="ribbon-cover-option ribbon-margins-dropdown__custom" onClick={() => { marginsPopover.close(); onOpenDocumentLayout?.(); }}>
                          <span className="ribbon-cover-label">Márgenes personalizados…</span><span className="ribbon-cover-desc">Editar márgenes y párrafo global</span>
                        </button>
                      </div>,
                      document.body,
                    )}
                  </div>
                  <div className="ribbon-margin-summary" title="Márgenes actuales del documento">
                    <span className='text-white'>Sup. {((pageMargins?.top || 0) / CM_TO_PX).toFixed(1)}</span>
                    <span className='text-white'>Lat. {((pageMargins?.left || 0) / CM_TO_PX).toFixed(1)}</span>
                    <button type="button" onClick={onOpenDocumentLayout} title="Editar márgenes personalizados">⋯</button>
                  </div>
                </RibbonGroup>
              )}

              {layoutMode !== 'presentation' && (
                <RibbonGroup title="Párrafo">
                  <div className="ribbon-paragraph-global-row">
                    <label title="Sangría izquierda global"><span className='text-white'>Izq.</span><input type="number" min="0" step="0.1" value={Number(((globalTextFormat?.indentLeft || 0) / CM_TO_PX).toFixed(2))} onChange={(e) => applyGlobalParagraphNumber('indentLeft', Number(e.target.value), 'cm')} /><small>cm</small></label>
                    <label title="Sangría derecha global"><span className='text-white'>Der.</span><input type="number" min="0" step="0.1" value={Number(((globalTextFormat?.indentRight || 0) / CM_TO_PX).toFixed(2))} onChange={(e) => applyGlobalParagraphNumber('indentRight', Number(e.target.value), 'cm')} /><small>cm</small></label>
                    <label title="Espacio global antes del texto"><span className='text-white'>Antes</span><input type="number" min="0" step="1" value={Number(((globalTextFormat?.spacingBefore || 0) / PT_TO_PX).toFixed(1))} onChange={(e) => applyGlobalParagraphNumber('spacingBefore', Number(e.target.value), 'pt')} /><small>pt</small></label>
                    <label title="Espacio global después del texto"><span className='text-white'>Después</span><input type="number" min="0" step="1" value={Number(((globalTextFormat?.spacingAfter || 0) / PT_TO_PX).toFixed(1))} onChange={(e) => applyGlobalParagraphNumber('spacingAfter', Number(e.target.value), 'pt')} /><small>pt</small></label>
                    <RibbonBtn icon={SlidersHorizontal} title="Abrir propiedades globales de documento y párrafo" onClick={onOpenDocumentLayout} />
                  </div>
                </RibbonGroup>
              )}

              <RibbonGroup title="Cuadrícula">
                <RibbonBtn icon={Grid} label="Grid" onClick={onToggleGrid} active={gridEnabled} title={gridEnabled ? 'Ocultar cuadrícula del lienzo' : 'Mostrar cuadrícula de alineación'} />
                <RibbonBtn icon={MousePointer2} label="Snap" onClick={onToggleSnap} active={snapEnabled} title={snapEnabled ? 'Desactivar ajuste a cuadrícula' : 'Ajustar bloques a la cuadrícula'} />
                <RibbonBtn icon={Gauge} label="Perf" title="Abrir monitor de rendimiento (Ctrl+Shift+P)" onClick={onTogglePerfDashboard} variant="ai" />
              </RibbonGroup>

              <RibbonGroup title="Zoom">
                <RibbonBtn icon={ZoomOut} onClick={onZoomOut} title="Alejar la vista del lienzo (10% mínimo)" />
                <div className="ribbon-zoom-control" style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="ribbon-zoom-chip ribbon-zoom-chip--btn"
                    title={`Zoom actual: ${zoomPercent}% — clic para elegir un valor (10%-400%)`}
                    onClick={() => setShowZoomDropdown((v) => !v)}
                  >
                    {zoomPercent}%
                  </button>
                  {showZoomDropdown && (
                    <div className="ribbon-zoom-dropdown" onMouseLeave={() => setShowZoomDropdown(false)}>
                      <input
                        type="range"
                        min={10}
                        max={400}
                        step={5}
                        value={zoomPercent}
                        onChange={(e) => onZoomSet?.(Number(e.target.value))}
                        className="ribbon-zoom-slider"
                      />
                      <div className="ribbon-zoom-presets">
                        {[10, 25, 50, 75, 100, 125, 150, 200, 300, 400].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`ribbon-zoom-preset${zoomPercent === p ? ' ribbon-zoom-preset--active' : ''}`}
                            onClick={() => { onZoomSet?.(p); setShowZoomDropdown(false); }}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                      <div className="ribbon-zoom-custom">
                        <label>Personalizado</label>
                        <input
                          type="number"
                          min={10}
                          max={400}
                          value={zoomPercent}
                          onChange={(e) => onZoomSet?.(Number(e.target.value))}
                        />
                        <span>%</span>
                      </div>
                    </div>
                  )}
                </div>
                <RibbonBtn icon={ZoomIn} onClick={onZoomIn} title="Acercar la vista del lienzo (400% máximo)" />
              </RibbonGroup>

              <RibbonGroup title="Paneles">
                <RibbonBtn icon={PanelLeftClose} label="Izquierdo"
                  onClick={onToggleLeftPanel} active={leftPanelVisible} title="Mostrar u ocultar la biblioteca de contenidos" />
                <RibbonBtn icon={PanelRightClose} label="Derecho"
                  onClick={onToggleRightPanel} active={rightPanelVisible} title="Mostrar u ocultar el panel de propiedades" />
                <RibbonBtn icon={Maximize2} label="Foco" title="Maximizar el área de edición del lienzo" />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ REVISAR ═══════════════════ */}
          {activeTab === 'revisar' && (
            <>
              <RibbonGroup title="Calidad">
                <RibbonBtn icon={ScanSearch} label="Revisar" onClick={onReviewDocument} title="Revisar ortografía, consistencia y calidad del informe" />
                <RibbonBtn icon={Sparkles} label={isOptimizing ? 'Analizando…' : 'Optimizar IA'}
                  onClick={onOptimizeDocument} disabled={isOptimizing} variant="ai"
                  title="Mejorar redacción y claridad del texto con inteligencia artificial" />
              </RibbonGroup>

              <RibbonGroup title="Workflow">
                <RibbonBtn icon={CheckSquare} label="Aprobar" onClick={onStartWorkflow}
                  variant="workflow" title="Iniciar el flujo de aprobación del informe" />
                <RibbonBtn icon={Shield} label="Bitácora" title="Ver la bitácora forense de cambios" onClick={onStartWorkflow} />
                <RibbonBtn icon={Clock} label="Versiones" title="Consultar el historial de versiones del informe" onClick={onShowVersionHistory} />
                <RibbonBtn icon={Camera} label="Snapshot" title="Guardar una instantánea del informe en este momento" onClick={onCreateSnapshot} />
                <RibbonBtn icon={ArrowLeftRight} label="Comparar" title="Comparar dos versiones del informe lado a lado" onClick={onShowComparator} variant="primary" />
              </RibbonGroup>

              <RibbonGroup title="Dictado">
                <RibbonBtn icon={Mic} label="Voz" title="Dictar texto con el micrófono (Ctrl+Shift+V)" onClick={onToggleVoiceDictation} variant="workflow" />
              </RibbonGroup>

              <RibbonGroup title="Motor IA">
                <RibbonBtn icon={Sigma} label="FORMULA" onClick={onOpenFormulaAnalysis}
                  variant="formula" title="Ejecutar el motor FORMULA para generar reportes mineros" />
                <RibbonBtn icon={RefreshCw} label={isSyncingKpis ? 'Sync...' : 'Sync KPI'}
                  onClick={onSyncMiningKpis} disabled={isSyncingKpis} title="Sincronizar indicadores KPI desde datos operativos" />
                <RibbonBtn icon={RefreshCw} label={kpiAutoSyncEnabled ? 'Auto ON' : 'Auto OFF'}
                  onClick={onToggleKpiAutoSync} active={kpiAutoSyncEnabled}
                  title={kpiAutoSyncEnabled ? 'Desactivar sincronización automática de KPI' : 'Activar sincronización automática de KPI cada 3 minutos'} />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ DATOS ═══════════════════ */}
          {activeTab === 'datos' && (
            <>
              <RibbonGroup title="Informes">
                <RibbonBtn icon={FolderOpen} label="Mis Informes" onClick={onOpenReportsAdmin}
                  variant="reports" title="Abrir la biblioteca de informes técnicos guardados" />
                <RibbonBtn icon={FilePlus2} label="Nuevo informe" onClick={onNewReport}
                  disabled={isSaving} title="Crear un informe nuevo y conservar los cambios del informe actual" />
                <RibbonBtn icon={Save} label={saveLabel} onClick={onSaveReport}
                  disabled={isSaving} variant="save" title="Guardar el informe actual" />
              </RibbonGroup>

              <RibbonGroup title="Portabilidad">
                <RibbonBtn icon={FileDown} label="Exportar archivo portátil"
                  onClick={onExportMiningReport} variant="portable" title="Exportar el informe a un archivo .mreport cifrado — mismo tenant: se abre sin cambios; otra unidad minera: solo estructura, sin imágenes/KPIs/gráficos" />
                <RibbonBtn icon={FileUp} label="Importar archivo portátil"
                  onClick={onImportMiningReport} variant="portable" title="Importar un informe desde un archivo .mreport" />
              </RibbonGroup>

              <RibbonGroup title="Importación">
                <RibbonBtn icon={FileInput} label="Importar Word (.docx)"
                  onClick={onImportDocx} title="Importar un documento Word moderno (.docx) y agregarlo al lienzo" />
                <RibbonBtn icon={ScanSearch} label="Importar PDF/Imagen (OCR)"
                  onClick={onImportPdfOcr} title="Importar un PDF o imagen PNG/JPG/JPEG/BMP con OCR avanzado y agregarlo al lienzo" />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ EXPORTAR ═══════════════════ */}
          {activeTab === 'exportar' && (
            <>
              <RibbonGroup title="Documentos">
                <RibbonBtn icon={Download} label="PDF" onClick={onExportPdf} variant="primary" title="Exportar el informe como archivo PDF (protegido con contraseña de acceso)" />
                {canExportPdfUnprotected && (
                  <RibbonBtn icon={Unlock} label="PDF (sin contraseña)" onClick={onExportPdfUnprotected} title="Exportar el PDF SIN contraseña de acceso -- disponible solo para perfiles avanzados (informes.export_sin_clave)" />
                )}
                {canToggleWatermark && (
                  <RibbonBtn icon={Droplets} label="Sin sello de agua" onClick={onToggleNoWatermark} active={noWatermark}
                    title={noWatermark
                      ? 'El próximo PDF exportado va SIN sello de agua -- click para volver a incluirlo'
                      : 'Exportar el próximo PDF SIN sello de agua "CONFIDENCIAL" -- disponible solo para perfiles avanzados (informes.export_sin_marca_agua)'} />
                )}
                <RibbonBtn icon={FileText} label="DOCX" onClick={onExportDocx} title="Exportar el informe como documento Word (DOCX) -- cada bloque queda anclado a su posición exacta del lienzo (cuadros de texto independientes), máxima fidelidad de layout" />
                <RibbonBtn icon={FileText} label="DOCX (fluido)" onClick={onExportDocxFlow} title="Exportar como documento Word tradicional: el texto fluye y se reflowa en orden de lectura normal, sin cuadros de texto independientes (menor fidelidad de layout que 'DOCX')" />
                <RibbonBtn icon={FileSpreadsheet} label="XLSX" onClick={onExportXlsx} title="Exportar a Excel las tablas ya insertadas en el informe (una hoja real por tabla + un índice con hipervínculos)" />
                <RibbonBtn icon={Layers} label="PPTX" onClick={onExportPptx} title="Exportar el informe como presentación PowerPoint" />
              </RibbonGroup>

              <RibbonGroup title="Presentación">
                <RibbonBtn icon={Play} label="Presentar" onClick={onStartPresentation}
                  disabled={layoutMode !== 'presentation'}
                  title={layoutMode === 'presentation'
                    ? 'Ver la presentación en pantalla completa (flechas/espacio para pasar diapositiva, Esc para salir)'
                    : 'Disponible solo en modo presentación'} />
              </RibbonGroup>

              <RibbonGroup title="Acceso directo">
                <RibbonBtn icon={Link2} label="Enlace + QR" onClick={onGenerateShareLink}
                  title="Generar un enlace/QR que abre el PDF directo al escanearlo, sin contraseña (vence en 48h)" />
              </RibbonGroup>

              <RibbonGroup title="Impresión">
                <RibbonBtn icon={Printer} label="Imprimir" onClick={onPrint} dataAction="print" title="Imprimir el informe o abrir vista previa de impresión" />
              </RibbonGroup>

              <RibbonGroup title="Video">
                <RibbonBtn icon={Video} label="Grabar"
                  onClick={onExportVideo}
                  title="Grabar un vídeo de pantalla/ventana e insertarlo en la página activa" />
                <RibbonBtn icon={Video} label="Convertir a MP4"
                  onClick={onExportPptxVideo}
                  disabled={!canExportPptxVideo}
                  title={canExportPptxVideo
                    ? 'Convertir el último PPTX exportado en esta sesión a un vídeo (sin narración)'
                    : 'Exporta primero el informe a PPTX para poder convertirlo a vídeo'} />
              </RibbonGroup>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export { HEADING_STYLES, COVER_TEMPLATES, FONT_FAMILIES, FONT_SIZES, MINING_COLORS };
