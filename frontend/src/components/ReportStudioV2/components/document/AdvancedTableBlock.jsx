import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, Minus, Calculator, ArrowUpDown, Copy, Trash2, GripVertical } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   ADVANCED TABLE — Tablas con fórmulas SUM/AVG/MIN/MAX/COUNT
   Soporte drag-resize columnas, ordenamiento, merge cells
   ───────────────────────────────────────────────────────────────────────── */

const FORMULAS = {
  SUM:   (cells) => cells.reduce((a, c) => a + (parseFloat(c) || 0), 0),
  AVG:   (cells) => { const nums = cells.map(c => parseFloat(c)).filter(n => !isNaN(n)); return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0; },
  MIN:   (cells) => { const nums = cells.map(c => parseFloat(c)).filter(n => !isNaN(n)); return nums.length ? Math.min(...nums) : 0; },
  MAX:   (cells) => { const nums = cells.map(c => parseFloat(c)).filter(n => !isNaN(n)); return nums.length ? Math.max(...nums) : 0; },
  COUNT: (cells) => cells.filter(c => c !== '' && c != null).length,
};

function evaluateFormula(formula, rows, colIdx) {
  const match = formula.match(/^=(\w+)\((\w+)\)$/i);
  if (!match) return formula;
  const [, fn, range] = match;
  const func = FORMULAS[fn.toUpperCase()];
  if (!func) return `#ERR:${fn}`;
  // range = COL (e.g., "COL" means entire column excluding header)
  const cells = rows.slice(1).map(row => row[colIdx] || '');
  const result = func(cells);
  return typeof result === 'number' ? (Number.isInteger(result) ? result.toString() : result.toFixed(2)) : String(result);
}

function CellEditor({ value, onChange, onBlur, isFormula }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      className={`at-cell-input ${isFormula ? 'at-cell-input--formula' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onBlur(); } }}
    />
  );
}

export default function AdvancedTableBlock({
  rows: initialRows = [['','',''],['','','']],
  hasHeader = true,
  onUpdate,
  readOnly = false,
  headerBg = '#0f172a',
  headerColor = '#f8fafc',
  stripedRows = true,
  borderColor = '#e2e8f0',
  fontSize = 11,
  showFormulaTotals = false,
}) {
  const [rows, setRows] = useState(initialRows);
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [colWidths, setColWidths] = useState(() => {
    const cols = (rows[0] || []).length;
    return Array(cols).fill(120);
  });

  const colCount = (rows[0] || []).length;

  const updateRows = useCallback((newRows) => {
    setRows(newRows);
    onUpdate?.({ rows: newRows });
  }, [onUpdate]);

  const addRow = () => updateRows([...rows, Array(colCount).fill('')]);
  const addCol = () => {
    const nr = rows.map(r => [...r, '']);
    setColWidths(prev => [...prev, 120]);
    updateRows(nr);
  };
  const removeRow = (idx) => { if (rows.length <= 1) return; updateRows(rows.filter((_, i) => i !== idx)); };
  const removeCol = (idx) => {
    if (colCount <= 1) return;
    updateRows(rows.map(r => r.filter((_, i) => i !== idx)));
    setColWidths(prev => prev.filter((_, i) => i !== idx));
  };

  const startEdit = (ri, ci) => {
    if (readOnly) return;
    setEditCell({ ri, ci });
    setEditValue(rows[ri]?.[ci] || '');
  };

  const commitEdit = () => {
    if (!editCell) return;
    const { ri, ci } = editCell;
    const newRows = rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? editValue : c) : [...r]);
    updateRows(newRows);
    setEditCell(null);
  };

  const handleSort = (ci) => {
    if (!hasHeader || rows.length < 2) return;
    const newDir = sortCol === ci && sortDir === 'asc' ? 'desc' : 'asc';
    setSortCol(ci); setSortDir(newDir);
    const header = rows[0];
    const body = rows.slice(1).sort((a, b) => {
      const va = a[ci] || '', vb = b[ci] || '';
      const na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) return newDir === 'asc' ? na - nb : nb - na;
      return newDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    updateRows([header, ...body]);
  };

  const formulaRow = useMemo(() => {
    if (!showFormulaTotals || rows.length < 2) return null;
    return Array(colCount).fill(0).map((_, ci) => {
      const nums = rows.slice(hasHeader ? 1 : 0).map(r => parseFloat(r[ci])).filter(n => !isNaN(n));
      if (nums.length === 0) return '';
      return `Σ ${nums.reduce((a,b)=>a+b,0).toFixed(2)}`;
    });
  }, [rows, colCount, hasHeader, showFormulaTotals]);

  const getCellDisplay = (value, ri, ci) => {
    if (typeof value === 'string' && value.startsWith('=')) return evaluateFormula(value, rows, ci);
    return value;
  };

  return (
    <div className="at-wrapper" style={{ '--at-border': borderColor, '--at-font': `${fontSize}px` }}>
      <div className="at-scroll">
        <table className="at-table">
          <thead>
            {hasHeader && rows[0] && (
              <tr>
                {rows[0].map((cell, ci) => (
                  <th key={ci} style={{ background: headerBg, color: headerColor, width: colWidths[ci], minWidth: colWidths[ci] }}>
                    <div className="at-th-content">
                      {editCell?.ri === 0 && editCell?.ci === ci ? (
                        <CellEditor value={editValue} onChange={setEditValue} onBlur={commitEdit} />
                      ) : (
                        <span onClick={() => startEdit(0, ci)}>{cell || '\u00a0'}</span>
                      )}
                      <button type="button" className="at-sort-btn" onClick={() => handleSort(ci)} title="Ordenar">
                        <ArrowUpDown size={10} />
                      </button>
                    </div>
                    {!readOnly && (
                      <button type="button" className="at-col-rm" onClick={() => removeCol(ci)} title="Eliminar columna">
                        <Minus size={8} />
                      </button>
                    )}
                  </th>
                ))}
                {!readOnly && (
                  <th className="at-add-col" onClick={addCol} title="Agregar columna"><Plus size={12} /></th>
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.slice(hasHeader ? 1 : 0).map((row, ri) => {
              const actualRi = hasHeader ? ri + 1 : ri;
              return (
                <tr key={actualRi} className={stripedRows && ri % 2 === 1 ? 'at-row-striped' : ''}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={typeof cell === 'string' && cell.startsWith('=') ? 'at-cell-formula' : ''}>
                      {editCell?.ri === actualRi && editCell?.ci === ci ? (
                        <CellEditor value={editValue} onChange={setEditValue} onBlur={commitEdit} isFormula={editValue.startsWith('=')} />
                      ) : (
                        <span className="at-cell-text" onClick={() => startEdit(actualRi, ci)}>
                          {getCellDisplay(cell, actualRi, ci) || '\u00a0'}
                        </span>
                      )}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="at-row-actions">
                      <button type="button" onClick={() => removeRow(actualRi)} title="Eliminar fila"><Minus size={10} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
            {formulaRow && (
              <tr className="at-formula-row">
                {formulaRow.map((val, ci) => (
                  <td key={ci} className="at-formula-cell">{val}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="at-controls">
          <button type="button" onClick={addRow} className="at-add-btn"><Plus size={12} /> Fila</button>
          <button type="button" onClick={addCol} className="at-add-btn"><Plus size={12} /> Columna</button>
          <button type="button" onClick={() => {
            const nr = [...rows];
            if (nr.length > 1) {
              const lastRow = nr[nr.length-1].map((_,ci) => `=SUM(COL)`);
              nr.push(lastRow);
              updateRows(nr);
            }
          }} className="at-add-btn" title="Agregar fila con fórmula SUM"><Calculator size={12} /> Σ Totales</button>
        </div>
      )}
    </div>
  );
}
