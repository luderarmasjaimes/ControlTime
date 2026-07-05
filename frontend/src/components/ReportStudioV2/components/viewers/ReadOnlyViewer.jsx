import React from 'react';
import { X, Download, Eye } from 'lucide-react';
import { resolveReportImageSrc } from '../../lib/reportImageSrc';

/**
 * ReadOnlyViewer — muestra el contenido de un informe en modo solo lectura.
 * Renderiza las páginas usando el mismo HTML que MultipageView pero deshabilitando
 * toda interacción (pointer-events: none en el contenido).
 */
export default function ReadOnlyViewer({ report, onClose }) {
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

  // Entradas del índice: primera línea de cada bloque de texto, con su página.
  const tocEntries = [];
  if (doc?.pages) {
    doc.pages.forEach((pg) => {
      (pg.elements || []).forEach((el) => {
        if (el.type === 'text' && el.props?.text) {
          const first = String(el.props.text).split('\n')[0].trim();
          if (first) tocEntries.push({ label: first.slice(0, 64), page: pg.page_number });
        }
      });
    });
  }

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
          <button className="ro-btn ro-btn-close" onClick={onClose} title="Cerrar">
            <X size={15} /> Cerrar
          </button>
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
            {doc.pages && doc.pages.map((page) => (
              <div key={page.page_number} className="ro-page-wrapper">
                <div className="ro-page-label">Página {page.page_number} de {doc.pages.length}</div>
                <div className="ro-page-canvas">
                  {/* Renderizar cada elemento como lectura estática */}
                  {page.elements && page.elements.map((el) => (
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
                      <ReadOnlyElement element={el.type === 'toc' ? { ...el, _tocEntries: tocEntries } : el} />
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
function ReadOnlyElement({ element }) {
  const props = element.props || {};

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
        {lines.map((line, i) => <div key={i}>{line || '\u00A0'}</div>)}
      </div>
    );
  }

  if (element.type === 'kpi') {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)',
        borderRadius: 10, border: '1px solid #c7d2fe',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 10, gap: 4,
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#6366f1' }}>{props.value || '—'}</div>
        <div style={{ fontSize: 11, color: '#4338ca', fontWeight: 600 }}>{props.title || 'KPI'}</div>
      </div>
    );
  }

  if (element.type === 'table') {
    const rows = props.rows || [];
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

  if (element.type === 'cover') {
    return (
      <div style={{
        width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: '1px solid #e2e8f0', borderRadius: 6, background: 'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)',
        boxSizing: 'border-box',
      }}>
        <div style={{ background: '#0f172a', color: '#fbbf24', fontSize: 11, fontWeight: 700, letterSpacing: 1, textAlign: 'center', padding: '6px 0', textTransform: 'uppercase' }}>
          {props.classification || 'CONFIDENCIAL'}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', margin: '0 0 10px', lineHeight: 1.15 }}>{props.title || 'Informe Técnico'}</h1>
          {props.company && <div style={{ fontSize: 16, fontWeight: 600, color: '#334155' }}>{props.company}</div>}
          {props.unit && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{props.unit}</div>}
        </div>
        <div style={{ borderTop: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: '#475569', justifyContent: 'space-between' }}>
          {props.docCode && <span><b>Código:</b> {props.docCode}</span>}
          {props.author && <span><b>Autor:</b> {props.author}</span>}
          {props.date && <span><b>Fecha:</b> {props.date}</span>}
        </div>
      </div>
    );
  }

  if (element.type === 'toc') {
    const entries = (element._tocEntries || []);
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
            {entries.map((e, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13, color: '#334155', padding: '3px 0' }}>
                <span style={{ fontWeight: 600 }}>{e.label}</span>
                <span style={{ flex: 1, borderBottom: '1px dotted #cbd5e1', margin: '0 2px', transform: 'translateY(-3px)' }} />
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{e.page}</span>
              </li>
            ))}
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
