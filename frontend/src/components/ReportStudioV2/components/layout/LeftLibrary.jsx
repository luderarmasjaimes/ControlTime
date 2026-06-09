import React from 'react';
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
  { type: 'text', label: 'Párrafo y listas', icon: <Type size={16} />, short: 'Texto' },
  { type: 'chart', label: 'Series y ejes', icon: <BarChart3 size={16} />, short: 'Gráfico' },
  { type: 'kpi', label: 'Indicador numérico', icon: <Target size={16} />, short: 'KPI' },
  { type: 'image', label: 'Figura o foto', icon: <ImageIcon size={16} />, short: 'Imagen' },
  { type: 'table', label: 'Filas y columnas', icon: <TableIcon size={16} />, short: 'Tabla' },
  { type: 'map', label: 'Mapa detallado', icon: <MapIcon size={16} />, short: 'Mapa' },
  { type: 'sensor', label: 'Dato en tiempo real', icon: <Activity size={16} />, short: 'Sensor' },
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
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <aside 
      className={`panel panel--library ${isHovered ? 'panel--library-expanded' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <h3 className="panel-title panel-title--library" title="Insertar bloques en la página activa del informe">
        <Box size={15} color="var(--accent)" aria-hidden />
        {isHovered && <span>Contenidos</span>}
      </h3>

      {isHovered && (
        <span className="inspector-section-label library-insert-hint" title="Los elementos se insertan en la hoja seleccionada">
          Añadir a la página
        </span>
      )}

      <div className="panel-library-scroll">
        <button
          type="button"
          className="lib-item lib-item--map"
          title="Insertar mapa detallado (alta resolución)"
          onClick={() => onAdd('map')}
        >
          <div className="lib-item-icon lib-item-icon--map">
            <MapIcon size={16} />
          </div>
          {isHovered && (
            <div className="lib-item-copy">
              <span className="lib-item-text">Mapa</span>
              <span className="lib-item-sub lib-item-sub--map">Alta definición</span>
            </div>
          )}
        </button>
        <div className="library-grid">
          {items.filter((item) => item.type !== 'map').map((item) => (
            <button
              key={item.type}
              type="button"
              className="lib-item"
              title={`Insertar: ${item.label}`}
              onClick={() => onAdd(item.type)}
            >
              <div className="lib-item-icon">{item.icon}</div>
              {isHovered && (
                <div className="lib-item-copy">
                  <span className="lib-item-text">{item.short}</span>
                  <span className="lib-item-sub">{item.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbox-section panel-library-tools">
        <div className="library-tools-heading" title="Operaciones sobre páginas y plantillas">
          Acciones del informe
        </div>
        <div className="toolbox-grid">
          <button type="button" className="tool-action" onClick={onAddPage} title="Agregar una nueva página al documento">
            <FilePlus2 size={14} aria-hidden />
            Nueva página
          </button>
          <button type="button" className="tool-action" onClick={onDuplicatePage} title="Duplicar la página actual con su contenido">
            <Copy size={14} aria-hidden />
            Duplicar página
          </button>
          <button type="button" className="tool-action" onClick={onAddHeader} title="Bloque de encabezado técnico">
            <Heading size={14} aria-hidden />
            Encabezado
          </button>
          <button type="button" className="tool-action" onClick={onAddFooter} title="Bloque de pie de página">
            <PanelBottom size={14} aria-hidden />
            Pie de página
          </button>
          <button type="button" className="tool-action" onClick={onAddFindings} title="Plantilla de hallazgos técnicos">
            <ClipboardList size={14} aria-hidden />
            Hallazgos
          </button>
          <button
            type="button"
            className={`tool-action${isRecording ? ' tool-action--recording' : ''}`}
            onClick={onExportVideo}
            title="Grabar un vídeo corto del lienzo (máx. 30 s)"
          >
            <Video size={14} aria-hidden />
            {isRecording ? 'Grabando…' : 'Grabar vídeo'}
          </button>
        </div>
      </div>
    </aside>
  );
}
