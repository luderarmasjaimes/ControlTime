import { describe, expect, it } from 'vitest';
import { buildDocumentTemplate, findDocumentTemplate, DOCUMENT_TEMPLATES } from './documentTemplates';

/**
 * ADR-112 — plantillas tipo presentación (docType 'presentation') reusan el
 * mismo motor de flujo que las plantillas de documento, pero deben producir
 * `layoutMode: 'presentation'` (consumido por el export PPTX real, ADR-083),
 * sin página de índice, y una diapositiva por bloque de contenido
 * (`forceNewSlide`) en vez de paginar solo por desborde.
 */

describe('catálogo de plantillas: distinción document vs presentation', () => {
  it('las 8 plantillas originales quedan como docType document', () => {
    const originalIds = [
      'informe-tecnico', 'propuesta-tecnica', 'propuesta-tecnica-economica',
      'informe-instalacion-reparacion', 'informe-mantenimiento', 'acta-reunion',
      'informe-incidente', 'ficha-inspeccion-campo',
    ];
    for (const id of originalIds) {
      expect(findDocumentTemplate(id)?.docType).toBe('document');
    }
  });

  it('las 2 plantillas nuevas quedan como docType presentation', () => {
    expect(findDocumentTemplate('presentacion-resultados')?.docType).toBe('presentation');
    expect(findDocumentTemplate('presentacion-comercial')?.docType).toBe('presentation');
  });

  it('todas las plantillas del catálogo tienen builder registrado (buildDocumentTemplate no devuelve null)', () => {
    for (const t of DOCUMENT_TEMPLATES) {
      expect(buildDocumentTemplate(t.id)).not.toBeNull();
    }
  });
});

describe('buildDocumentTemplate — plantilla de presentación', () => {
  it('produce meta.layoutMode "presentation" (requisito del export PPTX, ADR-083)', () => {
    const doc = buildDocumentTemplate('presentacion-resultados');
    expect(doc?.meta?.layoutMode).toBe('presentation');
  });

  it('no agrega página de índice (solo carátula + diapositivas de contenido)', () => {
    const doc = buildDocumentTemplate('presentacion-resultados');
    const tocElements = doc?.pages?.flatMap((p) => p.elements).filter((e) => e.type === 'toc') ?? [];
    expect(tocElements).toHaveLength(0);
  });

  it('genera múltiples diapositivas (una por bloque de contenido, via forceNewSlide)', () => {
    const doc = buildDocumentTemplate('presentacion-resultados');
    // Carátula (1) + 3 bloques de contenido (resumen, hallazgos, próximos pasos) = 4 páginas.
    expect(doc?.pages?.length).toBe(4);
  });

  it('cada elemento de contenido cae dentro del lienzo 960x540 (métricas de presentación)', () => {
    const doc = buildDocumentTemplate('presentacion-resultados');
    const contentPages = (doc?.pages ?? []).slice(1); // salta la carátula
    for (const page of contentPages) {
      for (const el of page.elements) {
        expect(el.x).toBeGreaterThanOrEqual(0);
        expect(el.x + el.width).toBeLessThanOrEqual(960);
        expect(el.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('vuelca las respuestas del asistente en el contenido en vez del placeholder', () => {
    const doc = buildDocumentTemplate('presentacion-comercial', {
      'propuesta-valor': 'Monitoreo geotécnico en tiempo real con alertas tempranas.',
    });
    const texts = (doc?.pages ?? [])
      .flatMap((p) => p.elements)
      .filter((e) => e.type === 'text')
      .map((e) => (e.props as { text?: string }).text || '');
    expect(texts.some((t) => t.includes('Monitoreo geotécnico en tiempo real'))).toBe(true);
    expect(texts.some((t) => t.includes('[completar con la propuesta de valor'))).toBe(false);
  });
});

describe('buildDocumentTemplate — plantilla de documento (regresión, ADR-112 no debe cambiar esto)', () => {
  it('sigue produciendo meta.layoutMode "document" con carátula + índice', () => {
    const doc = buildDocumentTemplate('informe-tecnico');
    expect(doc?.meta?.layoutMode).toBe('document');
    const tocElements = doc?.pages?.flatMap((p) => p.elements).filter((e) => e.type === 'toc') ?? [];
    expect(tocElements).toHaveLength(1);
  });
});
