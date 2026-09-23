/**
 * Formato condicional para TableBlock.tsx -- dos mecanismos de Excel:
 * 1) "Resaltar reglas de celdas" (ConditionalFormatRule/matchesCondition):
 *    Mayor que, Menor que, Entre, Igual a, El texto contiene. Cada regla
 *    pinta con un color FIJO las celdas que cumplan la condición.
 * 2) "Escalas de color" (ColorScaleFormat/colorScaleStyleFor): el color se
 *    INTERPOLA de forma continua entre 2 o 3 puntos (mínimo[/medio]/máximo)
 *    según el valor de la celda -- ver Format Style "2-Color Scale" /
 *    "3-Color Scale" en el diálogo de Excel.
 * Ambos comparan el valor EFECTIVO de la celda (el resultado de la fórmula
 * si es fórmula, o el número/texto plano si no), y por defecto aplican a
 * TODA la tabla -- opcionalmente se pueden acotar a una celda/selección/
 * fila/columna puntual vía `scope` (ver ConditionalFormatScope más abajo).
 * Varias reglas/escalas pueden aplicar a la misma celda; se evalúan en
 * orden (escalas primero, como capa base, luego reglas de umbral encima) y
 * una posterior pisa las propiedades que choquen con una anterior (por
 * simplicidad -- a diferencia de Excel, acá no hay "detener si es verdad"
 * ni prioridad explícita reordenable).
 */

import type { EffectiveCellValue } from './tableFormulas';

export type ConditionType =
  | 'greaterThan'
  | 'lessThan'
  | 'greaterOrEqual'
  | 'lessOrEqual'
  | 'equal'
  | 'notEqual'
  | 'between'
  | 'textContains';

/** A qué celdas aplica una regla o escala -- `undefined` (el default
 * histórico) sigue significando "toda la tabla", así que documentos viejos
 * sin este campo no necesitan migración. 'row'/'column' son DINÁMICOS (se
 * evalúan por índice en cada render, no una lista fija de celdas): si el
 * usuario agrega una columna nueva a una fila con una regla de tipo 'row',
 * esa columna nueva queda cubierta automáticamente, igual que en Excel al
 * aplicar formato "a toda la fila". 'cells' sí es una lista fija (la
 * selección tipo Excel que el usuario tenía activa al crear la regla) --
 * agregar filas/columnas no la expande ni la reduce. */
export type ConditionalFormatScope =
  | { type: 'cells'; cells: { row: number; column: number }[] }
  | { type: 'row'; row: number }
  | { type: 'column'; column: number };

function matchesScope(scope: ConditionalFormatScope | undefined, row: number, column: number): boolean {
  if (!scope) return true;
  if (scope.type === 'row') return row === scope.row;
  if (scope.type === 'column') return column === scope.column;
  return scope.cells.some((c) => c.row === row && c.column === column);
}

function shiftScope(scope: ConditionalFormatScope | undefined, axis: 'row' | 'col', insertAt: number): ConditionalFormatScope | undefined {
  if (!scope) return scope;
  if (scope.type === 'row') {
    return axis === 'row' && scope.row >= insertAt ? { ...scope, row: scope.row + 1 } : scope;
  }
  if (scope.type === 'column') {
    return axis === 'col' && scope.column >= insertAt ? { ...scope, column: scope.column + 1 } : scope;
  }
  return {
    ...scope,
    cells: scope.cells.map((c) => ({
      row: axis === 'row' && c.row >= insertAt ? c.row + 1 : c.row,
      column: axis === 'col' && c.column >= insertAt ? c.column + 1 : c.column,
    })),
  };
}

/** Corre el `scope` de cada regla/escala una posición en el eje dado a
 * partir de `insertAt` -- usado al insertar una fila/columna en medio de la
 * tabla (dividir una celda normal en dos, ver `splitNormalCellInto` en
 * TableBlock.tsx) para que una regla acotada a una celda/fila/columna
 * puntual se quede apuntando al mismo contenido aunque su índice numérico
 * se haya corrido. Los scopes 'row'/'column' de una fila/columna ANTERIOR a
 * la inserción, o sin scope (toda la tabla), no necesitan tocarse. */
export function shiftScopedItems<T extends { scope?: ConditionalFormatScope }>(
  items: T[],
  axis: 'row' | 'col',
  insertAt: number,
): T[] {
  return items.map((item) => ({ ...item, scope: shiftScope(item.scope, axis, insertAt) }));
}

export interface ConditionalFormatRule {
  id: string;
  condition: ConditionType;
  /** Umbral principal. Numérico para todas las condiciones salvo
   * 'textContains', donde es el texto a buscar (sin distinguir mayúsculas). */
  value: string;
  /** Solo para 'between': el segundo umbral (el orden entre value/value2 no importa). */
  value2?: string;
  backgroundColor?: string;
  textColor?: string;
  /** Ver ConditionalFormatScope -- `undefined` = toda la tabla (default histórico). */
  scope?: ConditionalFormatScope;
}

export interface ConditionalCellStyle {
  backgroundColor?: string;
  textColor?: string;
}

/** Un punto de una escala de color (ver ColorScaleFormat) -- `value` es el
 * umbral numérico de ese punto (mínimo/medio/máximo). */
export interface ColorScaleStop {
  value: string;
  backgroundColor: string;
  textColor?: string;
}

/** Escala de color tipo Excel ("Format Style: 2-Color Scale / 3-Color
 * Scale"): a diferencia de ConditionalFormatRule (que pinta CADA celda que
 * cumple una condición con un color fijo), acá el color se INTERPOLA de
 * forma continua entre los `stops` según dónde cae el valor de la celda --
 * 2 stops (mínimo/máximo) o 3 (mínimo/medio/máximo). Vive como su propia
 * lista en las props del bloque (element.props.colorScales), separada de
 * `conditionalFormats`, porque conceptualmente es una sola entidad editable
 * de punta a punta (no reglas sueltas que se acumulan una por una). */
export interface ColorScaleFormat {
  id: string;
  stops: ColorScaleStop[];
  /** Ver ConditionalFormatScope -- `undefined` = toda la tabla (default histórico). */
  scope?: ConditionalFormatScope;
}

export interface ThreeTierTemplate {
  id: string;
  label: string;
  low: { backgroundColor: string; textColor: string };
  mid: { backgroundColor: string; textColor: string };
  high: { backgroundColor: string; textColor: string };
}

/** Plantillas rápidas tipo "Escalas de color" de Excel -- ya traen fondo Y
 * texto resueltos para las 3 franjas (bajo/medio/alto); el usuario solo
 * pone los dos umbrales (mínimo, máximo) que separan las franjas. */
export const THREE_TIER_TEMPLATES: ThreeTierTemplate[] = [
  {
    id: 'red-yellow-green',
    label: 'Rojo-Amarillo-Verde (más alto es mejor)',
    low: { backgroundColor: '#fecaca', textColor: '#991b1b' },
    mid: { backgroundColor: '#fef08a', textColor: '#854d0e' },
    high: { backgroundColor: '#bbf7d0', textColor: '#166534' },
  },
  {
    id: 'green-yellow-red',
    label: 'Verde-Amarillo-Rojo (más bajo es mejor)',
    low: { backgroundColor: '#bbf7d0', textColor: '#166534' },
    mid: { backgroundColor: '#fef08a', textColor: '#854d0e' },
    high: { backgroundColor: '#fecaca', textColor: '#991b1b' },
  },
  {
    id: 'red-white-green',
    label: 'Rojo-Blanco-Verde',
    low: { backgroundColor: '#fecaca', textColor: '#991b1b' },
    mid: { backgroundColor: '#f1f5f9', textColor: '#334155' },
    high: { backgroundColor: '#bbf7d0', textColor: '#166534' },
  },
  {
    id: 'blue-white-red',
    label: 'Azul-Blanco-Rojo',
    low: { backgroundColor: '#bfdbfe', textColor: '#1e3a8a' },
    mid: { backgroundColor: '#f1f5f9', textColor: '#334155' },
    high: { backgroundColor: '#fecaca', textColor: '#991b1b' },
  },
];

/** Arma las 3 reglas (menor que mínimo / entre / mayor o igual que máximo)
 * de una plantilla de 3 niveles ya con los umbrales del usuario. El orden
 * importa: en un empate exacto en el umbral, la regla que viene DESPUÉS en
 * el array gana (ver computeConditionalStyles) -- así el valor == máximo
 * cae en la franja "alta", no en la "media". */
export function buildThreeTierRules(template: ThreeTierTemplate, min: number, max: number): ConditionalFormatRule[] {
  const idBase = `cf-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return [
    { id: `${idBase}-low`, condition: 'lessThan', value: String(min), backgroundColor: template.low.backgroundColor, textColor: template.low.textColor },
    { id: `${idBase}-mid`, condition: 'between', value: String(min), value2: String(max), backgroundColor: template.mid.backgroundColor, textColor: template.mid.textColor },
    { id: `${idBase}-high`, condition: 'greaterOrEqual', value: String(max), backgroundColor: template.high.backgroundColor, textColor: template.high.textColor },
  ];
}

export const CONDITION_LABELS: Record<ConditionType, string> = {
  greaterThan: 'Mayor que',
  lessThan: 'Menor que',
  greaterOrEqual: 'Mayor o igual que',
  lessOrEqual: 'Menor o igual que',
  equal: 'Igual a',
  notEqual: 'Distinto de',
  between: 'Entre',
  textContains: 'El texto contiene',
};

function matchesCondition(rule: ConditionalFormatRule, cell: EffectiveCellValue): boolean {
  if (rule.condition === 'textContains') {
    const needle = rule.value.trim().toLowerCase();
    return needle.length > 0 && cell.text.toLowerCase().includes(needle);
  }
  if (cell.numeric === null) return false;
  const threshold = Number(rule.value);
  if (!Number.isFinite(threshold)) return false;
  switch (rule.condition) {
    case 'greaterThan': return cell.numeric > threshold;
    case 'lessThan': return cell.numeric < threshold;
    case 'greaterOrEqual': return cell.numeric >= threshold;
    case 'lessOrEqual': return cell.numeric <= threshold;
    case 'equal': return cell.numeric === threshold;
    case 'notEqual': return cell.numeric !== threshold;
    case 'between': {
      const threshold2 = Number(rule.value2);
      if (!Number.isFinite(threshold2)) return false;
      const lo = Math.min(threshold, threshold2);
      const hi = Math.max(threshold, threshold2);
      return cell.numeric >= lo && cell.numeric <= hi;
    }
    default: return false;
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mezcla lineal entre dos colores hex (t=0 -> a, t=1 -> b). `undefined` si
 * alguno de los dos no es un hex válido (p.ej. un stop sin textColor). */
function lerpColor(a: string, b: string, t: number): string | undefined {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return undefined;
  return rgbToHex([
    rgbA[0] + (rgbB[0] - rgbA[0]) * t,
    rgbA[1] + (rgbB[1] - rgbA[1]) * t,
    rgbA[2] + (rgbB[2] - rgbA[2]) * t,
  ]);
}

/** Estilo de una celda numérica dentro de una escala de color: los stops se
 * ordenan por valor y el color se interpola linealmente en el segmento que
 * contiene a `numeric` (clamp a los extremos fuera de rango -- igual que
 * Excel, que pinta con el color del mínimo/máximo a los valores que se
 * pasan). Con un solo stop válido no hay "escala" real, así que ese color
 * se usa fijo para toda celda numérica (caso borde, no el flujo normal). */
function colorScaleStyleFor(stops: ColorScaleStop[], numeric: number): ConditionalCellStyle | null {
  const sorted = stops
    .map((s) => ({ ...s, num: Number(s.value) }))
    .filter((s) => Number.isFinite(s.num))
    .sort((a, b) => a.num - b.num);
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length === 1 || numeric <= first.num) return { backgroundColor: first.backgroundColor, textColor: first.textColor };
  if (numeric >= last.num) return { backgroundColor: last.backgroundColor, textColor: last.textColor };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (numeric > b.num) continue;
    const t = b.num === a.num ? 0 : (numeric - a.num) / (b.num - a.num);
    return {
      backgroundColor: lerpColor(a.backgroundColor, b.backgroundColor, t) || a.backgroundColor,
      textColor: a.textColor && b.textColor ? lerpColor(a.textColor, b.textColor, t) : (a.textColor || b.textColor),
    };
  }
  return null;
}

/** Calcula el estilo condicional (si hay alguno) de cada celda: primero
 * aplica las escalas de color (degradado continuo, ver colorScaleStyleFor)
 * como capa base y luego las reglas de umbral (ver matchesCondition) encima
 * -- una regla de umbral que matchea pisa lo que haya puesto la escala,
 * igual que en Excel las reglas posteriores ganan sobre las anteriores.
 * `isHeaderRow` decide si la fila 0 se excluye (igual que el resaltado por
 * bandas -- los encabezados no son datos). Cada regla/escala puede además
 * traer su propio `scope` (ver ConditionalFormatScope) para acotarse a una
 * celda/selección/fila/columna en vez de toda la tabla. */
export function computeConditionalStyles(
  effectiveValues: EffectiveCellValue[][],
  rules: ConditionalFormatRule[] | undefined,
  hasHeader: boolean,
  colorScales?: ColorScaleFormat[],
): (ConditionalCellStyle | null)[][] {
  const hasRules = !!rules && rules.length > 0;
  const hasScales = !!colorScales && colorScales.length > 0;
  if (!hasRules && !hasScales) return effectiveValues.map((row) => row.map(() => null));
  return effectiveValues.map((row, ri) =>
    row.map((cellValue, ci) => {
      if (hasHeader && ri === 0) return null;
      let style: ConditionalCellStyle | null = null;
      if (hasScales && cellValue.numeric !== null) {
        for (const scale of colorScales!) {
          if (!matchesScope(scale.scope, ri, ci)) continue;
          const scaleStyle = colorScaleStyleFor(scale.stops, cellValue.numeric);
          if (scaleStyle) style = { ...(style || {}), ...scaleStyle };
        }
      }
      if (hasRules) {
        for (const rule of rules!) {
          if (!matchesScope(rule.scope, ri, ci)) continue;
          if (!matchesCondition(rule, cellValue)) continue;
          style = style || {};
          if (rule.backgroundColor) style.backgroundColor = rule.backgroundColor;
          if (rule.textColor) style.textColor = rule.textColor;
        }
      }
      return style;
    }),
  );
}
