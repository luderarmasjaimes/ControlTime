/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT ENGINE — PDF / DOCX / PPTX / PNG (server-side + client fallback)
   Etapa 1: Motor de exportación de alta fidelidad para informes mineros
   ───────────────────────────────────────────────────────────────────────── */

const API_BASE = '/api';

/**
 * Exporta el documento como PDF de alta fidelidad vía servidor.
 * Fallback: window.print() si el servidor no responde.
 */
export async function exportPDF(doc, options = {}) {
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
      author: options.author || 'AURIXA Platform',
      subject: 'Informe Técnico de Operación Minera',
      keywords: 'minería, informe, técnico, operación',
      creator: 'AURIXA Mining Platform v2.0',
      producer: 'AURIXA Export Engine',
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
    console.warn('[EXPORT] Server PDF failed, falling back to print:', err);
    window.print();
    return { success: true, method: 'print-fallback' };
  }
}

/**
 * Exporta como DOCX (OpenXML) vía servidor.
 */
export async function exportDOCX(doc, options = {}) {
  const payload = {
    document: doc,
    format: 'docx',
    template: options.template || 'default',
    includeStyles: true,
    preserveLayout: true,
    author: options.author || 'AURIXA Platform',
  };

  try {
    const response = await fetch(`${API_BASE}/export/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const blob = await response.blob();
    downloadBlob(blob, generateFilename(doc, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return { success: true, method: 'server' };
  } catch (err) {
    console.warn('[EXPORT] DOCX server export failed:', err);
    // Client-side fallback: generate basic HTML-based DOCX
    return exportDOCXClientFallback(doc, options);
  }
}

/**
 * Exporta como PPTX vía servidor.
 */
export async function exportPPTX(doc, options = {}) {
  const payload = {
    document: doc,
    format: 'pptx',
    theme: options.theme || 'mining-corporate',
    author: options.author || 'AURIXA Platform',
  };

  try {
    const response = await fetch(`${API_BASE}/export/pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const blob = await response.blob();
    downloadBlob(blob, generateFilename(doc, 'pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    return { success: true, method: 'server' };
  } catch (err) {
    console.warn('[EXPORT] PPTX server export failed:', err);
    return { success: false, error: err.message };
  }
}

/** Client-side DOCX fallback using HTML conversion */
function exportDOCXClientFallback(doc, options = {}) {
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

    (doc.pages || []).forEach((page, idx) => {
      if (idx > 0) htmlParts.push('<br clear="all" style="page-break-before:always">');
      (page.elements || []).forEach((el) => {
        if (el.type === 'text') {
          const text = el.props?.text || '';
          const style = el.headingStyle || '';
          if (style === 'h1' || style === 'title') htmlParts.push(`<h1>${escapeHtml(text)}</h1>`);
          else if (style === 'h2') htmlParts.push(`<h2>${escapeHtml(text)}</h2>`);
          else if (style === 'h3') htmlParts.push(`<h3>${escapeHtml(text)}</h3>`);
          else htmlParts.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
        } else if (el.type === 'kpi') {
          htmlParts.push(`<div class="kpi"><div class="kpi-value">${escapeHtml(el.props?.value || '—')}</div><div>${escapeHtml(el.props?.title || '')}</div></div>`);
        } else if (el.type === 'table' && el.props?.rows) {
          htmlParts.push('<table>');
          el.props.rows.forEach((row, ri) => {
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
        }
      });
    });

    htmlParts.push('</body></html>');

    const blob = new Blob([htmlParts.join('')], { type: 'application/msword' });
    downloadBlob(blob, generateFilename(doc, 'doc'), 'application/msword');
    return { success: true, method: 'client-fallback' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateFilename(doc, ext) {
  const title = (doc.meta?.title || 'Informe_Minero').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_-]/g, '_').slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `${title}_${date}.${ext}`;
}

function downloadBlob(blob, filename, mimeType) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.type = mimeType;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export { generateFilename, downloadBlob };
