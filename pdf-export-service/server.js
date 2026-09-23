// ─────────────────────────────────────────────────────────────────────────
// pdf-export-service — sidecar de export PDF server-side (ADR-016).
//
// Por qué un sidecar Node/Puppeteer y no un renderer nuevo en C++:
// el documento del informe es un modelo de bloques (Konva/Tiptap) que el
// frontend YA sabe renderizar fielmente (ReadOnlyViewer.jsx, con su propio
// CSS @media print). Reimplementar ese layout en C++ duplicaría la lógica
// de renderizado y garantizaría divergencias visuales con el editor. En su
// lugar, Chromium headless navega a la MISMA página que ve el usuario
// (frontend/print-report.html) y la captura como PDF — cero lógica de
// renderizado duplicada.
//
// ADR-080: además de renderizar, este servicio post-procesa el PDF con
// marca de agua (pdf-lib, dibuja texto) y lo cifra con contraseña real de
// PDF (qpdf, ISO 32000/AES-256) — pdf-lib no soporta cifrado, por eso qpdf.
//
// POST /render  { url: string, watermark?: {text?, tenant?, user?, date?} | false }
//   → PDF cifrado (application/pdf), header X-Pdf-User-Password con la
//     contraseña generada para ESTA descarga (no se persiste en ningún lado).
//   `watermark: false` explícito (ADR-204, perfil avanzado ya verificado
//   server-side) es la ÚNICA forma de saltear el sello; cualquier otro valor
//   (objeto, undefined, ausente) sigue dibujando el default de siempre.
// GET  /health  → 200 si Chromium está listo
// ─────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const express = require('express');
const puppeteer = require('puppeteer');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const PptxGenJS = require('pptxgenjs');
const { buildReportDocx } = require('./reportDocxBuilder');
const { buildReportPptx } = require('./reportPptxBuilder');
const { buildReportXlsx } = require('./reportXlsxBuilder');
const { addPdfOutline, addTocLinkAnnotations } = require('./pdfPostProcess');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 4000;
// Lista blanca de hosts permitidos para navegar (evita que este sidecar se
// use como proxy SSRF genérico): solo el frontend interno del propio stack.
const ALLOWED_HOST = process.env.PDF_RENDER_ALLOWED_HOST || 'frontend';
const RENDER_TIMEOUT_MS = parseInt(process.env.PDF_RENDER_TIMEOUT_MS || '90000', 10);
// Techo por PÁGINA/DIAPOSITIVA para "todos sus widgets están listos"
// (renderReportPages para PDF, /render-pptx para PPTX) -- NUNCA
// RENDER_TIMEOUT_MS (10 min): eso es razonable como techo GLOBAL de una
// única espera de arranque, pero esperar hasta 10 min por CADA una de
// 2000+ páginas es justo el patrón que produjo atascos de más de media
// hora sin ningún error (reproducido en vivo: /render tardó 31+ min en un
// informe de 144 páginas antes de este fix, /render-pptx tuvo el mismo
// problema -- ver su historial). Igual que DOCX_ELEMENT_READY_TIMEOUT_MS en
// /render-docx: fallar rápido y capturar la página tal como esté es
// preferible a bloquear todo el export por un solo gráfico lento.
const PAGE_WIDGET_READY_TIMEOUT_MS = 15000;
// Export PPTX/MP4 (presentación): directorio compartido con el backend C++
// (mismo volumen Docker que BEEMETRY_EXPORT_DATA_ROOT) donde caen los
// archivos generados — el backend solo persiste la ruta (report_export_job.storage_uri)
// y sirve el archivo desde ahí en /export/jobs/{jobId}/download.
const EXPORT_DATA_ROOT = process.env.EXPORT_DATA_ROOT || '/data/export';
// Contraseña de PROPIETARIO del PDF: fija el nivel de permisos (imprimir sí,
// copiar/editar no) y nunca se entrega al usuario final. Sin ella nadie
// puede levantar esas restricciones, ni siquiera con la contraseña de
// usuario. Debe configurarse en despliegues reales (docker-compose.prod.yml);
// el default solo aplica en desarrollo local.
// Auditoría de seguridad 2026-08-02: el default está escrito en este mismo
// repositorio, así que un PDF "protegido" con él no tiene ninguna protección —
// cualquiera que lea el repo conoce la contraseña de propietario y puede
// levantar las restricciones de copia/edición de todo informe exportado. Un
// comentario diciendo "solo desarrollo" no impide que un despliegue real
// arranque sin la variable y genere PDFs desprotegidos sin señal alguna. Ahora
// usar el default exige autorización explícita (PDF_ALLOW_DEV_SECRETS=true);
// en cualquier otro caso el servicio no arranca.
const DEV_OWNER_PASSWORD_SECRET = 'dev-only-owner-secret-change-me';
const ALLOW_DEV_SECRETS = /^(true|1|yes)$/i.test(process.env.PDF_ALLOW_DEV_SECRETS || '');
const OWNER_PASSWORD_SECRET = process.env.PDF_OWNER_PASSWORD_SECRET || DEV_OWNER_PASSWORD_SECRET;
if (OWNER_PASSWORD_SECRET === DEV_OWNER_PASSWORD_SECRET) {
  if (!ALLOW_DEV_SECRETS) {
    console.error(
      '[PDF_EXPORT] FATAL: PDF_OWNER_PASSWORD_SECRET no configurado. El valor por ' +
      'defecto es publico (esta en el repositorio) y dejaria todos los PDF ' +
      'exportados sin proteccion real. Defina la variable con un secreto ' +
      'aleatorio, o PDF_ALLOW_DEV_SECRETS=true si esto es desarrollo local.'
    );
    process.exit(1);
  }
  console.warn(
    '[PDF_EXPORT] AVISO: usando secreto de propietario de DESARROLLO. Los PDF ' +
    'generados no estan realmente protegidos. Nunca usar asi en produccion.'
  );
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      // Puppeteer's OWN CDP protocol timeout (default 180000ms) is separate
      // from RENDER_TIMEOUT_MS below -- that constant only bounds page.goto()
      // and waitForFunction() calls we pass options to explicitly; internal
      // CDP round-trips (e.g. Runtime.callFunctionOn, used by page.evaluate/
      // waitForFunction polling under the hood) still time out at the
      // library default regardless. Reproduced live on a 378-page/1120-chart
      // export: "ProtocolError: Runtime.callFunctionOn timed out" fired well
      // before RENDER_TIMEOUT_MS elapsed. Matching it here closes that gap.
      protocolTimeout: RENDER_TIMEOUT_MS,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        // Se intentó forzar WebGL por software (--use-gl=angle
        // --use-angle=swiftshader --ignore-gpu-blocklist --enable-webgl) para
        // que el tipo "Superficie (3D)" (Three.js) renderizara en el PDF --
        // revertido: en esta imagen/entorno Chromium crea el contexto, lo
        // pierde de inmediato ("Web page caused context loss and was
        // blocked") y Three.js termina lanzando un error SIN capturar que
        // desmonta TODO el árbol de React (confirmado con page.on('pageerror')
        // -- ver abajo), rompiendo el export completo del informe, no solo ese
        // gráfico. Sin estos flags el widget "Superficie" queda en blanco
        // (limitación conocida, ver SensorMultiChartWidget3DErrorBoundary) pero
        // el resto de las 19 páginas/tipos exportan con fidelidad completa --
        // ese trade-off es preferible a que un solo tipo de gráfico tumbe el
        // PDF entero.
      ],
    });
  }
  return browserPromise;
}

/** Espera el contenido asincrono real del informe, no solo el commit de
 * React. Los widgets de telemetria publican data-export-ready y cada canvas
 * ECharts confirma su primer paint; tambien se esperan fuentes e imagenes. */
async function waitForReportRender(page) {
  await page.waitForFunction('window.__PDF_READY__ === true', { timeout: RENDER_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const pendingWidgets = document.querySelectorAll('[data-export-widget][data-export-ready="false"]');
    const pendingCharts = document.querySelectorAll('[data-export-chart="true"][data-export-ready="false"]');
    return pendingWidgets.length === 0 && pendingCharts.length === 0;
  }, { timeout: RENDER_TIMEOUT_MS });
  const widgetErrors = await page.$$eval('[data-export-widget][data-export-error]', (widgets) =>
    widgets.map((widget) => widget.getAttribute('data-export-error')).filter(Boolean));
  if (widgetErrors.length) {
    throw new Error(`widget_render_failed:${widgetErrors.slice(0, 3).join(' | ')}`);
  }
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** `true` si el propio frontend activó la virtualización de páginas para
 * este informe (ver EXPORT_VIRTUALIZATION_PAGE_THRESHOLD en
 * ReadOnlyViewer.tsx -- solo documentos grandes, `isPrint=true`). Cuando es
 * `false` (la inmensa mayoría de informes) todo el resto de estas funciones
 * es un no-op transparente: el documento entero ya está montado como
 * siempre, sin ningún cambio de comportamiento. */
async function isExportVirtualized(page) {
  return page.evaluate(() => window.__exportVirtualized__ === true);
}

/** Avanza la "página activa" del viewer virtualizado -- monta SOLO esa
 * página (± EXPORT_VIRTUALIZATION_WINDOW en ReadOnlyViewer.tsx) y desmonta
 * cualquier otra, liberando sus widgets de sensor (ECharts/Leaflet/WebGL).
 * No-op si el documento no está virtualizado. */
async function setExportActivePage(page, pageNumber) {
  await page.evaluate((n) => {
    if (typeof window.__setExportActivePage__ === 'function') window.__setExportActivePage__(n);
  }, pageNumber);
}

/** Igual que `waitForReportRender`, pero acotada a UNA sola página (1-based,
 * mismo orden que `.ro-page-wrapper`) -- se usa junto con
 * `setExportActivePage` para no tener que esperar (ni montar) el resto del
 * documento en informes grandes. Reproduce en miniatura cada paso de
 * `waitForReportRender`: widgets listos, sin error, fuentes e imágenes de
 * ESA página cargadas. */
async function waitForPageWidgetsReady(page, pageNumber, timeoutMs) {
  // Busca el wrapper por `data-page-number` (ver ReadOnlyViewer.tsx), NUNCA
  // por índice de DOM (`querySelectorAll(...)[n-1]`) -- ese índice solo
  // coincide con el número de página real si `doc.pages` es estrictamente
  // contiguo (1..N sin huecos ni duplicados), algo que no está garantizado
  // por el generador de reportes. Un desfase ahí hacía que esta función
  // esperara (y confirmara "listo") sobre la página VECINA, no la que
  // `setExportActivePage` acababa de activar -- la captura posterior fallaba
  // en silencio (`page.$` no encontraba el nodo real, ver diagnóstico
  // `handle nulo` en /render-docx) sin que esta función reportara error.
  await page.waitForFunction((n) => {
    const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
    if (!wrapper) return false;
    const pendingWidgets = wrapper.querySelectorAll('[data-export-widget][data-export-ready="false"]');
    const pendingCharts = wrapper.querySelectorAll('[data-export-chart="true"][data-export-ready="false"]');
    return pendingWidgets.length === 0 && pendingCharts.length === 0;
  }, { timeout: timeoutMs }, pageNumber);
  const widgetErrors = await page.evaluate((n) => {
    const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
    if (!wrapper) return [];
    return Array.from(wrapper.querySelectorAll('[data-export-widget][data-export-error]'))
      .map((w) => w.getAttribute('data-export-error')).filter(Boolean);
  }, pageNumber);
  if (widgetErrors.length) {
    throw new Error(`widget_render_failed:page${pageNumber}:${widgetErrors.slice(0, 3).join(' | ')}`);
  }
  await page.evaluate(async (n) => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
    const imgs = wrapper ? Array.from(wrapper.querySelectorAll('img')) : [];
    await Promise.all(imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, pageNumber);
}

/** Lee el tamaño final de cada lienzo. No se delega en @page nombradas:
 * Chromium 127 las ignora al imprimir y cae silenciosamente a Letter. */
async function reportPageSizes(page) {
  const sizes = await page.$$eval('.ro-page-canvas', (canvases) => canvases.map((canvas) => ({
    width: canvas.getBoundingClientRect().width,
    height: canvas.getBoundingClientRect().height,
  })));
  if (!sizes.length) throw new Error('no_pages_to_render');
  return sizes;
}

/** Número de página REAL (`page.page_number` del documento, vía
 * `data-page-number` en `.ro-page-wrapper`) de cada `.ro-page-canvas`, en el
 * mismo orden/índice que devuelve `reportPageSizes` (un wrapper por canvas,
 * mismo recorrido del DOM). NUNCA asumir que el número de página es
 * `índice + 1`: la numeración de `doc.pages` no está garantizada contigua
 * (páginas borradas/reordenadas pueden dejar huecos), y activar la página
 * virtualizada equivocada hace que la captura de esa hoja falle en silencio
 * (`page.$` no encuentra el nodo real -- ver diagnóstico `handle nulo` en
 * `/render-docx`). */
async function reportPageNumbers(page) {
  return page.$$eval('.ro-page-wrapper', (wrappers) => wrappers.map((w) => Number(w.getAttribute('data-page-number'))));
}

/** Abre y prepara una página de export nueva: mismos pasos que el caller de
 * `/render` usaba inline (media type, viewport, listener de errores no
 * capturados, navegación, espera de render inicial) -- usada para la página
 * de DESCUBRIMIENTO de `/render` (la captura real recicla vía
 * `openExportWorkerPage`, ver `capturePdfPagesOnWorker`). */
async function openReportPage(browser, url) {
  const page = await browser.newPage();
  attachBrowserDiagnostics(page, 'PDF_EXPORT', null);
  await page.emulateMediaType('print');
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  // 2026-09-13 (SPEC-007 T15/O3, ver ADR-183/184): `waitUntil` bajado de
  // 'networkidle0' a 'domcontentloaded' -- 'networkidle0' exige CERO
  // peticiones de red en vuelo durante 500ms, una condición mucho más
  // estricta que lo que este código en realidad necesita, porque la línea
  // de abajo (`waitForReportRender`) YA hace la espera real y correcta
  // (widgets/gráficos listos, `window.__PDF_READY__`, fuentes, imágenes).
  // Instrumentado en vivo con timestamps `performance.now()` dentro de la
  // propia app (print-report/main.tsx) leídos vía `page.evaluate()`: la app
  // reporta estar lista (fetch + prefetch de telemetría + fuentes + 2
  // frames) en ~370ms desde que arranca su propio `useEffect`, pero
  // `goto()` con 'networkidle0' seguía bloqueado ~1.6s MÁS después de eso,
  // esperando que la red quedara en silencio absoluto -- tiempo puro
  // desperdiciado en cada apertura de página, multiplicado por cada
  // reciclaje de worker (`PAGES_PER_BROWSER_PAGE`, cada 40 hojas) en
  // documentos grandes. `domcontentloaded` resuelve mucho antes (scripts
  // tipo module ya arrancaron) y dejar que `waitForReportRender` sea la
  // única fuente de verdad de "listo" no reduce ninguna garantía de
  // fidelidad -- sigue esperando exactamente lo mismo que antes.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
  await waitForReportRender(page);
  return page;
}

// Cuántas hojas imprime CADA página de Puppeteer (`page.pdf()`) antes de
// cerrarse y abrir una fresca. Por qué: `page.pdf()` invoca internamente el
// subsistema de impresión de Chromium (compositor + generación de PDF), que
// no libera todos sus recursos entre llamadas -- en sesiones LARGAS (cientos
// de invocaciones seguidas sobre la MISMA página) ese remanente se acumula y
// termina crasheando el proceso de Chromium entero (`TargetCloseError:
// Target closed`), sin relación con memoria RSS disponible NI con ningún tipo
// de gráfico en particular: reproducido en vivo con un informe real de 378
// páginas / 1120 gráficos (falló) y descartado como problema de un tipo de
// gráfico específico con una prueba aislada de 12 páginas repitiendo SOLO el
// tipo "Superficie (3D)"/WebGL (exportó sin problema) -- así que el límite es
// de LONGITUD DE SESIÓN de Puppeteer, no de contenido. Reciclar la página
// cada 40 hojas (bien por debajo de donde se reprodujo el crash) resetea ese
// subsistema periódicamente sin perder el trabajo ya hecho: cada hoja ya
// renderizada queda fusionada en `merged` (pdf-lib) antes del reciclaje.
const PAGES_PER_BROWSER_PAGE = 40;

// ── Checkpoints reanudables + captura en paralelo de PDF ───────────────────
// Mismo patrón que el checkpoint por-elemento de DOCX/PPTX (ver
// rasterCapturePipeline.js) -- acá el checkpoint es por PÁGINA, guardando los
// bytes del PDF de UNA sola página (`page.pdf()`) tal cual salen de
// Chromium, sin fusionar todavía. La fusión final (pdf-lib, todas las
// páginas en orden) queda como el único paso estrictamente secuencial --
// copiar páginas a un PDFDocument es barato en CPU/memoria, no necesita
// paralelizarse.
//
// A diferencia de DOCX/PPTX, `/render` (más abajo) es SÍNCRONO -- no tiene
// `job_id` propio, el backend C++ lo llama y espera la respuesta HTTP
// directamente (sin polling de job), acotado por
// `BEEMETRY_PDF_EXPORT_TIMEOUT_MS` (~11 min) del lado del backend. El
// checkpoint sigue siendo útil (mismo hash de contenido, sobrevive un
// reinicio del sidecar a mitad de una llamada, y acelera un REINTENTO sobre
// el mismo documento), pero para un documento de miles de páginas el techo
// real para completar TODO en una sola llamada síncrona sigue siendo ese
// timeout HTTP -- convertir este endpoint a un patrón de job asíncrono
// (como ya tienen DOCX/PPTX) es un cambio de arquitectura en el backend
// C++, fuera del alcance de este sidecar.
const PDF_CHECKPOINT_ROOT = path.join(EXPORT_DATA_ROOT, 'pdf_checkpoints');
const PDF_CAPTURE_PARALLELISM = Math.max(1, parseInt(process.env.PDF_CAPTURE_PARALLELISM || '4', 10) || 1);

function pdfCheckpointDir(hash) {
  return path.join(PDF_CHECKPOINT_ROOT, hash);
}

async function loadPdfCheckpointManifest(hash) {
  const dir = pdfCheckpointDir(hash);
  try {
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    return new Set(manifest.captured || []);
  } catch {
    return new Set();
  }
}

/** Lee UNA página del checkpoint (bytes de PDF de una sola hoja) -- usado en
 * la fusión final, de a una por vez (mismo criterio que `loadCheckpoint` en
 * rasterCapturePipeline.js: nunca todas juntas en memoria). */
async function readPdfCheckpointPage(hash, pageNumber) {
  try {
    return await fs.readFile(path.join(pdfCheckpointDir(hash), `${pageNumber}.pdf`));
  } catch {
    return null;
  }
}

async function savePdfCheckpointPage(hash, pageNumber, pdfBytes) {
  const dir = pdfCheckpointDir(hash);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${pageNumber}.pdf`), pdfBytes);
}

async function savePdfManifest(hash, capturedPageNumbers, totalPages) {
  const dir = pdfCheckpointDir(hash);
  await fs.mkdir(dir, { recursive: true });
  const manifest = { captured: capturedPageNumbers, totalPages, updatedAt: new Date().toISOString() };
  const tmpPath = path.join(dir, 'manifest.json.tmp');
  const finalPath = path.join(dir, 'manifest.json');
  await fs.writeFile(tmpPath, JSON.stringify(manifest));
  await fs.rename(tmpPath, finalPath);
}

async function clearPdfCheckpoint(hash) {
  await fs.rm(pdfCheckpointDir(hash), { recursive: true, force: true }).catch(() => {});
}

/** Captura las páginas de `pageNumbers` (un tramo de un worker) sobre su
 * propio Chromium DEDICADO -- mismo bucle que antes vivía inline en
 * `renderReportPages` (montar la página exacta vía CSS, `page.pdf()`),
 * ahora reutilizable por cualquier worker, con reciclaje de página cada
 * PAGES_PER_BROWSER_PAGE DENTRO de su propio tramo (mismo motivo que
 * siempre: el subsistema de impresión de Chromium acumula estado en
 * sesiones largas de `page.pdf()`). Cada página capturada se persiste al
 * checkpoint INMEDIATAMENTE, sin fusionar todavía. */
async function capturePdfPagesOnWorker(scopedUrl, pageNumbers, jobLabel, workerLabel, contentHash, sharedState) {
  let { browser: workerBrowser, page: workerPage } = await openExportWorkerPage(scopedUrl, 'PDF_EXPORT', jobLabel, workerLabel);
  try {
    let sizes = await reportPageSizes(workerPage);
    let domPageNumbers = await reportPageNumbers(workerPage);
    let virtualized = await isExportVirtualized(workerPage);
    for (let i = 0; i < pageNumbers.length; i += 1) {
      if (i > 0 && i % PAGES_PER_BROWSER_PAGE === 0) {
        const staleBrowser = workerBrowser;
        const stalePage = workerPage;
        ({ browser: workerBrowser, page: workerPage } = await openExportWorkerPage(scopedUrl, 'PDF_EXPORT', jobLabel, workerLabel));
        await stalePage.close().catch(() => {});
        await staleBrowser.close().catch(() => {});
        sizes = await reportPageSizes(workerPage);
        domPageNumbers = await reportPageNumbers(workerPage);
        virtualized = await isExportVirtualized(workerPage);
      }
      const nth = pageNumbers[i];
      const domIndex = domPageNumbers.indexOf(nth);
      if (domIndex === -1) {
        sharedState.missingHandleCount += 1;
        console.warn('[PDF_EXPORT] página no encontrada en el DOM', nth, 'worker', workerLabel);
        continue;
      }
      const size = sizes[domIndex];
      // Informe grande (ver EXPORT_VIRTUALIZATION_PAGE_THRESHOLD en
      // ReadOnlyViewer.tsx): monta SOLO esta página antes de imprimirla.
      // Envuelto en try/catch (mismo criterio que /render-docx): un solo
      // widget lento/roto en UNA página no debe tumbar el export completo.
      if (virtualized) {
        await setExportActivePage(workerPage, nth);
        try {
          await waitForPageWidgetsReady(workerPage, nth, PAGE_WIDGET_READY_TIMEOUT_MS);
        } catch (readyErr) {
          console.warn('[PDF_EXPORT] widgets_no_listos', nth, 'worker', workerLabel, String(readyErr && readyErr.message || readyErr));
        }
      }
      const visibilityStyle = await workerPage.addStyleTag({ content: `
        @media print {
          html, body, #root, .ro-overlay, .ro-content, .ro-pages {
            width: ${size.width}px !important;
            height: ${size.height}px !important;
            min-width: 0 !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            gap: 0 !important;
            overflow: hidden !important;
          }
          .ro-toolbar, .ro-page-label, .ro-meta { display: none !important; }
          .ro-content { display: block !important; margin: 0 !important; padding: 0 !important; }
          .ro-pages { display: block !important; margin: 0 !important; padding: 0 !important; }
          .ro-page-wrapper { display: none !important; margin: 0 !important; padding: 0 !important; }
          .ro-page-wrapper:nth-child(${nth}) {
            display: block !important;
            width: ${size.width}px !important;
            height: ${size.height}px !important;
            margin: 0 !important;
            padding: 0 !important;
            break-after: auto !important;
            page-break-after: auto !important;
          }
          .ro-page-canvas {
            width: ${size.width}px !important;
            height: ${size.height}px !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
        }
      ` });
      try {
        const onePageBytes = await workerPage.pdf({
          width: `${size.width}px`,
          height: `${size.height}px`,
          printBackground: true,
          preferCSSPageSize: false,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        const onePage = await PDFDocument.load(onePageBytes);
        if (onePage.getPageCount() !== 1) {
          throw new Error(`unexpected_page_count:${nth}:${onePage.getPageCount()}`);
        }
        await savePdfCheckpointPage(contentHash, nth, onePageBytes);
        sharedState.capturedPageNumbers.push(nth);
        sharedState.capturedCount += 1;
        sharedState.sinceLastManifestSave += 1;
        if (sharedState.sinceLastManifestSave >= 20) {
          sharedState.sinceLastManifestSave = 0;
          await sharedState.flushManifest();
        }
        if (sharedState.capturedCount === 1 || sharedState.capturedCount % 20 === 0) {
          console.info('[PDF_EXPORT] progress', JSON.stringify({
            worker: workerLabel,
            pageNumber: nth,
            capturedThisRun: sharedState.capturedCount,
            capturedFromCheckpoint: sharedState.capturedFromCheckpoint,
            targetsThisRun: pageNumbers.length,
            elapsedMs: Date.now() - sharedState.startedAt,
          }));
          saveJobProgress(sharedState.realJobId, sharedState.capturedFromCheckpoint + sharedState.capturedCount, sharedState.totalPages);
        }
      } catch (pageErr) {
        sharedState.captureFailures += 1;
        console.warn('[PDF_EXPORT] page_capture_failed', nth, 'worker', workerLabel, String(pageErr && pageErr.message || pageErr));
      } finally {
        await visibilityStyle.evaluate((node) => node.remove()).catch(() => {});
      }
    }
  } finally {
    await workerPage.close().catch(() => {});
    await workerBrowser.close().catch(() => {});
  }
}

/** `page` es la página de DESCUBRIMIENTO ya preparada (navegada +
 * `waitForReportRender` hecho) que trae el caller -- solo se usa para leer
 * metadata (tamaños/números de página/documento), la captura real la hacen
 * N workers dedicados en paralelo (ver `capturePdfPagesOnWorker`), cada uno
 * con checkpoint propio. Devuelve `{ buffer, page, pageCount }`: `page` es
 * SIEMPRE la misma que entró (nunca se recicla la de descubrimiento) --  el
 * caller la cierra en su `finally` como siempre. */
async function renderReportPages(page, url, realJobId) {
  // Sin binding -- solo valida que haya al menos una página (lanza
  // `no_pages_to_render` si no), el array en sí lo recalcula cada worker.
  await reportPageSizes(page);
  const allPageNumbers = await reportPageNumbers(page);
  const reportDocument = await page.evaluate(() => window.__REPORT_DOCUMENT__ || null);

  // Checkpoint reanudable (mismo criterio que DOCX/PPTX): indexado por HASH
  // DEL CONTENIDO. `window.__REPORT_DOCUMENT__` puede no estar disponible
  // (reproducido en vivo alguna vez para DOCX, "report_document_unavailable")
  // -- sin él no hay forma de calcular un hash ESTABLE entre reintentos, así
  // que se usa un UUID de un solo uso: no da resumibilidad entre corridas,
  // pero mantiene simétrica la escritura/lectura del checkpoint DENTRO de
  // esta misma corrida (si el hash fuera `null` acá y la fusión final más
  // abajo tratara `null` como "sin checkpoint", las páginas SÍ capturadas
  // por los workers quedarían huérfanas -- ninguna llegaría al PDF final).
  const contentHash = reportDocument ? computeContentHash(reportDocument) : crypto.randomUUID();
  const alreadyCaptured = reportDocument ? await loadPdfCheckpointManifest(contentHash) : new Set();
  const remainingPageNumbers = allPageNumbers.filter((n) => !alreadyCaptured.has(n));
  const capturedPageNumbers = Array.from(alreadyCaptured);

  const parallelism = Math.max(1, Math.min(PDF_CAPTURE_PARALLELISM, remainingPageNumbers.length || 1));
  const chunkSize = Math.max(1, Math.ceil(remainingPageNumbers.length / parallelism));
  const chunks = [];
  for (let i = 0; i < remainingPageNumbers.length; i += chunkSize) {
    chunks.push(remainingPageNumbers.slice(i, i + chunkSize));
  }
  // Sin `job_id` propio (endpoint síncrono) -- se usa el hash como etiqueta
  // de diagnóstico para los workers.
  const jobLabel = contentHash || 'no-hash';
  console.info('[PDF_EXPORT] capture_start', JSON.stringify({
    totalPages: allPageNumbers.length,
    capturedFromCheckpoint: alreadyCaptured.size,
    remaining: remainingPageNumbers.length,
    parallelism: chunks.length,
  }));
  // `realJobId` viene `undefined` para `/render` (síncrono, sin job propio
  // -- ver comentario de `saveJobProgress`, que no escribe nada en ese
  // caso). `/render-pdf` (async) SÍ lo pasa.
  await saveJobProgress(realJobId, alreadyCaptured.size, allPageNumbers.length);

  const sharedState = {
    capturedPageNumbers,
    capturedCount: 0,
    captureFailures: 0,
    missingHandleCount: 0,
    sinceLastManifestSave: 0,
    capturedFromCheckpoint: alreadyCaptured.size,
    startedAt: Date.now(),
    realJobId,
    totalPages: allPageNumbers.length,
    flushManifest: () => savePdfManifest(contentHash, capturedPageNumbers, allPageNumbers.length).catch((err) => {
      console.warn('[PDF_EXPORT] checkpoint_manifest_save_failed', String(err));
    }),
  };

  if (chunks.length > 0) {
    const telemetryQuota = chunks.length > 1
      ? {
        maxConcurrency: Math.max(1, Math.floor(16 / chunks.length)),
        minIntervalMs: Math.ceil(62.5 * chunks.length),
      }
      : null;
    await Promise.all(chunks.map((chunk, idx) => {
      const pageFrom = Math.min(...chunk);
      const pageTo = Math.max(...chunk);
      const scopedUrl = withPageRangeParam(url, pageFrom, pageTo, telemetryQuota);
      return capturePdfPagesOnWorker(scopedUrl, chunk, jobLabel, idx, contentHash, sharedState);
    }));
  }
  await sharedState.flushManifest();

  // ── Fusión SECUENCIAL final ──────────────────────────────────────────
  // Única parte que sigue siendo estrictamente secuencial: pdf-lib arma el
  // documento final copiando cada página YA VALIDADA (una sola hoja, ver
  // `capturePdfPagesOnWorker`) en orden, leyendo del checkpoint de a una
  // (nunca todas juntas en memoria, mismo criterio que PPTX).
  const merged = await PDFDocument.create();
  let placeholderCount = 0;
  // Página REAL (`page_number`) de cada hoja efectivamente agregada a
  // `merged`, EN EL MISMO ORDEN -- puede ser un subconjunto de
  // `allPageNumbers` (una que falló en todos los workers se omite arriba,
  // ver `placeholderCount`). `addPdfOutline`/`addTocLinkAnnotations` de
  // abajo necesitan esta lista exacta para mapear cada encabezado/entrada de
  // TOC al índice 0-based real dentro de `merged`.
  const mergedPageNumbers = [];
  for (const nth of allPageNumbers) {
    const pageBytes = await readPdfCheckpointPage(contentHash, nth);
    if (!pageBytes) {
      placeholderCount += 1;
      console.warn('[PDF_EXPORT] página faltante en el checkpoint, se omite del PDF final', nth);
      continue;
    }
    const onePage = await PDFDocument.load(pageBytes);
    const [copied] = await merged.copyPages(onePage, [0]);
    merged.addPage(copied);
    mergedPageNumbers.push(nth);
  }

  // Índice REAL (ADR pendiente de numerar -- ver pdfPostProcess.js): panel
  // de marcadores + enlaces internos reales sobre el bloque TOC visible,
  // misma numeración que el campo TOC nativo de Word. `reportDocument` puede
  // ser `null` (caso raro "report_document_unavailable", ver arriba) -- en
  // ese caso no hay de dónde sacar encabezados, se omite sin más. Un fallo
  // acá NUNCA debe tumbar un export que por lo demás salió bien -- el índice
  // es una mejora, no un requisito de la exportación.
  if (reportDocument) {
    try {
      addPdfOutline(merged, reportDocument, mergedPageNumbers);
      addTocLinkAnnotations(merged, reportDocument, mergedPageNumbers);
    } catch (indexErr) {
      console.warn('[PDF_EXPORT] pdf_index_failed', String(indexErr && indexErr.stack || indexErr));
    }
  }

  console.info('[PDF_EXPORT] export_complete', JSON.stringify({
    totalPages: allPageNumbers.length,
    capturedFromCheckpoint: alreadyCaptured.size,
    capturedThisRun: sharedState.capturedCount,
    placeholders: placeholderCount,
    captureFailures: sharedState.captureFailures,
    missingHandleCount: sharedState.missingHandleCount,
    elapsedMs: Date.now() - sharedState.startedAt,
  }));
  await clearPdfCheckpoint(contentHash).catch((clearErr) => {
    console.warn('[PDF_EXPORT] checkpoint_clear_failed', String(clearErr));
  });
  await clearJobProgress(realJobId);
  return { buffer: Buffer.from(await merged.save()), page, pageCount: allPageNumbers.length };
}

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I) — la contraseña se
// muestra una sola vez al usuario y puede necesitar transcribirla a mano.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateUserPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

// pptxgenjs espera "RRGGBB" (sin '#'); un color inválido/no-hex se descarta
// (el caller usa un fallback) en vez de mandarlo tal cual a la librería.
function sanitizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

// Mismos nombres de resaltado que HIGHLIGHT_NAMES en
// buildReportDocx.ts/reportDocxBuilder.js (paridad DOCX/PPTX) -- el color de
// resaltado del canvas se guarda como nombre OOXML de Word
// (props.highlightColor: 'yellow'/'green'/...), pptxgenjs::addText espera
// hex sin '#' en `options.highlight`, así que hace falta este mapeo
// intermedio en vez de pasarlo tal cual.
const HIGHLIGHT_NAME_TO_HEX = {
  black: '000000', blue: '0000FF', cyan: '00FFFF', darkBlue: '00008B', darkCyan: '008B8B',
  darkGray: 'A9A9A9', darkGreen: '006400', darkMagenta: '8B008B', darkRed: '8B0000',
  darkYellow: '808000', green: '00FF00', lightGray: 'D3D3D3', magenta: 'FF00FF', red: 'FF0000',
  white: 'FFFFFF', yellow: 'FFFF00',
};
function highlightHexFromName(value) {
  if (typeof value !== 'string' || !value || value === 'transparent') return null;
  return HIGHLIGHT_NAME_TO_HEX[value.trim()] || HIGHLIGHT_NAME_TO_HEX.yellow;
}

function sanitizeWatermarkText(value) {
  if (typeof value !== 'string') return '';
  // Un watermark es texto dibujado en el PDF, no HTML/markup — se recorta a
  // una longitud razonable y se quitan saltos de línea para que la
  // rotación/posicionado en pdf-lib no se rompa con strings gigantes.
  return value.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

function buildWatermarkText(watermark) {
  const w = watermark && typeof watermark === 'object' ? watermark : {};
  const explicit = sanitizeWatermarkText(w.text);
  if (explicit) return explicit;
  const tenant = sanitizeWatermarkText(w.tenant) || 'CONFIDENCIAL';
  const user = sanitizeWatermarkText(w.user);
  const date = sanitizeWatermarkText(w.date) || new Date().toISOString().slice(0, 10);
  const parts = ['CONFIDENCIAL', tenant];
  if (user) parts.push(`Generado para ${user}`);
  parts.push(date);
  return parts.join(' — ');
}

// Dibuja el texto repetido en diagonal sobre cada página, semitransparente,
// para que sea visible pero no interfiera con la lectura del contenido.
async function applyWatermark(pdfBytes, watermarkText) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 18;
  const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const stepX = textWidth + 80;
    const stepY = 140;
    // Cuadrícula amplia rotada -45° para cubrir toda la página incluso tras
    // la rotación, sin depender del tamaño exacto de página (A4 u otro).
    const diagonal = Math.sqrt(width * width + height * height);
    for (let y = -diagonal; y < diagonal; y += stepY) {
      for (let x = -diagonal; x < diagonal; x += stepX) {
        page.drawText(watermarkText, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0.55, 0.55, 0.55),
          opacity: 0.15,
          rotate: degrees(45),
        });
      }
    }
  }
  return pdfDoc.save();
}

// Cifra con qpdf vía execFile (argumentos como array, nunca interpolados en
// un shell) para evitar inyección de comandos a través del password u otros
// campos. qpdf aplica cifrado PDF real (AES-256 de 256 bits, ISO 32000):
// --print=full permite imprimir con la contraseña de usuario; --modify=none
// bloquea edición/copia sin la contraseña de propietario.
async function encryptPdf(pdfBytes, userPassword) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-export-'));
  const inPath = path.join(tmpDir, 'in.pdf');
  const outPath = path.join(tmpDir, 'out.pdf');
  try {
    await fs.writeFile(inPath, pdfBytes);
    await execFileAsync('qpdf', [
      '--encrypt', userPassword, OWNER_PASSWORD_SECRET, '256',
      '--print=full',
      '--modify=none',
      '--',
      inPath,
      outPath,
    ]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

app.get('/health', async (_req, res) => {
  try {
    const browser = await getBrowser();
    res.json({ ok: true, connected: browser.isConnected() });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

app.post('/render', async (req, res) => {
  const { url, watermark, encrypt } = req.body || {};
  // ADR-138: enlaces de acceso directo (QR -> abre solo, sin contrasena)
  // piden el mismo render SIN el paso de qpdf -- default true preserva el
  // comportamiento existente (ADR-080) para toda llamada que no mande el flag.
  const shouldEncrypt = encrypt !== false;
  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'url_required' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (parsed.hostname !== ALLOWED_HOST) {
    return res.status(400).json({ error: 'host_not_allowed' });
  }
  if (!tryAcquireHeavyExport('pdf', null)) {
    const active = activeHeavyExport;
    console.warn('[PDF_EXPORT] export_busy', JSON.stringify({
      activeKind: active && active.kind,
      activeJobId: active && active.jobId,
      activeElapsedMs: active ? Date.now() - active.startedAt : null,
    }));
    return res.status(429).json({ error: 'export_busy' });
  }

  let page;
  const exportStartedAt = Date.now();
  try {
    const browser = await getBrowser();
    // `openReportPage` deja el mismo log de errores no capturados que antes
    // vivía inline aquí (útil para diagnosticar un widget roto -- ver
    // `no_pages_to_render`), más media type/viewport/navegación/espera
    // inicial. Esta `page` queda como página de DESCUBRIMIENTO -- la
    // captura real (Fase 1+2, checkpoints + N workers en paralelo, cada uno
    // con su propio Chromium dedicado) vive en `renderReportPages`, que
    // devuelve la MISMA página que entró (nunca la recicla directamente).
    page = await openReportPage(browser, url);
    const rendered = await renderReportPages(page, url);
    page = rendered.page;
    let pdfBuffer = rendered.buffer;

    // ADR-204: `watermark === false` explícito (perfil avanzado, permission
    // code informes.export_sin_marca_agua verificado server-side ANTES de
    // llegar acá) es la ÚNICA forma de saltear el sello -- cualquier otro
    // valor (objeto, undefined, ausente) sigue dibujando el default, igual
    // que siempre (retrocompatible con todo caller viejo).
    if (watermark !== false) {
      const watermarkText = buildWatermarkText(watermark);
      pdfBuffer = Buffer.from(await applyWatermark(pdfBuffer, watermarkText));
    }

    res.setHeader('Content-Type', 'application/pdf');
    if (shouldEncrypt) {
      const userPassword = generateUserPassword();
      const encrypted = await encryptPdf(pdfBuffer, userPassword);
      console.info('[PDF_EXPORT] export_complete', JSON.stringify({
        pages: rendered.pageCount,
        unencryptedBytes: pdfBuffer.length,
        outputBytes: encrypted.length,
        encrypted: true,
        elapsedMs: Date.now() - exportStartedAt,
      }));
      res.setHeader('X-Pdf-User-Password', userPassword);
      res.send(encrypted);
    } else {
      // Enlace de acceso directo (ADR-138): sin qpdf -- el PDF que sale de
      // aca es un PDF estandar SIN contrasena. Nunca se llega a esta rama sin
      // pasar antes por resolveReportShareLinkPg (token valido, no
      // revocado/expirado) -- la proteccion la aplica el caller, no este
      // servicio (que no sabe nada de tokens).
      console.info('[PDF_EXPORT] export_complete', JSON.stringify({
        pages: rendered.pageCount,
        outputBytes: pdfBuffer.length,
        encrypted: false,
        elapsedMs: Date.now() - exportStartedAt,
      }));
      res.send(pdfBuffer);
    }
  } catch (err) {
    console.error('[PDF_EXPORT] render error:', err);
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseHeavyExport('pdf', null);
  }
});

// POST /render-pdf  { url: string, job_id: string, watermark?: object, encrypt?: boolean }
//   → { storage_path: string, user_password?: string }
//
// Variante ASÍNCRONA (job) de `/render` de arriba, para el backend C++
// (`runPdfExportJob`, report_export_jobs.cpp): `/render` es síncrono --
// el caller HTTP espera la respuesta directa, acotado por SU propio
// timeout de cliente -- un documento de miles de páginas puede terminar de
// renderizar bien y aun así jamás llegar a responderle a ese caller porque
// ya se rindió esperando. Mismo pipeline de captura (Fase 1+2, checkpoints
// + N workers dedicados, ver `renderReportPages`) y mismo watermark/cifrado
// (ADR-080) que `/render` -- solo cambia que el resultado se escribe a
// `EXPORT_DATA_ROOT/<job_id>.pdf` y se devuelve la RUTA (como
// `/render-docx`/`/render-pptx`), no los bytes. La contraseña de cifrado
// viaja en el JSON de respuesta (no en un header, no hay a quién más
// devolvérsela): `runPdfExportJob` la guarda en `report_export_job.options`
// para que el endpoint de descarga la exponga después.
app.post('/render-pdf', async (req, res) => {
  const { url, job_id: jobId, watermark, encrypt } = req.body || {};
  const shouldEncrypt = encrypt !== false;
  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'url_required' });
  }
  if (typeof jobId !== 'string' || !jobId) {
    return res.status(400).json({ error: 'job_id_required' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (parsed.hostname !== ALLOWED_HOST) {
    return res.status(400).json({ error: 'host_not_allowed' });
  }

  // Mismo mutex COMPARTIDO que DOCX/PPTX/PDF síncrono (`tryAcquireHeavyExport`,
  // un solo slot para los cuatro) -- un documento grande ya satura CPU/memoria
  // del contenedor por sí solo, dos a la vez competirían por el mismo
  // Chromium compartido de la página de descubrimiento.
  if (!tryAcquireHeavyExport('pdf', jobId)) {
    const active = activeHeavyExport;
    console.warn('[PDF_EXPORT] export_busy', JSON.stringify({
      rejectedJobId: jobId,
      activeKind: active && active.kind,
      activeJobId: active && active.jobId,
      activeElapsedMs: active ? Date.now() - active.startedAt : null,
    }));
    return res.status(429).json({ error: 'export_busy' });
  }

  let page;
  const exportStartedAt = Date.now();
  try {
    const browser = await getBrowser();
    page = await openReportPage(browser, url);
    const rendered = await renderReportPages(page, url, jobId);
    page = rendered.page;
    let pdfBuffer = rendered.buffer;

    // ADR-204: ver comentario equivalente en /render, mismo criterio exacto.
    if (watermark !== false) {
      const watermarkText = buildWatermarkText(watermark);
      pdfBuffer = Buffer.from(await applyWatermark(pdfBuffer, watermarkText));
    }

    let userPassword = null;
    let finalBuffer = pdfBuffer;
    if (shouldEncrypt) {
      userPassword = generateUserPassword();
      finalBuffer = await encryptPdf(pdfBuffer, userPassword);
    }

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.pdf`);
    await fs.writeFile(outPath, finalBuffer);
    console.info('[PDF_EXPORT] job_export_complete', JSON.stringify({
      jobId,
      pages: rendered.pageCount,
      outputBytes: finalBuffer.length,
      encrypted: shouldEncrypt,
      elapsedMs: Date.now() - exportStartedAt,
    }));
    const responseBody = { storage_path: outPath };
    if (userPassword) responseBody.user_password = userPassword;
    res.json(responseBody);
  } catch (err) {
    console.error('[PDF_EXPORT] render_failed (job):', err && err.stack ? err.stack : err);
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseHeavyExport('pdf', jobId);
  }
});

// Tamaño de deck/papel (SLIDE_WIDTH_IN/HEIGHT_IN, paperSizeInches,
// resolvePagePaperSetup): ver reportSharedHelpers.js/reportPptxBuilder.js --
// PPTX ahora se arma nativamente desde el JSON (mismo criterio que DOCX,
// checkpoint por ELEMENTO compartido vía rasterCapturePipeline.js, ya NO por
// página completa), así que ese cálculo de tamaño vive junto al builder que
// realmente lo usa.
// Techo por captura de elemento individual -- mismo criterio que
// DOCX_CAPTURE_TIMEOUT_MS: sin esto, un solo gráfico cuyo layout nunca "se
// asienta" cuelga TODO el deck para siempre, sin ningún error que lo delate.
const PPTX_CAPTURE_TIMEOUT_MS = 20000;
// Techo por elemento para "listo" (antes era por diapositiva completa,
// `waitForPageWidgetsReady` -- PPTX ahora captura por ELEMENTO como DOCX, ver
// `waitForElementReady` en rasterCapturePipeline.js) -- fallar rápido y
// capturar el elemento tal como esté es preferible a bloquear todo el export
// por un solo gráfico lento.
const PPTX_ELEMENT_READY_TIMEOUT_MS = 15000;
const PPTX_CAPTURE_PARALLELISM = Math.max(1, parseInt(process.env.PPTX_CAPTURE_PARALLELISM || '4', 10) || 1);

// Frames rasterizados 1:1 por diapositiva, SOLO para /render-video (ver su
// comentario y el de `captureSlidePreviewsForVideo`) -- desde que /render-pptx
// arma el .pptx nativamente (0..N imágenes por diapositiva, ya no
// exactamente 1 "fondo de página completa"), /render-video ya no puede sacar
// sus frames del propio .pptx.
const SLIDE_PREVIEW_ROOT = path.join(EXPORT_DATA_ROOT, 'pptx_slide_previews');

/** Reusa el mismo mecanismo de worker dedicado que el resto del pipeline de
 * export (Chromium propio, activación de página virtualizada, espera de
 * montaje) pero simplificado a UN solo worker secuencial -- los decks de
 * presentación (único `layoutMode` desde el que la UI permite exportar
 * video) son órdenes de magnitud más chicos que los documentos de miles de
 * páginas que sí necesitan paralelismo real. Guarda un PNG por página bajo
 * `SLIDE_PREVIEW_ROOT/<jobId>/<pageNumber>.png` -- saltea los que ya existen
 * (reintento de un job caído a medias no vuelve a capturar todo). */
async function captureSlidePreviewsForVideo(reportDocument, url, jobId, virtualized) {
  const dir = path.join(SLIDE_PREVIEW_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });
  const pageNumbers = reportDocument.pages.map((p) => p.page_number);
  const pageFrom = Math.min(...pageNumbers);
  const pageTo = Math.max(...pageNumbers);
  const { browser: workerBrowser, page: workerPage } = await openExportWorkerPage(
    withPageRangeParam(url, pageFrom, pageTo, null), 'PPTX_EXPORT', jobId, 'video-preview',
  );
  try {
    for (const pageNumber of pageNumbers) {
      const outPath = path.join(dir, `${pageNumber}.png`);
      try {
        await fs.access(outPath);
        continue;
      } catch {
        // No existe todavía -- seguir y capturarla.
      }
      if (virtualized) {
        try {
          await setExportActivePage(workerPage, pageNumber);
          await waitForMountedPage(workerPage, pageNumber, PPTX_ELEMENT_READY_TIMEOUT_MS);
        } catch (activateErr) {
          console.warn('[PPTX_EXPORT] video_preview_activate_failed', pageNumber, String(activateErr));
        }
      }
      // Re-consultada en CADA página (no una sola vez afuera del loop): en un
      // documento virtualizado, qué `.ro-page-canvas` están montados cambia
      // con cada `setExportActivePage` -- mismo criterio que
      // `capturePagesOnWorker` del pipeline viejo.
      const handles = await workerPage.$$('.ro-page-canvas');
      const nums = await reportPageNumbers(workerPage);
      const idx = nums.indexOf(pageNumber);
      const handle = idx >= 0 ? handles[idx] : null;
      if (!handle) {
        console.warn('[PPTX_EXPORT] video_preview_handle_nulo', pageNumber);
        continue;
      }
      try {
        const png = await withTimeout(handle.screenshot({ type: 'png' }), PPTX_CAPTURE_TIMEOUT_MS, 'video_preview_screenshot_timeout');
        await fs.writeFile(outPath, png);
      } catch (captureErr) {
        console.warn('[PPTX_EXPORT] video_preview_capture_failed', pageNumber, String(captureErr));
      }
    }
  } finally {
    await workerPage.close().catch(() => {});
    await workerBrowser.close().catch(() => {});
  }
}

// POST /render-pptx  { url: string, job_id: string }
//   → { storage_path: string } — ruta (dentro de EXPORT_DATA_ROOT) del .pptx
//     generado; el backend la guarda como report_export_job.storage_uri.
//
// Pipeline nativo PPTX (reemplaza la captura de página completa como imagen
// de fondo + overlay de texto): igual que /render-docx, la MAYORÍA de la
// diapositiva se construye directamente desde `window.__REPORT_DOCUMENT__`
// (`reportPptxBuilder.js`) -- solo los 4 tipos de `RASTER_ELEMENT_TYPES`
// (chart/sensor_multi_chart/cover/image) se capturan como PNG, con el MISMO
// checkpoint por-elemento (indexado por hash de contenido, compartido con
// DOCX) que ya probó ser reanudable en documentos de miles de páginas.
app.post('/render-pptx', async (req, res) => {
  const { url, job_id: jobId } = req.body || {};
  if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'url_required' });
  if (typeof jobId !== 'string' || !jobId) return res.status(400).json({ error: 'job_id_required' });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (parsed.hostname !== ALLOWED_HOST) return res.status(400).json({ error: 'host_not_allowed' });

  if (!tryAcquireHeavyExport('pptx', jobId)) {
    const active = activeHeavyExport;
    console.warn('[PPTX_EXPORT] export_busy', JSON.stringify({
      rejectedJobId: jobId,
      activeKind: active && active.kind,
      activeJobId: active && active.jobId,
      activeElapsedMs: active ? Date.now() - active.startedAt : null,
    }));
    return res.status(429).json({ error: 'export_busy' });
  }

  let page;
  const exportStartedAt = Date.now();
  let checkpointHashForCleanup = null;
  let manifestEntriesForCleanup = null;
  let checkpointTotalTargets = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    attachBrowserDiagnostics(page, 'PPTX_EXPORT', `${jobId}#discovery`);
    await page.emulateMediaType('print');
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    // Rango vacío (0,0) a propósito -- ver comentario de `withPageRangeParam`
    // (mismo criterio que /render-docx: esta página de descubrimiento solo
    // lee `window.__REPORT_DOCUMENT__`, la captura real la hacen los workers
    // de más abajo).
    await page.goto(withPageRangeParam(url, 0, 0), { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    await waitForReportRender(page);

    const reportDocument = await page.evaluate(() => window.__REPORT_DOCUMENT__ || null);
    if (!reportDocument || !Array.isArray(reportDocument.pages)) {
      return res.status(422).json({ error: 'report_document_unavailable' });
    }
    const sessionChrome = await page.evaluate(() => window.__REPORT_SESSION_CHROME__ || {});

    const virtualized = await isExportVirtualized(page);
    const allTargets = [];
    for (const docPage of reportDocument.pages) {
      for (const el of docPage.elements || []) {
        if (RASTER_ELEMENT_TYPES.has(el.type)) allTargets.push({ el, pageNumber: docPage.page_number });
      }
    }

    // Checkpoint reanudable COMPARTIDO con /render-docx (mismo hash de
    // contenido, mismo directorio -- ver comentario de
    // rasterCapturePipeline.js::RASTER_CHECKPOINT_ROOT): exportar primero a
    // DOCX y después a PPTX del mismo informe reusa las capturas ya hechas.
    const contentHash = computeContentHash(reportDocument);
    const checkpointData = await loadCheckpoint(contentHash);
    const rasterAssets = checkpointData.rasterAssets;
    const imageAssets = checkpointData.imageAssets;
    const alreadyCaptured = new Set([...rasterAssets.keys(), ...imageAssets.keys()]);
    const captureTargets = allTargets.filter(({ el }) => !alreadyCaptured.has(el.id));
    const manifestEntries = allTargets
      .filter(({ el }) => alreadyCaptured.has(el.id))
      .map(({ el }) => ({ id: el.id, type: el.type }));
    checkpointHashForCleanup = contentHash;
    manifestEntriesForCleanup = manifestEntries;
    checkpointTotalTargets = allTargets.length;
    let sinceLastManifestSave = 0;
    const flushManifest = () => saveManifest(contentHash, manifestEntries, allTargets.length).catch((err) => {
      console.warn('[PPTX_EXPORT] checkpoint_manifest_save_failed', String(err));
    });

    let readyTimeouts = 0;
    let capturedCount = 0;
    let captureFailures = 0;
    let activatedPageCount = 0;

    // Partición en tramos contiguos -- mismo patrón que /render-docx.
    const parallelism = Math.max(1, Math.min(PPTX_CAPTURE_PARALLELISM, captureTargets.length || 1));
    const chunkSize = Math.max(1, Math.ceil(captureTargets.length / parallelism));
    const chunks = [];
    for (let i = 0; i < captureTargets.length; i += chunkSize) {
      chunks.push(captureTargets.slice(i, i + chunkSize));
    }
    console.info('[PPTX_EXPORT] capture_start', JSON.stringify({
      jobId,
      contentHash,
      pages: reportDocument.pages.length,
      targets: allTargets.length,
      capturedFromCheckpoint: alreadyCaptured.size,
      remaining: captureTargets.length,
      parallelism: chunks.length,
      virtualized,
      elementReadyTimeoutMs: PPTX_ELEMENT_READY_TIMEOUT_MS,
    }));
    await saveJobProgress(jobId, alreadyCaptured.size, allTargets.length);

    /** Idéntico en espíritu a `captureOnPage` de /render-docx (activar
     * página → esperar listo → `handle.screenshot()` → guardar en
     * checkpoint) -- ver sus comentarios para el detalle de cada paso, acá
     * solo cambia el prefijo de log. */
    async function captureOnPage(workerPage, targets, workerLabel) {
      let lastActivatedPage = null;
      let virtualizationErrorLogged = 0;
      let missingHandleLogged = 0;
      // BATCH_SIZE=1 (secuencial) a propósito -- mismo hallazgo que DOCX:
      // `elementHandle.screenshot()` hace scroll de la página hasta que el
      // elemento sea visible ANTES de capturar, y varias capturas a la vez
      // sobre la MISMA página interfieren entre sí (capturas rotas).
      await runInBatches(targets, 1, async ({ el, pageNumber }) => {
        if (virtualized && pageNumber !== lastActivatedPage) {
          try {
            await setExportActivePage(workerPage, pageNumber);
            await waitForMountedPage(workerPage, pageNumber, PPTX_ELEMENT_READY_TIMEOUT_MS);
            lastActivatedPage = pageNumber;
            activatedPageCount += 1;
            if (activatedPageCount === 1 || activatedPageCount % 10 === 0) {
              const memory = process.memoryUsage();
              console.info('[PPTX_EXPORT] progress', JSON.stringify({
                jobId,
                worker: workerLabel,
                pageNumber,
                activatedPages: activatedPageCount,
                capturedThisRun: capturedCount,
                capturedFromCheckpoint: alreadyCaptured.size,
                targetsThisRun: captureTargets.length,
                readyTimeouts,
                elapsedMs: Date.now() - exportStartedAt,
                nodeRssBytes: memory.rss,
                nodeHeapUsedBytes: memory.heapUsed,
              }));
              saveJobProgress(jobId, alreadyCaptured.size + capturedCount, allTargets.length);
            }
          } catch (activateErr) {
            if (virtualizationErrorLogged < 5) {
              virtualizationErrorLogged += 1;
              console.warn('[PPTX_EXPORT] activar página falló', workerLabel, pageNumber, String(activateErr && activateErr.stack || activateErr));
            }
            lastActivatedPage = pageNumber;
          }
        }
        try {
          await waitForElementReady(workerPage, el.id, PPTX_ELEMENT_READY_TIMEOUT_MS);
        } catch (readyErr) {
          readyTimeouts += 1;
          let snapshot = null;
          try {
            snapshot = await elementReadinessSnapshot(workerPage, pageNumber, el.id);
          } catch (snapshotErr) {
            snapshot = { diagnosticError: String(snapshotErr) };
          }
          console.warn('[PPTX_EXPORT] element_ready_timeout', JSON.stringify({
            jobId, worker: workerLabel, pageNumber, elementId: el.id, elementType: el.type, error: String(readyErr), snapshot,
          }));
        }
        const handle = await workerPage.$(`[data-element-id="${el.id}"]`);
        if (!handle) {
          if (missingHandleLogged < 8) {
            missingHandleLogged += 1;
            console.warn('[PPTX_EXPORT] handle nulo para', el.id, 'worker', workerLabel, 'tipo', el.type, 'pageNumber', pageNumber, 'lastActivatedPage', lastActivatedPage);
          }
          return;
        }
        try {
          const png = await withTimeout(handle.screenshot({ type: 'png' }), PPTX_CAPTURE_TIMEOUT_MS, 'screenshot_timeout');
          if (el.type === 'image') imageAssets.set(el.id, png);
          else rasterAssets.set(el.id, png);
          capturedCount += 1;
          try {
            await saveCheckpointPng(contentHash, el.id, png);
            manifestEntries.push({ id: el.id, type: el.type });
            sinceLastManifestSave += 1;
            if (sinceLastManifestSave >= 50) {
              sinceLastManifestSave = 0;
              await flushManifest();
            }
          } catch (checkpointErr) {
            console.warn('[PPTX_EXPORT] checkpoint_png_save_failed', el.id, String(checkpointErr));
          }
        } catch (captureErr) {
          captureFailures += 1;
          console.warn('[PPTX_EXPORT] captura fallida para', el.id, 'worker', workerLabel, String(captureErr));
        }
      });
    }

    const telemetryQuota = chunks.length > 1
      ? {
        maxConcurrency: Math.max(1, Math.floor(16 / chunks.length)),
        minIntervalMs: Math.ceil(62.5 * chunks.length),
      }
      : null;
    const WORKER_OPEN_TIMEOUT_MS = 120000;
    const workerPages = [];
    const workerBrowsers = [];
    for (let idx = 0; idx < chunks.length; idx += 1) {
      const chunk = chunks[idx];
      const pageNumbers = chunk.map(({ pageNumber }) => pageNumber);
      const pageFrom = Math.min(...pageNumbers);
      const pageTo = Math.max(...pageNumbers);
      console.info('[PPTX_EXPORT] worker_open_start', JSON.stringify({ jobId, worker: idx, pageFrom, pageTo, targetsInChunk: chunk.length, telemetryQuota }));
      const { browser: workerBrowser, page: workerPage } = await withTimeout(
        openExportWorkerPage(withPageRangeParam(url, pageFrom, pageTo, telemetryQuota), 'PPTX_EXPORT', jobId, idx),
        WORKER_OPEN_TIMEOUT_MS,
        `worker_open_timeout(worker=${idx})`,
      );
      console.info('[PPTX_EXPORT] worker_open_done', JSON.stringify({ jobId, worker: idx }));
      workerBrowsers.push(workerBrowser);
      workerPages.push(workerPage);
    }
    try {
      await Promise.all(chunks.map((chunk, idx) => captureOnPage(workerPages[idx], chunk, idx)));
    } finally {
      await Promise.all(workerPages.map((workerPage) => workerPage.close().catch(() => {})));
      await Promise.all(workerBrowsers.map((workerBrowser) => workerBrowser.close().catch(() => {})));
    }
    await flushManifest();

    // /render-video (narración sobre diapositivas, ADR-164) necesita UN frame
    // rasterizado por diapositiva para componer el .mp4 -- ya no puede sacarlo
    // del propio .pptx (el nativo tiene 0..N imágenes por diapositiva, ya no
    // exactamente 1 "fondo de página completa" como el pipeline viejo). Solo
    // se genera para 'presentation' (único layoutMode desde el que la UI
    // permite grabar narración/exportar video, ver App.tsx `handleExportVideo`
    // -- 'document' nunca llega acá con narración, así que nunca paga este
    // costo extra). Guardado bajo el mismo `jobId` de ESTE job pptx --
    // `/render-video` lo deriva de `pptx_path` (ver su comentario).
    if ((reportDocument.meta && reportDocument.meta.layoutMode) === 'presentation') {
      await captureSlidePreviewsForVideo(reportDocument, url, jobId, virtualized);
    }

    const pptx = new PptxGenJS();
    buildReportPptx(pptx, reportDocument, { session: sessionChrome, imageAssets, rasterAssets });
    const buffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.pptx`);
    await fs.writeFile(outPath, buffer);
    const totalCaptured = alreadyCaptured.size + capturedCount;
    console.info('[PPTX_EXPORT] export_complete', JSON.stringify({
      jobId,
      contentHash,
      pages: reportDocument.pages.length,
      targets: allTargets.length,
      capturedFromCheckpoint: alreadyCaptured.size,
      capturedThisRun: capturedCount,
      captured: totalCaptured,
      placeholders: allTargets.length - totalCaptured,
      readyTimeouts,
      captureFailures,
      outputBytes: buffer.length,
      elapsedMs: Date.now() - exportStartedAt,
    }));
    await clearCheckpoint(contentHash).catch((clearErr) => {
      console.warn('[PPTX_EXPORT] checkpoint_clear_failed', String(clearErr));
    });
    await clearJobProgress(jobId);
    res.json({ storage_path: outPath });
  } catch (err) {
    console.error('[PPTX_EXPORT] render_failed:', err && err.stack ? err.stack : err);
    if (checkpointHashForCleanup) {
      await saveManifest(checkpointHashForCleanup, manifestEntriesForCleanup, checkpointTotalTargets).catch((flushErr) => {
        console.warn('[PPTX_EXPORT] checkpoint_manifest_final_flush_failed', String(flushErr));
      });
    }
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseHeavyExport('pptx', jobId);
  }
});

// POST /render-docx  { url: string, job_id: string }
//   → { storage_path: string } — ruta del .docx generado.
//
// Pipeline B (servidor) del export DOCX: a diferencia de la vieja versión de
// /render-pptx (que solo superponía texto sobre una captura de página
// completa -- ver reportPptxBuilder.js para la versión actual, reconstruida
// nativamente con el MISMO criterio), la MAYORÍA del documento se construye
// directamente desde `window.__REPORT_DOCUMENT__` (mismo JSON que ya usa
// ReadOnlyViewer, leído sin tocar el DOM) — `reportDocxBuilder.js` implementa
// la misma especificación de mapeo que el pipeline cliente
// (`frontend/.../lib/docx/buildReportDocx.ts`). Solo los bloques sin
// representación estática (`chart`/`sensor_multi_chart`/fondo de `cover`) y
// las imágenes (`image`) se capturan como PNG, vía
// `elementHandle.screenshot()` sobre el nodo `[data-element-id]` de cada uno
// (atributo agregado en ReadOnlyViewer.tsx para este propósito).
//
// `RASTER_ELEMENT_TYPES`/checkpoints/espera-de-listo viven en
// `rasterCapturePipeline.js`, COMPARTIDOS con /render-pptx (mismos 4 tipos,
// mismo checkpoint por hash de contenido) -- alias local `DOCX_RASTER_TYPES`
// para no tocar el resto de este handler.
const {
  RASTER_ELEMENT_TYPES,
  RASTER_ELEMENT_TYPES: DOCX_RASTER_TYPES,
  computeContentHash,
  loadCheckpoint,
  saveCheckpointPng,
  saveManifest,
  clearCheckpoint,
  waitForElementReady,
  elementReadinessSnapshot,
  waitForMountedPage,
} = require('./rasterCapturePipeline');
// Cuántas capturas `elementHandle.screenshot()` corren a la vez -- DEBE ser
// 1 (secuencial). Se probó en paralelo (5 a la vez) y produjo capturas
// directamente rotas: `elementHandle.screenshot()` de Puppeteer hace scroll
// de la página hasta que el elemento sea visible ANTES de capturar: con 5
// corriendo a la vez sobre la MISMA página, el scroll de una interfiere con
// la captura de otra -- confirmado inspeccionando visualmente los PNG de un
// .docx generado con paralelismo=5: varias imágenes salieron en negro/en
// blanco (la barra de navegación superior, o un área vacía de la página, en
// vez del gráfico real). Más lento, pero es la única forma de garantizar
// que cada captura corresponda al elemento correcto.
const DOCX_CAPTURE_BATCH_SIZE = 1;
// Fase 2 (paralelismo): cuántas páginas de Puppeteer INDEPENDIENTES capturan
// al mismo tiempo, cada una con su propio viewport/scroll -- a diferencia de
// DOCX_CAPTURE_BATCH_SIZE (que serializa capturas DENTRO de una misma
// página, por el problema de scroll compartido documentado arriba), acá no
// hay ese riesgo: cada worker tiene su propia página, su propio DOM, su
// propio estado de virtualización -- nada que interferir entre sí. Cada
// worker sigue capturando de a 1 (BATCH_SIZE=1) puertas adentro. Con
// DOCX_CAPTURE_PARALLELISM=1 el comportamiento es IDÉNTICO al pipeline
// anterior (un solo worker, sin abrir páginas extra) -- ver verificación en
// el plan aprobado.
// Default 2 (no 4): con la excepción de red interna en nginx.conf
// (`rate_limit_is_internal`) 4 debería andar bien, pero 2 es el punto de
// partida más conservador para la primera prueba en vivo tras ese cambio --
// subir a 4 (o más) es un solo env var una vez confirmado que la causa real
// del atasco (rate-limit) quedó resuelta.
const DOCX_CAPTURE_PARALLELISM = Math.max(1, parseInt(process.env.DOCX_CAPTURE_PARALLELISM || '2', 10) || 1);
// Techo por captura individual -- sin esto, un solo nodo problemático
// (ej. la superficie 3D WebGL, ya documentada más abajo como "queda en
// blanco" en el mejor caso) podría colgar la captura de ESE nodo sin límite
// y arrastrar todo el job a failed por timeout general en vez de degradar
// solo ese bloque puntual.
const DOCX_CAPTURE_TIMEOUT_MS = 12000;
const DOCX_ELEMENT_READY_TIMEOUT_MS = parseInt(
  process.env.DOCX_ELEMENT_READY_TIMEOUT_MS || '20000', 10,
);

// Un único Chromium compartido no soporta de forma fiable dos informes
// masivos a la vez: ambos jobs compiten por CPU/memoria/contextos de canvas y
// terminan provocando timeouts o TargetCloseError. El backend ya expone los
// exports como jobs asíncronos, por lo que es preferible rechazar el segundo
// inmediatamente con un código explícito (el usuario puede reintentarlo)
// antes que dejar dos trabajos "running" durante decenas de minutos y
// producir archivos incompletos.
let activeHeavyExport = null;

function tryAcquireHeavyExport(kind, jobId) {
  if (activeHeavyExport) return false;
  activeHeavyExport = { kind, jobId: jobId || null, startedAt: Date.now() };
  return true;
}

function releaseHeavyExport(kind, jobId) {
  if (activeHeavyExport
      && activeHeavyExport.kind === kind
      && activeHeavyExport.jobId === (jobId || null)) {
    activeHeavyExport = null;
  }
}

function attachBrowserDiagnostics(page, scope, jobId) {
  const prefix = `[${scope}] job=${jobId || 'sync'}`;
  const redactUrl = (raw) => {
    try {
      const parsed = new URL(raw);
      for (const key of ['token', 'access_token', 'refresh_token']) {
        if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      return parsed.toString().slice(0, 500);
    } catch {
      return String(raw).replace(/([?&](?:token|access_token|refresh_token)=)[^&]*/gi, '$1[REDACTED]').slice(0, 500);
    }
  };
  page.on('pageerror', (err) => {
    console.error(`${prefix} pageerror`, String(err && err.stack || err));
  });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.warn(`${prefix} browser_${type}`, msg.text());
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    console.warn(`${prefix} requestfailed`, JSON.stringify({
      method: request.method(),
      url: redactUrl(request.url()),
      error: failure ? failure.errorText : 'unknown',
    }));
  });
}

/** Agrega `pageFrom`/`pageTo` a la URL de navegación de `print-report` --
 * ver comentario de `prefetchAllSensorTelemetry` en print-report/main.tsx.
 * `(0, 0)` es un rango vacío a propósito (no hay página número 0): lo usa la
 * página de "descubrimiento" del handler de abajo, que solo necesita leer
 * `window.__REPORT_DOCUMENT__`, no telemetría -- sin este recorte, esa
 * página pagaría un prefetch completo del documento que nunca usa. */
function withPageRangeParam(rawUrl, pageFrom, pageTo, telemetryQuota) {
  const scoped = new URL(rawUrl);
  scoped.searchParams.set('pageFrom', String(pageFrom));
  scoped.searchParams.set('pageTo', String(pageTo));
  // Cuota de telemetría reducida por worker (ver `setQuota` en api.ts) --
  // solo se pasa cuando hay MÁS de un worker corriendo a la vez: los 16
  // cupos / 50ms default de la cola están calibrados para UNA sola página
  // contra el límite de Nginx (20 r/s); con N workers en paralelo, cada uno
  // con su propia cola independiente, la demanda agregada sin este recorte
  // es N veces esa cuota -- reproducido en vivo: con 4 workers sin esto,
  // ráfaga sostenida de 429 desde el arranque y CERO capturas en varios
  // minutos (el prefetch de cada worker se quedaba reintentando sin avanzar
  // nunca, ver comentario de `setQuota`).
  if (telemetryQuota) {
    scoped.searchParams.set('telemetryConcurrency', String(telemetryQuota.maxConcurrency));
    scoped.searchParams.set('telemetryMinIntervalMs', String(telemetryQuota.minIntervalMs));
  }
  return scoped.toString();
}

/** Abre y prepara una página de Puppeteer ADICIONAL para un worker de
 * captura DOCX en paralelo (Fase 2) -- mismo patrón que `openReportPage`
 * (usado por el pipeline PDF) pero con diagnóstico rotulado por worker, para
 * no mezclar sus logs con los del worker 0 (la página `page` original del
 * handler, que ya trae su propio `attachBrowserDiagnostics`). */
/** Lanza un Chromium DEDICADO (proceso completo, no una pestaña más sobre el
 * navegador compartido de `getBrowser()`) para UN worker de captura DOCX.
 * Por qué: con 2 workers como pestañas del MISMO proceso Chromium (más CPU
 * asignada al contenedor, apertura secuencial para evitar la condición de
 * carrera de CDP -- ver comentarios de más abajo), el ritmo de captura NO
 * mejoró sobre el pipeline secuencial de 1 sola página (medido en vivo:
 * ~0.82 elementos/seg con 2 workers vs ~0.85 elementos/seg con 1) pese a
 * tener CPU de sobra y sin ningún rate-limit de por medio -- indica que el
 * PROCESO Chromium compartido serializa algo internamente entre pestañas
 * (su compositor/GPU-por-software, o el despacho de comandos CDP) que no se
 * ve en `docker stats` como contención de CPU. Un proceso Chromium
 * COMPLETAMENTE separado por worker (misma técnica que ya usa la app: cada
 * export DOCX/PDF/PPTX corre en su Chromium, ver `getBrowser()`) elimina esa
 * posible serialización compartida de raíz. */
async function launchDedicatedExportBrowser() {
  return puppeteer.launch({
    headless: 'new',
    protocolTimeout: RENDER_TIMEOUT_MS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

/** Genérico entre DOCX/PPTX/PDF -- `scope` es solo la etiqueta de
 * diagnóstico (`attachBrowserDiagnostics`), el resto del setup (viewport,
 * media type, navegación, espera de render inicial) es idéntico para los
 * tres pipelines. */
async function openExportWorkerPage(url, scope, jobId, workerIndex) {
  const workerBrowser = await launchDedicatedExportBrowser();
  const workerPage = await workerBrowser.newPage();
  attachBrowserDiagnostics(workerPage, scope, `${jobId}#w${workerIndex}`);
  await workerPage.emulateMediaType('print');
  await workerPage.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  // 2026-09-13 (SPEC-007 T15/O3, ver ADR-183/184): 'domcontentloaded' en vez
  // de 'networkidle0' -- ver comentario completo en `openReportPage`.
  // Especialmente relevante ACÁ: este worker se reabre cada
  // `PAGES_PER_BROWSER_PAGE` (40) hojas en documentos grandes, así que los
  // ~1.6s desperdiciados por apertura se multiplican por cada reciclaje (un
  // documento de 2000+ páginas recicla decenas de veces por worker) -- este
  // fix ayuda tanto a documentos chicos (O3) como a los grandes que
  // motivaron la arquitectura de virtualización. Medido en vivo sin
  // regresión: 378 páginas/1120 gráficos, 0 fallos de captura.
  await workerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
  await waitForReportRender(workerPage);
  return { browser: workerBrowser, page: workerPage };
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function runInBatches(items, batchSize, run) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(run));
  }
}

// ── Progreso de job (barra visible para el usuario) ────────────────────────
// A diferencia de los checkpoints (indexados por HASH DEL CONTENIDO, para
// sobrevivir reintentos), esto es solo para que el FRONTEND muestre una
// barra de avance mientras el export corre -- indexado por el `job_id` REAL
// (el que ya conoce el backend/frontend vía `report_export_job`), en un
// archivo JSON chico sobre el MISMO volumen compartido
// (`./data:/data` -- ver EXPORT_DATA_ROOT) que ya monta el backend C++, así
// que este último puede leerlo directo del disco sin necesitar un endpoint
// HTTP nuevo en el sidecar ni credenciales cruzadas. Se actualiza con la
// MISMA cadencia que los logs `progress` ya existentes -- no agrega
// escrituras de disco extra significativas, solo values agregados a esas
// mismas. `jobId` puede venir `null` (el `/render` síncrono no tiene un job
// real que trackear, ver `renderReportPages`) -- en ese caso no se escribe
// nada, no hay frontend haciendo polling de un job que no existe.
const JOB_PROGRESS_ROOT = path.join(EXPORT_DATA_ROOT, 'progress');

async function saveJobProgress(jobId, captured, total) {
  if (!jobId) return;
  try {
    await fs.mkdir(JOB_PROGRESS_ROOT, { recursive: true });
    const tmpPath = path.join(JOB_PROGRESS_ROOT, `${jobId}.json.tmp`);
    const finalPath = path.join(JOB_PROGRESS_ROOT, `${jobId}.json`);
    await fs.writeFile(tmpPath, JSON.stringify({ captured, total, updatedAt: new Date().toISOString() }));
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    console.warn('[EXPORT] job_progress_save_failed', jobId, String(err));
  }
}

async function clearJobProgress(jobId) {
  if (!jobId) return;
  await fs.rm(path.join(JOB_PROGRESS_ROOT, `${jobId}.json`), { force: true }).catch(() => {});
}

// Checkpoints/hash de contenido: ver rasterCapturePipeline.js (importado
// arriba) -- compartido con /render-pptx.

app.post('/render-docx', async (req, res) => {
  const { url, job_id: jobId, layout } = req.body || {};
  if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'url_required' });
  if (typeof jobId !== 'string' || !jobId) return res.status(400).json({ error: 'job_id_required' });
  // 'absolute' (default, ADR-139): cada bloque del lienzo se ancla a su
  // x/y/w/h exacto (w:framePr) -- máxima fidelidad de layout, pero el
  // resultado en Word son cuadros de texto independientes, no texto que
  // fluye. 'flow' (pedido explícito 2026-09-18): reflowa todo como un
  // documento Word tradicional -- ver reportDocxBuilder.js::buildPageSection.
  const docxLayout = layout === 'flow' ? 'flow' : 'absolute';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (parsed.hostname !== ALLOWED_HOST) return res.status(400).json({ error: 'host_not_allowed' });

  if (!tryAcquireHeavyExport('docx', jobId)) {
    const active = activeHeavyExport;
    console.warn('[DOCX_EXPORT] export_busy', JSON.stringify({
      rejectedJobId: jobId,
      activeKind: active && active.kind,
      activeJobId: active && active.jobId,
      activeElapsedMs: active ? Date.now() - active.startedAt : null,
    }));
    return res.status(429).json({ error: 'export_busy' });
  }

  let page;
  const exportStartedAt = Date.now();
  // Referenciados desde el `catch` de abajo para un flush de último recurso
  // -- declarados afuera porque el `try`/`catch` son bloques distintos y el
  // `const` de más abajo no sería visible ahí.
  let checkpointHashForCleanup = null;
  let manifestEntriesForCleanup = null;
  let checkpointTotalTargets = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    attachBrowserDiagnostics(page, 'DOCX_EXPORT', `${jobId}#discovery`);
    await page.emulateMediaType('print');
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    // Rango vacío (0,0) a propósito -- esta página solo lee
    // `window.__REPORT_DOCUMENT__`/virtualización para armar el plan de
    // captura, la captura real la hacen los workers de más abajo (cada uno
    // con su propia página, navegada con SU rango real). Sin este recorte
    // pagaría un prefetch completo de telemetría que nunca usa.
    // 2026-09-13: 'domcontentloaded' en vez de 'networkidle0' -- ver comentario
    // completo en `openReportPage` (mismo hallazgo real).
    await page.goto(withPageRangeParam(url, 0, 0), { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    await waitForReportRender(page);

    // DIAGNÓSTICO TEMPORAL -- reproducido en vivo: "report_document_unavailable"
    // en un informe grande (144p/420 diagramas) pese a que GET /api/reports/{id}
    // responde 200 (confirmado en logs de nginx). Instrumentación acotada para
    // capturar el estado real antes de descartarlo.
    const diag = await page.evaluate(() => ({
      pdfReady: window.__PDF_READY__,
      hasDoc: typeof window.__REPORT_DOCUMENT__,
      docPagesLen: window.__REPORT_DOCUMENT__ && Array.isArray(window.__REPORT_DOCUMENT__.pages) ? window.__REPORT_DOCUMENT__.pages.length : null,
      bodyText: document.body ? document.body.innerText.slice(0, 300) : null,
    }));
    console.warn('[DOCX_EXPORT] diag:', JSON.stringify(diag));

    const reportDocument = await page.evaluate(() => window.__REPORT_DOCUMENT__ || null);
    if (!reportDocument || !Array.isArray(reportDocument.pages)) {
      return res.status(422).json({ error: 'report_document_unavailable' });
    }
    const sessionChrome = await page.evaluate(() => window.__REPORT_SESSION_CHROME__ || {});

    const virtualized = await isExportVirtualized(page);
    const allTargets = [];
    for (const docPage of reportDocument.pages) {
      for (const el of docPage.elements || []) {
        if (DOCX_RASTER_TYPES.has(el.type)) allTargets.push({ el, pageNumber: docPage.page_number });
      }
    }

    // Checkpoint reanudable (ver comentario de `loadCheckpoint` más arriba):
    // indexado por HASH DEL CONTENIDO, no por jobId -- cualquier intento
    // previo sobre este MISMO documento (aunque haya sido con otro jobId)
    // se reutiliza acá, sin volver a tocar el navegador para esos elementos.
    const contentHash = computeContentHash(reportDocument);
    const checkpoint = await loadCheckpoint(contentHash);
    const rasterAssets = checkpoint.rasterAssets;
    const imageAssets = checkpoint.imageAssets;
    const alreadyCaptured = new Set([...rasterAssets.keys(), ...imageAssets.keys()]);
    const captureTargets = allTargets.filter(({ el }) => !alreadyCaptured.has(el.id));
    // Entradas ya persistidas + las que se agreguen en este run -- se
    // reescribe el manifest periódicamente con esta lista completa (no solo
    // lo nuevo), así un run interrumpido dos veces seguidas sigue
    // reanudando correctamente.
    const manifestEntries = allTargets
      .filter(({ el }) => alreadyCaptured.has(el.id))
      .map(({ el }) => ({ id: el.id, type: el.type }));
    // `manifestEntries` se muta in-place (push) más abajo, así que esta
    // misma referencia sigue reflejando el estado real aunque el `catch`
    // externo la lea después de un fallo a mitad de captura.
    checkpointHashForCleanup = contentHash;
    manifestEntriesForCleanup = manifestEntries;
    checkpointTotalTargets = allTargets.length;
    let sinceLastManifestSave = 0;
    const flushManifest = () => saveManifest(contentHash, manifestEntries, allTargets.length).catch((err) => {
      console.warn('[DOCX_EXPORT] checkpoint_manifest_save_failed', String(err));
    });

    // Informe grande (ver EXPORT_VIRTUALIZATION_PAGE_THRESHOLD en
    // ReadOnlyViewer.tsx): las capturas ya recorren `captureTargets` en
    // orden de página (armado arriba en ese mismo orden) -- antes de
    // capturar el PRIMER elemento de una página nueva, se monta esa página
    // (y se desmonta la anterior). `lastActivatedPage` evita repetir el
    // paso para cada elemento de una misma página (lo normal, varias
    // capturas por página). DOCX_CAPTURE_BATCH_SIZE=1 (secuencial, ver
    // comentario de esa constante) garantiza que esta variable compartida
    // nunca se lea/escriba desde dos capturas a la vez.
    // Contadores COMPARTIDOS entre workers (Fase 2): cada `+= 1` es una
    // operación síncrona -- Node es de un solo hilo, así que aunque varios
    // workers "corran a la vez" (en realidad se intercalan en el mismo
    // event loop), nunca hay dos incrementos a mitad de ejecutarse al mismo
    // tiempo. Ídem `rasterAssets`/`imageAssets`.set() y `manifestEntries`.push()
    // más abajo -- seguros sin lock explícito por el mismo motivo.
    let readyTimeouts = 0;
    let capturedCount = 0;
    let captureFailures = 0;
    let activatedPageCount = 0;

    // Partición de `captureTargets` (ya filtrado por el checkpoint) en
    // `DOCX_CAPTURE_PARALLELISM` tramos contiguos -- contiguos porque el
    // array ya está en orden de página (armado arriba en ese orden), así
    // cada worker recorre un rango de páginas seguido en vez de saltar.
    // Con DOCX_CAPTURE_PARALLELISM=1 da exactamente 1 tramo = el array
    // completo, igual que el pipeline anterior.
    const parallelism = Math.max(1, Math.min(DOCX_CAPTURE_PARALLELISM, captureTargets.length || 1));
    const chunkSize = Math.max(1, Math.ceil(captureTargets.length / parallelism));
    const chunks = [];
    for (let i = 0; i < captureTargets.length; i += chunkSize) {
      chunks.push(captureTargets.slice(i, i + chunkSize));
    }
    console.info('[DOCX_EXPORT] capture_start', JSON.stringify({
      jobId,
      contentHash,
      pages: reportDocument.pages.length,
      targets: allTargets.length,
      capturedFromCheckpoint: alreadyCaptured.size,
      remaining: captureTargets.length,
      parallelism: chunks.length,
      virtualized,
      elementReadyTimeoutMs: DOCX_ELEMENT_READY_TIMEOUT_MS,
    }));
    await saveJobProgress(jobId, alreadyCaptured.size, allTargets.length);

    /** Recorre `targets` (un tramo de `captureTargets`) sobre `workerPage`,
     * su PROPIA página de Puppeteer -- estado de activación de página
     * (`lastActivatedPage`, contadores de diagnóstico acotados) es LOCAL a
     * cada worker a propósito, ya que cada uno navega su propio DOM. Mismo
     * cuerpo por-elemento que el pipeline anterior (activar página →
     * esperar listo → `handle.screenshot()` → guardar en checkpoint), solo
     * que ahora puede correr en paralelo con otras invocaciones de esta
     * misma función sobre páginas distintas. */
    async function captureOnPage(workerPage, targets, workerLabel) {
      let lastActivatedPage = null;
      let virtualizationErrorLogged = 0;
      let missingHandleLogged = 0;
      await runInBatches(targets, DOCX_CAPTURE_BATCH_SIZE, async ({ el, pageNumber }) => {
        if (virtualized && pageNumber !== lastActivatedPage) {
          try {
            await setExportActivePage(workerPage, pageNumber);
            // Solo esperamos el commit/montaje de React. La disponibilidad de
            // datos/canvas se espera por elemento más abajo: un gráfico lento o
            // defectuoso ya no bloquea ni descarta toda la hoja.
            await waitForMountedPage(workerPage, pageNumber, DOCX_ELEMENT_READY_TIMEOUT_MS);
            lastActivatedPage = pageNumber;
            activatedPageCount += 1;
            if (activatedPageCount === 1 || activatedPageCount % 10 === 0) {
              const memory = process.memoryUsage();
              console.info('[DOCX_EXPORT] progress', JSON.stringify({
                jobId,
                worker: workerLabel,
                pageNumber,
                activatedPages: activatedPageCount,
                capturedThisRun: capturedCount,
                capturedFromCheckpoint: alreadyCaptured.size,
                targetsThisRun: captureTargets.length,
                readyTimeouts,
                elapsedMs: Date.now() - exportStartedAt,
                nodeRssBytes: memory.rss,
                nodeHeapUsedBytes: memory.heapUsed,
              }));
              // Fire-and-forget -- ver comentario de `saveJobProgress` más
              // arriba, nunca bloquea la captura misma.
              saveJobProgress(jobId, alreadyCaptured.size + capturedCount, allTargets.length);
            }
          } catch (activateErr) {
            // DIAGNÓSTICO TEMPORAL -- ver diag de arriba. `Promise.allSettled`
            // (runInBatches) traga este error en silencio si no se loguea acá:
            // el elemento nunca llega a `handle.screenshot()` ni a la rama
            // "captura fallida" de abajo, así que antes desaparecía sin dejar
            // ningún rastro en los logs.
            if (virtualizationErrorLogged < 5) {
              virtualizationErrorLogged += 1;
              console.warn('[DOCX_EXPORT] activar página falló', workerLabel, pageNumber, String(activateErr && activateErr.stack || activateErr));
            }
            // No repetir la misma espera por cada elemento de la hoja. Si el
            // wrapper apareció tarde, la búsqueda/captura individual todavía
            // puede recuperarse; si no, solo fallan sus elementos.
            lastActivatedPage = pageNumber;
          }
        }
        try {
          await waitForElementReady(workerPage, el.id, DOCX_ELEMENT_READY_TIMEOUT_MS);
        } catch (readyErr) {
          readyTimeouts += 1;
          let snapshot = null;
          try {
            snapshot = await elementReadinessSnapshot(workerPage, pageNumber, el.id);
          } catch (snapshotErr) {
            snapshot = { diagnosticError: String(snapshotErr) };
          }
          console.warn('[DOCX_EXPORT] element_ready_timeout', JSON.stringify({
            jobId,
            worker: workerLabel,
            pageNumber,
            elementId: el.id,
            elementType: el.type,
            error: String(readyErr),
            snapshot,
          }));
          // La señal de readiness es defensiva, no una razón para perder el
          // contenido. Se intenta screenshot: muchos canvas ya tienen un frame
          // útil aunque una callback onChartReady no se haya propagado.
        }
        const handle = await workerPage.$(`[data-element-id="${el.id}"]`);
        if (!handle) {
          // DIAGNÓSTICO TEMPORAL -- ver comentario de `virtualizationErrorLogged`
          // arriba: el job corre limpio (0 errores de activación) pero igual
          // faltan capturas. Esto confirma si el DOM realmente no tiene el nodo
          // (bug de montaje/ventana) o si es un problema de timing/selector.
          if (missingHandleLogged < 8) {
            missingHandleLogged += 1;
            try {
              const domSnapshot = await workerPage.evaluate((n, targetId) => {
                const wrappers = document.querySelectorAll('.ro-page-wrapper');
                const wrapper = document.querySelector(`.ro-page-wrapper[data-page-number="${n}"]`);
                const wrapperIds = wrapper
                  ? Array.from(wrapper.querySelectorAll('[data-element-id]')).map((node) => node.getAttribute('data-element-id'))
                  : null;
                // Qué páginas (por `data-page-number` REAL, no índice de DOM)
                // tienen algún elemento montado ahora mismo -- confirma si la
                // ventana de virtualización activa coincide con `pageNumber`.
                const mountedWrapperPageNumbers = [];
                wrappers.forEach((w) => {
                  if (w.querySelectorAll('[data-element-id]').length > 0) {
                    mountedWrapperPageNumbers.push(w.getAttribute('data-page-number'));
                  }
                });
                const anywhereMatch = document.querySelector(`[data-element-id="${targetId}"]`);
                return {
                  wrapperExists: !!wrapper,
                  wrapperElementIds: wrapperIds,
                  totalWrappers: wrappers.length,
                  foundAnywhereInDom: !!anywhereMatch,
                  mountedWrapperPageNumbers,
                };
              }, pageNumber, el.id);
              console.warn(
                '[DOCX_EXPORT] handle nulo para',
                el.id,
                'worker', workerLabel,
                'tipo', el.type,
                'pageNumber', pageNumber,
                'lastActivatedPage', lastActivatedPage,
                'snapshot', JSON.stringify(domSnapshot),
              );
            } catch (diagErr) {
              console.warn('[DOCX_EXPORT] handle nulo (diag falló)', el.id, String(diagErr));
            }
          }
          return;
        }
        try {
          const png = await withTimeout(handle.screenshot({ type: 'png' }), DOCX_CAPTURE_TIMEOUT_MS, 'screenshot_timeout');
          if (el.type === 'image') imageAssets.set(el.id, png);
          else rasterAssets.set(el.id, png);
          capturedCount += 1;
          // Persistir AHORA, no solo en el Map en memoria -- si el proceso
          // muere un instante después, esta captura ya sobrevive en disco
          // (ver comentario de `saveCheckpointPng` más arriba).
          try {
            await saveCheckpointPng(contentHash, el.id, png);
            manifestEntries.push({ id: el.id, type: el.type });
            sinceLastManifestSave += 1;
            if (sinceLastManifestSave >= 50) {
              sinceLastManifestSave = 0;
              await flushManifest();
            }
          } catch (checkpointErr) {
            // Fallo al escribir el checkpoint NO debe perder la captura ya
            // hecha (sigue en `rasterAssets`/`imageAssets` para ESTE run) --
            // solo significa que un reintento futuro la volvería a capturar.
            console.warn('[DOCX_EXPORT] checkpoint_png_save_failed', el.id, String(checkpointErr));
          }
        } catch (captureErr) {
          captureFailures += 1;
          console.warn('[DOCX_EXPORT] captura fallida para', el.id, 'worker', workerLabel, String(captureErr));
        }
      });
    }

    // TODOS los workers (incluido el 0) navegan con página NUEVA, acotada a
    // su propio rango de páginas -- la `page` de arriba fue solo de
    // "descubrimiento" (navegó con rango vacío, no prefetcheó nada) y la
    // cierra el `finally` externo del handler como siempre. Acotar el rango
    // es lo que evita que cada worker repita el prefetch de telemetría del
    // documento COMPLETO (ver comentario de `withPageRangeParam` y de
    // `prefetchAllSensorTelemetry` en print-report/main.tsx) -- medido en
    // vivo: sin esto, 4 workers = 4x la carga real de telemetría contra el
    // backend, sin ganancia de velocidad neta pese a correr en paralelo.
    // Cuota de telemetría por worker (ver comentario de `withPageRangeParam`):
    // repartir la cuota original (16 cupos / 50ms, calibrada para UNA sola
    // página) entre `chunks.length` workers, para que la SUMA agregada siga
    // respetando el límite real de Nginx. Con 1 solo worker (parallelism=1)
    // no se pasa nada -- la página usa el default de siempre, sin cambios.
    // Tasa agregada objetivo ~16 r/s (< 20 r/s de Nginx, con margen) repartida
    // entre `chunks.length` workers -- 1000ms / (16/N) = 62.5*N ms entre
    // arranques de CADA worker para que la SUMA de los N ritmos dé ~16 r/s.
    const telemetryQuota = chunks.length > 1
      ? {
        maxConcurrency: Math.max(1, Math.floor(16 / chunks.length)),
        minIntervalMs: Math.ceil(62.5 * chunks.length),
      }
      : null;
    // DIAGNÓSTICO TEMPORAL -- reproducido en vivo: con 2+ workers, la
    // apertura de las páginas de captura se quedó colgada 5+ minutos sin
    // ningún log/error/tráfico de red visible (0.01% CPU en el contenedor,
    // healthcheck igual respondía `connected:true`). Acotar cada apertura a
    // un timeout MUCHO más corto que el límite global (RENDER_TIMEOUT_MS,
    // 10 min) da una falla rápida y diagnosticable en vez de un silencio
    // largo indistinguible de "está progresando lento".
    const WORKER_OPEN_TIMEOUT_MS = 120000;
    // Abrir las N páginas de a UNA por vez (no `Promise.all` simultáneo):
    // reproducido en vivo -- abrir 2+ páginas de Puppeteer A LA VEZ contra el
    // mismo Chromium compartido (`getBrowser()`) se colgó de forma
    // silenciosa (0.01% CPU, sin error, sin tráfico) en un worker distinto
    // cada vez (worker 1 en un intento, worker 0 en el siguiente) -- patrón
    // típico de una condición de carrera en el protocolo CDP al crear/
    // adjuntar varios targets simultáneamente, no un problema de datos ni de
    // rango de páginas. Abrir de a una es barato (segundos, una sola vez por
    // worker) frente a la duración total de la captura -- el paralelismo
    // real (y su ganancia de velocidad) sigue intacto: es la CAPTURA de abajo
    // la que corre en simultáneo sobre las N páginas ya abiertas.
    const workerPages = [];
    const workerBrowsers = [];
    for (let idx = 0; idx < chunks.length; idx += 1) {
      const chunk = chunks[idx];
      const pageNumbers = chunk.map(({ pageNumber }) => pageNumber);
      const pageFrom = Math.min(...pageNumbers);
      const pageTo = Math.max(...pageNumbers);
      console.info('[DOCX_EXPORT] worker_open_start', JSON.stringify({
        jobId, worker: idx, pageFrom, pageTo, targetsInChunk: chunk.length, telemetryQuota,
      }));
      const { browser: workerBrowser, page: workerPage } = await withTimeout(
        openExportWorkerPage(withPageRangeParam(url, pageFrom, pageTo, telemetryQuota), 'DOCX_EXPORT', jobId, idx),
        WORKER_OPEN_TIMEOUT_MS,
        `worker_open_timeout(worker=${idx})`,
      );
      console.info('[DOCX_EXPORT] worker_open_done', JSON.stringify({ jobId, worker: idx }));
      workerBrowsers.push(workerBrowser);
      workerPages.push(workerPage);
    }
    try {
      await Promise.all(chunks.map((chunk, idx) => captureOnPage(workerPages[idx], chunk, idx)));
    } finally {
      // Cierra la página Y el proceso Chromium DEDICADO de cada worker (ver
      // `launchDedicatedExportBrowser`) -- a diferencia de `page` (la de
      // descubrimiento, sobre el navegador COMPARTIDO que cierra el
      // `finally` externo del handler), estos procesos son enteramente
      // propios de este job y nadie más los usa.
      await Promise.all(workerPages.map((workerPage) => workerPage.close().catch(() => {})));
      await Promise.all(workerBrowsers.map((workerBrowser) => workerBrowser.close().catch(() => {})));
    }
    // Último flush -- asegura que el manifest refleje TODO lo capturado en
    // este run, incluso si el conteo no llegó a un múltiplo de 50 desde el
    // último guardado periódico.
    await flushManifest();

    const buffer = await buildReportDocx(reportDocument, { session: sessionChrome, imageAssets, rasterAssets, layout: docxLayout });

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.docx`);
    await fs.writeFile(outPath, buffer);
    const totalCaptured = alreadyCaptured.size + capturedCount;
    console.info('[DOCX_EXPORT] export_complete', JSON.stringify({
      jobId,
      contentHash,
      pages: reportDocument.pages.length,
      targets: allTargets.length,
      capturedFromCheckpoint: alreadyCaptured.size,
      capturedThisRun: capturedCount,
      captured: totalCaptured,
      placeholders: allTargets.length - totalCaptured,
      readyTimeouts,
      captureFailures,
      outputBytes: buffer.length,
      elapsedMs: Date.now() - exportStartedAt,
    }));
    // Ya no hace falta el checkpoint -- el .docx final quedó escrito. Un
    // fallo al borrarlo no debe tumbar la respuesta ya exitosa (a lo sumo
    // queda un directorio huérfano en disco, se limpia solo).
    await clearCheckpoint(contentHash).catch((clearErr) => {
      console.warn('[DOCX_EXPORT] checkpoint_clear_failed', String(clearErr));
    });
    await clearJobProgress(jobId);
    res.json({ storage_path: outPath });
  } catch (err) {
    console.error('[DOCX_EXPORT] render_failed:', err && err.stack ? err.stack : err);
    // Último recurso: si ya habíamos empezado a capturar (el hash existe),
    // dejar el manifest al día con lo capturado hasta el momento del fallo,
    // aunque no haya llegado al próximo flush periódico de 50 -- así un
    // reintento posterior sobre el mismo contenido no pierde este progreso.
    if (checkpointHashForCleanup) {
      await saveManifest(checkpointHashForCleanup, manifestEntriesForCleanup, checkpointTotalTargets).catch((flushErr) => {
        console.warn('[DOCX_EXPORT] checkpoint_manifest_final_flush_failed', String(flushErr));
      });
    }
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseHeavyExport('docx', jobId);
  }
});

// POST /render-xlsx  { url: string, job_id: string }
//   → { storage_path: string } — ruta (dentro de EXPORT_DATA_ROOT) del .xlsx
//     generado.
//
// Export nuevo (no existía) -- alcance explícito: solo los bloques `table`
// del informe (ver reportXlsxBuilder.js), sin fase de captura raster (no
// toca `chart`/`image`/`cover`/`sensor_multi_chart`) -- así que, a
// diferencia de /render-docx y /render-pptx, esta ruta no necesita workers
// paralelos ni checkpoint reanudable: solo lee `window.__REPORT_DOCUMENT__`
// de la página de descubrimiento y arma el workbook, rápido incluso en
// informes grandes (las tablas de un informe pesan órdenes de magnitud menos
// que sus gráficos/imágenes).
app.post('/render-xlsx', async (req, res) => {
  const { url, job_id: jobId } = req.body || {};
  if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'url_required' });
  if (typeof jobId !== 'string' || !jobId) return res.status(400).json({ error: 'job_id_required' });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (parsed.hostname !== ALLOWED_HOST) return res.status(400).json({ error: 'host_not_allowed' });

  if (!tryAcquireHeavyExport('xlsx', jobId)) {
    const active = activeHeavyExport;
    console.warn('[XLSX_EXPORT] export_busy', JSON.stringify({
      rejectedJobId: jobId,
      activeKind: active && active.kind,
      activeJobId: active && active.jobId,
      activeElapsedMs: active ? Date.now() - active.startedAt : null,
    }));
    return res.status(429).json({ error: 'export_busy' });
  }

  let page;
  const exportStartedAt = Date.now();
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    attachBrowserDiagnostics(page, 'XLSX_EXPORT', `${jobId}#discovery`);
    await page.emulateMediaType('print');
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    // Rango vacío (0,0) a propósito -- esta ruta nunca activa páginas
    // virtualizadas ni toca telemetría, solo lee el JSON del documento (ver
    // comentario de `withPageRangeParam`).
    await page.goto(withPageRangeParam(url, 0, 0), { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    await waitForReportRender(page);

    const reportDocument = await page.evaluate(() => window.__REPORT_DOCUMENT__ || null);
    if (!reportDocument || !Array.isArray(reportDocument.pages)) {
      return res.status(422).json({ error: 'report_document_unavailable' });
    }

    const workbook = buildReportXlsx(reportDocument);
    const buffer = await workbook.xlsx.writeBuffer();

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.xlsx`);
    await fs.writeFile(outPath, buffer);
    console.info('[XLSX_EXPORT] export_complete', JSON.stringify({
      jobId,
      pages: reportDocument.pages.length,
      sheets: workbook.worksheets.length,
      outputBytes: buffer.length,
      elapsedMs: Date.now() - exportStartedAt,
    }));
    res.json({ storage_path: outPath });
  } catch (err) {
    console.error('[XLSX_EXPORT] render_failed:', err && err.stack ? err.stack : err);
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseHeavyExport('xlsx', jobId);
  }
});

// Compone un MP4 "corte seco" (sin transición) con el demuxer concat de
// ffmpeg: cada imagen se muestra `durations[i]` segundos (permite duración
// por-diapositiva distinta, necesario cuando una tiene narración más larga
// que la duración base — ver /render-video). Truco conocido del demuxer: el
// `duration` de la ÚLTIMA entrada se ignora salvo que el archivo se repita
// una vez más al final sin `duration` — si no, el último slide dura 0.
async function buildCutVideo(imagePaths, durations, outPath, tmpDir) {
  const listPath = path.join(tmpDir, 'concat_list.txt');
  const escapePath = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const lines = [];
  imagePaths.forEach((p, i) => {
    lines.push(`file '${escapePath(p)}'`);
    lines.push(`duration ${durations[i]}`);
  });
  lines.push(`file '${escapePath(imagePaths[imagePaths.length - 1])}'`);
  await fs.writeFile(listPath, lines.join('\n'));
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vsync', 'vfr', '-pix_fmt', 'yuv420p', '-c:v', 'libx264',
    outPath,
  ]);
}

// Construye la pista de audio completa (una por diapositiva, concatenadas):
// si hay narración grabada para esa página, se usa su audio (recortado/
// rellenado con silencio hasta `durations[i]`, que ya fue calculada para
// alcanzar al menos la duración del audio); si no, silencio puro. El
// resultado dura exactamente lo mismo que el video mudo generado por
// buildCutVideo con los MISMOS `durations`, así el mux final (`-shortest`)
// no recorta ni video ni audio.
async function buildNarrationAudioTrack(pageNumbers, durations, narrationByPage, outPath, tmpDir) {
  const segmentPaths = [];
  for (let i = 0; i < pageNumbers.length; i += 1) {
    const narration = narrationByPage.get(pageNumbers[i]);
    const segPath = path.join(tmpDir, `audio_seg_${String(i).padStart(4, '0')}.wav`);
    if (narration && narration.storage_uri) {
      await execFileAsync('ffmpeg', [
        '-y', '-i', narration.storage_uri,
        '-af', `apad=whole_dur=${durations[i]}`,
        '-t', String(durations[i]),
        '-ar', '44100', '-ac', '2',
        segPath,
      ]);
    } else {
      await execFileAsync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', String(durations[i]),
        segPath,
      ]);
    }
    segmentPaths.push(segPath);
  }
  const listPath = path.join(tmpDir, 'audio_concat_list.txt');
  const escapePath = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
  await fs.writeFile(listPath, segmentPaths.map((p) => `file '${escapePath(p)}'`).join('\n'));
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
}

// Mezcla el video mudo (imágenes) con la pista de audio de narración ya
// compuesta. IMPORTANTE: NO usar `-c:v copy` aquí — se verificó a mano con
// ffmpeg real que copiar el stream de video VFR (el "slideshow" de
// buildCutVideo tiene muy pocos paquetes reales, uno por diapositiva, con
// duraciones de presentación largas entre ellos) combinado con `-shortest`
// trunca contenido visual real (quedaba en ~4s de un video de 5.5s, con
// `ffprobe`/`nb_read_frames` confirmando que los últimos paquetes de video
// se perdían) — un problema de recorte real, no solo un metadato
// desactualizado. Re-codificar a framerate constante (`-r 25`) en este paso
// resuelve el truncamiento (verificado extrayendo el frame real en varios
// timestamps y confirmando el color de cada diapositiva).
async function muxVideoWithAudio(silentVideoPath, audioTrackPath, outPath) {
  await execFileAsync('ffmpeg', [
    '-y', '-i', silentVideoPath, '-i', audioTrackPath,
    '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
    outPath,
  ]);
}

// Compone un MP4 con fundido cruzado entre diapositivas consecutivas
// (filtro xfade, encadenado): cada imagen se carga como un input en loop de
// `durationSec`, y cada transición sucesiva empieza en el offset acumulado
// (duración mostrada - superposición del fundido). Verificado a mano con
// ffmpeg real antes de escribir esto (offsets/duración de salida esperados).
async function buildCrossfadeVideo(imagePaths, durationSec, transitionSec, outPath) {
  const args = ['-y'];
  for (const p of imagePaths) {
    args.push('-loop', '1', '-t', String(durationSec), '-i', p);
  }
  const n = imagePaths.length;
  let filter = '';
  let prevLabel = '0';
  let cumulativeOffset = durationSec - transitionSec;
  for (let i = 1; i < n; i += 1) {
    const outLabel = i === n - 1 ? 'v' : `v${i}`;
    filter += `[${prevLabel}][${i}]xfade=transition=fade:duration=${transitionSec.toFixed(3)}:offset=${cumulativeOffset.toFixed(3)}[${outLabel}];`;
    prevLabel = outLabel;
    cumulativeOffset += durationSec - transitionSec;
  }
  filter = filter.replace(/;$/, '');
  args.push('-filter_complex', filter, '-map', `[${prevLabel}]`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', outPath);
  await execFileAsync('ffmpeg', args);
}

// POST /render-video  { pptx_path: string, job_id: string,
//                        slide_duration_seconds?: number, transition?: 'cut'|'crossfade' }
//   → { storage_path: string } — ruta (dentro de EXPORT_DATA_ROOT) del .mp4
//     generado a partir de los frames de `SLIDE_PREVIEW_ROOT` que
//     `captureSlidePreviewsForVideo` ya dejó listos durante /render-pptx (uno
//     por diapositiva) — sin volver a lanzar Chromium ni a renderizar nada.
//     Ya NO se sacan del propio .pptx: desde que /render-pptx lo arma
//     nativamente (reportPptxBuilder.js), una diapositiva puede tener 0..N
//     imágenes propias, no exactamente 1 "fondo de página completa".
//
// Trade-off de infraestructura (documentado, no resuelto aquí): ffmpeg no
// necesita Chromium y comparte el límite de CPU/memoria de este contenedor
// con /render y /render-pptx (docker-compose.yml: 1 CPU / 1024M) — si la
// carga de video se vuelve significativa, separar a un servicio
// `video-export-service` liviano (node:20-slim + ffmpeg, sin Puppeteer) es
// un cambio de infraestructura después, no una reescritura (el backend C++
// ya separa BEEMETRY_VIDEO_EXPORT_TIMEOUT_MS/gVideoExportUrl de gPdfExportUrl).
app.post('/render-video', async (req, res) => {
  const {
    pptx_path: pptxPath,
    job_id: jobId,
    slide_duration_seconds: rawDuration,
    transition: rawTransition,
    narration: rawNarration,
  } = req.body || {};

  if (typeof pptxPath !== 'string' || !pptxPath) {
    return res.status(400).json({ error: 'pptx_path_required' });
  }
  if (typeof jobId !== 'string' || !jobId) {
    return res.status(400).json({ error: 'job_id_required' });
  }

  // pptx_path lo genera ESTE MISMO servicio en /render-pptx y el backend C++
  // solo lo reenvía tal cual (viene de report_export_job.storage_uri, nunca
  // lo escribe un cliente) — igual se valida en profundidad que quede
  // dentro de EXPORT_DATA_ROOT antes de leerlo, por defensa en profundidad.
  const resolvedPptxPath = path.resolve(pptxPath);
  const resolvedRoot = path.resolve(EXPORT_DATA_ROOT);
  if (resolvedPptxPath !== resolvedRoot && !resolvedPptxPath.startsWith(resolvedRoot + path.sep)) {
    return res.status(400).json({ error: 'pptx_path_outside_export_root' });
  }
  // Igual chequeo para cada storage_uri de narración (también los escribe
  // este backend/sidecar, nunca un cliente, pero se valida en profundidad).
  const narrationList = Array.isArray(rawNarration) ? rawNarration : [];
  for (const n of narrationList) {
    if (n && typeof n.storage_uri === 'string' && n.storage_uri) {
      const resolvedAudioPath = path.resolve(n.storage_uri);
      if (resolvedAudioPath !== resolvedRoot && !resolvedAudioPath.startsWith(resolvedRoot + path.sep)) {
        return res.status(400).json({ error: 'narration_path_outside_export_root' });
      }
    }
  }

  const baseDurationSec = Math.min(Math.max(Number(rawDuration) || 4, 1), 30);
  // Solo 'recorded_audio' con storage_uri es narración usable hoy —
  // 'tts_from_notes' sin audio (no hay proveedor TTS integrado) se ignora,
  // la página queda muda igual que si no tuviera narración.
  const narrationByPage = new Map();
  for (const n of narrationList) {
    if (n && n.kind === 'recorded_audio' && n.storage_uri && Number.isFinite(n.page_number)) {
      narrationByPage.set(n.page_number, n);
    }
  }
  const hasNarration = narrationByPage.size > 0;
  // El fundido cruzado no tiene una forma simple de mantener el audio
  // sincronizado con el solapamiento visual entre diapositivas (ver
  // buildCrossfadeVideo) — con narración se fuerza 'cut', donde cada
  // diapositiva tiene un inicio/fin exacto y la pista de audio compuesta
  // (buildNarrationAudioTrack) queda perfectamente alineada.
  const transition = hasNarration ? 'cut' : (rawTransition === 'crossfade' ? 'crossfade' : 'cut');

  let tmpDir;
  try {
    // Los frames vienen de `SLIDE_PREVIEW_ROOT` (ver
    // `captureSlidePreviewsForVideo`, disparado por /render-pptx cuando
    // `layoutMode==='presentation'`), NO del .pptx mismo -- desde que
    // /render-pptx arma el .pptx nativamente (0..N imágenes por diapositiva,
    // ver reportPptxBuilder.js), ya no hay exactamente una imagen de fondo
    // por diapositiva que extraer del zip. `pptxJobId` se deriva del nombre
    // de archivo de `pptx_path` (`EXPORT_DATA_ROOT/<jobId>.pptx`, así lo
    // escribe siempre /render-pptx) -- mismo `jobId` bajo el que se guardaron
    // los previews de ESE job.
    const pptxJobId = path.basename(resolvedPptxPath, path.extname(resolvedPptxPath));
    const previewDir = path.join(SLIDE_PREVIEW_ROOT, pptxJobId);
    let previewFiles;
    try {
      previewFiles = await fs.readdir(previewDir);
    } catch {
      previewFiles = [];
    }
    const previewEntries = previewFiles
      .map((name) => {
        const match = /^(\d+)\.png$/i.exec(name);
        return match ? { name, pageNumber: parseInt(match[1], 10) } : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (previewEntries.length === 0) {
      return res.status(422).json({ error: 'no_slide_previews_for_video' });
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-video-'));
    const imagePaths = [];
    const pageNumbers = [];
    for (const { name, pageNumber } of previewEntries) {
      const imgPath = path.join(tmpDir, `slide_${String(pageNumber).padStart(4, '0')}.png`);
      await fs.copyFile(path.join(previewDir, name), imgPath);
      imagePaths.push(imgPath);
      pageNumbers.push(pageNumber);
    }

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.mp4`);

    if (!hasNarration) {
      const durations = imagePaths.map(() => baseDurationSec);
      if (transition === 'crossfade' && imagePaths.length > 1) {
        const transitionSec = Math.min(0.6, baseDurationSec / 2);
        await buildCrossfadeVideo(imagePaths, baseDurationSec, transitionSec, outPath);
      } else {
        await buildCutVideo(imagePaths, durations, outPath, tmpDir);
      }
    } else {
      // Cada diapositiva dura al menos lo que dura su narración (+ margen),
      // para no cortar el audio grabado — la duración base solo aplica a
      // las páginas sin narración.
      const NARRATION_PAD_SEC = 0.5;
      const durations = pageNumbers.map((pn) => {
        const n = narrationByPage.get(pn);
        const narrationDur = n && Number(n.duration_seconds) > 0 ? Number(n.duration_seconds) : 0;
        return narrationDur > 0 ? Math.max(baseDurationSec, narrationDur + NARRATION_PAD_SEC) : baseDurationSec;
      });
      const silentVideoPath = path.join(tmpDir, 'video_silent.mp4');
      const audioTrackPath = path.join(tmpDir, 'audio_track.wav');
      await buildCutVideo(imagePaths, durations, silentVideoPath, tmpDir);
      await buildNarrationAudioTrack(pageNumbers, durations, narrationByPage, audioTrackPath, tmpDir);
      await muxVideoWithAudio(silentVideoPath, audioTrackPath, outPath);
    }

    res.json({ storage_path: outPath });
  } catch (err) {
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

const httpServer = app.listen(PORT, () => {
  console.log(`[pdf-export-service] listening on :${PORT} (allowed host: ${ALLOWED_HOST})`);
});
// Node (desde v18) impone techos de servidor HTTP por defecto pensados para
// APIs normales de baja latencia -- `requestTimeout` (300000ms/5min) y
// `headersTimeout` (60000ms) matan la conexión aunque el handler siga
// procesando (nada de esto lo cubre RENDER_TIMEOUT_MS, que es un timeout
// nuestro DENTRO de Puppeteer, no del socket HTTP de Express). Reproducido
// en vivo: /render de un informe de 144 páginas conecta rápido, queda
// enteramente OCIOSO en este socket ~5-6 min mientras Puppeteer renderiza
// (sin bytes yendo en ninguna dirección), y justo al terminar -- cuando
// Express por fin llama a res.send() con los ~9.5MB del PDF -- el socket ya
// había sido cerrado por Node por su cuenta: el backend (cliente HTTP de
// este sidecar) recibía status 200 con el cuerpo vacío/truncado (mismo
// timing en 3 corridas: 345947/345818/345292ms, todas justo pasado el
// techo de 300000ms de `requestTimeout`). DOCX/PPTX no lo sufrían porque
// corren como job async (el backend solo hace polling corto de estado, la
// conexión larga vive del lado del sidecar hacia SÍ MISMO/el navegador, no
// como cliente HTTP saliente con este mismo límite). Deshabilitar estos
// techos (0 = sin límite) es seguro acá: cada request YA está acotada por
// RENDER_TIMEOUT_MS/PPTX_CAPTURE_TIMEOUT_MS/etc. adentro del handler.
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;
httpServer.timeout = 0;
httpServer.keepAliveTimeout = 0;
