'use strict';
/**
 * Export XLSX (nuevo, no existía) -- alcance explícito confirmado con el
 * usuario: exporta ÚNICAMENTE los bloques `table` ya insertados en el
 * informe (las mismas tablas que `reportDocxBuilder.js` ya convierte en
 * tablas reales de Word), una hoja real de Excel por tabla, más una hoja
 * "Índice" con hipervínculos internos reales a cada una -- el equivalente
 * en Excel del campo TOC real que ya tiene el export Word. No incluye KPIs,
 * sensores, gráficos ni un volcado de telemetría cruda: eso quedó fuera de
 * alcance a propósito (ver plan aprobado, Fase C).
 */
const ExcelJS = require('exceljs');
const { cssColorToHex, parseHtmlToRuns, plainTextIfNumeric } = require('./reportSharedHelpers');

const EXCEL_FORBIDDEN_CHARS = /[:\\/?*[\]]/g;
const EXCEL_MAX_SHEET_NAME = 31;

/** Nombre de hoja válido para Excel (máx 31 caracteres, sin :\/?*[]),
 * de-duplicado con un sufijo numérico si ya se usó -- Excel rechaza el
 * archivo entero si dos hojas terminan con el mismo nombre (comparación
 * insensible a mayúsculas). */
function sanitizeSheetName(rawName, usedNamesLower) {
  // Excel también prohíbe que el nombre EMPIECE o TERMINE con comilla
  // simple (sí puede tener una en el medio) -- se recorta con el mismo
  // criterio que el resto de caracteres prohibidos.
  const cleaned = String(rawName || 'Tabla')
    .replace(EXCEL_FORBIDDEN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '');
  const base = (cleaned || 'Tabla').slice(0, EXCEL_MAX_SHEET_NAME);
  let candidate = base;
  let suffixIndex = 2;
  while (usedNamesLower.has(candidate.toLowerCase())) {
    const suffix = ` (${suffixIndex})`;
    candidate = base.slice(0, Math.max(1, EXCEL_MAX_SHEET_NAME - suffix.length)) + suffix;
    suffixIndex += 1;
  }
  usedNamesLower.add(candidate.toLowerCase());
  return candidate;
}

function toArgb(hex6) {
  return `FF${cssColorToHex(hex6, hex6)}`;
}

/** Resuelve el `cell.value` (string plano, número real, hipervínculo de
 * celda, o rich text con estilo por-run) + un `numFmt` opcional, a partir
 * del HTML crudo de una celda de tabla (mismo contenido que ya interpreta
 * `htmlCellToRuns` en el builder DOCX). Prioridad: (1) número real puro ->
 * celda numérica (permite sumar/graficar en Excel); (2) un único run que es
 * TODO el contenido y es un link puro -> hipervínculo real de celda; (3) un
 * único run de texto plano sin estilo -> string simple; (4) cualquier otra
 * mezcla (negrita/cursiva/subrayado/link parcial) -> rich text con estilo
 * por run. Un hipervínculo REAL de celda (3) solo es posible cuando el link
 * ocupa la celda entera -- ExcelJS no soporta un hipervínculo aplicado a un
 * run individual dentro de un rich text mixto (limitación de la librería,
 * no del formato XLSX); en ese caso el run igual queda estilizado como
 * enlace (azul/subrayado) pero sin navegación real. */
function buildCellValue(html, isHeaderCell) {
  if (!isHeaderCell) {
    const numeric = plainTextIfNumeric(html);
    if (numeric) return { value: numeric.value, numFmt: numeric.isPercent ? '0.00%' : undefined };
  }
  const runs = parseHtmlToRuns(html).filter((r) => !r.break);
  if (runs.length === 0) return { value: '' };
  if (runs.length === 1 && runs[0].href) {
    return { value: { text: runs[0].text, hyperlink: runs[0].href } };
  }
  if (runs.length === 1 && !runs[0].bold && !runs[0].italics && !runs[0].underline) {
    return { value: runs[0].text };
  }
  return {
    value: {
      richText: runs.map((r) => ({
        text: r.text,
        font: {
          bold: r.bold || undefined,
          italic: r.italics || undefined,
          underline: (r.underline || !!r.href) || undefined,
          color: r.href ? { argb: 'FF2563EB' } : undefined,
        },
      })),
    },
  };
}

function buildTableSheet(sheet, el) {
  const props = el.props || {};
  const rows = Array.isArray(props.rows) ? props.rows : [];
  if (rows.length === 0) {
    sheet.addRow(['(tabla sin datos)']);
    return;
  }
  const hasHeader = props.hasHeader !== false;
  const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const providedWidths = Array.isArray(props.colWidths) ? props.colWidths : [];
  // px -> "ancho de columna Excel" (unidad = ancho aprox. de un carácter en
  // la fuente por defecto, ~7px) -- heurística suficiente, no exacta (Excel
  // no tiene una conversión 1:1 real de píxeles).
  sheet.columns = Array.from({ length: colCount }, (_, i) => ({
    width: providedWidths[i] ? Math.max(8, Math.round(providedWidths[i] / 7)) : 22,
  }));
  const headerFillArgb = toArgb(props.headerBg || '#F8FAFC');
  const headerColorArgb = toArgb(props.headerTextColor || '#1e293b');
  const bandColorArgb = toArgb(props.bandColor || '#F1F5F9');
  const borderColorArgb = toArgb(props.borderColor || '#E2E8F0');
  const hasBorder = props.borderStyle !== 'none';
  const borderSide = hasBorder ? { style: 'thin', color: { argb: borderColorArgb } } : undefined;
  const cellAlign = props.cellAlign === 'center' ? 'center' : props.cellAlign === 'right' ? 'right' : 'left';

  rows.forEach((row, ri) => {
    const isHeaderRow = ri === 0 && hasHeader;
    const isBanded = !isHeaderRow && props.bandedRows && ri % 2 === (hasHeader ? 1 : 0);
    const cellsThisRow = Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      return buildCellValue(String(raw == null ? '' : raw), isHeaderRow);
    });
    const excelRow = sheet.addRow(cellsThisRow.map((c) => c.value));
    cellsThisRow.forEach((built, ci) => {
      const cell = excelRow.getCell(ci + 1);
      if (borderSide) cell.border = { top: borderSide, bottom: borderSide, left: borderSide, right: borderSide };
      if (built.numFmt) cell.numFmt = built.numFmt;
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: cellAlign };
      if (isHeaderRow) {
        cell.font = { bold: props.headerBold !== false, color: { argb: headerColorArgb } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFillArgb } };
      } else if (isBanded) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandColorArgb } };
      }
    });
  });
  if (hasHeader) {
    sheet.getRow(1).height = 22;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
}

/** `doc`: ReportDocument JSON. Devuelve un `ExcelJS.Workbook` listo para
 * `workbook.xlsx.writeBuffer()`/`writeFile()`. */
function buildReportXlsx(doc) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Beemetry Mining Platform';
  workbook.created = new Date();
  workbook.title = (doc.meta && doc.meta.title) || 'Informe Técnico';

  const tables = [];
  (doc.pages || []).forEach((page) => {
    (page.elements || []).forEach((el) => {
      if (el.type === 'table') tables.push({ el, pageNumber: page.page_number });
    });
  });

  // Índice PRIMERO (posición 0) -- mismo criterio que el TOC de Word: una
  // sola fuente de verdad al abrir el archivo, con hipervínculos REALES
  // (`hyperlink: "#'Hoja'!A1"`, sintaxis de referencia interna de Excel) a
  // cada hoja, no una lista estática de texto.
  const indexSheet = workbook.addWorksheet('Índice');
  indexSheet.columns = [{ header: '#', width: 6 }, { header: 'Tabla', width: 55 }, { header: 'Página', width: 10 }];
  const headerRow = indexSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF1E293B' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  });
  indexSheet.views = [{ state: 'frozen', ySplit: 1 }];

  const usedNamesLower = new Set(['índice', 'indice']);
  if (tables.length === 0) {
    indexSheet.addRow(['—', 'Este informe no tiene tablas para exportar.', '—']);
  }
  tables.forEach(({ el, pageNumber }, i) => {
    const props = el.props || {};
    const label = String(props.title || props.caption || `Tabla ${i + 1}`).trim() || `Tabla ${i + 1}`;
    const sheetName = sanitizeSheetName(label, usedNamesLower);
    const sheet = workbook.addWorksheet(sheetName);
    buildTableSheet(sheet, el);

    const row = indexSheet.addRow([i + 1, null, pageNumber]);
    const linkCell = row.getCell(2);
    // Comillas simples DENTRO del nombre de hoja se escapan duplicándolas
    // (sintaxis de referencia interna de Excel, igual que ='Hoja''1'!A1).
    linkCell.value = { text: label, hyperlink: `#'${sheetName.replace(/'/g, "''")}'!A1` };
    linkCell.font = { color: { argb: 'FF2563EB' }, underline: true };
  });

  return workbook;
}

module.exports = { buildReportXlsx, sanitizeSheetName };
