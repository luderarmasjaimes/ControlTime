import React, { memo, useMemo } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   TOC — Tabla de Contenidos Automática
   Escanea headings del documento → genera bloque TOC con enlaces internos
   y numeración jerárquica (1, 1.1, 1.1.1).
   ───────────────────────────────────────────────────────────────────────── */

interface TocHeading {
  /** Único por entrada (clave de React) — para encabezados por selección
   * (span) es sintético, distinto del id real del bloque. */
  id: string;
  /** Id del elemento REAL en el lienzo — con este se hace scroll/foco, no
   * con `id` (que puede ser sintético para entradas de tipo span). */
  elementId: string;
  text: string;
  level: number;
  pageNumber: number;
  style: string;
}

export interface TocItem extends TocHeading {
  number: string;
}

function headingLevelFor(style: string | undefined | null): number {
  if (!style || style === 'normal' || style === 'quote') return 0;
  if (style === 'title' || style === 'h1') return 1;
  if (style === 'h2') return 2;
  if (style === 'h3') return 3;
  if (style === 'h4') return 4;
  if (style === 'h5') return 5;
  if (style === 'h6') return 6;
  return 0;
}

/**
 * Extrae headings de todas las páginas del documento.
 * ADR-011 (revisado): antes leía `el.content`/`el.text`/`el.headingStyle` —
 * campos que nunca existieron en el esquema real de `useEditorStore.ts`
 * (el texto vive en `el.props.text`; `headingStyle` no se escribía en
 * ningún lado, ver `RibbonToolbar`/`onApplyHeadingStyle` en App.tsx, ahora
 * corregido para tageear el elemento al aplicar Título/H1/H2/H3). Esta
 * función estaba efectivamente muerta contra datos reales hasta este fix.
 *
 * Actualización: además del encabezado de TODO el bloque (`props.
 * headingStyle`), ahora también se puede marcar como encabezado solo una
 * PORCIÓN de texto dentro de un bloque (barra de formato flotante,
 * PageCanvas.tsx → `applyHeadingStyleToSelection`, guardado como
 * `span.headingStyle` en `props.spans`, ver lib/textSpans.ts). Un bloque
 * puede aportar CERO, UNO (todo el bloque) o VARIOS (una por cada span
 * marcado) encabezados al índice — en ese último caso el bloque entero NO
 * se cuenta aparte, solo sus spans, para no duplicar el mismo texto.
 */
function extractHeadings(doc: any): TocHeading[] {
  const headings: TocHeading[] = [];
  if (!doc?.pages) return headings;

  doc.pages.forEach((page: any, pageIdx: number) => {
    if (!page.elements) return;
    page.elements.forEach((el: any) => {
      if (el.type !== 'text') return;
      const text = String(el.props?.text ?? '');
      if (!text.trim()) return;

      const spans: any[] = Array.isArray(el.props?.spans) ? el.props.spans : [];
      const headingSpans = spans
        .filter((s) => s && headingLevelFor(s.headingStyle) > 0)
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

      if (headingSpans.length > 0) {
        headingSpans.forEach((span, spanIdx) => {
          const spanText = text.slice(span.start, span.end).trim();
          if (!spanText) return;
          headings.push({
            id: `${el.id}__span-${spanIdx}-${span.start}`,
            elementId: el.id,
            text: spanText,
            level: headingLevelFor(span.headingStyle),
            pageNumber: pageIdx + 1,
            style: span.headingStyle,
          });
        });
        return;
      }

      // Sin spans marcados: cae al comportamiento histórico, encabezado de
      // TODO el bloque vía props.headingStyle (ribbon).
      const level = headingLevelFor(el.props?.headingStyle);
      if (level === 0) return;

      headings.push({
        id: el.id,
        elementId: el.id,
        text: text.trim(),
        level,
        pageNumber: pageIdx + 1,
        style: el.props.headingStyle,
      });
    });
  });

  return headings;
}

/** Genera numeración jerárquica (1, 1.1, 1.1.1, 1.1.1.1, …) para hasta 6
 * niveles (H1-H6) — antes solo soportaba 3 (Título/H1/H2/H3), los niveles
 * 4-6 se descartaban silenciosamente en extractHeadings(). */
function numberHeadings(headings: TocHeading[]): TocItem[] {
  const counters = [0, 0, 0, 0, 0, 0];
  return headings.map((h) => {
    const idx = h.level - 1;
    counters[idx]++;
    // Cualquier nivel más profundo que el que acaba de incrementar reinicia
    // su contador — ej. al pasar de 1.2.3 a un nuevo H2, el resultado debe
    // ser 1.3 (no 1.3.3, arrastrando el contador viejo de H3).
    for (let i = idx + 1; i < counters.length; i += 1) counters[i] = 0;
    const number = counters.slice(0, h.level).join('.');
    return { ...h, number };
  });
}

export function generateTocData(doc: any): TocItem[] {
  const headings = extractHeadings(doc);
  return numberHeadings(headings);
}

/**
 * Resuelve una referencia cruzada (ADR-019) al número de sección vigente de
 * su target — misma fuente de verdad que la TOC (`generateTocData`), así
 * que insertar/mover una sección re-numera y re-resuelve la referencia
 * automáticamente en el siguiente render, sin ningún paso manual. Devuelve
 * `undefined` si el `targetId` ya no existe (encabezado borrado) — el
 * llamador (`buildStyledSegments`) decide cómo mostrar ese caso.
 */
export function resolveHeadingRefLabel(doc: any, targetId: string): string | undefined {
  return generateTocData(doc).find((item) => item.id === targetId)?.number;
}

interface TableOfContentsProps {
  doc: any;
  onScrollToElement?: (id: string, pageNumber: number) => void;
  onRefresh?: () => void;
}

function TableOfContents({ doc, onScrollToElement, onRefresh }: TableOfContentsProps) {
  const tocItems = useMemo(() => generateTocData(doc), [doc]);

  if (tocItems.length === 0) {
    return (
      <div className="toc-empty">
        <BookOpen size={24} className="toc-empty-icon" />
        <p>Sin encabezados detectados.</p>
        <p className="toc-empty-hint">
          Aplique estilos Título, Heading 1-6 a bloques de texto para generar la tabla de contenidos automáticamente.
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
            onClick={() => onScrollToElement?.(item.elementId, item.pageNumber)}
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

export default memo(TableOfContents);
