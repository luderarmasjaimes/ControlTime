import React, { memo, useEffect, useRef, useState } from 'react';
import { useEditorStore, resolvePagePaperSetup, type ReportPage } from '../../store/useEditorStore';
import PageCanvas from './PageCanvas';

/** Control de "Tamaño de página" independiente por hoja — pedido explícito:
 * poder poner, por ejemplo, un plano en A3 horizontal dentro de un informe
 * A4 vertical, eligiendo si el cambio afecta solo esta hoja o esta y las
 * siguientes (equivalente a una "sección con salto de página" de Word). */
function PagePaperSetupControl({ page }: { page: ReportPage }) {
  const docPaperSize = useEditorStore((s) => s.doc.meta?.paperSize);
  const docOrientation = useEditorStore((s) => s.doc.meta?.orientation);
  const setPagePaperSetup = useEditorStore((s) => s.setPagePaperSetup);
  const [open, setOpen] = useState(false);
  const [draftSize, setDraftSize] = useState<'A4' | 'A3'>('A4');
  const [draftOrientation, setDraftOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [draftScope, setDraftScope] = useState<'only' | 'following'>('only');

  const effective = resolvePagePaperSetup(
    { paperSize: page.paperSize, orientation: page.orientation },
    { paperSize: docPaperSize, orientation: docOrientation },
  );
  const hasOwnSetup = Boolean(page.paperSize || page.orientation);

  const openPopover = () => {
    setDraftSize(effective.paperSize);
    setDraftOrientation(effective.orientation);
    setDraftScope('only');
    setOpen(true);
  };

  return (
    <div className="page-setup-control">
      <button
        type="button"
        className={`page-setup-chip${hasOwnSetup ? ' page-setup-chip--custom' : ''}`}
        title={hasOwnSetup ? 'Esta página tiene un tamaño propio — clic para cambiarlo' : 'Tamaño de esta página (heredado del documento) — clic para cambiar'}
        onClick={openPopover}
      >
        Pág. {page.page_number} · {effective.paperSize} · {effective.orientation === 'landscape' ? 'Horizontal' : 'Vertical'}
      </button>
      {open && (
        <div className="page-setup-popover" onMouseLeave={() => setOpen(false)}>
          <span className="page-setup-title">Configurar página {page.page_number}</span>
          <label className="page-setup-field">
            <span>Tamaño</span>
            <select value={draftSize} onChange={(e) => setDraftSize(e.target.value as 'A4' | 'A3')}>
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label className="page-setup-field">
            <span>Orientación</span>
            <select value={draftOrientation} onChange={(e) => setDraftOrientation(e.target.value as 'portrait' | 'landscape')}>
              <option value="portrait">Vertical</option>
              <option value="landscape">Horizontal</option>
            </select>
          </label>
          <div className="page-setup-scope">
            <label>
              <input type="radio" checked={draftScope === 'only'} onChange={() => setDraftScope('only')} />
              Solo esta página
            </label>
            <label>
              <input type="radio" checked={draftScope === 'following'} onChange={() => setDraftScope('following')} />
              Esta página y las siguientes
            </label>
          </div>
          <button
            type="button"
            className="page-setup-apply"
            onClick={() => {
              setPagePaperSetup(page.page_number, { paperSize: draftSize, orientation: draftOrientation }, draftScope);
              setOpen(false);
            }}
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

interface MultipageViewProps {
  zoomPercent?: number;
  onRequestImageReplace?: (pageNumber: number, elementId: string, source?: string) => void;
  onRequestCoverImage?: (pageNumber: number, elementId: string) => void;
  tenantId?: string;
}

/** ¿El foco actual está en un campo editable (texto/input/contentEditable)?
 * Si es así, las teclas de flecha/avance de página deben ir al campo, no
 * a la navegación de páginas del lienzo. */
function isEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function MultipageView({ zoomPercent = 100, onRequestImageReplace, onRequestCoverImage, tenantId }: MultipageViewProps) {
  const pages = useEditorStore((s) => s.doc.pages);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Navegación de página sin depender del mouse sobre la barra de scroll:
   * PageUp/PageDown saltan a la página anterior/siguiente completa;
   * flechas arriba/abajo/izquierda/derecha desplazan el lienzo en pasos
   * pequeños (igual que Word/lectores de PDF). */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const getShells = () => Array.from(container.querySelectorAll<HTMLElement>('.multipage-page-shell'));

    const scrollToAdjacentPage = (direction: 1 | -1) => {
      const shells = getShells();
      if (shells.length === 0) return;
      const containerTop = container.scrollTop;
      const epsilon = 4;
      let targetIndex = 0;
      if (direction === 1) {
        targetIndex = shells.findIndex((shell) => shell.offsetTop > containerTop + epsilon);
        if (targetIndex === -1) targetIndex = shells.length - 1;
      } else {
        targetIndex = shells.length - 1;
        for (let i = shells.length - 1; i >= 0; i -= 1) {
          if (shells[i].offsetTop < containerTop - epsilon) {
            targetIndex = i;
            break;
          }
          if (i === 0) targetIndex = 0;
        }
      }
      shells[targetIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableFocus()) return;
      const stepPx = 90;
      switch (event.key) {
        case 'PageDown':
          event.preventDefault();
          scrollToAdjacentPage(1);
          break;
        case 'PageUp':
          event.preventDefault();
          scrollToAdjacentPage(-1);
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault();
          container.scrollBy({ top: stepPx, behavior: 'smooth' });
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault();
          container.scrollBy({ top: -stepPx, behavior: 'smooth' });
          break;
        case 'Home':
          event.preventDefault();
          container.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'End':
          event.preventDefault();
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <section className={`multipage-engine multipage-engine--${layoutMode}`}>
      <div className="page-scroll" ref={scrollRef} tabIndex={-1}>
        {pages.map((page) => (
          <div key={page.page_number} className="multipage-page-shell">
            {layoutMode !== 'presentation' && <PagePaperSetupControl page={page} />}
            <PageCanvas
              page={page}
              totalPages={pages.length}
              viewportScale={Math.min(4, Math.max(0.1, (Number(zoomPercent) || 100) / 100))}
              onRequestImageReplace={onRequestImageReplace}
              onRequestCoverImage={onRequestCoverImage}
              tenantId={tenantId}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default memo(MultipageView);
