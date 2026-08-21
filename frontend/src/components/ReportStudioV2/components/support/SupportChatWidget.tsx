import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Phone, Clipboard, FileText, Sparkles, Lightbulb, Check, FileStack, SpellCheck, ArrowLeft, ArrowRight, Presentation, Smile, Paperclip, AlertCircle, Download } from 'lucide-react';
import {
  fetchSupportChatConfig,
  streamSupportChatMessage,
  escalateSupportChatToWhatsapp,
  createSupportTicket,
  uploadChatAttachment,
  submitWebCv,
  chatAttachmentUrl,
  textCorrectQuick,
  ALLOWED_CHAT_ATTACHMENT_EXT,
  type SupportChatIntent,
  type SupportChatMessage,
  type SupportTicketCategory,
} from '../../lib/api';
import { useEditorStore } from '../../store/useEditorStore';
import { getSession } from '../../../../auth/authStorage';
import { resolveMiningUnitName } from '../../lib/sessionChrome';
import { DOCUMENT_TEMPLATES, getTemplateSections, type TemplateSectionDef } from '../../lib/documentTemplates';
import VoiceDictation from '../document/VoiceDictation';
import EmojiPicker from './EmojiPicker';

type ChatMessage = SupportChatMessage;

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

/**
 * Menú de WhatsApp del widget web (ADR-129) -- mismas 9 opciones y mismo
 * texto que el menú raíz REAL del bot de WhatsApp (menuRootBodyText() en
 * whatsapp_menu.cpp), para que la experiencia sea consistente entre canales.
 * A diferencia del bot (que resuelve un dígito/palabra contra
 * resolveRootMenuChoice), acá cada opción es un botón -- pero el DESTINO de
 * cada una sigue el mismo criterio: "stay_chat"/"doc_wizard" resuelven sin
 * salir de la conversación con la IA; "describe" pide un detalle breve y
 * crea un support_ticket (POST /api/support/tickets, reservado para uso
 * web desde ADR-112); "rrhh_submenu" abre el sub-flujo de RRHH (CV vs otra
 * consulta, igual que sendRrhhSubmenu en el bot). `escalate:true` es
 * exactamente el pedido explícito de la sesión: SOLO Comercial, Reclamos,
 * Emergencia y Hablar-con-agente notifican de inmediato a un asesor humano
 * por WhatsApp (mensaje "Se notificó..."); Agenda y RRHH-otra-consulta
 * quedan registrados como ticket pero sin ese mensaje (no son threading de
 * "necesito a alguien AHORA").
 */
type WaRootAction =
  | { kind: 'stay_chat' }
  | { kind: 'doc_wizard' }
  | { kind: 'rrhh_submenu' }
  | { kind: 'describe'; category: SupportTicketCategory; priority: 'baja' | 'media' | 'alta'; escalate: boolean };

interface WaRootMenuItem {
  id: string;
  label: string;
  desc: string;
  action: WaRootAction;
}

const WA_ROOT_MENU: WaRootMenuItem[] = [
  { id: 'soporte', label: '🛠️ Soporte técnico', desc: 'Reporta un problema técnico o pregúntale a la IA', action: { kind: 'stay_chat' } },
  { id: 'comercial', label: '💼 Área comercial', desc: 'Ventas y cotizaciones', action: { kind: 'describe', category: 'comercial', priority: 'media', escalate: true } },
  { id: 'reclamos', label: '📋 Gestión de reclamos', desc: 'Registra un reclamo y recibe un código', action: { kind: 'describe', category: 'reclamo', priority: 'media', escalate: true } },
  { id: 'documentos', label: '📄 Generación de documentos', desc: 'Plantillas Word y PowerPoint', action: { kind: 'doc_wizard' } },
  { id: 'ia', label: '🤖 Consultas a la IA', desc: 'Pregunta lo que necesites en este chat', action: { kind: 'stay_chat' } },
  { id: 'emergencia', label: '🚨 Emergencia', desc: 'Atención prioritaria inmediata', action: { kind: 'describe', category: 'soporte', priority: 'alta', escalate: true } },
  { id: 'agenda', label: '🗓️ Agendar visita técnica', desc: 'Coordina una visita en campo', action: { kind: 'describe', category: 'agenda', priority: 'media', escalate: false } },
  { id: 'rrhh', label: '🧑‍💼 Recursos Humanos', desc: 'Enviar CV, planillas, certificados', action: { kind: 'rrhh_submenu' } },
  { id: 'agente', label: '👤 Hablar con un agente', desc: 'Canales directos de atención', action: { kind: 'describe', category: 'soporte', priority: 'media', escalate: true } },
];

type WaFlowState =
  | { step: 'menu' }
  | { step: 'rrhh_choice' }
  | { step: 'rrhh_cv_upload'; uploading: boolean; error: string | null }
  | {
      step: 'describe';
      category: SupportTicketCategory;
      label: string;
      priority: 'baja' | 'media' | 'alta';
      escalateAfter: boolean;
      description: string;
      submitting: boolean;
      error: string | null;
    };

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
  const [escalateStatus, setEscalateStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<{ ollama_url_set: boolean; whatsapp_configured: boolean } | null>(null);
  const [copiedFlash, setCopiedFlash] = useState(false);
  // conversation_id que devuelve el backend en el primer turno -- se reenvía
  // en los turnos siguientes de la MISMA conversación (mientras el widget no
  // se reinicie / no se cierre y se vuelva a "Iniciar chat") para que el
  // backend pueda agrupar el historial completo bajo un mismo id.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Input real del mensaje en edición (ligado a `draft`/`setDraft`) -- se
  // necesita la referencia al elemento para insertar el emoji elegido en la
  // posición exacta del cursor (selectionStart/selectionEnd), no solo al
  // final del texto.
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const addElement = useEditorStore((s) => s.addElement);
  const selectElement = useEditorStore((s) => s.selectElement);
  const applyDocumentTemplate = useEditorStore((s) => s.applyDocumentTemplate);
  const [wizard, setWizard] = useState<DocWizardState | null>(null);
  // Menú de WhatsApp del widget (ADR-129) -- ver WA_ROOT_MENU/WaFlowState más
  // arriba. Reemplaza la lista de mensajes mientras está activo, mismo patrón
  // que `wizard`.
  const [waFlow, setWaFlow] = useState<WaFlowState | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [spellchecking, setSpellchecking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setConversationId(null);
    setMessages([
      {
        role: 'assistant',
        content: `Hola ${qualifying.name.trim()}, soy el asistente de soporte de Beemetry. Recibí tu consulta sobre "${qualifying.topic}". ¿En qué puedo ayudarte?`,
        isWelcome: true,
      },
    ]);
  };

  /**
   * @param text        lo que se muestra en la burbuja del usuario.
   * @param promptText  lo que se envía realmente al modelo (por defecto `text`).
   *                    Los chips lo usan para incrustar el texto a procesar.
   * @param intent      presupuesto de tokens de la respuesta en el backend.
   * @param extra       campos adicionales a fusionar en el mensaje de usuario
   *                    (p.ej. metadatos de adjunto -- ver handleAttachFile).
   */
  const sendText = async (
    text: string,
    { promptText, intent = 'chat', extra }: { promptText?: string; intent?: SupportChatIntent; extra?: Partial<ChatMessage> } = {},
  ) => {
    if (!text || sending) return;
    const userMessage: ChatMessage = { role: 'user', content: text, ...extra };
    if (promptText && promptText !== text) userMessage.promptContent = promptText;
    // Los avisos locales de error ("No pude conectarme…") se descartan del
    // historial: son de la UI, no turnos del asistente. Si viajaban al backend
    // el modelo los leía como algo que él mismo había dicho.
    const next: ChatMessage[] = [...messages.filter((m) => !m.transient), userMessage];
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
        intent,
        { conversationId: conversationId ?? undefined },
      );
      // El backend devuelve `conversation_id` en el primer turno -- se guarda
      // para reenviarlo en los siguientes turnos de esta misma conversación
      // (mientras el widget siga abierto/no se reinicie el chat, ver startChat).
      if (result.conversationId && result.conversationId !== conversationId) {
        setConversationId(result.conversationId);
      }
      if (!gotAnyChunk || result.error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            transient: true,
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

  /**
   * Inserta el emoji elegido en la posición EXACTA del cursor del input de
   * mensaje (no solo al final) usando selectionStart/selectionEnd, y devuelve
   * el foco + cursor al input justo después del emoji insertado -- así se
   * pueden encadenar varios emojis seguidos sin perder el punto de escritura.
   * El picker NO se cierra al seleccionar (se cierra por click-outside o el
   * botón X del propio picker) a propósito, por la misma razón.
   */
  const insertEmojiAtCursor = (emoji: string) => {
    const el = chatInputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    const cursor = start + emoji.length;
    // El value del input se actualiza en el próximo render (setDraft es
    // asíncrono) -- se difiere el reposicionamiento del cursor un tick para
    // que ya exista el texto nuevo cuando se llama a setSelectionRange.
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    }, 0);
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
  /**
   * Los tres chips envían el texto sobre el que hay que operar INCRUSTADO en
   * la petición, en vez de referirse a él como "tu mensaje anterior".
   *
   * Corrección 2026-08-03: la referencia indirecta obligaba al modelo a
   * localizar el turno correcto dentro del historial, y bastaba con que el
   * prompt se recortara (o con que el modelo se despistara: en producción
   * corre gemma2:2b, 2B de parámetros) para que resumiera o ampliara otra
   * cosa -- el "no funciona el resumen / la ampliación" reportado. Con el
   * texto incrustado la operación es autocontenida y no depende del historial.
   * La burbuja del usuario sigue mostrando solo la etiqueta corta.
   */
  const CHIP_TEXT_LIMIT = 6000;
  const targetText = (content: string) => stripChatBoilerplate(content).slice(0, CHIP_TEXT_LIMIT);

  const askSummarize = (content: string) =>
    sendText('Resumir la respuesta anterior', {
      intent: 'summarize',
      promptText:
        'Resume en 3 a 5 frases el texto delimitado más abajo, conservando los datos numéricos, ' +
        'nombres de sensores, zonas y fechas que aparezcan. No añadas información que no esté en ' +
        'el texto. Responde solo con el resumen.\n\n<<<TEXTO>>>\n' + targetText(content) + '\n<<<FIN>>>',
    });

  const askExpand = (content: string) =>
    sendText('Ampliar la respuesta anterior', {
      intent: 'expand',
      promptText:
        'Amplía el texto delimitado más abajo con más información técnica relevante sobre el mismo ' +
        'tema (causas, criterios y umbrales habituales, buenas prácticas de monitoreo minero), sin ' +
        'repetir lo ya dicho y sin inventar datos de la cuenta que no aparezcan en el texto. ' +
        'Responde solo con el texto ampliado.\n\n<<<TEXTO>>>\n' + targetText(content) + '\n<<<FIN>>>',
    });

  const askIdeas = (content: string) =>
    sendText('Ideas relacionadas', {
      intent: 'ideas',
      promptText:
        'A partir del texto delimitado más abajo, sugiere en viñetas breves otras funciones útiles ' +
        'que esta plataforma de monitoreo minero podría ofrecer sobre ese mismo tema. Responde solo ' +
        'con las viñetas.\n\n<<<TEXTO>>>\n' + targetText(content) + '\n<<<FIN>>>',
    });

  // ── Menú de WhatsApp del widget (ADR-129) ──────────────────────────────
  // Antes, el botón "WhatsApp" disparaba un único mensaje de escalamiento
  // genérico de inmediato. Pedido explícito de la sesión: debe mostrar el
  // mismo menú de 9 opciones que el bot real de WhatsApp, y el mensaje "Se
  // notificó a un asesor humano" solo debe aparecer TRAS llegar a una opción
  // que de verdad requiere contacto humano (comercial/reclamos/emergencia/
  // hablar con agente), nunca al abrir el menú.
  const openWaMenu = () => {
    setEscalateStatus(null);
    setWaFlow({ step: 'menu' });
  };
  const closeWaFlow = () => setWaFlow(null);

  const chooseWaRootAction = (item: WaRootMenuItem) => {
    switch (item.action.kind) {
      case 'stay_chat':
        setWaFlow(null);
        break;
      case 'doc_wizard':
        setWaFlow(null);
        startDocWizard();
        break;
      case 'rrhh_submenu':
        setWaFlow({ step: 'rrhh_choice' });
        break;
      case 'describe':
        setWaFlow({
          step: 'describe',
          category: item.action.category,
          label: item.label.replace(/^\S+\s/, ''), // quita el emoji inicial para el subject del ticket
          priority: item.action.priority,
          escalateAfter: item.action.escalate,
          description: '',
          submitting: false,
          error: null,
        });
        break;
    }
  };

  const submitWaDescribe = async () => {
    if (waFlow?.step !== 'describe' || !waFlow.description.trim() || waFlow.submitting) return;
    setWaFlow({ ...waFlow, submitting: true, error: null });
    const result = await createSupportTicket({
      category: waFlow.category,
      description: waFlow.description.trim(),
      subject: waFlow.label,
      priority: waFlow.priority,
      contact_name: qualifying.name.trim(),
    });
    if (result.error || !result.code) {
      setWaFlow((w) => (w?.step === 'describe' ? { ...w, submitting: false, error: 'No se pudo registrar tu solicitud. Intenta de nuevo.' } : w));
      return;
    }
    if (waFlow.escalateAfter) {
      const esc = await escalateSupportChatToWhatsapp();
      setEscalateStatus(
        esc.status === 'sent'
          ? `Se notificó a un asesor humano por WhatsApp. Código de seguimiento: ${result.code}. Te contactarán en breve.`
          : `Tu solicitud quedó registrada (código ${result.code}), pero no se pudo notificar por WhatsApp en este momento.`,
      );
    } else {
      setEscalateStatus(`Tu solicitud quedó registrada. Código de seguimiento: ${result.code}. Nuestro equipo la revisará.`);
    }
    setWaFlow(null);
  };

  const handleRrhhCvFile = async (file: File) => {
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (!['.docx', '.pptx', '.pdf'].includes(ext)) {
      setWaFlow((w) => (w?.step === 'rrhh_cv_upload' ? { ...w, error: 'Formato no soportado para el CV. Solo se aceptan .docx, .pptx o .pdf.' } : w));
      return;
    }
    setWaFlow({ step: 'rrhh_cv_upload', uploading: true, error: null });
    const result = await submitWebCv(file);
    if (result.error || !result.submission_id) {
      setWaFlow({ step: 'rrhh_cv_upload', uploading: false, error: 'No se pudo procesar tu CV. Intenta de nuevo en unos minutos.' });
      return;
    }
    const scoreNote = result.profile_preview?.score != null ? ` (puntaje de triaje IA: ${result.profile_preview.score}/100)` : '';
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          `✅ Recibimos tu CV (${file.name})${scoreNote}. Nuestro equipo de RRHH lo revisará y se pondrá en contacto ` +
          'contigo si tu perfil encaja con una posición disponible.',
      },
    ]);
    setWaFlow(null);
  };

  // ── Adjuntar archivo en el chat (ADR-129) ──────────────────────────────
  // docx/pptx/pdf/jpg/png -- cualquier otro tipo se rechaza en el propio
  // navegador (nunca llega a pedirse la subida). jpg/png pasan por QR+OCR en
  // el backend (ver uploadChatAttachment) y ese texto se incrusta como
  // contexto de la siguiente pregunta a la IA -- el modelo de chat es de
  // solo texto, así es como el usuario puede "preguntar sobre la imagen".
  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo después
    if (!file) return;
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (!ALLOWED_CHAT_ATTACHMENT_EXT.includes(ext)) {
      setAttachError('Tipo de archivo no soportado. Solo se aceptan DOCX, PPTX, PDF, JPG y PNG.');
      window.setTimeout(() => setAttachError(null), 5000);
      return;
    }
    setAttaching(true);
    setAttachError(null);
    const result = await uploadChatAttachment(file, conversationId ?? undefined);
    setAttaching(false);
    if (result.error || !result.attachment_id) {
      setAttachError('No se pudo subir el archivo. Intenta de nuevo.');
      window.setTimeout(() => setAttachError(null), 5000);
      return;
    }
    const isImage = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
    const extra: Partial<ChatMessage> = {
      attachmentId: result.attachment_id,
      attachmentFilename: file.name,
      attachmentMimeType: result.mime_type,
    };
    const caption = `📎 ${file.name}`;

    if (!isImage) {
      // docx/pptx/pdf: no hay nada que un modelo de solo texto pueda "leer"
      // de un archivo sin extraer texto primero -- se deja el adjunto visible
      // en el historial (descargable) sin disparar un turno de IA.
      setMessages((prev) => [...prev.filter((m) => !m.transient), { role: 'user', content: caption, ...extra }]);
      return;
    }

    // jpg/png: dispara un turno de IA para que confirme lo detectado
    // (QR/OCR, ver uploadChatAttachment) en la misma conversación.
    const detected = [result.ocr_text, ...(result.qr_codes || [])].filter((s) => s && s.trim());
    const context = detected.length
      ? 'Contenido detectado automáticamente en la imagen (OCR/QR, puede tener errores):\n' + detected.join('\n')
      : 'No se detectó texto ni código QR legible en la imagen.';
    await sendText(caption, {
      extra,
      promptText:
        `El usuario adjuntó una imagen ("${file.name}") en el chat.\n${context}\n` +
        'Responde confirmando brevemente qué detectaste (o que no detectaste nada legible) y ofrece ayuda sobre ese contenido.',
    });
  };

  // ── Corrector ortográfico del input principal (mismo backend LanguageTool
  // que ya usa el asistente de documentos, ver runWizardSpellcheck) ──
  const runMainSpellcheck = async () => {
    if (!draft.trim() || spellchecking) return;
    setSpellchecking(true);
    try {
      const data = await textCorrectQuick(draft);
      if (!data?.error && data?.text) setDraft(String(data.text));
    } finally {
      setSpellchecking(false);
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
            width: 420,
            height: 480,
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
          ) : waFlow ? (
            <WaFlowPanel
              flow={waFlow}
              onChooseRoot={chooseWaRootAction}
              onCancel={closeWaFlow}
              onBackToMenu={() => setWaFlow({ step: 'menu' })}
              onChooseRrhhCv={() => setWaFlow({ step: 'rrhh_cv_upload', uploading: false, error: null })}
              onChooseRrhhOther={() =>
                setWaFlow({
                  step: 'describe',
                  category: 'rrhh',
                  label: 'Recursos Humanos',
                  priority: 'media',
                  escalateAfter: false,
                  description: '',
                  submitting: false,
                  error: null,
                })
              }
              onRrhhCvFile={handleRrhhCvFile}
              onDescribeChange={(text) => setWaFlow((w) => (w?.step === 'describe' ? { ...w, description: text } : w))}
              onSubmitDescribe={submitWaDescribe}
            />
          ) : (
            <>
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.map((m, i) => {
                  // Los avisos locales (error de conexión) y el saludo inicial no llevan
                  // acciones: no hay nada que copiar, resumir ni ampliar en ellos. Los chips
                  // solo tienen sentido sobre respuestas reales del modelo a una consulta.
                  const isLastAssistant =
                    m.role === 'assistant' && !m.transient && !m.isWelcome && i === messages.length - 1;
                  const isImageAttachment = m.attachmentMimeType === 'image/jpeg' || m.attachmentMimeType === 'image/png';
                  return (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      {m.attachmentId && isImageAttachment && (
                        <img
                          src={chatAttachmentUrl(m.attachmentId)}
                          alt={m.attachmentFilename || 'imagen adjunta'}
                          style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 8, display: 'block', marginBottom: 4 }}
                        />
                      )}
                      {m.attachmentId && !isImageAttachment && (
                        <a
                          href={chatAttachmentUrl(m.attachmentId)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 11, color: '#7dd3fc', textDecoration: 'none' }}
                          title="Descargar adjunto"
                        >
                          <FileText size={12} /> {m.attachmentFilename} <Download size={11} />
                        </a>
                      )}
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
                          <button onClick={() => askSummarize(m.content)} title="Resumir este contenido" style={chipStyle}>
                            <FileText size={11} /> Resumir
                          </button>
                          <button onClick={() => askExpand(m.content)} title="Ampliar con más información relevante" style={chipStyle}>
                            <Sparkles size={11} /> Ampliar
                          </button>
                          <button onClick={() => askIdeas(m.content)} title="Ideas de otras funciones útiles" style={chipStyle}>
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
              {attachError && (
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#fca5a5', borderTop: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={12} /> {attachError}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_CHAT_ATTACHMENT_EXT.join(',')}
                onChange={handleAttachFile}
                style={{ display: 'none' }}
              />
              <div style={{ padding: '8px 8px 4px', borderTop: '1px solid #334155', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={openWaMenu}
                  title="Soporte por WhatsApp: soporte técnico, comercial, reclamos, emergencias y más"
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
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attaching}
                  title="Adjuntar archivo (DOCX, PPTX, PDF, JPG, PNG)"
                  style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 8px', cursor: attaching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: attaching ? 0.6 : 1 }}
                >
                  <Paperclip size={14} /> {attaching ? 'Subiendo…' : ''}
                </button>
                <div style={{ position: 'relative', display: 'flex' }}>
                  <button
                    onClick={() => setEmojiPickerOpen((v) => !v)}
                    title="Insertar emoji"
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <Smile size={14} />
                  </button>
                  {emojiPickerOpen && (
                    <EmojiPicker
                      onSelect={insertEmojiAtCursor}
                      onClose={() => setEmojiPickerOpen(false)}
                    />
                  )}
                </div>
                <VoiceDictation compact onTranscriptUpdate={(chunk) => setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}${chunk}`)} language="es-PE" />
                <button
                  onClick={runMainSpellcheck}
                  disabled={spellchecking || !draft.trim()}
                  title="Corrector ortográfico"
                  style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 8px', cursor: spellchecking || !draft.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', opacity: spellchecking || !draft.trim() ? 0.5 : 1 }}
                >
                  <SpellCheck size={14} />
                </button>
              </div>
              <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 6 }}>
                <input
                  ref={chatInputRef}
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

interface WaFlowPanelProps {
  flow: WaFlowState;
  onChooseRoot: (item: WaRootMenuItem) => void;
  onCancel: () => void;
  onBackToMenu: () => void;
  onChooseRrhhCv: () => void;
  onChooseRrhhOther: () => void;
  onRrhhCvFile: (file: File) => void;
  onDescribeChange: (text: string) => void;
  onSubmitDescribe: () => void;
}

/** Menú de WhatsApp del widget (ADR-129) -- ver WA_ROOT_MENU/WaFlowState.
 * Vive dentro del mismo panel de chat, reemplazando la lista de mensajes
 * mientras está activo (mismo patrón que DocWizardPanel). */
function WaFlowPanel({
  flow, onChooseRoot, onCancel, onBackToMenu, onChooseRrhhCv, onChooseRrhhOther, onRrhhCvFile, onDescribeChange, onSubmitDescribe,
}: WaFlowPanelProps) {
  const cvInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#6ee7b7' }}>
          <Phone size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          Soporte por WhatsApp
        </span>
        <button onClick={onCancel} title="Cerrar menú" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>

      {flow.step !== 'menu' && (
        <button
          onClick={onBackToMenu}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}
        >
          <ArrowLeft size={11} /> Volver al menú
        </button>
      )}

      {flow.step === 'menu' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>¿En qué te ayudamos hoy? Elige una opción:</p>
          {WA_ROOT_MENU.map((item) => (
            <button
              key={item.id}
              onClick={() => onChooseRoot(item)}
              style={{ textAlign: 'left', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, fontSize: 12 }}>{item.label}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{item.desc}</div>
            </button>
          ))}
        </>
      )}

      {flow.step === 'rrhh_choice' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>🧑‍💼 <strong style={{ color: '#e2e8f0' }}>Recursos Humanos</strong> — ¿qué necesitas?</p>
          <button onClick={onChooseRrhhCv} style={{ textAlign: 'left', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', cursor: 'pointer' }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>📄 Enviar mi CV</div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Postula adjuntando tu currículum (Word, PowerPoint o PDF)</div>
          </button>
          <button onClick={onChooseRrhhOther} style={{ textAlign: 'left', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', cursor: 'pointer' }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>💬 Otra consulta</div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Planillas, certificados, personal</div>
          </button>
        </>
      )}

      {flow.step === 'rrhh_cv_upload' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>
            Adjunta tu CV en <strong style={{ color: '#e2e8f0' }}>Word (.docx), PowerPoint (.pptx) o PDF</strong>. Nuestro
            equipo de RRHH lo revisará (con apoyo de IA para el triaje inicial).
          </p>
          <input
            ref={cvInputRef}
            type="file"
            accept=".docx,.pptx,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onRrhhCvFile(file);
            }}
          />
          <button
            onClick={() => cvInputRef.current?.click()}
            disabled={flow.uploading}
            style={{ ...primaryBtnStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: flow.uploading ? 0.6 : 1 }}
          >
            <Paperclip size={13} /> {flow.uploading ? 'Subiendo y analizando…' : 'Elegir archivo de CV'}
          </button>
          {flow.error && <span style={{ fontSize: 10, color: '#f87171' }}>{flow.error}</span>}
        </>
      )}

      {flow.step === 'describe' && (
        <>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 11 }}>
            <strong style={{ color: '#e2e8f0' }}>{flow.label}</strong> — cuéntanos brevemente qué necesitas:
          </p>
          <textarea
            value={flow.description}
            onChange={(e) => onDescribeChange(e.target.value)}
            placeholder="Describe tu solicitud…"
            style={{ ...inputStyle, height: 80, resize: 'none' }}
          />
          {flow.error && <span style={{ fontSize: 10, color: '#f87171' }}>{flow.error}</span>}
          <p style={{ margin: 0, fontSize: 10, color: '#64748b' }}>
            {flow.escalateAfter
              ? 'Al enviar, se registrará tu solicitud y se notificará de inmediato a un asesor humano por WhatsApp.'
              : 'Al enviar, tu solicitud quedará registrada con un código de seguimiento.'}
          </p>
          <button
            onClick={onSubmitDescribe}
            disabled={!flow.description.trim() || flow.submitting}
            style={{ ...primaryBtnStyle, opacity: !flow.description.trim() || flow.submitting ? 0.6 : 1 }}
          >
            {flow.submitting ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </>
      )}
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
          {DOCUMENT_TEMPLATES.map((t) => {
            const isPresentation = t.docType === 'presentation';
            return (
              <button
                key={t.id}
                onClick={() => onChooseTemplate(t.id)}
                style={{ textAlign: 'left', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: isPresentation ? '#f59e0b' : '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>
                  {isPresentation ? <Presentation size={11} /> : <FileText size={11} />}
                  {isPresentation ? 'PowerPoint' : 'Word'}
                </div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{t.description}</div>
              </button>
            );
          })}
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
