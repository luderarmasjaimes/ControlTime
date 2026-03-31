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
}) {
  return (
    <header className="top-toolbar">
      {/* Título */}
      <div className="top-toolbar-title">
        <div style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          padding: '7px',
          borderRadius: '9px',
          color: 'white',
          display: 'flex',
          boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
        }}>
          <FileText size={18} />
        </div>
        <strong>Informe Técnico Minero</strong>
        <span className="ui-refresh-badge">Editor Pro</span>
      </div>

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
          onClick={onOpenReportsAdmin}
          title="Administrar informes técnicos grabados"
          style={{ background: 'rgba(37,99,235,0.68)', borderColor: 'rgba(96,165,250,0.95)', color: '#ffffff', fontWeight: '700' }}
        >
          <FolderOpen size={15} />
          Mis Informes
        </button>

        <button
          onClick={onSaveReport}
          disabled={isSaving}
          title="Guardar informe en la base de datos"
          style={isSaving
            ? { opacity: 0.65, cursor: 'wait' }
            : { background: 'rgba(5,150,105,0.68)', borderColor: 'rgba(110,231,183,0.95)', color: '#ffffff', fontWeight: '700' }}
        >
          <Save size={15} />
          {saveLabel || 'Guardar'}
        </button>

        <button
          onClick={onOptimizeDocument}
          disabled={isOptimizing}
          title="Optimizar sintaxis y redacción con IA"
          style={isOptimizing ? { opacity: 0.65, cursor: 'wait' } : {}}
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
