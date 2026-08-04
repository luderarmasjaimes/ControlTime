import React from 'react';
import {
  Type,
  BarChart3,
  Gauge,
  Image as ImageIcon,
  Table as TableIcon,
  Blocks,
  Map as MapIcon,
  FilePlus2,
  Copy,
  Video,
  Clapperboard,
  ClipboardList,
  Activity,
  Pin,
  PinOff,
  ChevronRight,
  FileText,
  ListOrdered,
  FolderArchive,
  BookMarked,
  Sparkles,
  Info,
  LayoutGrid,
  Captions,
  Rows3,
  LineChart,
  Factory,
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
  { type: 'kpi', label: 'Indicador numérico', icon: <Gauge size={18} />, short: 'KPI', tip: 'Insertar un indicador KPI (valor numérico y tendencia)' },
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
  onAddAnnexes?: () => void;
  onAddReferences?: () => void;
  onAddApa7Citation?: () => void;
  onAddTechnicalBlock?: (kind: string) => void;
  onAddSectionTemplate?: (kind: string) => void;
  onAddStaticChart?: (kind: string) => void;
  onExportVideo?: () => void;
  onAddCover?: () => void;
  onAddToc?: () => void;
  onInsertCompanyImage?: () => void;
}

// React.memo: App.jsx ahora pasa callbacks estables (useCallback) para todos
// estos props — antes eran arrow functions inline recreadas en cada render,
// lo que habría anulado el memo de todas formas.
const LeftLibrary = React.memo(function LeftLibrary({
  onAdd,
  onAddPage,
  onDuplicatePage,
  onAddFindings,
  onAddAnnexes,
  onAddReferences,
  onAddApa7Citation,
  onAddTechnicalBlock,
  onAddSectionTemplate,
  onAddStaticChart,
  onExportVideo,
  onAddCover,
  onAddToc,
  onInsertCompanyImage,
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
          <Blocks size={18} color="var(--accent)" aria-hidden />
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
            <Factory size={18} aria-hidden />
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
          <button type="button" className="tool-action" onClick={onAddAnnexes} title="Insertar sección ANEXOS (aparece en la Tabla de Contenidos)">
            <FolderArchive size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Anexos</span>}
          </button>
          <button type="button" className="tool-action" onClick={onAddReferences} title="Insertar sección Bibliografía / Referencias (aparece en la Tabla de Contenidos)">
            <BookMarked size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Referencias</span>}
          </button>
          <button type="button" className="tool-action" onClick={onAddApa7Citation} title="Agregar una cita bibliográfica con formato APA 7 (IA local da formato a datos que usted ya verificó, nunca busca ni inventa fuentes)">
            <Sparkles size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Cita APA 7</span>}
          </button>
          <button type="button" className="tool-action" onClick={() => onAddTechnicalBlock?.('callout-info')} title="Insertar una caja de resaltado (Nota). En Insertar → Bloques Técnicos hay las 5 variantes: Nota, Conforme, Observación, Crítico y Dictamen ejecutivo">
            <Info size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Caja resaltado</span>}
          </button>
          <button type="button" className="tool-action" onClick={() => onAddTechnicalBlock?.('kpi-strip')} title="Insertar una tira de 4 tarjetas KPI (valor + meta), como el dashboard ejecutivo del modelo minero">
            <LayoutGrid size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Tarjetas KPI</span>}
          </button>
          <button type="button" className="tool-action" onClick={() => onAddTechnicalBlock?.('caption')} title="Insertar un pie de figura con estilo (itálica azul, centrado): «Figura N. …»">
            <Captions size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Pie de figura</span>}
          </button>
          <button type="button" className="tool-action" onClick={() => onAddSectionTemplate?.('estado-sistema')} title="Insertar una sección con tabla especializada (empieza con «Estado por sistema», tabla semáforo). En Insertar → Secciones están las 10 plantillas: inventario, TARP, hallazgos, plan de acción, ficha de sensor, checklist, firmas…">
            <Rows3 size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Sección técnica</span>}
          </button>
          <button type="button" className="tool-action" onClick={() => onAddStaticChart?.('chart-combo')} title="Insertar un gráfico con datos (combo de doble eje). En Insertar → Gráficos con datos están los 3 tipos: línea con meta, barras horizontales y combo de doble eje">
            <LineChart size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Gráfico con datos</span>}
          </button>
          <button
            type="button"
            className="tool-action"
            onClick={onExportVideo}
            title="Grabar un vídeo de pantalla/ventana e insertarlo en la página activa"
          >
            <Clapperboard size={18} aria-hidden />
            {isExpanded && <span className="tool-action-label">Grabar vídeo</span>}
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
});

export default LeftLibrary;
