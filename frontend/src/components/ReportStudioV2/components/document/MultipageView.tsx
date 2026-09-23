import React, { memo, useEffect, useRef, useState } from 'react';
import { useEditorStore, resolvePagePaperSetup, type ReportComment, type ReportPage } from '../../store/useEditorStore';
import PageCanvas from './PageCanvas';
import DragPreviewOverlay from './DragPreviewOverlay';
import { getReportLayoutMetrics } from '../../lib/reportLayoutMetrics';

/**
 * Virtualización del EDITOR: reportado en vivo un lag serio con un informe
 * de 144 páginas (sensores + mapas) -- medido en vivo, sin esto CADA página
 * monta un <PageCanvas> completo (un Stage de Konva con varias capas) sin
 * importar el scroll: 144 páginas = 144 Stages, 585 <canvas> reales, ~350MB
 * de heap, todo montado desde el primer render. Misma técnica que
 * ReadOnlyViewer.tsx (ventana vía IntersectionObserver sobre el contenedor
 * con scroll real), pero acá se desmonta el <PageCanvas> completo -- no
 * hay drag-and-drop de elementos ENTRE páginas en este editor (cada
 * elemento vive en una sola page_number, ver store), así que ninguna
 * operación depende de que el Stage de una página lejana siga montado.
 *
 * Umbral igual al de export/lectura: informes pequeños (la inmensa
 * mayoría) nunca activan esto, cero riesgo de regresión ahí.
 */
const EDITOR_VIRTUALIZATION_PAGE_THRESHOLD = 20;
// Margen generoso (vs. los 1200px del visor de lectura): a diferencia de
// lectura, acá el usuario EDITA -- PageUp/PageDown saltan una página entera
// de un salto, y no queremos que el Stage de Konva tenga que reconstruirse
// (perdiendo su estado interno de selección/transformer) por un scroll
// normal de ida y vuelta cerca del borde de la ventana.
const EDITOR_VIRTUALIZATION_ROOT_MARGIN = '2000px 0px 2000px 0px';

/** Caja del tamaño exacto de una página real (mismas clases CSS que
 * PageCanvas.tsx usa para su `.page-wrapper`/`.page-meta`) para páginas
 * fuera de la ventana de virtualización -- mantiene el alto total del
 * scroll y la posición de las demás páginas estables, sin montar ningún
 * Stage de Konva. */
function PageCanvasPlaceholder({
  page,
  meta,
  scale,
  layoutMode,
  pageNumber,
  totalPages,
}: {
  page: ReportPage;
  meta: ReturnType<typeof useEditorStore.getState>['doc']['meta'];
  scale: number;
  layoutMode: 'document' | 'presentation';
  pageNumber: number;
  totalPages: number;
}) {
  const effective = resolvePagePaperSetup(page, meta);
  const { PAGE_WIDTH, PAGE_HEIGHT } = getReportLayoutMetrics(layoutMode, effective.paperSize, effective.orientation);
  const pageLabel =
    layoutMode === 'presentation'
      ? totalPages > 1
        ? `Diapositiva ${pageNumber} de ${totalPages}`
        : `Diapositiva ${pageNumber}`
      : totalPages > 1
        ? `Página ${pageNumber} de ${totalPages}`
        : `Página ${pageNumber}`;
  return (
    <div className="page-wrapper" style={{ width: PAGE_WIDTH * scale, minWidth: PAGE_WIDTH * scale }}>
      <div className="page-meta">{pageLabel}</div>
      <div style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale, background: '#fff', border: '1px solid #dbe3f1', borderRadius: 2 }} />
    </div>
  );
}

function HorizontalMarginRuler({ page, scale }: { page: ReportPage; scale: number }) {
  const meta = useEditorStore((s) => s.doc.meta);
  const setHorizontalMargins = useEditorStore((s) => s.setHorizontalMargins);
  const effective = resolvePagePaperSetup(page, meta);
  const metrics = getReportLayoutMetrics(
    meta?.layoutMode,
    effective.paperSize,
    effective.orientation,
    meta?.marginLeft,
    meta?.marginRight,
  );
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: MouseEvent) => {
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(6, Math.min(metrics.PAGE_WIDTH - 6, (event.clientX - rect.left - 1) / scale));
      if (dragging === 'left') setHorizontalMargins(x, metrics.MARGIN_RIGHT);
      else setHorizontalMargins(metrics.MARGIN_LEFT, metrics.PAGE_WIDTH - x);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, metrics, scale, setHorizontalMargins]);

  const left = metrics.MARGIN_LEFT * scale;
  const right = (metrics.PAGE_WIDTH - metrics.MARGIN_RIGHT) * scale;
  return (
    <div className="margin-ruler-frame" style={{ width: metrics.PAGE_WIDTH * scale }}>
      <div className="margin-ruler" ref={rulerRef} aria-label="Regla de márgenes horizontales">
        <span className="margin-ruler-tick margin-ruler-tick--start" />
        <span className="margin-ruler-tick margin-ruler-tick--middle" />
        <span className="margin-ruler-tick margin-ruler-tick--end" />
        {(['left', 'right'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`margin-handle margin-handle--${side}`}
            style={{ left: `${side === 'left' ? left : right}px` }}
            aria-label={`Margen ${side === 'left' ? 'izquierdo' : 'derecho'}`}
            onMouseDown={(event) => { event.preventDefault(); setDragging(side); }}
          />
        ))}
      </div>
      {dragging && (
        <div
          className="margin-guide-line"
          style={{ left: `${(dragging === 'left' ? left : right) + 1}px`, height: metrics.PAGE_HEIGHT * scale }}
        />
      )}
    </div>
  );
}

/** Control de "Tamaño de página" independiente por hoja — pedido explícito:
 * poder poner, por ejemplo, un plano en A3 horizontal dentro de un informe
 * A4 vertical, eligiendo si el cambio afecta solo esta hoja o esta y las
 * siguientes (equivalente a una "sección con salto de página" de Word). */
function PagePaperSetupControl({ page, layoutMode }: { page: ReportPage; layoutMode: 'document' | 'presentation' }) {
  const isPresentation = layoutMode === 'presentation';
  const pageCount = useEditorStore((s) => s.doc.pages.length);
  const docPaperSize = useEditorStore((s) => s.doc.meta?.paperSize);
  const docOrientation = useEditorStore((s) => s.doc.meta?.orientation);
  const setPagePaperSetup = useEditorStore((s) => s.setPagePaperSetup);
  const removePage = useEditorStore((s) => s.removePage);
  const insertPageAt = useEditorStore((s) => s.insertPageAt);
  const duplicatePage = useEditorStore((s) => s.duplicatePage);
  const setPagePlainTextMode = useEditorStore((s) => s.setPagePlainTextMode);
  const [open, setOpen] = useState(false);
  const [addPageOpen, setAddPageOpen] = useState(false);
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
    setAddPageOpen(false);
    setOpen(true);
  };

  return (
    <div className="page-setup-control">
      <button
        type="button"
        className={`page-setup-chip${hasOwnSetup ? ' page-setup-chip--custom' : ''} mt-5`}
        style={{color:'black'}}
        title={
          isPresentation
            ? `Diapositiva ${page.page_number} — agregar o eliminar diapositivas`
            : hasOwnSetup ? 'Esta página tiene un tamaño propio — clic para cambiarlo' : 'Tamaño de esta página (heredado del documento) — clic para cambiar'
        }
        onClick={openPopover}
      >
        {isPresentation
          ? `Diapositiva ${page.page_number}`
          : `Pág. ${page.page_number} · ${effective.paperSize} · ${effective.orientation === 'landscape' ? 'Horizontal' : 'Vertical'}`}
      </button>
      {open && (
        <div className="page-setup-popover" onMouseLeave={() => setOpen(false)}>
          <span className="page-setup-title">
            {isPresentation ? `Diapositiva ${page.page_number}` : `Configurar página ${page.page_number}`}
          </span>
          {/* El tamaño/orientación (A3/A4, vertical/horizontal) no aplica a
              una diapositiva -- formato 16:9 fijo, ver getReportLayoutMetrics.
              Pedido explícito 2026-09-04: en PPT este control solo debe
              ofrecer agregar/eliminar diapositivas. */}
          {!isPresentation && (
            <>
              <label className="page-setup-field">
                <span>Tamaño</span>
                <select value={draftSize} onChange={(e) => setDraftSize(e.target.value as 'A4' | 'A3')} style={{color:'black'}}>
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
              </label>
              <label className="page-setup-field">
                <span>Orientación</span>
                <select value={draftOrientation} onChange={(e) => setDraftOrientation(e.target.value as 'portrait' | 'landscape')} style={{color:'black'}}>
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
                style={{color:'white'}}
              >
                Aplicar
              </button>
              {/* Pedido explícito 2026-09-08, solo modo documento (Word):
                 convierte toda el área de contenido de la página en un
                 único bloque de texto sin borde de selección ni recuadro
                 de edición visibles -- se comporta como si siempre
                 estuviera en edición ("escribir directo sobre la hoja").
                 Cualquier otro bloque insertado ENCIMA conserva su
                 comportamiento normal (ver PageCanvas.tsx,
                 page.plainTextElementId). */}
              <div className="page-setup-plaintext">
                <label title="Convierte toda el área de contenido de esta página en un bloque de texto sin marco visible, listo para escribir directo -- los demás bloques que insertes encima conservan su comportamiento normal">
                  <input
                    type="checkbox"
                    checked={Boolean(page.plainTextElementId)}
                    onChange={(e) => setPagePlainTextMode(page.page_number, e.target.checked)}
                  />
                  Convertir esta página a texto plano
                </label>
              </div>
            </>
          )}
          <div className="page-setup-addpage">
            {!addPageOpen ? (
              <>
                <button
                  type="button"
                  className="page-setup-add"
                  style={{ color: 'black' }}
                  title={isPresentation ? 'Insertar una diapositiva nueva y vacía antes o después de esta' : 'Insertar una hoja nueva y vacía antes o después de esta'}
                  onClick={() => setAddPageOpen(true)}
                >
                  {isPresentation ? '+ Agregar diapositiva' : '+ Agregar página'}
                </button>
                <button
                  type="button"
                  className="page-setup-add"
                  style={{ color: 'black' }}
                  title={isPresentation ? 'Duplicar esta diapositiva con todo su contenido y las mismas posiciones' : 'Duplicar esta página con todo su contenido y las mismas posiciones'}
                  onClick={() => {
                    duplicatePage(page.page_number);
                    setOpen(false);
                  }}
                >
                  ⧉ {isPresentation ? 'Duplicar diapositiva' : 'Duplicar página'}
                </button>
              </>
            ) : (
              <div className="page-setup-addpage-choice">
                <span className="page-setup-title">¿Dónde insertarla?</span>
                <div className="page-setup-addpage-buttons">
                  <button
                    type="button"
                    className="page-setup-add"
                    onClick={() => {
                      insertPageAt(page.page_number, 'before');
                      setAddPageOpen(false);
                      setOpen(false);
                    }}
                    style={{color:"black"}}
                  >
                    ↑ Antes de esta
                  </button>
                  <button
                    type="button"
                    className="page-setup-add"
                    onClick={() => {
                      insertPageAt(page.page_number, 'after');
                      setAddPageOpen(false);
                      setOpen(false);
                    }}
                    style={{color:"black"}}
                  >
                    ↓ Después de esta
                  </button>
                </div>
                <button type="button" className="page-setup-addpage-cancel" style={{color:"black", borderStyle: "solid", borderWidth: 1, borderRadius: 5, borderColor:"gray"}} onClick={() => setAddPageOpen(false)}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="page-setup-delete"
            style={{color:'black'}}
            disabled={pageCount <= 1}
            title={
              pageCount <= 1
                ? (isPresentation ? 'La presentación debe conservar al menos una diapositiva' : 'El informe debe conservar al menos una hoja')
                : (isPresentation ? `Eliminar diapositiva ${page.page_number}` : `Eliminar página ${page.page_number}`)
            }
            onClick={() => {
              if (pageCount <= 1) return;
              const confirmMsg = isPresentation
                ? `¿Eliminar la diapositiva ${page.page_number} y todo su contenido? Esta acción no se puede deshacer desde esta ventana.`
                : `¿Eliminar la página ${page.page_number} y todo su contenido? Esta acción no se puede deshacer desde esta ventana.`;
              if (window.confirm(confirmMsg)) {
                removePage(page.page_number);
                setOpen(false);
              }
            }}
          >
            {isPresentation ? 'Eliminar diapositiva' : 'Eliminar hoja'}
          </button>
        </div>
      )}
    </div>
  );
}

function CommentCard({ comment, autoFocus, currentUserId, currentUserName }: { comment: ReportComment; autoFocus: boolean; currentUserId?: string; currentUserName?: string }) {
  const updateComment = useEditorStore((s) => s.updateComment);
  const deleteComment = useEditorStore((s) => s.deleteComment);
  const setHoveredCommentId = useEditorStore((s) => s.setHoveredCommentId);
  const [draft, setDraft] = useState(comment.text);

  useEffect(() => setDraft(comment.text), [comment.id, comment.text]);

  const save = () => updateComment(comment.id, draft.trim());
  const initials = comment.author.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
  // Comentarios sin authorId son de antes de esta función: se comparan por
  // nombre para no dejar huérfanos comentarios propios ya existentes.
  const isOwn = comment.authorId ? comment.authorId === currentUserId : Boolean(currentUserName) && comment.author === currentUserName;

  const handleDelete = () => {
    if (window.confirm('¿Eliminar este comentario? Esta acción no se puede deshacer.')) {
      deleteComment(comment.id);
    }
  };

  return (
    <article
      className="report-comment-card"
      data-comment-id={comment.id}
      onMouseEnter={() => setHoveredCommentId(comment.id)}
      onMouseLeave={() => setHoveredCommentId(undefined)}
    >
      <div className="report-comment-card__head">
        <span className="report-comment-avatar" aria-hidden="true">{initials}</span>
        <strong>{comment.author}</strong>
        {comment.elementId ? <span className="report-comment-anchor">Bloque</span> : <span className="report-comment-anchor">Página</span>}
        {isOwn && (
          <button
            type="button"
            className="report-comment-delete"
            title="Eliminar comentario"
            aria-label="Eliminar comentario"
            onClick={handleDelete}
          >
            ×
          </button>
        )}
      </div>
      <textarea
        autoFocus={autoFocus}
        value={draft}
        rows={2}
        placeholder={comment.elementId ? 'Escriba un comentario…' : 'Inicie una conversación…'}
        aria-label={`Comentario de ${comment.author}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            save();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="report-comment-card__footer">Ctrl + Enter para guardar</div>
    </article>
  );
}

function CommentLane({ pageNumber, currentUserId, currentUserName }: { pageNumber: number; currentUserId?: string; currentUserName?: string }) {
  const comments = useEditorStore((s) => ((s.doc.meta.comments as ReportComment[] | undefined) || []));
  const pageComments = comments
    .filter((comment) => comment.pageNumber === pageNumber)
    .sort((a, b) => a.anchorY - b.anchorY || a.createdAt.localeCompare(b.createdAt));
  const newestId = pageComments.length > 0 ? pageComments[pageComments.length - 1].id : undefined;

  if (pageComments.length === 0) return null;
  return (
    <aside className="report-comments-lane" aria-label={`Comentarios de la página ${pageNumber}`}>
      {pageComments.map((comment) => (
        <CommentCard
          key={comment.id}
          comment={comment}
          autoFocus={comment.id === newestId && !comment.text}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      ))}
    </aside>
  );
}

interface MultipageViewProps {
  zoomPercent?: number;
  onRequestImageReplace?: (pageNumber: number, elementId: string, source?: string) => void;
  onRequestCoverImage?: (pageNumber: number, elementId: string) => void;
  tenantId?: string;
  currentUserId?: string;
  currentUserName?: string;
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

function MultipageView({ zoomPercent = 100, onRequestImageReplace, onRequestCoverImage, tenantId, currentUserId, currentUserName }: MultipageViewProps) {
  const pages = useEditorStore((s) => s.doc.pages);
  const meta = useEditorStore((s) => s.doc.meta);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ver comentario de EDITOR_VIRTUALIZATION_PAGE_THRESHOLD arriba. Arranca
  // con solo la página 1 -- igual que ReadOnlyViewer.tsx -- así el primer
  // render nunca monta de golpe los Stages de las páginas restantes antes
  // de que el observer conecte.
  const shouldVirtualizeEditor = pages.length > EDITOR_VIRTUALIZATION_PAGE_THRESHOLD;
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1]));
  useEffect(() => {
    if (!shouldVirtualizeEditor) return undefined;
    const root = scrollRef.current;
    if (!root) return undefined;
    const shells = Array.from(root.querySelectorAll<HTMLElement>('.multipage-page-shell'));
    const observer = new IntersectionObserver((entries) => {
      setVisiblePages((prev) => {
        let changed = false;
        const next = new Set(prev);
        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.getAttribute('data-page-number'));
          if (!pageNumber) return;
          if (entry.isIntersecting && !next.has(pageNumber)) {
            next.add(pageNumber);
            changed = true;
          } else if (!entry.isIntersecting && next.has(pageNumber)) {
            next.delete(pageNumber);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, { root, rootMargin: EDITOR_VIRTUALIZATION_ROOT_MARGIN, threshold: 0 });
    shells.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // Reconstruir cuando cambia la cantidad de páginas (insertar/eliminar
    // hoja) -- los `.multipage-page-shell` cambian de identidad DOM.
  }, [shouldVirtualizeEditor, pages.length]);

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
        {pages.map((page, pageIndex) => {
          const scale = Math.min(4, Math.max(0.1, (Number(zoomPercent) || 100) / 100));
          const withinViewport = !shouldVirtualizeEditor || visiblePages.has(page.page_number);
          return (
          <div key={page.page_number} className="multipage-page-shell" data-page-number={page.page_number}>
            <div className="multipage-page-canvas-column">
              <PagePaperSetupControl page={page} layoutMode={layoutMode} />
              {layoutMode !== 'presentation' && pageIndex === 0 && (
                <HorizontalMarginRuler page={page} scale={scale} />
              )}
              {withinViewport ? (
                <PageCanvas
                  page={page}
                  totalPages={pages.length}
                  viewportScale={scale}
                  onRequestImageReplace={onRequestImageReplace}
                  onRequestCoverImage={onRequestCoverImage}
                  tenantId={tenantId}
                />
              ) : (
                <PageCanvasPlaceholder
                  page={page}
                  meta={meta}
                  scale={scale}
                  layoutMode={layoutMode}
                  pageNumber={page.page_number}
                  totalPages={pages.length}
                />
              )}
            </div>
            <CommentLane pageNumber={page.page_number} currentUserId={currentUserId} currentUserName={currentUserName} />
          </div>
          );
        })}
      </div>
      <DragPreviewOverlay />
    </section>
  );
}

export default memo(MultipageView);
