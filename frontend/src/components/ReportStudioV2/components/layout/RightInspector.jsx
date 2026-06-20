import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { fetchMiningKpis } from '../../lib/api';
import SensorInspector from './SensorInspector';
import { readImageFileAsDataUrl, resolveReportImageSrc } from '../../lib/reportImageSrc';

import {
  Lock,
  Unlock,
  Trash2,
  Settings2,
  Palette,
  Grid3X3,
  Image as ImageIcon,
  Camera,
  MonitorPlay,
  FolderOpen,
  Move,
  MousePointerClick,
  Type,
  BarChart3,
  Target,
  Table as TableIcon,
  Map as MapIcon,
  Activity,
  Pin,
  PinOff,
  ChevronLeft,
} from 'lucide-react';

const ELEMENT_TYPE_META = {
  text: { icon: Type, tip: 'Bloque de texto seleccionado' },
  chart: { icon: BarChart3, tip: 'Gráfico seleccionado' },
  kpi: { icon: Target, tip: 'Indicador KPI seleccionado' },
  image: { icon: ImageIcon, tip: 'Imagen seleccionada' },
  table: { icon: TableIcon, tip: 'Tabla seleccionada' },
  map: { icon: MapIcon, tip: 'Mapa seleccionado' },
  sensor: { icon: Activity, tip: 'Sensor en tiempo real seleccionado' },
};

function InspectorRailIcon({ icon: Icon, title, variant }) {
  return (
    <span
      className={`inspector-rail-icon${variant ? ` inspector-rail-icon--${variant}` : ''}`}
      title={title}
      role="img"
      aria-label={title}
    >
      <Icon size={18} aria-hidden />
    </span>
  );
}

/* ───────── TABLE INSPECTOR ───────── */
function TableInspector({ element, onUpdate }) {
  const { props } = element;

  const updateProps = (patch) => {
    onUpdate({ props: { ...props, ...patch } });
  };

  const addRow = () => {
    const colCount = props.rows[0]?.length || 3;
    const newRow = Array(colCount).fill('');
    updateProps({ rows: [...props.rows, newRow] });
  };

  const addColumn = () => {
    const newRows = props.rows.map(row => [...row, '']);
    updateProps({ rows: newRows });
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label">Configuración de Tabla</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Doble clic en la tabla en el lienzo para editar celdas. Un clic selecciona y mueve el bloque.
      </p>

      <div className="input-group">
        <label>Color de Borde</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Palette size={16} color="var(--text-muted)" />
          <input 
            type="color" 
            value={props.borderColor} 
            onChange={(e) => updateProps({ borderColor: e.target.value })} 
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
      </div>

      <div className="input-group">
        <label>Fondo Cabecera</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Palette size={16} color="var(--text-muted)" />
          <input 
            type="color" 
            value={props.headerBg} 
            onChange={(e) => updateProps({ headerBg: e.target.value })} 
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group">
          <label>Padding Celdas</label>
          <input 
            className="input-premium" 
            type="number" 
            value={props.cellPadding} 
            onChange={(e) => updateProps({ cellPadding: Number(e.target.value) })} 
          />
        </div>
        <div className="input-group">
          <label>Tamaño Texto</label>
          <input 
            className="input-premium" 
            type="number" 
            value={props.fontSize} 
            onChange={(e) => updateProps({ fontSize: Number(e.target.value) })} 
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <button className="btn-premium-outline" onClick={addRow}>
          <Grid3X3 size={14} style={{ marginRight: 6 }} /> + Fila
        </button>
        <button className="btn-premium-outline" onClick={addColumn}>
          <Grid3X3 size={14} style={{ marginRight: 6 }} /> + Col
        </button>
      </div>
    </div>
  );
}

function KpiInspector({ element, onUpdate }) {
  const props = element.props || {};
  const updateProps = (patch) => onUpdate({ props: { ...props, ...patch } });
  const [availableKpis, setAvailableKpis] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMiningKpis();
        if (!cancelled) {
          setAvailableKpis(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (!cancelled) {
          setAvailableKpis([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCode = String(props.kpiCode || '');
  const hasSelectedInCatalog = availableKpis.some((k) => String(k.code || '') === selectedCode);
  const vizOptions = [
    { value: 'spark_bars', label: 'Mini barras (informe — predeterminado)' },
    { value: 'line', label: 'Línea de tendencia' },
    { value: 'donut', label: 'Anillo vs meta (requiere meta en BD)' },
    { value: 'none', label: 'Sin gráfico (solo valor y estado)' },
  ];
  const vizValue = vizOptions.some((o) => o.value === props.trendViz) ? props.trendViz : 'spark_bars';

  return (
    <div className="inspector-form">
      <span className="inspector-section-label">Configuración KPI Runtime</span>
      <div className="input-group">
        <label>Título</label>
        <input
          className="input-premium"
          value={props.title || ''}
          onChange={(e) => updateProps({ title: e.target.value })}
          placeholder="Ej: Tonelaje movido"
        />
      </div>
      <div className="input-group">
        <label>Código KPI (DB)</label>
        <select
          className="input-premium"
          value={hasSelectedInCatalog ? selectedCode : ''}
          onChange={(e) => {
            const code = String(e.target.value || '').trim();
            const selectedKpi = availableKpis.find((k) => String(k.code || '') === code);
            updateProps({
              kpiCode: code,
              title: selectedKpi?.title ? String(selectedKpi.title) : props.title,
            });
          }}
        >
          <option value="" disabled>
            {availableKpis.length ? 'Seleccionar KPI disponible...' : 'No hay KPI disponibles'}
          </option>
          {availableKpis.map((kpi) => (
            <option key={String(kpi.code || '')} value={String(kpi.code || '')}>
              {String(kpi.title || kpi.code || '')}
            </option>
          ))}
        </select>
      </div>
      <div className="input-group">
        <label>Visualización de tendencia</label>
        <select
          className="input-premium"
          value={vizValue}
          onChange={(e) => updateProps({ trendViz: e.target.value })}
        >
          {vizOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p style={{ marginTop: 6, marginBottom: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
          En plantillas tipo Word lo habitual son mini-barras o línea. El anillo usa valor actual frente a la meta
          del KPI en runtime (campo target).
        </p>
      </div>
    </div>
  );
}

/* ───────── IMAGE INSPECTOR (barra Propiedades — Informe técnico) ───────── */
function ImageInspector({ element, onUpdate, onOpenCaptureModal }) {
  const fileRef = useRef(null);
  const [fileBusy, setFileBusy] = useState(false);
  const previewSrc = resolveReportImageSrc(element);
  const props = element.props || {};

  const onPickLocalFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileBusy(true);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      if (!dataUrl || dataUrl.length < 80) return;
      onUpdate({ src: dataUrl });
    } catch {
      /* ignore */
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label">Imagen en el documento</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Vista previa y origen: cargue un archivo desde esta PC, abra la cámara web o una cámara de la red minera
        (videovigilancia). El lienzo se actualiza al instante al elegir archivo; las cámaras abren un asistente a
        pantalla completa.
      </p>

      <div
        style={{
          marginBottom: 12,
          borderRadius: 8,
          border: '1px solid var(--border, #e2e8f0)',
          background: '#f8fafc',
          overflow: 'hidden',
          minHeight: 96,
          maxHeight: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={previewSrc}
          alt={props.alt || ''}
          style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain', display: 'block' }}
        />
      </div>

      <div className="input-group">
        <label>Texto alternativo (accesibilidad)</label>
        <input
          className="input-premium"
          value={props.alt ?? ''}
          onChange={(e) => onUpdate({ props: { ...props, alt: e.target.value } })}
          placeholder="Descripción breve de la figura"
        />
      </div>

      <div className="input-group">
        <label>Ajuste en el marco</label>
        <select
          className="input-premium"
          value={element.objectFit || 'cover'}
          onChange={(e) => onUpdate({ objectFit: e.target.value })}
        >
          <option value="cover">Cubrir (recortar si hace falta)</option>
          <option value="contain">Contener (sin recortar)</option>
          <option value="fill">Estirar al marco</option>
        </select>
      </div>

      <span className="inspector-section-label" style={{ marginTop: 4 }}>
        Origen de la imagen
      </span>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={onPickLocalFile} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn-premium-outline"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          disabled={fileBusy}
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen size={16} />
          {fileBusy ? 'Leyendo archivo…' : 'Cargar archivo desde esta PC…'}
        </button>
        <button
          type="button"
          className="btn-premium-outline"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onClick={() => onOpenCaptureModal?.('camera')}
        >
          <Camera size={16} />
          Capturar con cámara web…
        </button>
        <button
          type="button"
          className="btn-premium-outline"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onClick={() => onOpenCaptureModal?.('network')}
        >
          <MonitorPlay size={16} />
          Red de cámaras (plataforma)…
        </button>
        <button
          type="button"
          className="btn-premium-outline"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onClick={() => onOpenCaptureModal?.('file')}
        >
          <ImageIcon size={16} />
          Asistente completo (todas las opciones)…
        </button>
      </div>
    </div>
  );
}

/* ───────── MAIN COMPONENT ───────── */
export default function RightInspector({ onRequestImageReplace }) {
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const page = useEditorStore((s) => s.doc.pages.find((p) => p.page_number === selectedPage));
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);

  const selected = useMemo(
    () => page?.elements.find((element) => element.id === selectedElementId),
    [page, selectedElementId],
  );

  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const isExpanded = isHovered || isPinned;

  const typeMeta = selected ? ELEMENT_TYPE_META[selected.type] : null;
  const TypeIcon = typeMeta?.icon || Settings2;
  const showStyleRail = selected && ['table', 'kpi', 'image'].includes(selected.type);

  return (
    <aside 
      className={`panel panel--right ${isExpanded ? 'panel--right-expanded' : ''}${isPinned ? ' panel--pinned' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!isPinned) setIsHovered(false); }}
    >
      {!isExpanded && (
        <span className="panel-edge-hint panel-edge-hint--left" title="Pase el cursor para expandir propiedades">
          <ChevronLeft size={14} aria-hidden />
        </span>
      )}

      <div className="panel-title-row">
        <h3 className="panel-title panel-title--inspector" title="Propiedades del bloque seleccionado en el lienzo">
          <Settings2 size={18} color="var(--accent)" aria-hidden />
          {isExpanded && <span>Propiedades</span>}
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

      {/* ── RIEL CONTRAÍDO: iconos representativos ── */}
      {!isExpanded && (
        <div className="inspector-rail">
          {selected ? (
            <>
              <InspectorRailIcon
                icon={TypeIcon}
                title={typeMeta?.tip || 'Bloque seleccionado'}
              />
              <InspectorRailIcon
                icon={Move}
                title="Geometría: posición y tamaño del bloque"
              />
              {showStyleRail && (
                <InspectorRailIcon
                  icon={Palette}
                  title="Estilo y apariencia del bloque"
                />
              )}
              <InspectorRailIcon
                icon={selected.locked ? Lock : Unlock}
                title={selected.locked ? 'El bloque está bloqueado en el lienzo' : 'El bloque se puede mover y redimensionar'}
              />
              <InspectorRailIcon
                icon={Trash2}
                title="Eliminar el bloque seleccionado"
                variant="danger"
              />
            </>
          ) : (
            <InspectorRailIcon
              icon={MousePointerClick}
              title="Seleccione un bloque en el lienzo para ver y editar sus propiedades"
            />
          )}
        </div>
      )}

      {/* ── ELEMENT INSPECTOR ── */}
      {selected && isExpanded && (
        <div className="inspector-content-scroll" style={{ marginTop: 4 }}>
          {selected.type === 'table' && (
            <TableInspector 
              element={selected} 
              onUpdate={(patch) => updateElement(selectedPage, selected.id, patch)} 
            />
          )}
          {selected.type === 'kpi' && (
            <KpiInspector
              element={selected}
              onUpdate={(patch) => updateElement(selectedPage, selected.id, patch)}
            />
          )}

          {selected.type === 'sensor' && (
            <div style={{ marginTop: selected.type === 'table' || selected.type === 'kpi' ? 18 : 0 }}>
              <SensorInspector
                element={selected}
                onUpdate={(patch) => updateElement(selectedPage, selected.id, patch)}
              />
            </div>
          )}

          {selected.type === 'image' && (
            <div style={{ marginTop: selected.type === 'table' || selected.type === 'kpi' ? 18 : 0 }}>
              <ImageInspector
                element={selected}
                onUpdate={(patch) => updateElement(selectedPage, selected.id, patch)}
                onOpenCaptureModal={(tab) => onRequestImageReplace?.(selectedPage, selected.id, tab)}
              />
            </div>
          )}

          <div
            className="inspector-form"
            style={{
              marginTop:
                selected.type === 'table' ||
                selected.type === 'kpi' ||
                selected.type === 'sensor' ||
                selected.type === 'image'
                  ? 18
                  : 0,
            }}
          >
            <span className="inspector-section-label">Geometría y Bloqueo</span>
            <div className="inspector-grid-2" style={{ marginTop: 8 }}>
               <div className="input-group">
                  <label>Posición X</label>
                  <input className="input-premium" type="number" value={Math.round(selected.x)} onChange={(e) => updateElement(selectedPage, selected.id, { x: Number(e.target.value) })} />
               </div>
               <div className="input-group">
                  <label>Posición Y</label>
                  <input className="input-premium" type="number" value={Math.round(selected.y)} onChange={(e) => updateElement(selectedPage, selected.id, { y: Number(e.target.value) })} />
               </div>
            </div>
            <div className="inspector-grid-2">
               <div className="input-group">
                  <label>Ancho</label>
                  <input className="input-premium" type="number" value={Math.round(selected.width)} onChange={(e) => updateElement(selectedPage, selected.id, { width: Math.max(20, Number(e.target.value)) })} />
               </div>
               <div className="input-group">
                  <label>Alto</label>
                  <input className="input-premium" type="number" value={Math.round(selected.height)} onChange={(e) => updateElement(selectedPage, selected.id, { height: Math.max(20, Number(e.target.value)) })} />
               </div>
            </div>
            
            <div className="inspector-actions" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn-premium-outline"
                style={{ flex: 1 }}
                onClick={() => updateElement(selectedPage, selected.id, { locked: !selected.locked })}
                title={selected.locked ? 'Desbloquear el bloque para moverlo en el lienzo' : 'Bloquear el bloque para evitar cambios accidentales'}
              >
                {selected.locked ? <Unlock size={14} /> : <Lock size={14} />}
                {selected.locked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button
                className="btn-premium-outline btn-premium-outline--danger"
                style={{ flex: 1 }}
                onClick={() => removeElement(selectedPage, selected.id)}
                title="Eliminar el bloque seleccionado del informe"
              >
                <Trash2 size={14} /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {!selected && isExpanded && (
        <div className="inspector-empty-state">
           <MousePointerClick size={44} color="#94a3b8" style={{ marginBottom: 14 }} aria-hidden />
           <p title="Haga clic en cualquier bloque del lienzo para editarlo aquí">
             Seleccione un bloque en el lienzo para editar sus propiedades
           </p>
        </div>
      )}
    </aside>
  );
}
