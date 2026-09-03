import React from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import ReadOnlyViewer from '../../components/viewers/ReadOnlyViewer';
import type { ReportDocument } from '../../store/useEditorStore';

/** Tipos de bloque sin representación estática reconstruible desde el JSON
 * del documento (gráficos en vivo, mapas, 3D) más el fondo decorativo de
 * `cover` (gradientes/patrones CSS) -- los únicos que este módulo necesita
 * capturar como imagen. El resto del documento (texto/tabla/imagen/kpi/
 * sensor/seismic-report/header/footer/toc) se construye directamente desde
 * el JSON en `buildReportDocx.ts`, sin pasar por el DOM. */
const RASTER_ONLY_TYPES = new Set(['chart', 'sensor_multi_chart', 'cover']);

const CAPTURE_TIMEOUT_MS = 20000;
/** Techo por captura individual de `html2canvas` -- sin esto, UN solo nodo
 * problemático (hallado en pruebas a escala: un documento con 20 gráficos
 * simultáneos) puede colgar `html2canvas` indefinidamente sin rechazar ni
 * resolver nunca, congelando el export COMPLETO sin ningún mensaje de error
 * (el usuario se queda mirando "Exportando DOCX..." para siempre). Se trata
 * igual que cualquier otro fallo de captura: el bloque queda sin entrada en
 * el mapa y `buildReportDocx.ts` deja una nota de texto en su lugar. */
const HTML2CANVAS_TIMEOUT_MS = 15000;
/** Techo reducido para los tipos de gráfico conocidos por ser frágiles
 * fuera de pantalla: `surface` (WebGL/Three.js) y `geomap` (mosaicos de
 * Leaflet vía red). Mismo límite que ya documenta el sidecar server-side
 * para `surface` ("queda en blanco" en vez de romper el export completo,
 * ver `pdf-export-service/server.js`) -- aquí el riesgo no es que quede en
 * blanco sino que WebGL fuera de pantalla tarde mucho más de lo normal en
 * fallar/resolver; un techo corto libera el lote más rápido en vez de
 * consumir el timeout completo de 15s por cada uno. */
const FRAGILE_CAPTURE_TIMEOUT_MS = 6000;
const FRAGILE_CHART_TYPES = new Set(['surface', 'geomap']);
/** Cuántas capturas `html2canvas` corren a la vez -- DEBE ser 1 (secuencial).
 * Se probó en paralelo (5 a la vez) y produjo imágenes rotas de verdad:
 * con varios gráficos ECharts todavía redimensionándose/animando a la vez,
 * algunas capturas se tomaron a mitad de ese proceso y salieron recortadas
 * (ej. un gráfico de sensores que solo trae la barra lateral, sin el
 * gráfico) -- confirmado inspeccionando visualmente los PNG embebidos de un
 * .docx generado con paralelismo=5. Capturar de a uno le da a cada nodo el
 * tiempo completo para asentarse antes de leerlo; más lento, pero es la
 * única forma de garantizar que la imagen capturada sea la correcta. */
const CAPTURE_BATCH_SIZE = 1;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Espera deliberadamente con `setTimeout`, NUNCA `requestAnimationFrame`:
 * hallado en pruebas a escala (documento de 134 elementos) -- con la
 * pestaña del navegador en segundo plano (el usuario cambió de pestaña
 * mientras esperaba, o la automatización de pruebas no la tiene en foco),
 * Chrome puede suspender rAF casi por completo, dejando esta espera colgada
 * varios MINUTOS en vez de los ~20s esperados. `setTimeout` sigue
 * disparando en segundo plano (como mucho, limitado a 1 vez/segundo tras un
 * rato) -- degrada, no se cuelga. */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('capture_timeout')); return; }
      setTimeout(tick, 30);
    };
    tick();
  });
}

/**
 * Fuerza un `.resize()` sobre cualquier instancia de ECharts que haya
 * quedado "vacía" (sin `<canvas>` propio) dentro de `node`. Causa raíz real
 * de los gráficos en blanco/negro al exportar DOCX (hallada inspeccionando
 * el DOM en vivo durante la captura, con sondeo de `innerHTML` cada 800ms):
 * `echarts.init()` mide `dom.clientWidth/clientHeight` en el instante
 * síncrono de montaje y, si en ESE instante lee 0 (aunque `ChartPanel` ya
 * haya medido un tamaño válido vía `ResizeObserver` un instante antes),
 * ECharts se rinde silenciosamente -- solo deja el warning de consola
 * "Can't get DOM width or height" y NUNCA crea el `<canvas>` interno, sin
 * lanzar excepción y sin reintentar solo. `onChartReady` en consecuencia
 * jamás dispara. No depende de dónde esté posicionado el contenedor
 * (`position:fixed`/`absolute`, offscreen u onscreen con `opacity:0` -- se
 * probaron los tres, mismo resultado): es un problema de timing del montaje
 * inicial, no de visibilidad. Llamar `.resize()` una vez que el DOM ya tiene
 * su tamaño final estable SÍ recupera la instancia -- comportamiento
 * documentado de ECharts para gráficos que arrancan en un contenedor de
 * tamaño 0 (ej. dentro de una pestaña oculta) y se muestran después. */
function nudgeStuckEchartsInstances(node: HTMLElement): void {
  const hosts = node.querySelectorAll<HTMLElement>('[_echarts_instance_]');
  hosts.forEach((host) => {
    const inst = echarts.getInstanceByDom(host);
    if (inst && !inst.isDisposed()) inst.resize();
  });
}

/** Espera exactamente lo mismo que `waitForReportRender` del sidecar
 * (`pdf-export-service/server.js`): widgets/gráficos marcados
 * `[data-export-widget]`/`[data-export-chart="true"]` con
 * `data-export-ready="false"` pendientes, más todas las `<img>` del
 * contenedor cargadas -- MISMO contrato DOM, cliente en vez de Puppeteer. */
async function waitForRenderReady(container: HTMLElement): Promise<void> {
  // Reintenta el destrabe cada ~400ms mientras se espera -- un documento con
  // muchos dashboards de sensores (ej. 56 sensores × 20 tipos) monta sus
  // paneles ECharts de forma escalonada (cada uno espera su propia consulta
  // de telemetría), así que un solo nudge al montar no alcanza a todos: los
  // que aún no existían en ese instante quedan sin destrabar. Repetir el
  // nudge durante toda la espera cubre los que se montan tarde, sin costo
  // real (`nudgeStuckEchartsInstances` es un no-op instantáneo para paneles
  // que ya pintaron bien).
  const nudgeTimer = setInterval(() => nudgeStuckEchartsInstances(container), 400);
  try {
    await waitFor(() => {
      const pendingWidgets = container.querySelectorAll('[data-export-widget][data-export-ready="false"]');
      const pendingCharts = container.querySelectorAll('[data-export-chart="true"][data-export-ready="false"]');
      return pendingWidgets.length === 0 && pendingCharts.length === 0;
    }, CAPTURE_TIMEOUT_MS);
  } finally {
    clearInterval(nudgeTimer);
  }
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }))));
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

/**
 * Resuelve CUALQUIER `src` de un bloque `image` (data URL, SVG placeholder,
 * URL relativa de la API, URL externa) a bytes PNG listos para `ImageRun`
 * (que solo acepta jpg/png/gif/bmp). Se rasteriza siempre a través de un
 * `<img>`+`<canvas>` en vez de intentar sniffear el tipo MIME real -- cubre
 * SVG/WebP/lo que sea con una sola ruta de código, al costo de convertir
 * también PNG/JPEG ya válidos (precio aceptable por simplicidad/robustez).
 */
export function resolveImageBytes(src: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, img.naturalWidth || 1);
        canvas.height = Math.max(1, img.naturalHeight || 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas_2d_unavailable')); return; }
        ctx.drawImage(img, 0, 0);
        resolve(dataUrlToUint8Array(canvas.toDataURL('image/png')));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Monta una instancia OCULTA de `ReadOnlyViewer` (mismo componente que ya
 * usa la vista previa de impresión -- sin chrome de edición/selección) fuera
 * de pantalla, espera a que gráficos/imágenes terminen de pintar, y captura
 * con `html2canvas` cada bloque `chart`/`sensor_multi_chart`/`cover` a PNG.
 * Devuelve `elementId -> bytes PNG`. Se usa SOLO para el pipeline cliente
 * (`buildReportDocx.ts` vía `exportEngine.ts`) -- el resto del documento no
 * necesita el DOM en absoluto.
 */
interface CaptureTarget {
  id: string;
  timeoutMs: number;
}

/** `true` si el gráfico de este elemento es de un tipo conocido por ser
 * frágil fuera de pantalla (ver `FRAGILE_CHART_TYPES`). */
function isFragileChartElement(el: { type: string; props?: Record<string, unknown> }): boolean {
  if (el.type !== 'sensor_multi_chart') return false;
  const props = el.props || {};
  const types = Array.isArray(props.chartTypes) ? props.chartTypes : [props.chartType];
  return types.some((t) => typeof t === 'string' && FRAGILE_CHART_TYPES.has(t));
}

async function runInBatches<T>(items: T[], batchSize: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(run));
  }
}

export async function captureRasterAssets(doc: ReportDocument, reportMeta: Record<string, unknown> = {}): Promise<Map<string, Uint8Array>> {
  const targets: CaptureTarget[] = [];
  doc.pages.forEach((page) => page.elements.forEach((el) => {
    if (!RASTER_ONLY_TYPES.has(el.type)) return;
    targets.push({ id: el.id, timeoutMs: isFragileChartElement(el) ? FRAGILE_CAPTURE_TIMEOUT_MS : HTML2CANVAS_TIMEOUT_MS });
  }));
  const result = new Map<string, Uint8Array>();
  if (targets.length === 0) return result;

  const container = document.createElement('div');
  // NUNCA posicionar este contenedor fuera del viewport real (ej.
  // `left: -99999px`, offscreen clásico) -- causa raíz real, confirmada
  // inspeccionando el DOM en vivo durante la captura: con el contenedor
  // desplazado fuera de cualquier posición alcanzable del viewport, Chrome
  // deja el <canvas> de ECharts SIN CREAR -- `echarts.init()` corre y marca
  // `_echarts_instance_` en el div (no lanza excepción, `onChartReady`
  // tampoco se dispara nunca), pero el `<div>` interno que debería contener
  // el `<canvas>` queda vacío indefinidamente (confirmado sondeando
  // `innerHTML` cada 800ms durante los 20s completos de espera). El tamaño
  // medido por `getBoundingClientRect`/`ResizeObserver` es válido igual
  // (170x196, 402x189, etc.) -- el layout funciona, lo que Chrome se salta
  // es el pintado/composición real del canvas para una capa que nunca podría
  // llegar a ser visible en ningún scroll posible. (Se probó antes
  // `position:fixed` vs `position:absolute` por una teoría de
  // `offsetParent === null` -- ninguna de las dos arregló esto, porque esa
  // no era la causa real.)
  //
  // Fix: mantener el contenedor DENTRO del viewport real (esquina superior
  // izquierda, sin scroll) pero invisible via `opacity: 0` -- Chrome sí
  // compone/pinta contenido en `opacity:0` (a diferencia de `display:none`),
  // así que ECharts crea el canvas y pinta con normalidad; el usuario nunca
  // lo ve porque es transparente y queda detrás de todo (`z-index: -1`) con
  // `pointer-events: none`.
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.opacity = '0';
  container.style.zIndex = '-1';
  container.style.pointerEvents = 'none';
  // Ancho EXPLÍCITO -- sin esto, un contenedor `position:fixed` con solo
  // `left` fijado (sin `right`) no tiene un ancho definido propio hasta que
  // su CONTENIDO se mida, y un descendiente `flex:1` (ej. el panel de
  // gráfico de SensorMultiChartWidget, junto a su barra lateral de sensores)
  // necesita que su contenedor YA tenga un ancho definido para calcular su
  // propio tamaño. NOTA: se creyó en un momento que esto era la causa raíz
  // de los gráficos en blanco -- no lo era (ver `nudgeStuckEchartsInstances`
  // arriba para la causa real); esto sigue siendo correcto mantenerlo como
  // medida defensiva para que ningún panel quede angosto por diseño, pero ya
  // no es, por sí solo, lo que garantiza que el gráfico se pinte. Ancho
  // generoso, más que cualquier tamaño de página real (A3 horizontal son
  // ~1587px).
  container.style.width = '2200px';
  document.body.appendChild(container);

  const root = createRoot(container);
  const t0 = performance.now();
  const dt = () => `${Math.round(performance.now() - t0)}ms`;
  try {
    const report = { ...reportMeta, content_json: doc };
    // eslint-disable-next-line no-console
    console.log(`[DOCX_CAPTURE] mounting hidden viewer (${targets.length} raster targets)…`);
    await new Promise<void>((resolve) => {
      root.render(React.createElement(ReadOnlyViewer, { report, onClose: null, isPrint: true }));
      // Deja que React confirme el commit inicial antes de esperar los
      // widgets -- `setTimeout`, no rAF (ver nota en `waitFor` arriba).
      setTimeout(resolve, 50);
    });
    console.log(`[DOCX_CAPTURE] mounted @ ${dt()}, waiting for readiness…`);
    // Primer intento de recuperar instancias de ECharts que hayan iniciado
    // en 0x0 (ver comentario de `nudgeStuckEchartsInstances`) ANTES de
    // esperar -- si esto las destraba, `waitForRenderReady` ya las
    // encuentra listas y no hace falta agotar el timeout completo de 20s.
    nudgeStuckEchartsInstances(container);
    try {
      await waitForRenderReady(container);
      console.log(`[DOCX_CAPTURE] ready @ ${dt()}`);
    } catch (err) {
      // Degradación con gracia, NO abortar todo el export: si algún widget
      // nunca reporta listo (hallado en pruebas a escala: un mapa/superficie
      // 3D fuera de pantalla puede tardar mucho más que el resto), se
      // continúa igual con la captura -- cada nodo individual todavía tiene
      // su propio timeout más abajo, así que en el peor caso ese bloque
      // puntual queda con la nota de texto "no se pudo capturar" en vez de
      // perder TODO el documento (antes: una sola espera fallida rechazaba
      // esta función entera y `exportDOCX` caía al respaldo HTML antiguo de
      // baja fidelidad para el documento COMPLETO).
      console.log(`[DOCX_CAPTURE] readiness incompleta @ ${dt()} (${String(err)}) -- se continúa de todos modos`);
    }
    console.log(`[DOCX_CAPTURE] iniciando ${targets.length} capturas en lotes de ${CAPTURE_BATCH_SIZE}…`);

    const html2canvas = (await import('html2canvas')).default;
    await runInBatches(targets, CAPTURE_BATCH_SIZE, async ({ id, timeoutMs }) => {
      const node = container.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
      if (!node) { console.log(`[DOCX_CAPTURE] ${id}: node not found @ ${dt()}`); return; }
      // Red de seguridad: si `waitForRenderReady` agotó su timeout (widget
      // que nunca reportó listo), reintenta destrabar justo antes de
      // capturar -- para entonces el layout lleva rato estable, así que esta
      // segunda pasada tiene la mejor chance de que ECharts mida un tamaño
      // real y pinte antes de que `html2canvas` lea el `<canvas>`.
      nudgeStuckEchartsInstances(node);
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      try {
        const canvas = await withTimeout(
          html2canvas(node, { scale: 2, useCORS: true, logging: false, backgroundColor: null }),
          timeoutMs,
          'html2canvas_timeout',
        );
        result.set(id, dataUrlToUint8Array(canvas.toDataURL('image/png')));
        console.log(`[DOCX_CAPTURE] ${id}: captured @ ${dt()}`);
      } catch (err) {
        console.log(`[DOCX_CAPTURE] ${id}: FAILED @ ${dt()} — ${String(err)}`);
        // Un bloque que no se pudo capturar (WebGL perdido, timeout, etc.)
        // se deja sin entrada en el mapa -- buildReportDocx.ts ya maneja ese
        // caso con una nota de texto explícita en vez de fallar todo el
        // export.
      }
    });
    console.log(`[DOCX_CAPTURE] terminado @ ${dt()}, ${result.size}/${targets.length} capturados`);
  } finally {
    root.unmount();
    container.remove();
  }
  return result;
}
