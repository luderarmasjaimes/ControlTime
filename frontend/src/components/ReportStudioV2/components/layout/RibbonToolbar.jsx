import React, { useState, useCallback } from 'react';
import {
  Grid, MousePointer2, Download, FileText, Video, ZoomIn, ZoomOut,
  Printer, ScanSearch, Sparkles, FolderOpen, Save, Sigma, RefreshCw,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Paintbrush, Type, Heading1, Heading2, Heading3, List, ListOrdered,
  Image as ImageIcon, Table as TableIcon, Map as MapIcon, BarChart3,
  Target, Activity, Layers, FileDown, FileUp, ChevronDown, Undo2, Redo2,
  Copy, Scissors, Clipboard, BookOpen, CheckSquare, Shield, Clock,
  PanelLeftClose, PanelRightClose, Maximize2, LayoutTemplate, FilePlus2,
  Hash, Minus, GitBranch, Camera, Mic, ArrowLeftRight, Gauge,
} from 'lucide-react';

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

const HEADING_STYLES = [
  { id: 'title',  label: 'Título',   tag: 'h1', fontSize: 28, fontWeight: 800, color: '#0f172a' },
  { id: 'h1',     label: 'Heading 1', tag: 'h1', fontSize: 24, fontWeight: 700, color: '#1e293b' },
  { id: 'h2',     label: 'Heading 2', tag: 'h2', fontSize: 20, fontWeight: 600, color: '#334155' },
  { id: 'h3',     label: 'Heading 3', tag: 'h3', fontSize: 16, fontWeight: 600, color: '#475569' },
  { id: 'normal', label: 'Normal',    tag: 'p',  fontSize: 12, fontWeight: 400, color: '#1e293b' },
  { id: 'quote',  label: 'Cita',      tag: 'blockquote', fontSize: 12, fontWeight: 400, color: '#64748b' },
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

/** Botón compacto para ribbon */
function RibbonBtn({ icon: Icon, label, onClick, active, disabled, title, className = '', variant }) {
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
function RibbonGroup({ title, children }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-content">{children}</div>
      <div className="ribbon-group-title">{title}</div>
    </div>
  );
}

export default function RibbonToolbar({
  // Existing TopToolbar props
  onExportPdf, onExportVideo, onPrint, onReviewDocument, onOptimizeDocument,
  onZoomIn, onZoomOut, gridEnabled, snapEnabled, onToggleGrid, onToggleSnap,
  isRecording, isOptimizing, zoomPercent, onOpenReportsAdmin, onSaveReport,
  isSaving, saveLabel, onOpenFormulaAnalysis, onSyncMiningKpis, isSyncingKpis,
  kpiAutoSyncEnabled, onToggleKpiAutoSync, layoutMode, onLayoutModeChange,
  // New Ribbon props
  onInsertElement, onAddPage, onDuplicatePage, onAddTemplate,
  onApplyHeadingStyle, onToggleBold, onToggleItalic, onToggleUnderline,
  onSetAlignment, onSetFontFamily, onSetFontSize, onSetFontColor,
  onInsertTOC, onInsertCoverPage, onStartWorkflow,
  onToggleLeftPanel, onToggleRightPanel, leftPanelVisible, rightPanelVisible,
  onExportDocx, onExportPptx, onExportMiningReport, onImportMiningReport,
  currentFontFamily, currentFontSize, currentFontColor, currentHeadingStyle,
  currentAlignment,
  // Version & snapshot
  onCreateSnapshot, onShowVersionHistory,
  // Stage 2 props
  onShowComparator, onToggleVoiceDictation, onTogglePerfDashboard,
  currentBold, currentItalic, currentUnderline
}) {
  const [activeTab, setActiveTab] = useState('inicio');
  const [collapsed, setCollapsed] = useState(false);
  const [showHeadingDropdown, setShowHeadingDropdown] = useState(false);
  const [showFontColorPicker, setShowFontColorPicker] = useState(false);
  const [showCoverDropdown, setShowCoverDropdown] = useState(false);

  const handleTabClick = useCallback((tab) => {
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
      onMouseLeave={() => setCollapsed(true)}
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
          <RibbonBtn icon={Undo2} title="Deshacer (Ctrl+Z)" />
          <RibbonBtn icon={Redo2} title="Rehacer (Ctrl+Y)" />
          <RibbonBtn icon={Save} label={saveLabel || 'Guardar'} onClick={onSaveReport}
            disabled={isSaving} variant="save" />
        </div>
      </div>

      {/* Ribbon body — only visible when not collapsed */}
      {!collapsed && (
        <div className="ribbon-body">
          {/* ═══════════════════ INICIO ═══════════════════ */}
          {activeTab === 'inicio' && (
            <>
              <RibbonGroup title="Portapapeles">
                <RibbonBtn icon={Clipboard} label="Pegar" />
                <div className="ribbon-btn-col">
                  <RibbonBtn icon={Scissors} label="Cortar" />
                  <RibbonBtn icon={Copy} label="Copiar" />
                </div>
              </RibbonGroup>

              <RibbonGroup title="Fuente">
                <div className="ribbon-font-row">
                  <select
                    className="ribbon-select ribbon-select--font"
                    value={currentFontFamily || 'Inter'}
                    onChange={(e) => onSetFontFamily?.(e.target.value)}
                    title="Familia tipográfica"
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                    ))}
                  </select>
                  <select
                    className="ribbon-select ribbon-select--size"
                    value={currentFontSize || 12}
                    onChange={(e) => onSetFontSize?.(Number(e.target.value))}
                    title="Tamaño de fuente (pt)"
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="ribbon-format-row">
                  <RibbonBtn icon={Bold} title="Negrita (Ctrl+B)" onClick={onToggleBold} active={currentBold} />
                  <RibbonBtn icon={Italic} title="Cursiva (Ctrl+I)" onClick={onToggleItalic} active={currentItalic} />
                  <RibbonBtn icon={Underline} title="Subrayado (Ctrl+U)" onClick={onToggleUnderline} active={currentUnderline} />
                  <div className="ribbon-color-btn-wrap">
                    <button
                      type="button"
                      className="ribbon-btn ribbon-btn--color"
                      onClick={() => setShowFontColorPicker((v) => !v)}
                      title="Color de fuente"
                    >
                      <Type size={14} />
                      <div className="ribbon-color-indicator" style={{ background: currentFontColor || '#1e293b' }} />
                    </button>
                    {showFontColorPicker && (
                      <div className="ribbon-color-picker" onMouseLeave={() => setShowFontColorPicker(false)}>
                        <div className="ribbon-color-grid">
                          {MINING_COLORS.map((c) => (
                            <button
                              key={c}
                              className="ribbon-color-swatch"
                              style={{ background: c, border: c === '#ffffff' ? '1px solid #cbd5e1' : 'none' }}
                              onClick={() => { onSetFontColor?.(c); setShowFontColorPicker(false); }}
                              title={c}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Párrafo">
                <div className="ribbon-format-row">
                  <RibbonBtn icon={AlignLeft} title="Alinear izquierda" onClick={() => onSetAlignment?.('left')}
                    active={currentAlignment === 'left'} />
                  <RibbonBtn icon={AlignCenter} title="Centrar" onClick={() => onSetAlignment?.('center')}
                    active={currentAlignment === 'center'} />
                  <RibbonBtn icon={AlignRight} title="Alinear derecha" onClick={() => onSetAlignment?.('right')}
                    active={currentAlignment === 'right'} />
                  <RibbonBtn icon={AlignJustify} title="Justificar" onClick={() => onSetAlignment?.('justify')}
                    active={currentAlignment === 'justify'} />
                </div>
                <div className="ribbon-format-row">
                  <RibbonBtn icon={List} title="Lista con viñetas" />
                  <RibbonBtn icon={ListOrdered} title="Lista numerada" />
                  <RibbonBtn icon={Minus} title="Interlineado" />
                </div>
              </RibbonGroup>

              <RibbonGroup title="Estilos">
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
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ INSERTAR ═══════════════════ */}
          {activeTab === 'insertar' && (
            <>
              <RibbonGroup title="Páginas">
                <RibbonBtn icon={FilePlus2} label="Nueva página" onClick={onAddPage} />
                <RibbonBtn icon={Copy} label="Duplicar" onClick={onDuplicatePage} />
              </RibbonGroup>

              <RibbonGroup title="Contenido">
                <RibbonBtn icon={Type} label="Texto" onClick={() => onInsertElement?.('text')} />
                <RibbonBtn icon={ImageIcon} label="Imagen" onClick={() => onInsertElement?.('image')} />
                <RibbonBtn icon={TableIcon} label="Tabla" onClick={() => onInsertElement?.('table')} />
                <RibbonBtn icon={BarChart3} label="Gráfico" onClick={() => onInsertElement?.('chart')} />
                <RibbonBtn icon={Target} label="KPI" onClick={() => onInsertElement?.('kpi')} />
                <RibbonBtn icon={MapIcon} label="Mapa" onClick={() => onInsertElement?.('map')} />
                <RibbonBtn icon={Activity} label="Sensor" onClick={() => onInsertElement?.('sensor')} />
              </RibbonGroup>

              <RibbonGroup title="Documento">
                <RibbonBtn icon={BookOpen} label="Índice" onClick={onInsertTOC} title="Insertar Índice (Tabla de Contenidos)" />
                <RibbonBtn icon={Hash} label="Numeración" title="Numeración automática de páginas" />
                <div className="ribbon-cover-wrap">
                  <RibbonBtn icon={LayoutTemplate} label="Carátula" onClick={() => setShowCoverDropdown((v) => !v)} />
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
                <RibbonBtn icon={Heading1} label="Encabezado" onClick={() => onAddTemplate?.('header')} />
                <RibbonBtn icon={FileText} label="Pie página" onClick={() => onAddTemplate?.('footer')} />
                <RibbonBtn icon={FileText} label="Hallazgos" onClick={() => onAddTemplate?.('findings')} />
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
                  >
                    <option value="document">Documento A4</option>
                    <option value="presentation">Presentación 16:9</option>
                  </select>
                </label>
              </RibbonGroup>

              <RibbonGroup title="Cuadrícula">
                <RibbonBtn icon={Grid} label="Grid" onClick={onToggleGrid} active={gridEnabled} />
                <RibbonBtn icon={MousePointer2} label="Snap" onClick={onToggleSnap} active={snapEnabled} />
                <RibbonBtn icon={Gauge} label="Perf" title="Monitor rendimiento (Ctrl+Shift+P)" onClick={onTogglePerfDashboard} variant="ai" />
              </RibbonGroup>

              <RibbonGroup title="Zoom">
                <RibbonBtn icon={ZoomOut} onClick={onZoomOut} title="Alejar" />
                <div className="ribbon-zoom-chip">{zoomPercent}%</div>
                <RibbonBtn icon={ZoomIn} onClick={onZoomIn} title="Acercar" />
              </RibbonGroup>

              <RibbonGroup title="Paneles">
                <RibbonBtn icon={PanelLeftClose} label="Izquierdo"
                  onClick={onToggleLeftPanel} active={leftPanelVisible} />
                <RibbonBtn icon={PanelRightClose} label="Derecho"
                  onClick={onToggleRightPanel} active={rightPanelVisible} />
                <RibbonBtn icon={Maximize2} label="Foco" title="Maximizar lienzo" />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ REVISAR ═══════════════════ */}
          {activeTab === 'revisar' && (
            <>
              <RibbonGroup title="Calidad">
                <RibbonBtn icon={ScanSearch} label="Revisar" onClick={onReviewDocument} />
                <RibbonBtn icon={Sparkles} label={isOptimizing ? 'Analizando…' : 'Optimizar IA'}
                  onClick={onOptimizeDocument} disabled={isOptimizing} variant="ai" />
              </RibbonGroup>

              <RibbonGroup title="Workflow">
                <RibbonBtn icon={CheckSquare} label="Aprobar" onClick={onStartWorkflow}
                  variant="workflow" title="Iniciar workflow de aprobación" />
                <RibbonBtn icon={Shield} label="Bitácora" title="Ver bitácora forense" onClick={onStartWorkflow} />
                <RibbonBtn icon={Clock} label="Versiones" title="Historial de versiones" onClick={onShowVersionHistory} />
                <RibbonBtn icon={Camera} label="Snapshot" title="Crear snapshot de versión" onClick={onCreateSnapshot} />
                <RibbonBtn icon={ArrowLeftRight} label="Comparar" title="Comparador visual versiones" onClick={onShowComparator} variant="primary" />
              </RibbonGroup>

              <RibbonGroup title="Dictado">
                <RibbonBtn icon={Mic} label="Voz" title="Dictado por voz (Ctrl+Shift+V)" onClick={onToggleVoiceDictation} variant="workflow" />
              </RibbonGroup>

              <RibbonGroup title="Motor IA">
                <RibbonBtn icon={Sigma} label="FORMULA" onClick={onOpenFormulaAnalysis}
                  variant="formula" />
                <RibbonBtn icon={RefreshCw} label={isSyncingKpis ? 'Sync...' : 'Sync KPI'}
                  onClick={onSyncMiningKpis} disabled={isSyncingKpis} />
                <RibbonBtn icon={RefreshCw} label={kpiAutoSyncEnabled ? 'Auto ON' : 'Auto OFF'}
                  onClick={onToggleKpiAutoSync} active={kpiAutoSyncEnabled} />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ DATOS ═══════════════════ */}
          {activeTab === 'datos' && (
            <>
              <RibbonGroup title="Informes">
                <RibbonBtn icon={FolderOpen} label="Mis Informes" onClick={onOpenReportsAdmin}
                  variant="reports" />
                <RibbonBtn icon={Save} label={saveLabel} onClick={onSaveReport}
                  disabled={isSaving} variant="save" />
              </RibbonGroup>

              <RibbonGroup title="Portabilidad">
                <RibbonBtn icon={FileDown} label="Exportar .miningreport"
                  onClick={onExportMiningReport} variant="portable" />
                <RibbonBtn icon={FileUp} label="Importar .miningreport"
                  onClick={onImportMiningReport} variant="portable" />
              </RibbonGroup>
            </>
          )}

          {/* ═══════════════════ EXPORTAR ═══════════════════ */}
          {activeTab === 'exportar' && (
            <>
              <RibbonGroup title="Documentos">
                <RibbonBtn icon={Download} label="PDF" onClick={onExportPdf} variant="primary" />
                <RibbonBtn icon={FileText} label="DOCX" onClick={onExportDocx} />
                <RibbonBtn icon={Layers} label="PPTX" onClick={onExportPptx} />
              </RibbonGroup>

              <RibbonGroup title="Impresión">
                <RibbonBtn icon={Printer} label="Imprimir" onClick={onPrint} />
              </RibbonGroup>

              <RibbonGroup title="Video">
                <RibbonBtn icon={Video} label={isRecording ? '● REC' : 'Grabar'}
                  onClick={onExportVideo} active={isRecording} />
              </RibbonGroup>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export { HEADING_STYLES, COVER_TEMPLATES, FONT_FAMILIES, FONT_SIZES, MINING_COLORS };
