import React, { useMemo } from 'react';
import { BookOpen, RefreshCw, ChevronRight } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   TOC — Tabla de Contenidos Automática
   Escanea headings del documento → genera bloque TOC con enlaces internos
   y numeración jerárquica (1, 1.1, 1.1.1).
   ───────────────────────────────────────────────────────────────────────── */

/** Extrae headings de todas las páginas del documento */
function extractHeadings(doc) {
  const headings = [];
  if (!doc?.pages) return headings;

  doc.pages.forEach((page, pageIdx) => {
    if (!page.elements) return;
    page.elements.forEach((el) => {
      if (el.type !== 'text') return;
      const text = (el.content || el.text || '').trim();
      if (!text) return;

      const style = el.headingStyle || el.style;
      if (!style || style === 'normal' || style === 'quote') return;

      let level = 0;
      if (style === 'title' || style === 'h1') level = 1;
      else if (style === 'h2') level = 2;
      else if (style === 'h3') level = 3;
      else return;

      headings.push({
        id: el.id,
        text,
        level,
        pageNumber: pageIdx + 1,
        style,
      });
    });
  });

  return headings;
}

/** Genera numeración jerárquica (1, 1.1, 1.1.1) */
function numberHeadings(headings) {
  const counters = [0, 0, 0];
  return headings.map((h) => {
    if (h.level === 1) {
      counters[0]++;
      counters[1] = 0;
      counters[2] = 0;
      return { ...h, number: `${counters[0]}` };
    }
    if (h.level === 2) {
      counters[1]++;
      counters[2] = 0;
      return { ...h, number: `${counters[0]}.${counters[1]}` };
    }
    counters[2]++;
    return { ...h, number: `${counters[0]}.${counters[1]}.${counters[2]}` };
  });
}

export function generateTocData(doc) {
  const headings = extractHeadings(doc);
  return numberHeadings(headings);
}

export default function TableOfContents({ doc, onScrollToElement, onRefresh }) {
  const tocItems = useMemo(() => generateTocData(doc), [doc]);

  if (tocItems.length === 0) {
    return (
      <div className="toc-empty">
        <BookOpen size={24} className="toc-empty-icon" />
        <p>Sin encabezados detectados.</p>
        <p className="toc-empty-hint">
          Aplique estilos Título, H1, H2 o H3 a bloques de texto para generar la tabla de contenidos automáticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="toc-container">
      <div className="toc-header">
        <BookOpen size={16} />
        <span className="toc-title">Tabla de Contenidos</span>
        <span className="toc-count">{tocItems.length} secciones</span>
        {onRefresh && (
          <button type="button" className="toc-refresh-btn" onClick={onRefresh} title="Actualizar TOC">
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      <div className="toc-body">
        {tocItems.map((item, idx) => (
          <button
            key={`${item.id}-${idx}`}
            type="button"
            className={`toc-entry toc-entry--level-${item.level}`}
            onClick={() => onScrollToElement?.(item.id, item.pageNumber)}
            title={`Ir a: ${item.text} (página ${item.pageNumber})`}
          >
            <span className="toc-number">{item.number}</span>
            <span className="toc-text">{item.text}</span>
            <span className="toc-dots" />
            <span className="toc-page">{item.pageNumber}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
