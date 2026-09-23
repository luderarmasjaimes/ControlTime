import { create } from 'zustand';

/**
 * Estado EFÍMERO (nunca se persiste, nunca toca `useEditorStore`) del
 * "fantasma" que se muestra mientras se arrastra un bloque -- pedido
 * explícito 2026-09-09: "al querer pasarlo a otra página no se ve el
 * bloque, como que desaparece... hagamos que siempre se vea el texto y el
 * bloque de selección para ver cómo se desplaza y dónde quedará".
 *
 * Causa real: cada página es su PROPIO <Stage> de Konva (ver
 * MultipageView.tsx) -- arrastrar un nodo más allá de los límites de SU
 * página lo saca del área visible de ESE lienzo, aunque el cursor ya esté
 * sobre el lienzo de la página siguiente/anterior (son <canvas> DISTINTOS,
 * uno no puede "dibujar" en el otro). Este fantasma es un `<div>` normal,
 * fuera de cualquier <Stage>, posicionado en coordenadas de VIEWPORT
 * (`position: fixed`) -- por eso puede seguir al cursor sin que ningún
 * lienzo lo recorte, cruzando visualmente el espacio entre páginas.
 *
 * Store SEPARADO (no una sub-clave de useEditorStore) a propósito: esto se
 * actualiza en cada tick de arrastre (varias veces por segundo) y solo lo
 * necesita el propio overlay flotante -- meterlo en el store grande
 * dispararía un re-render de TODO lo que se suscribe a él en cada tick.
 */
export interface DragPreviewState {
  active: boolean;
  kind: 'text' | 'image' | 'generic';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  lineHeight: number;
  src?: string;
  label?: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface DragPreviewActions {
  show: (patch: Partial<Omit<DragPreviewState, 'active'>>) => void;
  move: (left: number, top: number) => void;
  hide: () => void;
}

const BASE_STATE: DragPreviewState = {
  active: false,
  kind: 'generic',
  text: '',
  fontSize: 14,
  fontFamily: 'Inter',
  fontColor: '#1a1a1a',
  lineHeight: 1.35,
  src: undefined,
  label: undefined,
  width: 0,
  height: 0,
  left: 0,
  top: 0,
};

export const useDragPreviewStore = create<DragPreviewState & DragPreviewActions>((set) => ({
  ...BASE_STATE,
  show: (patch) => set({ ...BASE_STATE, ...patch, active: true }),
  move: (left, top) => set({ left, top }),
  hide: () => set({ active: false }),
}));
