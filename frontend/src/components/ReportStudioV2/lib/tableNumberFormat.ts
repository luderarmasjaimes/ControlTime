/**
 * Formato numérico por celda para TableBlock.tsx (%, decimales fijos) —
 * mismo espíritu que los botones "%" y "Aumentar/Disminuir decimales" de
 * Excel. El formato NUNCA toca el contenido guardado de la celda (el texto
 * o la fórmula siguen intactos) -- solo cambia cómo se MUESTRA el número en
 * reposo, con el mismo mecanismo de overlay que ya usan las fórmulas
 * (ver TableBlock.tsx).
 *
 * Se guarda como un string simple ("percent:2", "decimal:0") en vez de un
 * objeto -- así encaja en un array paralelo `string[][]` como los demás
 * (cellAligns, cellBackgrounds), serializable tal cual en el JSON del
 * informe sin necesitar una migración de esquema.
 */

export interface NumberFormatSpec {
  kind: 'general' | 'percent' | 'decimal';
  decimals: number;
}

const FORMAT_RE = /^(percent|decimal):(\d+)$/;
const MAX_DECIMALS = 10;

export function parseNumberFormat(spec: string | null | undefined): NumberFormatSpec {
  if (!spec) return { kind: 'general', decimals: 0 };
  const match = FORMAT_RE.exec(spec);
  if (!match) return { kind: 'general', decimals: 0 };
  return { kind: match[1] as 'percent' | 'decimal', decimals: parseInt(match[2], 10) };
}

function serializeNumberFormat(spec: NumberFormatSpec): string | null {
  if (spec.kind === 'general') return null;
  return `${spec.kind}:${spec.decimals}`;
}

/** Único punto de "cómo se ve el número" -- lo usan TableBlock.tsx (overlay
 * en vivo), ReadOnlyViewer.tsx (vista previa/PDF) y exportEngine.ts (DOCX). */
export function formatNumberForDisplay(value: number, spec: string | null | undefined): string {
  if (!Number.isFinite(value)) return '#ERROR!';
  const { kind, decimals } = parseNumberFormat(spec);
  if (kind === 'percent') return `${(value * 100).toFixed(decimals)}%`;
  if (kind === 'decimal') return value.toFixed(decimals);
  if (Number.isInteger(value)) return String(value);
  // "general": redondeo suave para no mostrar arrastres de coma flotante
  // (0.1 + 0.2 en binario) sin forzar una cantidad fija de decimales.
  return String(Math.round(value * 1e6) / 1e6);
}

/** Botón "%": alterna entre porcentaje y decimal normal, conservando la
 * cantidad de decimales que ya tuviera (igual que el botón % de Excel). */
export function togglePercentFormat(spec: string | null | undefined): string | null {
  const current = parseNumberFormat(spec);
  if (current.kind === 'percent') return serializeNumberFormat({ kind: 'decimal', decimals: current.decimals });
  return serializeNumberFormat({ kind: 'percent', decimals: current.decimals || 0 });
}

/** Botones "Aumentar/Disminuir decimales" -- sobre una celda sin formato
 * (general) arrancan en modo decimal, como en Excel. */
export function bumpDecimals(spec: string | null | undefined, delta: number): string | null {
  const current = parseNumberFormat(spec);
  const decimals = Math.max(0, Math.min(MAX_DECIMALS, current.decimals + delta));
  const kind = current.kind === 'general' ? 'decimal' : current.kind;
  return serializeNumberFormat({ kind, decimals });
}
