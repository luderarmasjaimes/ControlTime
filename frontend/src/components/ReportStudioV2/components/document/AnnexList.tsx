/* ─────────────────────────────────────────────────────────────────────────────
   Anexos — lista automática de pies de imagen/tabla/gráfico ("Leyenda",
   props.caption) del documento, mismo criterio que TableOfContents.tsx: una
   sola fuente de verdad (generateAnnexData) que tanto el bloque `annex` del
   lienzo (PageCanvas.tsx) como el picker de referencias cruzadas (comando
   "/referencia") y el resolver de esas referencias (resolveAnnexRefLabel)
   consultan en vivo desde `doc.pages` -- nunca un número fijo guardado que
   pueda desincronizarse al mover/insertar/borrar un elemento.
   ───────────────────────────────────────────────────────────────────────── */

export interface AnnexItem {
  /** = elementId -- único en el documento, usado como `targetId` de una
   * referencia cruzada (ver TextStyleSpan.ref en lib/textSpans.ts). */
  id: string;
  elementId: string;
  type: 'image' | 'table' | 'chart';
  /** Rótulo corto y estable ("Imagen 3", "Tabla 1") -- lo que se inserta en
   * el texto al elegir esta entrada desde "/referencia" (nunca la leyenda
   * completa, que puede ser muy larga, per pedido explícito 2026-09-04). */
  label: string;
  /** Leyenda completa (props.caption) -- se muestra en la lista de Anexos y
   * en el picker del comando, pero NUNCA se inserta completa en el texto. */
  caption: string;
  pageNumber: number;
}

const ANNEX_TYPE_LABEL: Record<string, string> = {
  image: 'Imagen',
  table: 'Tabla',
  chart: 'Gráfico',
};

/** Recorre todas las páginas del documento en orden de lectura (página, luego
 * Y ascendente dentro de cada página -- mismo criterio que se corrigió para
 * TableOfContents.tsx: el orden de INSERCIÓN en el arreglo `elements` no
 * refleja necesariamente el orden visual tras mover un bloque entre
 * páginas) y junta todo elemento imagen/tabla/gráfico con una Leyenda no
 * vacía. Numera cada uno por SU tipo (Imagen 1, Imagen 2, Tabla 1…),
 * reiniciando el contador solo por tipo, nunca de forma global. */
export function generateAnnexData(doc: any): AnnexItem[] {
  const items: AnnexItem[] = [];
  if (!doc?.pages) return items;
  const counters: Record<string, number> = {};

  doc.pages.forEach((page: any, pageIdx: number) => {
    if (!page.elements) return;
    const candidates = page.elements
      .filter((el: any) => ANNEX_TYPE_LABEL[el.type] && String(el.props?.caption ?? '').trim().length > 0)
      .slice()
      .sort((a: any, b: any) => (a.y ?? 0) - (b.y ?? 0));
    candidates.forEach((el: any) => {
      const typeLabel = ANNEX_TYPE_LABEL[el.type];
      counters[el.type] = (counters[el.type] || 0) + 1;
      items.push({
        id: el.id,
        elementId: el.id,
        type: el.type,
        label: `${typeLabel} ${counters[el.type]}`,
        caption: String(el.props.caption).trim(),
        pageNumber: pageIdx + 1,
      });
    });
  });

  return items;
}

/** Resuelve una referencia cruzada (ADR-019, misma mecánica que
 * resolveHeadingRefLabel en TableOfContents.tsx) al rótulo corto vigente de
 * su target -- reordenar/insertar/borrar elementos renumera y re-resuelve la
 * referencia sola en el siguiente render. `undefined` si `targetId` ya no
 * corresponde a ningún elemento con Leyenda (borrado, o su Leyenda se vació). */
export function resolveAnnexRefLabel(doc: any, targetId: string): string | undefined {
  return generateAnnexData(doc).find((item) => item.id === targetId)?.label;
}
