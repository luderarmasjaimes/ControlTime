import { create } from 'zustand';

const mmToPx = (mm) => mm * 3.7795275591;
const A4_WIDTH = mmToPx(210);
const A4_HEIGHT = mmToPx(297);
const PAGE_HEADER_HEIGHT = 58;
const PAGE_FOOTER_HEIGHT = 48;
const CONTENT_TOP = PAGE_HEADER_HEIGHT + 14;
const CONTENT_BOTTOM = A4_HEIGHT - PAGE_FOOTER_HEIGHT - 14;
const CONTENT_LEFT = 40;
const INSERT_GAP = 12;

const optimizeSyntaxOrder = (rawText) => {
  const original = String(rawText ?? '');
  if (!original.trim()) {
    return original;
  }

  let text = original
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?![\s\n]|$)/g, '$1 ');

  const lines = text.split('\n');
  let orderedIndex = 1;
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '';
    }

    if (/^[-*•]\s*/.test(trimmed)) {
      return `• ${trimmed.replace(/^[-*•]\s*/, '')}`;
    }

    if (/^\d+[.)]\s*/.test(trimmed)) {
      const withoutPrefix = trimmed.replace(/^\d+[.)]\s*/, '');
      const rebuilt = `${orderedIndex}. ${withoutPrefix}`;
      orderedIndex += 1;
      return rebuilt;
    }

    return trimmed;
  });

  text = normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  text = text.replace(/(^|[.!?]\s+|\n)([a-záéíóúñ])/g, (match, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });

  if (text && !/[.!?]$/.test(text)) {
    text = `${text}.`;
  }

  return text;
};

const detectSuggestionSeverity = (originalText, optimizedText) => {
  const original = String(originalText || '');
  const optimized = String(optimizedText || '');
  const absDelta = Math.abs(optimized.length - original.length);
  const hadFinalPunctuationIssue = /[^.!?\s]$/.test(original.trim());
  const hadDoubleSpaces = /\s{2,}/.test(original);
  const hadListFix = /^\s*\d+[.)]\s*/m.test(original) || /^\s*[-*]\s*/m.test(original);

  let score = 0;
  if (hadFinalPunctuationIssue) score += 1;
  if (hadDoubleSpaces) score += 1;
  if (hadListFix) score += 1;
  if (absDelta > 24) score += 1;
  if (original.length > 420) score += 1;

  if (score >= 4) return 'alta';
  if (score >= 2) return 'media';
  return 'leve';
};

const buildDocumentReview = (doc) => {
  const issues = [];
  let textBlocks = 0;
  let optimizedCandidates = 0;

  doc.pages.forEach((page) => {
    page.elements.forEach((element) => {
      if (element.type !== 'text') {
        return;
      }

      textBlocks += 1;
      const text = String(element?.props?.text ?? '');
      const normalized = text.trim();

      if (!normalized) {
        issues.push(`Pagina ${page.page_number}: bloque de texto vacio.`);
        return;
      }

      if (/\s{2,}/.test(text)) {
        issues.push(`Pagina ${page.page_number}: hay espacios dobles en un bloque de texto.`);
      }

      if (!/[.!?]\s*$/.test(normalized)) {
        issues.push(`Pagina ${page.page_number}: un parrafo no cierra con puntuacion final.`);
      }

      const lines = normalized.split('\n').filter(Boolean);
      if (lines.some((line) => line.length > 140)) {
        issues.push(`Pagina ${page.page_number}: hay lineas muy largas (recomendado dividir).`);
      }

      const optimized = optimizeSyntaxOrder(text);
      if (optimized !== text) {
        optimizedCandidates += 1;
      }
    });
  });

  const pages = doc.pages.length;
  const score = Math.max(0, 100 - issues.length * 6);
  const summary = `Revision completada: ${pages} pagina(s), ${textBlocks} bloque(s) de texto, ${issues.length} observacion(es), ${optimizedCandidates} bloque(s) optimizable(s).`;

  return {
    pages,
    textBlocks,
    issues,
    optimizedCandidates,
    score,
    summary,
  };
};

const defaultPropsByType = (type) => {
  if (type === 'text') {
    return {
      text: 'Escribe aquí tu texto técnico...',
      fontFamily: 'Arial',
      fontSize: 16,
      fontColor: '#0f172a',
      backgroundColor: '#ffffff',
      textAlign: 'left',
      lineHeight: 1.35,
      listType: 'none',
      bold: false,
      italic: false,
    };
  }

  if (type === 'chart') {
    return {
      title: 'Dashboard dinámico',
      live: true,
      chartType: 'bar',
      theme: 'premium'
    };
  }

  if (type === 'table') {
    return {
      rows: [
        ['Cabecera 1', 'Cabecera 2', 'Cabecera 3'],
        ['Dato 1.1', 'Dato 1.2', 'Dato 1.3'],
        ['Dato 2.1', 'Dato 2.2', 'Dato 2.3']
      ],
      hasHeader: true,
      borderColor: '#e2e8f0',
      headerBg: '#f8fafc',
      cellPadding: 10,
      fontSize: 14
    };
  }

  if (type === 'sensor') {
    return {
      title: 'Sensor Real-time',
      sensorId: 'sn-001',
      sensorType: 'temperature',
    };
  }

  return {
    title: `${type.toUpperCase()} BLOCK`,
    value: '—',
  };
};

const createElement = (type, pageNumber, nextIndex) => ({
  id: `${type}-${pageNumber}-${Date.now()}-${nextIndex}`,
  type,
  x: CONTENT_LEFT,
  y: CONTENT_TOP,
  width: type === 'kpi' ? 180 : type === 'table' ? 420 : type === 'sensor' ? 240 : 320,
  height: type === 'kpi' ? 110 : type === 'table' ? 200 : type === 'sensor' ? 140 : 180,
  zIndex: nextIndex,
  locked: false,
  props: defaultPropsByType(type),
});

const createTextTemplateElement = (pageNumber, nextIndex, template) => ({
  id: `text-template-${template}-${pageNumber}-${Date.now()}-${nextIndex}`,
  type: 'text',
  x: CONTENT_LEFT,
  y: CONTENT_TOP,
  width: 320,
  height: 72,
  zIndex: nextIndex,
  locked: false,
  props: {
    ...defaultPropsByType('text'),
    text: 'Escribe aquí tu texto técnico...',
    fontSize: 14,
    lineHeight: 1.25,
  },
});

const initialPage = { page_number: 1, elements: [] };

export const useEditorStore = create((set, get) => ({
  doc: {
    document_id: 'rep_2026_01',
    pages: [initialPage],
    meta: {
      author: 'AGM Solutions',
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  },
  selectedPage: 1,
  selectedElementId: undefined,
  gridEnabled: true,
  snapEnabled: true,
  // Identificadores del informe actualmente cargado en el editor
  currentReportId: null,
  currentReportTitle: 'Informe sin título',
  setCurrentReportId: (id) => set({ currentReportId: id }),
  setCurrentReportTitle: (title) => set({ currentReportTitle: title }),
  /** Carga un doc JSON externo en el editor (desde "Abrir para editar") */
  loadDocument: (contentJson, reportId, reportTitle) => {
    try {
      const parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
      set({
        doc: parsed,
        selectedPage: 1,
        selectedElementId: undefined,
        currentReportId: reportId || null,
        currentReportTitle: reportTitle || 'Informe sin título',
      });
    } catch {
      console.error('useEditorStore.loadDocument: JSON inválido');
    }
  },
  addPage: () =>
    set((state) => {
      const nextPage = state.doc.pages.length + 1;
      return {
        doc: {
          ...state.doc,
          pages: [...state.doc.pages, { page_number: nextPage, elements: [] }],
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: nextPage,
      };
    }),
  duplicatePage: (pageNumber) =>
    set((state) => {
      const page = state.doc.pages.find((p) => p.page_number === pageNumber);
      if (!page) {
        return state;
      }

      const copy = {
        page_number: state.doc.pages.length + 1,
        elements: page.elements.map((element, index) => ({
          ...element,
          id: `${element.id}-copy-${Date.now()}-${index}`,
          x: Math.min(element.x + 20, A4_WIDTH - element.width - 10),
          y: Math.min(element.y + 20, A4_HEIGHT - element.height - 10),
        })),
      };

      return {
        doc: {
          ...state.doc,
          pages: [...state.doc.pages, copy],
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  reorderPages: (from, to) =>
    set((state) => {
      const fromIndex = state.doc.pages.findIndex((p) => p.page_number === from);
      const toIndex = state.doc.pages.findIndex((p) => p.page_number === to);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return state;
      }

      const pages = [...state.doc.pages];
      const [moved] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, moved);
      const normalized = pages.map((page, index) => ({ ...page, page_number: index + 1 }));

      return {
        doc: {
          ...state.doc,
          pages: normalized,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  selectPage: (pageNumber) => set({ selectedPage: pageNumber, selectedElementId: undefined }),
  addElement: (type) =>
    set((state) => {
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;

      const placeElementInPage = (page, element) => {
        const maxBottom = page.elements.length
          ? Math.max(...page.elements.map((existing) => existing.y + existing.height))
          : CONTENT_TOP - INSERT_GAP;
        const nextY = Math.max(CONTENT_TOP, maxBottom + INSERT_GAP);
        const positionedElement = { ...element, y: nextY, x: CONTENT_LEFT };
        const fits = nextY + positionedElement.height <= CONTENT_BOTTOM;
        return { fits, element: positionedElement };
      };

      const activePage = pages[currentIndex];
      const baseElement = createElement(type, activePage.page_number, activePage.elements.length);
      const attempt = placeElementInPage(activePage, baseElement);

      if (attempt.fits) {
        pages[currentIndex] = {
          ...activePage,
          elements: [...activePage.elements, attempt.element],
        };

        return {
          doc: {
            ...state.doc,
            pages,
            meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
          },
          selectedPage: activePage.page_number,
          selectedElementId: attempt.element.id,
        };
      }

      const nextPageNumber = pages.length + 1;
      const nextPage = {
        page_number: nextPageNumber,
        elements: [],
      };
      const nextElement = createElement(type, nextPageNumber, 0);
      const nextPlacement = placeElementInPage(nextPage, nextElement);
      nextPage.elements.push(nextPlacement.element);
      pages.push(nextPage);

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: nextPageNumber,
        selectedElementId: nextPlacement.element.id,
      };
    }),
  addTextTemplate: (template) =>
    set((state) => {
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const nextIndex = activePage.elements.length;

      const element = createTextTemplateElement(activePage.page_number, nextIndex, template);

      if (template === 'header') {
        element.x = CONTENT_LEFT;
        element.y = 10;
        element.width = A4_WIDTH - CONTENT_LEFT * 2;
        element.height = 34;
        element.props.text = 'ENCABEZADO TÉCNICO: Informe de operación minera';
        element.props.fontSize = 15;
        element.props.bold = true;
      }

      if (template === 'footer') {
        element.x = CONTENT_LEFT;
        element.y = A4_HEIGHT - FOOTER_HEIGHT + 6;
        element.width = A4_WIDTH - CONTENT_LEFT * 2;
        element.height = 28;
        element.props.text = 'PIE DE PÁGINA: Responsable | Fecha | Código de documento';
        element.props.fontSize = 12;
        element.props.fontColor = '#334155';
      }

      if (template === 'findings') {
        element.x = CONTENT_LEFT;
        element.y = CONTENT_TOP + 24;
        element.width = A4_WIDTH - CONTENT_LEFT * 2;
        element.height = 110;
        element.props.text = 'Hallazgos Técnicos:\n1.\n2.\n3.';
        element.props.fontSize = 14;
      }

      pages[currentIndex] = {
        ...activePage,
        elements: [...activePage.elements, element],
      };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: element.id,
      };
    }),
  selectElement: (id) => set({ selectedElementId: id }),
  updateElement: (pageNumber, elementId, patch) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }
        return {
          ...page,
          elements: page.elements.map((element) => (element.id === elementId ? { ...element, ...patch } : element)),
        };
      });
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  removeElement: (pageNumber, elementId) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }
        return {
          ...page,
          elements: page.elements.filter((element) => element.id !== elementId),
        };
      });
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedElementId: state.selectedElementId === elementId ? undefined : state.selectedElementId,
      };
    }),
  reviewDocumentQuality: () => {
    const state = get();
    return buildDocumentReview(state.doc);
  },
  getOptimizationSuggestions: () => {
    const state = get();
    const suggestions = [];

    state.doc.pages.forEach((page) => {
      page.elements.forEach((element) => {
        if (element.type !== 'text') {
          return;
        }

        const originalText = String(element?.props?.text ?? '');
        const optimizedText = optimizeSyntaxOrder(originalText);

        if (optimizedText === originalText) {
          return;
        }

        suggestions.push({
          id: `ai-${page.page_number}-${element.id}`,
          pageNumber: page.page_number,
          elementId: element.id,
          originalText,
          optimizedText,
          delta: Math.abs(optimizedText.length - originalText.length),
          severity: detectSuggestionSeverity(originalText, optimizedText),
        });
      });
    });

    return suggestions;
  },
  applyOptimizationSuggestion: ({ pageNumber, elementId, optimizedText }) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }

        return {
          ...page,
          elements: page.elements.map((element) => {
            if (element.id !== elementId || element.type !== 'text') {
              return element;
            }

            return {
              ...element,
              props: {
                ...element.props,
                text: optimizedText,
              },
            };
          }),
        };
      });

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  applyOptimizationBatch: (suggestions) => {
    let applied = 0;

    set((state) => {
      const suggestionMap = new Map(
        (suggestions || []).map((item) => [`${item.pageNumber}::${item.elementId}`, item.optimizedText]),
      );

      const pages = state.doc.pages.map((page) => {
        const updatedElements = page.elements.map((element) => {
          const key = `${page.page_number}::${element.id}`;
          const optimizedText = suggestionMap.get(key);

          if (!optimizedText || element.type !== 'text') {
            return element;
          }

          applied += 1;
          return {
            ...element,
            props: {
              ...element.props,
              text: optimizedText,
            },
          };
        });

        return {
          ...page,
          elements: updatedElements,
        };
      });

      if (applied === 0) {
        return state;
      }

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    });

    return { applied };
  },
  optimizeDocumentWithAI: () => {
    let optimizedBlocks = 0;
    let totalTextBlocks = 0;

    set((state) => {
      const pages = state.doc.pages.map((page) => {
        const updatedElements = page.elements.map((element) => {
          if (element.type !== 'text') {
            return element;
          }

          totalTextBlocks += 1;
          const currentText = String(element?.props?.text ?? '');
          const improvedText = optimizeSyntaxOrder(currentText);
          if (improvedText === currentText) {
            return element;
          }

          optimizedBlocks += 1;
          return {
            ...element,
            props: {
              ...element.props,
              text: improvedText,
            },
          };
        });

        return {
          ...page,
          elements: updatedElements,
        };
      });

      if (optimizedBlocks === 0) {
        return state;
      }

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    });

    return {
      optimizedBlocks,
      totalTextBlocks,
    };
  },
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setGridEnabled: (enabled) => set({ gridEnabled: enabled }),
}));
