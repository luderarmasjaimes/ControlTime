import { log } from '../../../lib/logger';
import { getSession } from '../../../auth/authStorage';
import { resolveMiningUnitName } from './sessionChrome';
/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT ENGINE — PDF / DOCX / PPTX / PNG (server-side + client fallback)
   Etapa 1: Motor de exportación de alta fidelidad para informes mineros
   ───────────────────────────────────────────────────────────────────────── */

const API_BASE = '/api';

export interface ExportOptions {
  paperSize?: string;
  orientation?: string;
  margins?: { top: number; right: number; bottom: number; left: number };
  includeHeaders?: boolean;
  includeFooters?: boolean;
  includePageNumbers?: boolean;
  quality?: string;
  author?: string;
  template?: string;
  theme?: string;
}

export interface ExportResult {
  success: boolean;
  method?: 'server' | 'print-fallback' | 'client-fallback' | 'client';
  error?: string;
}

/**
 * Exporta el documento como PDF de alta fidelidad vía servidor.
 * Fallback: si el servidor no responde, NO llama window.print() acá mismo
 * (esta función no tiene acceso al visor de solo lectura .ro-overlay que
 * acota la impresión nativa del navegador al informe — llamarlo aquí
 * imprimiría el editor completo). Devuelve method:'print-fallback' y deja
 * que el caller (App.tsx::handleExportPdf) abra la vista previa de
 * impresión real.
 */
export async function exportPDF(doc: any, options: ExportOptions = {}): Promise<ExportResult> {
  const payload = {
    document: doc,
    format: 'pdf',
    paperSize: options.paperSize || 'A4',
    orientation: options.orientation || 'portrait',
    margins: options.margins || { top: 20, right: 20, bottom: 20, left: 20 },
    includeHeaders: options.includeHeaders !== false,
    includeFooters: options.includeFooters !== false,
    includePageNumbers: options.includePageNumbers !== false,
    quality: options.quality || 'high',
    embedFonts: true,
    metadata: {
      title: doc.meta?.title || 'Informe Técnico Minero',
      author: options.author || 'Beemetry Platform',
      subject: 'Informe Técnico de Operación Minera',
      keywords: 'minería, informe, técnico, operación',
      creator: 'Beemetry Mining Platform v2.0',
      producer: 'Beemetry Export Engine',
    },
  };

  try {
    const response = await fetch(`${API_BASE}/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const blob = await response.blob();
    downloadBlob(blob, generateFilename(doc, 'pdf'), 'application/pdf');
    return { success: true, method: 'server' };
  } catch (err) {
    log.warn('[EXPORT] Server PDF failed, falling back to print:', err);
    return { success: true, method: 'print-fallback' };
  }
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Exporta como DOCX (OpenXML real) — pipeline cliente de alta fidelidad
 * (`lib/docx/buildReportDocx.ts`): construye el documento DIRECTAMENTE desde
 * el JSON del lienzo (texto/tabla/imagen/kpi/sensor/seismic-report/header/
 * footer/toc quedan como contenido NATIVO editable de Word, posicionado
 * absolutamente en su x/y/width/height exactos) y captura como imagen SOLO
 * los bloques sin representación estática reconstruible (`chart`/
 * `sensor_multi_chart`/fondo de `cover`, vía `captureRasterAssets.ts`).
 *
 * No hay `POST /api/export/docx` en el backend (a diferencia de PDF/PPTX) —
 * este pipeline no depende de red ni de que el informe esté guardado, así
 * que funciona también sobre un borrador en memoria. Si por lo que sea
 * fallara (excepción irrecuperable), se conserva `exportDOCXClientFallback`
 * como último recurso -- peor fidelidad, pero nunca deja al usuario sin
 * ningún archivo.
 */
export async function exportDOCX(doc: any, options: ExportOptions = {}): Promise<ExportResult> {
  try {
    const { buildReportDocx } = await import('./docx/buildReportDocx');
    const { captureRasterAssets, resolveImageBytes } = await import('./docx/captureRasterAssets');
    const { resolveReportImageSrc } = await import('./reportImageSrc');

    const session = getSession() || {};
    const imageAssets = new Map<string, Uint8Array>();
    for (const page of doc.pages || []) {
      for (const el of page.elements || []) {
        if (el.type !== 'image') continue;
        try {
          const src = resolveReportImageSrc(el);
          imageAssets.set(el.id, await resolveImageBytes(src));
        } catch (imgErr) {
          log.warn('[EXPORT][DOCX] No se pudo resolver una imagen, se omite del .docx:', el.id, imgErr);
        }
      }
    }
    const rasterAssets = await captureRasterAssets(doc, { tenant_id: (session as any)?.tenantId });

    const blob = await buildReportDocx(doc, { session: session as any, imageAssets, rasterAssets });
    downloadBlob(blob, generateFilename(doc, 'docx'), DOCX_MIME);
    return { success: true, method: 'client' };
  } catch (err) {
    log.warn('[EXPORT][DOCX] Pipeline cliente de alta fidelidad falló, usando fallback HTML básico:', err);
    return exportDOCXClientFallback(doc, options);
  }
}

// PPTX (modo presentación) tiene su propio pipeline server-side asíncrono
// (report_export_job vía createPptxExportJob/pollExportJob/fetchExportJobBlob
// en lib/api.ts, invocado directamente desde App.tsx::handleExportPptx) — a
// diferencia de PDF/DOCX no existe un fallback cliente sensato (el servidor
// tiene que capturar la página real, no hay forma de "imprimir" un PPTX).

/** Client-side DOCX fallback using HTML conversion */
function exportDOCXClientFallback(doc: any, options: ExportOptions = {}): ExportResult {
  try {
    const htmlParts = ['<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>'];
    htmlParts.push('body{font-family:Calibri,sans-serif;font-size:11pt;color:#1e293b;margin:2cm}');
    htmlParts.push('h1{font-size:18pt;color:#0f172a;border-bottom:2px solid #0891b2;padding-bottom:6pt}');
    htmlParts.push('h2{font-size:14pt;color:#1e293b;margin-top:18pt}');
    htmlParts.push('h3{font-size:12pt;color:#334155;margin-top:12pt}');
    htmlParts.push('table{border-collapse:collapse;width:100%}td,th{border:1px solid #e2e8f0;padding:6pt 8pt;font-size:10pt}');
    htmlParts.push('th{background:#f8fafc;font-weight:bold}');
    htmlParts.push('.kpi{display:inline-block;padding:8pt 16pt;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4pt;margin:4pt;text-align:center}');
    htmlParts.push('.kpi-value{font-size:20pt;font-weight:bold;color:#0891b2}');
    htmlParts.push('</style></head><body>');

    (doc.pages || []).forEach((page: any, idx: number) => {
      if (idx > 0) htmlParts.push('<br clear="all" style="page-break-before:always">');
      (page.elements || []).forEach((el: any) => {
        if (el.type === 'text') {
          const text = el.props?.text || '';
          // ADR-011 (revisado): headingStyle vive en el.props, no en el
          // elemento directamente (mismo fix aplicado en TableOfContents.tsx).
          const style = el.props?.headingStyle || '';
          if (style === 'h1' || style === 'title') htmlParts.push(`<h1>${escapeHtml(text)}</h1>`);
          else if (style === 'h2') htmlParts.push(`<h2>${escapeHtml(text)}</h2>`);
          else if (style === 'h3') htmlParts.push(`<h3>${escapeHtml(text)}</h3>`);
          else if (style === 'h4') htmlParts.push(`<h4>${escapeHtml(text)}</h4>`);
          else if (style === 'h5') htmlParts.push(`<h5>${escapeHtml(text)}</h5>`);
          else if (style === 'h6') htmlParts.push(`<h6>${escapeHtml(text)}</h6>`);
          else htmlParts.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
        } else if (el.type === 'kpi') {
          // ADR-012: mismo snapshot congelado que ReadOnlyViewer.tsx (antes
          // este bloque leía `el.props?.value`, un campo que el editor nunca
          // escribe — el DOCX exportado mostraba "—" para todo KPI).
          const kpiSnap = el.props?.snapshot;
          const kpiValue = kpiSnap?.value != null ? String(kpiSnap.value) : (el.props?.value || '—');
          const kpiUnit = kpiSnap?.unit ? ` ${kpiSnap.unit}` : '';
          htmlParts.push(`<div class="kpi"><div class="kpi-value">${escapeHtml(kpiValue + kpiUnit)}</div><div>${escapeHtml(el.props?.title || '')}</div></div>`);
        } else if (el.type === 'sensor') {
          // Antes de este fix, 'sensor' no tenía ningún caso en este switch:
          // el bloque simplemente desaparecía del DOCX exportado.
          const sensorSnap = el.props?.snapshot;
          const sensorValue = sensorSnap?.value != null
            ? `${sensorSnap.value}${sensorSnap.unit ? ` ${sensorSnap.unit}` : ''}`
            : 'Sin snapshot';
          htmlParts.push(`<div class="kpi"><div class="kpi-value">${escapeHtml(sensorValue)}</div><div>${escapeHtml(el.props?.title || 'Sensor')}</div></div>`);
        } else if (el.type === 'seismic-report') {
          // Mismo snapshot congelado que kpi/sensor arriba (ADR-012).
          const seisSnap = el.props?.snapshot;
          const igpEvents: any[] = seisSnap?.igpEvents || [];
          const companyCount = seisSnap?.companyCount;
          const source = el.props?.source || 'both';
          htmlParts.push(`<p><strong>${escapeHtml(el.props?.title || 'Reporte Sismográfico')}</strong> (${escapeHtml(el.props?.startDate || '')} — ${escapeHtml(el.props?.endDate || '')})</p>`);
          if (source === 'igp' || source === 'both') {
            htmlParts.push('<table><tr><th>Fecha</th><th>Mag.</th><th>Prof.(km)</th><th>Referencia</th></tr>');
            if (igpEvents.length > 0) {
              igpEvents.slice(-10).reverse().forEach((ev) => {
                htmlParts.push(`<tr><td>${escapeHtml(String(ev.fecha_local || '—').slice(0, 10))}</td><td>${escapeHtml(String(ev.magnitud ?? '—'))}</td><td>${escapeHtml(String(ev.profundidad ?? '—'))}</td><td>${escapeHtml(String(ev.referencia || '—'))}</td></tr>`);
              });
            } else {
              htmlParts.push('<tr><td colspan="4">Sin sismos oficiales en el rango.</td></tr>');
            }
            htmlParts.push('</table>');
          }
          if (source === 'company' || source === 'both') {
            htmlParts.push(`<p>Microsismicidad — sensores propios: <strong>${companyCount != null ? escapeHtml(String(companyCount)) : 'Sin snapshot'}</strong> eventos detectados en el rango.</p>`);
          }
        } else if (el.type === 'table' && el.props?.rows) {
          htmlParts.push('<table>');
          el.props.rows.forEach((row: any[], ri: number) => {
            htmlParts.push('<tr>');
            (row || []).forEach((cell) => {
              const tag = ri === 0 && el.props.hasHeader ? 'th' : 'td';
              htmlParts.push(`<${tag}>${escapeHtml(String(cell))}</${tag}>`);
            });
            htmlParts.push('</tr>');
          });
          htmlParts.push('</table>');
        } else if (el.type === 'image' && el.src) {
          htmlParts.push(`<p><img src="${el.src}" width="${el.width || 300}" style="max-width:100%"></p>`);
        } else if (el.type === 'video') {
          // DOCX/PDF no pueden embeber un <video> reproducible -- se deja un
          // marcador explícito en vez de omitir el bloque en silencio (mismo
          // criterio que motivó el fix histórico de 'sensor'/'kpi' faltantes
          // en este export: un bloque que el usuario ve en el editor no debe
          // desaparecer sin aviso al exportar).
          const durationLabel = el.props?.durationSeconds ? ` (${el.props.durationSeconds}s)` : '';
          const sourceLabel = el.props?.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
          htmlParts.push(
            `<div style="border:1px dashed #94a3b8;border-radius:6px;padding:10pt;text-align:center;color:#64748b;font-size:10pt">` +
              `[Video adjunto${durationLabel} — ${escapeHtml(sourceLabel)} — no reproducible en este formato de exportación]` +
            `</div>`,
          );
        } else if (el.type === 'sensor_multi_chart') {
          // A diferencia de kpi/sensor, este bloque no tiene snapshot
          // congelado en el.props: consulta un rango histórico FIJO en vivo
          // (ver SensorMultiChartWidget.tsx), así que los valores reales solo
          // existen en el estado de React del navegador que está exportando
          // — este fallback client-side solo tiene el JSON del documento, sin
          // React ni red, así que no hay forma de reproducir el gráfico acá.
          // Se deja un resumen honesto de la configuración en vez de omitir
          // el bloque en silencio (mismo criterio que 'video' arriba). El PDF
          // y la vista de solo lectura sí muestran el gráfico real (ver
          // ReadOnlyViewer.tsx).
          const chartTypeLabels: Record<string, string> = {
            line: 'Líneas', bar: 'Columnas', barh: 'Barras', combo: 'Combinado', area: 'Áreas', scatter: 'Dispersión (XY)', step: 'Escalón',
            radar: 'Radial', pie: 'Circular', donut: 'Anillo', heatmap: 'Mapa de calor', boxplot: 'Cajas y bigotes',
            candlestick: 'Cotizaciones', treemap: 'Rectángulos', sunburst: 'Proyección solar', histogram: 'Histograma',
            waterfall: 'Cascada', funnel: 'Embudo', geomap: 'Mapa', surface: 'Superficie (3D)',
          };
          const selections: any[] = Array.isArray(el.props?.selections) ? el.props.selections : [];
          const sensorNames = selections.map((s) => s.name || s.code).filter(Boolean).join(', ') || 'sin sensores configurados';
          const typesArr: string[] = Array.isArray(el.props?.chartTypes) && el.props.chartTypes.length
            ? el.props.chartTypes
            : [el.props?.chartType].filter(Boolean);
          const chartTypeLabel = typesArr.map((t) => chartTypeLabels[t] || t).join(', ') || '—';
          const fromLabel = el.props?.from ? new Date(el.props.from).toLocaleString('es-PE') : '—';
          const toLabel = el.props?.to ? new Date(el.props.to).toLocaleString('es-PE') : '—';
          htmlParts.push(
            `<div style="border:1px dashed #94a3b8;border-radius:6px;padding:10pt;color:#334155;font-size:10pt">` +
              `<strong>${escapeHtml(el.props?.title || 'Gráfico de sensores')}</strong><br>` +
              `Tipo de gráfico: ${escapeHtml(chartTypeLabel)} · Sensores (${selections.length}): ${escapeHtml(sensorNames)}<br>` +
              `Rango: ${escapeHtml(fromLabel)} — ${escapeHtml(toLabel)}<br>` +
              `<em>[El gráfico con los datos reales se muestra en el editor y en la exportación a PDF — esta exportación a Word solo incluye un resumen de la configuración]</em>` +
            `</div>`,
          );
        } else if (el.type === 'header') {
          // ADR-046 (revisado): empresa/unidad/usuario ya no viven en props —
          // se calculan en vivo desde la sesión activa, igual que en
          // PageCanvas.tsx, para que el export nunca pueda desalinearse del
          // encabezado mostrado en el editor. Bloque fijo, no editable.
          const session = getSession();
          const chromeParts = [session?.company, resolveMiningUnitName(session), session?.fullName || session?.username]
            .filter((v): v is string => Boolean(v && v.trim()));
          const chromeLabel = (chromeParts.length > 0 ? chromeParts.join('  •  ') : 'Empresa Minera').toUpperCase();
          const logoImg = el.props?.showLogo !== false && (el.props?.tenantId || session?.tenantId)
            ? `<img src="/api/v1/tenants/${encodeURIComponent(el.props?.tenantId || session?.tenantId)}/logo.svg" style="height:40px;max-width:140px" alt="Logotipo">`
            : '';
          htmlParts.push(
            `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:6pt;margin-bottom:12pt">`
            + `<span style="font-family:Arial Black,Arial,sans-serif;font-size:9pt;font-weight:900;letter-spacing:0.4pt;color:#595959">${escapeHtml(chromeLabel)}</span>`
            + `${logoImg}</div>`
          );
        } else if (el.type === 'footer') {
          // "BEEMETRY" + paginación son literales fijos (ver PageCanvas.tsx) — no editables.
          const pageLabel = `PÁGINA ${idx + 1} / ${(doc.pages || []).length}`;
          htmlParts.push(
            `<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #cbd5e1;padding-top:4pt;margin-top:12pt;font-family:Arial Black,Arial,sans-serif;font-size:9pt;font-weight:900;letter-spacing:0.4pt;color:#595959">`
            + `<span>BEEMETRY</span>`
            + (el.props?.showPageNumber !== false ? `<span>${escapeHtml(pageLabel)}</span>` : '')
            + `</div>`
          );
        }
      });
    });

    htmlParts.push('</body></html>');

    const blob = new Blob([htmlParts.join('')], { type: 'application/msword' });
    downloadBlob(blob, generateFilename(doc, 'doc'), 'application/msword');
    return { success: true, method: 'client-fallback' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function escapeHtml(text: unknown): string {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateFilename(doc: any, ext: string): string {
  const title = (doc.meta?.title || 'Informe_Minero').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_-]/g, '_').slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `${title}_${date}.${ext}`;
}

function downloadBlob(blob: Blob, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.type = mimeType;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export { generateFilename, downloadBlob };
