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
  ClipboardList,
  Activity,
  Pin,
  PinOff,
  ChevronRight,
  FileText,
  ListOrdered,
} from 'lucide-react';

interface LibraryItem {
  type: string;
  label: string;
  icon: React.ReactNode;
  short: string;
  tip: string;
}

const items: LibraryItem[] = [
  { type: 'text', label: 'Párrafo y listas', icon: <Type size={18} />, short: 'Texto', tip: 'Insertar un bloque de texto: párrafos y listas' },
  { type: 'chart', label: 'Series y ejes', icon: <BarChart3 size={18} />, short: 'Gráfico', tip: 'Insertar un gráfico de series y ejes' },
  { type: 'kpi', label: 'Indicador numérico', icon: <Target size={18} />, short: 'KPI', tip: 'Insertar un indicador KPI (valor numérico y tendencia)' },
  { type: 'image', label: 'Figura o foto', icon: <ImageIcon size={18} />, short: 'Imagen', tip: 'Insertar una imagen: figura o fotografía' },
  { type: 'video', label: 'Grabación embebida', icon: <Video size={18} />, short: 'Video', tip: 'Grabar e insertar un video (cámara web o pantalla/ventana)' },
  { type: 'table', label: 'Filas y columnas', icon: <TableIcon size={18} />, short: 'Tabla', tip: 'Insertar una tabla de filas y columnas' },
  { type: 'map', label: 'Mapa detallado', icon: <MapIcon size={18} />, short: 'Mapa', tip: 'Insertar un mapa detallado de alta resolución' },
  { type: 'sensor', label: 'Dato en tiempo real', icon: <Activity size={18} />, short: 'Sensor', tip: 'Insertar la lectura de un sensor en tiempo real' },
];

interface LeftLibraryProps {
  onAdd: (type: string) => void;
  onAddPage?: () => void;
  onDuplicatePage?: () => void;
  onAddFindings?: () => void;
  onExportVideo?: () => void;
  onAddCover?: () => void;
  onAddToc?: () => void;
  onInsertCompanyImage?: () => void;
  isRecording?: boolean;
}

// React.memo: App.jsx ahora pasa callbacks estables (useCallback) para todos
// estos props — antes eran arrow functions inline recreadas en cada render,
// lo que habría anulado el memo de todas formas.
const LeftLibrary = React.memo(function LeftLibrary({
  onAdd,
  onAddPage,
  onDuplicatePage,
  onAddFindings,
  onExportVideo,
  onAddCover,
  onAddToc,
  onInsertCompanyImage,
  isRecording,
}: LeftLibraryProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isPinned, setIsPinned] = React.useState(false);
  const isExpanded = isHovered || isPinned;

  return (
    <aside
      className={`panel panel--library ${isExpanded ? 'panel--library-expanded' : ''}${isPinned ? ' panel--pinned' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!isPinned) setIsHovered(false); }}
    >
      {!isExpanded && (
        <span className="panel-edge-hint panel-edge-hint--right" title="Pase el cursor para expandir la biblioteca">
          <ChevronRight size={14} aria-hidden />
        </span>
      )}

      <div className="panel-title-row">
        <h3 className="panel-title panel-title--library" title="Biblioteca de contenidos: inserte bloques en la página activa">
          <Box size={18} color="var(--accent)" aria-hidden />
          {isExpanded && <span>Contenidos</span>}
        </h3>
        {isExpanded && (
          <button
            type="button"
            className={`panel-pin-btn${isPinned ? ' panel-pin-btn--active' : ''}`}
            onClick={() => setIsPinned((p) => !p)}
            title={isPinned ? 'Soltar la barra (vuelve a contraerse al salir)' : 'Fijar la barra expandida (útil en tablet)'}
            aria-pressed={isPinned}
          >
            {isPinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
          </button>
        )}
      </div>

      {isExpanded && (
        <span className="inspector-section-label library-insert-hint" title="Los elementos se insertan en la hoja seleccionada">
          Añadir a la página
        </span>
      )}

      <div className="panel-library-scroll">
        <button
          type="button"
          className="lib-item lib-item--map"
          title="Insertar un mapa detallado de alta resolución en la página"
          onClick={() => onAdd('map')}
        >
          <div className="lib-item-icon lib-item-icon--map">
            <MapIcon size={18} />
          </div>
          {isExpanded && (
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
              title={item.tip}
              onClick={() => onAdd(item.type)}
            >
              <div className="lib-item-icon">{item.icon}</div>
              {isExpanded && (
                <div className="lib-item-copy">
                  <span className="lib-item-text">{item.short}</span>
                  <span className="lib-item-sub">{item.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="toolbox-section panel-library-tools">
        {!isExpanded && <div className="library-tools-divider" aria-hidden />}
        {isExpanded && (
          <div className="library-tools-heading" title="Operaciones sobre páginas y plantillas del informe">
            Acciones del informe
          </div>
        )}
        <div className="toolbox-grid">
          <button type="button" className="tool-action" onClick={onAddCover} title="Insertar bloque de portada (carátula del informe) en la página">
            <FileText size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Portada</span>}
          </button>
          <button type="button" className="tool-action" onClick={onInsertCompanyImage} title="Insertar una foto de la unidad minera como imagen independiente, centrada, movible y redimensionable">
            <ImageIcon size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Imagen Empresa</span>}
          </button>
          <button type="button" className="tool-action" onClick={onAddToc} title="Insertar índice / tabla de contenidos (se genera desde los títulos del informe)">
            <ListOrdered size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Índice</span>}
          </button>
          <button type="button" className="tool-action" onClick={onAddPage} title="Añadir una página en blanco al final del informe">
            <FilePlus2 size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Nueva página</span>}
          </button>
          <button type="button" className="tool-action" onClick={onDuplicatePage} title="Duplicar la página actual con todo su contenido">
            <Copy size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Duplicar página</span>}
          </button>
          <button type="button" className="tool-action" onClick={onAddFindings} title="Insertar plantilla de hallazgos técnicos">
            <ClipboardList size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Hallazgos</span>}
          </button>
          <button
            type="button"
            className={`tool-action${isRecording ? ' tool-action--recording' : ''}`}
            onClick={onExportVideo}
            title={isRecording ? 'Detener la grabación del informe' : 'Grabar un vídeo del lienzo (máximo 30 segundos)'}
          >
            <Video size={18} aria-hidden />
            {isExpanded && (
              <span className="tool-action-label">{isRecording ? 'Grabando…' : 'Grabar vídeo'}</span>
            )}
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
});

export default LeftLibrary;
