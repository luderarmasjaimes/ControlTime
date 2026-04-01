import { 
  Type, 
  BarChart3, 
  Target, 
  Image as ImageIcon, 
  Table as TableIcon,
  Box,
  Map as MapIcon,
  FilePlus2,
  Copy,
  Video,
  Heading,
  PanelBottom,
  ClipboardList,
  Activity
} from 'lucide-react';

const items = [
  { type: 'text', label: 'Texto Técnico', icon: <Type size={18} />, short: 'Texto' },
  { type: 'chart', label: 'Gráfico Dinámico', icon: <BarChart3 size={18} />, short: 'Gráfico' },
  { type: 'kpi', label: 'Indicador KPI', icon: <Target size={18} />, short: 'KPI' },
  { type: 'image', label: 'Imagen / Figura', icon: <ImageIcon size={18} />, short: 'Imagen' },
  { type: 'table', label: 'Tabla de Datos', icon: <TableIcon size={18} />, short: 'Tabla' },
  { type: 'map', label: 'Mapa Detallado Pro', icon: <MapIcon size={18} />, short: 'Mapa' },
  { type: 'sensor', label: 'Sensor Real-time', icon: <Activity size={18} />, short: 'Sensor' },
];

export default function LeftLibrary({
  onAdd,
  onAddPage,
  onDuplicatePage,
  onAddHeader,
  onAddFooter,
  onAddFindings,
  onExportVideo,
  isRecording,
}) {
  return (
    <aside className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ─── Título ─── */}
      <h3 className="panel-title">
        <Box size={17} color="#6366f1" />
        Librería de Bloques
      </h3>

      {/* ─── Bloques arrastrables ─── */}
      <span className="inspector-section-label" style={{ marginBottom: 10 }}>Insertar en página activa</span>
      <button
        className="lib-item"
        title="Insertar: Mapa Detallado Pro"
        onClick={() => onAdd('map')}
        style={{ marginBottom: 10, borderColor: 'rgba(245, 158, 11, 0.35)', background: '#fff7ed' }}
      >
        <div className="lib-item-icon" style={{ background: '#fffbeb', color: '#d97706', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
          <MapIcon size={18} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span className="lib-item-text" style={{ color: '#92400e' }}>MAPA</span>
          <span style={{ fontSize: '0.7rem', color: '#92400e', fontWeight: 500 }}>Mapa Detallado Pro</span>
        </div>
      </button>
      <div className="library-grid">
        {items.filter((item) => item.type !== 'map').map((item) => (
          <button
            key={item.type}
            className="lib-item"
            title={`Insertar: ${item.label}`}
            onClick={() => onAdd(item.type)}
          >
            <div className="lib-item-icon">{item.icon}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
              <span className="lib-item-text">{item.short}</span>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>{item.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ─── Herramientas ─── */}
      <div className="toolbox-section" style={{ marginTop: 24, paddingTop: 20 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: 12, padding: '6px 10px',
          background: '#eef2ff', borderRadius: 8,
          border: '1px solid rgba(99,102,241,0.2)'
        }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Herramientas del Informe
          </span>
        </div>
        <div className="toolbox-grid">
          <button className="tool-action" onClick={onAddPage} title="Agregar nueva página al informe">
            <FilePlus2 size={15} />
            Nueva Página
          </button>
          <button className="tool-action" onClick={onDuplicatePage} title="Duplicar la página activa con todo su contenido">
            <Copy size={15} />
            Duplicar Página
          </button>
          <button className="tool-action" onClick={onAddHeader} title="Insertar bloque de encabezado técnico">
            <Heading size={15} />
            Encabezado Técnico
          </button>
          <button className="tool-action" onClick={onAddFooter} title="Insertar bloque de pie de página">
            <PanelBottom size={15} />
            Pie de Página
          </button>
          <button className="tool-action" onClick={onAddFindings} title="Insertar plantilla de hallazgos técnicos">
            <ClipboardList size={15} />
            Hallazgos Técnicos
          </button>
          <button
            className="tool-action"
            onClick={onExportVideo}
            title="Grabar video de pantalla del informe (máx. 30s)"
            style={isRecording ? { borderColor: '#ef4444', color: '#dc2626', background: '#fef2f2' } : {}}
          >
            <Video size={15} />
            {isRecording ? '● Grabando…' : 'Exportar Video'}
          </button>
        </div>
      </div>
    </aside>
  );
}
