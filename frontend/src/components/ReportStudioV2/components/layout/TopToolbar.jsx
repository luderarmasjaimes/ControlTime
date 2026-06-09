import { 
  Grid, 
  MousePointer2, 
  Download, 
  FileText,
  Video,
  ZoomIn,
  ZoomOut,
  Printer,
  ScanSearch,
  Sparkles,
  FolderOpen,
  Save,
  Sigma,
  RefreshCw,
} from 'lucide-react';

export default function TopToolbar({
  onExportPdf,
  onExportVideo,
  onPrint,
  onReviewDocument,
  onOptimizeDocument,
  onZoomIn,
  onZoomOut,
  gridEnabled,
  snapEnabled,
  onToggleGrid,
  onToggleSnap,
  isRecording,
  isOptimizing,
  zoomPercent,
  onOpenReportsAdmin,
  onSaveReport,
  isSaving,
  saveLabel,
  onOpenFormulaAnalysis,
  onSyncMiningKpis,
  isSyncingKpis,
  kpiAutoSyncEnabled,
  onToggleKpiAutoSync,
  layoutMode = 'document',
  onLayoutModeChange,
}) {
  return (
    <header className="top-toolbar">
      {/* Acciones agrupadas */}
      <div className="toolbar-actions">

        {/* Grupo 1 — Vista */}
        <button
          onClick={onToggleGrid}
          className={gridEnabled ? 'btn-active' : ''}
          title={gridEnabled ? 'Desactivar cuadrícula' : 'Activar cuadrícula'}
        >
          <Grid size={15} />
          Grid
        </button>
        <button
          onClick={onToggleSnap}
          className={snapEnabled ? 'btn-active' : ''}
          title={snapEnabled ? 'Desactivar ajuste a cuadrícula' : 'Activar ajuste a cuadrícula'}
        >
          <MousePointer2 size={15} />
          Snap
        </button>

        <div className="toolbar-separator" />

        <label className="toolbar-layout-field">
          <span className="toolbar-layout-label">Formato</span>
          <select
            className="toolbar-layout-select"
            value={layoutMode === 'presentation' ? 'presentation' : 'document'}
            onChange={(e) => onLayoutModeChange?.(e.target.value)}
            title="Documento (Word) o presentación (PowerPoint): cambia el tamaño del lienzo"
          >
            <option value="document">Documento</option>
            <option value="presentation">Presentación</option>
          </select>
        </label>

        <div className="toolbar-separator" />

        {/* Grupo 2 — Zoom */}
        <button onClick={onZoomOut} title="Alejar (Zoom -)">
          <ZoomOut size={15} />
          -
        </button>
        <div className="zoom-chip" title={`Zoom actual: ${zoomPercent}%`}>{zoomPercent}%</div>
        <button onClick={onZoomIn} title="Acercar (Zoom +)">
          <ZoomIn size={15} />
          +
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 3 — Documento */}
        <button onClick={onPrint} title="Imprimir informe">
          <Printer size={15} />
          Impr.
        </button>
        <button onClick={onReviewDocument} title="Revisar consistencia del documento">
          <ScanSearch size={15} />
          Revisar
        </button>

        {/* ===== Mis Informes ===== */}
        <button
          onClick={onOpenFormulaAnalysis}
          className="toolbar-btn-variant toolbar-btn-variant--formula"
          title="Ejecutar FORMULA minera para generación de reportes"
        >
          <Sigma size={15} />
          FORMULA
        </button>
        <button
          onClick={onSyncMiningKpis}
          disabled={isSyncingKpis}
          className={`toolbar-btn-variant${isSyncingKpis ? ' is-busy' : ''}`}
          title="Sincronizar KPI runtime desde datos operativos (dashboard)"
        >
          <RefreshCw size={15} />
          {isSyncingKpis ? 'Sync KPI...' : 'Sync KPI'}
        </button>
        <button
          onClick={onToggleKpiAutoSync}
          className={`toolbar-btn-variant${kpiAutoSyncEnabled ? ' btn-active' : ''}`}
          title="Activar/desactivar sincronización KPI automática (cada 3 minutos)"
        >
          <RefreshCw size={15} />
          {kpiAutoSyncEnabled ? 'Auto KPI ON' : 'Auto KPI OFF'}
        </button>
        <button
          onClick={onOpenReportsAdmin}
          className="toolbar-btn-variant toolbar-btn-variant--reports"
          title="Administrar informes técnicos grabados"
        >
          <FolderOpen size={15} />
          Informes
        </button>

        <button
          onClick={onSaveReport}
          disabled={isSaving}
          className={`toolbar-btn-variant toolbar-btn-variant--save${isSaving ? ' is-busy' : ''}`}
          title="Guardar informe en la base de datos"
        >
          <Save size={15} />
          {saveLabel || 'Guardar'}
        </button>

        <button
          onClick={onOptimizeDocument}
          disabled={isOptimizing}
          className={isOptimizing ? 'is-busy' : ''}
          title="Optimizar sintaxis y redacción con IA"
        >
          <Sparkles size={15} />
          {isOptimizing ? 'Analizando…' : 'Optimizar'}
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 4 — Exportar */}
        <button
          onClick={onExportVideo}
          className={isRecording ? 'btn-active' : ''}
          title="Grabar video del informe (máx. 30s)"
        >
          <Video size={15} />
          {isRecording ? '● REC' : 'Grabar'}
        </button>
        <button className="primary" onClick={onExportPdf} title="Exportar como PDF">
          <Download size={15} />
          PDF
        </button>

      </div>
    </header>
  );
}
