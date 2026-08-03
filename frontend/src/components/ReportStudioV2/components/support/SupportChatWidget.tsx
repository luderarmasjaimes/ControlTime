import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Phone, Clipboard, FileText, Sparkles, Lightbulb, Check, FileStack, SpellCheck, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  fetchSupportChatConfig,
  streamSupportChatMessage,
  escalateSupportChatToWhatsapp,
  textCorrectQuick,
} from '../../lib/api';
import { useEditorStore } from '../../store/useEditorStore';
import { getSession } from '../../../../auth/authStorage';
import { resolveMiningUnitName } from '../../lib/sessionChrome';
import { DOCUMENT_TEMPLATES, getTemplateSections, type TemplateSectionDef } from '../../lib/documentTemplates';
import VoiceDictation from '../document/VoiceDictation';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Qualifying {
  name: string;
  company: string;
  topic: string;
  urgency: string;
  description: string;
}

const TOPIC_OPTIONS = [
  'Sensores / telemetría',
  'Reportabilidad / informes',
  'Sismicidad / microsismicidad',
  'Cuenta / accesos',
  'Facturación',
  'Otro',
];
const URGENCY_OPTIONS = ['Baja', 'Media', 'Alta — operación en riesgo'];

const emptyQualifying: Qualifying = { name: '', company: '', topic: TOPIC_OPTIONS[0], urgency: URGENCY_OPTIONS[0], description: '' };

/**
 * Asistente de generación de documentos dentro del chatbot (pedido explícito
 * 2026-08-02): recorre las plantillas de documento ya existentes
 * (lib/documentTemplates.ts) preguntando qué secciones completar y el texto
 * real de cada una -- por teclado o por dictado de voz (VoiceDictation) --
 * con corrector ortográfico opcional (mismo backend LanguageTool que usa el
 * editor, vía textCorrectQuick) antes de generar el documento final en el
 * lienzo (useEditorStore.applyDocumentTemplate).
 */
type WizardStep = 'template' | 'sections' | 'fill' | 'review' | 'confirm';
interface DocWizardState {
  step: WizardStep;
  templateId: string;
  sections: TemplateSectionDef[];
  selectedIds: string[];
  fillIndex: number;
  answers: Record<string, string>;
  draftText: string;
  correcting: boolean;
  correctError: string | null;
}

/** Nombre/empresa/unidad SIEMPRE vienen de la sesión activa, nunca de un
 * campo editable a mano -- pedido explícito 2026-07-29: evita que el
 * usuario escriba datos distintos a los de su cuenta real conectada. */
function qualifyingFromSession(): { name: string; company: string; unit: string } {
  const session = getSession();
  return {
    name: session?.fullName?.trim() || session?.username?.trim() || '',
    company: session?.company?.trim() || '',
    unit: resolveMiningUnitName(session),
  };
}

/**
 * Quita las frases de relleno conversacional con las que el LLM suele abrir
 * ("Claro, aquí tienes...", "Con gusto te comparto...") y cerrar ("¿Necesitas
 * información adicional?", "¿Algo más en que pueda ayudarte?") una respuesta,
 * para que "Copiar al lienzo" inserte solo el contenido real (pedido
 * explícito 2026-07-29). Heurística por líneas: una primera línea que NO
 * empieza con viñeta/número y termina en ":" o arranca con una muletilla de
 * apertura se descarta; una última línea que es una pregunta corta de
 * seguimiento también. Nunca toca el contenido intermedio.
 */
function stripChatBoilerplate(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;

  const introRe = /^(claro|aqu[ií]\s|con gusto|perfecto|por supuesto|te comparto|te dejo|a continuaci[oó]n)/i;
  const listMarkerRe = /^[-*•]|^\d+[.)]/;
  while (start < end) {
    const line = lines[start].trim();
    if (line === '') { start++; continue; }
    const looksLikeIntro = introRe.test(line) || line.endsWith(':');
    if (looksLikeIntro && !listMarkerRe.test(line)) {
      start++;
      continue;
    }
    break;
  }

  const closingRe = /¿.*(ayudarte|informaci[oó]n adicional|algo m[aá]s|puedo hacer|necesitas)/i;
  while (end > start) {
    const line = lines[end - 1].trim();
    if (line === '') { end--; continue; }
    if (closingRe.test(line) && line.length < 100) {
      end--;
      continue;
    }
    break;
  }

  return lines.slice(start, end).join('\n').trim();
}

/**
 * Widget de soporte flotante del módulo Informe Técnico: (1) preguntas de
 * calificación obligatorias antes de habilitar el chat, (2) asistente de IA
 * con contexto minero (Ollama, backend/src/support/mining_chatbot_service.cpp),
 * (3) escalamiento a un asesor humano por WhatsApp Business Cloud API.
 */
export default function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [sessionInfo] = useState(() => qualifyingFromSession());
  const [qualifying, setQualifying] = useState<Qualifying>(() => ({
    ...emptyQualifying,
    name: sessionInfo.name,
    // La empresa/unidad se combinan en un solo campo de contexto para el
    // backend (ver support::buildSystemPrompt) -- en la UI se muestran por
    // separado, ambas de solo lectura (ver bloque "sessionInfo" más abajo).
    company: sessionInfo.unit ? `${sessionInfo.company} — ${sessionInfo.unit}` : sessionInfo.company,
  }));
  const [qualified, setQualified] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalateStatus, setEscalateStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<{ ollama_url_set: boolean; whatsapp_configured: boolean } | null>(null);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const addElement = useEditorStore((s) => s.addElement);
  const selectElement = useEditorStore((s) => s.selectElement);
  const applyDocumentTemplate = useEditorStore((s) => s.applyDocumentTemplate);
  const [wizard, setWizard] = useState<DocWizardState | null>(null);

  useEffect(() => {
    if (!open || config) return;
    fetchSupportChatConfig().then(setConfig).catch(() => setConfig({ ollama_url_set: false, whatsapp_configured: false }));
  }, [open, config]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const qualifyingValid = qualifying.name.trim().length > 1 && qualifying.description.trim().length > 3;

  const startChat = () => {
    setQualified(true);
    setMessages([
      {
        role: 'assistant',
        content: `Hola ${qualifying.name.trim()}, soy el asistente de soporte de Beemetry. Recibí tu consulta sobre "${qualifying.topic}". ¿En qué puedo ayudarte?`,
      },
    ]);
  };

  const sendText = async (text: string) => {
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setSending(true);
    // Mensaje del asistente vacío que se va rellenando fragmento a fragmento
    // a medida que llegan los eventos SSE (efecto "máquina de escribir").
    let assistantStarted = false;
    let gotAnyChunk = false;
    try {
      const result = await streamSupportChatMessage(
        qualifying as unknown as Record<string, string>,
        next,
        (fragment) => {
          gotAnyChunk = true;
          if (!assistantStarted) {
            assistantStarted = true;
            setMessages((prev) => [...prev, { role: 'assistant', content: fragment }]);
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = { ...last, content: last.content + fragment };
              return updated;
            });
          }
        },
      );
      if (!gotAnyChunk || result.error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              'No pude conectarme con el asistente de IA en este momento. Puedes pulsar "Hablar con soporte humano" para escalar por WhatsApp.',
          },
        ]);
      }
    } finally {
      setSending(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendText(text);
  };

  // Menú de acciones al final de cada respuesta del asistente (pedido
  // explícito 2026-07-29): insertar en el lienzo del informe, o pedirle al
  // mismo asistente que resuma/amplíe/sugiera sobre lo que acaba de decir.
  const copyToCanvas = (content: string) => {
    // Deseleccionar ANTES de insertar: si queda seleccionado el bloque de
    // texto de una copia anterior, el store ancla el nuevo bloque a la
    // MISMA posición Y de ese seleccionado (pensado para insertar "en el
    // cursor" como Word) -- eso es justo lo que causaba que cada copia
    // sucesiva cayera exactamente encima de la anterior. Sin selección, cae
    // al flujo automático que apila debajo de todo el contenido existente
    // de la página (zona libre real, nunca se solapa).
    selectElement(undefined);
    addElement('text', { props: { text: stripChatBoilerplate(content), fontSize: 14, lineHeight: 1.35 } });
    setCopiedFlash(true);
    setTimeout(() => setCopiedFlash(false), 1800);
  };
  const askSummarize = () => sendText('Resume tu mensaje anterior en pocas frases, sin perder los datos clave.');
  const askExpand = () => sendText('Amplía tu mensaje anterior con más información técnica relevante sobre el tema, sin repetir lo ya dicho.');
  const askIdeas = () => sendText('Sugiere brevemente otras funciones útiles que esta plataforma podría ofrecer relacionadas con este tema.');

  const escalate = async () => {
    setEscalating(true);
    setEscalateStatus(null);
    try {
      const result = await escalateSupportChatToWhatsapp();
      if (result.status === 'sent') {
        setEscalateStatus('Se notificó a un asesor humano por WhatsApp. Te contactarán en breve.');
      } else {
        setEscalateStatus(
          result.error === 'support_number_not_configured' || result.error === 'whatsapp_not_configured'
            ? 'El escalamiento por WhatsApp aún no está configurado en esta instancia.'
            : 'No se pudo notificar por WhatsApp en este momento. Intenta de nuevo en unos minutos.',
        );
      }
    } finally {
      setEscalating(false);
    }
  };

  // ── Asistente de generación de documentos (pedido explícito 2026-08-02) ──
  const startDocWizard = () => {
    setWizard({
      step: 'template',
      templateId: '',
      sections: [],
      selectedIds: [],
      fillIndex: 0,
      answers: {},
      draftText: '',
      correcting: false,
      correctError: null,
    });
  };
  const cancelDocWizard = () => setWizard(null);

  const chooseWizardTemplate = (templateId: string) => {
    const sections = getTemplateSections(templateId);
    setWizard((w) => (w ? {
      ...w,
      step: 'sections',
      templateId,
      sections,
      selectedIds: sections.map((s) => s.id), // todas preseleccionadas por defecto
    } : w));
  };

  const toggleWizardSection = (id: string) => {
    setWizard((w) => {
      if (!w) return w;
      const has = w.selectedIds.includes(id);
      return { ...w, selectedIds: has ? w.selectedIds.filter((x) => x !== id) : [...w.selectedIds, id] };
    });
  };

  const beginWizardFilling = () => {
    setWizard((w) => {
      if (!w || w.selectedIds.length === 0) return w;
      const first = w.selectedIds[0];
      return { ...w, step: 'fill', fillIndex: 0, draftText: w.answers[first] || '' };
    });
  };

  const currentWizardSection = (): TemplateSectionDef | null => {
    if (!wizard) return null;
    const id = wizard.selectedIds[wizard.fillIndex];
    return wizard.sections.find((s) => s.id === id) || null;
  };

  const goToWizardFillIndex = (index: number) => {
    setWizard((w) => {
      if (!w) return w;
      if (index < 0) return w;
      if (index >= w.selectedIds.length) return { ...w, step: 'review' };
      const id = w.selectedIds[index];
      return { ...w, fillIndex: index, draftText: w.answers[id] || '' };
    });
  };

  const saveWizardSectionAndAdvance = (skip = false) => {
    setWizard((w) => {
      if (!w) return w;
      const id = w.selectedIds[w.fillIndex];
      const answers = skip ? w.answers : { ...w.answers, [id]: w.draftText };
      const nextIndex = w.fillIndex + 1;
      if (nextIndex >= w.selectedIds.length) {
        return { ...w, answers, step: 'review' };
      }
      const nextId = w.selectedIds[nextIndex];
      return { ...w, answers, fillIndex: nextIndex, draftText: answers[nextId] || '' };
    });
  };

  const wizardVoiceChunk = (chunk: string) => {
    setWizard((w) => (w ? { ...w, draftText: `${w.draftText}${w.draftText && !w.draftText.endsWith(' ') ? ' ' : ''}${chunk}` } : w));
  };

  const runWizardSpellcheck = async () => {
    if (!wizard || !wizard.draftText.trim()) return;
    setWizard((w) => (w ? { ...w, correcting: true, correctError: null } : w));
    try {
      const data = await textCorrectQuick(wizard.draftText);
      if (data?.error) {
        setWizard((w) => (w ? { ...w, correcting: false, correctError: 'No se pudo corregir el texto en este momento.' } : w));
        return;
      }
      setWizard((w) => (w ? { ...w, draftText: String(data?.text ?? w.draftText), correcting: false } : w));
    } catch {
      setWizard((w) => (w ? { ...w, correcting: false, correctError: 'No se pudo conectar con el corrector ortográfico.' } : w));
    }
  };

  const generateWizardDocument = () => {
    if (!wizard) return;
    applyDocumentTemplate(wizard.templateId, wizard.answers);
    const meta = DOCUMENT_TEMPLATES.find((t) => t.id === wizard.templateId);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `Listo — generé el documento «${meta?.label || wizard.templateId}» en el lienzo con el contenido que me diste (${wizard.selectedIds.length} sección(es) completada(s)). Puedes seguir editándolo directamente ahí.`,
      },
    ]);
    setWizard(null);
  };

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 9999 }}>
      {open && (
        <div
          style={{
            width: 340,
            height: 460,
            marginBottom: 12,
            borderRadius: 14,
            background: '#0f172a',
            border: '1px solid #334155',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            color: '#e2e8f0',
            fontSize: 13,
          }}
        >
          <div style={{ padding: '10px 12px', background: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' }}>
            <span style={{ fontWeight: 700 }}>Soporte Beemetry</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }} title="Cerrar">
              <X size={16} />
            </button>
          </div>

          {!qualified ? (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                Antes de conectarte con soporte, cuéntanos brevemente qué necesitas:
              </p>
              {/* Nombre/Empresa/Unidad: solo lectura, tomados de la sesión
                  activa -- nunca editables a mano (pedido explícito). */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, padding: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Nombre</span>
                  <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, textAlign: 'right' }}>{sessionInfo.name || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Empresa minera</span>
                  <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, textAlign: 'right' }}>{sessionInfo.company || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Unidad minera</span>
                  <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, textAlign: 'right' }}>{sessionInfo.unit || '—'}</span>
                </div>
              </div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Motivo de consulta</label>
              <select value={qualifying.topic} onChange={(e) => setQualifying({ ...qualifying, topic: e.target.value })} style={inputStyle}>
                {TOPIC_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Urgencia</label>
              <select value={qualifying.urgency} onChange={(e) => setQualifying({ ...qualifying, urgency: e.target.value })} style={inputStyle}>
                {URGENCY_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Descripción breve</label>
              <textarea
                value={qualifying.description}
                onChange={(e) => setQualifying({ ...qualifying, description: e.target.value })}
                style={{ ...inputStyle, height: 60, resize: 'none' }}
                placeholder="¿Qué necesitas resolver?"
              />
              <button
                onClick={startChat}
                disabled={!qualifyingValid}
                style={{
                  marginTop: 4,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: 'none',
                  background: qualifyingValid ? '#0ea5e9' : '#334155',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: qualifyingValid ? 'pointer' : 'not-allowed',
                }}
              >
                Iniciar chat
              </button>
            </div>
          ) : wizard ? (
            <DocWizardPanel
              wizard={wizard}
              onChooseTemplate={chooseWizardTemplate}
              onToggleSection={toggleWizardSection}
              onBeginFilling={beginWizardFilling}
              onCancel={cancelDocWizard}
              onDraftChange={(text) => setWizard((w) => (w ? { ...w, draftText: text } : w))}
              onVoiceChunk={wizardVoiceChunk}
              onSpellcheck={runWizardSpellcheck}
              onNext={() => saveWizardSectionAndAdvance(false)}
              onSkip={() => saveWizardSectionAndAdvance(true)}
              onBack={() => goToWizardFillIndex(wizard.fillIndex - 1)}
              onBackToSections={() => setWizard((w) => (w ? { ...w, step: 'sections' } : w))}
              currentSection={currentWizardSection()}
              onGenerate={generateWizardDocument}
            />
          ) : (
            <>
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.map((m, i) => {
                  const isLastAssistant = m.role === 'assistant' && i === messages.length - 1;
                  return (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      <div
                        style={{
                          background: m.role === 'user' ? '#0369a1' : '#1e293b',
                          borderRadius: 10,
                          padding: '6px 10px',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {m.content}
                      </div>
                      {isLastAssistant && !sending && m.content && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          <button onClick={() => copyToCanvas(m.content)} title="Copiar el texto al lienzo del editor" style={chipStyle}>
                            {copiedFlash ? <Check size={11} /> : <Clipboard size={11} />} Copiar al lienzo
                          </button>
                          <button onClick={askSummarize} title="Resumir este contenido" style={chipStyle}>
                            <FileText size={11} /> Resumir
                          </button>
                          <button onClick={askExpand} title="Ampliar con más información relevante" style={chipStyle}>
                            <Sparkles size={11} /> Ampliar
                          </button>
                          <button onClick={askIdeas} title="Ideas de otras funciones útiles" style={chipStyle}>
                            <Lightbulb size={11} /> Ideas
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {sending && <div style={{ color: '#64748b', fontSize: 11 }}>Escribiendo…</div>}
              </div>
              {escalateStatus && (
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #334155' }}>{escalateStatus}</div>
              )}
              <div style={{ padding: 8, borderTop: '1px solid #334155', display: 'flex', gap: 6 }}>
                <button
                  onClick={escalate}
                  disabled={escalating}
                  title="Notificar a un asesor humano por WhatsApp"
                  style={{ background: '#059669', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                >
                  <Phone size={13} /> WhatsApp
                </button>
                <button
                  onClick={startDocWizard}
                  title="Generar un documento (informe técnico, propuesta, etc.) con tu ayuda, sección por sección"
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                >
                  <FileStack size={13} /> Documento
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Escribe tu mensaje..."
                  style={{ ...inputStyle, flex: 1, margin: 0 }}
                />
                <button onClick={send} disabled={sending} style={{ background: '#0ea5e9', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 10px', cursor: 'pointer' }}>
                  <Send size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title="Soporte Beemetry"
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: 'none',
          background: '#0ea5e9',
          color: '#fff',
          boxShadow: '0 6px 18px rgba(14,165,233,0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}

interface DocWizardPanelProps {
  wizard: DocWizardState;
  onChooseTemplate: (id: string) => void;
  onToggleSection: (id: string) => void;
  onBeginFilling: () => void;
  onCancel: () => void;
  onDraftChange: (text: string) => void;
  onVoiceChunk: (chunk: string) => void;
  onSpellcheck: () => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  onBackToSections: () => void;
  currentSection: TemplateSectionDef | null;
  onGenerate: () => void;
}

/** Panel del asistente paso a paso: elegir plantilla → elegir secciones →
 * completar cada sección (texto/voz/corrector) → revisar → generar. Vive
 * dentro del mismo panel de chat, reemplazando la lista de mensajes mientras
 * está activo (ver `wizard` en el componente padre). */
function DocWizardPanel({
  wizard, onChooseTemplate, onToggleSection, onBeginFilling, onCancel,
  onDraftChange, onVoiceChunk, onSpellcheck, onNext, onSkip, onBack, onBackToSections,
  currentSection, onGenerate,
}: DocWizardPanelProps) {
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const meta = DOCUMENT_TEMPLATES.find((t) => t.id === wizard.templateId);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#c4b5fd' }}>
          <FileStack size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          Generar documento
        </span>
        <button onClick={onCancel} title="Cancelar asistente" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>

      {wizard.step === 'template' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>¿Qué documento quieres generar?</p>
          {DOCUMENT_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onChooseTemplate(t.id)}
              style={{ textAlign: 'left', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, fontSize: 12 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{t.description}</div>
            </button>
          ))}
        </>
      )}

      {wizard.step === 'sections' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>
            <strong style={{ color: '#e2e8f0' }}>{meta?.label}</strong> — elige qué secciones quieres completar tú mismo (las demás usan el texto de ejemplo, editable luego en el lienzo):
          </p>
          {wizard.sections.length === 0 ? (
            <p style={{ fontSize: 11, color: '#64748b' }}>Esta plantilla no tiene secciones configurables por el asistente — puedes generarla directamente y editarla en el lienzo.</p>
          ) : (
            wizard.sections.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={wizard.selectedIds.includes(s.id)} onChange={() => onToggleSection(s.id)} style={{ marginTop: 2 }} />
                <span>{s.label}</span>
              </label>
            ))
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={onCancel} style={{ ...ghostBtnStyle, flex: 1 }}>Cancelar</button>
            {wizard.selectedIds.length > 0 ? (
              <button onClick={onBeginFilling} style={{ ...primaryBtnStyle, flex: 1 }}>Continuar</button>
            ) : (
              <button onClick={onGenerate} style={{ ...primaryBtnStyle, flex: 1 }}>Generar sin completar</button>
            )}
          </div>
        </>
      )}

      {wizard.step === 'fill' && currentSection && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>
            Sección {wizard.fillIndex + 1} de {wizard.selectedIds.length}
          </p>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#e2e8f0' }}>{currentSection.label}</div>
          <textarea
            value={wizard.draftText}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={currentSection.kind === 'bullets' ? 'Un punto por línea...' : 'Escribe el contenido de esta sección...'}
            style={{ ...inputStyle, height: 90, resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <VoiceDictation compact onTranscriptUpdate={onVoiceChunk} language="es-PE" />
            <button
              onClick={onSpellcheck}
              disabled={wizard.correcting || !wizard.draftText.trim()}
              title="Corrector ortográfico sobre el texto de esta sección"
              style={{ ...ghostBtnStyle, display: 'flex', alignItems: 'center', gap: 4, opacity: wizard.correcting || !wizard.draftText.trim() ? 0.5 : 1 }}
            >
              <SpellCheck size={12} /> {wizard.correcting ? 'Corrigiendo…' : 'Corrector ortográfico'}
            </button>
          </div>
          {wizard.correctError && <span style={{ fontSize: 10, color: '#f87171' }}>{wizard.correctError}</span>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={wizard.fillIndex === 0 ? onBackToSections : onBack} style={{ ...ghostBtnStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ArrowLeft size={12} /> Atrás
            </button>
            <button onClick={onSkip} style={{ ...ghostBtnStyle, flex: 1 }}>Omitir</button>
            <button onClick={onNext} style={{ ...primaryBtnStyle, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {wizard.fillIndex + 1 >= wizard.selectedIds.length ? 'Terminar' : 'Siguiente'} <ArrowRight size={12} />
            </button>
          </div>
        </>
      )}

      {wizard.step === 'review' && !confirmGenerate && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>
            Revisa el contenido antes de generar <strong style={{ color: '#e2e8f0' }}>{meta?.label}</strong>:
          </p>
          {wizard.sections.filter((s) => wizard.selectedIds.includes(s.id)).map((s) => (
            <div key={s.id} style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd' }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', marginTop: 2 }}>
                {wizard.answers[s.id]?.trim() ? wizard.answers[s.id] : <em style={{ color: '#64748b' }}>(se usará el texto de ejemplo — editable luego en el lienzo)</em>}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={onCancel} style={{ ...ghostBtnStyle, flex: 1 }}>Cancelar</button>
            <button onClick={() => setConfirmGenerate(true)} style={{ ...primaryBtnStyle, flex: 1 }}>Generar documento</button>
          </div>
        </>
      )}

      {wizard.step === 'review' && confirmGenerate && (
        <>
          <p style={{ margin: 0, fontSize: 12, color: '#fca5a5' }}>
            Esto reemplazará todo el contenido actual del informe por la plantilla «{meta?.label}» con el texto que ingresaste. No se puede deshacer con Ctrl+Z página por página.
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => setConfirmGenerate(false)} style={{ ...ghostBtnStyle, flex: 1 }}>Cancelar</button>
            <button onClick={onGenerate} style={{ ...primaryBtnStyle, flex: 1, background: '#dc2626' }}>Reemplazar documento</button>
          </div>
        </>
      )}
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  background: '#7c3aed',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: 11,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '6px 8px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: '#0f2b3d',
  border: '1px solid #155e75',
  borderRadius: 999,
  color: '#67e8f9',
  padding: '3px 8px',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
};
