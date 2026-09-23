import React, { memo, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { X, Download, Eye, Printer, ShieldCheck, Link2 } from 'lucide-react';
import { usePdfExport } from '../../lib/usePdfExport';
import { useShareLink } from '../../lib/useShareLink';
import PdfPasswordModal from '../PdfPasswordModal';
import ShareLinkModal from '../ShareLinkModal';
import { resolveReportImageSrc } from '../../lib/reportImageSrc';
import { getSession } from '../../../../auth/authStorage';
import { getTenantLogoDataUrl } from '../../lib/tenantLogo';
import { resolveMiningUnitName } from '../../lib/sessionChrome';
import { LIST_INDENT_TAB_SIZE } from '../../lib/listFormatting';
import { tocSliceForElementId, resolvePagePaperSetup } from '../../store/useEditorStore';
import { getReportLayoutMetrics } from '../../lib/reportLayoutMetrics';
import type { TocItem } from '../document/TableOfContents';
import { resolveHeadingRefLabel } from '../document/TableOfContents';
import { resolveAnnexRefLabel } from '../document/AnnexList';
import { buildStyledSegments, buildParagraphGroups, sanitizeSpans, styleToCss, type BaseTextStyle } from '../../lib/textSpans';
import { semanticStatusStyle } from '../../lib/semanticStatus';
import { sanitizeRichHtml } from '../../lib/sanitizeHtml';
import { toTrustedHtml } from '../../../../lib/trustedHtml';
import { computeTableFormulas, getEffectiveCellValues, parseCellNumber, stripCellHtml } from '../../lib/tableFormulas';
import { formatNumberForDisplay } from '../../lib/tableNumberFormat';
import { computeConditionalStyles } from '../../lib/tableConditionalFormat';
import { findCoverTemplate } from '../../lib/coverTemplates';
import LiveChartBlock from '../dashboard/LiveChartBlock';
import SeismicReportWidget from '../document/InsertBlocks/SeismicReportWidget';
import SensorMultiChartWidget from '../document/InsertBlocks/SensorMultiChartWidget';
import { fixRecordedVideoElement } from '../../lib/videoDurationFix';
import { sensorDashboardMinHeight } from '../../lib/sensorMultiChartLayout';

/** Misma tipografía/color "impactante" de plataforma que PageCanvas.tsx —
 * encabezado y pie de página deben verse idénticos en editor y solo-lectura. */
const PLATFORM_CHROME_FONT = "'Arial Black', 'Arial Bold', Arial, sans-serif";
const PLATFORM_CHROME_FONT_SIZE = 9;
const PLATFORM_CHROME_COLOR = '#595959';

/**
 * Virtualización de páginas SOLO para el pipeline de export server-side
 * (`isPrint`) de informes grandes -- pedido explícito tras reproducir en
 * vivo que, sin esto, un informe de cientos/miles de páginas monta TODOS
 * sus widgets de sensor (ECharts + Leaflet + Three.js/WebGL) al mismo
 * tiempo, sin importar que la exportación solo capture uno a la vez: la
 * contención de CPU/GPU resultante hacía que CADA captura individual
 * (`elementHandle.screenshot()`, 12s de margen) empezara a expirar en un
 * informe de 1120 diagramas, y Chromium tiene además un techo duro de
 * contextos WebGL simultáneos (peor aún con `SensorSurface3DPanel`).
 *
 * Umbral deliberadamente alto: la inmensa mayoría de informes reales (unas
 * pocas a unas pocas decenas de páginas) NUNCA activa este camino -- sigue
 * exactamente el comportamiento de siempre, sin ningún riesgo de regresión.
 * Recién con documentos grandes se activa: la página arranca mostrando solo
 * la página 1 (± `EXPORT_VIRTUALIZATION_WINDOW`) con contenido real; el
 * resto queda como un placeholder del tamaño exacto de la hoja (necesario
 * para que `reportPageSizes()`/el conteo de `.ro-page-wrapper` en
 * server.js sigan funcionando) pero SIN montar ningún elemento -- el
 * sidecar de export (`pdf-export-service/server.js`) avanza la página
 * activa con `window.__setExportActivePage__(n)` según va necesitando
 * capturar cada una, en vez de tener las 2000 montadas a la vez.
 */
const EXPORT_VIRTUALIZATION_PAGE_THRESHOLD = 25;
// Subido de 1 a 6 (causa raíz real de la lentitud en exports grandes,
// encontrada en vivo con un documento de 2104 páginas): con ventana=1, un
// widget de sensor solo queda montado mientras la página activa transita
// por sus 3 vecinas (N-1, N, N+1) -- a ~2.4s por transición, son ~7s de vida
// real antes de que ese elemento se desmonte (sale del `.map()` de abajo).
// El fetch de telemetría de ese widget (SensorMultiChartWidget.tsx) no
// tiene ninguna forma de sobrevivir al desmontaje: Chromium aborta la
// petición de red en pleno vuelo ("net::ERR_ABORTED", confirmado en los
// logs del sidecar de export), sin importar cuán generoso sea el timeout
// de axios -- nunca llega a cumplirse porque la página desaparece primero.
// Ventana=6 mantiene un widget montado ~13 transiciones (~31s), tiempo real
// de sobra para que la consulta a /mining/telemetry/wizard/query complete
// incluso bajo la carga de miles de peticiones concurrentes de un export
// grande. Costo: ~13 páginas montadas a la vez en vez de 3 (antes 3
// elementos de sensor activos, ahora hasta ~39) -- memoria medida en vivo
// durante un export exitoso de 2104 páginas se mantuvo muy por debajo de
// cualquier límite (RSS máx. ~286MB de 4GB disponibles), así que hay
// margen de sobra para este cambio.
const EXPORT_VIRTUALIZATION_WINDOW = 6;

/**
 * Virtualización para el VISOR INTERACTIVO (no export): reportado en vivo un
 * lag serio abriendo un informe de 144 páginas con varios sensores/mapas —
 * a diferencia del export, aquí `shouldVirtualize` de arriba nunca se activa
 * (solo mira `isPrint`), así que `.ro-pages` monta TODOS los widgets
 * (ECharts/Leaflet) de las 144 páginas de una sola vez sin importar el
 * scroll, aunque solo un puñado esté a la vista.
 *
 * Mismo mecanismo de placeholder que el export de arriba (la caja
 * `.ro-page-wrapper`/`.ro-page-canvas` con el tamaño real se mantiene, solo
 * se omiten los elementos), pero en vez de seguir una "página activa" que
 * empuja Puppeteer, sigue el scroll real vía IntersectionObserver sobre
 * `.ro-content` (el contenedor con `overflow: auto`).
 */
const INTERACTIVE_VIRTUALIZATION_PAGE_THRESHOLD = 20;
// Margen de precarga arriba/abajo del viewport visible: páginas vecinas se
// mantienen montadas aunque no se vean todavía, para que el scroll continuo
// no muestre un "flash" de placeholder vacío antes de que llegue su turno.
const INTERACTIVE_VIRTUALIZATION_ROOT_MARGIN = '1200px 0px 1200px 0px';

/** Suscriptores del componente(s) `ReadOnlyViewer` montado(s) a cambios de
 * página activa -- normalmente hay uno solo (print-report.html), pero un
 * registro en vez de una única variable de callback evita pisar nada si
 * alguna vez hay más de una instancia viva. */
const exportActivePageSubscribers = new Set<(page: number) => void>();
if (typeof window !== 'undefined') {
  (window as any).__setExportActivePage__ = (n: number) => {
    // `flushSync` -- SIN esto, `page.evaluate()` (Puppeteer) resuelve la
    // promesa apenas termina esta función síncrona, ANTES de que React
    // realmente vuelva a renderizar/montar la página nueva (los `setState`
    // de los suscriptores solo quedan agendados). El sidecar entonces
    // consultaba `data-export-ready` sobre una página que todavía no tenía
    // NINGÚN widget montado (0 pendientes = vacuamente "lista") y pasaba
    // directo a capturar -- reproducido en vivo: de 420 diagramas, 417
    // terminaron como texto "no se pudo capturar" porque el elemento
    // literalmente no existía todavía en el DOM en ese instante.
    // `flushSync` fuerza el commit ANTES de que esta función retorne.
    flushSync(() => {
      exportActivePageSubscribers.forEach((fn) => fn(n));
    });
  };
}

function ReadOnlyHeaderLogo({ tenantId }: { tenantId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!tenantId) { setSrc(null); return undefined; }
    getTenantLogoDataUrl(tenantId).then((url) => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [tenantId]);
  if (!src) return null;
  return (
    <img src={src} alt="Logotipo de la empresa" style={{ height: '100%', width: 'auto', maxWidth: 140, objectFit: 'contain', display: 'block' }} />
  );
}

interface ReadOnlyViewerProps {
  report: any;
  onClose?: (() => void) | null;
  /** Modo de impresión/export PDF aislado server-side: omite la barra de herramientas y etiquetas de página */
  isPrint?: boolean;
  /** Visualizador de PPT en pantalla completa (botón "Presentar", solo
   * disponible con layoutMode 'presentation'): una diapositiva a la vez,
   * navegación con flechas/espacio/clic y la transición de cada página
   * (page.transition) animada de verdad -- a diferencia de isPrint, esto SÍ
   * necesita el lienzo real interactivo (no hay nada que capturar), solo
   * oculta la barra de herramientas de solo-lectura y cambia cómo se
   * recorren las páginas ya renderizadas por este mismo componente. */
  presenterMode?: boolean;
}

/**
 * ReadOnlyViewer — muestra el contenido de un informe en modo solo lectura.
 * Renderiza las páginas usando el mismo HTML que MultipageView pero deshabilitando
 * toda interacción (pointer-events: none en el contenido).
 */
function ReadOnlyViewer({ report, onClose, isPrint = false, presenterMode = false }: ReadOnlyViewerProps) {
  // `doc` se calcula ACÁ (antes del `if (!report) return null` de abajo) a
  // propósito -- el hook de virtualización que sigue necesita conocer
  // `doc.pages.length` desde el primer render, y los hooks no pueden
  // llamarse condicionalmente después de un return temprano.
  const doc = report ? (() => {
    try {
      // El backend devuelve content_json (snake_case); algunos flujos internos
      // usan contentJson (camelCase, ya combinado en frontend). Aceptar ambos.
      const cj = report.content_json ?? report.contentJson;
      if (!cj) return null;
      return typeof cj === 'string' ? JSON.parse(cj) : cj;
    } catch {
      return null;
    }
  })() : null;

  // Ver comentario de EXPORT_VIRTUALIZATION_PAGE_THRESHOLD más arriba. Arranca
  // directo en la página 1 (no en `null`) para documentos grandes -- así el
  // PRIMER render ya monta solo esa página, sin ninguna ventana donde las
  // miles de páginas restantes lleguen a montarse aunque sea un instante.
  const shouldVirtualize = isPrint && (doc?.pages?.length || 0) > EXPORT_VIRTUALIZATION_PAGE_THRESHOLD;
  const [exportActivePage, setExportActivePage] = useState<number | null>(shouldVirtualize ? 1 : null);
  useEffect(() => {
    if (!shouldVirtualize) return undefined;
    (window as any).__exportVirtualized__ = true;
    const onActivePageChange = (n: number) => setExportActivePage(n);
    exportActivePageSubscribers.add(onActivePageChange);
    return () => {
      exportActivePageSubscribers.delete(onActivePageChange);
      delete (window as any).__exportVirtualized__;
    };
  }, [shouldVirtualize]);

  // Virtualización interactiva (ver comentario de
  // INTERACTIVE_VIRTUALIZATION_PAGE_THRESHOLD arriba). Arranca con solo la
  // página 1 visible -- igual que el export -- así el primer render nunca
  // monta de golpe las páginas restantes antes de que el observer conecte.
  const shouldVirtualizeInteractive = !isPrint && (doc?.pages?.length || 0) > INTERACTIVE_VIRTUALIZATION_PAGE_THRESHOLD;
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1]));
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!shouldVirtualizeInteractive) return undefined;
    const root = contentRef.current;
    const pagesEl = pagesRef.current;
    if (!root || !pagesEl) return undefined;
    const wrappers = pagesEl.querySelectorAll<HTMLElement>('[data-page-number]');
    const observer = new IntersectionObserver((entries) => {
      setVisiblePages((prev) => {
        let changed = false;
        const next = new Set(prev);
        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.getAttribute('data-page-number'));
          if (!pageNumber) return;
          if (entry.isIntersecting && !next.has(pageNumber)) {
            next.add(pageNumber);
            changed = true;
          } else if (!entry.isIntersecting && next.has(pageNumber)) {
            next.delete(pageNumber);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, { root, rootMargin: INTERACTIVE_VIRTUALIZATION_ROOT_MARGIN, threshold: 0 });
    wrappers.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // `report?.id` (no `doc`, que es un objeto nuevo en cada render) -- el
    // observer solo debe reconstruirse cuando cambia el informe abierto.
  }, [shouldVirtualizeInteractive, report?.id]);

  // ── Modo Presentación (botón "Presentar", solo layoutMode 'presentation') ──
  const totalPresenterPages = doc?.pages?.length || 0;
  const [presenterPage, setPresenterPage] = useState(1);
  const [presenterScale, setPresenterScale] = useState(1);
  const [presenterAnim, setPresenterAnim] = useState<{ page: number; type: string } | null>(null);
  const presenterRootRef = useRef<HTMLDivElement | null>(null);

  // Escala el lienzo de 1280×720 (tamaño real de una diapositiva, ver
  // reportLayoutMetrics.ts) para que quepa completo en cualquier resolución
  // de pantalla, tipo "letterbox" -- se recalcula si la ventana cambia de
  // tamaño (incluye entrar/salir de pantalla completa).
  useEffect(() => {
    if (!presenterMode) return undefined;
    const recompute = () => {
      setPresenterScale(Math.max(0.1, Math.min(window.innerWidth / 1280, window.innerHeight / 720)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [presenterMode]);

  // Pantalla completa real vía Fullscreen API -- si el navegador la deniega
  // (iframe sin `allow="fullscreen"`, política restrictiva), `.ro-overlay`
  // ya cubre toda la ventana igual (position:fixed; inset:0), así que la
  // experiencia se degrada a "pantalla completa dentro del navegador" en vez
  // de romperse.
  useEffect(() => {
    if (!presenterMode) return undefined;
    presenterRootRef.current?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [presenterMode]);

  // El navegador sale de pantalla completa DE FORMA NATIVA al presionar Esc
  // -- antes de que la propia página se entere -- y en algunos casos esa
  // salida nativa "se come" el keydown antes de que llegue al handler de
  // abajo (`onKeyDown`). Sin este listener, el resultado observado era: la
  // ventana vuelve a su tamaño normal pero `.ro-overlay` (presenterMode)
  // se queda montado igual -- ya sin pantalla completa real, así que el
  // scroll-snap deja de sentirse "atrapado" y se puede desplazar libremente
  // viendo todas las diapositivas en vez de volver al editor. Escuchar
  // `fullscreenchange` (el evento real del navegador, no un atajo de
  // teclado propio) es la señal confiable de que se salió, sin importar
  // el motivo (Esc, F11, un diálogo del sistema).
  useEffect(() => {
    if (!presenterMode) return undefined;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onClose?.();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [presenterMode, onClose]);

  const goToPresenterPage = (target: number) => {
    if (!totalPresenterPages) return;
    const clamped = Math.max(1, Math.min(totalPresenterPages, target));
    if (clamped === presenterPage) return;
    // La transición es la de la diapositiva DE DESTINO (misma semántica que
    // PowerPoint: "esta es la animación con la que ENTRA esta diapositiva").
    const transitionType = doc?.pages?.[clamped - 1]?.transition || 'none';
    setPresenterPage(clamped);
    if (transitionType !== 'none') {
      setPresenterAnim({ page: clamped, type: transitionType });
      // Debe ser un poco MAYOR que la duración de la animación CSS
      // (.ro-page-anim-*, 0.9s -- ver styles.css) -- si se saca la clase
      // ANTES de que termine, la transición se corta en seco a mitad de
      // camino en vez de completarse fluida.
      window.setTimeout(() => setPresenterAnim(null), 950);
    }
    pagesRef.current
      ?.querySelector<HTMLElement>(`[data-page-number="${clamped}"]`)
      ?.scrollIntoView({ behavior: transitionType === 'none' ? 'auto' : 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!presenterMode) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goToPresenterPage(presenterPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goToPresenterPage(presenterPage - 1);
      } else if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenterMode, presenterPage, totalPresenterPages]);

  if (!report) return null;

  // "Imprimir" es impresión nativa del navegador, inmediata y sin protección
  // (uso interno rápido). "Descargar PDF protegido" es el pipeline
  // server-side (ADR-016/080): marca de agua + contraseña generada al vuelo.
  const handlePrint = () => window.print();
  const { downloadPdf, exporting, password, clearPassword } = usePdfExport();
  const handleDownloadProtectedPdf = () => {
    if (!report.id) return;
    downloadPdf(report.id).catch(() => {});
  };

  // ADR-138: enlace de acceso directo (sin contraseña) — complementa el PDF
  // protegido de arriba en vez de reemplazarlo (ver decisión: "implementar
  // tanto la 1 como la 2").
  const { generateLink, generating: generatingLink, link: shareLink, clearLink } = useShareLink();
  const handleGenerateShareLink = () => {
    if (!report.id) return;
    generateLink(report.id).catch(() => {});
  };

  // Misma fuente de verdad que el editor (PageCanvas.tsx) — antes esta vista
  // usaba una heurística propia y desactualizada (primera línea de CADA
  // bloque de texto, sin filtrar por estilo de encabezado ni numerar), por
  // lo que el índice del PDF/solo-lectura no coincidía con el del editor.
  // Actualización: cada bloque toc (original o de continuación, ver
  // useEditorStore.ts::syncTocPages) solo muestra SU tramo de entradas, no
  // la lista completa repetida en cada página.

  return (
    <div
      ref={presenterMode ? presenterRootRef : undefined}
      className={`ro-overlay${presenterMode ? ' ro-overlay--presenter' : ''}`}
      style={isPrint ? { position: 'relative', background: '#ffffff', width: '100%', margin: 0, padding: 0 } : undefined}
      onClick={presenterMode ? () => goToPresenterPage(presenterPage + 1) : undefined}
    >
      {/* ── HUD mínimo del modo presentación (contador + salir) ── */}
      {presenterMode && (
        <div className="ro-presenter-hud" onClick={(e) => e.stopPropagation()}>
          <span className="ro-presenter-counter">{presenterPage} / {totalPresenterPages}</span>
          {onClose && (
            <button className="ro-presenter-close" onClick={onClose} title="Salir de la presentación (Esc)">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* ── Barra superior readonly (oculta en modo impresión/presentación) ── */}
      {!isPrint && !presenterMode && (
        <div className="ro-toolbar">
          <div className="ro-toolbar-left">
            <Eye size={16} style={{ color: '#a5b4fc' }} />
            <span className="ro-badge">MODO LECTURA — SOLO VISUALIZACIÓN</span>
            <span className="ro-title">{report.title}</span>
          </div>
          <div className="ro-toolbar-right">
            <button className="ro-btn" onClick={handlePrint} title="Imprimir (sin marca de agua ni contraseña)">
              <Printer size={15} /> Imprimir
            </button>
            {report.id && (
              <button
                className="ro-btn"
                onClick={handleDownloadProtectedPdf}
                disabled={exporting}
                title="Descargar PDF con marca de agua y contraseña"
              >
                {exporting ? <ShieldCheck size={15} className="ra-spin" /> : <Download size={15} />}
                {exporting ? 'Generando...' : 'Descargar PDF protegido'}
              </button>
            )}
            {report.id && (
              <button
                className="ro-btn"
                onClick={handleGenerateShareLink}
                disabled={generatingLink}
                title="Generar enlace/QR que abre el PDF directo al escanearlo, sin contraseña (vence en 48h)"
              >
                <Link2 size={15} />
                {generatingLink ? 'Generando...' : 'Enlace + QR'}
              </button>
            )}
            {onClose && (
              <button className="ro-btn ro-btn-close" onClick={onClose} title="Cerrar">
                <X size={15} /> Cerrar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Contenido del informe ── */}
      <div
        className={`ro-content${presenterMode ? ' ro-content--presenter' : ''}`}
        ref={contentRef}
        style={isPrint ? { padding: 0, margin: 0, overflow: 'visible' } : undefined}
      >
        {!doc ? (
          <div className="ro-no-content">
            <Eye size={40} style={{ opacity: 0.2 }} />
            <p>Este informe no tiene contenido visual disponible.</p>
          </div>
        ) : (
          <div
            className={`ro-pages${presenterMode ? ' ro-pages--presenter' : ''}`}
            ref={pagesRef}
            style={{ pointerEvents: 'none', userSelect: 'none', ...(isPrint ? { gap: 0, padding: 0, margin: 0 } : {}) }}
          >
            {doc.pages && doc.pages.map((page: any) => {
              // Mismo cálculo que PageCanvas.tsx/MultipageView.tsx (editor):
              // sin esto, `.ro-page-canvas` quedaba fijo en A4-portrait vía
              // CSS y un informe en layoutMode 'presentation' (lienzo 1280×720)
              // renderizaba sus elementos —posicionados en esas coordenadas—
              // dentro de una caja con otra forma/tamaño, mal ubicados.
              const layoutMode = doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
              const { paperSize, orientation } = resolvePagePaperSetup(
                { paperSize: page.paperSize, orientation: page.orientation },
                { paperSize: doc.meta?.paperSize, orientation: doc.meta?.orientation },
              );
              const { PAGE_WIDTH, PAGE_HEIGHT } = getReportLayoutMetrics(layoutMode, paperSize, orientation);
              // Ver EXPORT_VIRTUALIZATION_PAGE_THRESHOLD arriba -- fuera de la
              // ventana activa, esta página mantiene su caja (`.ro-page-canvas`
              // con el tamaño real, necesario para reportPageSizes()/el conteo
              // de `.ro-page-wrapper` en server.js) pero SIN montar ni un solo
              // elemento: ningún ECharts/Leaflet/Three.js vivo hasta que le
              // toque su turno real de captura.
              const withinExportWindow = !shouldVirtualize
                || exportActivePage === null
                || Math.abs(page.page_number - exportActivePage) <= EXPORT_VIRTUALIZATION_WINDOW;
              // Independiente de `withinExportWindow` -- `shouldVirtualize` (export)
              // y `shouldVirtualizeInteractive` nunca están activos a la vez, ya que
              // el segundo exige `!isPrint`. Cuando no aplica ninguna virtualización
              // interactiva (la inmensa mayoría de informes), esto es siempre `true`.
              const withinViewport = !shouldVirtualizeInteractive || visiblePages.has(page.page_number);
              const presenterAnimClass = presenterMode && presenterAnim && presenterAnim.page === page.page_number
                ? ` ro-page-anim-${presenterAnim.type}`
                : '';
              return (
              <div
                key={page.page_number}
                className={`ro-page-wrapper${presenterMode ? ' ro-page-wrapper--presenter' : ''}${presenterAnimClass}`}
                data-page-number={page.page_number}
                data-pptx-transition={page.transition || 'none'}
                style={isPrint ? { margin: 0, padding: 0, gap: 0 } : undefined}
              >
                {!isPrint && !presenterMode && <div className="ro-page-label">Página {page.page_number} de {doc.pages.length}</div>}
                <div
                  className="ro-page-canvas"
                  style={{
                    width: PAGE_WIDTH,
                    height: PAGE_HEIGHT,
                    ...(isPrint ? { boxShadow: 'none', borderRadius: 0 } : {}),
                    ...(presenterMode ? { boxShadow: 'none', borderRadius: 0, transform: `scale(${presenterScale})` } : {}),
                  }}
                >
                  {/* Renderizar cada elemento como lectura estática */}
                  {withinExportWindow && withinViewport && page.elements && page.elements.map((el: any) => {
                    // Pedido explícito 2026-09-04: el pie de foto ("Fig. 1 —
                    // ...") no salía en el visor de solo lectura ni en el
                    // PDF/DOCX exportados (que reusan este mismo componente
                    // para fidelidad visual con el editor) porque el div
                    // envoltorio de cada elemento (más abajo) recorta con
                    // `overflow:hidden` a la altura EXACTA de `el.height` —
                    // el mismo criterio que sensor_multi_chart ya usa arriba
                    // para su alto mínimo: reservar el espacio extra ANTES
                    // de recortar, no después.
                    const hasImageCaption = el.type === 'image' && String(el.props?.caption || '').trim().length > 0;
                    const renderedHeight = el.type === 'sensor_multi_chart'
                      ? Math.max(Number(el.height) || 0, sensorDashboardMinHeight(el.props || {}, Number(el.width) || 0))
                      : hasImageCaption
                        ? (Number(el.height) || 0) + 30
                        : el.height;
                    return (
                    <div
                      key={el.id}
                      data-element-id={el.id}
                      data-element-type={el.type}
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.width,
                        height: renderedHeight,
                        zIndex: el.zIndex || 1,
                        // Texto de réplica de PDF (ADR-209): con interlineado
                        // apretado el glifo puede pasar un poco la caja de
                        // línea -- recortarlo cortaría acentos y descendentes.
                        overflow: el.type === 'text' && el.props?.exactLayout ? 'visible' : 'hidden',
                      }}
                    >
                      <ReadOnlyElement
                        element={el.type === 'toc' ? { ...el, _tocEntries: tocSliceForElementId(doc, el.id) } : el}
                        pageNumber={page.page_number}
                        totalPages={doc.pages.length}
                        tenantId={report.tenant_id || report.tenantId}
                        resolveRef={(targetId) => resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc, targetId)}
                        isPrint={isPrint}
                      />
                    </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Meta de autoría */}
        <div className="ro-meta">
          <div className="ro-meta-item"><strong>Autor:</strong> {report.createdByName || report.createdBy || '—'}</div>
          <div className="ro-meta-item"><strong>Revisado por:</strong> {report.reviewedByName || report.reviewedBy || 'Sin revisar'}</div>
          <div className="ro-meta-item"><strong>Estado:</strong> {report.status || 'draft'}</div>
          <div className="ro-meta-item"><strong>Versión:</strong> v{report.versionNumber || 1}</div>
          <div className="ro-meta-item"><strong>Creado:</strong> {report.createdAt ? new Date(report.createdAt).toLocaleString('es-PE') : '—'}</div>
          <div className="ro-meta-item"><strong>Actualizado:</strong> {report.updatedAt ? new Date(report.updatedAt).toLocaleString('es-PE') : '—'}</div>
          {(report.signed_by_name || report.signedByName) && (
            <div className="ro-meta-item">
              <strong>Firma documental:</strong>{' '}
              {report.signed_by_name ?? report.signedByName}
              {(report.signed_by_role ?? report.signedByRole) ? ` — ${report.signed_by_role ?? report.signedByRole}` : ''}
              {(report.signed_at ?? report.signedAt) ? ` (${new Date(report.signed_at ?? report.signedAt).toLocaleString('es-PE')})` : ''}
            </div>
          )}
        </div>
      </div>
      {password && <PdfPasswordModal password={password} reportId={report.id} onClose={clearPassword} />}
      {shareLink && (
        <ShareLinkModal url={shareLink.url} expiresInHours={shareLink.expiresInHours} onClose={clearLink} />
      )}
    </div>
  );
}

function ReadOnlyShape({ element }: { element: any }) {
  const props = element.props || {};
  const shapeType = props.shapeType || 'rectangle';
  const fill = props.fill || '#dbeafe';
  const stroke = props.stroke || '#2563eb';
  const strokeWidth = Number(props.strokeWidth ?? 2);
  const width = Math.max(1, Number(element.width) || 1);
  const height = Math.max(1, Number(element.height) || 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;

  let shape: React.ReactNode;
  if (shapeType === 'circle' || shapeType === 'ellipse') {
    shape = (
      <ellipse
        cx={centerX}
        cy={centerY}
        rx={shapeType === 'circle' ? radius : width / 2}
        ry={shapeType === 'circle' ? radius : height / 2}
      />
    );
  } else if (shapeType === 'diamond') {
    shape = <polygon points={`${centerX},0 ${width},${centerY} ${centerX},${height} 0,${centerY}`} />;
  } else if (shapeType === 'triangle') {
    shape = <polygon points={`${centerX},0 ${width},${height} 0,${height}`} />;
  } else if (shapeType === 'star') {
    const points = Array.from({ length: 10 }, (_, index) => {
      const pointRadius = index % 2 === 0 ? radius : radius / 2;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      return `${centerX + Math.cos(angle) * pointRadius},${centerY + Math.sin(angle) * pointRadius}`;
    }).join(' ');
    shape = <polygon points={points} />;
  } else if (shapeType === 'line') {
    shape = <line x1="0" y1={centerY} x2={width} y2={centerY} />;
  } else {
    shape = <rect x="0" y="0" width={width} height={height} />;
  }

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
    >
      {React.cloneElement(shape as React.ReactElement, {
        fill: shapeType === 'line' ? 'none' : fill,
        stroke,
        strokeWidth,
        opacity: Number(props.opacity ?? 1),
        vectorEffect: 'non-scaling-stroke',
      })}
    </svg>
  );
}

/** Texto decorativo tipo "WordArt" (`type === 'wordart'`) -- relleno sólido o
 * degradado (`background-clip:text`), contorno (`-webkit-text-stroke`) y
 * sombra opcionales. A diferencia del lienzo (`WordArtBlock.tsx`, Konva
 * nativo), acá el contenedor es HTML real, así que se simula con CSS en vez
 * de las props nativas de Konva -- mismo criterio de "dos implementaciones
 * separadas" que ya usa `ReadOnlyShape` vs. `ShapeVisual`. */
function ReadOnlyWordArt({ element }: { element: any }) {
  const props = element.props || {};
  const hasGradient = !!props.gradientFrom && !!props.gradientTo;
  const strokeWidth = Number(props.strokeWidth) || 0;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: props.textAlign === 'left' ? 'flex-start' : props.textAlign === 'right' ? 'flex-end' : 'center',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontFamily: props.fontFamily || 'Arial',
          fontSize: Number(props.fontSize) || 48,
          fontWeight: 800,
          textAlign: props.textAlign || 'center',
          lineHeight: 1.1,
          WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${props.strokeColor || '#0f172a'}` : undefined,
          textShadow: props.shadow ? '3px 3px 6px rgba(0,0,0,0.45)' : undefined,
          background: hasGradient ? `linear-gradient(135deg, ${props.gradientFrom}, ${props.gradientTo})` : undefined,
          WebkitBackgroundClip: hasGradient ? 'text' : undefined,
          backgroundClip: hasGradient ? 'text' : undefined,
          WebkitTextFillColor: hasGradient ? 'transparent' : undefined,
          color: hasGradient ? undefined : (props.fillColor || '#1d4ed8'),
        }}
      >
        {String(props.text || '')}
      </span>
    </div>
  );
}

/** Renderiza un solo elemento de página en modo lectura estática */
function ReadOnlyElement({ element, pageNumber, totalPages, tenantId, resolveRef, isPrint }: { element: any; pageNumber?: number; totalPages?: number; tenantId?: string; resolveRef?: (targetId: string) => string | undefined; isPrint?: boolean }) {
  const props = element.props || {};

  // Acepta documentos antiguos que hayan serializado el tipo con otra
  // capitalización; sin esto el exportador caía en el placeholder [SHAPE].
  if (String(element.type || '').toLowerCase() === 'shape') {
    return <ReadOnlyShape element={element} />;
  }

  if (String(element.type || '').toLowerCase() === 'wordart') {
    return <ReadOnlyWordArt element={element} />;
  }

  if (element.type === 'header') {
    // ADR-046 (revisado): mismo cálculo en vivo que PageCanvas.tsx — empresa,
    // unidad y usuario conectado nunca se leen de props (ya no existen ahí).
    const session = getSession();
    const chromeParts = [session?.company, resolveMiningUnitName(session), session?.fullName || session?.username]
      .filter((v): v is string => Boolean(v && v.trim()));
    const chromeLabel = (chromeParts.length > 0 ? chromeParts.join('  •  ') : 'EMPRESA MINERA').toUpperCase();
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '2px solid #0f172a', boxSizing: 'border-box', padding: '0 4px', gap: 12,
      }}>
        <span style={{
          fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
          letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', minWidth: 0,
        }}>
          {chromeLabel}
        </span>
        {props.showLogo !== false && (props.tenantId || session?.tenantId) && (
          <ReadOnlyHeaderLogo tenantId={props.tenantId || session?.tenantId} />
        )}
      </div>
    );
  }

  if (element.type === 'footer') {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid #cbd5e1', boxSizing: 'border-box', padding: '0 4px', gap: 12,
      }}>
        <span style={{
          fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
          letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap',
        }}>
          BEEMETRY
        </span>
        {props.showPageNumber !== false && (
          <span style={{
            fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
            letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            PÁGINA {pageNumber || 1} / {totalPages || pageNumber || 1}
          </span>
        )}
      </div>
    );
  }

  if (element.type === 'text') {
    // Render con formato por-selección (spans) + borde del bloque — igual que
    // el editor, para que las cajas de resaltado, el pie de figura y las
    // tarjetas KPI de "Bloques Técnicos" (bloques `text` con título en negrita
    // / valor grande vía spans y borde de acento) se vean idénticas al
    // exportar/imprimir. Antes se descartaban spans y borde (la negrita/color
    // por selección se perdía en el PDF).
    const _textContent = String(props.text || '');
    const _base: BaseTextStyle = {
      bold: !!props.bold,
      italic: !!props.italic,
      underline: !!props.underline,
      // Sin toggle de BLOQUE para tachado -- ver el mismo criterio explicado
      // en PageCanvas.tsx::pasteTextBaseStyle. Siempre llega como span
      // (texto importado de Word), nunca como estilo base del bloque.
      strikethrough: false,
      color: props.fontColor || '#0f172a',
      fontSize: props.fontSize || 14,
      fontFamily: props.fontFamily || 'Arial',
      highlightColor: props.highlightColor || 'transparent',
      headingStyle: props.headingStyle,
      textAlign: props.textAlign || 'left',
    };
    const _spans = sanitizeSpans(props.spans, _textContent.length);
    // Visor/export SIEMPRE resuelve referencias cruzadas (ADR-019) al número
    // vigente -- a diferencia del overlay de edición activa de PageCanvas.tsx,
    // aquí no hay cursor/selección viva cuyo offset pueda desalinearse.
    const _segments = buildStyledSegments(_textContent, _spans, _base, resolveRef);
    // Un grupo por PÁRRAFO (mismo criterio que TextBlock.tsx) para que cada
    // uno pinte con SU PROPIA alineación -- si no, exportar/imprimir se
    // vería distinto de lo que el editor ya muestra (bug real reportado
    // 2026-09-11: los botones de alineación de la selección solo servían
    // en el lienzo, la exportación seguía usando una sola alineación para
    // todo el bloque).
    const _paragraphGroups = buildParagraphGroups(_textContent, _spans, _base, resolveRef);
    // Réplica de PDF (ADR-209): la caja ES la del texto original -- sin
    // relleno interno ni recorte, igual que el lienzo del editor.
    const _exact = !!props.exactLayout;
    const _border = element.border;
    const _borderCss =
      _border && _border.enabled ? `${_border.width}px ${_border.style} ${_border.color}` : undefined;
    return (
      <div
        style={{
        width: '100%', height: '100%',
        fontFamily: props.fontFamily || 'Arial',
        fontSize: (props.fontSize || 14) + 'px',
        color: props.fontColor || '#0f172a',
        // Versiones anteriores guardaban #ffffff como valor por defecto,
        // aunque el editor lo trataba visualmente como transparente. Al
        // exportar aparecían cajas blancas detrás de títulos y textos.
        backgroundColor: props.backgroundColor === '#ffffff' && !_border?.enabled
          ? 'transparent'
          : (props.backgroundColor || 'transparent'),
        lineHeight: _exact ? `${(props.lineHeight || 1.35) * (props.fontSize || 14)}px` : (props.lineHeight || 1.35),
        fontWeight: props.bold ? 700 : 400,
        fontStyle: props.italic ? 'italic' : 'normal',
        padding: _exact ? 0 : 6,
        overflow: _exact ? 'visible' : 'hidden',
        // Mismo ancho de sangría por TAB que el textarea de edición
        // (PageCanvas.tsx) -- ver LIST_INDENT_TAB_SIZE en listFormatting.ts.
        tabSize: LIST_INDENT_TAB_SIZE,
        wordBreak: 'break-word',
        border: _borderCss,
        borderRadius: _borderCss ? 4 : undefined,
        boxSizing: 'border-box',
        // Columnas tipo periódico (props.columnCount, 1 = sin columnas) --
        // CSS real acá (pantalla/PDF); en DOCX/PPTX se aproxima partiendo el
        // texto en N cuadros lado a lado (buildReportDocx.ts/
        // reportDocxBuilder.js/reportPptxBuilder.js), porque ninguna de las
        // dos librerías expone columnas reales a nivel de un solo párrafo.
        columnCount: Number(props.columnCount) > 1 ? Number(props.columnCount) : undefined,
        columnGap: Number(props.columnCount) > 1 ? 24 : undefined,
      }}>
        {_segments.length === 0 ? <span>&nbsp;</span> : _paragraphGroups.map((group, groupIndex) => (
          <div key={groupIndex} style={{
            textAlign: group.align as any,
            ...(_exact && group.align === 'justify' ? { textAlignLast: 'justify' as const } : {}),
            whiteSpace: 'pre-wrap',
          }}>
            {group.segments.length === 0 ? <br /> : group.segments.map((seg, i) => {
              // Réplica de PDF: heredar el interlineado real del párrafo -- la
              // hoja global de la app fija `span { line-height: 1.35 }`.
              const segCss = { ...(styleToCss(seg.style) as React.CSSProperties), ...(_exact ? { lineHeight: 'inherit' } : {}) };
              // Hipervínculo real -- Chromium (sidecar de export PDF/PPTX,
              // ADR-016/083) incrusta un `<a href>` real como anotación de
              // enlace CLICABLE de verdad al imprimir a PDF, no solo texto
              // azul subrayado. Mismo whitelist de esquema que ya valida el
              // import (lib/richPaste.ts::SAFE_LINK_SCHEME) -- revalidado
              // acá por defensa en profundidad antes de emitir un `href`
              // real en un documento que puede llegar a abrirse fuera de
              // esta app.
              return seg.href && /^(https?:|mailto:)/i.test(seg.href) ? (
                <a key={i} href={seg.href} style={segCss} target="_blank" rel="noopener noreferrer">{seg.text}</a>
              ) : (
                <span key={i} style={segCss}>{seg.text}</span>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  if (element.type === 'kpi') {
    // ADR-012: valor citado congelado al firmar (props.snapshot), no un
    // live-query — así el informe firmado es reproducible. `props.value`
    // se mantiene como fallback legacy (nunca lo escribe el editor hoy,
    // pero no cuesta nada respetarlo si algún día se popula distinto).
    const snap = props.snapshot;
    const displayValue = snap?.value != null ? String(snap.value) : (props.value || '—');
    const unit = snap?.unit ? ` ${snap.unit}` : '';
    return (
      <div style={{
        width: '100%', height: '100%',
        background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)',
        borderRadius: 10, border: '1px solid #c7d2fe',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 10, gap: 4,
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#6366f1' }}>{displayValue}{unit}</div>
        <div style={{ fontSize: 11, color: '#4338ca', fontWeight: 600 }}>{props.title || 'KPI'}</div>
        {snap?.capturedAt && (
          <div style={{ fontSize: 9, color: '#6366f1' }}>
            Al firmar: {String(snap.capturedAt).replace('T', ' ').slice(0, 16)}
          </div>
        )}
      </div>
    );
  }

  if (element.type === 'sensor') {
    // Mismo mecanismo de snapshot que 'kpi' arriba. Antes de este fix este
    // tipo de bloque no tenía NINGÚN handler acá — un informe con un sensor
    // widget se veía completamente vacío al abrir en solo-lectura o exportar
    // a PDF (que reusa este mismo componente, ADR-016).
    const snap = props.snapshot;
    const unit = snap?.unit ? ` ${snap.unit}` : '';
    return (
      <div style={{
        width: '100%', height: '100%',
        background: 'linear-gradient(135deg,#ecfdf5,#d1fae5)',
        borderRadius: 10, border: '1px solid #a7f3d0',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 10, gap: 4,
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#059669' }}>
          {snap?.value != null ? `${snap.value}${unit}` : 'Sin snapshot'}
        </div>
        <div style={{ fontSize: 11, color: '#065f46', fontWeight: 600 }}>{props.title || 'Sensor'}</div>
        {snap?.capturedAt && (
          <div style={{ fontSize: 9, color: '#059669' }}>
            Al firmar: {String(snap.capturedAt).replace('T', ' ').slice(0, 16)}
          </div>
        )}
      </div>
    );
  }

  if (element.type === 'sensor_multi_chart') {
    // A diferencia de kpi/sensor (snapshot congelado al firmar), este bloque
    // ya consulta un rango histórico FIJO (from/to elegidos en el wizard,
    // ver SensorMultiChartInspector.tsx) contra telemetry_raw — es
    // reproducible sin necesitar snapshot, la misma consulta siempre
    // devuelve los mismos datos. Antes de este fix no tenía handler acá: el
    // bloque se veía vacío en modo lectura y en el export PDF (que reusa
    // este componente, ADR-016) aunque en el editor sí mostrara el gráfico.
    return (
      <SensorMultiChartWidget
        title={props.title}
        selections={props.selections}
        chartType={props.chartType}
        chartTypes={props.chartTypes}
        comboConfig={props.comboConfig}
        from={props.from}
        to={props.to}
        liveWindowMinutes={props.liveWindowMinutes}
        tenantId={tenantId}
        width={element.width}
        height="100%"
        isPrint={isPrint}
      />
    );
  }

  if (element.type === 'seismic-report') {
    // Mismo mecanismo de snapshot que 'kpi'/'sensor' arriba (ADR-012): si
    // hay props.snapshot (congelado al firmar), SeismicReportWidget lo
    // renderiza sin llamar a la red -- reproducible en modo lectura/PDF.
    // Si el informe no llegó a firmarse (aún borrador), no hay snapshot
    // todavía; se deja el widget consultar en vivo con el rango guardado.
    return (
      <SeismicReportWidget
        title={props.title}
        source={props.source}
        startDate={props.startDate}
        endDate={props.endDate}
        connected={props.connected !== false}
        snapshot={props.snapshot || null}
        width="100%"
        height="100%"
      />
    );
  }

  if (element.type === 'table') {
    const rows: any[][] = props.rows || [];
    const colCount = rows[0]?.length || 0;
    // Mismas anchuras de columna que el editor (TableBlock.tsx) — sin esto,
    // una tabla con columnas redimensionadas a mano se veía distinta (todas
    // iguales) en modo lectura/exportación que en el lienzo de edición.
    const colWidths: number[] | undefined = Array.isArray(props.colWidths) && props.colWidths.length === colCount
      ? props.colWidths
      : undefined;
    // TableBlock.tsx reescala colWidths proporcionalmente para que la tabla
    // SIEMPRE llene el ancho real del bloque (`effectiveWidths = raw *
    // containerWidth / totalRaw`) — acá no hay una medición de contenedor
    // disponible (render estático), así que se logra lo mismo con columnas
    // en % en vez de usar la suma literal de colWidths como ancho fijo de
    // la tabla: si esa suma no coincidía con el ancho real del bloque, la
    // tabla quedaba más angosta que en el editor, sin llenar el bloque.
    const colWidthsTotal = colWidths ? colWidths.reduce((a, b) => a + b, 0) : 0;
    const mergedCells = Array.isArray(props.mergedCells) ? props.mergedCells : [];
    const mergeKey = (row: number, column: number) => `${row}-${column}`;
    const mergeAnchors = new Map(mergedCells.map((merge: any) => [mergeKey(merge.row, merge.column), merge]));
    const coveredCells = new Set<string>();
    mergedCells.forEach((merge: any) => {
      for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
        for (let column = merge.column; column < merge.column + merge.colSpan; column += 1) {
          if (row !== merge.row || column !== merge.column) coveredCells.add(mergeKey(row, column));
        }
      }
    });
    // Mismos valores por defecto que TableBlock.tsx (editor) — antes esta
    // vista no leía headerTextColor/textColor/bandedRows/cellBackgrounds en
    // absoluto, así que una celda sin color semántico heredaba el `color`
    // del body (#f8fafc, pensado para el chrome oscuro de la app) y el
    // texto quedaba casi invisible sobre el papel blanco del PDF/impresión.
    const textColor = props.textColor || '#334155';
    const headerTextColor = props.headerTextColor || '#1e293b';
    const headerBg = props.headerBg || '#f8fafc';
    const bandedRows = !!props.bandedRows;
    const bandColor = props.bandColor || '#f1f5f9';
    const cellBackgrounds: string[][] | undefined = Array.isArray(props.cellBackgrounds) ? props.cellBackgrounds : undefined;
    const rowBackgrounds: string[] | undefined = Array.isArray(props.rowBackgrounds) ? props.rowBackgrounds : undefined;
    const columnBackgrounds: string[] | undefined = Array.isArray(props.columnBackgrounds) ? props.columnBackgrounds : undefined;
    // Acá nunca hay edición en curso (solo lectura/PDF) -- una celda con
    // fórmula SIEMPRE muestra el resultado calculado, nunca el "=SUMA(...)"
    // crudo (a diferencia del editor, que lo revela mientras la celda está
    // activa vía el overlay de TableBlock.tsx).
    const formulaResults = computeTableFormulas(rows);
    const cellNumberFormats: (string | null)[][] | undefined = Array.isArray(props.cellNumberFormats) ? props.cellNumberFormats : undefined;
    const conditionalStyles = computeConditionalStyles(
      getEffectiveCellValues(rows, formulaResults),
      props.conditionalFormats,
      !!props.hasHeader,
      props.colorScales,
    );
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: (props.fontSize || 13) + 'px' }}>
          {colWidths && colWidthsTotal > 0 && (
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: `${(w / colWidthsTotal) * 100}%` }} />)}
            </colgroup>
          )}
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = ri === 0 && props.hasHeader;
              // Misma paridad que TableBlock.tsx para las filas intercaladas.
              const isBanded = !isHeader && bandedRows && (props.hasHeader ? ri % 2 === 0 : ri % 2 === 1);
              return (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const key = mergeKey(ri, ci);
                  if (coveredCells.has(key)) return null;
                  const merge = mergeAnchors.get(key) as { rowSpan?: number; colSpan?: number } | undefined;
                  // Mismo coloreado semántico (semáforo) que el editor, para
                  // que las tablas de estado se exporten con sus tintes.
                  const sem = semanticStatusStyle(String(cell ?? ''), isHeader);
                  const formulaResult = formulaResults[ri]?.[ci] ?? null;
                  const numberFormat = cellNumberFormats?.[ri]?.[ci] ?? null;
                  // Misma lógica que TableBlock.tsx: una fórmula siempre se
                  // muestra calculada (y formateada si hay % / decimales);
                  // una celda numérica normal SIN fórmula también se
                  // formatea si tiene un formato de número puesto encima.
                  let displayOverride: string | null = null;
                  let displayIsError = false;
                  if (formulaResult) {
                    displayOverride = formulaResult.isError
                      ? formulaResult.display
                      : formatNumberForDisplay(formulaResult.numericValue as number, numberFormat);
                    displayIsError = formulaResult.isError;
                  } else if (numberFormat) {
                    const plainNumber = parseCellNumber(stripCellHtml(String(cell ?? '')));
                    if (plainNumber !== null) displayOverride = formatNumberForDisplay(plainNumber, numberFormat);
                  }
                  const conditionalStyle = conditionalStyles[ri]?.[ci] ?? null;
                  const cellStyle: React.CSSProperties = {
                    border: `1px solid ${props.borderColor || '#e2e8f0'}`,
                    padding: (props.cellPadding || 8) + 'px',
                    fontWeight: isHeader ? 700 : sem ? 700 : 400,
                    backgroundColor: conditionalStyle?.backgroundColor || cellBackgrounds?.[ri]?.[ci] || rowBackgrounds?.[ri] || columnBackgrounds?.[ci] || (isHeader ? headerBg : sem ? sem.bg : isBanded ? bandColor : undefined),
                    color: displayIsError ? '#dc2626' : (conditionalStyle?.textColor || (isHeader ? headerTextColor : sem ? sem.color : textColor)),
                    verticalAlign: (props.cellVAlign as React.CSSProperties['verticalAlign']) || 'top',
                    // Sin esto el texto largo (p.ej. "CUMPLE PARCIALMENTE") no
                    // rompía línea dentro del ancho fijo de columna (la
                    // <table> ya usa tableLayout:'fixed' + colgroup con los
                    // mismos anchos que el editor) y se desbordaba visualmente
                    // sobre la celda vecina en el PDF/impresión -- reportado
                    // en vivo 2026-09-11. Mismo wordBreak que ya usa el <td>
                    // real del lienzo (TableBlock.tsx), que nunca tuvo este
                    // problema porque sí lo aplicaba.
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                  };
                  if (displayOverride !== null) {
                    return <td key={ci} rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} style={cellStyle}>{displayOverride}</td>;
                  }
                  return (
                  <td key={ci} rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} style={cellStyle}
                    // La celda es HTML enriquecido (negrita/cursiva por
                    // celda vía contentEditable, ver TableBlock.tsx), no
                    // texto plano — renderizarla como children de React
                    // escapaba las etiquetas y mostraba "<b>texto</b>"
                    // literal en el visor de solo lectura y el export PDF.
                    dangerouslySetInnerHTML={{ __html: toTrustedHtml(sanitizeRichHtml(String(cell ?? ''))) }}
                  />
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (element.type === 'image') {
    const src = resolveReportImageSrc(element);
    const caption = String(props.caption ?? '').trim();
    return (
      // Pedido explícito 2026-09-04: "las imágenes no están saliendo con el
      // tamaño que tienen en el lienzo sino su tamaño original o cuadrado".
      // El div envolvente ANTES centraba una <img> con maxWidth/maxHeight
      // (el tamaño "usado" de un <img> con solo max-*, sin width/height
      // propios, es su tamaño INTRÍNSECO recortado a ese máximo -- así que
      // una imagen más chica que el bloque quedaba a su tamaño original,
      // flotando en el centro con espacio vacío alrededor, en vez de llenar
      // el recuadro) y usaba `objectFit: 'contain'` por defecto en vez de
      // 'cover' -- ninguno de los dos coincidía con PageCanvas.tsx (el
      // lienzo real), que fuerza width/height:100% + object-fit:cover. Se
      // replica exactamente esa estructura acá (imagen a el.height fijo +
      // pie de foto debajo, ver `renderedHeight` en el llamador) para que
      // el visor de solo lectura y el PDF/DOCX exportados —que reusan este
      // mismo componente— se vean IGUAL que el editor.
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          width: '100%',
          height: element.height,
          overflow: 'hidden',
          borderRadius: 6,
          background: '#f1f5f9',
        }}>
          <img
            src={src}
            alt={props.alt || ''}
            style={{ width: '100%', height: '100%', objectFit: (element.objectFit as any) || 'cover', display: 'block' }}
          />
        </div>
        {caption && (
          <div
            className="report-media-caption"
            style={{
              width: '100%',
              marginTop: 6,
              textAlign: 'center',
              fontFamily: 'Arial, sans-serif',
              fontSize: 12,
              lineHeight: 1.25,
              fontStyle: 'italic',
              color: '#4F81BD',
              overflowWrap: 'anywhere',
            }}
          >
            {caption}
          </div>
        )}
      </div>
    );
  }

  if (element.type === 'video') {
    return element.src ? (
      <video
        src={element.src}
        poster={props.posterSrc || undefined}
        controls
        ref={(el) => fixRecordedVideoElement(el)}
        style={{ width: '100%', height: '100%', background: '#000', borderRadius: 6, display: 'block' }}
      />
    ) : (
      <div style={{
        width: '100%', height: '100%',
        background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: 12,
      }}>
        Sin video
      </div>
    );
  }

  if (element.type === 'cover') {
    // ADR-048 (revisado): mismo diseño que PageCanvas.tsx — la foto de la
    // unidad minera ya NO es un fondo del cover (es un bloque `image`
    // independiente, ver más abajo); empresa/unidad/autor se calculan en
    // vivo desde la sesión activa, nunca desde props.
    const session = getSession();
    const chromeCompany = session?.company;
    const chromeUnit = resolveMiningUnitName(session);
    const chromeAuthor = session?.fullName || session?.username;
    const template = findCoverTemplate(props.coverTemplate);
    return (
      <div style={{
        width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        color: props.textColor || template.textColor,
        background: props.bgColor || template.background,
        fontFamily: template.bodyFontFamily || 'inherit',
      }}>
        <div style={{ background: template.classificationBg, color: template.classificationColor, fontSize: 12, fontWeight: 800, letterSpacing: 2, textAlign: 'center', padding: '10px 0', textTransform: 'uppercase' }}>
          {props.classification || template.classificationLabel}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 40px 0' }}>
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', minHeight: 40 }}>
            <ReadOnlyHeaderLogo tenantId={props.tenantId || session?.tenantId} />
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '24px 56px', textAlign: 'center' }}>
          <h1 style={{ fontFamily: template.titleFontFamily, fontSize: 44, fontWeight: 900, margin: '0 0 16px', lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
            {props.title || template.titleFallback}
          </h1>
          {chromeCompany && <div style={{ fontSize: 22, fontWeight: 700, textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>{chromeCompany}</div>}
          {chromeUnit && <div style={{ fontSize: 16, opacity: 0.9, marginTop: 4 }}>{chromeUnit}</div>}
        </div>
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.25)', padding: '18px 40px',
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between',
          background: template.footerBg,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12 }}>
            {props.docCode && <span><b>Código:</b> {props.docCode}</span>}
            {chromeAuthor && <span><b>Autor:</b> {chromeAuthor}</span>}
            {props.date && <span><b>Fecha:</b> {props.date}</span>}
          </div>
          <span style={{ fontFamily: PLATFORM_CHROME_FONT, fontSize: 13, fontWeight: 900, letterSpacing: 1.2, opacity: 0.95 }}>
            BEEMETRY
          </span>
        </div>
      </div>
    );
  }

  if (element.type === 'toc') {
    // Misma numeración jerárquica + jerarquía tipográfica por nivel que
    // PageCanvas.tsx (única fuente de verdad: generateTocData) — antes esta
    // vista usaba `_tocEntries` (heurística vieja sin numerar ni indentar),
    // por lo que el PDF/solo-lectura no coincidía con el índice del editor.
    const entries: TocItem[] = element._tocEntries || [];
    const levelStyle: Record<number, { fontSize: number; fontWeight: number; color: string; fontStyle?: string }> = {
      1: { fontSize: 14,   fontWeight: 700, color: '#0f172a' },
      2: { fontSize: 13,   fontWeight: 700, color: '#1e40af' },
      3: { fontSize: 12.5, fontWeight: 600, color: '#334155' },
      4: { fontSize: 12,   fontWeight: 500, color: '#475569' },
      5: { fontSize: 11.5, fontWeight: 500, color: '#64748b', fontStyle: 'italic' },
      6: { fontSize: 11,   fontWeight: 400, color: '#94a3b8', fontStyle: 'italic' },
    };
    return (
      <div style={{
        width: '100%', height: '100%', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6,
        background: '#ffffff', boxSizing: 'border-box', padding: 18,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', borderBottom: '2px solid #0f172a', paddingBottom: 6 }}>
          {props.title || 'Tabla de Contenidos'}{typeof props.tocContinuationIndex === 'number' ? ' (continuación)' : ''}
        </h2>
        {entries.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Sin entradas de índice.</div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {entries.map((item, i) => {
              const st = levelStyle[item.level] || levelStyle[6];
              return (
                <li
                  key={`${item.id}-${i}`}
                  // Leído por pdf-export-service/server.js (Puppeteer) SOLO
                  // durante el export a PDF -- convierte el rectángulo de
                  // esta fila en un enlace real (clic salta a la página del
                  // documento), no afecta el editor ni el visor interactivo.
                  data-toc-link-target-page={item.pageNumber}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    padding: '3px 0', paddingLeft: (item.level - 1) * 16,
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.number}</span>
                  <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color, fontStyle: st.fontStyle }}>{item.text}</span>
                  <span style={{ flex: 1, borderBottom: '1px dotted #cbd5e1', margin: '0 2px', transform: 'translateY(-3px)' }} />
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.pageNumber}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }

  if (element.type === 'chart') {
    // Gráficos estáticos con datos (línea/barras/combo) se renderizan igual
    // que en el editor para que aparezcan en el PDF/impresión. El gráfico
    // "en vivo" genérico (onda demo) también se dibuja.
    const w = Math.max(120, (element.width || 320) - 8);
    const h = Math.max(80, (element.height || 240) - 8);
    return (
      <div style={{ width: '100%', height: '100%', background: '#ffffff', overflow: 'hidden' }}>
        <LiveChartBlock width={w} height={h} data={props} />
      </div>
    );
  }

  // otros: placeholder
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#94a3b8', fontSize: 12, fontWeight: 600,
    }}>
      [{element.type?.toUpperCase() || 'BLOQUE'}]
    </div>
  );
}

export default memo(ReadOnlyViewer);
