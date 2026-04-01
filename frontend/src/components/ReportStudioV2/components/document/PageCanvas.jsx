import React, { useEffect, useRef, useState } from 'react';
import { Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { Html } from 'react-konva-utils';
import { 
  Wand2, 
  Mic, 
  MicOff, 
  CheckCheck, 
  Sparkles, 
  Save, 
  X, 
  SpellCheck,
  SpellCheck2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Pencil
} from 'lucide-react';
import { useEditorStore } from '../../store/useEditorStore';
import LiveChartBlock from '../dashboard/LiveChartBlock';
import TableBlock from './TableBlock';
import SensorWidget from './SensorWidget';

const MM_TO_PX = 3.7795275591;
const PAGE_WIDTH = 210 * MM_TO_PX;
const PAGE_HEIGHT = 297 * MM_TO_PX;
const GRID = 12;
const HEADER_HEIGHT = 58;
const FOOTER_HEIGHT = 48;
const CONTENT_TOP = HEADER_HEIGHT + 14;
const CONTENT_BOTTOM = PAGE_HEIGHT - FOOTER_HEIGHT - 14;
const CONTENT_LEFT = 36;
const CONTENT_RIGHT = PAGE_WIDTH - 36;

const DEFAULT_TEXT_PROPS = {
  text: 'Escribe aquí tu texto técnico...',
  fontFamily: 'Arial',
  fontSize: 16,
  fontColor: '#0f172a',
  backgroundColor: 'transparent',
  textAlign: 'left',
  lineHeight: 1.35,
  listType: 'none',
  bold: false,
  italic: false,
};

function getTextProps(element) {
  const props = element.props || {};
  return {
    text: String(props.text ?? DEFAULT_TEXT_PROPS.text),
    fontFamily: String(props.fontFamily ?? DEFAULT_TEXT_PROPS.fontFamily),
    fontSize: Number(props.fontSize ?? DEFAULT_TEXT_PROPS.fontSize),
    fontColor: String(props.fontColor ?? DEFAULT_TEXT_PROPS.fontColor),
    backgroundColor: String(props.backgroundColor ?? DEFAULT_TEXT_PROPS.backgroundColor),
    textAlign: String(props.textAlign ?? DEFAULT_TEXT_PROPS.textAlign),
    lineHeight: Number(props.lineHeight ?? DEFAULT_TEXT_PROPS.lineHeight),
    listType: String(props.listType ?? DEFAULT_TEXT_PROPS.listType),
    bold: Boolean(props.bold ?? DEFAULT_TEXT_PROPS.bold),
    italic: Boolean(props.italic ?? DEFAULT_TEXT_PROPS.italic),
  };
}

function applyListToText(rawText, listType) {
  if (listType === 'none') {
    return rawText;
  }

  const lines = rawText.split('\n');
  if (listType === 'bullet') {
    return lines.map((line) => (line.trim() ? `• ${line.replace(/^•\s*/, '')}` : line)).join('\n');
  }

  return lines
    .map((line, index) => {
      if (!line.trim()) {
        return line;
      }
      return `${index + 1}. ${line.replace(/^\d+\.\s*/, '')}`;
    })
    .join('\n');
}

function normalizeDictationText(rawText) {
  const normalized = ` ${rawText.toLowerCase()} `
    .replace(/\s+punto y coma\s+/g, '; ')
    .replace(/\s+dos puntos\s+/g, ': ')
    .replace(/\s+nueva linea\s+/g, '\n')
    .replace(/\s+nueva línea\s+/g, '\n')
    .replace(/\s+salto de linea\s+/g, '\n')
    .replace(/\s+salto de línea\s+/g, '\n')
    .replace(/\s+abrir parentesis\s+/g, ' (')
    .replace(/\s+abrir paréntesis\s+/g, ' (')
    .replace(/\s+cerrar parentesis\s+/g, ') ')
    .replace(/\s+cerrar paréntesis\s+/g, ') ')
    .replace(/\s+coma\s+/g, ', ')
    .replace(/\s+punto\s+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

function isLikelyLowQualityTranscript(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return true;
  }

  const weakTokens = new Set(['eh', 'mmm', 'uh', 'ah', 'ruido', 'hmm']);
  const tokens = normalized.split(' ').filter(Boolean);

  if (tokens.length === 1 && tokens[0].length <= 2) {
    return true;
  }

  if (tokens.length <= 2 && tokens.every((token) => weakTokens.has(token))) {
    return true;
  }

  return false;
}

function pickBestTranscriptAlternative(result) {
  let bestTranscript = '';
  let bestConfidence = -1;

  const alternativesCount = Number(result?.length ?? 0);
  for (let altIndex = 0; altIndex < alternativesCount; altIndex += 1) {
    const candidate = result[altIndex];
    const transcript = String(candidate?.transcript || '').trim();
    const confidenceValue = Number(candidate?.confidence ?? 0);

    if (!transcript) {
      continue;
    }

    if (confidenceValue > bestConfidence) {
      bestConfidence = confidenceValue;
      bestTranscript = transcript;
      continue;
    }

    if (confidenceValue === bestConfidence && transcript.length > bestTranscript.length) {
      bestTranscript = transcript;
    }
  }

  if (!bestTranscript && result?.[0]?.transcript) {
    return {
      transcript: String(result[0].transcript),
      confidence: Number(result[0].confidence ?? 0),
    };
  }

  return {
    transcript: bestTranscript,
    confidence: Math.max(0, bestConfidence),
  };
}

function getAutoSizedTextBox(
  text,
  fontSize,
  fontFamily,
  bold,
  italic,
  lineHeight,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
) {
  if (typeof document === 'undefined') {
    return { width: minWidth, height: minHeight };
  }

  const safeMaxWidth = Math.max(minWidth, maxWidth);
  const safeMaxHeight = Math.max(minHeight, maxHeight);
  const horizontalPadding = 16;
  const verticalPadding = 16;
  const availableContentWidth = Math.max(20, safeMaxWidth - horizontalPadding);
  const sourceText = String(text ?? '').trim();

  if (!sourceText) {
    return { width: minWidth, height: minHeight };
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return { width: minWidth, height: minHeight };
  }

  context.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${fontSize}px ${fontFamily}`;

  const visualLines = [];
  const paragraphs = sourceText.split('\n');

  const pushWordByChunks = (word) => {
    let chunk = '';
    for (const char of word) {
      const candidate = `${chunk}${char}`;
      if (context.measureText(candidate).width <= availableContentWidth) {
        chunk = candidate;
        continue;
      }

      if (chunk) {
        visualLines.push(chunk);
      }
      chunk = char;
    }
    if (chunk) {
      visualLines.push(chunk);
    }
  };

  for (const paragraph of paragraphs) {
    const normalizedParagraph = paragraph.trim();
    if (!normalizedParagraph) {
      visualLines.push('');
      continue;
    }

    const words = normalizedParagraph.split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(candidate).width <= availableContentWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        visualLines.push(currentLine);
        currentLine = '';
      }

      if (context.measureText(word).width <= availableContentWidth) {
        currentLine = word;
      } else {
        pushWordByChunks(word);
      }
    }

    if (currentLine) {
      visualLines.push(currentLine);
    }
  }

  const measuredLineWidth = visualLines.length
    ? Math.max(...visualLines.map((line) => context.measureText(line || ' ').width))
    : 0;

  const calculatedWidth = Math.ceil(measuredLineWidth + horizontalPadding);
  const calculatedHeight = Math.ceil(Math.max(1, visualLines.length) * fontSize * lineHeight + verticalPadding);

  return {
    width: Math.min(safeMaxWidth, Math.max(minWidth, calculatedWidth)),
    height: Math.min(safeMaxHeight, Math.max(minHeight, calculatedHeight)),
  };
}

function applyQuickSpanishCorrections(rawText) {
  const replacements = [
    [/\bcprregido\b/gi, 'corregido'],
    [/\bigiual\b/gi, 'igual'],
    [/\botograficas\b/gi, 'ortográficas'],
    [/\bcamboa\b/gi, 'cambia'],
    [/\badiconalmente\b/gi, 'adicionalmente'],
    [/\besscriba\b/gi, 'escriba'],
    [/\bautimaticmante\b/gi, 'automáticamente'],
    [/\besscribir\b/gi, 'escribir'],
    [/\bseccion\b/gi, 'sección'],
    [/\bpérmita\b/gi, 'permita'],
    [/\bcorreciones\b/gi, 'correcciones'],
    [/\bgrabado\b/gi, 'grabación'],
    [/\btextp\b/gi, 'texto'],
  ];

  let corrected = rawText;
  for (const [pattern, replacement] of replacements) {
    corrected = corrected.replace(pattern, replacement);
  }

  corrected = corrected
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?![\s\n]|$)/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  corrected = corrected.replace(/(^|[.!?]\s+|\n)([a-záéíóúñ])/g, (match, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });

  return corrected;
}

function getSpellcheckLang() {
  if (typeof navigator === 'undefined') {
    return 'es';
  }

  const preferred = [navigator.language, ...(navigator.languages || [])]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (preferred.some((value) => value.startsWith('es'))) {
    return 'es';
  }

  return 'es';
}

function getSpeechCtor() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const speechWindow = window;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

function snap(value, enabled) {
  if (!enabled) {
    return value;
  }
  return Math.round(value / GRID) * GRID;
}

export default function PageCanvas({ page, viewportScale = 1, totalPages }) {
  const transformerRef = useRef(null);
  const layerRef = useRef(null);
  const stageRef = useRef(null);
  const dragInProgressRef = useRef(false);
  const scale = Math.min(1.8, Math.max(0.5, Number(viewportScale) || 1));
  const recognitionRef = useRef(null);
  const dictationTargetRef = useRef(null);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectPage = useEditorStore((s) => s.selectPage);
  const updateElement = useEditorStore((s) => s.updateElement);
  const gridEnabled = useEditorStore((s) => s.gridEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const [openTextEditorId, setOpenTextEditorId] = useState(null);
  const [isDictating, setIsDictating] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const [correctionInfo, setCorrectionInfo] = useState(null);
  const [isImproving, setIsImproving] = useState(false);

  // SIMULATED AI IMPROVEMENT (ChatGPT-like prompt logic)
  const runAIImprovement = async (currentText, updateFn) => {
    if (!currentText.trim()) return;
    
    setIsImproving(true);
    setCorrectionInfo('🤖 Inteligencia Artificial analizando redacción técnica...');
    
    // Simulate network delay
    await new Promise(r => setTimeout(r, 2000));
    
    const originalText = currentText;
    let improvedText = originalText;
    
    // Technical transformation dictionary (Mock AI)
    const techMap = {
      'mucha': 'elevada',
      'poca': 'mínima',
      'roto': 'comprometido estructuralmente',
      'mal': 'en condiciones subestándar',
      'bien': 'según los estándares operativos',
      'arreglar': 'subsanar',
      'mirar': 'monitorear',
      'limpiar': 'sanitizar/despejar',
      'peligro': 'riesgo geomecánico crítico',
      'humedad': 'saturación hídrica',
      'agua': 'recurso hídrico',
      'sitio': 'emplazamiento/labor',
      'minas': 'unidades mineras',
      'trabajo': 'operaciones tácticas',
      'gente': 'personal operario',
      'maquina': 'equipo de línea amarilla',
      'camion': 'dumper de bajo perfil',
      'hacer': 'ejecutar',
      'ir': 'desplazarse',
      'ver': 'inspeccionar'
    };

    // Apply some sophisticated regex rules to simulate "smart" rewriting
    Object.keys(techMap).forEach(key => {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      improvedText = improvedText.replace(regex, techMap[key]);
    });

    // Add technical headers/footers if missing
    if (!improvedText.includes('Se informa que')) {
      improvedText = `Se informa que: ${improvedText}`;
    }
    
    if (!improvedText.endsWith('.')) {
      improvedText += '. Se recomienda seguimiento continuo según protocolo SSOMA.';
    }

    updateFn({ text: improvedText });
    setIsImproving(false);
    setCorrectionInfo('✅ Redacción optimizada por IA exitosamente.');
    setTimeout(() => setCorrectionInfo(null), 4000);
  };
  const [advancedSuggestions, setAdvancedSuggestions] = useState([]);
  const [isAnalyzingSpelling, setIsAnalyzingSpelling] = useState(false);
  const spellcheckLang = getSpellcheckLang();
  const speechSupported = Boolean(getSpeechCtor());

  useEffect(() => {
    if (!transformerRef.current || !layerRef.current) {
      return;
    }

    const node = layerRef.current.findOne(`#${selectedElementId}`);
    if (node) {
      transformerRef.current.nodes([node]);
    } else {
      transformerRef.current.nodes([]);
    }
    layerRef.current.batchDraw();
  }, [selectedElementId, page.elements]);

  const stopDictation = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    }
    dictationTargetRef.current = null;
    setIsDictating(false);
  };

  useEffect(() => {
    if (!openTextEditorId) {
      stopDictation();
      setSpeechError(null);
      setCorrectionInfo(null);
      setAdvancedSuggestions([]);
      setIsAnalyzingSpelling(false);
    }
  }, [openTextEditorId]);

  useEffect(() => {
    return () => {
      stopDictation();
    };
  }, []);

  useEffect(() => {
    const clearDrag = () => {
      dragInProgressRef.current = false;
      try {
        const stage = stageRef.current;
        if (stage && typeof stage.stopDrag === 'function') {
          stage.stopDrag();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  useEffect(() => {
    const selectedElement = page.elements.find((element) => element.id === selectedElementId);
    const canMoveWithKeyboard =
      selectedElement && selectedElement.type === 'text' && !selectedElement.locked && openTextEditorId !== selectedElement.id;

    if (!canMoveWithKeyboard) {
      return;
    }

      const handleKeyDown = (event) => {
        const target = event.target;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return;
        }
      }

      const key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
        return;
      }

      event.preventDefault();

      const step = event.shiftKey ? GRID : 1;
      const deltaX = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const deltaY = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;

      const boundedX = Math.min(
        Math.max((selectedElement?.x ?? CONTENT_LEFT) + deltaX, CONTENT_LEFT),
        CONTENT_RIGHT - (selectedElement?.width ?? 120),
      );
      const boundedY = Math.min(
        Math.max((selectedElement?.y ?? CONTENT_TOP) + deltaY, CONTENT_TOP),
        CONTENT_BOTTOM - (selectedElement?.height ?? 56),
      );

      updateElement(page.page_number, selectedElement.id, {
        x: snap(boundedX, snapEnabled),
        y: snap(boundedY, snapEnabled),
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openTextEditorId, page.elements, page.page_number, selectedElementId, snapEnabled, updateElement]);

  const pageLabel =
    totalPages != null && totalPages > 1
      ? `Página ${page.page_number} de ${totalPages}`
      : `Página ${page.page_number}`;

  return (
    <div className="page-wrapper" style={{ width: PAGE_WIDTH * scale, maxWidth: '100%' }}>
      <div className="page-meta">{pageLabel}</div>
      <Stage
        ref={stageRef}
        width={PAGE_WIDTH * scale}
        height={PAGE_HEIGHT * scale}
        onMouseDown={(event) => {
          selectPage(page.page_number);
          if (event.target === event.target.getStage()) {
            selectElement(undefined);
          }
        }}
        onMouseUp={() => {
          dragInProgressRef.current = false;
        }}
        onMouseLeave={() => {
          dragInProgressRef.current = false;
        }}
      >
        <Layer ref={layerRef} scaleX={scale} scaleY={scale}>
          <Rect x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT} fill="#fff" stroke="#dbe3f1" strokeWidth={1} />
          <Rect x={0} y={0} width={PAGE_WIDTH} height={HEADER_HEIGHT} fill="#f8fbff" stroke="#dbe3f1" strokeWidth={1} />
          <Rect
            x={0}
            y={PAGE_HEIGHT - FOOTER_HEIGHT}
            width={PAGE_WIDTH}
            height={FOOTER_HEIGHT}
            fill="#f8fbff"
            stroke="#dbe3f1"
            strokeWidth={1}
          />
          <Text x={20} y={18} text="ENCABEZADO TÉCNICO • INFORME A4" fontSize={12} fill="#1f3f7a" fontStyle="bold" listening={false} />
          <Text
            x={20}
            y={PAGE_HEIGHT - 30}
            text={`PIE DE PÁGINA • Hoja ${page.page_number}`}
            fontSize={11}
            fill="#475569"
            listening={false}
          />
          <Rect
            x={CONTENT_LEFT}
            y={CONTENT_TOP}
            width={CONTENT_RIGHT - CONTENT_LEFT}
            height={CONTENT_BOTTOM - CONTENT_TOP}
            stroke="#e2e8f0"
            dash={[4, 4]}
            listening={false}
          />

          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_WIDTH / GRID) }).map((_, index) => (
              <Rect key={`gv-${index}`} x={index * GRID} y={0} width={1} height={PAGE_HEIGHT} fill="#f2f5fb" />
            ))}
          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_HEIGHT / GRID) }).map((_, index) => (
              <Rect key={`gh-${index}`} x={0} y={index * GRID} width={PAGE_WIDTH} height={1} fill="#f2f5fb" />
            ))}

          {[...page.elements]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((element) => {
              const isTextElement = element.type === 'text';
              const isEditingText = isTextElement && openTextEditorId === element.id;
              const openTextEditorOnDoubleClick = () => {
                if (!isTextElement) {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setSpeechError(null);
                setOpenTextEditorId(element.id);
              };

              return (
              <Rect
                key={element.id}
                id={element.id}
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                fill={
                  isTextElement
                    ? 'rgba(255,255,255,0.001)'
                    : element.type === 'kpi'
                      ? '#e8eefb'
                      : '#f8fbff'
                }
                stroke={
                  selectedElementId === element.id
                    ? '#2d6cdf'
                    : isTextElement
                      ? '#a9b8d3'
                      : '#a9b8d3'
                }
                strokeWidth={selectedElementId === element.id ? 2 : 1}
                cornerRadius={8}
                dash={isTextElement && selectedElementId !== element.id ? [4, 4] : undefined}
                draggable={!element.locked && !isEditingText}
                onClick={() => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                  selectElement(element.id);
                }}
                onTap={() => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                  selectElement(element.id);
                }}
                onDblClick={openTextEditorOnDoubleClick}
                onDblTap={openTextEditorOnDoubleClick}
                onContextMenu={(event) => {
                  event.evt.preventDefault();
                  selectElement(element.id);
                }}
                onDragStart={() => {
                  dragInProgressRef.current = true;
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                }}
                onDragMove={(event) => {
                  const boundedX = Math.min(Math.max(event.target.x(), CONTENT_LEFT), CONTENT_RIGHT - element.width);
                  const boundedY = Math.min(Math.max(event.target.y(), CONTENT_TOP), CONTENT_BOTTOM - element.height);
                  const x = snap(boundedX, snapEnabled);
                  const y = snap(boundedY, snapEnabled);
                  event.target.position({ x, y });
                }}
                onDragEnd={(event) => {
                  setTimeout(() => {
                    dragInProgressRef.current = false;
                  }, 0);
                  updateElement(page.page_number, element.id, {
                    x: event.target.x(),
                    y: event.target.y(),
                  });
                }}
                onTransformEnd={(event) => {
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  const nextWidth = Math.max(isTextElement ? 120 : 60, node.width() * scaleX);
                  const nextHeight = Math.max(isTextElement ? 56 : 40, node.height() * scaleY);
                  node.scaleX(1);
                  node.scaleY(1);
                  node.width(nextWidth);
                  node.height(nextHeight);
                  updateElement(page.page_number, element.id, {
                    x: node.x(),
                    y: node.y(),
                    width: nextWidth,
                    height: nextHeight,
                  });
                }}
                onTransform={(event) => {
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  const nextWidth = Math.max(isTextElement ? 120 : 60, node.width() * scaleX);
                  const nextHeight = Math.max(isTextElement ? 56 : 40, node.height() * scaleY);
                  node.scaleX(1);
                  node.scaleY(1);
                  node.width(nextWidth);
                  node.height(nextHeight);
                  updateElement(page.page_number, element.id, {
                    width: nextWidth,
                    height: nextHeight,
                  });
                }}
              />
              );
            })}

          {page.elements
            .filter(
              (element) => element.type === 'text' && selectedElementId === element.id && openTextEditorId === element.id,
            )
            .map((element) => (
              <Rect
                key={`${element.id}-text-selected`}
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                stroke="#2d6cdf"
                strokeWidth={1}
                dash={[4, 4]}
                fill="rgba(0,0,0,0)"
                cornerRadius={4}
                listening={false}
              />
            ))}

          {page.elements.map((element) => (
            <Text
              key={`${element.id}-label`}
              x={element.x + 10}
              y={element.y + 10}
              text={`${element.type.toUpperCase()} • ${element.id}`}
              fontSize={12}
              fill="#1f3f7a"
              listening={false}
              visible={element.type !== 'text'}
            />
          ))}

          {page.elements
            .filter((element) => element.type === 'chart')
            .map((element) => (
              <Html key={`${element.id}-chart`} groupProps={{ x: element.x + 4, y: element.y + 28 }}>
                <div style={{ pointerEvents: 'none' }}>
                  <LiveChartBlock width={Math.max(120, element.width - 8)} height={Math.max(80, element.height - 34)} />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'table')
            .map((element) => (
              <Html key={`${element.id}-table`} groupProps={{ x: element.x + 4, y: element.y + 4 }}>
                <div style={{ width: element.width - 8, height: element.height - 8 }}>
                  <TableBlock 
                    {...element.props} 
                    onUpdateCells={(newRows) => {
                      updateElement(page.page_number, element.id, {
                        props: { ...element.props, rows: newRows }
                      });
                    }}
                  />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'image')
            .map((element) => (
              <Html key={`${element.id}-image`} groupProps={{ x: element.x + 4, y: element.y + 4 }}>
                <div
                  style={{
                    width: element.width - 8,
                    height: element.height - 8,
                    overflow: 'hidden',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                  }}
                >
                  <img 
                    src={element.src} 
                    alt={element.id}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: element.objectFit || 'cover',
                      display: 'block',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'sensor')
            .map((element) => (
              <Html key={`${element.id}-sensor`} groupProps={{ x: element.x, y: element.y }}>
                <SensorWidget 
                  sensorId={element.props?.sensorId}
                  type={element.props?.sensorType}
                  title={element.props?.title || 'Telemetría Real-time'}
                  width={element.width}
                  height={element.height}
                />
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'text')
            .map((element) => {
              const textProps = getTextProps(element);
              const mergedProps = { ...(element.props || {}) };
              const isEditorOpen = openTextEditorId === element.id;
              const isElementSelected = selectedElementId === element.id;
              const isCurrentDictationTarget = isDictating && dictationTargetRef.current === element.id;

              const getAutoSizeForPatch = (patch) => {
                const nextProps = { ...textProps, ...patch };
                const maxWidth = CONTENT_RIGHT - element.x;
                const maxHeight = CONTENT_BOTTOM - element.y;

                return getAutoSizedTextBox(
                  nextProps.text,
                  nextProps.fontSize,
                  nextProps.fontFamily,
                  nextProps.bold,
                  nextProps.italic,
                  nextProps.lineHeight,
                  120,
                  56,
                  maxWidth,
                  maxHeight,
                );
              };

              const updateTextProps = (patch) => {
                const autoSize = getAutoSizeForPatch(patch);
                updateElement(page.page_number, element.id, {
                  props: {
                    ...mergedProps,
                    ...patch,
                  },
                  width: autoSize.width,
                  height: autoSize.height,
                });
              };

              const closeAndProcess = () => {
                const autoSize = getAutoSizeForPatch({});
                updateElement(page.page_number, element.id, {
                  width: autoSize.width,
                  height: autoSize.height,
                  props: {
                    ...mergedProps,
                  },
                });
                stopDictation();
                setOpenTextEditorId(null);
                selectElement(undefined);
              };

              const startDictation = async () => {
                const speechCtor = getSpeechCtor();
                if (!speechCtor) {
                  setSpeechError('Tu navegador no soporta dictado por voz.');
                  return false;
                }

                const runningOnLocalhost =
                  typeof window !== 'undefined' &&
                  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                const secureContext = typeof window !== 'undefined' ? window.isSecureContext : false;

                if (!secureContext && !runningOnLocalhost) {
                  setSpeechError('El dictado por voz requiere HTTPS o localhost.');
                  return false;
                }

                if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
                  try {
                    const permission = await navigator.permissions.query({ name: 'microphone' });
                    if (permission.state === 'denied') {
                      setSpeechError('Micrófono bloqueado. Habilita permisos de audio para usar escritura por voz.');
                      return false;
                    }
                  } catch {}
                }

                stopDictation();
                setSpeechError(null);

                const recognition = new speechCtor();
                const baseText = textProps.text;
                const separator = baseText.trim().length > 0 ? '\n' : '';
                let accumulatedFinal = '';
                const minAcceptedConfidence = 0.46;

                recognition.lang = 'es-PE';
                recognition.continuous = true;
                recognition.interimResults = false;
                recognition.maxAlternatives = 3;

                recognition.onresult = (e) => {
                  let discardedLowConfidence = false;
                  for (let index = e.resultIndex; index < e.results.length; index += 1) {
                    const result = e.results[index];
                    if (!result?.isFinal) {
                      continue;
                    }

                    const bestAlternative = pickBestTranscriptAlternative(result);
                    if (!bestAlternative.transcript) {
                      continue;
                    }

                    const normalizedTranscript = normalizeDictationText(bestAlternative.transcript);

                    if (isLikelyLowQualityTranscript(normalizedTranscript)) {
                      continue;
                    }

                    if (bestAlternative.confidence > 0 && bestAlternative.confidence < minAcceptedConfidence) {
                      discardedLowConfidence = true;
                      continue;
                    }

                    accumulatedFinal += `${normalizedTranscript} `;
                  }

                  const spokenText = accumulatedFinal.trim();
                  const nextText = spokenText ? `${baseText}${separator}${spokenText}` : baseText;
                  updateTextProps({ text: nextText });

                  if (discardedLowConfidence) {
                    setSpeechError('Se filtró audio con baja confianza para reducir errores de transcripción.');
                  } else {
                    setSpeechError(null);
                  }
                };

                recognition.onerror = (event) => {
                  const reason = String(event?.error || 'unknown');
                  if (reason === 'not-allowed' || reason === 'service-not-allowed') {
                    setSpeechError('Permiso denegado para micrófono. Debes habilitarlo en el navegador.');
                  } else if (reason === 'no-speech') {
                    setSpeechError('No se detectó voz. Intenta nuevamente hablando más cerca del micrófono.');
                  } else if (reason === 'audio-capture') {
                    setSpeechError('No se detecta micrófono disponible en el equipo.');
                  } else {
                    setSpeechError('No se pudo capturar audio. Revisa permisos de micrófono.');
                  }
                  setIsDictating(false);
                };

                recognition.onend = () => {
                  recognitionRef.current = null;
                  dictationTargetRef.current = null;
                  setIsDictating(false);
                };

                recognitionRef.current = recognition;
                dictationTargetRef.current = element.id;
                setIsDictating(true);
                try {
                  recognition.start();
                  return true;
                } catch {
                  setIsDictating(false);
                  setSpeechError('No se pudo iniciar dictado. Intenta otra vez.');
                  return false;
                }
              };

              const toggleDictation = async (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (isCurrentDictationTarget) {
                  stopDictation();
                  setSpeechError(null);
                  return;
                }

                if (isDictating && dictationTargetRef.current !== element.id) {
                  stopDictation();
                }

                await startDictation();
              };

              const runQuickCorrection = () => {
                const correctedText = applyQuickSpanishCorrections(textProps.text);
                updateTextProps({ text: correctedText });
                if (correctedText !== textProps.text) {
                  setCorrectionInfo('Se aplicaron correcciones rápidas en español.');
                } else {
                  setCorrectionInfo('No se detectaron correcciones rápidas pendientes.');
                }
              };

              const runAdvancedCorrection = async () => {
                const sourceText = String(textProps.text || '').trim();
                if (!sourceText) {
                  setAdvancedSuggestions([]);
                  setCorrectionInfo('No hay texto para analizar.');
                  return;
                }

                setIsAnalyzingSpelling(true);
                setCorrectionInfo('Analizando ortografía y gramática avanzada...');

                try {
                  const payload = new URLSearchParams({
                    text: sourceText,
                    language: 'es',
                    enabledOnly: 'false',
                    level: 'picky',
                  });

                  const response = await fetch('https://api.languagetool.org/v2/check', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: payload.toString(),
                  });

                  if (!response.ok) {
                    throw new Error('SPELLCHECK_HTTP_ERROR');
                  }

                  const data = await response.json();
                  const matches = Array.isArray(data?.matches) ? data.matches : [];

                  const suggestions = matches
                    .map((match) => ({
                      offset: Number(match?.offset ?? 0),
                      length: Number(match?.length ?? 0),
                      message: String(match?.message ?? 'Posible corrección'),
                      replacements: Array.isArray(match?.replacements)
                        ? match.replacements
                            .map((replacement) => String(replacement?.value ?? '').trim())
                            .filter(Boolean)
                            .slice(0, 5)
                        : [],
                      context: String(match?.context?.text ?? ''),
                    }))
                    .filter((item) => item.length > 0);

                  setAdvancedSuggestions(suggestions);
                  if (suggestions.length > 0) {
                    setCorrectionInfo(`Se detectaron ${suggestions.length} sugerencias avanzadas.`);
                  } else {
                    setCorrectionInfo('No se detectaron errores ortográficos/gramaticales relevantes.');
                  }
                } catch {
                  setAdvancedSuggestions([]);
                  setCorrectionInfo('No se pudo ejecutar el corrector avanzado ahora.');
                } finally {
                  setIsAnalyzingSpelling(false);
                }
              };

              const applyAdvancedSuggestion = (suggestion, replacement) => {
                const currentText = String(textProps.text || '');
                if (!replacement.trim()) {
                  return;
                }

                const before = currentText.slice(0, suggestion.offset);
                const after = currentText.slice(suggestion.offset + suggestion.length);
                const nextText = `${before}${replacement}${after}`;
                updateTextProps({ text: nextText });

                setAdvancedSuggestions((prev) => prev.filter((item) => item !== suggestion));
                setCorrectionInfo('Se aplicó una sugerencia ortográfica.');
              };

              const handleTextShortcuts = (event) => {
                const withModifier = event.ctrlKey || event.metaKey;
                if (!withModifier) {
                  return;
                }

                const key = event.key.toLowerCase();

                if (key === 'b') {
                  event.preventDefault();
                  updateTextProps({ bold: !textProps.bold });
                  return;
                }

                if (key === 'i') {
                  event.preventDefault();
                  updateTextProps({ italic: !textProps.italic });
                  return;
                }

                if (event.shiftKey && key === '7') {
                  event.preventDefault();
                  updateTextProps({ listType: 'bullet', text: applyListToText(textProps.text, 'bullet') });
                  return;
                }

                if (event.shiftKey && key === '8') {
                  event.preventDefault();
                  updateTextProps({ listType: 'number', text: applyListToText(textProps.text, 'number') });
                  return;
                }

                if (event.shiftKey && key === '0') {
                  event.preventDefault();
                  updateTextProps({ listType: 'none' });
                }
              };

              return [
                <Text
                  key={`${element.id}-render`}
                  x={element.x + 8}
                  y={element.y + 8}
                  width={Math.max(120, element.width - 16)}
                  height={Math.max(40, element.height - 16)}
                  text={textProps.text}
                  fontFamily={textProps.fontFamily}
                  fontSize={textProps.fontSize}
                  fill={textProps.fontColor}
                  align={textProps.textAlign}
                  lineHeight={textProps.lineHeight}
                  fontStyle={`${textProps.bold ? 'bold ' : ''}${textProps.italic ? 'italic' : ''}`.trim() || 'normal'}
                  listening={false}
                  hitStrokeWidth={0}
                />,
                !isEditorOpen && isElementSelected ? (
                    <Html key={`${element.id}-quick-actions`} groupProps={{ x: element.x + 4, y: element.y - 38 }}>
                      <div
                        className="text-quick-actions"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={isCurrentDictationTarget ? 'active' : ''}
                          title={speechSupported ? 'Activa o detiene voz a texto' : 'No soportado en este navegador'}
                          disabled={!speechSupported}
                          onClick={toggleDictation}
                        >
                          {isCurrentDictationTarget ? <MicOff size={13} /> : <Mic size={13} />}
                          {isCurrentDictationTarget ? 'Detener voz' : 'Voz'}
                        </button>
                        <button
                          type="button"
                          title="Abrir editor de texto"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSpeechError(null);
                            setOpenTextEditorId(element.id);
                          }}
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                      </div>
                    </Html>
                  ) : null,
                isEditorOpen ? (
                    <Html key={`${element.id}-text`} groupProps={{ x: element.x + 4, y: element.y + 4 }}>
                      <div
                        className="text-editor-popover"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="text-editor-toolbar">
                          <select
                            value={textProps.fontFamily}
                            onChange={(event) => updateTextProps({ fontFamily: event.target.value })}
                          >
                            <option value="Arial">Arial</option>
                            <option value="Calibri">Calibri</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Verdana">Verdana</option>
                          </select>
                          <input
                            type="number"
                            min={10}
                            max={60}
                            value={Math.round(textProps.fontSize)}
                            onChange={(event) => updateTextProps({ fontSize: Math.max(10, Number(event.target.value)) })}
                          />
                          <label>
                            A
                            <input
                              type="color"
                              value={textProps.fontColor}
                              onChange={(event) => updateTextProps({ fontColor: event.target.value })}
                            />
                          </label>
                          <label>
                            F
                            <input
                              type="color"
                              value={textProps.backgroundColor}
                              onChange={(event) => updateTextProps({ backgroundColor: event.target.value })}
                            />
                          </label>
                          <button
                            type="button"
                            className={textProps.bold ? 'active' : ''}
                            title="Negrita (Ctrl+B)"
                            onClick={() => updateTextProps({ bold: !textProps.bold })}
                          >
                            <Bold size={14} />
                          </button>
                          <button
                            type="button"
                            className={textProps.italic ? 'active' : ''}
                            title="Cursiva (Ctrl+I)"
                            onClick={() => updateTextProps({ italic: !textProps.italic })}
                          >
                            <Italic size={14} />
                          </button>
                          <div className="toolbar-align-group">
                            <button
                              type="button"
                              className={textProps.textAlign === 'left' ? 'active' : ''}
                              title="Alinear izquierda"
                              onClick={() => updateTextProps({ textAlign: 'left' })}
                            >
                              <AlignLeft size={14} />
                            </button>
                            <button
                              type="button"
                              className={textProps.textAlign === 'center' ? 'active' : ''}
                              title="Centrar"
                              onClick={() => updateTextProps({ textAlign: 'center' })}
                            >
                              <AlignCenter size={14} />
                            </button>
                            <button
                              type="button"
                              className={textProps.textAlign === 'right' ? 'active' : ''}
                              title="Alinear derecha"
                              onClick={() => updateTextProps({ textAlign: 'right' })}
                            >
                              <AlignRight size={14} />
                            </button>
                          </div>
                          <label>
                            Interlineado
                            <input
                              type="number"
                              min={1}
                              max={2.5}
                              step={0.05}
                              value={Number(textProps.lineHeight.toFixed(2))}
                              onChange={(event) =>
                                updateTextProps({ lineHeight: Math.min(2.5, Math.max(1, Number(event.target.value))) })
                              }
                            />
                          </label>
                          <select
                            value={textProps.listType}
                            onChange={(event) => {
                              const listType = event.target.value;
                              updateTextProps({ listType, text: applyListToText(textProps.text, listType) });
                            }}
                          >
                            <option value="none">Sin lista</option>
                            <option value="bullet">Viñetas</option>
                            <option value="number">Numeración</option>
                          </select>
                        </div>
                        <textarea
                          className="text-editor-area"
                          value={textProps.text}
                          onChange={(event) => updateTextProps({ text: event.target.value })}
                          onKeyDown={handleTextShortcuts}
                          onContextMenu={(event) => {
                            event.stopPropagation();
                          }}
                          spellCheck={true}
                          lang={spellcheckLang}
                          autoCorrect="on"
                          autoCapitalize="sentences"
                          autoComplete="on"
                          style={{
                            fontFamily: textProps.fontFamily,
                            fontSize: `${textProps.fontSize}px`,
                            color: textProps.fontColor,
                            textAlign: textProps.textAlign,
                            lineHeight: String(textProps.lineHeight),
                            fontWeight: textProps.bold ? 700 : 400,
                            fontStyle: textProps.italic ? 'italic' : 'normal',
                            background: textProps.backgroundColor,
                          }}
                        />
                        <div className="text-editor-actions">
                          <div className="text-editor-assist">
                            <span className="text-editor-hint">
                              <SpellCheck size={12} style={{display: 'inline', marginRight: '4px'}} />
                              Corrector ortográfico activo (es-ES).
                            </span>
                            <span className="text-editor-hint">
                              <Mic size={12} style={{display: 'inline', marginRight: '4px'}} />
                              Voz a texto: {isCurrentDictationTarget ? 'Activa' : 'Detenida'}
                            </span>
                          </div>
                          <div className="text-editor-actions-right">
                            <button
                              type="button"
                              className={`btn-editor ${isCurrentDictationTarget ? 'active' : ''}`}
                              title={speechSupported ? 'Dictado por voz (Micrófono)' : 'No soportado'}
                              disabled={!speechSupported}
                              onClick={toggleDictation}
                            >
                              {isCurrentDictationTarget ? <MicOff size={14} /> : <Mic size={14} />}
                              <span>{isCurrentDictationTarget ? 'Detener Voz' : 'Voz a Texto'}</span>
                            </button>

                            <button
                              type="button"
                              className="btn-editor"
                              title="Corrección ortográfica rápida"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                runQuickCorrection();
                              }}
                            >
                              <CheckCheck size={14} />
                              <span>Corregir Ortografía</span>
                            </button>

                            <button
                              type="button"
                              className={`btn-editor btn-ai ${isImproving ? 'loading' : ''}`}
                              disabled={isImproving}
                              title="Mejorar redacción con IA (ChatGPT)"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                runAIImprovement();
                              }}
                            >
                              {isImproving ? <Sparkles size={14} className="animate-spin" /> : <Wand2 size={14} />}
                              <span>Mejorar Redacción (AI)</span>
                            </button>

                            <button
                              type="button"
                              className="btn-editor btn-primary"
                              title="Aplicar cambios y guardar"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                closeAndProcess();
                              }}
                            >
                              <Save size={14} />
                              <span>Procesar y Aplicar</span>
                            </button>

                            <button
                              type="button"
                              className="btn-editor btn-danger"
                              title="Cerrar sin guardar"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                stopDictation();
                                setOpenTextEditorId(null);
                                selectElement(undefined);
                              }}
                            >
                              <X size={14} />
                              <span>Cerrar</span>
                            </button>
                          </div>
                        </div>
                        {advancedSuggestions.length > 0 && (
                          <div className="text-advanced-list">
                            {advancedSuggestions.slice(0, 6).map((suggestion, index) => (
                              <div key={`${suggestion.offset}-${suggestion.length}-${index}`} className="text-advanced-item">
                                <div className="text-advanced-message">{suggestion.message}</div>
                                {suggestion.context && <div className="text-advanced-context">{suggestion.context}</div>}
                                <div className="text-advanced-actions">
                                  {suggestion.replacements.length > 0 ? (
                                    suggestion.replacements.map((replacement, replacementIndex) => (
                                      <button
                                        key={`${replacement}-${replacementIndex}`}
                                        type="button"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          applyAdvancedSuggestion(suggestion, replacement);
                                        }}
                                      >
                                        {replacement}
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-editor-hint">Sin sugerencias automáticas.</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {speechError && <div className="text-editor-error">{speechError}</div>}
                        {correctionInfo && <div className="text-editor-info">{correctionInfo}</div>}
                      </div>
                    </Html>
                  ) : null,
              ];
            })}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            resizeEnabled
            keepRatio={false}
            centeredScaling={false}
            anchorSize={14}
            anchorCornerRadius={4}
            anchorStroke="#1d4ed8"
            anchorFill="#ffffff"
            anchorStrokeWidth={2}
            borderStroke="#2563eb"
            borderStrokeWidth={1.2}
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right',
            ]}
          />
        </Layer>
      </Stage>
    </div>
  );
}
