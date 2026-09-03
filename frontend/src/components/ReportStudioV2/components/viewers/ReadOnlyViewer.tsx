import React, { memo, useEffect, useState } from 'react';
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
import { tocSliceForElementId, resolvePagePaperSetup } from '../../store/useEditorStore';
import { getReportLayoutMetrics } from '../../lib/reportLayoutMetrics';
import type { TocItem } from '../document/TableOfContents';
import { resolveHeadingRefLabel } from '../document/TableOfContents';
import { buildStyledSegments, sanitizeSpans, styleToCss, type BaseTextStyle } from '../../lib/textSpans';
import { isPptxOverlayEligible, type PptxOverlayMeta } from '../../lib/pptxOverlayMapping';
import { semanticStatusStyle } from '../../lib/semanticStatus';
import { sanitizeRichHtml } from '../../lib/sanitizeHtml';
import { toTrustedHtml } from '../../../../lib/trustedHtml';
import LiveChartBlock from '../dashboard/LiveChartBlock';
import SeismicReportWidget from '../document/SeismicReportWidget';
import SensorMultiChartWidget from '../document/SensorMultiChartWidget';
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
  /** Solo la usa el sidecar de export PPTX (print-report.html?pptxOverlay=1):
   * los bloques `isPptxOverlayEligible` (hoy solo `text`) se capturan con la
   * tinta invisible (mismo layout/line-wrap, sin texto visible) y se marcan
   * con `data-pptx-overlay`/`data-pptx-meta` — el sidecar lee esos atributos
   * para superponer un cuadro de texto NATIVO editable de PowerPoint en la
   * misma posición, en vez de dejar el texto horneado en la imagen de fondo. */
  hideOverlayText?: boolean;
  /** Modo de impresión/export PDF aislado server-side: omite la barra de herramientas y etiquetas de página */
  isPrint?: boolean;
}

/**
 * ReadOnlyViewer — muestra el contenido de un informe en modo solo lectura.
 * Renderiza las páginas usando el mismo HTML que MultipageView pero deshabilitando
 * toda interacción (pointer-events: none en el contenido).
 */
function ReadOnlyViewer({ report, onClose, hideOverlayText, isPrint = false }: ReadOnlyViewerProps) {
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
    <div className="ro-overlay" style={isPrint ? { position: 'relative', background: '#ffffff', width: '100%', margin: 0, padding: 0 } : undefined}>
      {/* ── Barra superior readonly (oculta en modo impresión) ── */}
      {!isPrint && (
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
      <div className="ro-content" style={isPrint ? { padding: 0, margin: 0, overflow: 'visible' } : undefined}>
        {!doc ? (
          <div className="ro-no-content">
            <Eye size={40} style={{ opacity: 0.2 }} />
            <p>Este informe no tiene contenido visual disponible.</p>
          </div>
        ) : (
          <div className="ro-pages" style={{ pointerEvents: 'none', userSelect: 'none', ...(isPrint ? { gap: 0, padding: 0, margin: 0 } : {}) }}>
            {doc.pages && doc.pages.map((page: any) => {
              // Mismo cálculo que PageCanvas.tsx/MultipageView.tsx (editor):
              // sin esto, `.ro-page-canvas` quedaba fijo en A4-portrait vía
              // CSS y un informe en layoutMode 'presentation' (lienzo 960×540)
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
              return (
              <div key={page.page_number} className="ro-page-wrapper" data-page-number={page.page_number} style={isPrint ? { margin: 0, padding: 0, gap: 0 } : undefined}>
                {!isPrint && <div className="ro-page-label">Página {page.page_number} de {doc.pages.length}</div>}
                <div className="ro-page-canvas" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, ...(isPrint ? { boxShadow: 'none', borderRadius: 0 } : {}) }}>
                  {/* Renderizar cada elemento como lectura estática */}
                  {withinExportWindow && page.elements && page.elements.map((el: any) => {
                    const renderedHeight = el.type === 'sensor_multi_chart'
                      ? Math.max(Number(el.height) || 0, sensorDashboardMinHeight(el.props || {}, Number(el.width) || 0))
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
                        overflow: 'hidden',
                      }}
                    >
                      <ReadOnlyElement
                        element={el.type === 'toc' ? { ...el, _tocEntries: tocSliceForElementId(doc, el.id) } : el}
                        pageNumber={page.page_number}
                        totalPages={doc.pages.length}
                        tenantId={report.tenant_id || report.tenantId}
                        hideOverlayText={hideOverlayText}
                        resolveRef={(targetId) => resolveHeadingRefLabel(doc, targetId)}
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
      {password && <PdfPasswordModal password={password} onClose={clearPassword} />}
      {shareLink && (
        <ShareLinkModal url={shareLink.url} expiresInHours={shareLink.expiresInHours} onClose={clearLink} />
      )}
    </div>
  );
}

/** Renderiza un solo elemento de página en modo lectura estática */
function ReadOnlyElement({ element, pageNumber, totalPages, tenantId, hideOverlayText, resolveRef, isPrint }: { element: any; pageNumber?: number; totalPages?: number; tenantId?: string; hideOverlayText?: boolean; resolveRef?: (targetId: string) => string | undefined; isPrint?: boolean }) {
  const props = element.props || {};

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
      color: props.fontColor || '#0f172a',
      fontSize: props.fontSize || 14,
      fontFamily: props.fontFamily || 'Arial',
      highlightColor: props.highlightColor || 'transparent',
      headingStyle: props.headingStyle,
    };
    const _spans = sanitizeSpans(props.spans, _textContent.length);
    // Visor/export SIEMPRE resuelve referencias cruzadas (ADR-019) al número
    // vigente -- a diferencia del overlay de edición activa de PageCanvas.tsx,
    // aquí no hay cursor/selección viva cuyo offset pueda desalinearse.
    const _segments = buildStyledSegments(_textContent, _spans, _base, resolveRef);
    const _border = element.border;
    const _borderCss =
      _border && _border.enabled ? `${_border.width}px ${_border.style} ${_border.color}` : undefined;
    // Overlay PPTX (ver lib/pptxOverlayMapping.ts): con hideOverlayText, este
    // bloque conserva EXACTAMENTE el mismo layout (mismo padding/salto de
    // línea) pero con la tinta invisible — el sidecar mide este mismo div
    // (data-pptx-overlay) para superponer un cuadro de texto nativo editable
    // en la posición exacta, en vez de dejar el texto horneado en la imagen.
    const _overlayActive = hideOverlayText && isPptxOverlayEligible('text') && _segments.length > 0;
    const _overlayMeta: PptxOverlayMeta | null = _overlayActive
      ? {
          align: (props.textAlign || 'left') as PptxOverlayMeta['align'],
          runs: _segments.map((seg) => ({
            text: seg.text,
            bold: !!seg.style.bold,
            italic: !!seg.style.italic,
            underline: !!seg.style.underline,
            color: seg.style.color,
            fontSize: seg.style.fontSize,
            fontFamily: seg.style.fontFamily,
            highlightColor:
              seg.style.highlightColor && seg.style.highlightColor !== 'transparent'
                ? seg.style.highlightColor
                : undefined,
          })),
        }
      : null;
    return (
      <div
        data-pptx-overlay={_overlayMeta ? '1' : undefined}
        data-pptx-meta={_overlayMeta ? JSON.stringify(_overlayMeta) : undefined}
        style={{
        width: '100%', height: '100%',
        fontFamily: props.fontFamily || 'Arial',
        fontSize: (props.fontSize || 14) + 'px',
        color: props.fontColor || '#0f172a',
        backgroundColor: props.backgroundColor || 'transparent',
        textAlign: props.textAlign || 'left',
        lineHeight: props.lineHeight || 1.35,
        fontWeight: props.bold ? 700 : 400,
        fontStyle: props.italic ? 'italic' : 'normal',
        padding: 6,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        border: _borderCss,
        borderRadius: _borderCss ? 4 : undefined,
        boxSizing: 'border-box',
      }}>
        {_segments.length === 0 ? <span>&nbsp;</span> : _segments.map((seg, i) => {
          const segCss = styleToCss(seg.style) as React.CSSProperties;
          return (
            <span key={i} style={_overlayActive ? { ...segCss, color: 'transparent' } : segCss}>{seg.text}</span>
          );
        })}
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
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <table style={{ width: colWidths ? colWidths.reduce((a: number, b: number) => a + b, 0) : '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: (props.fontSize || 13) + 'px' }}>
          {colWidths && (
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
          )}
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = ri === 0 && props.hasHeader;
              return (
              <tr key={ri} style={{ background: isHeader ? (props.headerBg || '#f8fafc') : 'white' }}>
                {row.map((cell, ci) => {
                  // Mismo coloreado semántico (semáforo) que el editor, para
                  // que las tablas de estado se exporten con sus tintes.
                  const sem = semanticStatusStyle(String(cell ?? ''), isHeader);
                  return (
                  <td key={ci} style={{
                    border: `1px solid ${props.borderColor || '#e2e8f0'}`,
                    padding: (props.cellPadding || 8) + 'px',
                    fontWeight: isHeader ? 700 : sem ? 700 : 400,
                    backgroundColor: sem ? sem.bg : undefined,
                    color: sem ? sem.color : undefined,
                  }}
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
    return (
      <div style={{
        width: '100%', height: '100%',
        background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: 12,
      }}>
        <img src={src} alt={props.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: element.objectFit || 'contain' }} />
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
    return (
      <div style={{
        width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        color: props.textColor || '#ffffff',
        background: props.bgColor || 'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
      }}>
        <div style={{ background: 'rgba(15,23,42,0.9)', color: '#fbbf24', fontSize: 12, fontWeight: 800, letterSpacing: 2, textAlign: 'center', padding: '10px 0', textTransform: 'uppercase' }}>
          {props.classification || 'CONFIDENCIAL'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 40px 0' }}>
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', minHeight: 40 }}>
            <ReadOnlyHeaderLogo tenantId={props.tenantId || session?.tenantId} />
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '24px 56px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 44, fontWeight: 900, margin: '0 0 16px', lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
            {props.title || 'Informe Técnico'}
          </h1>
          {chromeCompany && <div style={{ fontSize: 22, fontWeight: 700, textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>{chromeCompany}</div>}
          {chromeUnit && <div style={{ fontSize: 16, opacity: 0.9, marginTop: 4 }}>{chromeUnit}</div>}
        </div>
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.25)', padding: '18px 40px',
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(15,23,42,0.35)',
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
                <li key={`${item.id}-${i}`} style={{
                  display: 'flex', alignItems: 'baseline', gap: 6,
                  padding: '3px 0', paddingLeft: (item.level - 1) * 16,
                }}>
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
