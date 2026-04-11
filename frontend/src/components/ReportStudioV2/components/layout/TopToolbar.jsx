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
}) {
  return (
    <header className="top-toolbar">
      {/* Título */}
      <div className="top-toolbar-title" />

      {/* Acciones agrupadas */}
      <div className="toolbar-actions">

        {/* Grupo 1 — Vista */}
        <button
          onClick={onToggleGrid}
          className={gridEnabled ? 'btn-active' : ''}
          title={gridEnabled ? 'Desactivar cuadrícula' : 'Activar cuadrícula'}
        >
          <Grid size={15} />
          {gridEnabled ? 'Cuadrícula ON' : 'Cuadrícula'}
        </button>
        <button
          onClick={onToggleSnap}
          className={snapEnabled ? 'btn-active' : ''}
          title={snapEnabled ? 'Desactivar ajuste a cuadrícula' : 'Activar ajuste a cuadrícula'}
        >
          <MousePointer2 size={15} />
          {snapEnabled ? 'Ajuste ON' : 'Ajuste'}
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 2 — Zoom */}
        <button onClick={onZoomOut} title="Alejar (Zoom -)">
          <ZoomOut size={15} />
          Alejar
        </button>
        <div className="zoom-chip" title={`Zoom actual: ${zoomPercent}%`}>{zoomPercent}%</div>
        <button onClick={onZoomIn} title="Acercar (Zoom +)">
          <ZoomIn size={15} />
          Acercar
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 3 — Documento */}
        <button onClick={onPrint} title="Imprimir informe">
          <Printer size={15} />
          Imprimir
        </button>
        <button onClick={onReviewDocument} title="Revisar consistencia del documento">
          <ScanSearch size={15} />
          Revisar Todo
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
          onClick={onOpenReportsAdmin}
          className="toolbar-btn-variant toolbar-btn-variant--reports"
          title="Administrar informes técnicos grabados"
        >
          <FolderOpen size={15} />
          Mis Informes
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
          {isOptimizing ? 'Analizando…' : 'Optimizar IA'}
        </button>

        <div className="toolbar-separator" />

        {/* Grupo 4 — Exportar */}
        <button
          onClick={onExportVideo}
          className={isRecording ? 'btn-active' : ''}
          title="Grabar video del informe (máx. 30s)"
        >
          <Video size={15} />
          {isRecording ? '● Grabando…' : 'Grabar Video'}
        </button>
        <button className="primary" onClick={onExportPdf} title="Exportar como PDF">
          <Download size={15} />
          Exportar PDF
        </button>

      </div>
    </header>
  );
}
