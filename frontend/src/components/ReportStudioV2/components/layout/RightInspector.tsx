import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore, defaultBorderByType, type ReportElement } from '../../store/useEditorStore';
import { fetchMiningKpis } from '../../lib/api';
import SensorInspector from './SensorInspector';
import { readImageFileAsDataUrl, resolveReportImageSrc } from '../../lib/reportImageSrc';
import { getSession } from '../../../../auth/authStorage';
import { fetchTenantGallery, fetchTenantGalleryImageDataUrl, type TenantGalleryImage } from '../../lib/tenantGallery';
import ColorPalette from '../shared/ColorPalette';

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
  Plug,
  Unplug,
  RefreshCw,
} from 'lucide-react';

const ELEMENT_TYPE_META: Record<string, { icon: React.ElementType; tip: string }> = {
  text: { icon: Type, tip: 'Bloque de texto seleccionado' },
  chart: { icon: BarChart3, tip: 'Gráfico seleccionado' },
  kpi: { icon: Target, tip: 'Indicador KPI seleccionado' },
  image: { icon: ImageIcon, tip: 'Imagen seleccionada' },
  table: { icon: TableIcon, tip: 'Tabla seleccionada' },
  map: { icon: MapIcon, tip: 'Mapa seleccionado' },
  sensor: { icon: Activity, tip: 'Sensor en tiempo real seleccionado' },
  header: { icon: Type, tip: 'Encabezado de página seleccionado' },
  footer: { icon: Type, tip: 'Pie de página seleccionado' },
};

interface InspectorRailIconProps {
  icon: React.ElementType;
  title: string;
  variant?: string;
}

function InspectorRailIcon({ icon: Icon, title, variant }: InspectorRailIconProps) {
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

interface SubInspectorProps {
  element: ReportElement;
  onUpdate: (patch: Partial<ReportElement>) => void;
}

/* ───────── TABLE INSPECTOR ───────── */
// Galería de estilos rápidos ("Table Design" de Word): un clic aplica un
// conjunto coherente de colores (borde/cabecera/texto de cabecera/franjas)
// en vez de tener que ajustar cada color por separado.
const TABLE_STYLE_THEMES: { id: string; label: string; borderColor: string; headerBg: string; headerTextColor: string; bandColor: string }[] = [
  { id: 'slate',    label: 'Gris pizarra', borderColor: '#e2e8f0', headerBg: '#f8fafc', headerTextColor: '#1e293b', bandColor: '#f1f5f9' },
  { id: 'blue',     label: 'Azul corporativo', borderColor: '#bfdbfe', headerBg: '#2563eb', headerTextColor: '#ffffff', bandColor: '#eff6ff' },
  { id: 'green',    label: 'Verde operación', borderColor: '#bbf7d0', headerBg: '#15803d', headerTextColor: '#ffffff', bandColor: '#f0fdf4' },
  { id: 'amber',    label: 'Ámbar alerta', borderColor: '#fde68a', headerBg: '#b45309', headerTextColor: '#ffffff', bandColor: '#fffbeb' },
  { id: 'red',      label: 'Rojo crítico', borderColor: '#fecaca', headerBg: '#b91c1c', headerTextColor: '#ffffff', bandColor: '#fef2f2' },
  { id: 'mono',     label: 'Blanco y negro', borderColor: '#0f172a', headerBg: '#0f172a', headerTextColor: '#ffffff', bandColor: '#f1f5f9' },
];

function TableInspector({ element, onUpdate }: SubInspectorProps) {
  const { props } = element;

  const updateProps = (patch: Record<string, unknown>) => {
    onUpdate({ props: { ...props, ...patch } });
  };

  const addRow = () => {
    const colCount = props.rows[0]?.length || 3;
    const newRow = Array(colCount).fill('');
    updateProps({ rows: [...props.rows, newRow] });
  };

  const addColumn = () => {
    const newRows = props.rows.map((row: any[]) => [...row, '']);
    updateProps({ rows: newRows });
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label">Configuración de Tabla</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Doble clic en la tabla en el lienzo para editar celdas. Un clic selecciona y mueve el bloque.
      </p>

      <div className="input-group" title="Título o leyenda que aparece encima de la tabla (opcional)">
        <label>Título de la Tabla</label>
        <input
          className="input-premium"
          type="text"
          placeholder="Sin título"
          value={props.title || ''}
          onChange={(e) => updateProps({ title: e.target.value })}
        />
      </div>

      <div className="input-group" title="Estilos de tabla predefinidos — un clic aplica borde, cabecera y franjas coherentes, igual que la galería 'Diseño de tabla' de Word">
        <label>Estilos Rápidos</label>
        <div className="table-style-gallery">
          {TABLE_STYLE_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className="table-style-swatch"
              title={theme.label}
              onClick={() => updateProps({
                borderColor: theme.borderColor,
                headerBg: theme.headerBg,
                headerTextColor: theme.headerTextColor,
                bandColor: theme.bandColor,
              })}
            >
              <span className="table-style-swatch-header" style={{ background: theme.headerBg }} />
              <span className="table-style-swatch-row" style={{ background: theme.bandColor, borderColor: theme.borderColor }} />
              <span className="table-style-swatch-row" style={{ background: '#ffffff', borderColor: theme.borderColor }} />
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group" title="Color de las líneas de la cuadrícula de la tabla">
          <label>Color de Borde</label>
          <input
            type="color"
            value={props.borderColor}
            onChange={(e) => updateProps({ borderColor: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
        <div className="input-group" title="Color de fondo de la primera fila (cabecera) de la tabla">
          <label>Fondo Cabecera</label>
          <input
            type="color"
            value={props.headerBg}
            onChange={(e) => updateProps({ headerBg: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group" title="Color del texto de la fila de cabecera">
          <label>Color Texto Cabecera</label>
          <input
            type="color"
            value={props.headerTextColor || '#1e293b'}
            onChange={(e) => updateProps({ headerTextColor: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
        <div className="input-group" title="Color de las filas alternadas cuando 'Filas Alternadas' está activo">
          <label>Color Franja</label>
          <input
            type="color"
            value={props.bandColor || '#f1f5f9'}
            onChange={(e) => updateProps({ bandColor: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group" title="Grosor de las líneas del borde (px)">
          <label>Grosor Borde</label>
          <input
            className="input-premium"
            type="number"
            min={0}
            max={8}
            value={Number(props.borderWidth) || 1}
            onChange={(e) => updateProps({ borderWidth: Number(e.target.value) })}
          />
        </div>
        <div className="input-group" title="Estilo de línea del borde">
          <label>Estilo Borde</label>
          <select
            className="input-premium"
            value={props.borderStyle || 'solid'}
            onChange={(e) => updateProps({ borderStyle: e.target.value })}
          >
            <option value="solid">Sólido</option>
            <option value="dashed">Discontinuo</option>
            <option value="dotted">Punteado</option>
            <option value="none">Sin borde</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group" title="Espacio interior (px) entre el borde de cada celda y su contenido">
          <label>Padding Celdas</label>
          <input
            className="input-premium"
            type="number"
            value={props.cellPadding}
            onChange={(e) => updateProps({ cellPadding: Number(e.target.value) })}
          />
        </div>
        <div className="input-group" title="Tamaño de la tipografía del contenido de las celdas (px)">
          <label>Tamaño Texto</label>
          <input
            className="input-premium"
            type="number"
            value={props.fontSize}
            onChange={(e) => updateProps({ fontSize: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="input-group" title="Alineación horizontal del contenido de las celdas">
        <label>Alineación de Celdas</label>
        <select
          className="input-premium"
          value={props.cellAlign || 'left'}
          onChange={(e) => updateProps({ cellAlign: e.target.value })}
        >
          <option value="left">Izquierda</option>
          <option value="center">Centro</option>
          <option value="right">Derecha</option>
        </select>
      </div>

      <div className="inspector-actions" style={{ marginTop: 4, display: 'flex', gap: 8 }}>
        <button
          className={`btn-premium-outline${props.headerBold !== false ? ' btn-premium-outline--active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => updateProps({ headerBold: props.headerBold === false })}
          title="Negrita en el texto de la fila de cabecera"
        >
          Cabecera Negrita
        </button>
        <button
          className={`btn-premium-outline${props.bandedRows ? ' btn-premium-outline--active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => updateProps({ bandedRows: !props.bandedRows })}
          title="Colorear filas alternadas para facilitar la lectura, igual que 'Filas con bandas' de Word"
        >
          Filas Alternadas
        </button>
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

function KpiInspector({ element, onUpdate }: SubInspectorProps) {
  const props = element.props || {};
  const updateProps = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } });
  const [availableKpis, setAvailableKpis] = useState<any[]>([]);

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
      <span className="inspector-section-label" title="Vincula este bloque a un indicador KPI del sistema en tiempo real">Configuración KPI Runtime</span>
      <div className="input-group" title="Rótulo visible del indicador en el informe. Se autocompleta al elegir un KPI del catálogo.">
        <label>Título</label>
        <input
          className="input-premium"
          value={props.title || ''}
          onChange={(e) => updateProps({ title: e.target.value })}
          placeholder="Ej: Tonelaje movido"
        />
      </div>
      <div className="input-group" title="Código del KPI en la base de datos: define de dónde se lee el valor en vivo (fuente de verdad)">
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
      <div className="input-group" title="Cómo se dibuja la tendencia: mini-barras/línea (estilo informe) o anillo contra la meta">
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
      <button
        type="button"
        className="btn-premium-outline"
        style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}
        onClick={() => updateProps({ connected: props.connected === false })}
        title={
          props.connected === false
            ? 'Reanudar el sondeo en vivo de este KPI contra la base de datos'
            : 'Congelar este KPI en su último valor — deja de consultar la base de datos'
        }
      >
        {props.connected === false ? <Plug size={14} /> : <Unplug size={14} />}
        {props.connected === false ? 'Conectar a la base de datos' : 'Desconectar de la base de datos'}
      </button>
    </div>
  );
}

interface ImageInspectorProps extends SubInspectorProps {
  onOpenCaptureModal?: (tab: string) => void;
}

/* ───────── IMAGE INSPECTOR (barra Propiedades — Informe técnico) ───────── */
function ImageInspector({ element, onUpdate, onOpenCaptureModal }: ImageInspectorProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const previewSrc = resolveReportImageSrc(element);
  const props = element.props || {};

  const onPickLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

      <div className="input-group" title="Descripción de la figura para lectores de pantalla y para el pie/índice de figuras">
        <label>Texto alternativo (accesibilidad)</label>
        <input
          className="input-premium"
          value={props.alt ?? ''}
          onChange={(e) => onUpdate({ props: { ...props, alt: e.target.value } })}
          placeholder="Descripción breve de la figura"
        />
      </div>

      <div className="input-group" title="Cómo encaja la imagen en su marco: cubrir (recorta), contener (sin recortar) o estirar">
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
          className="btn-premium"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onClick={() => onOpenCaptureModal?.('gallery')}
        >
          <ImageIcon size={16} />
          Elegir de la galería de la unidad minera…
        </button>
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

/* ───────── CHART INSPECTOR ───────── */
const ChartInspector = React.memo(function ChartInspector({ element, onUpdate }: SubInspectorProps) {
  const props = element.props || {};
  const updateProps = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } });
  const chartTypes = [
    { value: 'bar', label: 'Barras' },
    { value: 'line', label: 'Líneas' },
    { value: 'area', label: 'Área' },
    { value: 'pie', label: 'Circular (pastel)' },
  ];
  const chartType = chartTypes.some((c) => c.value === props.chartType) ? props.chartType : 'bar';
  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Configuración del gráfico de series y ejes">Configuración de Gráfico</span>
      <div className="input-group" title="Título que se muestra sobre el gráfico en el informe">
        <label>Título</label>
        <input className="input-premium" value={props.title || ''} onChange={(e) => updateProps({ title: e.target.value })} placeholder="Ej: Producción mensual" />
      </div>
      <div className="input-group" title="Tipo de representación: barras, líneas, área o circular">
        <label>Tipo de gráfico</label>
        <select className="input-premium" value={chartType} onChange={(e) => updateProps({ chartType: e.target.value })}>
          {chartTypes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div className="input-group" title="Si está activo, el gráfico refleja datos en vivo; si no, un snapshot fijo">
        <label>Datos en vivo</label>
        <select className="input-premium" value={props.live ? 'yes' : 'no'} onChange={(e) => updateProps({ live: e.target.value === 'yes' })}>
          <option value="yes">Sí — actualiza en tiempo real</option>
          <option value="no">No — snapshot fijo (reproducible)</option>
        </select>
      </div>
    </div>
  );
});

/* ───────── TEXT INSPECTOR ───────── */
const TextInspector = React.memo(function TextInspector({ element, onUpdate }: SubInspectorProps) {
  const props = element.props || {};
  const updateProps = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } });
  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Formato del bloque de texto (párrafos y listas)">Formato de Texto</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Doble clic en el bloque del lienzo para editar el contenido. Aquí ajusta el formato.
      </p>
      <div className="inspector-grid-2">
        <div className="input-group" title="Familia tipográfica del bloque (estilo documento)">
          <label>Fuente</label>
          <select className="input-premium" value={props.fontFamily || 'Arial'} onChange={(e) => updateProps({ fontFamily: e.target.value })}>
            {['Arial', 'Inter', 'Times New Roman', 'Georgia', 'Calibri', 'Verdana'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="input-group" title="Tamaño de la tipografía en puntos">
          <label>Tamaño</label>
          <input className="input-premium" type="number" value={Number(props.fontSize) || 16} onChange={(e) => updateProps({ fontSize: Number(e.target.value) })} />
        </div>
      </div>
      <div className="inspector-grid-2">
        <div className="input-group" title="Color del texto de todo el bloque (para colorear solo una parte, selecciónala al editar y usa el color de la barra flotante)">
          <label>Color</label>
          <ColorPalette value={props.fontColor || '#0f172a'} label={props.fontColor || '#0f172a'} onChange={(color) => updateProps({ fontColor: color })} />
        </div>
        <div className="input-group" title="Alineación horizontal del párrafo">
          <label>Alineación</label>
          <select className="input-premium" value={props.textAlign || 'left'} onChange={(e) => updateProps({ textAlign: e.target.value })}>
            <option value="left">Izquierda</option>
            <option value="center">Centro</option>
            <option value="right">Derecha</option>
            <option value="justify">Justificado</option>
          </select>
        </div>
      </div>
      <div className="input-group" title="Tipo de lista aplicada al bloque">
        <label>Lista</label>
        <select className="input-premium" value={props.listType || 'none'} onChange={(e) => updateProps({ listType: e.target.value })}>
          <option value="none">Sin lista</option>
          <option value="bullet">Viñetas</option>
          <option value="ordered">Numerada</option>
        </select>
      </div>
      <div className="input-group" title="Separación entre líneas dentro del párrafo — equivalente a 'Interlineado' en Word">
        <label>Interlineado</label>
        <div className="line-spacing-presets">
          {[
            { value: 1, label: 'Sencillo' },
            { value: 1.15, label: '1,15' },
            { value: 1.35, label: '1,35' },
            { value: 1.5, label: '1,5' },
            { value: 2, label: 'Doble' },
          ].map((preset) => {
            const active = Math.abs((Number(props.lineHeight) || 1.35) - preset.value) < 0.001;
            return (
              <button
                key={preset.value}
                type="button"
                className={`line-spacing-preset${active ? ' line-spacing-preset--active' : ''}`}
                title={`Interlineado ${preset.label}`}
                onClick={() => updateProps({ lineHeight: preset.value })}
              >
                {preset.label}
              </button>
            );
          })}
          <input
            className="input-premium line-spacing-custom"
            type="number"
            step={0.05}
            min={0.8}
            max={3}
            title="Interlineado personalizado (0.8 a 3.0)"
            value={Number(props.lineHeight) || 1.35}
            onChange={(e) => updateProps({ lineHeight: Math.max(0.8, Number(e.target.value) || 1.35) })}
          />
        </div>
      </div>
      <div className="inspector-actions" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button className={`btn-premium-outline${props.bold ? ' btn-premium-outline--active' : ''}`} style={{ flex: 1 }} onClick={() => updateProps({ bold: !props.bold })} title="Alternar negrita (Ctrl+B)">
          <Type size={14} /> Negrita
        </button>
        <button className={`btn-premium-outline${props.italic ? ' btn-premium-outline--active' : ''}`} style={{ flex: 1 }} onClick={() => updateProps({ italic: !props.italic })} title="Alternar cursiva (Ctrl+I)">
          <Type size={14} /> Cursiva
        </button>
        <button className={`btn-premium-outline${props.underline ? ' btn-premium-outline--active' : ''}`} style={{ flex: 1 }} onClick={() => updateProps({ underline: !props.underline })} title="Alternar subrayado (Ctrl+U)">
          <Type size={14} /> Subrayado
        </button>
      </div>
    </div>
  );
});

/* ───────── COVER INSPECTOR (ADR-048 revisado) ───────── */
// Carátula a toda página: solo campos de texto — la imagen de la unidad
// minera ya NO se aplica como fondo de este bloque (generaba un
// background-image repetido/mosaico y, al ser parte de un bloque bloqueado,
// no se podía mover ni redimensionar). Ahora es un bloque `image` normal,
// independiente y libre, insertado centrado en la página vía el botón
// "Insertar Imagen Empresa" (ribbon/menú contextual) — se mueve y
// redimensiona igual que cualquier imagen.
/** Miniatura de galería con vista ampliada (lightbox) al hacer clic — ayuda
 * visual para elegir la foto antes de insertarla en la carátula (pedido
 * explícito: "reducida... que pueda después ampliarse con un click"). */
function CoverGalleryPicker({ pageNumber }: { pageNumber: number }) {
  const addCenteredImage = useEditorStore((s) => s.addCenteredImage);
  const [images, setImages] = useState<TenantGalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [enlarged, setEnlarged] = useState<TenantGalleryImage | null>(null);
  const [inserting, setInserting] = useState(false);
  const tenantId = getSession()?.tenantId;

  useEffect(() => {
    let cancelled = false;
    if (!tenantId) return;
    setLoading(true);
    fetchTenantGallery(tenantId).then((list) => {
      if (!cancelled) setImages(list);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const handleInsert = async (image: TenantGalleryImage) => {
    if (!tenantId || inserting) return;
    setInserting(true);
    try {
      const dataUrl = await fetchTenantGalleryImageDataUrl(tenantId, image.image_id);
      if (dataUrl) {
        addCenteredImage(pageNumber, dataUrl);
        setEnlarged(null);
      }
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="input-group" title="Fotos de la unidad minera registradas en la plataforma">
      <label>Fotos de la unidad minera</label>
      {loading && <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>Cargando galería…</p>}
      {!loading && images.length === 0 && (
        <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>Aún no hay fotos registradas para esta unidad minera.</p>
      )}
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 4 }}>
          {images.map((img) => (
            <button
              key={img.image_id}
              type="button"
              onClick={() => setEnlarged(img)}
              title={`Ver ${img.filename} en grande`}
              style={{
                padding: 0, border: '1px solid var(--border, #e2e8f0)', borderRadius: 6,
                overflow: 'hidden', cursor: 'pointer', aspectRatio: '4 / 3', background: '#f1f5f9',
              }}
            >
              <img src={img.thumbnail_data_url} alt={img.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      )}

      {enlarged && (
        <div
          onClick={() => !inserting && setEnlarged(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#0f172a', borderRadius: 12, padding: 16, maxWidth: '80vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <img src={enlarged.thumbnail_data_url} alt={enlarged.filename} style={{ maxWidth: '70vw', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#cbd5e1', fontSize: 12 }}>{enlarged.filename}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-premium-outline" onClick={() => setEnlarged(null)} disabled={inserting}>Cerrar</button>
                <button type="button" className="btn-premium" onClick={() => handleInsert(enlarged)} disabled={inserting}>
                  {inserting ? 'Insertando…' : 'Insertar en la carátula'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CoverInspector = React.memo(function CoverInspector({ element, onUpdate }: SubInspectorProps) {
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const props = element.props || {};
  const updateProps = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } });

  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Carátula del informe — ocupa toda la primera hoja">Carátula</span>
      <div className="input-group" title="Título principal de la carátula">
        <label>Título</label>
        <input className="input-premium" type="text" value={props.title || ''} onChange={(e) => updateProps({ title: e.target.value })} placeholder="Informe Técnico" />
      </div>
      <div className="inspector-grid-2">
        <div className="input-group" title="Nivel de clasificación mostrado en la franja superior">
          <label>Clasificación</label>
          <input className="input-premium" type="text" value={props.classification || ''} onChange={(e) => updateProps({ classification: e.target.value })} placeholder="CONFIDENCIAL" />
        </div>
        <div className="input-group" title="Código de documento">
          <label>Código</label>
          <input className="input-premium" type="text" value={props.docCode || ''} onChange={(e) => updateProps({ docCode: e.target.value })} />
        </div>
      </div>
      <div className="input-group" title="Fecha del informe">
        <label>Fecha</label>
        <input className="input-premium" type="date" value={props.date || ''} onChange={(e) => updateProps({ date: e.target.value })} />
      </div>

      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
        Empresa, unidad minera y autor se generan automáticamente desde la sesión activa (igual que el
        encabezado/pie) — no se editan aquí ni pueden borrarse de la carátula.
      </p>

      <div className="inspector-grid-2" style={{ marginTop: 10 }}>
        <div className="input-group" title="Color de fondo de la carátula">
          <label>Color de fondo</label>
          <input
            type="color"
            value={props.bgColor || '#0f172a'}
            onChange={(e) => updateProps({ bgColor: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
        <div className="input-group" title="Color del texto de la carátula">
          <label>Color de texto</label>
          <input
            type="color"
            value={props.textColor || '#ffffff'}
            onChange={(e) => updateProps({ textColor: e.target.value })}
            style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        </div>
      </div>
      {props.bgColor && (
        <button type="button" className="btn-premium-outline" style={{ marginTop: 6 }} onClick={() => updateProps({ bgColor: '' })}>
          Restablecer degradé por defecto
        </button>
      )}

      <div style={{ marginTop: 10 }}>
        <CoverGalleryPicker pageNumber={selectedPage} />
      </div>
    </div>
  );
});

/* ───────── HEADER INSPECTOR (ADR-046 revisado) ───────── */
// Bloque de plataforma fijo: contenido, posición y tamaño ya NO son
// editables (empresa/unidad/usuario se calculan en vivo desde la sesión,
// ver PageCanvas.tsx) — el inspector es solo informativo, sin inputs.
const HeaderInspector = React.memo(function HeaderInspector() {
  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Encabezado de página — bloque fijo de plataforma">Encabezado</span>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
        Empresa, unidad minera y usuario conectado (izquierda) y logotipo corporativo (derecha) se generan automáticamente
        desde la sesión activa. Este bloque está bloqueado: no se puede mover, redimensionar, editar ni eliminar.
      </p>
    </div>
  );
});

/* ───────── FOOTER INSPECTOR (ADR-046 revisado) ───────── */
const FooterInspector = React.memo(function FooterInspector() {
  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Pie de página — bloque fijo de plataforma">Pie de Página</span>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
        &quot;BEEMETRY&quot; (izquierda) y la numeración de página (derecha) son fijos y se calculan automáticamente.
        Este bloque está bloqueado: no se puede mover, redimensionar, editar ni eliminar.
      </p>
    </div>
  );
});

/* ───────── MAP INSPECTOR ───────── */
const MapInspector = React.memo(function MapInspector({ element, onUpdate }: SubInspectorProps) {
  const props = element.props || {};
  const updateProps = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } });
  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Configuración del bloque de mapa de alta definición">Configuración de Mapa</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        En v0.1 el mapa se inserta como captura de alta resolución. Use el título y el
        texto alternativo para el índice de figuras.
      </p>
      <div className="input-group" title="Título del mapa mostrado en el informe">
        <label>Título</label>
        <input className="input-premium" value={props.title || ''} onChange={(e) => updateProps({ title: e.target.value })} placeholder="Ej: Plano de faena — Unidad Principal" />
      </div>
      <div className="input-group" title="Descripción para accesibilidad e índice de figuras">
        <label>Texto alternativo</label>
        <input className="input-premium" value={props.alt || ''} onChange={(e) => updateProps({ alt: e.target.value })} placeholder="Descripción breve del mapa" />
      </div>
    </div>
  );
});

/* ───────── BORDER INSPECTOR (compartido por todos los tipos de bloque) ───────── */
const BORDER_STYLE_OPTIONS: { value: 'solid' | 'dashed' | 'dotted'; label: string }[] = [
  { value: 'solid', label: 'Sólido' },
  { value: 'dashed', label: 'Discontinuo' },
  { value: 'dotted', label: 'Punteado' },
];

function BorderInspector({ element, onUpdate }: SubInspectorProps) {
  const border = element.border || defaultBorderByType(element.type);

  const updateBorder = (patch: Partial<typeof border>) => {
    onUpdate({ border: { ...border, ...patch } });
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Marco visible alrededor del bloque, independiente del resaltado de selección">
        Borde
      </span>
      <div className="input-group" title="Muestra u oculta el marco del bloque">
        <label>
          <input
            type="checkbox"
            checked={border.enabled}
            onChange={(e) => updateBorder({ enabled: e.target.checked })}
            style={{ marginRight: 8 }}
          />
          Mostrar borde
        </label>
      </div>
      {border.enabled && (
        <>
          <div className="inspector-grid-2">
            <div className="input-group" title="Grosor de la línea del borde en píxeles">
              <label>Ancho</label>
              <input
                className="input-premium"
                type="number"
                min={1}
                max={20}
                value={border.width}
                onChange={(e) => updateBorder({ width: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
            <div className="input-group" title="Estilo de la línea del borde">
              <label>Estilo</label>
              <select
                className="input-premium"
                value={border.style}
                onChange={(e) => updateBorder({ style: e.target.value as 'solid' | 'dashed' | 'dotted' })}
              >
                {BORDER_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="input-group" title="Color de la línea del borde">
            <label>Color de borde</label>
            <input
              type="color"
              value={border.color}
              onChange={(e) => updateBorder({ color: e.target.value })}
              style={{ width: '100%', height: 32, padding: 0, border: 'none', background: 'none' }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── WRAP INSPECTOR (ADR-049 revisado, "Ajustar texto" de Word) ─────
   Réplica de las 7 opciones del menú "Opciones de diseño" de Word — antes
   solo había 3 opciones en un <select> escondido varias secciones abajo en
   el panel ("muy ocultas... no puedo cambiar rápidamente"). Ahora: grilla de
   íconos de acceso directo (como el picker de Word) + el mismo set
   exportado para reutilizar en el menú contextual del objeto (clic derecho
   sobre la imagen/tabla/gráfico como alternativa adicional de cambio). */
export type WrapMode = 'inline' | 'square' | 'tight' | 'through' | 'topbottom' | 'behind' | 'infront';

export const WRAP_MODE_OPTIONS: { value: WrapMode; label: string; hint: string }[] = [
  { value: 'inline',    label: 'En línea con el texto', hint: 'El objeto se trata como parte del bloque, sin flotar por separado' },
  { value: 'square',    label: 'Cuadrado',              hint: 'El texto fluye alrededor del objeto (izquierda y derecha)' },
  { value: 'tight',     label: 'Estrecho',               hint: 'Como Cuadrado, pero el texto se acerca más al borde del objeto' },
  { value: 'through',   label: 'Transparente',           hint: 'El texto se acerca al máximo al objeto (equivalente a Estrecho en formas rectangulares)' },
  { value: 'topbottom', label: 'Arriba y abajo',          hint: 'El texto salta el objeto: nada a los costados, continúa debajo' },
  { value: 'behind',    label: 'Detrás del texto',        hint: 'El objeto flota detrás — el texto se dibuja encima, sin ajustarse' },
  { value: 'infront',   label: 'Delante del texto',       hint: 'El objeto flota delante — se dibuja encima del texto, sin ajustarse' },
];

export function normalizeWrapMode(raw: ReportElement['wrapMode']): WrapMode {
  if (raw === 'square' || raw === 'tight' || raw === 'through' || raw === 'topbottom' || raw === 'behind' || raw === 'inline') return raw;
  return 'infront'; // 'none' (legado) o sin definir
}

/** Mini-ícono estilo Word: líneas de texto + un rectángulo representando el
 * objeto, cada modo con su propia disposición (líneas cortadas, salteadas,
 * superpuestas, etc.) — mismo lenguaje visual que el picker nativo. */
function WrapModeIcon({ mode }: { mode: WrapMode }) {
  const line = (x: number, y: number, w: number) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={w} height={2} rx={1} fill="currentColor" opacity={0.55} />
  );
  const objRect = (x: number, y: number, w: number, h: number, opacity = 1) => (
    <rect x={x} y={y} width={w} height={h} rx={2} fill="currentColor" opacity={opacity} />
  );
  let content: React.ReactNode;
  switch (mode) {
    case 'inline':
      content = <>{line(2, 4, 24)}{objRect(9, 8, 10, 6)}{line(2, 18, 24)}</>;
      break;
    case 'square':
      content = <>{line(2, 4, 24)}{line(2, 9, 6)}{line(20, 9, 6)}{line(2, 14, 6)}{line(20, 14, 6)}{objRect(9, 8, 10, 8)}{line(2, 20, 24)}</>;
      break;
    case 'tight':
      content = <>{line(2, 4, 24)}{line(2, 9, 7)}{line(19, 9, 7)}{line(3, 14, 6)}{line(19, 14, 6)}{objRect(9, 8, 10, 8)}{line(2, 20, 24)}</>;
      break;
    case 'through':
      content = <>{line(2, 4, 24)}{line(2, 9, 8)}{line(18, 9, 8)}{line(4, 14, 6)}{line(18, 14, 6)}{objRect(9, 8, 10, 8)}{line(2, 20, 24)}</>;
      break;
    case 'topbottom':
      content = <>{line(2, 4, 24)}{objRect(2, 9, 24, 7)}{line(2, 20, 24)}</>;
      break;
    case 'behind':
      content = <>{objRect(9, 4, 10, 16, 0.35)}{line(2, 6, 24)}{line(2, 11, 24)}{line(2, 16, 24)}</>;
      break;
    case 'infront':
    default:
      content = <>{line(2, 6, 24)}{line(2, 11, 24)}{line(2, 16, 24)}{objRect(9, 4, 10, 16)}</>;
      break;
  }
  return (
    <svg viewBox="0 0 28 24" width={28} height={22} aria-hidden>
      {content}
    </svg>
  );
}

function WrapInspector({ element, onUpdate }: SubInspectorProps) {
  const current = normalizeWrapMode(element.wrapMode);
  return (
    <div className="inspector-form">
      <span
        className="inspector-section-label"
        title="Cómo se acomoda el texto de los bloques que se cruzan con este objeto — igual que 'Opciones de diseño' en Word"
      >
        Ajuste de texto
      </span>
      <div className="wrap-mode-grid">
        {WRAP_MODE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`wrap-mode-btn${current === o.value ? ' wrap-mode-btn--active' : ''}`}
            title={`${o.label} — ${o.hint}`}
            onClick={() => onUpdate({ wrapMode: o.value })}
          >
            <WrapModeIcon mode={o.value} />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.35 }}>
        {WRAP_MODE_OPTIONS.find((o) => o.value === current)?.hint}.
      </p>
    </div>
  );
}

interface RightInspectorProps {
  onRequestImageReplace?: (pageNumber: number, elementId: string, tab?: string) => void;
}

/* ───────── MAIN COMPONENT ───────── */
export default function RightInspector({ onRequestImageReplace }: RightInspectorProps) {
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const page = useEditorStore((s) => s.doc.pages.find((p) => p.page_number === selectedPage));
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);

  const selected = useMemo(
    () => page?.elements.find((element) => element.id === selectedElementId),
    [page, selectedElementId],
  );

  // Callback ESTABLE para los inspectores: junto con React.memo evita
  // re-renders de los sub-inspectores cuando el panel se re-renderiza por
  // hover/pin (no por cambio del bloque seleccionado).
  const handleUpdate = useCallback(
    (patch: Partial<ReportElement>) => {
      if (selected) updateElement(selectedPage, selected.id, patch);
    },
    [selectedPage, selected, updateElement],
  );

  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  // Al seleccionar un bloque en el lienzo, el panel se expande automáticamente
  // para mostrar sus propiedades (además de hover/pin). Es el comportamiento
  // esperado: seleccionar objeto ⇒ ver y editar sus parámetros de inmediato.
  const isExpanded = isHovered || isPinned || Boolean(selected);

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
              onUpdate={handleUpdate}
            />
          )}
          {selected.type === 'kpi' && (
            <KpiInspector
              element={selected}
              onUpdate={handleUpdate}
            />
          )}
          {selected.type === 'chart' && (
            <ChartInspector
              element={selected}
              onUpdate={handleUpdate}
            />
          )}
          {selected.type === 'text' && (
            <TextInspector
              element={selected}
              onUpdate={handleUpdate}
            />
          )}
          {selected.type === 'map' && (
            <MapInspector
              element={selected}
              onUpdate={handleUpdate}
            />
          )}
          {selected.type === 'header' && <HeaderInspector />}
          {selected.type === 'footer' && <FooterInspector />}
          {selected.type === 'cover' && (
            <CoverInspector element={selected} onUpdate={handleUpdate} />
          )}

          {selected.type === 'sensor' && (
            <div style={{ marginTop: 0 }}>
              <SensorInspector
                element={selected}
                onUpdate={handleUpdate}
              />
            </div>
          )}

          {selected.type === 'image' && (
            <div style={{ marginTop: 0 }}>
              <ImageInspector
                element={selected}
                onUpdate={handleUpdate}
                onOpenCaptureModal={(tab) => onRequestImageReplace?.(selectedPage, selected.id, tab)}
              />
            </div>
          )}

          {/* ADR-046: encabezado/pie de página son elementos fijos de
             plataforma — sin borde configurable, geometría, bloqueo/desbloqueo
             ni botón de eliminar (contradiría "no editable, no movible, no
             borrable" si el usuario pudiera desbloquearlos desde aquí).
             ADR-048: la carátula ahora ocupa siempre toda la hoja — exponer
             X/Y/Ancho/Alto permitiría romper ese requisito por accidente. */}
          {selected.type !== 'header' && selected.type !== 'footer' && selected.type !== 'cover' && (
            <>
              {/* Ajuste de texto PRIMERO — pedido explícito: quedaba "muy
                 oculto" varias secciones más abajo en el panel. */}
              {['image', 'chart', 'table', 'kpi', 'sensor', 'map'].includes(selected.type) && (
                <div
                  className="inspector-form"
                  style={{ marginTop: ['table', 'kpi', 'sensor', 'image', 'chart', 'map'].includes(selected.type) ? 18 : 0 }}
                >
                  <WrapInspector element={selected} onUpdate={handleUpdate} />
                </div>
              )}

              <div
                className="inspector-form"
                style={{ marginTop: 18 }}
              >
                <BorderInspector element={selected} onUpdate={handleUpdate} />
              </div>

              <div className="inspector-form" style={{ marginTop: 18 }}>
                <span className="inspector-section-label" title="Posición, tamaño y bloqueo del bloque dentro de la página">Geometría y Bloqueo</span>
                <div className="inspector-grid-2" style={{ marginTop: 8 }}>
                   <div className="input-group" title="Distancia horizontal (px) desde el borde izquierdo de la página al bloque">
                      <label>Posición X</label>
                      <input className="input-premium" type="number" value={Math.round(selected.x)} onChange={(e) => updateElement(selectedPage, selected.id, { x: Number(e.target.value) })} />
                   </div>
                   <div className="input-group" title="Distancia vertical (px) desde el borde superior de la página al bloque">
                      <label>Posición Y</label>
                      <input className="input-premium" type="number" value={Math.round(selected.y)} onChange={(e) => updateElement(selectedPage, selected.id, { y: Number(e.target.value) })} />
                   </div>
                </div>
                <div className="inspector-grid-2">
                   <div className="input-group" title="Ancho del bloque en píxeles (mínimo 20)">
                      <label>Ancho</label>
                      <input className="input-premium" type="number" value={Math.round(selected.width)} onChange={(e) => updateElement(selectedPage, selected.id, { width: Math.max(20, Number(e.target.value)) })} />
                   </div>
                   <div className="input-group" title="Alto del bloque en píxeles (mínimo 20)">
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
            </>
          )}
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
