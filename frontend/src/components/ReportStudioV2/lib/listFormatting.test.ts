import { describe, expect, it } from 'vitest';
import { applyListToText, indentListLine, stripListMarkers, depthTabsToDisplaySpaces, LIST_INDENT_TAB_SIZE } from './listFormatting';

describe('depthTabsToDisplaySpaces (sangria visualmente igual editando y fuera de edicion)', () => {
  it('reemplaza cada TAB inicial por LIST_INDENT_TAB_SIZE espacios', () => {
    const raw = '• uno\n\t◦ dos\n\t\t▪ tres';
    expect(depthTabsToDisplaySpaces(raw)).toBe(
      `• uno\n${' '.repeat(LIST_INDENT_TAB_SIZE)}◦ dos\n${' '.repeat(LIST_INDENT_TAB_SIZE * 2)}▪ tres`,
    );
  });

  it('no toca lineas sin sangria', () => {
    expect(depthTabsToDisplaySpaces('uno\ndos')).toBe('uno\ndos');
  });
});

describe('applyListToText — sin sangria (compatibilidad con el comportamiento anterior)', () => {
  it('numerada plana: 1, 2, 3 secuenciales', () => {
    expect(applyListToText('uno\ndos\ntres', 'number')).toBe('1. uno\n2. dos\n3. tres');
  });
  it('bullet plano: mismo simbolo en todas las lineas', () => {
    expect(applyListToText('uno\ndos', 'bullet')).toBe('• uno\n• dos');
  });
  it('lineas vacias no llevan marcador', () => {
    expect(applyListToText('uno\n\ndos', 'number')).toBe('1. uno\n\n2. dos');
  });
  it('none quita los marcadores existentes', () => {
    expect(stripListMarkers('1. uno\n2. dos')).toBe('uno\ndos');
    expect(applyListToText('1. uno\n2. dos', 'none')).toBe('uno\ndos');
  });
});

describe('applyListToText — multinivel (SCRUM-31)', () => {
  it('nivel 1 usa letras, nivel 2 usa romanos, nivel 3 vuelve a numeros', () => {
    const raw = 'uno\n\tsub-a\n\tsub-b\n\t\tsub-sub-a\ndos';
    const result = applyListToText(raw, 'number');
    expect(result).toBe(
      '1. uno\n\ta. sub-a\n\tb. sub-b\n\t\ti. sub-sub-a\n2. dos',
    );
  });

  it('un item de nivel 0 nuevo reinicia el contador del sub-nivel', () => {
    const raw = 'uno\n\tsub-a\ndos\n\tsub-otra-vez';
    const result = applyListToText(raw, 'number');
    expect(result).toBe('1. uno\n\ta. sub-a\n2. dos\n\ta. sub-otra-vez');
  });

  it('volver a un nivel superior CONTINUA su contador (no lo reinicia)', () => {
    const raw = 'uno\n\tsub-a\ndos\ntres';
    const result = applyListToText(raw, 'number');
    // "dos" y "tres" son nivel 0 -- deben seguir 2, 3 (no reiniciar por el sub-item intermedio)
    expect(result).toBe('1. uno\n\ta. sub-a\n2. dos\n3. tres');
  });

  it('viñetas alternan simbolo solido/hueco/cuadrado por nivel', () => {
    const raw = 'uno\n\tdos\n\t\ttres';
    expect(applyListToText(raw, 'bullet')).toBe('• uno\n\t◦ dos\n\t\t▪ tres');
  });

  it('pasar de numerada a bullet conserva la sangria de cada linea', () => {
    const numbered = '1. uno\n\ta. sub-a';
    expect(applyListToText(numbered, 'bullet')).toBe('• uno\n\t◦ sub-a');
  });
});

describe('applyListToText — onlyExistingListLines (bug real: "- " viñeteaba TODO el bloque)', () => {
  it('no le agrega marcador a un parrafo que nunca tuvo uno, aunque otra linea del bloque si sea parte de la lista', () => {
    const raw = 'Primer parrafo normal\nSegundo parrafo normal\n• Tercer parrafo con vineta';
    const result = applyListToText(raw, 'bullet', { onlyExistingListLines: true });
    expect(result).toBe('Primer parrafo normal\nSegundo parrafo normal\n• Tercer parrafo con vineta');
  });

  it('SI renumera las lineas que ya tienen marcador, aunque haya parrafos sueltos intercalados', () => {
    const raw = '• uno\nparrafo normal intercalado\n• dos';
    const result = applyListToText(raw, 'number', { onlyExistingListLines: true });
    expect(result).toBe('1. uno\nparrafo normal intercalado\n2. dos');
  });

  it('sin la opcion (comportamiento por defecto), SI le pone marcador a todo -- uso explicito de "convertir todo el bloque"', () => {
    const raw = 'uno\ndos';
    expect(applyListToText(raw, 'bullet')).toBe('• uno\n• dos');
    expect(applyListToText(raw, 'bullet', { onlyExistingListLines: false })).toBe('• uno\n• dos');
  });
});

describe('indentListLine (Tab / Shift+Tab)', () => {
  it('Tab en la primera linea de una lista numerada la pasa a sub-item "a." y renumera la raiz', () => {
    // "uno" deja de ocupar un numero de raiz al indentarse -- "dos" pasa a
    // ser el item #1 de la raiz (mismo comportamiento que Word: el
    // primer item indentado queda sin "padre" visible arriba).
    const text = '1. uno\n2. dos';
    const cursor = text.indexOf('uno') + 3; // cursor al final de "uno"
    const result = indentListLine(text, cursor, 'number', 1);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('\ta. uno\n1. dos');
  });

  it('Shift+Tab en un sub-item lo devuelve al nivel raiz y renumera', () => {
    const text = '1. uno\n\ta. sub-a\n2. dos';
    const cursor = text.indexOf('sub-a');
    const result = indentListLine(text, cursor, 'number', -1);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('1. uno\n2. sub-a\n3. dos');
  });

  it('Shift+Tab en un item ya en la raiz no hace nada (devuelve null)', () => {
    const text = '1. uno\n2. dos';
    const cursor = text.indexOf('uno');
    expect(indentListLine(text, cursor, 'number', -1)).toBeNull();
  });

  it('sin lista activa (listType none) no hace nada', () => {
    expect(indentListLine('uno\ndos', 2, 'none', 1)).toBeNull();
  });

  it('el cursor queda reposicionado dentro del contenido, no del marcador', () => {
    // "1. abc" -> Tab -> "\ta. abc"; el cursor estaba tras "ab" (offset 5 = "1. ab"), debe seguir tras "ab" en el nuevo marcador
    const text = '1. abc';
    const cursor = 5; // "1. ab|c"
    const result = indentListLine(text, cursor, 'number', 1);
    expect(result!.text).toBe('\ta. abc');
    expect(result!.text.slice(0, result!.cursorPos)).toBe('\ta. ab');
  });

  it('indentar un item de la lista no le agrega marcador a un parrafo suelto del mismo bloque', () => {
    const text = '1. uno\nparrafo normal sin vinetas\n2. dos';
    const cursor = text.indexOf('dos');
    const result = indentListLine(text, cursor, 'number', 1);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('1. uno\nparrafo normal sin vinetas\n\ta. dos');
  });
});
