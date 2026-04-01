import React from 'react';

export default function TableBlock({ 
  rows = [], 
  hasHeader = true, 
  borderColor = '#e2e8f0', 
  headerBg = '#f8fafc', 
  cellPadding = 10,
  fontSize = 14,
  onUpdateCells
}) {
  const handleCellChange = (rowIndex, colIndex, value) => {
    const newRows = rows.map((r, ri) => 
      ri === rowIndex ? r.map((c, ci) => ci === colIndex ? value : c) : r
    );
    if (onUpdateCells) {
      onUpdateCells(newRows);
    }
  };

  return (
    <div 
      className="table-block-container"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: '#fff',
        borderRadius: '4px',
        border: `1px solid ${borderColor}`,
        pointerEvents: 'none',
      }}
    >
      <table 
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: `${fontSize}px`,
          fontFamily: "'Inter', sans-serif"
        }}
      >
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const isHeader = hasHeader && ri === 0;
                return (
                  <td
                    key={ci}
                    style={{
                      padding: `${cellPadding}px`,
                      border: `1px solid ${borderColor}`,
                      backgroundColor: isHeader ? headerBg : 'transparent',
                      fontWeight: isHeader ? '700' : '400',
                      color: isHeader ? '#1e293b' : '#334155'
                    }}
                  >
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => handleCellChange(ri, ci, e.target.innerText)}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
