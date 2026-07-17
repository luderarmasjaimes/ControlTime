import React, { memo } from 'react';

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
  onUpdateCells
}: TableBlockProps) {
  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const newRows = rows.map((r, ri) =>
      ri === rowIndex ? r.map((c, ci) => ci === colIndex ? value : c) : r
    );
    if (onUpdateCells) {
      onUpdateCells(newRows);
    }
  };

  const border = borderStyle === 'none' ? 'none' : `${borderWidth}px ${borderStyle} ${borderColor}`;

  return (
    <div
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
      }}
    >
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
          fontFamily: "'Inter', sans-serif"
        }}
      >
        <tbody>
          {rows.map((row, ri) => {
            const isHeader = hasHeader && ri === 0;
            const isBanded = !isHeader && bandedRows && (hasHeader ? ri % 2 === 0 : ri % 2 === 1);
            return (
            <tr key={ri}>
              {row.map((cell, ci) => {
                return (
                  <td
                    key={ci}
                    style={{
                      padding: `${cellPadding}px`,
                      border,
                      textAlign: cellAlign,
                      backgroundColor: isHeader ? headerBg : isBanded ? bandColor : 'transparent',
                      fontWeight: isHeader ? (headerBold ? 700 : 400) : 400,
                      color: isHeader ? headerTextColor : '#334155'
                    }}
                  >
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => handleCellChange(ri, ci, e.currentTarget.innerText)}
                      style={{
                        outline: 'none',
                        minHeight: '1.2em',
                        pointerEvents: 'auto',
                      }}
                    >
                      {cell}
                    </div>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// onUpdateCells se recrea en cada render de PageCanvas.tsx (arrow inline en
// el .map() de elementos tipo 'table') aunque ESTA tabla no haya cambiado —
// comparador propio que ignora esa prop y compara solo los datos reales.
// Correcto: si rows/demás no cambiaron, element.props (de donde vienen) es
// la misma referencia (useEditorStore::updateElement preserva elementos
// hermanos sin editar), así que la clausura "vieja" de onUpdateCells sigue
// siendo equivalente a una nueva.
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
