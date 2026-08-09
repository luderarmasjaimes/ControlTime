import { describe, expect, it } from 'vitest'
import { buildStyledSegments, sanitizeSpans, type BaseTextStyle, type TextStyleSpan } from './textSpans'
import { generateTocData, resolveHeadingRefLabel } from '../components/document/TableOfContents'

/**
 * ADR-019 — "Test obligatorio: insertar sección en el medio → numeración y
 * refs se actualizan". Cubre el mecanismo real usado por el editor
 * (PageCanvas.tsx) y el visor/export (ReadOnlyViewer.tsx): una referencia se
 * guarda como ancla (`TextStyleSpan.ref.targetId`, un `TocItem.id`), nunca
 * como texto fijo, y se resuelve contra `generateTocData(doc)` en cada
 * render — nunca contra un valor cacheado.
 */

const BASE: BaseTextStyle = {
  bold: false, italic: false, underline: false, color: '#000', fontSize: 14,
  fontFamily: 'Arial', highlightColor: 'transparent', headingStyle: '',
}

function headingElement(id: string, text: string, level: 'h1' | 'h2') {
  return { id, type: 'text', props: { text, headingStyle: level } }
}

function docWithPages(...elements: ReturnType<typeof headingElement>[]) {
  return { pages: [{ page_number: 1, elements }] }
}

describe('referencias cruzadas (ADR-019)', () => {
  it('resuelve el número vigente de un heading real', () => {
    const doc = docWithPages(
      headingElement('h_intro', 'Introducción', 'h1'),
      headingElement('h_results', 'Resultados', 'h1'),
    )
    const items = generateTocData(doc)
    expect(items.map((i) => i.number)).toEqual(['1', '2'])
    expect(resolveHeadingRefLabel(doc, 'h_results')).toBe('2')
  })

  it('re-numera y re-resuelve automáticamente al insertar una sección en el medio', () => {
    const doc1 = docWithPages(
      headingElement('h_intro', 'Introducción', 'h1'),
      headingElement('h_results', 'Resultados', 'h1'),
    )
    const targetId = generateTocData(doc1).find((i) => i.text === 'Resultados')!.id
    expect(resolveHeadingRefLabel(doc1, targetId)).toBe('2')

    // Se inserta una sección nueva ENTRE "Introducción" y "Resultados" —
    // ninguna acción manual sobre la referencia, solo cambia el documento.
    const doc2 = docWithPages(
      headingElement('h_intro', 'Introducción', 'h1'),
      headingElement('h_metodologia', 'Metodología', 'h1'),
      headingElement('h_results', 'Resultados', 'h1'),
    )
    // Mismo id de ancla (mismo elemento real, no se tocó) — el número
    // resuelto debe pasar de "2" a "3" sin que nadie edite la referencia.
    expect(resolveHeadingRefLabel(doc2, targetId)).toBe('3')
  })

  it('un target borrado resuelve a undefined en vez de mostrar un número obsoleto', () => {
    const doc1 = docWithPages(headingElement('h_a', 'Sección A', 'h1'))
    const targetId = generateTocData(doc1).find((i) => i.text === 'Sección A')!.id
    const docSinHeading = docWithPages()
    expect(resolveHeadingRefLabel(docSinHeading, targetId)).toBeUndefined()
  })

  it('buildStyledSegments sustituye el placeholder por el número resuelto solo cuando se pasa resolveRef', () => {
    const doc = docWithPages(
      headingElement('h_intro', 'Introducción', 'h1'),
      headingElement('h_results', 'Resultados', 'h1'),
    )
    const targetId = generateTocData(doc).find((i) => i.text === 'Resultados')!.id
    const text = 'Ver sección # para más detalle.'
    const refStart = text.indexOf('#')
    const spans: TextStyleSpan[] = sanitizeSpans(
      [{ start: refStart, end: refStart + 1, ref: { targetId } }],
      text.length,
    )
    expect(spans[0].ref?.targetId).toBe(targetId)

    // Sin resolver: se conserva el placeholder literal (estructura, no valor).
    const rawSegments = buildStyledSegments(text, spans, BASE)
    expect(rawSegments.map((s) => s.text).join('')).toBe(text)

    // Con resolver: el placeholder se sustituye por el número real.
    const resolved = buildStyledSegments(text, spans, BASE, (id) => resolveHeadingRefLabel(doc, id))
    expect(resolved.map((s) => s.text).join('')).toBe('Ver sección 2 para más detalle.')

    // Referencia a un target inexistente: marcador visible, no texto vacío
    // ni el placeholder crudo.
    const brokenSpans: TextStyleSpan[] = [{ start: refStart, end: refStart + 1, ref: { targetId: 'no-existe' } }]
    const brokenResolved = buildStyledSegments(text, brokenSpans, BASE, (id) => resolveHeadingRefLabel(doc, id))
    expect(brokenResolved.map((s) => s.text).join('')).toContain('⚠')
  })
})
