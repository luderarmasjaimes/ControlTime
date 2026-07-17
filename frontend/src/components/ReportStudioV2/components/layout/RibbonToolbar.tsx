import React, { useState, useCallback } from 'react';
import {
  Grid, MousePointer2, Download, FileText, Video, ZoomIn, ZoomOut,
  Printer, ScanSearch, Sparkles, FolderOpen, Save, Sigma, RefreshCw,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Type, List, ListOrdered,
  Image as ImageIcon, Table as TableIcon, Map as MapIcon, BarChart3,
  Target, Activity, Layers, FileDown, FileUp, Undo2, Redo2,
  Copy, Scissors, Clipboard, BookOpen, CheckSquare, Shield, Clock,
  PanelLeftClose, PanelRightClose, Maximize2, LayoutTemplate, FilePlus2,
  Hash, Minus, Camera, Mic, ArrowLeftRight, Gauge, Pin, PinOff,
} from 'lucide-react';
import ColorPalette from '../shared/ColorPalette';

/* ─────────────────────────────────────────────────────────────────────────────
   RIBBON TOOLBAR — Etapa 1 Funcionalidad Core
   Pestañas: Inicio | Insertar | Diseño | Revisar | Datos | Exportar
   Colapsa con doble-click en pestaña activa para maximizar lienzo.
   ───────────────────────────────────────────────────────────────────────── */

const FONT_FAMILIES = [
  'Inter', 'Arial', 'Times New Roman', 'Calibri', 'Roboto', 'Helvetica',
  'Georgia', 'Verdana', 'Courier New', 'Tahoma',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

/** Estilo Word-like: aplicar uno reemplaza TODO el formato del bloque
 * seleccionado de una sola vez (fuente, tamaño, color, negrita, cursiva,
 * subrayado, alineación, interlineado) — no solo tamaño/color como antes.
 * Pedido explícito del negocio: "simulando ser un Microsoft Word". */
export interface HeadingStyleDef {
  id: string;
  label: string;
  tag: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
}

/** Escala tipográfica corporativa premium: Calibri para encabezados (más
 * "documento oficial"), Arial para cuerpo — mismo criterio que una plantilla
 * Word con Estilos rápidos. Cada nivel es visualmente distinguible del
 * siguiente (tamaño + peso + color, escala de slate) para que la Tabla de
 * Contenidos generada a partir de estos estilos tenga jerarquía clara. */
const HEADING_STYLES: HeadingStyleDef[] = [
  { id: 'title', label: 'Título',    tag: 'h1', fontFamily: 'Calibri', fontSize: 28, fontWeight: 800, italic: false, underline: false, color: '#0f172a', textAlign: 'center', lineHeight: 1.2 },
  { id: 'h1',    label: 'Heading 1', tag: 'h1', fontFamily: 'Calibri', fontSize: 22, fontWeight: 700, italic: false, underline: false, color: '#1e293b', textAlign: 'left',   lineHeight: 1.25 },
  { id: 'h2',    label: 'Heading 2', tag: 'h2', fontFamily: 'Calibri', fontSize: 18, fontWeight: 700, italic: false, underline: false, color: '#1e40af', textAlign: 'left',   lineHeight: 1.3 },
  { id: 'h3',    label: 'Heading 3', tag: 'h3', fontFamily: 'Calibri', fontSize: 15, fontWeight: 600, italic: false, underline: false, color: '#334155', textAlign: 'left',   lineHeight: 1.3 },
  { id: 'h4',    label: 'Heading 4', tag: 'h4', fontFamily: 'Calibri', fontSize: 13, fontWeight: 600, italic: false, underline: false, color: '#475569', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'h5',    label: 'Heading 5', tag: 'h5', fontFamily: 'Calibri', fontSize: 12, fontWeight: 600, italic: true,  underline: false, color: '#64748b', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'h6',    label: 'Heading 6', tag: 'h6', fontFamily: 'Calibri', fontSize: 11, fontWeight: 600, italic: true,  underline: false, color: '#94a3b8', textAlign: 'left',   lineHeight: 1.4 },
  { id: 'normal', label: 'Normal',   tag: 'p',  fontFamily: 'Arial',   fontSize: 12, fontWeight: 400, italic: false, underline: false, color: '#1e293b', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'quote',  label: 'Cita',     tag: 'blockquote', fontFamily: 'Arial', fontSize: 12, fontWeight: 400, italic: true, underline: false, color: '#64748b', textAlign: 'left', lineHeight: 1.35 },
];

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

interface RibbonBtnProps {
  icon?: React.ElementType;
  label?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: string;
}

/** Botón compacto para ribbon */
function RibbonBtn({ icon: Icon, label, onClick, active, disabled, title, className = '', variant }: RibbonBtnProps) {
  return (
    <button
      type="button"
      className={`ribbon-btn ${active ? 'ribbon-btn--active' : ''} ${variant ? `ribbon-btn--${variant}` : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
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
      <div className="ribbon-group-title">{title}</div>
    </div>
  );
}

interface RibbonToolbarProps {
  // Existing TopToolbar props
  onExportPdf?: () => void;
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
  isRecording?: boolean;
  isOptimizing?: boolean;
  zoomPercent?: number;
  onOpenReportsAdmin?: () => void;
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
  // New Ribbon props
  onInsertElement?: (type: string) => void;
  onAddPage?: () => void;
  onDuplicatePage?: () => void;
  onAddTemplate?: (template: string) => void;
  onApplyHeadingStyle?: (style: HeadingStyleDef) => void;
  onToggleBold?: () => void;
  onToggleItalic?: () => void;
  onToggleUnderline?: () => void;
  onSetAlignment?: (align: string) => void;
  onSetFontFamily?: (family: string) => void;
  onSetFontSize?: (size: number) => void;
  onSetFontColor?: (color: string) => void;
  onSetLineHeight?: (lineHeight: number) => void;
  currentLineHeight?: number;
  onInsertTOC?: () => void;
  onInsertCoverPage?: (templateId: string) => void;
  onStartWorkflow?: () => void;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  onExportDocx?: () => void;
  onExportPptx?: () => void;
  onExportMiningReport?: () => void;
  onImportMiningReport?: () => void;
  currentFontFamily?: string;
  currentFontSize?: number;
  currentFontColor?: string;
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

export default function RibbonToolbar({
  onExportPdf, onExportVideo, onPrint, onReviewDocument, onOptimizeDocument,
  onZoomIn, onZoomOut, onZoomSet, gridEnabled, snapEnabled, onToggleGrid, onToggleSnap,
  isRecording, isOptimizing, zoomPercent, onOpenReportsAdmin, onSaveReport,
  isSaving, saveLabel, onOpenFormulaAnalysis, onSyncMiningKpis, isSyncingKpis,
  kpiAutoSyncEnabled, onToggleKpiAutoSync, layoutMode, onLayoutModeChange,
  paperSize, onPaperSizeChange, orientation, onOrientationChange,
  onInsertElement, onAddPage, onDuplicatePage, onAddTemplate,
  onApplyHeadingStyle, onToggleBold, onToggleItalic, onToggleUnderline,
  onSetAlignment, onSetFontFamily, onSetFontSize, onSetFontColor,
  onSetLineHeight, currentLineHeight,
  onInsertTOC, onInsertCoverPage, onStartWorkflow,
  onToggleLeftPanel, onToggleRightPanel, leftPanelVisible, rightPanelVisible,
  onExportDocx, onExportPptx, onExportMiningReport, onImportMiningReport,
  currentFontFamily, currentFontSize, currentFontColor, currentHeadingStyle,
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
  // Anclada por defecto (igual que Word/Office) — al desanclar, la barra se
  // oculta automáticamente al sacar el mouse y reaparece al pasar por encima
  // o al cambiar de pestaña, para ganar altura de lienzo.
  const [isPinned, setIsPinned] = useState(true);

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
      className={`ribbon-toolbar ${collapsed ? 'ribbon-toolbar--collapsed' : ''}`}
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
          <RibbonBtn icon={Undo2} title="Deshacer el último cambio (Ctrl+Z)" />
          <RibbonBtn icon={Redo2} title="Rehacer el cambio deshecho (Ctrl+Y)" />
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
                <RibbonBtn icon={Clipboard} label="Pegar" title="Pegar contenido del portapapeles" />
                <div className="ribbon-btn-col">
                  <RibbonBtn icon={Scissors} label="Cortar" title="Cortar la selección al portapapeles" />
                  <RibbonBtn icon={Copy} label="Copiar" title="Copiar la selección al portapapeles" />
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
                  <div className="ribbon-color-btn-wrap">
                    <ColorPalette
                      value={currentFontColor || '#1e293b'}
                      title="Elegir el color del texto — si hay una palabra seleccionada en el editor, se aplica solo a ella"
                      onChange={(color) => onSetFontColor?.(color)}
                    />
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Párrafo">
                <div className="ribbon-format-row">
                  <RibbonBtn icon={AlignLeft} title="Alinear párrafo a la izquierda" onClick={() => onSetAlignment?.('left')}
                    active={currentAlignment === 'left'} />
                  <RibbonBtn icon={AlignCenter} title="Centrar el párrafo" onClick={() => onSetAlignment?.('center')}
                    active={currentAlignment === 'center'} />
                  <RibbonBtn icon={AlignRight} title="Alinear párrafo a la derecha" onClick={() => onSetAlignment?.('right')}
                    active={currentAlignment === 'right'} />
                  <RibbonBtn icon={AlignJustify} title="Justificar el párrafo en todo el ancho" onClick={() => onSetAlignment?.('justify')}
                    active={currentAlignment === 'justify'} />
                </div>
                <div className="ribbon-format-row">
                  <RibbonBtn icon={List} title="Crear lista con viñetas" />
                  <RibbonBtn icon={ListOrdered} title="Crear lista numerada" />
                  <div className="ribbon-line-spacing-wrap">
                    <RibbonBtn
                      icon={Minus}
                      title={`Interlineado actual: ${(Number(currentLineHeight) || 1.35).toFixed(2)} — clic para cambiarlo`}
                      onClick={() => setShowLineSpacing((v) => !v)}
                      active={showLineSpacing}
                    />
                    {showLineSpacing && (
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
                    Estilo actual: <b>{HEADING_STYLES.find((hs) => hs.id === currentHeadingStyle)?.label || 'Normal'}</b>
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
                <RibbonBtn icon={ImageIcon} label="Imagen" onClick={() => onInsertElement?.('image')} title="Insertar una imagen en la página" />
                <RibbonBtn icon={TableIcon} label="Tabla" onClick={() => onInsertElement?.('table')} title="Insertar una tabla de filas y columnas" />
                <RibbonBtn icon={BarChart3} label="Gráfico" onClick={() => onInsertElement?.('chart')} title="Insertar un gráfico de datos" />
                <RibbonBtn icon={Target} label="KPI" onClick={() => onInsertElement?.('kpi')} title="Insertar un indicador KPI" />
                <RibbonBtn icon={MapIcon} label="Mapa" onClick={() => onInsertElement?.('map')} title="Insertar un mapa detallado de la mina" />
                <RibbonBtn icon={Activity} label="Sensor" onClick={() => onInsertElement?.('sensor')} title="Insertar la lectura de un sensor en tiempo real" />
              </RibbonGroup>

              <RibbonGroup title="Documento">
                <RibbonBtn icon={BookOpen} label="Índice" onClick={onInsertTOC} title="Insertar tabla de contenidos automática" />
                <RibbonBtn icon={Hash} label="Numeración" title="Activar numeración automática de páginas" />
                <div className="ribbon-cover-wrap">
                  <RibbonBtn icon={LayoutTemplate} label="Carátula" onClick={() => setShowCoverDropdown((v) => !v)} title="Insertar una carátula de informe" />
                  {showCoverDropdown && (
                    <div className="ribbon-cover-dropdown" onMouseLeave={() => setShowCoverDropdown(false)}>
                      {COVER_TEMPLATES.map((ct) => (
                        <button
                          key={ct.id}
                          className="ribbon-cover-option"
                          onClick={() => { onInsertCoverPage?.(ct.id); setShowCoverDropdown(false); }}
                        >
                          <span className="ribbon-cover-label">{ct.label}</span>
                          <span className="ribbon-cover-desc">{ct.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </RibbonGroup>

              <RibbonGroup title="Plantillas">
                <RibbonBtn icon={FileText} label="Hallazgos" onClick={() => onAddTemplate?.('findings')} title="Insertar plantilla de hallazgos técnicos" />
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
                    title="Formato del lienzo: documento o presentación 16:9"
                  >
                    <option value="document">Documento</option>
                    <option value="presentation">Presentación 16:9</option>
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
                <RibbonBtn icon={Save} label={saveLabel} onClick={onSaveReport}
                  disabled={isSaving} variant="save" title="Guardar el informe actual" />
              </RibbonGroup>

              <RibbonGroup title="Portabilidad">
                <RibbonBtn icon={FileDown} label="Exportar archivo portátil"
                  onClick={onExportMiningReport} variant="portable" title="Exportar el informe a un archivo .mreport cifrado — mismo tenant: se abre sin cambios; otra unidad minera: solo estructura, sin imágenes/KPIs/gráficos" />
                <RibbonBtn icon={FileUp} label="Importar archivo portátil"
                  onClick={onImportMiningReport} variant="portable" title="Importar un informe desde un archivo .mreport" />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ EXPORTAR ═══════════════════ */}
          {activeTab === 'exportar' && (
            <>
              <RibbonGroup title="Documentos">
                <RibbonBtn icon={Download} label="PDF" onClick={onExportPdf} variant="primary" title="Exportar el informe como archivo PDF" />
                <RibbonBtn icon={FileText} label="DOCX" onClick={onExportDocx} title="Exportar el informe como documento Word (DOCX)" />
                <RibbonBtn icon={Layers} label="PPTX" onClick={onExportPptx} title="Exportar el informe como presentación PowerPoint" />
              </RibbonGroup>

              <RibbonGroup title="Impresión">
                <RibbonBtn icon={Printer} label="Imprimir" onClick={onPrint} title="Imprimir el informe o abrir vista previa de impresión" />
              </RibbonGroup>

              <RibbonGroup title="Video">
                <RibbonBtn icon={Video} label={isRecording ? '● REC' : 'Grabar'}
                  onClick={onExportVideo} active={isRecording}
                  title={isRecording ? 'Detener la grabación del informe' : 'Grabar un vídeo del informe (máximo 30 segundos)'} />
              </RibbonGroup>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export { HEADING_STYLES, COVER_TEMPLATES, FONT_FAMILIES, FONT_SIZES, MINING_COLORS };
