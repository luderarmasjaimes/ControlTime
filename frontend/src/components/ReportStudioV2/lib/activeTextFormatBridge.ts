import type { BaseTextStyle } from './textSpans';

/**
 * Puente entre la barra superior (Ribbon, en App.tsx/RibbonToolbar.tsx) y el
 * formato por selección del bloque de texto que se está editando en el
 * lienzo (PageCanvas.tsx). Sin esto, los botones Negrita/Cursiva/Subrayado/
 * Color/Tamaño del ribbon SIEMPRE aplicaban a TODO el bloque — nunca a la
 * palabra que el usuario seleccionó con el mouse dentro del editor, porque
 * el ribbon vive en un componente completamente distinto y no tenía forma
 * de saber "hay una selección de texto activa ahí abajo, y esto es lo que
 * hay que hacer con ella".
 *
 * PageCanvas registra un handler SOLO mientras hay un editor de texto
 * abierto (ver useEffect keyed en openTextEditorId); el ribbon intenta
 * primero este puente, y si no hay handler activo o la selección está
 * colapsada (nada resaltado), cae al comportamiento histórico de aplicar a
 * todo el bloque — igual que Word: con texto seleccionado, el botón afecta
 * solo la selección; sin selección, afecta el párrafo/bloque activo.
 */
type FormatHandler = (patch: Partial<BaseTextStyle>) => boolean;

let activeHandler: FormatHandler | null = null;

export function registerActiveTextFormatHandler(handler: FormatHandler | null): void {
  activeHandler = handler;
}

/** Intenta aplicar el parche a la selección activa. Devuelve `true` si había
 * un editor de texto abierto CON una selección real (y por lo tanto ya se
 * aplicó); `false` si el llamador debe usar el camino de "todo el bloque". */
export function tryApplyToActiveTextSelection(patch: Partial<BaseTextStyle>): boolean {
  return activeHandler ? activeHandler(patch) : false;
}

/**
 * Mismo puente que arriba, pero para el botón "Aa" (MAYÚSCULAS/minúsculas
 * estilo Word) — a diferencia de negrita/color/tamaño, este NO es un parche
 * de estilo (BaseTextStyle): muta el TEXTO en sí. Necesita su propio canal
 * porque `tryApplyToActiveTextSelection` solo sabe transportar `Partial<
 * BaseTextStyle>`.
 */
type CaseHandler = () => boolean;

let activeCaseHandler: CaseHandler | null = null;

export function registerActiveCaseHandler(handler: CaseHandler | null): void {
  activeCaseHandler = handler;
}

/** Igual criterio que `tryApplyToActiveTextSelection`: `true` = ya se
 * aplicó a la selección activa; `false` = el llamador debe caer a "todo el
 * bloque". */
export function tryApplyCaseToActiveTextSelection(): boolean {
  return activeCaseHandler ? activeCaseHandler() : false;
}
