import { describe, it, expect } from 'vitest';
import { computeAutoFlowPosition, useEditorStore, INSERT_GAP, type ReportElement } from './useEditorStore';
import type { ReportLayoutMetrics } from '../lib/reportLayoutMetrics';

/**
 * Cubre la auto-colocación de objetos insertados SIN posición explícita
 * (botón del ribbon o de la biblioteca izquierda) -- pedido explícito
 * 2026-09-10: "si inserto una imagen... y vuelvo a colocar otra sin mover
 * el cursor, esta NO debe sobreponerse... tiene que insertarse a la
 * derecha del objeto inicial si es que alcanza el espacio... si no,
 * abajo". Antes, el objeto recién insertado quedaba SIEMPRE seleccionado
 * (ver el final de `addElement`), así que la SIGUIENTE inserción se
 * anclaba EXACTAMENTE a esa misma posición -- solapamiento total
 * garantizado. Ver `computeAutoFlowPosition` en useEditorStore.ts para el
 * detalle del algoritmo (flujo por filas, como ajuste de texto).
 */

const makeElement = (overrides: Partial<ReportElement>): ReportElement => ({
  id: 'el', type: 'image', x: 0, y: 0, width: 100, height: 100, zIndex: 1, locked: false, props: {},
  ...overrides,
});

// Métricas simples y redondas, independientes del tamaño de hoja real --
// solo importan CONTENT_LEFT/CONTENT_RIGHT/CONTENT_TOP para esta función.
const metrics: ReportLayoutMetrics = {
  PAGE_WIDTH: 480, PAGE_HEIGHT: 900, HEADER_HEIGHT: 58, FOOTER_HEIGHT: 48,
  CONTENT_LEFT: 40, CONTENT_RIGHT: 440, CONTENT_TOP: 60, CONTENT_BOTTOM: 800,
  MARGIN_LEFT: 40, MARGIN_RIGHT: 40, MARGIN_TOP: 60, MARGIN_BOTTOM: 100,
};

describe('computeAutoFlowPosition', () => {
  it('página vacía: esquina superior izquierda del área de contenido', () => {
    const pos = computeAutoFlowPosition([], undefined, { width: 150, height: 100 }, metrics);
    expect(pos).toEqual({ x: metrics.CONTENT_LEFT, y: metrics.CONTENT_TOP });
  });

  it('con un objeto existente y espacio suficiente, el nuevo va A LA DERECHA en la misma fila', () => {
    const first = makeElement({ id: 'a', x: 40, y: 60, width: 150, height: 100 });
    const pos = computeAutoFlowPosition([first], undefined, { width: 150, height: 80 }, metrics);
    expect(pos).toEqual({ x: 40 + 150 + INSERT_GAP, y: 60 }); // misma fila (y=60), pegado al borde derecho ocupado
  });

  it('si no alcanza el espacio a la derecha, abre una fila nueva debajo', () => {
    const first = makeElement({ id: 'a', x: 40, y: 60, width: 150, height: 100 });
    // 40+150+12=202; 202+300=502 > CONTENT_RIGHT(440) -- no entra a la derecha.
    const pos = computeAutoFlowPosition([first], undefined, { width: 300, height: 80 }, metrics);
    expect(pos).toEqual({ x: metrics.CONTENT_LEFT, y: 60 + 100 + INSERT_GAP }); // debajo del borde inferior de la fila
  });

  it('un bloque de ancho completo (como un bloque de texto) siempre abre fila nueva, nunca cabe al lado de nada', () => {
    const first = makeElement({ id: 'a', x: 40, y: 60, width: 150, height: 100 });
    const fullWidth = metrics.CONTENT_RIGHT - metrics.CONTENT_LEFT;
    const pos = computeAutoFlowPosition([first], undefined, { width: fullWidth, height: 60 }, metrics);
    expect(pos).toEqual({ x: metrics.CONTENT_LEFT, y: 160 + INSERT_GAP });
  });

  it('con VARIOS objetos en la misma fila, el nuevo se coloca a la derecha del MÁS a la derecha', () => {
    const a = makeElement({ id: 'a', x: 40, y: 60, width: 100, height: 80 });
    const b = makeElement({ id: 'b', x: 152, y: 60, width: 100, height: 60 }); // 40+100+12
    const pos = computeAutoFlowPosition([a, b], undefined, { width: 80, height: 50 }, metrics);
    expect(pos).toEqual({ x: 152 + 100 + INSERT_GAP, y: 60 }); // pegado a "b", no a "a"
  });

  it('sin selección, usa como referencia la fila MÁS BAJA de la página (no la primera)', () => {
    const rowOneTall = makeElement({ id: 'a', x: 40, y: 60, width: 150, height: 400 }); // fila 1, muy alta
    const rowTwo = makeElement({ id: 'b', x: 40, y: 472, width: 100, height: 60 }); // fila 2, debajo de la 1
    const pos = computeAutoFlowPosition([rowOneTall, rowTwo], undefined, { width: 80, height: 40 }, metrics);
    // Debe ir junto a "b" (fila 2), NO junto a "a" (fila 1) aunque "a" sea más alto.
    expect(pos).toEqual({ x: 40 + 100 + INSERT_GAP, y: 472 });
  });

  it('con un elemento SELECCIONADO (no el más bajo), ancla a SU fila -- como insertar en el cursor', () => {
    const rowOne = makeElement({ id: 'a', x: 40, y: 60, width: 150, height: 100 });
    const rowTwo = makeElement({ id: 'b', x: 40, y: 172, width: 100, height: 60 });
    // Selecciona "a" (fila de arriba), NO "b" (la más baja).
    const pos = computeAutoFlowPosition([rowOne, rowTwo], 'a', { width: 80, height: 40 }, metrics);
    expect(pos).toEqual({ x: 40 + 150 + INSERT_GAP, y: 60 }); // junto a "a", no debajo de "b"
  });

  it('tolera una fila cuyos elementos no comparten EXACTAMENTE el mismo y (alineación aproximada)', () => {
    const a = makeElement({ id: 'a', x: 40, y: 60, width: 100, height: 100 });
    const b = makeElement({ id: 'b', x: 152, y: 65, width: 100, height: 80 }); // 5px más abajo, misma fila visual
    const pos = computeAutoFlowPosition([a, b], undefined, { width: 80, height: 40 }, metrics);
    // La fila sigue detectándose como {a, b} -- borde derecho ocupado = el de "b".
    expect(pos.x).toBe(152 + 100 + INSERT_GAP);
  });
});

describe('addElement -- auto-colocación end-to-end (sin posición explícita)', () => {
  it('reproduce la secuencia pedida: imagen, imagen (derecha), tabla (fila nueva), imagen (derecha), texto (fila nueva, ancho completo), imagen (fila nueva)', () => {
    // Anchos/altos explícitos vía `patch` (NO x/y -- eso sí forzaría
    // posición explícita y saltaría el flujo automático que se está
    // probando) para que el resultado no dependa del tamaño de hoja ni de
    // los anchos por defecto de cada tipo (que pueden cambiar): 2 imágenes
    // de 200px SIEMPRE caben juntas en una A4 vertical normal, una tabla de
    // 320px NUNCA cabe junto a esas dos (usuario mismo: "si es que alcanza
    // el espacio" -- acá deliberadamente no alcanza para forzar el
    // salto de fila), y todo junto entra de sobra en el alto de una sola
    // página (sin cruzar a una 2da, eso se cubre aparte más abajo).
    useEditorStore.getState().createNewDocument('Autor Test');

    const addElement = useEditorStore.getState().addElement;
    const contentEls = () => useEditorStore.getState().doc.pages[0].elements
      .filter((e) => e.type !== 'header' && e.type !== 'footer');
    const last = () => contentEls()[contentEls().length - 1];

    addElement('image', { width: 200, height: 150 }); // 1: esquina superior izquierda
    const img1 = last();
    expect(img1.x).toBeLessThan(100);

    addElement('image', { width: 200, height: 150 }); // 2: a la derecha de la 1 (misma fila)
    const img2 = last();
    expect(img2.y).toBe(img1.y);
    expect(img2.x).toBe(img1.x + img1.width + INSERT_GAP);

    addElement('table', { width: 320, height: 150 }); // 3: no entra a la derecha de la 2 -> fila nueva, izquierda
    const table = last();
    expect(table.x).toBe(img1.x);
    expect(table.y).toBeGreaterThan(img1.y);

    addElement('image', { width: 200, height: 150 }); // 4: a la derecha de la tabla (misma fila que la tabla)
    const img4 = last();
    expect(img4.y).toBe(table.y);
    expect(img4.x).toBe(table.x + table.width + INSERT_GAP);

    addElement('text'); // 5: ancho completo -> fila nueva, propia
    const text = last();
    expect(text.x).toBe(img1.x);
    expect(text.y).toBeGreaterThan(Math.max(table.y + table.height, img4.y + img4.height));

    addElement('image', { width: 200, height: 150 }); // 6: la fila del texto no tiene espacio -> fila nueva, izquierda
    const img6 = last();
    expect(img6.x).toBe(img1.x);
    expect(img6.y).toBeGreaterThan(text.y);
  });

  it('insertar dos veces seguidas SIN mover nada nunca produce dos elementos en la misma posición exacta', () => {
    useEditorStore.getState().createNewDocument('Autor Test');
    useEditorStore.getState().addElement('image');
    useEditorStore.getState().addElement('image');

    const [a, b] = useEditorStore.getState().doc.pages[0].elements.filter((e) => e.type === 'image');
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });

  it('un objeto que no entra en la página activa reutiliza una página EXISTENTE con espacio en vez de crear siempre una nueva', () => {
    // Pedido explícito 2026-09-10 (mensaje de seguimiento): "si vuelvo a
    // insertar otro objeto en la primera hoja y no alcanza, no me lo
    // coloca en la segunda hoja que acaba de crear... sino me crea una 3ra
    // hoja y así consecutivamente". Antes, el desborde SIEMPRE abría una
    // página nueva al final del documento sin revisar si alguna ya
    // existente (creada por un desborde anterior) tenía lugar.
    useEditorStore.getState().createNewDocument('Autor Test');
    const { addElement, selectPage } = useEditorStore.getState();

    // Llena la página 1 casi por completo (alto explícito vía patch, no
    // posición -- sigue pasando por el flujo automático).
    addElement('text', { height: 950 });
    expect(useEditorStore.getState().doc.pages).toHaveLength(1);

    // No entra en la página 1 -> crea la página 2 (comportamiento ya
    // existente, sin cambios).
    addElement('image');
    expect(useEditorStore.getState().doc.pages).toHaveLength(2);
    expect(useEditorStore.getState().selectedPage).toBe(2);

    // El usuario vuelve a la página 1 e inserta otra cosa que TAMPOCO
    // entra ahí -- debe aprovechar la página 2 (que ya tiene lugar de
    // sobra), NO crear una página 3.
    selectPage(1);
    addElement('table');

    const pages = useEditorStore.getState().doc.pages;
    expect(pages).toHaveLength(2); // sigue en 2, no se creó una 3ra
    expect(useEditorStore.getState().selectedPage).toBe(2);
    const page2Content = pages[1].elements.filter((e) => e.type !== 'header' && e.type !== 'footer');
    expect(page2Content.some((e) => e.type === 'table')).toBe(true);
  });

  it('si NINGUNA página existente tiene lugar, recién ahí crea una nueva', () => {
    useEditorStore.getState().createNewDocument('Autor Test');
    const { addElement, selectPage } = useEditorStore.getState();

    addElement('text', { height: 950 }); // llena la página 1
    addElement('text', { height: 950 }); // no entra en la 1 -> crea la página 2, y la llena también
    expect(useEditorStore.getState().doc.pages).toHaveLength(2);

    selectPage(1);
    addElement('image'); // no entra ni en la 1 ni en la 2 (ambas llenas) -> recién ahí, página 3
    expect(useEditorStore.getState().doc.pages).toHaveLength(3);
    expect(useEditorStore.getState().selectedPage).toBe(3);
  });
});
