import React, { useMemo } from 'react';
import { useEditorStore } from '../../store/useEditorStore';

import { 
  Lock, 
  Unlock, 
  Trash2, 
  Settings2,
  Palette,
  Grid3X3
} from 'lucide-react';

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

/* ───────── MAIN COMPONENT ───────── */
export default function RightInspector() {
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const page = useEditorStore((s) => s.doc.pages.find((p) => p.page_number === selectedPage));
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);

  const selected = useMemo(
    () => page?.elements.find((element) => element.id === selectedElementId),
    [page, selectedElementId],
  );

  return (
    <aside className="panel right">
      <h3 className="panel-title">
        <Settings2 size={17} color="#6366f1" />
        Propiedades
      </h3>

      {/* ── ELEMENT INSPECTOR ── */}
      {selected && (
        <div style={{ marginTop: 4 }}>
          {selected.type === 'table' && (
            <TableInspector 
              element={selected} 
              onUpdate={(patch) => updateElement(selectedPage, selected.id, patch)} 
            />
          )}

          <div className="inspector-form" style={{ marginTop: selected.type === 'table' ? 24 : 0 }}>
            <span className="inspector-section-label">Geometría y Bloqueo</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
               <div className="input-group">
                  <label>Posición X</label>
                  <input className="input-premium" type="number" value={Math.round(selected.x)} onChange={(e) => updateElement(selectedPage, selected.id, { x: Number(e.target.value) })} />
               </div>
               <div className="input-group">
                  <label>Posición Y</label>
                  <input className="input-premium" type="number" value={Math.round(selected.y)} onChange={(e) => updateElement(selectedPage, selected.id, { y: Number(e.target.value) })} />
               </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              >
                {selected.locked ? <Unlock size={14} /> : <Lock size={14} />}
                {selected.locked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button
                className="btn-premium-outline"
                style={{ flex: 1, color: '#dc2626', borderColor: '#fca5a5', background: '#fff5f5' }}
                onClick={() => removeElement(selectedPage, selected.id)}
              >
                <Trash2 size={14} /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {!selected && (
        <div style={{ marginTop: 40, textAlign: 'center', opacity: 0.4 }}>
           <Settings2 size={44} color="#94a3b8" style={{ marginBottom: 14 }} />
           <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', margin: 0 }}>
             Selecciona un bloque en el lienzo para editar sus propiedades
           </p>
        </div>
      )}
    </aside>
  );
}
