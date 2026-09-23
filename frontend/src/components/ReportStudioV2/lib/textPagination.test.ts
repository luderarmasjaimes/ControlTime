import { describe, expect, it } from 'vitest';
import { splitTextForHeight } from './textPagination';
import type { BaseTextStyle, TextStyleSpan } from './textSpans';

// El stub de canvas de setupTests.js mide TODO ancho de texto como 0 (jsdom
// no implementa CanvasRenderingContext2D de verdad) -- por eso estos tests
// nunca fuerzan un salto de línea por ANCHO, solo por saltos de línea (\n)
// explícitos, y verifican el ALTO resultante (que depende del fontSize
// efectivo por línea, no del ancho medido).

const BASE: BaseTextStyle = {
  bold: false, italic: false, underline: false, strikethrough: false, color: '',
  fontSize: 16, fontFamily: 'Arial', highlightColor: '', headingStyle: '', textAlign: 'left',
};

describe('splitTextForHeight — sin spans (comportamiento previo, sin regresión)', () => {
  it('parte tras la cantidad de líneas que entran en maxHeight, con el fontSize uniforme', () => {
    const text = 'aaa\nbbb\nccc';
    // lineH = 16*1.2 = 19.2; availableForLines = maxHeight - 8.
    // maxHeight=48 -> availableForLines=40 -> entran 2 líneas (38.4<=40), la 3ra no (57.6>40).
    const result = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48);
    expect(result).not.toBeNull();
    expect(result!.fittingText).toBe('aaa\nbbb');
    expect(result!.overflowText).toBe('ccc');
  });

  it('devuelve null si todo el texto ya entra', () => {
    const result = splitTextForHeight('aaa\nbbb', 16, 'Arial', false, false, 1.2, 500, 1000);
    expect(result).toBeNull();
  });
});

describe('splitTextForHeight — con spans (bug real: un span en fuente mas grande subestimaba el alto)', () => {
  it('una linea con un span de fontSize mucho mayor ocupa mas alto de linea y corta ANTES que con el tamano uniforme', () => {
    const text = 'aaa\nbbb\nccc';
    // Mismo texto y mismo maxHeight que el primer test (corta tras 2 líneas
    // SIN spans) -- con un span de fontSize:40 cubriendo la línea "bbb"
    // (offsets 4-7), esa línea sola ya no entra junto a la primera.
    const spans: TextStyleSpan[] = [{ start: 4, end: 7, fontSize: 40 }];
    const result = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48, spans, BASE);
    expect(result).not.toBeNull();
    expect(result!.fittingText).toBe('aaa');
    expect(result!.overflowText).toBe('bbb\nccc');
  });

  it('sin pasar spans/base, el resultado es identico al calculo uniforme de antes (retrocompatible)', () => {
    const text = 'aaa\nbbb\nccc';
    const withoutSpans = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48);
    const withEmptySpans = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48, [], null);
    expect(withEmptySpans).toEqual(withoutSpans);
  });

  it('un span de fontSize MENOR al base no reduce el alto de la linea (el fontSize base sigue "mandando")', () => {
    const text = 'aaa\nbbb\nccc';
    // Span en la línea "bbb" con fontSize MENOR (10) -- lineFontSize para esa
    // línea sigue siendo max(16, 10) = 16, así que el resultado es igual al
    // caso sin spans (corta tras 2 líneas, no antes).
    const spans: TextStyleSpan[] = [{ start: 4, end: 7, fontSize: 10 }];
    const result = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48, spans, BASE);
    expect(result).not.toBeNull();
    expect(result!.fittingText).toBe('aaa\nbbb');
    expect(result!.overflowText).toBe('ccc');
  });

  it('un span de fontSize mayor en la PRIMERA linea tambien se respeta', () => {
    const text = 'aaa\nbbb\nccc';
    // lineH linea1 (span fontSize:30) = 30*1.2=36; linea2/3 = 16*1.2=19.2.
    // maxHeight=48 -> availableForLines=40: linea1 sola entra (36<=40), pero
    // linea1+linea2 (36+19.2=55.2) ya no -> corta después de la línea 1.
    const spans: TextStyleSpan[] = [{ start: 0, end: 3, fontSize: 30 }];
    const result = splitTextForHeight(text, 16, 'Arial', false, false, 1.2, 500, 48, spans, BASE);
    expect(result).not.toBeNull();
    expect(result!.fittingText).toBe('aaa');
    expect(result!.overflowText).toBe('bbb\nccc');
  });
});
