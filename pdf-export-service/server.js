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
// POST /render  { url: string }  → PDF (application/pdf)
// GET  /health  → 200 si Chromium está listo
// ─────────────────────────────────────────────────────────────────────────
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 4000;
// Lista blanca de hosts permitidos para navegar (evita que este sidecar se
// use como proxy SSRF genérico): solo el frontend interno del propio stack.
const ALLOWED_HOST = process.env.PDF_RENDER_ALLOWED_HOST || 'frontend';
const RENDER_TIMEOUT_MS = parseInt(process.env.PDF_RENDER_TIMEOUT_MS || '30000', 10);

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
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
  const { url } = req.body || {};
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

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });
    // El entry point de print-report.html marca window.__PDF_READY__ una vez
    // que el informe terminó de cargar y renderizar (ver src/print-report/main.jsx);
    // networkidle0 no garantiza que React ya pintó el contenido asíncrono.
    await page.waitForFunction('window.__PDF_READY__ === true', { timeout: RENDER_TIMEOUT_MS });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`[pdf-export-service] listening on :${PORT} (allowed host: ${ALLOWED_HOST})`);
});
