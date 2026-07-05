import { create } from 'zustand';
import { getReportLayoutMetrics } from '../lib/reportLayoutMetrics';
import { REPORT_IMAGE_PLACEHOLDER_SVG } from '../lib/reportImageSrc';

import { log } from '../../../lib/logger';
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
      text: '',
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
      title: 'Sensor tiempo real',
      sensorId: 1,
      sensorTypeId: null,
      sensorType: 'temperature',
    };
  }

  if (type === 'image') {
    return {
      alt: 'Figura o fotografía técnica',
    };
  }

  if (type === 'cover') {
    return {
      title: 'Informe Técnico',
      company: '',
      unit: '',
      author: '',
      date: new Date().toISOString().slice(0, 10),
      classification: 'CONFIDENCIAL',
      docCode: '',
    };
  }

  if (type === 'toc') {
    return {
      title: 'Tabla de Contenidos',
      autoGenerate: true,
    };
  }

  return {
    title: type === 'kpi' ? 'Tonelaje movido' : `${type.toUpperCase()} BLOCK`,
    value: '—',
    kpiCode: type === 'kpi' ? 'tonelaje_movido' : undefined,
    source: type === 'kpi' ? 'runtime_db' : undefined,
    /** spark_bars | line | donut | none — informe compacto; donut requiere meta en BD */
    trendViz: type === 'kpi' ? 'spark_bars' : undefined,
  };
};

const createElement = (type, pageNumber, nextIndex, m) => {
  const contentW = Math.max(80, m.CONTENT_RIGHT - m.CONTENT_LEFT);

  if (type === 'image') {
    return {
      id: `image-${pageNumber}-${Date.now()}-${nextIndex}`,
      type: 'image',
      x: m.CONTENT_LEFT,
      y: m.CONTENT_TOP,
      width: Math.min(360, contentW),
      height: 220,
      zIndex: nextIndex,
      locked: false,
      src: REPORT_IMAGE_PLACEHOLDER_SVG,
      objectFit: 'cover',
      props: defaultPropsByType('image'),
    };
  }

  return {
    id: `${type}-${pageNumber}-${Date.now()}-${nextIndex}`,
    type,
    x: m.CONTENT_LEFT,
    y: m.CONTENT_TOP,
    width:
      type === 'kpi'
        ? Math.min(180, contentW)
        : type === 'table'
          ? Math.min(420, contentW)
          : type === 'sensor'
            ? Math.min(240, contentW)
            : type === 'cover' || type === 'toc'
              ? contentW
              : Math.min(320, contentW),
    height:
      type === 'kpi' ? 110
      : type === 'table' ? 200
      : type === 'sensor' ? 140
      : type === 'cover' ? 560
      : type === 'toc' ? 340
      : 180,
    zIndex: nextIndex,
    locked: false,
    props: defaultPropsByType(type),
  };
};

const createTextTemplateElement = (pageNumber, nextIndex, template, m) => ({
  id: `text-template-${template}-${pageNumber}-${Date.now()}-${nextIndex}`,
  type: 'text',
  x: m.CONTENT_LEFT,
  y: m.CONTENT_TOP,
  width: Math.min(320, m.CONTENT_RIGHT - m.CONTENT_LEFT),
  height: 72,
  zIndex: nextIndex,
  locked: false,
  props: {
    ...defaultPropsByType('text'),
    text: '',
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
      layoutMode: 'document',
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
      const layoutMode =
        parsed?.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      set({
        doc: {
          ...parsed,
          meta: { ...(parsed.meta || {}), layoutMode },
        },
        selectedPage: 1,
        selectedElementId: undefined,
        currentReportId: reportId || null,
        currentReportTitle: reportTitle || 'Informe sin título',
      });
    } catch {
      log.error('useEditorStore.loadDocument: JSON inválido');
    }
  },
  setLayoutMode: (layoutMode) =>
    set((state) => ({
      doc: {
        ...state.doc,
        meta: {
          ...state.doc.meta,
          layoutMode: layoutMode === 'presentation' ? 'presentation' : 'document',
          version: state.doc.meta.version + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    })),
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

      const m = getReportLayoutMetrics(state.doc.meta?.layoutMode || 'document');
      const copy = {
        page_number: state.doc.pages.length + 1,
        elements: page.elements.map((element, index) => ({
          ...element,
          id: `${element.id}-copy-${Date.now()}-${index}`,
          x: Math.min(element.x + 20, m.PAGE_WIDTH - element.width - 10),
          y: Math.min(element.y + 20, m.PAGE_HEIGHT - element.height - 10),
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
  selectPage: (pageNumber) =>
    set((state) =>
      state.selectedPage === pageNumber
        ? { selectedPage: pageNumber }
        : { selectedPage: pageNumber, selectedElementId: undefined },
    ),
  addElement: (type, patch = {}) =>
    set((state) => {
      const m = getReportLayoutMetrics(state.doc.meta?.layoutMode || 'document');
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;

      const placeElementInPage = (page, element) => {
        const maxBottom = page.elements.length
          ? Math.max(...page.elements.map((existing) => existing.y + existing.height))
          : m.CONTENT_TOP - INSERT_GAP;
        const nextY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);
        const positionedElement = { ...element, y: nextY, x: m.CONTENT_LEFT };
        const fits = nextY + positionedElement.height <= m.CONTENT_BOTTOM;
        return { fits, element: positionedElement };
      };

      const mergePatch = (base) => {
        const next = { ...base };
        if (patch.src != null) {
          next.src = patch.src;
        }
        if (typeof patch.width === 'number' && Number.isFinite(patch.width)) {
          next.width = patch.width;
        }
        if (typeof patch.height === 'number' && Number.isFinite(patch.height)) {
          next.height = patch.height;
        }
        if (patch.objectFit != null) {
          next.objectFit = patch.objectFit;
        }
        if (patch.props != null && typeof patch.props === 'object') {
          next.props = { ...(base.props || {}), ...patch.props };
        }
        if (typeof patch.zIndex === 'number' && Number.isFinite(patch.zIndex)) {
          next.zIndex = patch.zIndex;
        }
        if (typeof patch.x === 'number' && Number.isFinite(patch.x)) {
          next.x = patch.x;
        }
        if (typeof patch.y === 'number' && Number.isFinite(patch.y)) {
          next.y = patch.y;
        }
        return next;
      };

      const activePage = pages[currentIndex];
      const baseElement = createElement(type, activePage.page_number, activePage.elements.length, m);
      const attempt = placeElementInPage(activePage, mergePatch(baseElement));

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
      const nextElement = mergePatch(createElement(type, nextPageNumber, 0, m));
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
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const m = getReportLayoutMetrics(layoutMode);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const nextIndex = activePage.elements.length;

      const element = createTextTemplateElement(activePage.page_number, nextIndex, template, m);

      if (template === 'header') {
        element.x = m.CONTENT_LEFT;
        element.y = layoutMode === 'presentation' ? 8 : 10;
        element.width = m.PAGE_WIDTH - m.CONTENT_LEFT * 2;
        element.height = layoutMode === 'presentation' ? 28 : 34;
        element.props.text =
          layoutMode === 'presentation'
            ? 'TÍTULO DE DIAPOSITIVA'
            : 'ENCABEZADO TÉCNICO: Informe de operación minera';
        element.props.fontSize = layoutMode === 'presentation' ? 18 : 15;
        element.props.bold = true;
      }

      if (template === 'footer') {
        element.x = m.CONTENT_LEFT;
        element.y = m.PAGE_HEIGHT - m.FOOTER_HEIGHT + 6;
        element.width = m.PAGE_WIDTH - m.CONTENT_LEFT * 2;
        element.height = 28;
        element.props.text = 'PIE DE PÁGINA: Responsable | Fecha | Código de documento';
        element.props.fontSize = 12;
        element.props.fontColor = '#334155';
      }

      if (template === 'findings') {
        element.x = m.CONTENT_LEFT;
        element.y = m.CONTENT_TOP + 24;
        element.width = m.PAGE_WIDTH - m.CONTENT_LEFT * 2;
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
          elements: page.elements.map((element) => {
            if (element.id !== elementId) {
              return element;
            }
            const merged = { ...element, ...patch };
            if (
              merged.type === 'image' &&
              patch.src != null &&
              merged.props &&
              typeof merged.props === 'object' &&
              Object.prototype.hasOwnProperty.call(merged.props, 'src')
            ) {
              const { src: _legacySrc, ...restProps } = merged.props;
              merged.props = restProps;
            }
            return merged;
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
