import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { CHART_OPTIONS } from '../layout/RibbonToolbar';
import { detectNumericColumns } from '../../lib/chartFromTable';
import { stripCellHtml } from '../../lib/tableFormulas';

interface CreateChartFromTableModalProps {
  rows: string[][];
  hasHeader: boolean;
  onCreate: (config: { chartKind: string; categoryColumn: number; seriesColumns: number[] }) => void;
  onClose: () => void;
}

/** Modal de "crear gráfico a partir de esta tabla" -- pedido explícito
 * 2026-09-11: clic derecho sobre una tabla -> elegir tipo de gráfico (mismo
 * catálogo de 3 tipos que ya ofrece Insertar > Gráficos con datos, ver
 * RibbonToolbar.tsx::CHART_OPTIONS) y qué columnas usar. El gráfico
 * resultante es un elemento `chart` normal (LiveChartBlock/Plotly, el mismo
 * motor que ya usa el resto de ReportStudioV2 para gráficos estáticos) con
 * datos reales tomados de la tabla en vez de datos de muestra. */
export default function CreateChartFromTableModal({ rows, hasHeader, onCreate, onClose }: CreateChartFromTableModalProps) {
  const colCount = rows[0]?.length || 0;
  const headerRow = hasHeader ? rows[0] : undefined;
  const columnLabel = (col: number) => {
    const header = headerRow ? stripCellHtml(headerRow[col] ?? '') : '';
    return header || `Columna ${col + 1}`;
  };

  const numericColumns = useMemo(() => detectNumericColumns(rows, hasHeader), [rows, hasHeader]);

  const [chartKind, setChartKind] = useState<string>('chart-line');
  const [categoryColumn, setCategoryColumn] = useState<number>(0);
  const [seriesColumn, setSeriesColumn] = useState<number | undefined>(numericColumns[0]);
  const [series2Column, setSeries2Column] = useState<number | undefined>(undefined);

  const isCombo = chartKind === 'chart-combo';
  const canCreate = numericColumns.length > 0 && seriesColumn !== undefined;

  const submit = () => {
    if (!canCreate || seriesColumn === undefined) return;
    const seriesColumns = isCombo && series2Column !== undefined ? [seriesColumn, series2Column] : [seriesColumn];
    onCreate({ chartKind, categoryColumn, seriesColumns });
    onClose();
  };

  return (
    <div className="document-layout-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="document-layout-modal chart-from-table-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-from-table-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="document-layout-modal__header">
          <div>
            <h2 id="chart-from-table-title">Crear gráfico desde la tabla</h2>
            <p>Elige el tipo de gráfico y qué columnas usar como etiquetas y como valores.</p>
          </div>
          <button type="button" className="document-layout-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        {numericColumns.length === 0 ? (
          <div className="document-layout-grid">
            <p>Esta tabla no tiene columnas con datos numéricos para graficar.</p>
          </div>
        ) : (
          <div className="document-layout-grid">
            <fieldset className="document-layout-section">
              <legend>Tipo de gráfico</legend>
              <div className="chart-from-table-type-options">
                {CHART_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`chart-from-table-type-option${chartKind === option.id ? ' is-active' : ''}`}
                    onClick={() => setChartKind(option.id)}
                  >
                    <BarChart3 size={16} />
                    <span className="chart-from-table-type-option__label">{option.label}</span>
                    <span className="chart-from-table-type-option__desc">{option.desc}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="document-layout-section">
              <legend>Datos de la tabla</legend>
              <div className="document-layout-field-grid">
                <label>
                  Columna de etiquetas
                  <select value={categoryColumn} onChange={(event) => setCategoryColumn(Number(event.target.value))}>
                    {Array.from({ length: colCount }, (_, col) => (
                      <option key={col} value={col}>{columnLabel(col)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Columna de valores{isCombo ? ' (serie 1)' : ''}
                  <select value={seriesColumn} onChange={(event) => setSeriesColumn(Number(event.target.value))}>
                    {numericColumns.map((col) => (
                      <option key={col} value={col}>{columnLabel(col)}</option>
                    ))}
                  </select>
                </label>
                {isCombo && (
                  <label>
                    Columna de valores (serie 2, opcional)
                    <select
                      value={series2Column ?? ''}
                      onChange={(event) => setSeries2Column(event.target.value === '' ? undefined : Number(event.target.value))}
                    >
                      <option value="">Sin segunda serie</option>
                      {numericColumns.filter((col) => col !== seriesColumn).map((col) => (
                        <option key={col} value={col}>{columnLabel(col)}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </fieldset>
          </div>
        )}

        <footer className="document-layout-modal__footer">
          <span>El gráfico se inserta como un bloque nuevo, debajo de la tabla.</span>
          <div>
            <button type="button" className="document-layout-button document-layout-button--secondary" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="document-layout-button document-layout-button--primary"
              style={{ color: 'white' }}
              disabled={!canCreate}
              onClick={submit}
            >
              Crear gráfico
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
