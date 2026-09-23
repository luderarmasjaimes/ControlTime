'use strict';
/**
 * Puerto a Node/CommonJS de la MISMA especificación que
 * `frontend/src/components/ReportStudioV2/lib/tableFormulas.ts` +
 * `lib/tableConditionalFormat.ts` + `lib/semanticStatus.ts` -- motor de
 * fórmulas (ADR-172), formato condicional y coloreado semántico ("semáforo")
 * de TableBlock.tsx. Sin este módulo, ningún export server-side (DOCX/PPTX/
 * XLSX) reproducía el valor CALCULADO de una celda-fórmula ni sus colores --
 * confirmado con el "Reporte de observaciones" 2026-09-21 (Jhon Alvarez,
 * items 5 y 6: tablas exportaban la fórmula cruda y perdían todo color de
 * celda/texto). Puerto deliberadamente fiel -- misma tokenización, misma
 * precedencia de operadores, mismos códigos de error (#REF!/#DIV/0!/etc.),
 * para que el resultado en el .docx sea IDÉNTICO al que ya se ve en pantalla
 * en el editor/ReadOnlyViewer (misma fuente de verdad, dos runtimes).
 */

// ── lib/tableFormulas.ts ────────────────────────────────────────────────────
const CELL_REF_RE = /^([A-Z]+)(\d+)$/;
const FORMULA_DECIMALS = 6;

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function colLettersToIndex(letters) {
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) index = index * 26 + (letters.charCodeAt(i) - 64);
  return index - 1;
}

function parseCellRef(ref) {
  const match = CELL_REF_RE.exec(ref.trim().toUpperCase());
  if (!match) return null;
  const row = parseInt(match[2], 10) - 1;
  if (row < 0) return null;
  return { row, col: colLettersToIndex(match[1]) };
}

function isFormulaText(raw) {
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

function formatNumericDisplay(value) {
  if (!Number.isFinite(value)) return '#ERROR!';
  if (Number.isInteger(value)) return String(value);
  const factor = 10 ** FORMULA_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
const WORD_RE = /[A-Za-z0-9]/;

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(expr[j])) j += 1;
      const value = Number(expr.slice(i, j));
      if (Number.isNaN(value)) throw new FormulaError('#ERROR!');
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < n && WORD_RE.test(expr[j])) j += 1;
      const word = expr.slice(i, j).toUpperCase();
      if (CELL_REF_RE.test(word)) {
        if (expr[j] === ':') {
          let k = j + 1;
          while (k < n && WORD_RE.test(expr[k])) k += 1;
          const second = expr.slice(j + 1, k).toUpperCase();
          const from = parseCellRef(word);
          const to = parseCellRef(second);
          if (from && to) {
            tokens.push({ type: 'range', from, to });
            i = k;
            continue;
          }
        }
        const ref = parseCellRef(word);
        if (!ref) throw new FormulaError('#REF!');
        tokens.push({ type: 'ref', row: ref.row, col: ref.col });
        i = j;
        continue;
      }
      tokens.push({ type: 'func', name: word });
      i = j;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue; }
    if (ch === ',' || ch === ';') { tokens.push({ type: 'comma' }); i += 1; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  return tokens;
}

// ── Parser (recursive-descent: expr -> term -> pow -> unary -> atom) ────────
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() { return this.tokens[this.pos]; }
  next() {
    const tok = this.tokens[this.pos];
    if (!tok) throw new FormulaError('#ERROR!');
    this.pos += 1;
    return tok;
  }
  parse() {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new FormulaError('#ERROR!');
    return node;
  }
  parseExpr() {
    let node = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.next();
        node = { kind: 'bin', op: tok.value, left: node, right: this.parseTerm() };
      } else break;
    }
    return node;
  }
  parseTerm() {
    let node = this.parsePow();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.next();
        node = { kind: 'bin', op: tok.value, left: node, right: this.parsePow() };
      } else break;
    }
    return node;
  }
  parsePow() {
    const node = this.parseUnary();
    const tok = this.peek();
    if (tok && tok.type === 'op' && tok.value === '^') {
      this.next();
      return { kind: 'bin', op: '^', left: node, right: this.parsePow() };
    }
    return node;
  }
  parseUnary() {
    const tok = this.peek();
    if (tok && tok.type === 'op' && tok.value === '-') { this.next(); return { kind: 'neg', arg: this.parseUnary() }; }
    if (tok && tok.type === 'op' && tok.value === '+') { this.next(); return this.parseUnary(); }
    return this.parseAtom();
  }
  parseAtom() {
    const tok = this.next();
    if (tok.type === 'number') return { kind: 'num', value: tok.value };
    if (tok.type === 'ref') return { kind: 'ref', row: tok.row, col: tok.col };
    if (tok.type === 'range') return { kind: 'range', from: tok.from, to: tok.to };
    if (tok.type === 'lparen') {
      const inner = this.parseExpr();
      const close = this.next();
      if (close.type !== 'rparen') throw new FormulaError('#ERROR!');
      return inner;
    }
    if (tok.type === 'func') {
      const open = this.next();
      if (open.type !== 'lparen') throw new FormulaError('#ERROR!');
      const args = [];
      if (!this.peek() || this.peek().type !== 'rparen') {
        args.push(this.parseExpr());
        while (this.peek() && this.peek().type === 'comma') { this.next(); args.push(this.parseExpr()); }
      }
      const close = this.next();
      if (close.type !== 'rparen') throw new FormulaError('#ERROR!');
      return { kind: 'call', name: tok.name, args };
    }
    throw new FormulaError('#ERROR!');
  }
}

const FUNC_ALIASES = { SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', REDONDEAR: 'ROUND', MAXIMO: 'MAX', MINIMO: 'MIN' };

function expandRange(from, to, resolveCell) {
  const values = [];
  const rowStart = Math.min(from.row, to.row);
  const rowEnd = Math.max(from.row, to.row);
  const colStart = Math.min(from.col, to.col);
  const colEnd = Math.max(from.col, to.col);
  for (let r = rowStart; r <= rowEnd; r += 1) {
    for (let c = colStart; c <= colEnd; c += 1) values.push(resolveCell(r, c));
  }
  return values;
}

function evalArgAsNumbers(node, resolveCell) {
  if (node.kind === 'range') return expandRange(node.from, node.to, resolveCell);
  return [evalNode(node, resolveCell)];
}

function requireNumber(value) {
  if (value === null) throw new FormulaError('#VALUE!');
  return value;
}

function evalNode(node, resolveCell) {
  switch (node.kind) {
    case 'num': return node.value;
    case 'ref': return requireNumber(resolveCell(node.row, node.col));
    case 'range': throw new FormulaError('#VALUE!');
    case 'neg': return -evalNode(node.arg, resolveCell);
    case 'bin': {
      const left = evalNode(node.left, resolveCell);
      const right = evalNode(node.right, resolveCell);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) throw new FormulaError('#DIV/0!');
          return left / right;
        case '^': return left ** right;
        default: throw new FormulaError('#ERROR!');
      }
    }
    case 'call': {
      const name = FUNC_ALIASES[node.name] || node.name;
      const flatArgs = node.args.reduce((acc, arg) => acc.concat(evalArgAsNumbers(arg, resolveCell)), []);
      const numericArgs = flatArgs.filter((v) => v !== null);
      switch (name) {
        case 'SUM': return numericArgs.reduce((a, b) => a + b, 0);
        case 'AVERAGE':
          if (numericArgs.length === 0) throw new FormulaError('#DIV/0!');
          return numericArgs.reduce((a, b) => a + b, 0) / numericArgs.length;
        case 'COUNT': return numericArgs.length;
        case 'MAX': return numericArgs.length === 0 ? 0 : Math.max(...numericArgs);
        case 'MIN': return numericArgs.length === 0 ? 0 : Math.min(...numericArgs);
        case 'ABS':
          if (flatArgs.length !== 1) throw new FormulaError('#VALUE!');
          return Math.abs(requireNumber(flatArgs[0]));
        case 'ROUND': {
          if (flatArgs.length < 1 || flatArgs.length > 2) throw new FormulaError('#VALUE!');
          const base = requireNumber(flatArgs[0]);
          const decimals = flatArgs.length === 2 ? requireNumber(flatArgs[1]) : 0;
          const factor = 10 ** decimals;
          return Math.round(base * factor) / factor;
        }
        default: throw new FormulaError('#NAME?');
      }
    }
    default: throw new FormulaError('#ERROR!');
  }
}

function evaluateFormula(formulaText, resolveCell) {
  const expr = formulaText.trim().replace(/^=/, '');
  if (expr === '') return { display: '#ERROR!', numericValue: null, isError: true };
  try {
    const tokens = tokenize(expr);
    const ast = new Parser(tokens).parse();
    const value = evalNode(ast, resolveCell);
    if (!Number.isFinite(value)) return { display: '#ERROR!', numericValue: null, isError: true };
    return { display: formatNumericDisplay(value), numericValue: value, isError: false };
  } catch (err) {
    const code = err instanceof FormulaError ? err.code : '#ERROR!';
    return { display: code, numericValue: null, isError: true };
  }
}

function stripCellHtml(html) {
  return String(html == null ? '' : html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function parseCellNumber(text) {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(/\s/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Recorre TODA la tabla una vez y calcula el valor en reposo de cada celda
 * que sea fórmula. Memoiza por celda y detecta referencias circulares. */
function computeTableFormulas(rows) {
  const results = rows.map((row) => row.map(() => null));
  const plainCache = new Map();
  const numericCache = new Map();
  const resolving = new Set();
  const keyOf = (row, col) => `${row}-${col}`;

  const getPlainText = (row, col) => {
    const key = keyOf(row, col);
    const cached = plainCache.get(key);
    if (cached !== undefined) return cached;
    const raw = (rows[row] && rows[row][col]) || '';
    const plain = stripCellHtml(raw);
    plainCache.set(key, plain);
    return plain;
  };

  const resolveCell = (row, col) => {
    if (row < 0 || col < 0 || row >= rows.length || col >= ((rows[row] && rows[row].length) || 0)) return null;
    const key = keyOf(row, col);
    if (numericCache.has(key)) return numericCache.get(key);
    const plain = getPlainText(row, col);
    if (!isFormulaText(plain)) {
      const value = parseCellNumber(plain);
      numericCache.set(key, value);
      return value;
    }
    if (resolving.has(key)) throw new FormulaError('#CIRC!');
    resolving.add(key);
    try {
      const result = evaluateFormula(plain, resolveCell);
      results[row][col] = result;
      numericCache.set(key, result.numericValue);
      return result.numericValue;
    } finally {
      resolving.delete(key);
    }
  };

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < ((rows[r] && rows[r].length) || 0); c += 1) {
      if (results[r][c]) continue;
      const plain = getPlainText(r, c);
      if (!isFormulaText(plain)) continue;
      try {
        resolveCell(r, c);
      } catch (err) {
        const code = err instanceof FormulaError ? err.code : '#ERROR!';
        results[r][c] = { display: code, numericValue: null, isError: true };
      }
    }
  }
  return results;
}

/** Une fórmulas (ya resueltas) y celdas normales bajo un mismo formato, para
 * que el formato condicional no tenga que saber nada de fórmulas ni HTML. */
function getEffectiveCellValues(rows, formulaResults) {
  return rows.map((row, r) => row.map((cell, c) => {
    const formulaResult = formulaResults[r] && formulaResults[r][c];
    if (formulaResult) return { numeric: formulaResult.numericValue, text: formulaResult.display };
    const plain = stripCellHtml(cell);
    return { numeric: parseCellNumber(plain), text: plain };
  }));
}

// ── lib/tableConditionalFormat.ts ───────────────────────────────────────────
function matchesScope(scope, row, column) {
  if (!scope) return true;
  if (scope.type === 'row') return row === scope.row;
  if (scope.type === 'column') return column === scope.column;
  return scope.cells.some((c) => c.row === row && c.column === column);
}

function matchesCondition(rule, cell) {
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

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${rgb.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

function lerpColor(a, b, t) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return undefined;
  return rgbToHex([
    rgbA[0] + (rgbB[0] - rgbA[0]) * t,
    rgbA[1] + (rgbB[1] - rgbA[1]) * t,
    rgbA[2] + (rgbB[2] - rgbA[2]) * t,
  ]);
}

function colorScaleStyleFor(stops, numeric) {
  const sorted = stops
    .map((s) => Object.assign({}, s, { num: Number(s.value) }))
    .filter((s) => Number.isFinite(s.num))
    .sort((a, b) => a.num - b.num);
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length === 1 || numeric <= first.num) return { backgroundColor: first.backgroundColor, textColor: first.textColor };
  if (numeric >= last.num) return { backgroundColor: last.backgroundColor, textColor: last.textColor };
  for (let i = 0; i < sorted.length - 1; i += 1) {
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

function computeConditionalStyles(effectiveValues, rules, hasHeader, colorScales) {
  const hasRules = !!rules && rules.length > 0;
  const hasScales = !!colorScales && colorScales.length > 0;
  if (!hasRules && !hasScales) return effectiveValues.map((row) => row.map(() => null));
  return effectiveValues.map((row, ri) => row.map((cellValue, ci) => {
    if (hasHeader && ri === 0) return null;
    let style = null;
    if (hasScales && cellValue.numeric !== null) {
      for (const scale of colorScales) {
        if (!matchesScope(scale.scope, ri, ci)) continue;
        const scaleStyle = colorScaleStyleFor(scale.stops, cellValue.numeric);
        if (scaleStyle) style = Object.assign({}, style || {}, scaleStyle);
      }
    }
    if (hasRules) {
      for (const rule of rules) {
        if (!matchesScope(rule.scope, ri, ci)) continue;
        if (!matchesCondition(rule, cellValue)) continue;
        style = style || {};
        if (rule.backgroundColor) style.backgroundColor = rule.backgroundColor;
        if (rule.textColor) style.textColor = rule.textColor;
      }
    }
    return style;
  }));
}

// ── lib/semanticStatus.ts ───────────────────────────────────────────────────
const GREEN = { bg: '#E2F0D9', color: '#375623' };
const AMBER = { bg: '#FFF2CC', color: '#7F6000' };
const BLUE = { bg: '#DDEBF7', color: '#1F4E79' };
const ORANGE = { bg: '#FCE4D6', color: '#843C0C' };
const RED = { bg: '#F4CCCC', color: '#843434' };

const STATUS_MAP = {
  VERDE: GREEN, CONFORME: GREEN, CERRADA: GREEN, CERRADO: GREEN,
  BAJA: GREEN, BAJO: GREEN, OPERATIVO: GREEN, ADECUADA: GREEN, CUMPLE: GREEN, OK: GREEN,
  AMARILLO: AMBER, OBSERVACION: AMBER, MEDIA: AMBER, MEDIO: AMBER,
  MODERADO: AMBER, PARCIAL: AMBER, ABIERTA: AMBER, ABIERTO: AMBER,
  DEGRADADO: AMBER, ATENCION: AMBER,
  'EN CURSO': BLUE, TECNICA: BLUE,
  NARANJA: ORANGE, ALTA: ORANGE, ALTO: ORANGE,
  ROJO: RED, 'NO CONFORME': RED, CRITICA: RED, CRITICO: RED,
  INOPERATIVO: RED, INMINENTE: RED, 'NO APTO': RED,
};

function normalizeCellText(raw) {
  const noTags = String(raw || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
  const noAccents = noTags.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return noAccents.trim().toUpperCase();
}

function semanticStatusStyle(raw, isHeader) {
  if (isHeader || !raw) return null;
  const txt = normalizeCellText(raw);
  if (!txt || txt.length > 14) return null;
  return STATUS_MAP[txt] || null;
}

module.exports = {
  isFormulaText,
  evaluateFormula,
  computeTableFormulas,
  getEffectiveCellValues,
  stripCellHtml,
  parseCellNumber,
  computeConditionalStyles,
  semanticStatusStyle,
};
