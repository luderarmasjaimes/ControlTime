import { computeTableFormulas, getEffectiveCellValues, stripCellHtml } from './tableFormulas';

export interface ChartFromTableConfig {
  categoryColumn: number;
  /** 1 o 2 columnas numéricas -- la 2da solo tiene sentido visual en el tipo "combo". */
  seriesColumns: number[];
}

export interface ChartFromTableData {
  categories: string[];
  series: number[];
  series2?: number[];
  seriesLabel?: string;
  series2Label?: string;
}

/** Columnas de la tabla que son mayormente numéricas (candidatas a serie de
 * un gráfico) -- cuenta como numérica si más de la mitad de sus celdas de
 * DATOS (sin encabezado) parsean a número. Resuelve fórmulas igual que la
 * tabla misma (`computeTableFormulas`/`getEffectiveCellValues`, el mismo
 * motor que ya usa TableBlock para el formato condicional), así una columna
 * con celdas `=SUMA(...)` cuenta por su valor calculado, no por el texto
 * crudo de la fórmula. */
export function detectNumericColumns(rows: string[][], hasHeader: boolean): number[] {
  const colCount = rows[0]?.length || 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (colCount === 0 || dataRows.length === 0) return [];
  const effective = getEffectiveCellValues(rows, computeTableFormulas(rows));
  const effectiveData = hasHeader ? effective.slice(1) : effective;
  const numericCols: number[] = [];
  for (let c = 0; c < colCount; c += 1) {
    const numericCount = effectiveData.filter((row) => row[c]?.numeric !== null && row[c]?.numeric !== undefined).length;
    if (numericCount > 0 && numericCount >= dataRows.length / 2) numericCols.push(c);
  }
  return numericCols;
}

/** Arma `{categories, series, series2?}` -- el mismo formato plano que ya
 * consume `LiveChartBlock` (dashboard/) -- a partir de las filas de una
 * tabla real, eligiendo qué columna es la etiqueta y cuál(es) son la(s)
 * serie(s) numérica(s). null si no hay suficientes filas/columna de serie. */
export function buildChartDataFromTable(rows: string[][], hasHeader: boolean, config: ChartFromTableConfig): ChartFromTableData | null {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0 || config.seriesColumns.length === 0) return null;
  const effective = getEffectiveCellValues(rows, computeTableFormulas(rows));
  const effectiveData = hasHeader ? effective.slice(1) : effective;

  const categories = dataRows.map((row) => stripCellHtml(row[config.categoryColumn] ?? ''));
  const [seriesCol, series2Col] = config.seriesColumns;
  const series = effectiveData.map((row) => row[seriesCol]?.numeric ?? 0);
  const series2 = series2Col !== undefined ? effectiveData.map((row) => row[series2Col]?.numeric ?? 0) : undefined;

  const headerRow = hasHeader ? rows[0] : undefined;
  const seriesLabel = headerRow ? stripCellHtml(headerRow[seriesCol] ?? '') || undefined : undefined;
  const series2Label = headerRow && series2Col !== undefined ? stripCellHtml(headerRow[series2Col] ?? '') || undefined : undefined;

  return { categories, series, series2, seriesLabel, series2Label };
}
