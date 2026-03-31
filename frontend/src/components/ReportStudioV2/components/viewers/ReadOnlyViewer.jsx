import React from 'react';
import { X, Download, Eye } from 'lucide-react';

/**
 * ReadOnlyViewer — muestra el contenido de un informe en modo solo lectura.
 * Renderiza las páginas usando el mismo HTML que MultipageView pero deshabilitando
 * toda interacción (pointer-events: none en el contenido).
 */
export default function ReadOnlyViewer({ report, onClose }) {
  if (!report) return null;

  const doc = (() => {
    try {
      const cj = report.contentJson;
      if (!cj) return null;
      return typeof cj === 'string' ? JSON.parse(cj) : cj;
    } catch {
      return null;
    }
  })();

  const handleExportPdf = () => window.print();

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
                      <ReadOnlyElement element={el} />
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
    return (
      <div style={{
        width: '100%', height: '100%',
        background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: 12,
      }}>
        {props.src ? (
          <img src={props.src} alt={props.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span>Imagen</span>
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
