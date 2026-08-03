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
// POST /render  { url: string, watermark?: {text?, tenant?, user?, date?} }
//   → PDF cifrado (application/pdf), header X-Pdf-User-Password con la
//     contraseña generada para ESTA descarga (no se persiste en ningún lado).
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
const AdmZip = require('adm-zip');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 4000;
// Lista blanca de hosts permitidos para navegar (evita que este sidecar se
// use como proxy SSRF genérico): solo el frontend interno del propio stack.
const ALLOWED_HOST = process.env.PDF_RENDER_ALLOWED_HOST || 'frontend';
const RENDER_TIMEOUT_MS = parseInt(process.env.PDF_RENDER_TIMEOUT_MS || '30000', 10);
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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
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
  const { url, watermark } = req.body || {};
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
    let pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

    const watermarkText = buildWatermarkText(watermark);
    pdfBuffer = Buffer.from(await applyWatermark(pdfBuffer, watermarkText));

    const userPassword = generateUserPassword();
    const encrypted = await encryptPdf(pdfBuffer, userPassword);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Pdf-User-Password', userPassword);
    res.send(encrypted);
  } catch (err) {
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Tamaño fijo del lienzo en layoutMode 'presentation' (reportLayoutMetrics.ts:
// PAGE_WIDTH=960, PAGE_HEIGHT=540, 96dpi) — 960/96=10in, 540/96=5.625in,
// exactamente el layout 16:9 estándar de pptxgenjs (LAYOUT_16x9).
const SLIDE_WIDTH_IN = 10;
const SLIDE_HEIGHT_IN = 5.625;

// POST /render-pptx  { url: string, job_id: string }
//   → { storage_path: string } — ruta (dentro de EXPORT_DATA_ROOT) del .pptx
//     generado; el backend la guarda como report_export_job.storage_uri.
//
// Stage 1: cada página del informe (layoutMode 'presentation', validado
// server-side por el backend antes de encolar el job) se captura como imagen
// de fondo a pantalla completa de su slide — MISMA fidelidad visual que el
// PDF (misma navegación, misma espera de __PDF_READY__, mismo componente
// ReadOnlyViewer), sin overlay de texto nativo todavía (Stage 2).
app.post('/render-pptx', async (req, res) => {
  const { url, job_id: jobId } = req.body || {};
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

  // pptxOverlay=1: ReadOnlyViewer oculta la tinta de los bloques
  // overlay-eligible (hoy solo `text`, ver lib/pptxOverlayMapping.ts) y los
  // marca con data-pptx-overlay/data-pptx-meta — este endpoint los lee para
  // superponer cuadros de texto NATIVOS editables sobre la captura de fondo.
  const overlayUrl = `${url}${url.includes('?') ? '&' : '?'}pptxOverlay=1`;

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // 'print' (no 'screen'): misma hoja de estilos @media print que usa el
    // PDF (oculta ro-meta, quita el box-shadow de la página) — el objetivo es
    // "el mismo estilo del informe", no el chrome de la barra de solo-lectura.
    await page.emulateMediaType('print');
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    await page.goto(overlayUrl, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });
    await page.waitForFunction('window.__PDF_READY__ === true', { timeout: RENDER_TIMEOUT_MS });

    const slideHandles = await page.$$('.ro-page-canvas');
    if (slideHandles.length === 0) {
      return res.status(422).json({ error: 'no_pages_to_render' });
    }

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'BEEMETRY_16x9', width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
    pptx.layout = 'BEEMETRY_16x9';

    for (const handle of slideHandles) {
      // Geometría + runs de cada bloque overlay-eligible de ESTA página,
      // relativa a la propia .ro-page-canvas (mismo origen que el sistema de
      // coordenadas x/y del ReportElement, ver reportLayoutMetrics.ts) — todo
      // resuelto en el contexto del navegador, sin adivinar offsets desde Node.
      const overlays = await handle.evaluate((canvasEl) => {
        const canvasRect = canvasEl.getBoundingClientRect();
        return Array.from(canvasEl.querySelectorAll('[data-pptx-overlay="1"]')).map((el) => {
          const r = el.getBoundingClientRect();
          let meta = { align: 'left', runs: [] };
          try {
            meta = JSON.parse(el.getAttribute('data-pptx-meta') || '{}');
          } catch { /* meta inválido -> se omite este overlay */ }
          return {
            x: r.left - canvasRect.left,
            y: r.top - canvasRect.top,
            width: r.width,
            height: r.height,
            align: meta.align || 'left',
            runs: Array.isArray(meta.runs) ? meta.runs : [],
          };
        });
      });

      const pngBuffer = await handle.screenshot({ type: 'png' });
      const slide = pptx.addSlide();
      slide.addImage({
        data: `image/png;base64,${pngBuffer.toString('base64')}`,
        x: 0,
        y: 0,
        w: SLIDE_WIDTH_IN,
        h: SLIDE_HEIGHT_IN,
      });

      for (const overlay of overlays) {
        if (!overlay.runs.length || overlay.width <= 0 || overlay.height <= 0) continue;
        const runs = overlay.runs
          .filter((run) => typeof run.text === 'string' && run.text.length > 0)
          .map((run) => ({
            text: run.text,
            options: {
              bold: !!run.bold,
              italic: !!run.italic,
              underline: run.underline ? { style: 'sng' } : undefined,
              // px (96dpi) -> pt: 1px = 0.75pt.
              fontSize: Math.max(1, Math.round((run.fontSize || 14) * 0.75)),
              fontFace: (run.fontFamily || 'Arial').split(',')[0].replace(/['"]/g, '').trim() || 'Arial',
              color: sanitizeHexColor(run.color) || '0F172A',
            },
          }));
        if (!runs.length) continue;
        slide.addText(runs, {
          x: overlay.x / 96,
          y: overlay.y / 96,
          w: overlay.width / 96,
          h: overlay.height / 96,
          align: ['left', 'center', 'right', 'justify'].includes(overlay.align) ? overlay.align : 'left',
          valign: 'top',
          margin: 3, // pt — aproxima el padding:6px (4.5pt) del div original.
          wrap: true,
        });
      }
    }

    await fs.mkdir(EXPORT_DATA_ROOT, { recursive: true });
    // Nombre de archivo derivado únicamente del job_id (generado server-side
    // como UUID por Postgres, nunca por el cliente) — sin partes de `url` ni
    // de otro input externo, así que no hace falta sanitizar path traversal.
    const outPath = path.join(EXPORT_DATA_ROOT, `${jobId}.pptx`);
    await pptx.writeFile({ fileName: outPath });
    res.json({ storage_path: outPath });
  } catch (err) {
    res.status(502).json({ error: 'render_failed', detail: String(err) });
  } finally {
    if (page) await page.close().catch(() => {});
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
//     generado a partir de las MISMAS imágenes de diapositiva que ya se
//     usaron en el .pptx (`ppt/media/imageN.png`, extraídas del archivo con
//     adm-zip) — sin volver a lanzar Chromium ni a renderizar nada.
//
// Acoplamiento a tener en cuenta: asume que /render-pptx numeró las imágenes
// 1..N en el mismo orden que las páginas (llama a addImage() una sola vez
// por slide, en orden, antes de cualquier addText() de esa misma slide) —
// cierto hoy porque este mismo endpoint es el único que genera esos .pptx.
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
    // pptxgenjs nombra los media como image-{slideIndex}-{imageIndexEnLaSlide}.ext
    // (verificado inspeccionando un .pptx real generado por /render-pptx —
    // NO es image1.png/image2.png secuencial global como podría asumirse).
    // Cada slide de /render-pptx solo tiene una imagen (el fondo), así que
    // ordenar por slideIndex reconstruye el orden de páginas exactamente —
    // y slideIndex ES el número de página (1-based), usado para casar cada
    // diapositiva con su narración (`page_number`).
    const zip = new AdmZip(resolvedPptxPath);
    const imageEntries = zip
      .getEntries()
      .map((entry) => {
        const match = /^ppt\/media\/image-(\d+)-(\d+)\.(png|jpe?g)$/i.exec(entry.entryName);
        return match
          ? { entry, slideIndex: parseInt(match[1], 10), imageIndex: parseInt(match[2], 10), ext: match[3].toLowerCase() }
          : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => (a.slideIndex - b.slideIndex) || (a.imageIndex - b.imageIndex));

    if (imageEntries.length === 0) {
      return res.status(422).json({ error: 'no_slide_images_in_pptx' });
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-video-'));
    const imagePaths = [];
    const pageNumbers = [];
    for (const { entry, slideIndex, ext } of imageEntries) {
      const imgPath = path.join(tmpDir, `slide_${String(slideIndex).padStart(4, '0')}.${ext}`);
      await fs.writeFile(imgPath, entry.getData());
      imagePaths.push(imgPath);
      pageNumbers.push(slideIndex);
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

app.listen(PORT, () => {
  console.log(`[pdf-export-service] listening on :${PORT} (allowed host: ${ALLOWED_HOST})`);
});
