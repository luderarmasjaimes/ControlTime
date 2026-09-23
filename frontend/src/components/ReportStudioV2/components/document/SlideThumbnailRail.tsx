import React, { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useEditorStore, type ReportElement, type ReportPage } from '../../store/useEditorStore';

// Mismas dimensiones fijas de una diapositiva (1280x720, 16:9) que
// getReportLayoutMetrics('presentation') — no hace falta importarlas, la
// miniatura es solo un boceto proporcional, nunca un render real.
const SLIDE_W = 1280;
const SLIDE_H = 720;

function thumbBlockClass(element: ReportElement): string {
  switch (element.type) {
    case 'shape': return 'slide-thumb-block slide-thumb-block--shape';
    case 'image': return 'slide-thumb-block slide-thumb-block--image';
    case 'video': return 'slide-thumb-block slide-thumb-block--video';
    case 'table': return 'slide-thumb-block slide-thumb-block--table';
    case 'chart': return 'slide-thumb-block slide-thumb-block--chart';
    case 'kpi': return 'slide-thumb-block slide-thumb-block--kpi';
    case 'cover': return 'slide-thumb-block slide-thumb-block--cover';
    case 'text': return 'slide-thumb-block slide-thumb-block--text';
    default: return 'slide-thumb-block slide-thumb-block--generic';
  }
}

/** Boceto en miniatura del contenido de una diapositiva -- deliberadamente
 * NO es un render pixel-perfect: eso exigiría montar un <PageCanvas> (Stage
 * de Konva completo) por cada miniatura, justo lo que la virtualización del
 * editor evita (ver MultipageView.tsx, medido en vivo: 144 páginas = 144
 * Stages, ~350MB de heap). En vez de eso, cada bloque se dibuja como un
 * rectángulo posicionado/coloreado según su tipo, a partir de x/y/width/
 * height reales -- suficiente para reconocer de un vistazo qué diapositiva
 * es cuál (la de la foto, la de la tabla, la de cierre...), como cualquier
 * "slide sorter" de PowerPoint/Google Slides visto en miniatura. */
function SlideThumbnailSketch({ page }: { page: ReportPage }) {
  const visible = page.elements
    .filter((el) => el.type !== 'header' && el.type !== 'footer')
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  return (
    <div className="slide-thumb-sketch">
      {visible.map((el) => {
        const props: Record<string, unknown> = el.props || {};
        const style: React.CSSProperties = {
          left: `${(el.x / SLIDE_W) * 100}%`,
          top: `${(el.y / SLIDE_H) * 100}%`,
          width: `${(el.width / SLIDE_W) * 100}%`,
          height: `${(el.height / SLIDE_H) * 100}%`,
        };
        if (el.type === 'shape' || el.type === 'cover') {
          style.background = (props.fill as string) || (props.backgroundColor as string) || '#94a3b8';
        }
        return <div key={el.id} className={thumbBlockClass(el)} style={style} />;
      })}
    </div>
  );
}

/**
 * Panel de miniaturas de diapositivas (pedido explícito 2026-09-08) --
 * columna fija (posición y alto fijos, scroll propio en Y) en el espacio
 * entre la biblioteca de contenidos y el lienzo, SOLO en modo presentación
 * (doc.meta.layoutMode === 'presentation'). Tres funciones pedidas:
 *  1. Clic en una miniatura -> selecciona esa diapositiva y desplaza el
 *     lienzo principal hasta ella (mismo mecanismo de scroll que ya usa
 *     MultipageView.tsx: `.multipage-page-shell[data-page-number]` +
 *     scrollIntoView -- sin duplicar esa lógica).
 *  2. La diapositiva ACTUAL (selectedPage) queda marcada con borde azul.
 *  3. Arrastrar una miniatura sobre otra reordena las diapositivas --
 *     reutiliza `reorderPages`, que YA existía en el store (con el
 *     renumerado correcto) pero no estaba cableado a ninguna UI todavía;
 *     se le corrigió de paso que remapeara comentarios/selectedPage tras
 *     el reordenamiento (antes solo insertPageAt/removePage lo hacían).
 */
interface SlideThumbnailRailProps {
  /** true mientras el panel derecho de Propiedades está desplegado (pedido
   * explícito 2026-09-08) -- se achica a 0 igual que ya hace solo con CSS
   * cuando se expande la biblioteca izquierda (selector de hermano
   * adyacente), pero acá hace falta como prop porque RightInspector NO es
   * el hermano inmediato de este componente en el DOM (queda <main> en
   * medio) -- ver App.tsx::rightInspectorExpanded. */
  collapsed?: boolean;
}

function SlideThumbnailRail({ collapsed = false }: SlideThumbnailRailProps) {
  const layoutMode = useEditorStore((s) => (s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document'));
  const pages = useEditorStore((s) => s.doc.pages);
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const selectPage = useEditorStore((s) => s.selectPage);
  const reorderPages = useEditorStore((s) => s.reorderPages);

  const [dragPageNumber, setDragPageNumber] = useState<number | null>(null);
  const [dragOverPageNumber, setDragOverPageNumber] = useState<number | null>(null);

  if (layoutMode !== 'presentation') {
    return null;
  }

  const goToPage = (pageNumber: number) => {
    selectPage(pageNumber);
    document
      .querySelector<HTMLElement>(`.multipage-page-shell[data-page-number="${pageNumber}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <aside
      className={`panel panel--slides${collapsed ? ' panel--slides-collapsed' : ''}`}
      aria-label="Diapositivas del documento"
    >
      <div className="panel-title-row">
        <h3 className="panel-title" title="Vista general de diapositivas — clic para ir a una, arrastre para reordenar">
          <LayoutGrid size={16} color="var(--accent)" aria-hidden />
          <span style={{ color: 'white' }}>Diapositivas</span>
        </h3>
      </div>
      <div className="slide-thumb-scroll">
        {pages.map((page) => {
          const isActive = page.page_number === selectedPage;
          const isDragOver = dragOverPageNumber === page.page_number && dragPageNumber !== page.page_number;
          return (
            <div
              key={page.page_number}
              className={`slide-thumb-card${isActive ? ' slide-thumb-card--active' : ''}${isDragOver ? ' slide-thumb-card--dragover' : ''}`}
              draggable
              onClick={() => goToPage(page.page_number)}
              title={`Diapositiva ${page.page_number}`}
              onDragStart={(event) => {
                setDragPageNumber(page.page_number);
                event.dataTransfer.effectAllowed = 'move';
                // Firefox exige datos reales en dataTransfer para permitir
                // el arrastre -- el valor en sí no se usa (se lee del
                // estado `dragPageNumber`), solo habilita el gesto.
                event.dataTransfer.setData('text/plain', String(page.page_number));
              }}
              onDragOver={(event) => {
                if (dragPageNumber == null || dragPageNumber === page.page_number) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverPageNumber(page.page_number);
              }}
              onDragLeave={() => {
                setDragOverPageNumber((prev) => (prev === page.page_number ? null : prev));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragPageNumber != null && dragPageNumber !== page.page_number) {
                  reorderPages(dragPageNumber, page.page_number);
                }
                setDragPageNumber(null);
                setDragOverPageNumber(null);
              }}
              onDragEnd={() => {
                setDragPageNumber(null);
                setDragOverPageNumber(null);
              }}
            >
              <div className="slide-thumb-frame">
                <SlideThumbnailSketch page={page} />
              </div>
              <span className="slide-thumb-number">{page.page_number}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default SlideThumbnailRail;
