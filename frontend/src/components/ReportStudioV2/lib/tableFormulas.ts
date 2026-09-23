/**
 * Motor de fórmulas para TableBlock.tsx — subconjunto de Excel: referencias
 * A1 (y rangos A1:B3), operadores +-*^/, paréntesis, y las funciones más
 * usadas en informes técnicos (SUMA/SUM, PROMEDIO/AVERAGE, CONTAR/COUNT,
 * MAX, MIN, REDONDEAR/ROUND, ABS). Deliberadamente NO es un clon completo de
 * Excel (sin referencias entre hojas, sin funciones de texto/fecha, sin $
 * absoluto) — cubre lo que un informe minero necesita: sumar/promediar
 * columnas de mediciones dentro de la misma tabla.
 *
 * Cómo se usa desde TableBlock.tsx: una celda es fórmula si su texto plano
 * (sin HTML) empieza con "=". `computeTableFormulas(rows)` recorre TODA la
 * tabla una vez y devuelve, por celda, el valor a MOSTRAR cuando esa celda
 * no está siendo editada (null si la celda no es fórmula, y hay que
 * renderizar su HTML normal tal cual). El texto crudo ("=SUMA(A1:A3)") se
 * sigue editando como cualquier otra celda — solo la VISTA en reposo cambia.
 *
 * Diferencia deliberada con Excel: SUMA/PROMEDIO/CONTAR/MAX/MIN sobre un
 * RANGO sí ignoran celdas vacías o con texto (igual que Excel). Pero una
 * referencia DIRECTA a una celda vacía dentro de una operación aritmética
 * (p.ej. "=A1+1" con A1 vacía) da #VALUE! en vez del 0 que devolvería
 * Excel — evita la complejidad de distinguir "vacía" de "texto que no es
 * número" en cada referencia suelta; en la práctica de un informe minero
 * las fórmulas son casi siempre sumas/promedios de columnas ya llenas.
 */

export interface FormulaCellResult {
  /** Texto a mostrar en reposo: el número calculado, o un código de error
   * tipo Excel (#REF!, #DIV/0!, #VALUE!, #CIRC!, #ERROR!). */
  display: string;
  /** Valor numérico crudo (sin redondear para mostrar) — lo usará el
   * formato de número (%, decimales) de la Fase 2; null si hay error. */
  numericValue: number | null;
  isError: boolean;
}

const CELL_REF_RE = /^([A-Z]+)(\d+)$/;
const FORMULA_DECIMALS = 6;

class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function colLettersToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

/** "A1" -> {row:0,col:0}; "C10" -> {row:9,col:2}. null si no matchea. */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = CELL_REF_RE.exec(ref.trim().toUpperCase());
  if (!match) return null;
  const row = parseInt(match[2], 10) - 1;
  if (row < 0) return null;
  return { row, col: colLettersToIndex(match[1]) };
}

export function isFormulaText(raw: string): boolean {
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

/** Inverso de `colLettersToIndex`: 0 -> "A", 26 -> "AA". */
function indexToColLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const WORD_CHAR_RE = /[A-Za-z0-9]/;

/** Reescribe cada referencia de celda (A1, o cada extremo de un rango como
 * A1:B3) que caiga EN o después de `insertAt` en el eje dado, sumándole 1 --
 * usado al insertar una fila/columna en medio de la tabla (dividir una
 * celda normal en dos, ver `splitNormalCellInto` en TableBlock.tsx) para
 * que las fórmulas existentes en OTRAS celdas sigan apuntando al mismo
 * contenido aunque su posición numérica se haya corrido. No toca nombres de
 * función (SUMA, PROMEDIO...) porque esos nunca matchean CELL_REF_RE (que
 * exige letras seguidas de dígitos). Camina la cadena a mano en vez de
 * reusar `tokenize()` porque necesita el texto ORIGINAL de vuelta (con sus
 * operadores, paréntesis y espacios intactos), no un AST evaluado. */
export function shiftFormulaRefs(formula: string, axis: 'row' | 'col', insertAt: number): string {
  if (!isFormulaText(formula)) return formula;
  let result = '';
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < n && WORD_CHAR_RE.test(formula[j])) j += 1;
      const word = formula.slice(i, j);
      const ref = parseCellRef(word);
      if (ref) {
        const row = axis === 'row' && ref.row >= insertAt ? ref.row + 1 : ref.row;
        const col = axis === 'col' && ref.col >= insertAt ? ref.col + 1 : ref.col;
        result += `${indexToColLetters(col)}${row + 1}`;
      } else {
        result += word;
      }
      i = j;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

function formatNumericDisplay(value: number): string {
  if (!Number.isFinite(value)) return '#ERROR!';
  if (Number.isInteger(value)) return String(value);
  const factor = 10 ** FORMULA_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

// ── Tokenizer ──────────────────────────────────────────────────────────────
type Token =
  | { type: 'number'; value: number }
  | { type: 'ref'; row: number; col: number }
  | { type: 'range'; from: { row: number; col: number }; to: { row: number; col: number } }
  | { type: 'func'; name: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

const WORD_RE = /[A-Za-z0-9]/;

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
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

// ── AST ──────────────────────────────────────────────────────────────────
type Node =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; row: number; col: number }
  | { kind: 'range'; from: { row: number; col: number }; to: { row: number; col: number } }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

// Recursive-descent parser: call -> unary -> pow -> term -> expr, con la
// precedencia habitual de una hoja de cálculo (^ más apretado que * /, que
// a su vez más apretado que + -; unario - se resuelve en `parseUnary`).
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) throw new FormulaError('#ERROR!');
    this.pos += 1;
    return tok;
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new FormulaError('#ERROR!');
    return node;
  }

  private parseExpr(): Node {
    let node = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok?.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.next();
        node = { kind: 'bin', op: tok.value, left: node, right: this.parseTerm() };
      } else break;
    }
    return node;
  }

  private parseTerm(): Node {
    let node = this.parsePow();
    for (;;) {
      const tok = this.peek();
      if (tok?.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.next();
        node = { kind: 'bin', op: tok.value, left: node, right: this.parsePow() };
      } else break;
    }
    return node;
  }

  private parsePow(): Node {
    const node = this.parseUnary();
    const tok = this.peek();
    if (tok?.type === 'op' && tok.value === '^') {
      this.next();
      // ^ es asociativo a la derecha (2^3^2 = 2^(3^2) en Excel).
      return { kind: 'bin', op: '^', left: node, right: this.parsePow() };
    }
    return node;
  }

  private parseUnary(): Node {
    const tok = this.peek();
    if (tok?.type === 'op' && tok.value === '-') {
      this.next();
      return { kind: 'neg', arg: this.parseUnary() };
    }
    if (tok?.type === 'op' && tok.value === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parseAtom();
  }

  private parseAtom(): Node {
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
      const args: Node[] = [];
      if (this.peek()?.type !== 'rparen') {
        args.push(this.parseExpr());
        while (this.peek()?.type === 'comma') {
          this.next();
          args.push(this.parseExpr());
        }
      }
      const close = this.next();
      if (close.type !== 'rparen') throw new FormulaError('#ERROR!');
      return { kind: 'call', name: tok.name, args };
    }
    throw new FormulaError('#ERROR!');
  }
}

/** Alias en español -> nombre canónico, para que "=SUMA(...)" y "=SUM(...)"
 * funcionen igual (el usuario referenció explícitamente "=SUMA" de Excel). */
const FUNC_ALIASES: Record<string, string> = {
  SUMA: 'SUM',
  PROMEDIO: 'AVERAGE',
  CONTAR: 'COUNT',
  REDONDEAR: 'ROUND',
  MAXIMO: 'MAX',
  MINIMO: 'MIN',
};

/** Devuelve `resolveCell(row,col)` para cada celda del rango, en orden de
 * filas y luego columnas (como Excel). No filtra nulos -- lo hace el caller
 * según la función (SUM/AVERAGE ignoran vacíos, otras no aplican a rangos). */
function expandRange(
  from: { row: number; col: number },
  to: { row: number; col: number },
  resolveCell: (row: number, col: number) => number | null,
): (number | null)[] {
  const values: (number | null)[] = [];
  const rowStart = Math.min(from.row, to.row);
  const rowEnd = Math.max(from.row, to.row);
  const colStart = Math.min(from.col, to.col);
  const colEnd = Math.max(from.col, to.col);
  for (let r = rowStart; r <= rowEnd; r += 1) {
    for (let c = colStart; c <= colEnd; c += 1) {
      values.push(resolveCell(r, c));
    }
  }
  return values;
}

function evalArgAsNumbers(
  node: Node,
  resolveCell: (row: number, col: number) => number | null,
): (number | null)[] {
  if (node.kind === 'range') return expandRange(node.from, node.to, resolveCell);
  return [evalNode(node, resolveCell)];
}

function requireNumber(value: number | null): number {
  if (value === null) throw new FormulaError('#VALUE!');
  return value;
}

function evalNode(node: Node, resolveCell: (row: number, col: number) => number | null): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'ref':
      return requireNumber(resolveCell(node.row, node.col));
    case 'range': {
      // Un rango solo, fuera de una función (p.ej. "=A1:A3"), no tiene un
      // único valor -- Excel también lo rechaza así en ese contexto.
      throw new FormulaError('#VALUE!');
    }
    case 'neg':
      return -evalNode(node.arg, resolveCell);
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
      const flatArgs = node.args.flatMap((arg) => evalArgAsNumbers(arg, resolveCell));
      const numericArgs = flatArgs.filter((v): v is number => v !== null);
      switch (name) {
        case 'SUM':
          return numericArgs.reduce((a, b) => a + b, 0);
        case 'AVERAGE':
          if (numericArgs.length === 0) throw new FormulaError('#DIV/0!');
          return numericArgs.reduce((a, b) => a + b, 0) / numericArgs.length;
        case 'COUNT':
          return numericArgs.length;
        case 'MAX':
          if (numericArgs.length === 0) return 0;
          return Math.max(...numericArgs);
        case 'MIN':
          if (numericArgs.length === 0) return 0;
          return Math.min(...numericArgs);
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
        default:
          throw new FormulaError('#NAME?');
      }
    }
    default:
      throw new FormulaError('#ERROR!');
  }
}

/** Evalúa UNA fórmula ya resuelta contra `resolveCell` (que el caller arma
 * con memo + detección de ciclos, ver `computeTableFormulas`). No lanza --
 * cualquier error de parseo/evaluación se captura y se devuelve como celda
 * de error, igual que Excel nunca "rompe" la hoja completa por una celda. */
export function evaluateFormula(
  formulaText: string,
  resolveCell: (row: number, col: number) => number | null,
): FormulaCellResult {
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

/** Quita las etiquetas HTML de una celda para leer su texto plano (mismo
 * criterio ya usado en TableBlock.tsx::autoFitColumns para medir texto).
 * Exportada -- TableBlock.tsx la reusa para detectar celdas numéricas SIN
 * fórmula que de todos modos tengan un formato de número (%, decimales)
 * aplicado, en vez de duplicar esta lógica. */
export function stripCellHtml(html: string): string {
  return String(html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Interpreta el texto plano de una celda NO-fórmula como número para que
 * otras fórmulas puedan sumarla/promediarla (acepta "1234", "12.5", "-3",
 * y "1.234,56"/"1,234.56" con separador de miles). null si no es numérico
 * (texto normal, celda vacía) -- Excel simplemente ignora esas en SUM.
 * Exportada por el mismo motivo que `stripCellHtml`. */
export function parseCellNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(/\s/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Recorre TODA la tabla una vez y calcula el valor en reposo de cada celda
 * que sea fórmula. Memoiza por celda y detecta referencias circulares (una
 * fórmula que --directa o indirectamente-- termina dependiendo de sí misma)
 * devolviendo #CIRC! en vez de colgar el navegador.
 */
export function computeTableFormulas(rows: string[][]): (FormulaCellResult | null)[][] {
  const results: (FormulaCellResult | null)[][] = rows.map((row) => row.map(() => null));
  const plainCache = new Map<string, string>();
  const numericCache = new Map<string, number | null>();
  const resolving = new Set<string>();

  const keyOf = (row: number, col: number) => `${row}-${col}`;

  const getPlainText = (row: number, col: number): string => {
    const key = keyOf(row, col);
    const cached = plainCache.get(key);
    if (cached !== undefined) return cached;
    const raw = rows[row]?.[col] ?? '';
    const plain = stripCellHtml(raw);
    plainCache.set(key, plain);
    return plain;
  };

  const resolveCell = (row: number, col: number): number | null => {
    if (row < 0 || col < 0 || row >= rows.length || col >= (rows[row]?.length ?? 0)) return null;
    const key = keyOf(row, col);
    if (numericCache.has(key)) return numericCache.get(key)!;
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
    for (let c = 0; c < (rows[r]?.length ?? 0); c += 1) {
      if (results[r][c]) continue; // ya resuelta como dependencia de otra
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

export interface EffectiveCellValue {
  /** Número resuelto: el resultado de la fórmula, o el número que se lee
   * del texto plano si no es fórmula. null si es texto no numérico/vacío. */
  numeric: number | null;
  /** Texto a mostrar en reposo: el resultado/error de la fórmula, o el
   * texto plano de la celda si no es fórmula. Lo usa el formato condicional
   * para condiciones de texto ("El texto contiene"). */
  text: string;
}

/** Valor efectivo de cada celda -- une fórmulas (ya resueltas por
 * `computeTableFormulas`) y celdas normales bajo un mismo formato, para que
 * el formato condicional (lib/tableConditionalFormat.ts) no tenga que saber
 * nada sobre fórmulas ni sobre el HTML de las celdas. */
export function getEffectiveCellValues(
  rows: string[][],
  formulaResults: (FormulaCellResult | null)[][],
): EffectiveCellValue[][] {
  return rows.map((row, r) => row.map((cell, c) => {
    const formulaResult = formulaResults[r]?.[c];
    if (formulaResult) return { numeric: formulaResult.numericValue, text: formulaResult.display };
    const plain = stripCellHtml(cell);
    return { numeric: parseCellNumber(plain), text: plain };
  }));
}
