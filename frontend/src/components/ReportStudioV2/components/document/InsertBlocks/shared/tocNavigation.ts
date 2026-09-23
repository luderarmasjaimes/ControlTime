import { useEditorStore } from '../../../../store/useEditorStore';

/** Ctrl/Cmd + clic en una entrada de índice (el bloque `toc` real, o una
 * referencia cruzada a un encabezado dentro de un bloque de texto, ver
 * PageCanvas.tsx) salta a la página/bloque real del título -- sin el
 * modificador, se deja pasar el clic normal. No depende de nada local a
 * ningún componente (solo lee/actúa sobre el store), así que vive acá,
 * compartida entre TocBlock.tsx y el bloque de texto. */
export function navigateToTocEntry(event: React.MouseEvent<HTMLElement>, elementId: string, pageNumber: number) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();

  const state = useEditorStore.getState();
  const targetPage = state.doc.pages.find((candidate) =>
    candidate.page_number === pageNumber && candidate.elements.some((candidateElement) => candidateElement.id === elementId),
  ) || state.doc.pages.find((candidate) => candidate.elements.some((candidateElement) => candidateElement.id === elementId));

  if (!targetPage) return;

  state.selectPage(targetPage.page_number);
  state.selectElement(elementId);
  document
    .querySelector<HTMLElement>(`.multipage-page-shell[data-page-number="${targetPage.page_number}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
