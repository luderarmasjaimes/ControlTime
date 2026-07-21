import React, { memo, useEffect, useState } from 'react';
import { X, Download, Eye } from 'lucide-react';
import { resolveReportImageSrc } from '../../lib/reportImageSrc';
import { getSession } from '../../../../auth/authStorage';
import { getTenantLogoDataUrl } from '../../lib/tenantLogo';
import { resolveMiningUnitName } from '../../lib/sessionChrome';
import { generateTocData, type TocItem } from '../document/TableOfContents';

/** Misma tipografía/color "impactante" de plataforma que PageCanvas.tsx —
 * encabezado y pie de página deben verse idénticos en editor y solo-lectura. */
const PLATFORM_CHROME_FONT = "'Arial Black', 'Arial Bold', Arial, sans-serif";
const PLATFORM_CHROME_FONT_SIZE = 9;
const PLATFORM_CHROME_COLOR = '#595959';

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
  onClose: (() => void) | null;
}

/**
 * ReadOnlyViewer — muestra el contenido de un informe en modo solo lectura.
 * Renderiza las páginas usando el mismo HTML que MultipageView pero deshabilitando
 * toda interacción (pointer-events: none en el contenido).
 */
function ReadOnlyViewer({ report, onClose }: ReadOnlyViewerProps) {
  if (!report) return null;

  const doc = (() => {
    try {
      // El backend devuelve content_json (snake_case); algunos flujos internos
      // usan contentJson (camelCase, ya combinado en frontend). Aceptar ambos.
      const cj = report.content_json ?? report.contentJson;
      if (!cj) return null;
      return typeof cj === 'string' ? JSON.parse(cj) : cj;
    } catch {
      return null;
    }
  })();

  const handleExportPdf = () => window.print();

  // Misma fuente de verdad que el editor (PageCanvas.tsx) — antes esta vista
  // usaba una heurística propia y desactualizada (primera línea de CADA
  // bloque de texto, sin filtrar por estilo de encabezado ni numerar), por
  // lo que el índice del PDF/solo-lectura no coincidía con el del editor.
  const tocEntries: TocItem[] = generateTocData(doc);

  return (
    <div className="ro-overlay">
      {/* ── Barra superior readonly ── */}
      <div className="ro-toolbar">
        <div className="ro-toolbar-left">
          <Eye size={16} style={{ color: '#a5b4fc' }} />
          <span className="ro-badge">MODO LECTURA — SOLO VISUALIZACIÓN</span>
          <span className="ro-title">{report.title}</span>
        </div>
        <div className="ro-toolbar-right">
          <button className="ro-btn" onClick={handleExportPdf} title="Exportar a PDF">
            <Download size={15} /> Exportar PDF
          </button>
          {onClose && (
            <button className="ro-btn ro-btn-close" onClick={onClose} title="Cerrar">
              <X size={15} /> Cerrar
            </button>
          )}
        </div>
      </div>

      {/* ── Contenido del informe ── */}
      <div className="ro-content">
        {!doc ? (
          <div className="ro-no-content">
            <Eye size={40} style={{ opacity: 0.2 }} />
            <p>Este informe no tiene contenido visual disponible.</p>
          </div>
        ) : (
          <div className="ro-pages" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {doc.pages && doc.pages.map((page: any) => (
              <div key={page.page_number} className="ro-page-wrapper">
                <div className="ro-page-label">Página {page.page_number} de {doc.pages.length}</div>
                <div className="ro-page-canvas">
                  {/* Renderizar cada elemento como lectura estática */}
                  {page.elements && page.elements.map((el: any) => (
                    <div
                      key={el.id}
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.width,
                        height: el.height,
                        zIndex: el.zIndex || 1,
                        overflow: 'hidden',
                      }}
                    >
                      <ReadOnlyElement
                        element={el.type === 'toc' ? { ...el, _tocEntries: tocEntries } : el}
                        pageNumber={page.page_number}
                        totalPages={doc.pages.length}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
    </div>
  );
}

/** Renderiza un solo elemento de página en modo lectura estática */
function ReadOnlyElement({ element, pageNumber, totalPages }: { element: any; pageNumber?: number; totalPages?: number }) {
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
    const lines = String(props.text || '').split('\n');
    return (
      <div style={{
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
      }}>
        {lines.map((line: string, i: number) => <div key={i}>{line || ' '}</div>)}
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

  if (element.type === 'table') {
    const rows: any[][] = props.rows || [];
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: (props.fontSize || 13) + 'px' }}>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri === 0 && props.hasHeader ? (props.headerBg || '#f8fafc') : 'white' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{
                    border: `1px solid ${props.borderColor || '#e2e8f0'}`,
                    padding: (props.cellPadding || 8) + 'px',
                    fontWeight: ri === 0 && props.hasHeader ? 700 : 400,
                  }}>{cell}</td>
                ))}
              </tr>
            ))}
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
        controls
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
          {props.title || 'Tabla de Contenidos'}
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

  // chart y otros: placeholder
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
