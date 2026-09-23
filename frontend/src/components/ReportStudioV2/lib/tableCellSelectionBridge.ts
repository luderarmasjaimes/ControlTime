import { useSyncExternalStore } from 'react';

/**
 * Puente entre la selección de celdas tipo Excel de TableBlock.tsx (estado
 * interno del componente, useState local -- ver `selectedCells` ahí) y el
 * panel derecho (RightInspector.tsx → ConditionalFormatEditor.tsx), que
 * vive en un árbol de React completamente distinto (TableBlock se renderiza
 * dentro de un portal <Html> de Konva en PageCanvas.tsx). Mismo problema y
 * mismo criterio que activeTextFormatBridge.ts, pero acá el panel derecho
 * necesita LEER datos para pintarse (¿cuántas celdas hay seleccionadas?,
 * ¿forman una sola fila/columna?), no solo "intentar aplicar una acción" --
 * por eso es un mini pub-sub con useSyncExternalStore en vez de un simple
 * registro de handler.
 *
 * A propósito NO vive en useEditorStore.ts (el store grande, con historial
 * de deshacer/rehacer y snapshots): la selección de celdas cambia en CADA
 * evento de arrastre del mouse, y ese store ya compara selectedElementId en
 * su lógica de diffing de snapshots -- meter ahí un valor tan efímero
 * arriesgaba ensuciar esas comparaciones sin necesidad.
 */
export interface TableCellSelectionInfo {
  elementId: string;
  cells: { row: number; column: number }[];
  hasHeader: boolean;
  rowCount: number;
  colCount: number;
}

let current: TableCellSelectionInfo | null = null;
const listeners = new Set<() => void>();

export function setActiveTableCellSelection(info: TableCellSelectionInfo | null): void {
  current = info;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TableCellSelectionInfo | null {
  return current;
}

/** Selección de celdas activa, o `null` si no hay ninguna tabla con celdas
 * seleccionadas en este momento. El llamador (ConditionalFormatEditor) debe
 * comparar `elementId` contra el bloque actualmente seleccionado -- esto no
 * lo hace por sí solo, para no acoplar el puente a useEditorStore. */
export function useActiveTableCellSelection(): TableCellSelectionInfo | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
