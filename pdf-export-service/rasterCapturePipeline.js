'use strict';
/**
 * Piezas del pipeline de captura raster por-elemento compartidas entre
 * `/render-docx` y `/render-pptx` (desde que este último también se arma
 * nativamente desde `window.__REPORT_DOCUMENT__`, ver reportPptxBuilder.js).
 *
 * Solo lo que es puro o depende ÚNICAMENTE de un `page`/buffer ya dado vive
 * acá -- la orquestación real (abrir N Chromium dedicados, particionar por
 * rango de página, correr `captureOnPage` en paralelo) se queda en
 * `server.js` como `captureRasterElements()`, porque esa orquestación usa
 * MUCHAS otras piezas ya compartidas de `server.js` (`getBrowser`,
 * `openExportWorkerPage`, `withPageRangeParam`, `attachBrowserDiagnostics`,
 * `withTimeout`, `runInBatches`, `saveJobProgress`, `RENDER_TIMEOUT_MS`) que
 * YA sirven a `/render`, `/render-pdf` y `/render-pptx` por igual -- mover
 * ese bloque entero acá hubiera arrastrado esas dependencias sin necesidad,
 * a cambio de nada (la reutilización real que pedía el plan aprobado ya
 * queda cubierta con `captureRasterElements` como única función, llamada
 * por ambos endpoints).
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const EXPORT_DATA_ROOT = process.env.EXPORT_DATA_ROOT || '/data/export';

// Los únicos 5 tipos de bloque sin representación nativa reproducible en
// ningún formato de export (DOCX/PPTX): son intrínsecamente lienzo/canvas
// (gráficos, superficie 3D, filtros/recortes de imagen ya horneados en
// pantalla) -- todo lo demás (texto, tabla, kpi, sensor, seismic-report,
// toc, header, footer, video-poster) se arma como contenido NATIVO
// directamente desde el JSON, sin pasar por Puppeteer.
// `shape` (ShapeBlock.tsx -- rectángulo/círculo/diamante/estrella/línea,
// usado para diagramas de bloque) se agregó acá 2026-09-23: no tenía NINGÚN
// `case` en `reportDocxBuilder.js`/`reportPptxBuilder.js` (caía siempre al
// `default: break;`, se perdía en silencio) -- `docx`/`pptxgenjs` no ofrecen
// una API de formas vectoriales lo bastante fiel al abanico real de
// `shapeType` del editor, así que se captura como PNG igual que un gráfico
// (mismo criterio, `ReadOnlyViewer.tsx` ya lo renderiza en pantalla/PDF sin
// problema -- lo único que faltaba era incluirlo en este set compartido).
// `wordart` (texto decorativo con relleno degradado/contorno/sombra, nuevo
// 2026-09-23) mismo criterio exacto: `docx`/`pptxgenjs` no exponen relleno
// degradado ni contorno de texto a nivel de `TextRun`, así que se captura
// como PNG en vez de intentar una aproximación con formato de carácter.
const RASTER_ELEMENT_TYPES = new Set(['chart', 'sensor_multi_chart', 'cover', 'image', 'shape', 'wordart']);

// ── Checkpoints reanudables de captura raster ───────────────────────────────
// Un export de miles de páginas puede tardar horas; sin esto, cualquier
// caída (reinicio del contenedor, del host, un crash de Chromium) pierde
// TODO el progreso -- reproducido en vivo: 2+ horas de trabajo perdidas por
// un reinicio de laptop a mitad de un export de 2104 páginas. La clave es
// el HASH DEL CONTENIDO del informe (no el job_id): el backend C++ nunca
// reintenta un job con el mismo id (cada intento del usuario genera uno
// nuevo), así que indexar por contenido es lo único que permite que un
// reintento futuro (cualquier job_id, incluso de OTRO formato) encuentre y
// reuse el progreso de un intento previo sobre el MISMO documento.
//
// Compartido entre DOCX y PPTX A PROPÓSITO (un solo directorio, no uno por
// formato): la captura de un `chart`/`image`/`cover` es el MISMO PNG sin
// importar si el destino final es un .docx o un .pptx (mismo elemento,
// mismo viewport, mismo `[data-element-id]`) -- exportar primero a DOCX y
// después a PPTX del mismo informe reusa las capturas ya hechas en vez de
// volver a tocar Chromium.
const RASTER_CHECKPOINT_ROOT = path.join(EXPORT_DATA_ROOT, 'raster_checkpoints');

function computeContentHash(doc) {
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 16);
}

function checkpointDir(hash) {
  return path.join(RASTER_CHECKPOINT_ROOT, hash);
}

/** Lee el checkpoint existente para `hash` (si hay) -- devuelve los PNG ya
 * capturados en runs anteriores, listos para precargar en `rasterAssets`/
 * `imageAssets` sin volver a tocar el navegador. */
async function loadCheckpoint(hash) {
  const dir = checkpointDir(hash);
  const result = { rasterAssets: new Map(), imageAssets: new Map() };
  try {
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    for (const entry of manifest.captured || []) {
      try {
        const png = await fs.readFile(path.join(dir, `${entry.id}.png`));
        if (entry.type === 'image') result.imageAssets.set(entry.id, png);
        else result.rasterAssets.set(entry.id, png);
      } catch {
        // PNG individual corrupto/faltante (caída a mitad de escritura) --
        // se descarta esa entrada, se vuelve a capturar en este run.
      }
    }
  } catch {
    // Sin checkpoint previo -- primer intento sobre este contenido, normal.
  }
  return result;
}

/** Escribe UN png de captura al checkpoint inmediatamente (no solo al Map en
 * memoria) -- si el proceso muere un instante después, este archivo ya
 * sobrevive en disco. */
async function saveCheckpointPng(hash, elementId, buffer) {
  const dir = checkpointDir(hash);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${elementId}.png`), buffer);
}

/** Reescribe `manifest.json` de forma atómica (archivo temporal + rename) --
 * una caída a mitad de esta escritura nunca deja un manifest corrupto: o
 * queda el anterior completo, o queda el nuevo completo. */
async function saveManifest(hash, capturedEntries, totalTargets) {
  const dir = checkpointDir(hash);
  await fs.mkdir(dir, { recursive: true });
  const manifest = { captured: capturedEntries, totalTargets, updatedAt: new Date().toISOString() };
  const tmpPath = path.join(dir, 'manifest.json.tmp');
  const finalPath = path.join(dir, 'manifest.json');
  await fs.writeFile(tmpPath, JSON.stringify(manifest));
  await fs.rename(tmpPath, finalPath);
}

/** Borra el checkpoint completo -- se llama solo tras escribir el archivo
 * final (.docx/.pptx) con éxito, ya no hace falta conservar el progreso
 * intermedio. */
async function clearCheckpoint(hash) {
  await fs.rm(checkpointDir(hash), { recursive: true, force: true }).catch(() => {});
}

// ── Readiness por-elemento (usado por cada worker antes de screenshot) ─────
// BUG REAL encontrado en auditoría 2026-09-22 (reporte de export DOCX roto
// en informes grandes/virtualizados): esta función NO esperaba a que las
// `<img>` del elemento terminaran de cargar -- solo widgets/gráficos
// (`data-export-widget`/`data-export-chart`). El contrato documentado en
// `captureRasterAssets.ts::waitForRenderReady` (pipeline cliente, "MISMO
// CONTRATO DOM" que este sidecar) SÍ incluye ese wait, y `waitForReportRender`
// de este mismo archivo (server.js) también lo hace -- pero ese solo corre
// UNA VEZ al abrir cada worker page, sobre lo que esté montado en ESE
// instante. En un documento virtualizado, `setExportActivePage` monta
// páginas/imágenes NUEVAS después de esa primera espera (cada `chart`/
// `sensor_multi_chart`/`cover`/`image` target activa su propia página vía
// el bucle de `captureOnPage` en server.js) sin que nada vuelva a esperar
// esas `<img>` nuevas -- la única espera restante era esta función, que
// nunca las miraba. Resultado reproducible: `handle.screenshot()` corría
// contra un `<img>` todavía sin decodificar (src en vuelo o recién
// asignado), capturando un PNG en blanco/roto para el bloque `image` (o
// para cualquier imagen interna de otro tipo de bloque) en el .docx/.pptx
// final -- footgun clásico de virtualización: nunca se reproduce en un
// documento chico de una sola página (todo ya está montado antes de la
// primera captura), solo en informes grandes.
async function waitForElementReady(page, elementId, timeoutMs) {
  await page.waitForFunction((id) => {
    const element = document.querySelector(`[data-element-id="${id}"]`);
    if (!element) return false;
    const pendingWidgets = element.querySelectorAll('[data-export-widget][data-export-ready="false"]');
    const pendingCharts = element.querySelectorAll('[data-export-chart="true"][data-export-ready="false"]');
    if (pendingWidgets.length > 0 || pendingCharts.length > 0) return false;
    const images = element.querySelectorAll('img');
    for (let i = 0; i < images.length; i += 1) {
      if (!images[i].complete) return false;
    }
    return true;
  }, { timeout: timeoutMs }, elementId);
}

async function elementReadinessSnapshot(page, pageNumber, elementId) {
  return page.evaluate((n, id) => {
    const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
    const element = document.querySelector(`[data-element-id="${id}"]`);
    const describe = (node) => Array.from(node ? node.querySelectorAll(
      '[data-export-widget], [data-export-chart="true"]',
    ) : []).map((item) => ({
      tag: item.tagName,
      widget: item.getAttribute('data-export-widget'),
      chart: item.getAttribute('data-export-chart'),
      ready: item.getAttribute('data-export-ready'),
      error: item.getAttribute('data-export-error'),
      width: Math.round(item.getBoundingClientRect().width),
      height: Math.round(item.getBoundingClientRect().height),
    }));
    const images = element ? Array.from(element.querySelectorAll('img')) : [];
    return {
      wrapperExists: Boolean(wrapper),
      elementExists: Boolean(element),
      states: describe(element),
      pendingImages: images.filter((img) => !img.complete).map((img) => ({
        src: (img.getAttribute('src') || '').slice(0, 80),
        naturalWidth: img.naturalWidth,
      })),
      totalImages: images.length,
    };
  }, pageNumber, elementId);
}

async function waitForMountedPage(page, pageNumber, timeoutMs) {
  await page.waitForFunction((n) => {
    const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
    return Boolean(wrapper && wrapper.querySelector('[data-element-id]'));
  }, { timeout: timeoutMs }, pageNumber);
}

module.exports = {
  RASTER_ELEMENT_TYPES,
  RASTER_CHECKPOINT_ROOT,
  computeContentHash,
  loadCheckpoint,
  saveCheckpointPng,
  saveManifest,
  clearCheckpoint,
  waitForElementReady,
  elementReadinessSnapshot,
  waitForMountedPage,
};
