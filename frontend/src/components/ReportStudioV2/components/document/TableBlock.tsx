import React, { memo, useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { Plus, Minus, WandSparkles, X } from 'lucide-react';
import { REPORT_COLOR_SWATCHES } from '../shared/ColorPalette';
import { sanitizeRichHtml } from '../../lib/sanitizeHtml';
import { semanticStatusStyle } from '../../lib/semanticStatus';

const MIN_COL_WIDTH = 48;
const MIN_ROW_HEIGHT = 32;
const RESIZE_HANDLE_WIDTH = 8;

interface TableBlockProps {
  title?: string;
  rows?: string[][];
  colWidths?: number[];
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
  onUpdateColWidths?: (widths: number[]) => void;
  onAddRow?: () => void;
  onRemoveRow?: (rowIndex: number) => void;
  onAddColumn?: () => void;
  onRemoveColumn?: (colIndex: number) => void;
  /** Ancho disponible real (px) del contenedor -- usado para repartir columnas
   * quc no traen `colWidths` todavía (tablas creadas antes de este fix). */
  containerWidth?: number;
  /** true si el bloque está seleccionado en el lienzo -- la barra de
   * herramientas de fila/columna y los tiradores de resize SOLO se muestran
   * seleccionado (evita ruido visual sobre una tabla no activa). */
  selected?: boolean;
  /** true si el bloque está en modo "doble clic para editar celdas" (ver
   * canvasTableEditId, PageCanvas.tsx). Cuando es true se muestra un botón
   * explícito para salir — vía de escape garantizada además de Escape/clic
   * afuera, por si ese modo queda "pegado" (bug reportado por QA). */
  editing?: boolean;
  onExitEdit?: () => void;
  /** Reporta el tamaño NATURAL (contenido real) de la tabla — el llamador
   * (PageCanvas.tsx) lo usa para crecer el bloque automáticamente (nunca lo
   * encoge solo; encoger es manual, vía resize de columnas). */
  onNaturalSize?: (width: number, height: number) => void;
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
    // XSS almacenado (auditoría 2026-07-19): la celda es contentEditable y
    // su HTML se guarda crudo; sanear SIEMPRE antes de sembrarlo por
    // innerHTML defiende contra contenido ya envenenado por otro editor del
    // informe. Ver lib/sanitizeHtml.ts.
    const safe = sanitizeRichHtml(value ?? '');
    if (el.innerHTML !== safe) el.innerHTML = safe;
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
      onInput={(e) => onChange(sanitizeRichHtml(e.currentTarget.innerHTML))}
      onBlur={(e) => onChange(sanitizeRichHtml(e.currentTarget.innerHTML))}
      style={style}
    />
  );
});

/** Reparte `containerWidth` en `colCount` columnas iguales (piso MIN_COL_WIDTH),
 * usado cuando `colWidths` no existe todavía o su longitud no calza con las
 * columnas reales (tabla vieja, o recién agregada/quitada una columna). */
function normalizeColWidths(colWidths: number[] | undefined, colCount: number, containerWidth: number): number[] {
  if (Array.isArray(colWidths) && colWidths.length === colCount && colWidths.every((w) => Number.isFinite(w) && w > 0)) {
    return colWidths;
  }
  const even = Math.max(MIN_COL_WIDTH, Math.floor((containerWidth || colCount * 120) / Math.max(1, colCount)));
  return Array.from({ length: colCount }, () => even);
}

function TableBlock({
  title = '',
  rows = [],
  colWidths,
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
  onUpdateColWidths,
  onAddRow,
  onRemoveRow,
  onAddColumn,
  onRemoveColumn,
  containerWidth = 480,
  selected = false,
  editing = false,
  onExitEdit,
  onNaturalSize,
}: TableBlockProps) {
  // Barra flotante de formato por selección dentro de la celda enfocada —
  // usa document.execCommand sobre el contentEditable (enfoque estándar y
  // fiable para texto enriquecido en celdas, equivalente al de ONLYOffice).
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const focusedCellRef = useRef<HTMLElement | null>(null);
  const focusedPosRef = useRef<{ ri: number; ci: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Copia mutable de las filas para persistir cambios de celda sin recalcular
  // desde props (que pueden ir un tick por detrás durante la edición).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const colCount = rows[0]?.length || 0;
  const widths = normalizeColWidths(colWidths, colCount, containerWidth);
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  // Persistir el reparto parejo la PRIMERA vez que hace falta (tabla nueva,
  // o tras agregar/quitar una columna) — sin esto, `widths` se recalculaba
  // en CADA render a partir de `containerWidth`, que a su vez el bloque
  // auto-crecía a partir del ancho medido de la tabla (natural width). Esa
  // realimentación (ancho del contenedor → columnas parejas → ancho medido →
  // crece el contenedor → ...) hacía que la tabla creciera sin parar hasta
  // topar con el borde de la página. Con `colWidths` fijo en props desde el
  // primer render que hizo falta, el ancho de columnas deja de depender del
  // tamaño del contenedor y el ciclo se rompe.
  const didPersistDefaultWidthsRef = useRef(false);
  useEffect(() => {
    const needsPersist = !Array.isArray(colWidths) || colWidths.length !== colCount;
    if (needsPersist && !didPersistDefaultWidthsRef.current) {
      didPersistDefaultWidthsRef.current = true;
      onUpdateColWidths?.(widths);
    } else if (!needsPersist) {
      didPersistDefaultWidthsRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colCount, Array.isArray(colWidths) ? colWidths.length : 0]);

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
    persistCell(pos.ri, pos.ci, sanitizeRichHtml(cell.innerHTML));
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

  // ── Auto-crecimiento del bloque al contenido real ───────────────────────
  // Reporta el tamaño NATURAL de la tabla (ancho = suma de columnas, alto =
  // altura real renderizada, que crece solo con texto multilínea porque las
  // celdas son simples <div> de flujo normal) — PageCanvas.tsx usa esto para
  // agrandar element.width/height. Nunca los encoge automáticamente (eso
  // rompería un resize manual que el usuario acaba de hacer); solo crece.
  const lastReportedRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = tableWrapRef.current;
    if (!el || !onNaturalSize) return undefined;
    const report = () => {
      const naturalH = el.scrollHeight;
      // El ancho NUNCA se mide del DOM (el.scrollWidth) -- eso realimentaba
      // el ancho del bloque de vuelta hacia sí mismo (ver comentario sobre
      // `didPersistDefaultWidthsRef` más arriba: containerWidth → colWidths
      // → ancho medido → crece containerWidth → ...). El ancho real de la
      // tabla es, por definición, la suma de `colWidths` (persistidos) —
      // una cantidad que el usuario controla explícitamente (resize/autofit/
      // agregar columna), nunca algo a "redescubrir" midiendo el DOM.
      const naturalW = totalWidth;
      const last = lastReportedRef.current;
      // Épsilon de 2px para no entrar en un loop de reportes por
      // redondeos de subpíxel entre renders.
      if (Math.abs(naturalH - last.h) > 2 || Math.abs(naturalW - last.w) > 2) {
        lastReportedRef.current = { w: naturalW, h: naturalH };
        onNaturalSize(naturalW, naturalH);
      }
    };
    report();
    const ro = new ResizeObserver(() => report());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, totalWidth, cellPadding, fontSize, title]);

  // ── Resize manual de columnas (arrastrar el borde entre dos columnas) ───
  // Igual que Word/Excel: arrastrar un borde INTERIOR redistribuye ancho
  // entre las 2 columnas vecinas (el ancho total de la tabla no cambia).
  // Arrastrar el borde DESPUÉS de la última columna sí cambia el ancho total
  // (única forma de agrandar/achicar la tabla a mano, además de agregar
  // filas/columnas).
  const dragStateRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const [dragWidths, setDragWidths] = useState<number[] | null>(null);

  const beginColumnResize = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = { index, startX: event.clientX, startWidths: [...widths] };
    setDragWidths([...widths]);

    const onMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const next = [...drag.startWidths];
      const isLast = drag.index === next.length - 1;
      if (isLast) {
        next[drag.index] = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index] + delta);
      } else {
        const left = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index] + delta);
        const rightDelta = drag.startWidths[drag.index] - left;
        const right = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index + 1] + rightDelta);
        // Si el vecino derecho tocó su mínimo, no seguir robándole ancho.
        next[drag.index] = drag.startWidths[drag.index] + drag.startWidths[drag.index + 1] - right;
        next[drag.index + 1] = right;
      }
      setDragWidths(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragWidths((cur) => {
        if (cur) onUpdateColWidths?.(cur);
        return null;
      });
      dragStateRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [widths, onUpdateColWidths]);

  const effectiveWidths = dragWidths || widths;

  // ── Autoajuste: mide el ancho natural del texto de cada columna (con un
  // <canvas> oculto, mismo criterio que un medidor de texto de un editor de
  // hojas de cálculo) y redistribuye colWidths a esa medida + padding. ──
  const autoFitColumns = useCallback(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${fontSize}px 'Inter', sans-serif`;
    const measured = Array.from({ length: colCount }, (_, ci) => {
      let maxW = MIN_COL_WIDTH;
      rows.forEach((row) => {
        const text = String(row[ci] ?? '').replace(/<[^>]+>/g, '');
        const w = ctx.measureText(text).width + cellPadding * 2 + 4;
        if (w > maxW) maxW = w;
      });
      return Math.ceil(maxW);
    });
    onUpdateColWidths?.(measured);
  }, [rows, colCount, fontSize, cellPadding, onUpdateColWidths]);

  const border = borderStyle === 'none' ? 'none' : `${borderWidth}px ${borderStyle} ${borderColor}`;
  const showControls = selected;

  // Offsets acumulados (para posicionar tiradores de resize y botones de
  // eliminar columna exactamente en cada borde).
  const offsets: number[] = [];
  {
    let acc = 0;
    for (const w of effectiveWidths) {
      acc += w;
      offsets.push(acc);
    }
  }

  return (
    <div
      ref={containerRef}
      className="table-block-container"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'visible',
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
          style={{ position: 'absolute', top: toolbar.top, left: toolbar.left, pointerEvents: 'auto' }}
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

      {/* Barra de herramientas de fila/columna — SOLO visible con el bloque
         seleccionado (no depende del modo "doble clic para editar celdas",
         que es exclusivamente para escribir texto). Todos los controles
         llevan pointerEvents:'auto' propio, así funcionan aunque el shield
         general del bloque (PageCanvas.tsx, .report-canvas-html-shield)
         tenga pointer-events:none. */}
      {showControls && (
        <div
          className="table-toolbar-strip"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="table-toolbar-btn" onClick={() => onAddRow?.()} title="Insertar fila al final">
            <Plus size={13} /> Fila
          </button>
          <button
            type="button"
            className="table-toolbar-btn"
            onClick={() => rows.length > 1 && onRemoveRow?.(rows.length - 1)}
            title="Eliminar la última fila"
            disabled={rows.length <= 1}
          >
            <Minus size={13} /> Fila
          </button>
          <button type="button" className="table-toolbar-btn" onClick={() => onAddColumn?.()} title="Insertar columna al final">
            <Plus size={13} /> Col
          </button>
          <button
            type="button"
            className="table-toolbar-btn"
            onClick={() => colCount > 1 && onRemoveColumn?.(colCount - 1)}
            title="Eliminar la última columna"
            disabled={colCount <= 1}
          >
            <Minus size={13} /> Col
          </button>
          <button type="button" className="table-toolbar-btn table-toolbar-btn--accent" onClick={autoFitColumns} title="Autoajustar el ancho de columnas al texto más largo de cada una">
            <WandSparkles size={13} /> Autoajustar
          </button>
          {editing && (
            <button type="button" className="table-toolbar-btn" onClick={() => onExitEdit?.()} title="Salir del modo edición de celdas (equivalente a Escape)">
              <X size={13} /> Cerrar edición
            </button>
          )}
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

      <div style={{ position: 'relative', overflow: 'visible' }} ref={tableWrapRef}>
        <table
          style={{
            width: totalWidth,
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: `${fontSize}px`,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <colgroup>
            {effectiveWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = hasHeader && ri === 0;
              const isBanded = !isHeader && bandedRows && (hasHeader ? ri % 2 === 0 : ri % 2 === 1);
              return (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    // Coloreado semántico automático (semáforo): si la celda
                    // es exactamente un estado conocido (VERDE, NO CONFORME,
                    // CRÍTICA, ALTA…) se pinta con el tinte del documento.
                    const sem = semanticStatusStyle(cell, isHeader);
                    return (
                    <td
                      key={ci}
                      style={{
                        padding: `${cellPadding}px`,
                        border,
                        textAlign: cellAlign,
                        backgroundColor: isHeader ? headerBg : sem ? sem.bg : isBanded ? bandColor : 'transparent',
                        fontWeight: isHeader ? (headerBold ? 700 : 400) : sem ? 700 : 400,
                        color: isHeader ? headerTextColor : sem ? sem.color : '#334155',
                        verticalAlign: 'top',
                        wordBreak: 'break-word',
                        position: 'relative',
                        minHeight: MIN_ROW_HEIGHT,
                      }}
                    >
                      <TableCell
                        value={cell}
                        onChange={(html) => persistCell(ri, ci, html)}
                        onFocusCell={(el) => positionToolbar(ri, ci, el)}
                        style={{ outline: 'none', minHeight: '1.2em', pointerEvents: 'auto', whiteSpace: 'pre-wrap' }}
                      />
                      {/* Botón eliminar FILA — extremo izquierdo, solo primera celda de cada fila */}
                      {showControls && ci === 0 && rows.length > 1 && (
                        <button
                          type="button"
                          className="table-row-delete-btn"
                          title={`Eliminar fila ${ri + 1}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onRemoveRow?.(ri); }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tiradores de resize de columna — uno por cada borde, con
           pointerEvents:'auto' propio (funcionan seleccionado, sin
           necesidad del modo "doble clic" de edición de celdas). */}
        {showControls && offsets.map((left, i) => (
          <div
            key={`resize-${i}`}
            className="table-col-resize-handle"
            style={{ left: left - RESIZE_HANDLE_WIDTH / 2, width: RESIZE_HANDLE_WIDTH }}
            title={i === offsets.length - 1 ? 'Arrastrar para cambiar el ancho total de la tabla' : 'Arrastrar para redistribuir el ancho entre columnas'}
            onMouseDown={(e) => beginColumnResize(i, e)}
          />
        ))}

        {/* Botones eliminar COLUMNA — sobre la fila de cabecera, uno por columna */}
        {showControls && colCount > 1 && offsets.map((rightEdge, i) => (
          <button
            key={`colremove-${i}`}
            type="button"
            className="table-col-delete-btn"
            style={{ left: rightEdge - 16 }}
            title={`Eliminar columna ${i + 1}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemoveColumn?.(i); }}
          >
            <X size={9} />
          </button>
        ))}
      </div>
    </div>
  );
}

function tableBlockPropsAreEqual(prev: TableBlockProps, next: TableBlockProps): boolean {
  return (
    prev.title === next.title &&
    prev.rows === next.rows &&
    prev.colWidths === next.colWidths &&
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
    prev.bandColor === next.bandColor &&
    prev.containerWidth === next.containerWidth &&
    prev.selected === next.selected
  );
}

export default memo(TableBlock, tableBlockPropsAreEqual);
