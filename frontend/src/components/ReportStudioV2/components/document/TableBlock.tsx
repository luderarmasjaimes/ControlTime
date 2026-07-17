import React, { memo, useRef, useState, useCallback, useEffect } from 'react';
import { REPORT_COLOR_SWATCHES } from '../shared/ColorPalette';

interface TableBlockProps {
  title?: string;
  rows?: string[][];
  hasHeader?: boolean;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  headerBg?: string;
  headerTextColor?: string;
  headerBold?: boolean;
  cellPadding?: number;
  fontSize?: number;
  cellAlign?: 'left' | 'center' | 'right';
  bandedRows?: boolean;
  bandColor?: string;
  onUpdateCells?: (newRows: string[][]) => void;
}

/**
 * Celda editable con contenido gestionado IMPERATIVAMENTE (via ref), no como
 * prop controlada de React. Motivo: un contentEditable cuyo innerHTML se
 * re-aplica desde props en cada render pierde la posición del cursor y
 * colapsa la selección al escribir/formatear (bug clásico de contentEditable
 * en React). Aquí el DOM es la fuente de verdad mientras se edita; el valor
 * externo solo se siembra al montar y se lee hacia afuera en input/blur.
 */
const TableCell = memo(function TableCell({
  value,
  onChange,
  onFocusCell,
  style,
}: {
  value: string;
  onChange: (html: string) => void;
  onFocusCell: (el: HTMLElement) => void;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sembrar el contenido inicial una sola vez (y re-sembrar solo si el valor
  // externo cambió Y la celda NO tiene el foco — p.ej. al cargar otro informe).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.innerHTML !== value) el.innerHTML = value ?? '';
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="table-cell-editable"
      onFocus={(e) => onFocusCell(e.currentTarget)}
      onMouseUp={(e) => onFocusCell(e.currentTarget)}
      onKeyUp={(e) => onFocusCell(e.currentTarget)}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      onBlur={(e) => onChange(e.currentTarget.innerHTML)}
      style={style}
    />
  );
});

function TableBlock({
  title = '',
  rows = [],
  hasHeader = true,
  borderColor = '#e2e8f0',
  borderWidth = 1,
  borderStyle = 'solid',
  headerBg = '#f8fafc',
  headerTextColor = '#1e293b',
  headerBold = true,
  cellPadding = 10,
  fontSize = 14,
  cellAlign = 'left',
  bandedRows = false,
  bandColor = '#f1f5f9',
  onUpdateCells,
}: TableBlockProps) {
  // Barra flotante de formato por selección dentro de la celda enfocada —
  // usa document.execCommand sobre el contentEditable (enfoque estándar y
  // fiable para texto enriquecido en celdas, equivalente al de ONLYOffice).
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedCellRef = useRef<HTMLElement | null>(null);
  const focusedPosRef = useRef<{ ri: number; ci: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Copia mutable de las filas para persistir cambios de celda sin recalcular
  // desde props (que pueden ir un tick por detrás durante la edición).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const persistCell = useCallback((ri: number, ci: number, html: string) => {
    const cur = rowsRef.current;
    if (cur[ri]?.[ci] === html) return;
    const newRows = cur.map((r, rIdx) => (rIdx === ri ? r.map((c, cIdx) => (cIdx === ci ? html : c)) : r));
    onUpdateCells?.(newRows);
  }, [onUpdateCells]);

  const positionToolbar = useCallback((ri: number, ci: number, cellEl: HTMLElement) => {
    focusedCellRef.current = cellEl;
    focusedPosRef.current = { ri, ci };
    const cont = containerRef.current;
    if (!cont) return;
    const cRect = cont.getBoundingClientRect();
    const eRect = cellEl.getBoundingClientRect();
    setToolbar({
      top: Math.max(0, eRect.top - cRect.top - 34),
      left: Math.max(0, eRect.left - cRect.left),
    });
  }, []);

  const exec = (command: string, value?: string) => {
    const cell = focusedCellRef.current;
    const pos = focusedPosRef.current;
    if (!cell || !pos) return;
    cell.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
      savedRangeRef.current = null;
    }
    document.execCommand(command, false, value);
    persistCell(pos.ri, pos.ci, cell.innerHTML);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  // Cerrar la barra al perder el foco fuera de la tabla.
  useEffect(() => {
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!containerRef.current?.contains(document.activeElement)) {
          setToolbar(null);
          setColorOpen(false);
        }
      }, 150);
    };
    const cont = containerRef.current;
    cont?.addEventListener('focusout', onFocusOut);
    return () => cont?.removeEventListener('focusout', onFocusOut);
  }, []);

  const border = borderStyle === 'none' ? 'none' : `${borderWidth}px ${borderStyle} ${borderColor}`;

  return (
    <div
      ref={containerRef}
      className="table-block-container"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: '#fff',
        borderRadius: '4px',
        border: borderStyle === 'none' ? '1px solid #e2e8f0' : border,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {toolbar && (
        <div
          className="table-cell-format-toolbar"
          style={{ position: 'absolute', top: toolbar.top, left: toolbar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" title="Negrita" onClick={() => exec('bold')}><b>N</b></button>
          <button type="button" title="Cursiva" onClick={() => exec('italic')}><i>K</i></button>
          <button type="button" title="Subrayado" onClick={() => exec('underline')}><u>S</u></button>
          <button type="button" title="Reducir tamaño" onClick={() => exec('fontSize', '2')}>A-</button>
          <button type="button" title="Aumentar tamaño" onClick={() => exec('fontSize', '5')}>A+</button>
          <div className="table-cell-color-wrap">
            <button
              type="button"
              title="Color del texto"
              className="table-cell-color-btn"
              onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
              onClick={() => setColorOpen((v) => !v)}
            >
              A<span className="table-cell-color-bar" style={{ background: '#dc2626' }} />
            </button>
            {colorOpen && (
              <div className="table-cell-color-pop" onMouseDown={(e) => e.preventDefault()}>
                {REPORT_COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    style={{ background: c, border: c.toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : undefined }}
                    title={c}
                    onClick={() => { exec('foreColor', c); setColorOpen(false); }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {title && (
        <div
          style={{
            padding: `${Math.max(6, cellPadding - 2)}px ${cellPadding}px`,
            fontSize: `${fontSize + 1}px`,
            fontWeight: 700,
            color: '#0f172a',
            borderBottom: border,
            background: '#fbfdff',
            flexShrink: 0,
          }}
        >
          {title}
        </div>
      )}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: `${fontSize}px`,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <tbody>
          {rows.map((row, ri) => {
            const isHeader = hasHeader && ri === 0;
            const isBanded = !isHeader && bandedRows && (hasHeader ? ri % 2 === 0 : ri % 2 === 1);
            return (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: `${cellPadding}px`,
                      border,
                      textAlign: cellAlign,
                      backgroundColor: isHeader ? headerBg : isBanded ? bandColor : 'transparent',
                      fontWeight: isHeader ? (headerBold ? 700 : 400) : 400,
                      color: isHeader ? headerTextColor : '#334155',
                    }}
                  >
                    <TableCell
                      value={cell}
                      onChange={(html) => persistCell(ri, ci, html)}
                      onFocusCell={(el) => positionToolbar(ri, ci, el)}
                      style={{ outline: 'none', minHeight: '1.2em', pointerEvents: 'auto' }}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tableBlockPropsAreEqual(prev: TableBlockProps, next: TableBlockProps): boolean {
  return (
    prev.title === next.title &&
    prev.rows === next.rows &&
    prev.hasHeader === next.hasHeader &&
    prev.borderColor === next.borderColor &&
    prev.borderWidth === next.borderWidth &&
    prev.borderStyle === next.borderStyle &&
    prev.headerBg === next.headerBg &&
    prev.headerTextColor === next.headerTextColor &&
    prev.headerBold === next.headerBold &&
    prev.cellPadding === next.cellPadding &&
    prev.fontSize === next.fontSize &&
    prev.cellAlign === next.cellAlign &&
    prev.bandedRows === next.bandedRows &&
    prev.bandColor === next.bandColor
  );
}

export default memo(TableBlock, tableBlockPropsAreEqual);
