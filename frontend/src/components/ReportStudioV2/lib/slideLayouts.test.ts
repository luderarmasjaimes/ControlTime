import { describe, expect, it } from 'vitest';
import { SLIDE_LAYOUT_TEMPLATES, buildSlideLayoutElements, buildSlideLayoutDeckSpecs, findSlideLayout } from './slideLayouts';
import { getReportLayoutMetrics } from './reportLayoutMetrics';

const m = getReportLayoutMetrics('presentation');

describe('SLIDE_LAYOUT_TEMPLATES — galería de diseños de diapositiva', () => {
  it('tiene al menos 10 diseños, todos con id único', () => {
    expect(SLIDE_LAYOUT_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(SLIDE_LAYOUT_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(SLIDE_LAYOUT_TEMPLATES.length);
  });

  it('findSlideLayout encuentra por id y no revienta con uno inexistente', () => {
    expect(findSlideLayout(SLIDE_LAYOUT_TEMPLATES[0].id)?.id).toBe(SLIDE_LAYOUT_TEMPLATES[0].id);
    expect(findSlideLayout('no-existe')).toBeUndefined();
  });
});

describe('buildSlideLayoutElements', () => {
  it('cada diseño produce al menos un fondo a sangre + contenido', () => {
    SLIDE_LAYOUT_TEMPLATES.forEach((layout) => {
      const els = buildSlideLayoutElements(layout, m, 1);
      expect(els.length).toBeGreaterThan(1);
      const bg = els[0];
      expect(bg.type).toBe('shape');
      expect(bg.x).toBe(0);
      expect(bg.y).toBe(0);
      expect(bg.width).toBe(m.PAGE_WIDTH);
      expect(bg.height).toBe(m.PAGE_HEIGHT);
      expect((bg.props as any).fill).toBe(layout.bgColor);
    });
  });

  it('el diseño "image-caption" incluye exactamente un elemento de imagen', () => {
    const layout = findSlideLayout('image-caption-light')!;
    const els = buildSlideLayoutElements(layout, m, 1);
    const images = els.filter((e) => e.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].src).toBeTruthy();
  });

  it('los ids generados no se repiten dentro de una misma diapositiva', () => {
    const layout = findSlideLayout('two-column-corporate')!;
    const els = buildSlideLayoutElements(layout, m, 3);
    const ids = new Set(els.map((e) => e.id));
    expect(ids.size).toBe(els.length);
  });

  it('los overrides reemplazan el placeholder generico por el texto pedido', () => {
    const layout = findSlideLayout('title-executive')!;
    const els = buildSlideLayoutElements(layout, m, 1, { title: '[AQUÍ VA TU TÍTULO]', subtitle: '[Nombres]' });
    const texts = els.map((e) => e.props?.text).filter(Boolean);
    expect(texts).toContain('[AQUÍ VA TU TÍTULO]');
    expect(texts).toContain('[Nombres]');
  });

  it('el diseño "image-caption" con decoracion incluye formas circulo y rectangulo detras de la imagen', () => {
    const layout = findSlideLayout('image-caption-light')!;
    const els = buildSlideLayoutElements(layout, m, 1);
    const shapes = els.filter((e) => e.type === 'shape');
    const shapeTypes = shapes.map((e) => (e.props as any).shapeType);
    expect(shapeTypes).toContain('circle');
    expect(shapeTypes).toContain('rectangle');
    // Las formas decorativas deben ir DETRAS del contenido, nunca tapandolo
    // (bug real encontrado: wrapMode 'infront' hacia que un fondo/forma
    // ocultara el texto por completo).
    shapes.forEach((s) => expect(s.wrapMode).toBe('behind'));
  });
});

describe('buildSlideLayoutDeckSpecs — mini-deck de 5 diapositivas por tema', () => {
  it('genera 5 especificaciones, todas con los colores del tema elegido', () => {
    const layout = findSlideLayout('section-vivid')!;
    const specs = buildSlideLayoutDeckSpecs(layout);
    expect(specs).toHaveLength(5);
    specs.forEach((spec) => {
      expect(spec.layout.bgColor).toBe(layout.bgColor);
      expect(spec.layout.accentColor).toBe(layout.accentColor);
    });
  });

  it('cada diapositiva del deck trae su propio texto entre corchetes para reemplazar', () => {
    const layout = findSlideLayout('content-minimal')!;
    const specs = buildSlideLayoutDeckSpecs(layout);
    specs.forEach((spec) => {
      const m2 = getReportLayoutMetrics('presentation');
      const els = buildSlideLayoutElements(spec.layout, m2, 1, spec.overrides);
      const texts = els.map((e) => e.props?.text).filter(Boolean).join(' | ');
      expect(texts).toMatch(/\[.+\]/);
    });
  });
});
