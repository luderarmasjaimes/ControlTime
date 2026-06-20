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
          title={gridEnabled ? 'Ocultar la cuadrícula de alineación' : 'Mostrar cuadrícula de alineación en el lienzo'}
        >
          <Grid size={15} />
          Grid
        </button>
        <button
          onClick={onToggleSnap}
          className={snapEnabled ? 'btn-active' : ''}
          title={snapEnabled ? 'Desactivar ajuste automático a la cuadrícula' : 'Ajustar bloques automáticamente a la cuadrícula'}
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
            title="Elegir formato del lienzo: documento (Word) o presentación (PowerPoint)"
          >
            <option value="document">Documento</option>
            <option value="presentation">Presentación</option>
          </select>
        </label>

        <div className="toolbar-separator" />

        {/* Grupo 2 — Zoom */}
        <button onClick={onZoomOut} title="Alejar la vista del lienzo">
          <ZoomOut size={15} />
          -
        </button>
        <div className="zoom-chip" title={`Nivel de zoom actual: ${zoomPercent}%`}>{zoomPercent}%</div>
        <button onClick={onZoomIn} title="Acercar la vista del lienzo">
          <ZoomIn size={15} />
          +
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 3 — Documento */}
        <button onClick={onPrint} title="Imprimir el informe o abrir vista previa de impresión">
          <Printer size={15} />
          Impr.
        </button>
        <button onClick={onReviewDocument} title="Revisar ortografía, consistencia y calidad del documento">
          <ScanSearch size={15} />
          Revisar
        </button>

        {/* ===== Mis Informes ===== */}
        <button
          onClick={onOpenFormulaAnalysis}
          className="toolbar-btn-variant toolbar-btn-variant--formula"
          title="Ejecutar el motor FORMULA para generación automática de reportes mineros"
        >
          <Sigma size={15} />
          FORMULA
        </button>
        <button
          onClick={onSyncMiningKpis}
          disabled={isSyncingKpis}
          className={`toolbar-btn-variant${isSyncingKpis ? ' is-busy' : ''}`}
          title="Sincronizar indicadores KPI con datos operativos del dashboard"
        >
          <RefreshCw size={15} />
          {isSyncingKpis ? 'Sync KPI...' : 'Sync KPI'}
        </button>
        <button
          onClick={onToggleKpiAutoSync}
          className={`toolbar-btn-variant${kpiAutoSyncEnabled ? ' btn-active' : ''}`}
          title={kpiAutoSyncEnabled ? 'Desactivar sincronización automática de KPI' : 'Activar sincronización automática de KPI cada 3 minutos'}
        >
          <RefreshCw size={15} />
          {kpiAutoSyncEnabled ? 'Auto KPI ON' : 'Auto KPI OFF'}
        </button>
        <button
          onClick={onOpenReportsAdmin}
          className="toolbar-btn-variant toolbar-btn-variant--reports"
          title="Abrir la biblioteca de informes técnicos guardados"
        >
          <FolderOpen size={15} />
          Informes
        </button>

        <button
          onClick={onSaveReport}
          disabled={isSaving}
          className={`toolbar-btn-variant toolbar-btn-variant--save${isSaving ? ' is-busy' : ''}`}
          title="Guardar el informe en la base de datos"
        >
          <Save size={15} />
          {saveLabel || 'Guardar'}
        </button>

        <button
          onClick={onOptimizeDocument}
          disabled={isOptimizing}
          className={isOptimizing ? 'is-busy' : ''}
          title="Mejorar redacción y claridad del texto con inteligencia artificial"
        >
          <Sparkles size={15} />
          {isOptimizing ? 'Analizando…' : 'Optimizar'}
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 4 — Exportar */}
        <button
          onClick={onExportVideo}
          className={isRecording ? 'btn-active' : ''}
          title={isRecording ? 'Detener la grabación del informe' : 'Grabar un vídeo del informe (máximo 30 segundos)'}
        >
          <Video size={15} />
          {isRecording ? '● REC' : 'Grabar'}
        </button>
        <button className="primary" onClick={onExportPdf} title="Exportar el informe como archivo PDF">
          <Download size={15} />
          PDF
        </button>

      </div>
    </header>
  );
}
