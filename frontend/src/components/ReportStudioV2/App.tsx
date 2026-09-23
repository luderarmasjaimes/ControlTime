import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RibbonToolbar from './components/layout/RibbonToolbar';
import LeftLibrary from './components/layout/LeftLibrary';
import RightInspector from './components/layout/RightInspector';
import MultipageView from './components/document/MultipageView';
import SlideThumbnailRail from './components/document/SlideThumbnailRail';
import WorkflowPanel, { createWorkflowEntry, WorkflowStatusBadge, type WorkflowStatus, type WorkflowEntry, type WorkflowSignature } from './components/document/WorkflowPanel';
import VersionHistory, { createSnapshot, type VersionSnapshot } from './components/document/VersionHistory';
import VersionComparator from './components/document/VersionComparator';
import VoiceDictation from './components/document/VoiceDictation';
import PerformanceDashboard from './components/dashboard/PerformanceDashboard';
import { useEditorStore, type GlobalTextFormat, type OptimizationSuggestion, type ReportDocument } from './store/useEditorStore';
import { parseRichClipboardBlocks } from './lib/richPaste';
import { convertPdfOcrResponseToBlocks, buildReplicaPages, isReplicaResponse, formatPdfOcrSummary } from './lib/pdfOcrImport';
import { expandParagraphPageBreaks, markParagraphAlignment, markRunFontSize, enrichDocxTextStyles, extractDocxTableShading, extractDocxPageSetup, DOCX_ALIGNMENT_STYLE_MAP, DOCX_HIGHLIGHT_STYLE_MAP } from './lib/docxPageBreaks';
import { usePermissions } from '../../auth/usePermissions';
import ReportsAdminModal from './components/modals/ReportsAdminModal';
import ReadOnlyViewer from './components/viewers/ReadOnlyViewer';
import PdfPasswordModal from './components/PdfPasswordModal';
import ShareReportModal from './components/modals/ShareReportModal';
import DeleteReportConfirm from './components/modals/DeleteReportConfirm';
import MapCaptureModal from './components/modals/MapCaptureModal';
import ImageInsertModal from './components/modals/ImageInsertModal';
import VideoInsertModal from './components/modals/VideoInsertModal';
import NarrationModal from './components/modals/NarrationModal';
import Apa7CitationModal from './components/modals/Apa7CitationModal';
import SaveTitleModal from './components/modals/SaveTitleModal';
import SaveTextStyleModal from './components/modals/SaveTextStyleModal';
import { loadCustomTextStyles, saveCustomTextStyle, deleteCustomTextStyle, type CustomTextStyle } from './lib/customTextStyles';
import type { HeadingStyleDef } from './lib/headingStyles';
import FormulaAnalysisModal from './components/modals/FormulaAnalysisModal';
import DocumentLayoutModal from './components/modals/DocumentLayoutModal';
import SupportChatWidget from './components/support/SupportChatWidget';
import { saveReportAsync } from './lib/reportsStorage';
import { startAutosave, stopAutosave, subscribeAutosave } from './lib/autosaveEngine';
import { exportDOCX, generateFilename } from './lib/exportEngine';
import { usePdfExport } from './lib/usePdfExport';
import { initAccessibility, destroyAccessibility } from './lib/accessibility';
import { measurePerfAsync } from './lib/performanceMonitor';
import { generateDemoReport, type DemoReportProgress } from './lib/demoReportGenerator';
import { useShareLink } from './lib/useShareLink';
import ShareLinkModal from './components/ShareLinkModal';
import {
  fetchReports,
  fetchReportById,
  fetchReportRevisions,
  fetchReportPortableBlob,
  importReportPortable,
  importReportPdfOcr,
  syncMiningKpisFromDashboard,
  syncMiningKpisFromExternal,
  fetchMiningKpis,
  fetchMineSensors,
  fetchSeismicReport,
  createPptxExportJob,
  createDocxExportJob,
  createXlsxExportJob,
  createVideoExportJob,
  uploadSlideNarration,
  pollExportJob,
  fetchExportJobBlob,
  type ExportJobStatus,
} from './lib/api';
import { getSession, type Session } from '../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../auth/telemetryTenant';
import { useConnectivity } from '../../lib/connectivityMonitor';
import {
  getOfflineDb,
  saveOfflineSnapshot,
  loadOfflineSnapshot,
  markOfflineSnapshotSynced,
  recordWentOffline,
  recordCameOnline,
  findOrphanedLocalDrafts,
} from './lib/offlineSqlite';
import { log } from '../../lib/logger';
import { tryApplyToActiveTextSelection, tryApplyCaseToActiveTextSelection } from './lib/activeTextFormatBridge';
import { applyListToText } from './lib/listFormatting';
import { useI18n } from '../../i18n/I18nProvider';
import { requestConfirmation, requestNotice } from '../UI/ConfirmActionDialog';
import { requestSupportAvatar } from '../UI/AvatarWidget';
import './styles.css';
import './ribbon.css';

interface StudioSession extends Session {
  miningUnit?: string;
}

interface AiSuggestion extends OptimizationSuggestion {
  decision: 'pending' | 'accepted' | 'rejected';
}

interface SyncToast {
  type: 'success' | 'warning' | 'error';
  message: string;
}

interface ImageInsertIntent {
  pageNumber: number;
  elementId: string;
  /** 'company-image': inserta un bloque `image` NUEVO, libre y centrado en
   * la página (ver addCenteredImage) — a diferencia del modo por defecto,
   * que reemplaza el `src` de un bloque de imagen YA existente. `elementId`
   * en este modo identifica la carátula desde la que se disparó la acción
   * (solo para saber en qué página insertar), no el elemento a modificar. */
  mode?: 'company-image';
}

interface AppProps {
  openFormulaOnLoad?: boolean;
  platformCompanyName?: string;
  telemetryTenantId?: string;
}

export default function App({
  openFormulaOnLoad = false,
  platformCompanyName,
  telemetryTenantId: telemetryTenantIdProp,
}: AppProps) {
  const { language, t } = useI18n();
  const session = getSession() as StudioSession | null;
  // ADR-079: mismo hook/permiso que el backend exige en report_service.cpp —
  // filtra qué transiciones de workflow se ofrecen según lo que el usuario
  // realmente puede hacer, en vez de mostrar "Firmar"/"Aprobar" a cualquiera.
  const { hasPermission: hasReportPermission } = usePermissions();
  const telemetryTenantId = telemetryTenantIdProp ?? telemetryTenantIdFromSession(session);
  const loggedAuthor = session?.fullName || session?.username || 'Usuario';
  const connectivity = useConnectivity();
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  // ADR-022: true cuando HAY conexión al servidor, pero el usuario eligió
  // explícitamente seguir trabajando con su copia OFFLINE en vez de traer la
  // versión del servidor (porque alguien más — otra terminal — guardó una
  // versión distinta mientras este informe estaba sin conexión). Mientras
  // esto sea true, el autosave sigue escribiendo en SQLite local (no en el
  // servidor) hasta que el usuario resuelva el conflicto al presionar
  // "Guardar" — ver handleSaveReport.
  const [workingOfflineConflict, setWorkingOfflineConflict] = useState(false);
  // document_id LOCAL del informe que el usuario guardó explícitamente
  // mientras estaba offline (ver handleSaveReport) y que TODAVÍA no existe
  // en el servidor — el efecto de reconexión de más abajo lo usa para
  // terminar de crearlo apenas vuelva la señal, sin depender de qué informe
  // esté abierto en pantalla en ese momento (el usuario pudo haber seguido
  // trabajando en otro mientras tanto).
  const [pendingOfflineCreateFor, setPendingOfflineCreateFor] = useState<string | null>(null);

  const doc = useEditorStore((s) => s.doc);
  const addElement = useEditorStore((s) => s.addElement);
  const applySlideLayout = useEditorStore((s) => s.applySlideLayout);
  const addTocElement = useEditorStore((s) => s.addTocElement);
  const syncTocPages = useEditorStore((s) => s.syncTocPages);
  const addCenteredImage = useEditorStore((s) => s.addCenteredImage);
  const updateElement = useEditorStore((s) => s.updateElement);
  const addTextTemplate = useEditorStore((s) => s.addTextTemplate);
  const addTechnicalBlock = useEditorStore((s) => s.addTechnicalBlock);
  const addSectionTemplate = useEditorStore((s) => s.addSectionTemplate);
  const addStaticChart = useEditorStore((s) => s.addStaticChart);
  const addPage = useEditorStore((s) => s.addPage);
  const duplicatePage = useEditorStore((s) => s.duplicatePage);
  const reviewDocumentQuality = useEditorStore((s) => s.reviewDocumentQuality);
  const getOptimizationSuggestions = useEditorStore((s) => s.getOptimizationSuggestions);
  const applyOptimizationSuggestion = useEditorStore((s) => s.applyOptimizationSuggestion);
  const applyOptimizationBatch = useEditorStore((s) => s.applyOptimizationBatch);
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const gridEnabled = useEditorStore((s) => s.gridEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setGridEnabled = useEditorStore((s) => s.setGridEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const setPageMargins = useEditorStore((s) => s.setPageMargins);
  const applyGlobalTextFormat = useEditorStore((s) => s.applyGlobalTextFormat);
  const addComment = useEditorStore((s) => s.addComment);
  const copyElement = useEditorStore((s) => s.copyElement);
  const pasteElement = useEditorStore((s) => s.pasteElement);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [reviewResult, setReviewResult] = useState<ReturnType<typeof reviewDocumentQuality> | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  // Barra de progreso de export DOCX/PPTX/PDF (server-side, job asíncrono) --
  // portado del avance de Luder (2026-09-11): visible en la barra superior
  // persistente para que el usuario vea que el sistema sigue trabajando en
  // exports largos (miles de páginas) en vez de asumir que se colgó. `null`
  // = sin export en curso. Solo se llena si `ExportJobStatus.progress` viene
  // poblado (depende de un sidecar/backend que aún no confirmamos que lo
  // reporte para todos los formatos) -- mientras tanto no se muestra nada,
  // sin romper el texto de `aiStatus` que ya informaba el estado.
  const [exportProgress, setExportProgress] = useState<{ format: string; captured: number; total: number } | null>(null);
  // Callback de progreso compartido entre DOCX/PPTX/PDF: mismo texto en
  // `aiStatus` + misma barra visual, solo cambia la etiqueta de formato.
  const makeExportProgressHandler = useCallback((formatLabel: string, renderingText: string) => (status: ExportJobStatus) => {
    setAiStatus(status.status === 'running' ? renderingText : `${formatLabel} en cola de exportación...`);
    if (status.progress && status.progress.total > 0) {
      setExportProgress({ format: formatLabel, captured: status.progress.captured, total: status.progress.total });
    }
  }, []);
  const [showAiReview, setShowAiReview] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiSeverityFilter, setAiSeverityFilter] = useState('todas');
  const [aiSearchTerm, setAiSearchTerm] = useState('');

  // ── Reports Admin ──────────────────────────────────────────────────────────
  const [showReportsAdmin, setShowReportsAdmin] = useState(false);
  const [showReadOnly, setShowReadOnly] = useState(false);
  const [readOnlyReport, setReadOnlyReport] = useState<any>(null);
  // Visualizador de PPT en pantalla completa ("Presentar", ribbon Exportar) —
  // reusa readOnlyReport/ReadOnlyViewer (mismo "report" que la vista previa
  // de impresión), solo cambia el modo con el que se abre.
  const [showPresentation, setShowPresentation] = useState(false);
  // ADR-016/080: MISMO hook que ReadOnlyViewer.tsx (visor de solo lectura) —
  // el botón "PDF" del ribbon y "Descargar PDF protegido" del visor ejecutan
  // ahora exactamente el mismo pipeline server-side, en vez de tener cada
  // uno su propia implementación (antes este botón generaba un PDF distinto,
  // rasterizado con html2canvas, sin texto seleccionable).
  const { downloadPdf: downloadProtectedPdf, password: pdfPassword, clearPassword: clearPdfPassword } = usePdfExport();
  // ADR-204: toggle "sin sello de agua" -- solo se ofrece en la cinta cuando
  // `canToggleWatermark` es true (permission code informes.export_sin_marca_agua,
  // ver props pasadas a RibbonToolbar más abajo); default false = CON sello.
  const [noWatermark, setNoWatermark] = useState(false);
  // Stage 3 (PPTX -> video): job pptx exitoso más reciente de ESTA sesión —
  // habilita el botón "Convertir a MP4"; se reinicia si el informe cambia
  // (evita reusar un job de otro reportId al cambiar de informe abierto).
  const [lastPptxJobId, setLastPptxJobId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [reportsRefreshToken, setReportsRefreshToken] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Guardar');
  const [showMapCapture, setShowMapCapture] = useState(false);
  const [showImageInsertModal, setShowImageInsertModal] = useState(false);
  const [showVideoInsertModal, setShowVideoInsertModal] = useState(false);
  const [showNarrationModal, setShowNarrationModal] = useState(false);
  const [showApa7Modal, setShowApa7Modal] = useState(false);
  const [showDocumentLayout, setShowDocumentLayout] = useState(false);
  // Estilos de texto personalizados (ribbon Inicio → Estilos → "guardar
  // estilo actual") -- persistidos en localStorage, ver lib/customTextStyles.ts.
  const [customTextStyles, setCustomTextStyles] = useState<CustomTextStyle[]>(() => loadCustomTextStyles());
  const [showSaveTextStyleModal, setShowSaveTextStyleModal] = useState(false);
  // Reemplazo de window.prompt() para nombrar un informe nuevo al guardar
  // (ver promptForTitle más abajo, y SaveTitleModal.tsx) — mismo estilo
  // visual que el resto de modales de la plataforma (clases ra-*).
  const [titlePromptState, setTitlePromptState] = useState<{
    defaultValue: string;
    heading?: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [videoInsertOpenSeq, setVideoInsertOpenSeq] = useState(0);
  const [videoInsertInitialTab, setVideoInsertInitialTab] = useState<'webcam' | 'screen'>('webcam');
  const [imageInsertReplaceTarget, setImageInsertReplaceTarget] = useState<ImageInsertIntent | null>(null);
  const [imageInsertInitialTab, setImageInsertInitialTab] = useState('file');
  const [imageInsertOpenSeq, setImageInsertOpenSeq] = useState(0);
  /** Evita cierre con estado obsoleto al completar desde el portal (ref sincronizado al abrir). */
  const imageInsertIntentRef = useRef<ImageInsertIntent | null>(null);
  const [showFormulaAnalysis, setShowFormulaAnalysis] = useState(openFormulaOnLoad);
  const [isSyncingKpis, setIsSyncingKpis] = useState(false);
  const [kpiAutoSyncEnabled, setKpiAutoSyncEnabled] = useState(true);
  const [syncToast, setSyncToast] = useState<SyncToast | null>(null);

  // ── Stage 1 new state ──
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  // Panel de "Plantillas de Documento" en la barra lateral derecha (pedido
  // explícito 2026-07-30) -- vive en App.tsx (no en el store) siguiendo la
  // misma convención que rightPanelVisible, ya que RightInspector es un
  // componente no controlado que solo gestiona su propio expand/collapse.
  const [showTemplatesPanel, setShowTemplatesPanel] = useState(false);
  // Pedido explícito 2026-09-08: la columna de miniaturas de diapositivas
  // (SlideThumbnailRail) debe achicarse mientras el panel derecho de
  // Propiedades está desplegado -- a diferencia de la biblioteca izquierda
  // (cuyo estado expandido se resuelve con un simple selector CSS de
  // hermano adyacente porque SÍ es el hermano inmediato en el DOM),
  // RightInspector NO es adyacente a SlideThumbnailRail (queda <main> en
  // medio), así que hace falta levantar el estado hasta acá.
  const [rightInspectorExpanded, setRightInspectorExpanded] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>('draft');
  // Firma documental (ADR-018): solo lectura en el cliente, la escribe el
  // servidor en el momento exacto de la transición a 'signed'.
  const [reportSignature, setReportSignature] = useState<WorkflowSignature | null>(null);
  const [auditLog, setAuditLog] = useState<WorkflowEntry[]>([]);
  const [autosaveStatus, setAutosaveStatus] = useState('idle');

  // Gate cliente-side de defensa en profundidad (ADR-018/079): el backend ya
  // rechaza el guardado de un informe signed/archived sin excepción de rol
  // (409 report_immutable), pero hasta este cambio el editor dejaba
  // editar/deshacer localmente sin aviso -- ver useEditorStore.documentLocked,
  // que addElement/updateElement/removeElement(s)/pasteSelection/undo/redo
  // ya respetan.
  useEffect(() => {
    useEditorStore.getState().setDocumentLocked(workflowStatus === 'signed' || workflowStatus === 'archived');
  }, [workflowStatus]);

  // Handle signal from floating toolbar to open inspector
  useEffect(() => {
    const handleOpenInspector = () => setRightPanelVisible(true);
    window.addEventListener('mining-studio-open-inspector', handleOpenInspector);
    return () => window.removeEventListener('mining-studio-open-inspector', handleOpenInspector);
  }, []);

  // Automatically open right panel when an element is selected
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  useEffect(() => {
    if (selectedElementId) {
      setRightPanelVisible(true);
    }
  }, [selectedElementId]);

  useEffect(() => {
  const handleGlobalHistoryShortcut = (event: KeyboardEvent) => {
    const isModifier = event.ctrlKey || event.metaKey;

    if (!isModifier) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (target) {
      const tag = target.tagName?.toLowerCase();
      const isFieldLike = tag === 'textarea' || tag === 'input' || tag === 'select' || target.isContentEditable;
      // El <textarea> de un bloque de texto y las celdas contentEditable de
      // una tabla TAMBIÉN son "campos" para el navegador, pero viven DENTRO
      // del lienzo (`.page-scroll`, ver MultipageView.tsx) y son la razón
      // de ser de este atajo -- bug real reportado 2026-09-10 ("el
      // undo/redo no funciona, sobre todo al agregar una tabla y editar"):
      // esta función bloqueaba Ctrl+Z/Y para CUALQUIER campo, sin importar
      // dónde estuviera, así que escribir en una celda o en un bloque de
      // texto y presionar Ctrl+Z sin antes hacer clic afuera no hacía
      // NADA (ni el undo del documento, que se descartaba aquí, ni un undo
      // nativo útil -- ambos editores manejan su contenido con estado de
      // React/el store, no con el historial nativo del campo). Solo los
      // campos "de formulario" de verdad FUERA del lienzo (inspector
      // derecho, ribbon, buscadores, modales) siguen dejando pasar el undo
      // nativo del navegador tal cual.
      const isInsideDocumentCanvas = Boolean(target.closest('.page-scroll'));

      if (isFieldLike && !isInsideDocumentCanvas) {
        return;
      }

      if (isFieldLike && isInsideDocumentCanvas) {
        // Si el atajo se dispara con el editor de texto o la celda TODAVÍA
        // enfocados, hay que cerrarlos/confirmarlos ANTES de tocar el
        // historial -- si no, dos bugs simétricos: (1) lo último tecleado
        // vive solo en estado local (liveEdit del bloque de texto /
        // el DOM de la celda) y nunca llegó a confirmarse al store, así
        // que el snapshot que se restaura queda desfasado; y (2) el propio
        // editor se queda mostrando ese valor VIEJO en pantalla después del
        // undo (liveEdit no se limpia solo, y TableCell.tsx a propósito no
        // resiembra su contenido mientras tiene el foco -- ver el
        // comentario de ese useEffect). blur() dispara el mismo onBlur que
        // ya usa el cierre manual (closeAndProcess / persistCell) para
        // confirmar y cerrar limpio antes de deshacer/rehacer.
        target.blur();
      }
    }

    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();

      useEditorStore.getState().undo();
      return;
    }

    if (key === 'y') {
      event.preventDefault();
      event.stopImmediatePropagation();

      useEditorStore.getState().redo();
      return;
    }

    // Atajo alternativo habitual de redo.
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();

      useEditorStore.getState().redo();
    }
  };

  // CAPTURE = true
  // Hace que el evento se intercepte antes de los listeners normales
  // que puedan existir en el canvas, Konva, ribbon, etc.
  window.addEventListener(
    'keydown',
    handleGlobalHistoryShortcut,
    true,
  );

  return () => {
    window.removeEventListener(
      'keydown',
      handleGlobalHistoryShortcut,
      true,
    );
  };
}, []);

  // Reconcilia páginas de continuación del TOC (ver
  // useEditorStore.ts::syncTocPages) cada vez que el documento cambia —
  // p.ej. al agregar/quitar un encabezado, la lista de entradas puede
  // crecer o encogerse y necesitar más o menos páginas propias. Es un
  // no-op barato cuando el número de páginas de continuación ya es
  // correcto (o no hay TOC en el documento), así que engancharlo a
  // `doc` (cambia en cada edición) es seguro.
  useEffect(() => {
    syncTocPages();
  }, [doc, syncTocPages]);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>([]);
  // ── Stage 2 state ──
  const [showComparator, setShowComparator] = useState(false);
  const [showVoiceDictation, setShowVoiceDictation] = useState(false);
  const [showPerfDashboard, setShowPerfDashboard] = useState(false);

  const currentReportId = useEditorStore((s) => s.currentReportId);
  const currentReportTitle = useEditorStore((s) => s.currentReportTitle);
  const currentReportVersionNumber = useEditorStore((s) => s.currentReportVersionNumber);
  const setCurrentReportId = useEditorStore((s) => s.setCurrentReportId);
  const setCurrentReportTitle = useEditorStore((s) => s.setCurrentReportTitle);
  const setCurrentReportVersionNumber = useEditorStore((s) => s.setCurrentReportVersionNumber);
  const createNewDocument = useEditorStore((s) => s.createNewDocument);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  const setLayoutMode = useEditorStore((s) => s.setLayoutMode);
  const paperSize = useEditorStore((s) => s.doc.meta?.paperSize || 'A4');
  const orientation = useEditorStore((s) => s.doc.meta?.orientation || 'portrait');
  const setPaperSize = useEditorStore((s) => s.setPaperSize);
  const setOrientation = useEditorStore((s) => s.setOrientation);

  const selectedElement = useMemo(() => {
    if (!selectedElementId || !selectedPage) return null;
    const page = doc.pages.find(p => p.page_number === selectedPage);
    return page?.elements?.find(e => e.id === selectedElementId) || null;
  }, [doc.pages, selectedPage, selectedElementId]);

  const handleAddComment = useCallback(() => {
    // Si hay un bloque seleccionado, se ancla a él; de lo contrario queda al
    // inicio de la página activa. El nombre proviene siempre de la sesión.
    addComment({
      pageNumber: selectedPage || 1,
      elementId: selectedElement?.id,
      author: loggedAuthor,
      authorId: session?.userId,
    });
  }, [addComment, selectedPage, selectedElement?.id, loggedAuthor, session?.userId]);

  const handleUpdateSelectedProps = useCallback((newProps: Record<string, unknown>) => {
    if (!selectedElementId || !selectedPage || !selectedElement) return;
    updateElement(selectedPage, selectedElementId, { props: { ...(selectedElement.props || {}), ...newProps } });
  }, [selectedElementId, selectedPage, selectedElement, updateElement]);

  const currentProps = selectedElement?.props || {};
  const currentFontFamily = currentProps.fontFamily;
  const currentFontSize = currentProps.fontSize;
  const currentFontColor = currentProps.fontColor;
  const currentHighlightColor = currentProps.highlightColor;

  // El panel de párrafo trabaja a nivel DOCUMENTO. Antes de que el usuario
  // aplique un estilo global por primera vez, se muestra el formato del
  // primer globo de texto disponible como referencia; al aplicar un valor el
  // store lo sincroniza en todos los globos de todas las páginas.
  const globalTextFormat = useMemo(() => {
    const firstText = doc.pages.flatMap((page) => page.elements).find((element) => element.type === 'text');
    const props = firstText?.props || doc.meta?.globalTextFormat || {};
    return {
      fontFamily: String(props.fontFamily || 'Arial'),
      fontSize: Math.max(7, Number(props.fontSize) || 14),
      fontColor: String(props.fontColor || '#0f172a'),
      textAlign: (props.textAlign || 'left') as NonNullable<GlobalTextFormat['textAlign']>,
      lineHeight: Number(props.lineHeight) || 1.35,
      indentLeft: Math.max(0, Number(props.indentLeft) || 0),
      indentRight: Math.max(0, Number(props.indentRight) || 0),
      specialIndent: (props.specialIndent === 'firstLine' || props.specialIndent === 'hanging' ? props.specialIndent : 'none') as NonNullable<GlobalTextFormat['specialIndent']>,
      specialIndentBy: Math.max(0, Number(props.specialIndentBy) || 0),
      spacingBefore: Math.max(0, Number(props.spacingBefore) || 0),
      spacingAfter: Math.max(0, Number(props.spacingAfter) || 0),
    };
  }, [doc.pages, doc.meta]);
  const pageMargins = useMemo(() => ({
    top: Math.max(6, Number(doc.meta?.marginTop) || 36),
    right: Math.max(6, Number(doc.meta?.marginRight) || 36),
    bottom: Math.max(6, Number(doc.meta?.marginBottom) || 36),
    left: Math.max(6, Number(doc.meta?.marginLeft) || 36),
  }), [doc.meta]);

  // Botón "Aa" del ribbon FIJO cuando no hay selección de texto activa en
  // un editor (tryApplyCaseToActiveTextSelection devuelve false) — mismo
  // ciclo MAYÚSCULAS→minúsculas→Cada Palabra que la barra flotante
  // (PageCanvas.tsx → applyCaseToSelection), pero sobre TODO el texto del
  // bloque, ya que el ribbon fijo actúa a nivel de bloque completo.
  const applyCaseToWholeBlock = useCallback(() => {
    const original = String(currentProps.text ?? '');
    if (!original) return;
    const isUpper = original === original.toUpperCase() && original !== original.toLowerCase();
    const isLower = original === original.toLowerCase() && original !== original.toUpperCase();
    let transformed: string;
    if (isUpper) transformed = original.toLowerCase();
    else if (isLower) transformed = original.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    else transformed = original.toUpperCase();
    handleUpdateSelectedProps({ text: transformed });
  }, [currentProps.text, handleUpdateSelectedProps]);
  // Nunca se pasaba a RibbonToolbar (prop declarada pero jamás calculada) —
  // "Estilo actual" quedaba siempre en "Normal" sin importar la selección.
  const currentHeadingStyle = currentProps.headingStyle;
  const currentAlignment = currentProps.textAlign;
  const currentListStyle = currentProps.listType;
  // Ribbon "Crear lista con viñetas/numerada" — antes eran botones sin
  // onClick (no hacían nada); la única forma de aplicar listas era el
  // atajo de teclado oculto Ctrl+Shift+7/8/0 dentro de PageCanvas.tsx.
  // El marcador ("• "/"1. ") es texto literal, no CSS, porque el bloque
  // puede renderizarse como <Text> de Konva (sin pseudo-elementos).
  const applyListStyleToWholeBlock = useCallback((listType: 'none' | 'bullet' | 'number') => {
    const original = String(currentProps.text ?? '');
    handleUpdateSelectedProps({ listType, text: applyListToText(original, listType) });
  }, [currentProps.text, handleUpdateSelectedProps]);
  const isBold = currentProps.bold;
  const isItalic = currentProps.italic;
  const isUnderline = currentProps.underline;

  // Guardar el formato actual como estilo personalizado (ribbon Inicio →
  // Estilos → botón "guardar") -- misma forma que HeadingStyleDef, así se
  // reaplica con el mismo onApplyHeadingStyle que Título/H1-H6 (ver más
  // abajo). El botón funciona SIEMPRE, haya o no texto seleccionado (igual
  // que "Crear nuevo estilo a partir del formato" de Word, que se puede
  // abrir y configurar de cero): si hay un bloque de texto seleccionado se
  // usa su formato actual como punto de partida en el modal, si no, un
  // formato por defecto razonable -- SaveTextStyleModal.tsx deja editar
  // cada propiedad ahí mismo antes de guardar.
  const defaultTextFormat: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'> = {
    fontFamily: 'Arial', fontSize: 12, fontWeight: 400, italic: false, underline: false,
    color: '#1e293b', textAlign: 'left', lineHeight: 1.35,
  };
  const initialTextFormat: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'> = selectedElement?.type === 'text' ? {
    fontFamily: String(currentProps.fontFamily || defaultTextFormat.fontFamily),
    fontSize: Number(currentProps.fontSize) || defaultTextFormat.fontSize,
    fontWeight: currentProps.bold ? 700 : 400,
    italic: !!currentProps.italic,
    underline: !!currentProps.underline,
    color: String(currentProps.fontColor || defaultTextFormat.color),
    textAlign: (currentProps.textAlign || defaultTextFormat.textAlign) as HeadingStyleDef['textAlign'],
    lineHeight: Number(currentProps.lineHeight) || defaultTextFormat.lineHeight,
  } : defaultTextFormat;
  const handleOpenSaveTextStyle = useCallback(() => {
    setShowSaveTextStyleModal(true);
  }, []);
  const handleConfirmSaveTextStyle = useCallback((label: string, format: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'>) => {
    setCustomTextStyles(saveCustomTextStyle(label, format));
    setShowSaveTextStyleModal(false);
  }, []);
  const handleDeleteCustomTextStyle = useCallback((id: string) => {
    setCustomTextStyles(deleteCustomTextStyle(id));
  }, []);

  // Reemplaza window.prompt(): abre SaveTitleModal y resuelve la promesa con
  // el título ingresado, o null si el usuario cancela (mismo contrato que
  // window.prompt() devolviendo null al cancelar, para no tener que tocar
  // la lógica de los llamadores más abajo).
  const promptForTitle = useCallback((defaultValue: string, heading?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setTitlePromptState({ defaultValue, heading, resolve });
    });
  }, []);

  // ── Guardar informe ────────────────────────────────────────────────────────
  const handleSaveReport = async (options?: { titleOverride?: string }): Promise<boolean> => {
    if (!session) {
      void requestNotice(t('notice.loginToSave'));
      return false;
    }

    // ADR-022, cierre CA-3 de SPEC-014: cuando la rama "Sobrescribir" de abajo
    // deja caer la ejecución al guardado normal más adelante en esta misma
    // función, esta bandera es lo único que distingue ese guardado (fuerza la
    // sobrescritura de la versión del servidor tras un conflicto) de un
    // guardado manual común — se pasa a `saveReportAsync` para que quede
    // etiquetado en el historial de versiones, no solo en este comentario.
    let conflictResolutionTag: string | undefined;

    // ADR-022: hay un conflicto offline sin resolver sobre este informe —
    // antes de guardar nada, el usuario decide si sobrescribe la versión
    // del servidor con su copia offline, o si prefiere conservar ambas
    // guardando la copia offline como un informe NUEVO (nunca se descarta
    // trabajo silenciosamente).
    if (workingOfflineConflict && currentReportId) {
      const wantsOverwrite = await requestConfirmation(t('confirm.offlineOverwrite'));
      if (!wantsOverwrite) {
        const suggestedOfflineTitle = `${currentReportTitle} (copia offline)`;
        const newTitle =
          ((await promptForTitle(suggestedOfflineTitle, 'Guardar copia offline como informe nuevo')) || '').trim() ||
          suggestedOfflineTitle;
        setIsSaving(true);
        setSaveLabel('Guardando...');
        try {
          const oldReportId = currentReportId;
          const saved = await saveReportAsync({
            id: undefined, // fuerza POST (informe nuevo), nunca PUT sobre el id viejo
            title: newTitle,
            contentJson: JSON.stringify(doc),
            status: 'draft',
            createdBy: session.userId,
            company: session.company || 'default',
            // ADR-022, cierre CA-3 de SPEC-014: deja trazabilidad de que este
            // informe nació de un conflicto offline resuelto sin sobrescribir
            // la versión del servidor (ver summaryLabels en el historial).
            conflictResolution: 'offline_conflict_kept_as_new',
          });
          if (saved?.id) {
            setCurrentReportId(saved.id);
            setCurrentReportTitle(newTitle);
          }
          if (typeof saved?.version_number === 'number') {
            setCurrentReportVersionNumber(saved.version_number);
          }
          // El draft offline quedaba asociado al id VIEJO — se marca resuelto
          // ahí (ya se "guardó", aunque como informe distinto) para que no
          // se siga ofreciendo para recuperar en el futuro.
          await markOfflineSnapshotSynced(oldReportId);
          setWorkingOfflineConflict(false);
          setSaveLabel('¡Guardado!');
          setTimeout(() => setSaveLabel('Guardar'), 2000);
          return true;
        } catch (err) {
          log.error('Error al guardar informe offline como nuevo:', err);
          setSaveLabel('Error');
          setTimeout(() => setSaveLabel('Guardar'), 3000);
          return false;
        } finally {
          setIsSaving(false);
        }
      }
      // Sobrescribir: sigue el flujo normal de abajo, pero SIN
      // expectedVersion (fuerza el guardado, el usuario ya confirmó
      // explícitamente que quiere pisar la versión del servidor).
      setWorkingOfflineConflict(false);
      conflictResolutionTag = 'offline_conflict_overwrite';
    }

    let title = options?.titleOverride ?? currentReportTitle;
    if (!currentReportId && !options?.titleOverride) {
      const input = await promptForTitle(title, 'Nombrar informe nuevo');
      if (input === null) return false; // cancelled
      title = (input || '').trim() || title;
    }

    // Se captura ANTES del guardado: si este es el primer guardado del
    // documento (currentReportId todavía null), el autosave venía
    // persistiendo en SQLite local bajo este id local (ver motor de
    // autosave más abajo) — una vez el servidor confirme un id real, ese
    // snapshot local queda obsoleto y se marca sincronizado para que
    // findOrphanedLocalDrafts no lo siga ofreciendo para recuperar.
    const localDraftIdBeforeSave = !currentReportId ? doc.document_id : null;

    // Sin conexión real: "Guardar" no debe fallar con un error de red — el
    // usuario puede no saber cuándo va a volver la señal, y necesita la
    // certeza de que esto quedó guardado para poder seguir avanzando sin
    // apuro (pedido explícito: "avanzo offline, lo guardo, y cuando se
    // reconecte que se suba solo"). Se persiste explícitamente en el mismo
    // SQLite local que ya usa el autoguardado offline (ver motor de
    // autosave más abajo), bajo la misma clave que usaría ese autoguardado
    // (id real si el informe ya existía, o el id local del documento si es
    // la primera vez) — y si es la primera vez, se marca con
    // pendingOfflineCreateFor para que el efecto de reconexión (más abajo)
    // termine de crearlo en el servidor apenas vuelva la señal, sin que
    // haga falta un segundo "Guardar" manual.
    if (connectivity.state === 'OFFLINE') {
      setCurrentReportTitle(title);
      // Bug real reportado (2026-09-08): el guardado offline persistía
      // `doc` tal cual, con `meta.author` en lo que sea que tuviera en ese
      // momento -- para un documento que arrancó del estado inicial del
      // store (nunca pasó por createNewDocument(), ver useEditorStore.ts)
      // eso es el placeholder 'AGM Solutions', nunca el usuario real. El
      // guardado ONLINE (unas líneas más abajo) ya corrige esto mismo al
      // armar el JSON que manda al servidor (`author: loggedAuthor`) --
      // faltaba aplicar la misma corrección acá, así que un borrador
      // guardado offline quedaba invisible en "Documentos sin conexión"
      // (ReportsAdminModal.tsx filtra por author === currentUserName) aun
      // cuando el guardado local en sí había funcionado.
      const offlineDoc: ReportDocument = { ...doc, meta: { ...doc.meta, author: loggedAuthor } };
      try {
        await saveOfflineSnapshot(
          currentReportId || offlineDoc.document_id,
          title,
          offlineDoc,
          currentReportVersionNumber ?? offlineDoc.meta?.version ?? 1,
        );
      } catch (err) {
        // Bug real reportado (2026-09-08): sin este catch, un fallo acá
        // (típicamente: este navegador nunca alcanzó a descargar la base
        // SQLite local mientras tuvo señal -- ver getOfflineDb en
        // offlineSqlite.ts, que necesita red la primera vez -- y ahora,
        // offline, no puede) quedaba como una promesa rechazada sin
        // manejar: no se guardaba en el servidor (obvio, sin conexión) NI
        // localmente, y el usuario no veía ningún aviso -- creía que había
        // guardado y perdía el documento por completo. Con el pre-cacheo
        // agregado más abajo (efecto keyed en connectivity.state) esto ya
        // no debería pasar en el uso normal, pero si pasa igual (primera
        // vez offline de la sesión antes de que ese efecto llegue a
        // completar la descarga), el usuario necesita enterarse.
        log.error('Error al guardar el borrador offline (sin conexión y sin base local disponible):', err);
        setSaveLabel('Error');
        setTimeout(() => setSaveLabel('Guardar'), 3000);
        void requestNotice(t('notice.offlineSaveFailed'));
        return false;
      }
      if (!currentReportId) {
        setPendingOfflineCreateFor(doc.document_id);
      }
      setSaveLabel('Guardado (sin conexión)');
      setTimeout(() => setSaveLabel('Guardar'), 2500);
      setAiStatus('Guardado localmente — se subirá al servidor automáticamente en cuanto vuelva la conexión.');
      return true;
    }

    setIsSaving(true);
    setSaveLabel('Guardando...');
    try {
      const contentJsonString = JSON.stringify({
        ...doc,
        meta: {
          ...doc.meta,
          author: loggedAuthor,
          updatedAt: new Date().toISOString(),
        },
      });
      const saved = await saveReportAsync({
        id: currentReportId || undefined,
        title,
        projectName: doc.meta?.project || '',
        contentJson: contentJsonString,
        status: 'draft',
        createdBy: session.userId,
        createdByName: session.fullName || session.username,
        company: session.company || 'default',
        // ADR-022, cierre CA-3 de SPEC-014: solo definido cuando este
        // guardado llegó acá vía la rama "Sobrescribir" de arriba.
        conflictResolution: conflictResolutionTag,
      });
      log.debug('Report saved successfully:', saved);
      // Backend might return the full object with id
      if (saved && saved.id) {
        setCurrentReportId(saved.id);
        if (localDraftIdBeforeSave) {
          await markOfflineSnapshotSynced(localDraftIdBeforeSave);
        }
      } else if (!currentReportId) {
        // Fallback for list refresh or similar if id wasn't returned as expected
        setAiStatus('Informe guardado. Recarga para ver cambios en la lista.');
      }
      // ADR-021 (revisado): "Versión: vN" en la UI muestra el version_number
      // real que el servidor acaba de confirmar (ADR-015), no el contador
      // local de ediciones de doc.meta.version.
      if (typeof saved?.version_number === 'number') {
        setCurrentReportVersionNumber(saved.version_number);
      }

      setCurrentReportTitle(title);
      setSaveLabel('¡Guardado!');
      setTimeout(() => setSaveLabel('Guardar'), 2000);
      return true;
    } catch (err: any) {
      log.error('Error al guardar informe:', err);
      setSaveLabel('Error');
      setTimeout(() => setSaveLabel('Guardar'), 3000);
      // ADR-039 (migración completa): un usuario sin tenant asignado ya no
      // puede crear/editar informes (antes caía a company_name legacy).
      if (err?.response?.data?.error === 'tenant_required') {
        void requestNotice(t('notice.noTenant'));
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Guarda `doc` en SQLite local -- mismo criterio que ya usa el motor de
  // autoguardado más abajo (efecto "Autosave engine"): un informe sin id
  // real del servidor (nunca guardado) se guarda bajo su document_id local;
  // uno ya guardado, bajo su id real. Se extrae acá para reusarlo también
  // en handleNewReport cuando no hay conexión (ver más abajo) -- antes esa
  // acción se bloqueaba por completo sin red en vez de proteger el informe
  // actual y dejar avanzar, igual que ya se protege el autoguardado.
  const persistCurrentDocOffline = useCallback(async (doc: ReportDocument) => {
    // Mismo fix que en handleSaveReport (bug real reportado 2026-09-08):
    // esta función es la que usa el motor de autoguardado (cada 5s) para
    // persistir offline, así que sin esto un documento nuevo que arranca
    // del estado inicial del store (author: 'AGM Solutions', ver
    // useEditorStore.ts) quedaba guardado localmente con ese placeholder
    // en TODOS los autoguardados, no solo en un "Guardar" manual.
    const stampedDoc: ReportDocument = { ...doc, meta: { ...doc.meta, author: loggedAuthor } };
    if (!currentReportId) {
      if (!stampedDoc.document_id) return;
      await saveOfflineSnapshot(stampedDoc.document_id, currentReportTitle, stampedDoc, stampedDoc.meta?.version ?? 1);
      return;
    }
    await saveOfflineSnapshot(
      currentReportId,
      currentReportTitle,
      stampedDoc,
      currentReportVersionNumber ?? stampedDoc.meta?.version ?? 1,
    );
  }, [currentReportId, currentReportTitle, currentReportVersionNumber, loggedAuthor]);

  // Un documento vacío solo contiene el encabezado y pie que el editor crea
  // automáticamente. Cualquier bloque adicional —incluso un globo de texto
  // aún vacío— o comentario representa trabajo que el usuario debe guardar.
  const hasUnsavedUserContent = useCallback(() => (
    doc.pages.some((page) => page.elements.some((element) => (
      element.type !== 'header' && element.type !== 'footer'
    ))) || Boolean(doc.meta?.comments?.length)
  ), [doc]);

  const handleNewReport = useCallback(async () => {
    if (isSaving) return;

    const mustSaveCurrent = Boolean(currentReportId) || hasUnsavedUserContent();
    if (!mustSaveCurrent) {
      createNewDocument(loggedAuthor);
      setWorkflowStatus('draft');
      setAuditLog([]);
      setReportSignature(null);
      setWorkingOfflineConflict(false);
      setAiStatus('Nuevo informe listo para editar.');
      return;
    }

    // Sin conexión real: el guardado forzado de abajo (llamada de red) fallaría
    // seguro, y antes eso bloqueaba por completo la creación del informe nuevo
    // -- el usuario se quedaba atascado en el actual hasta reconectarse. Ahora
    // se protege el informe actual en SQLite local (mismo mecanismo que ya usa
    // el autoguardado offline) y se deja avanzar igual que Word: nunca hace
    // falta red para poder empezar a escribir algo nuevo.
    if (connectivity.state === 'OFFLINE') {
      await persistCurrentDocOffline(doc);
      createNewDocument(loggedAuthor);
      setWorkflowStatus('draft');
      setAuditLog([]);
      setReportSignature(null);
      setWorkingOfflineConflict(false);
      setAiStatus('Sin conexión: el informe anterior se guardó localmente. Nuevo informe listo para editar.');
      return;
    }

    // Para un borrador que aún no posee ID, se pide el título ANTES de crear
    // el nuevo lienzo. Cancelar mantiene intacto el informe que se estaba
    // editando, por lo que nunca se pierde trabajo de forma silenciosa.
    let titleOverride: string | undefined;
    if (!currentReportId) {
      const enteredTitle = await promptForTitle(
        currentReportTitle,
        'Guardar informe antes de crear uno nuevo',
      );
      if (enteredTitle === null) return;
      titleOverride = enteredTitle.trim() || currentReportTitle;
    }

    const saved = await handleSaveReport({ titleOverride });
    if (!saved) return;

    createNewDocument(loggedAuthor);
    setWorkflowStatus('draft');
    setAuditLog([]);
    setReportSignature(null);
    setWorkingOfflineConflict(false);
    setAiStatus('Nuevo informe listo para editar.');
  }, [
    createNewDocument,
    currentReportId,
    currentReportTitle,
    handleSaveReport,
    hasUnsavedUserContent,
    isSaving,
    promptForTitle,
    connectivity.state,
    persistCurrentDocOffline,
    doc,
    loggedAuthor,
  ]);

  // ── Abrir informe desde modal (Leer / Editar / Enviar / Eliminar) ──────────
  const handleOpenRead = async (report: any) => {
    if (report._action === 'send') {
      setShareTarget(report);
      setShowShareModal(true);
    } else if (report._action === 'delete') {
      setDeleteTarget(report);
      setShowDeleteModal(true);
    } else {
      // La lista de "Mis Informes" no incluye content_json (solo metadatos);
      // se completa con el detalle antes de abrir el visor de solo lectura,
      // igual que handleOpenEdit hace para el editor.
      setReadOnlyReport(report);
      setShowReadOnly(true);
      try {
        const full = await fetchReportById(report.id, report.tenantId || report.tenant_id);
        setReadOnlyReport({ ...report, ...full });
      } catch (err) {
        log.error('handleOpenRead: fetchReportById', err);
      }
    }
  };

  const handleOpenEdit = async (report: any) => {
    setShowReportsAdmin(false);
    try {
      const full = await fetchReportById(report.id, report.tenantId || report.tenant_id);
      const docPayload = full.content_json ?? full.contentJson;
      loadDocument(docPayload, full.id, full.title);
      // ADR-021 (revisado): hidrata la versión real del servidor justo
      // después de loadDocument (que la resetea a null) — mismo motivo que
      // workflowStatus/reportSignature abajo: sin esto, "Versión: vN" se
      // queda mostrando el contador local de ediciones del doc anterior.
      const versionNumber = full.version_number ?? full.versionNumber;
      setCurrentReportVersionNumber(typeof versionNumber === 'number' ? versionNumber : null);
      // Antes, workflowStatus/reportSignature no se sincronizaban al abrir un
      // informe existente: el badge/panel de workflow mostraba el valor
      // residual de la sesión anterior (p.ej. 'draft') en vez del estado real
      // guardado en el servidor.
      setWorkflowStatus(full.status || 'draft');
      const signedByName = full.signed_by_name ?? full.signedByName ?? '';
      setReportSignature(
        signedByName
          ? {
              name: signedByName,
              role: full.signed_by_role ?? full.signedByRole ?? '',
              signedAt: full.signed_at ?? full.signedAt ?? '',
            }
          : null,
      );
      // Si el equipo tenía cambios sin sincronizar de un corte de conexión
      // anterior (p.ej. se cerró la pestaña antes de reconectar), se ofrece
      // restaurarlos en vez de perderlos silenciosamente al recargar desde
      // el servidor.
      try {
        const pending = await loadOfflineSnapshot(full.id);
        if (pending?.dirty) {
          const locale = language === 'pt' ? 'pt-BR' : language === 'fr' ? 'fr-CA' : language === 'en' ? 'en-US' : 'es-PE';
          const restore = await requestConfirmation(t('confirm.restoreOffline', {
            date: new Date(pending.updatedAt).toLocaleString(locale),
          }));
          if (restore) {
            loadDocument(pending.documentJson, full.id, pending.title || full.title);
            setAiStatus('Cambios offline restaurados — se sincronizarán en el próximo autoguardado.');
          }
        }
      } catch (offlineErr) {
        log.warn('handleOpenEdit: no se pudo revisar snapshot offline', offlineErr);
      }
    } catch (err) {
      log.error('handleOpenEdit', err);
      setAiStatus('No se pudo cargar el informe para editar.');
      void requestNotice(t('notice.reportLoadError'));
    }
  };

  /** Sufijo "(Copia)" / "(Copia N)" que agrega handleDuplicateReport --
   * se quita antes de recalcular, para que duplicar una copia no encadene
   * "(Copia) (Copia)" sino que numere sobre el mismo título base. */
  const stripCopySuffix = (title: string) => title.replace(/\s*\(Copia(?:\s+\d+)?\)\s*$/i, '').trim();

  // ── Duplicar informe (pedido explícito 2026-09-09) ──────────────────────
  // El lienzo no soporta seleccionar/copiar TODO un documento a la vez (Ctrl+C
  // ahí solo maneja un elemento -- ver PageCanvas.tsx), así que la forma real
  // de "reusar un informe como base de otro con distinta data" es duplicarlo
  // del lado del servidor: se trae el content_json completo del informe
  // original y se guarda como un informe NUEVO (id propio, nunca pisa el
  // original) con un título sugerido "Título (Copia)" que se va numerando si
  // ya existe ("Título (Copia 2)", "(Copia 3)"...).
  const handleDuplicateReport = async (report: any) => {
    if (!report?.id) return;
    if (!session) {
      void requestNotice(t('notice.loginToSave'));
      return;
    }
    const reportTenantId = report.tenantId || report.tenant_id;
    const baseTitle = stripCopySuffix(report.title || 'Informe sin título') || 'Informe sin título';
    let suggestedTitle = `${baseTitle} (Copia)`;
    try {
      const siblings = await fetchReports(reportTenantId);
      const existingTitles = new Set(siblings.map((r: any) => (r.title || '').trim()));
      if (existingTitles.has(suggestedTitle)) {
        let n = 2;
        while (existingTitles.has(`${baseTitle} (Copia ${n})`)) n++;
        suggestedTitle = `${baseTitle} (Copia ${n})`;
      }
    } catch (err) {
      // No es crítico -- si no se pudo revisar títulos existentes, se
      // ofrece igual el sufijo simple "(Copia)"; el usuario puede editarlo
      // a mano en el modal si ya existe uno igual.
      log.warn('handleDuplicateReport: no se pudieron revisar los títulos existentes', err);
    }

    const newTitle = await promptForTitle(suggestedTitle, 'Duplicar informe');
    if (newTitle === null) return; // cancelado
    const finalTitle = (newTitle || '').trim() || suggestedTitle;

    try {
      const full = await fetchReportById(report.id, reportTenantId);
      const parsed = JSON.parse(full.content_json ?? full.contentJson ?? '{}');
      const duplicatedDoc = {
        ...parsed,
        // Id local propio (mismo patrón que useEditorStore::createNewDocument)
        // -- sin esto, el duplicado y el original comparten el mismo
        // document_id interno, el mismo problema de fondo que causaba la
        // colisión de borradores offline ya corregida antes.
        document_id: `rep_${Date.now()}`,
        meta: { ...(parsed.meta || {}), author: loggedAuthor, updatedAt: new Date().toISOString() },
      };
      const saved = await saveReportAsync({
        id: undefined, // fuerza POST -- informe nuevo, nunca pisa el original
        title: finalTitle,
        contentJson: JSON.stringify(duplicatedDoc),
        status: 'draft',
      });
      setReportsRefreshToken((tk) => tk + 1);
      setAiStatus(saved?.id ? `Duplicado "${finalTitle}" creado.` : 'Duplicado creado.');
    } catch (err) {
      log.error('handleDuplicateReport', err);
      void requestNotice(t('notice.duplicateError'));
    }
  };

  // ADR-021 (revisado): prefiere la versión confirmada por el servidor
  // (ADR-015); doc.meta.version (contador local de ediciones) solo se usa
  // como fallback antes del primer guardado, cuando aún no hay version_number.
  const versionLabel = useMemo(
    () => `v${currentReportVersionNumber ?? doc.meta.version}`,
    [currentReportVersionNumber, doc.meta.version],
  );

  const handleReviewDocument = () => {
    const result = reviewDocumentQuality();
    setReviewResult(result);
    setShowReview(true);
  };

  const handleOptimizeDocument = async () => {
    setIsOptimizing(true);
    setAiStatus('IA preparando sugerencias de sintaxis y orden...');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const suggestions = getOptimizationSuggestions();
    setIsOptimizing(false);

    if (suggestions.length === 0) {
      setAiStatus('No se encontraron mejoras necesarias para aplicar con IA.');
      setShowAiReview(false);
      setAiSuggestions([]);
      return;
    }

    setAiSuggestions(suggestions.map((item) => ({ ...item, decision: 'pending' as const })));
    setAiSeverityFilter('todas');
    setAiSearchTerm('');
    setShowAiReview(true);
    setAiStatus(`IA detectó ${suggestions.length} mejora(s). Revisa y decide aplicar.`);
  };

  const markSuggestion = (id: string, decision: AiSuggestion['decision']) => {
    setAiSuggestions((prev) => prev.map((item) => (item.id === id ? { ...item, decision } : item)));
  };

  const applySingleSuggestion = (item: AiSuggestion) => {
    applyOptimizationSuggestion(item);
    markSuggestion(item.id, 'accepted');
    setAiStatus(`Cambio aplicado en página ${item.pageNumber}.`);
  };

  const applyAllPendingSuggestions = () => {
    const pending = aiSuggestions.filter((item) => item.decision !== 'rejected');
    const result = applyOptimizationBatch(pending);
    setAiSuggestions((prev) => prev.map((item) => ({ ...item, decision: item.decision === 'rejected' ? 'rejected' : 'accepted' })));
    setAiStatus(`IA aplicó ${result.applied} mejora(s) seleccionada(s).`);
  };

  const applyHighSeveritySuggestions = () => {
    const high = aiSuggestions.filter(
      (item) => item.severity === 'alta' && item.decision !== 'rejected',
    );
    const result = applyOptimizationBatch(high);
    setAiSuggestions((prev) =>
      prev.map((item) => {
        if (item.decision === 'rejected') {
          return item;
        }
        if (item.severity === 'alta') {
          return { ...item, decision: 'accepted' };
        }
        return item;
      }),
    );
    setAiStatus(`IA aplicó ${result.applied} mejora(s) de severidad alta.`);
  };

  const bumpImageInsertModal = useCallback(() => {
    setImageInsertOpenSeq((n) => n + 1);
  }, []);

  const openImageInsertForNew = useCallback(() => {
    imageInsertIntentRef.current = null;
    setImageInsertReplaceTarget(null);
    setImageInsertInitialTab('file');
    bumpImageInsertModal();
    setShowImageInsertModal(true);
    setAiStatus('Elija archivo local o cámara web; al confirmar se insertará la imagen en la página activa.');
  }, [bumpImageInsertModal]);

  const openVideoInsertForNew = useCallback((initialTab: 'webcam' | 'screen' = 'webcam') => {
    setVideoInsertInitialTab(initialTab);
    setVideoInsertOpenSeq((n) => n + 1);
    setShowVideoInsertModal(true);
    setAiStatus('Elija cámara web o pantalla/ventana; al confirmar se insertará el video en la página activa.');
  }, []);

  // El botón "Grabar" (RibbonToolbar y LeftLibrary) grababa la pantalla y
  // forzaba la descarga de un .webm al disco (ver antiguo handleExportVideo)
  // -- pedido explícito del negocio: debe insertarse directo en el lienzo,
  // igual que "Insertar Video" (biblioteca de contenidos). Reutiliza el mismo
  // modal, abierto directo en la pestaña "Pantalla/Ventana".
  const handleRecordScreenToCanvas = useCallback(() => {
    openVideoInsertForNew('screen');
  }, [openVideoInsertForNew]);

  // ── Callbacks estables para LeftLibrary (React.memo) ──
  // Antes eran arrow functions inline en el JSX: se recreaban en cada
  // render de App.jsx (que tiene ~30 useState) y anulaban cualquier memo
  // posible en LeftLibrary, sin importar cómo estuviera implementado.
  const handleLeftLibraryAdd = useCallback((type: string) => {
    if (type === 'map') {
      setShowMapCapture(true);
    } else if (type === 'image') {
      openImageInsertForNew();
    } else if (type === 'video') {
      openVideoInsertForNew();
    } else {
      addElement(type);
    }
  }, [addElement, openImageInsertForNew, openVideoInsertForNew]);

  const handleDuplicatePage = useCallback(() => {
    duplicatePage(selectedPage);
  }, [duplicatePage, selectedPage]);

  const handleAddFindings = useCallback(() => addTextTemplate('findings'), [addTextTemplate]);
  const handleAddAnnexes = useCallback(() => addTextTemplate('annexes'), [addTextTemplate]);
  const handleAddReferences = useCallback(() => addTextTemplate('references'), [addTextTemplate]);
  // Bloques Técnicos de presentación avanzada (cajas de resaltado, pie de
  // figura, tira de tarjetas KPI) — ver addTechnicalBlock en el store.
  const handleAddTechnicalBlock = useCallback((kind: string) => addTechnicalBlock(kind), [addTechnicalBlock]);
  const handleAddSectionTemplate = useCallback((kind: string) => addSectionTemplate(kind), [addSectionTemplate]);
  const handleAddStaticChart = useCallback((kind: string) => addStaticChart(kind), [addStaticChart]);

  const handleOpenApa7Modal = useCallback(() => setShowApa7Modal(true), []);
  const closeApa7Modal = useCallback(() => setShowApa7Modal(false), []);
  const handleApa7Insert = useCallback((apaText: string) => {
    addElement('text', { props: { text: `• ${apaText}`, fontSize: 12 } });
    setShowApa7Modal(false);
    setAiStatus('Referencia insertada con formato APA 7.');
  }, [addElement]);
  const handleAddCover = useCallback(() => addElement('cover'), [addElement]);
  // Pedido explícito del negocio: el índice solo se puede insertar en la
  // página 2 (nunca la 1, carátula) — addTocElement() crea esa página si
  // hace falta y no duplica si ya existe un TOC en el documento.
  const handleAddToc = useCallback(() => addTocElement(), [addTocElement]);

  const openImageInsertForReplace = useCallback(
    (pageNumber: number, elementId: string, initialTab = 'file') => {
      const tab = ['file', 'gallery', 'camera', 'network'].includes(initialTab) ? initialTab : 'file';
      const payload = { pageNumber, elementId };
      imageInsertIntentRef.current = payload;
      setImageInsertReplaceTarget(payload);
      setImageInsertInitialTab(tab);
      bumpImageInsertModal();
      setShowImageInsertModal(true);
      setAiStatus(
        tab === 'network'
          ? 'Elija una cámara de la red minera y capture un fotograma.'
          : tab === 'camera'
            ? 'Use la cámara web de esta estación y confirme la foto.'
            : 'Elija un archivo de imagen o use las otras pestañas del cuadro.',
      );
    },
    [bumpImageInsertModal],
  );

  // Botón "Insertar Imagen Empresa" / menú contextual de la carátula: la
  // imagen elegida (típicamente de la pestaña Galería) se inserta como un
  // bloque `image` NUEVO, libre y centrado en la página (ADR-048 revisado:
  // "una imagen única centrada... que después pueda moverse y
  // redimensionarse" — ya no es un fondo fijo del bloque carátula).
  const openImageInsertForCompanyImage = useCallback(
    (pageNumber: number, elementId: string) => {
      const payload: ImageInsertIntent = { pageNumber, elementId, mode: 'company-image' };
      imageInsertIntentRef.current = payload;
      setImageInsertReplaceTarget(payload);
      setImageInsertInitialTab('gallery');
      bumpImageInsertModal();
      setShowImageInsertModal(true);
      setAiStatus('Elija una foto registrada de la empresa — se insertará centrada, lista para mover y redimensionar.');
    },
    [bumpImageInsertModal],
  );

  const handleInsertCompanyImage = useCallback(() => {
    const page = doc.pages.find((p) => p.page_number === selectedPage);
    const cover = page?.elements.find((el) => el.type === 'cover');
    if (!page || !cover) {
      setAiStatus('Primero inserte un bloque de Carátula en esta página (Insertar → Portada).');
      return;
    }
    openImageInsertForCompanyImage(page.page_number, cover.id);
  }, [doc, selectedPage, openImageInsertForCompanyImage]);

  const handleImageInsertComplete = useCallback(
    (imageDataUrl: string) => {
      if (!imageDataUrl || imageDataUrl.length < 32) {
        setAiStatus('Error: imagen vacía o inválida.');
        return;
      }
      const target = imageInsertIntentRef.current;
      if (target?.mode === 'company-image' && target.pageNumber != null) {
        addCenteredImage(target.pageNumber, imageDataUrl);
        setAiStatus('Imagen insertada — puede moverla y redimensionarla libremente.');
      } else if (target?.pageNumber != null && target?.elementId) {
        updateElement(target.pageNumber, target.elementId, {
          src: imageDataUrl,
        });
        setAiStatus('Imagen del bloque actualizada.');
      } else {
        addElement('image', { src: imageDataUrl });
        setAiStatus('Imagen insertada en la página activa.');
      }
      imageInsertIntentRef.current = null;
      setShowImageInsertModal(false);
      setImageInsertReplaceTarget(null);
    },
    [addElement, addCenteredImage, updateElement, doc],
  );

  const closeVideoInsertModal = useCallback(() => {
    setShowVideoInsertModal(false);
  }, []);

  const handleVideoInsertComplete = useCallback(
    (videoDataUrl: string, meta: { source: 'webcam' | 'screen'; durationSeconds: number; mimeType: string }) => {
      if (!videoDataUrl || videoDataUrl.length < 32) {
        setAiStatus('Error: video vacío o inválido.');
        return;
      }
      addElement('video', {
        src: videoDataUrl,
        props: {
          source: meta.source,
          mimeType: meta.mimeType,
          durationSeconds: meta.durationSeconds,
        },
      });
      setAiStatus(`Video (${meta.source === 'webcam' ? 'cámara web' : 'pantalla'}, ${meta.durationSeconds}s) insertado en la página activa.`);
      setShowVideoInsertModal(false);
    },
    [addElement],
  );

  const closeImageInsertModal = useCallback(() => {
    imageInsertIntentRef.current = null;
    setShowImageInsertModal(false);
    setImageInsertReplaceTarget(null);
  }, []);

  // ── Handler para insertar imagen capturada del mapa ──
  const handleMapCaptureComplete = (imageDataUrl: string) => {
    if (!imageDataUrl || imageDataUrl.length < 100) {
      log.error('Imagen de captura vacía o inválida');
      setAiStatus('Error: La imagen del mapa no se capturó correctamente. Intenta nuevamente.');
      return;
    }

    setShowMapCapture(false);

    addElement('image', {
      src: imageDataUrl,
      width: 350,
      height: 280,
      objectFit: 'cover',
      props: {
        alt: 'Captura del Mapa Detallado Pro',
        borderRadius: 8,
        borderColor: '#cbd5e1',
        borderWidth: 2,
      },
    });

    setAiStatus('Imagen de mapa insertada correctamente en la página actual.');
  };

  const aiFilteredSuggestions = useMemo(() => {
    const query = aiSearchTerm.trim().toLowerCase();
    return aiSuggestions.filter((item) => {
      const bySeverity = aiSeverityFilter === 'todas' || item.severity === aiSeverityFilter;
      const byQuery =
        !query ||
        item.originalText.toLowerCase().includes(query) ||
        item.optimizedText.toLowerCase().includes(query) ||
        String(item.pageNumber).includes(query);
      return bySeverity && byQuery;
    });
  }, [aiSuggestions, aiSeverityFilter, aiSearchTerm]);

  const aiCounters = useMemo(() => {
    const total = aiSuggestions.length;
    const alta = aiSuggestions.filter((item) => item.severity === 'alta').length;
    const media = aiSuggestions.filter((item) => item.severity === 'media').length;
    const leve = aiSuggestions.filter((item) => item.severity === 'leve').length;
    return { total, alta, media, leve };
  }, [aiSuggestions]);

  const handleZoomIn = () => setZoomPercent((prev) => Math.min(400, prev + 10));
  const handleZoomOut = () => setZoomPercent((prev) => Math.max(10, prev - 10));
  const handleZoomSet = (value: number) => setZoomPercent(Math.min(400, Math.max(10, Math.round(value) || 100)));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const handleSyncMiningKpis = async () => {
    if (isSyncingKpis) {
      return;
    }
    try {
      setIsSyncingKpis(true);
      let lastError;
      const delays = [700, 1400, 2800];
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        try {
          const external = await syncMiningKpisFromExternal();
          let totalSynced = Number(external?.synced ?? 0);
          let source = 'fuente externa';
          let note = external?.message || '';
          let runtimeCount = Number(external?.existing_runtime ?? 0);
          if (totalSynced <= 0) {
            const local = await syncMiningKpisFromDashboard();
            totalSynced = Number(local?.synced ?? 0);
            source = 'dashboard local';
            note = local?.message || note;
            runtimeCount = Number(local?.existing_runtime ?? runtimeCount ?? 0);
          }
          let msg = `Sin nuevos KPI para sincronizar (${source}). ${note}`.trim();
          if (totalSynced > 0) {
            msg = `KPI sincronizados (${source}): ${totalSynced}`;
          } else if (/mantienen KPI runtime/i.test(String(note || '')) || runtimeCount > 0) {
            msg = `KPI vigentes sin cambios (${source}). Activos: ${runtimeCount}`;
          }
          setAiStatus(msg);
          setSyncToast({
            type: totalSynced > 0 ? 'success' : 'warning',
            message: msg,
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('report-kpi-sync-complete'));
          }
          return;
        } catch (err) {
          lastError = err;
          if (attempt < delays.length - 1) {
            await wait(delays[attempt]);
          }
        }
      }
      throw lastError || new Error('No se pudo sincronizar KPI');
    } catch (err: any) {
      const message = err?.message || 'No se pudo sincronizar KPI desde operación.';
      setAiStatus(message);
      setSyncToast({ type: 'error', message });
    } finally {
      setIsSyncingKpis(false);
    }
  };

  useEffect(() => {
    if (!kpiAutoSyncEnabled) {
      return undefined;
    }
    const timer = setInterval(() => {
      handleSyncMiningKpis();
    }, 180000);
    return () => clearInterval(timer);
  }, [kpiAutoSyncEnabled]);

  // ── Recuperación de borradores locales huérfanos ──────────────────────────
  // DESACTIVADO 2026-09-08 (pedido explícito) -- este efecto disparaba una
  // ventana de confirmación POR CADA borrador huérfano encontrado, una
  // detrás de otra, apenas arrancaba la app: molesto con varios documentos
  // sin sincronizar. Se comenta entero (no se borra) para no perder el
  // diseño -- la MISMA función se sigue usando, pero ahora desde una
  // sección "Documentos sin conexión" dentro de ReportsAdminModal.tsx (no
  // intrusiva, el usuario entra cuando quiere) -- ver
  // handleRestoreOfflineDraft más abajo, que hace exactamente lo que hacía
  // el `if (restore)` de este loop.
  //
  // Un informe NUEVO que el usuario editó pero nunca llegó a guardar (sin id
  // de servidor) no aparece en "Mis informes" — si se cerró la pestaña o se
  // cortó la conexión antes del primer "Guardar", su único rastro es el
  // snapshot en SQLite local bajo su document_id (ver motor de autosave más
  // abajo). Se revisaba una sola vez por sesión, apenas había sesión
  // iniciada, y solo si el documento actual estaba vacío y sin id — para no
  // reemplazar de golpe un informe que el usuario ya estuviera editando en
  // esta misma pestaña.
  //
  // Se preguntaba por TODOS los huérfanos encontrados, uno por uno (más
  // reciente primero) — no solo el último: si el usuario creaba varios
  // informes nuevos sin conexión seguidos (p.ej. con "Nuevo informe" ya
  // protegido offline, ver handleNewReport), antes solo se ofrecía
  // recuperar el más reciente y los demás quedaban a salvo en SQLite pero
  // sin que nadie los volviera a ofrecer.
  //
  // const orphanDraftCheckedRef = useRef(false);
  // useEffect(() => {
  //   if (!session || orphanDraftCheckedRef.current) return;
  //   if (currentReportId || hasUnsavedUserContent()) return;
  //   orphanDraftCheckedRef.current = true;
  //   (async () => {
  //     try {
  //       const orphans = await findOrphanedLocalDrafts();
  //       const locale = language === 'pt' ? 'pt-BR' : language === 'fr' ? 'fr-CA' : language === 'en' ? 'en-US' : 'es-PE';
  //       for (const orphan of orphans) {
  //         if (orphan.reportId === doc.document_id) continue;
  //         const restore = await requestConfirmation(t('confirm.restoreOffline', {
  //           date: new Date(orphan.updatedAt).toLocaleString(locale),
  //         }));
  //         if (restore) {
  //           loadDocument(orphan.documentJson, null, orphan.title || currentReportTitle);
  //           setAiStatus('Borrador local recuperado (nunca se había guardado en el servidor) — se guardará al presionar "Guardar".');
  //           break;
  //         }
  //         // Si declina: NO se marca sincronizado — a diferencia del caso de
  //         // un informe ya guardado (que siempre tiene una copia de respaldo
  //         // en el servidor), este borrador no existe en ningún otro lado,
  //         // así que "no ahora" no debe borrarlo. Se sigue preguntando por
  //         // los demás huérfanos de esta pasada; este también se volverá a
  //         // ofrecer en el próximo arranque de la app.
  //       }
  //     } catch (err) {
  //       log.warn('No se pudo revisar borradores locales huérfanos', err);
  //     }
  //   })();
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [session]);

  /** Restaura un borrador local huérfano elegido desde la sección
   * "Documentos sin conexión" de ReportsAdminModal.tsx -- mismo efecto que
   * tenía confirmar "sí" en la ventana emergente ahora desactivada arriba:
   * carga el documento en el editor y cierra el wizard de administración.
   * NO marca el snapshot como sincronizado -- eso lo sigue haciendo
   * handleSaveReport recién cuando el primer "Guardar" manual obtiene un id
   * real del servidor (ADR-022), igual que antes. */
  const handleRestoreOfflineDraft = useCallback((draft: { documentJson: any; title: string }) => {
    loadDocument(draft.documentJson, null, draft.title || currentReportTitle);
    setAiStatus('Borrador local recuperado (nunca se había guardado en el servidor) — se guardará al presionar "Guardar".');
    setShowReportsAdmin(false);
  }, [loadDocument, currentReportTitle]);

  // ── Precarga de la base SQLite offline apenas hay señal real (ADR-022,
  // bug real reportado 2026-09-08): getOfflineDb() necesita red la PRIMERA
  // vez que se usa en un navegador (descarga una plantilla del servidor,
  // ver offlineSqlite.ts) -- si esa primera descarga nunca ocurrió mientras
  // había señal, la primera desconexión real de la sesión deja sin forma de
  // guardar nada localmente (ni en el servidor, obvio, ni en SQLite, porque
  // ESA descarga también necesita red). El comentario original de
  // offlineSqlite.ts ya documentaba esta intención ("se invoca desde el
  // primer chequeo de conectividad exitoso de la sesión") pero nunca quedó
  // cableada -- solo existían llamadas reactivas (cuando ya hacía falta
  // escribir/leer, demasiado tarde si eso pasa offline). getOfflineDb() es
  // barata de llamar de más (cachea la promesa una vez resuelta), así que
  // se reintenta en cada transición a un estado no-OFFLINE, no solo la
  // primera del montaje -- se autorecupera si el primer intento falló por
  // otra razón transitoria (p.ej. sesión aún no lista).
  useEffect(() => {
    if (connectivity.state === 'OFFLINE') return;
    void getOfflineDb().catch((err) => {
      log.warn('[OFFLINE] No se pudo precargar la base local offline con la señal disponible:', err);
    });
  }, [connectivity.state]);

  // ── Conectividad offline: aviso en el lienzo + registro del instante exacto
  // de la caída (pedido explícito del negocio: "indicar en el lienzo un
  // mensaje que indique fuera de línea con la fecha y hora que se perdió la
  // conexión"). Al reconectar, empuja cualquier snapshot offline pendiente
  // del informe abierto — sin esto, un cambio guardado localmente durante un
  // corte se quedaría solo en el navegador hasta el siguiente autosave, que
  // podría sobrescribirlo con una versión más vieja si `doc` no cambió desde
  // entonces.
  useEffect(() => {
    const reportKey = currentReportId || 'unsaved';
    if (connectivity.state === 'OFFLINE') {
      if (!offlineSince) {
        const now = new Date().toISOString();
        setOfflineSince(now);
        recordWentOffline(reportKey, now).catch((err) => log.warn('[OFFLINE] recordWentOffline falló', err));
      }
      return;
    }
    if (offlineSince) {
      const now = new Date().toISOString();
      recordCameOnline(reportKey, now).catch((err) => log.warn('[OFFLINE] recordCameOnline falló', err));
      setOfflineSince(null);

      // Informe NUNCA guardado en el servidor que el usuario guardó
      // explícitamente mientras estaba offline (ver pendingOfflineCreateFor
      // en handleSaveReport) — se termina de crear apenas vuelve la señal,
      // sin depender de qué informe esté abierto en pantalla en ESTE
      // momento (el usuario pudo haber seguido trabajando en otro mientras
      // tanto). Independiente del bloque de abajo (que sincroniza el
      // informe YA guardado que esté abierto ahora) — ambos pueden aplicar
      // a la vez en la misma reconexión.
      if (pendingOfflineCreateFor) {
        const targetDraftId = pendingOfflineCreateFor;
        // Actualización funcional en cada `setPendingOfflineCreateFor` de
        // este bloque: si mientras esta subida está en vuelo el usuario
        // guardó OTRO informe nuevo offline (valor más reciente), no hay
        // que perder de vista ESE — solo se limpia si sigue siendo el mismo
        // que se está procesando acá.
        const clearIfStillTarget = () =>
          setPendingOfflineCreateFor((current) => (current === targetDraftId ? null : current));
        (async () => {
          // isSaving también deshabilita el botón "Guardar" del ribbon —
          // evita que el usuario dispare un guardado manual mientras esta
          // subida automática todavía está en vuelo (crearía el mismo
          // informe DOS veces: un POST acá y otro desde handleSaveReport).
          setIsSaving(true);
          try {
            const pendingDraft = await loadOfflineSnapshot(targetDraftId);
            if (!pendingDraft?.dirty || !session) {
              // Ya no hay nada pendiente para este id (se sincronizó por
              // otra vía, p.ej. un "Guardar" manual mientras tanto) — no
              // tiene sentido seguir reintentando algo que ya no existe.
              clearIfStillTarget();
              return;
            }
            const saved = await saveReportAsync({
              id: undefined, // nunca existió en el servidor -- fuerza POST
              title: pendingDraft.title || currentReportTitle,
              contentJson: JSON.stringify(pendingDraft.documentJson),
              status: 'draft',
              createdBy: session.userId,
              company: session.company || 'default',
            });
            if (!saved?.id) return; // respuesta inesperada -- se reintenta en la próxima reconexión
            await markOfflineSnapshotSynced(targetDraftId);
            clearIfStillTarget();
            // Si el usuario SIGUE en ese mismo documento (no se pasó a
            // editar otro mientras esperaba la reconexión), se vincula en
            // vivo al id real recién creado. Si ya se movió a otro informe,
            // esto NO debe tocar lo que está en pantalla ahora — le
            // asignaría el id equivocado a un documento distinto. De
            // cualquier forma queda creado y a salvo en el servidor.
            if (useEditorStore.getState().doc.document_id === targetDraftId) {
              setCurrentReportId(saved.id);
              if (typeof saved?.version_number === 'number') {
                setCurrentReportVersionNumber(saved.version_number);
              }
              setAiStatus('Reconectado: el informe que guardaste sin conexión ya se subió al servidor.');
            } else {
              setAiStatus('Reconectado: un informe que habías guardado sin conexión ya se subió al servidor (búscalo en "Mis informes").');
            }
          } catch (err) {
            // pendingOfflineCreateFor se deja intacto A PROPÓSITO -- si
            // esto falló por algo transitorio (p.ej. la conexión se cortó
            // de nuevo justo al reconectar), se reintenta solo en la
            // próxima reconexión real, sin perder de vista el borrador.
            log.error('[OFFLINE] No se pudo terminar de crear el informe pendiente al reconectar', err);
            setAiStatus('Reconectado, pero no se pudo subir un informe guardado sin conexión — se reintentará en la próxima reconexión.');
          } finally {
            setIsSaving(false);
          }
        })();
      }

      (async () => {
        try {
          const pending = await loadOfflineSnapshot(reportKey);
          if (!pending?.dirty || !session || !currentReportId) return;
          try {
            // ADR-022: concurrencia optimista — se envía la versión de la
            // que partió esta edición offline. Si nadie más tocó el informe
            // mientras estábamos sin conexión, el servidor la acepta sin
            // más preguntas (caso común). Si alguien más SÍ guardó una
            // versión distinta (otra terminal, online), el servidor
            // responde 409 y NO aplica el cambio — recién ahí se pregunta.
            const saved = await saveReportAsync({
              id: currentReportId,
              title: pending.title || currentReportTitle,
              contentJson: JSON.stringify(pending.documentJson),
              status: workflowStatus,
              createdBy: session.userId,
              company: session.company || 'default',
              expectedVersion: pending.baseVersionNumber ?? undefined,
            });
            await markOfflineSnapshotSynced(reportKey);
            if (typeof saved?.version_number === 'number') {
              useEditorStore.getState().setCurrentReportVersionNumber(saved.version_number);
            }
            setAiStatus('Reconectado: cambios guardados sin conexión sincronizados con el servidor.');
          } catch (err: any) {
            if (err?.response?.status === 409) {
              const serverVersion = err.response.data?.server_version;
              const wantsServerVersion = await requestConfirmation(t('confirm.serverVersion', {
                server: serverVersion ?? '—',
                local: pending.baseVersionNumber ?? '—',
              }));
              if (wantsServerVersion) {
                const full = await fetchReportById(currentReportId);
                const docPayload = full.content_json ?? full.contentJson;
                loadDocument(docPayload, full.id, full.title);
                setCurrentReportVersionNumber(typeof full.version_number === 'number' ? full.version_number : null);
                await markOfflineSnapshotSynced(reportKey);
                setWorkingOfflineConflict(false);
                setAiStatus(`Actualizado a la versión ${full.version_number} del servidor — tus cambios offline fueron descartados.`);
              } else {
                setWorkingOfflineConflict(true);
                setAiStatus('Hay conexión al servidor, pero este informe sigue en modo OFFLINE — se te preguntará cómo proceder al guardar.');
              }
            } else {
              throw err;
            }
          }
        } catch (err) {
          log.error('[OFFLINE] Sincronización al reconectar falló', err);
          setAiStatus('Reconectado, pero la sincronización de cambios offline falló — se reintentará en el próximo autoguardado.');
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectivity.state, currentReportId, pendingOfflineCreateFor]);

  // ── Autosave engine ──
  useEffect(() => {
    const unsub = subscribeAutosave((state) => setAutosaveStatus(state.status));
    startAutosave(
      () => useEditorStore.getState().doc,
      async (doc) => {
        if (!session) return;
        // Informe recién creado que TODAVÍA no tiene id real del servidor
        // (currentReportId null — ver useEditorStore.createNewDocument): no
        // hay id con el que hacer PUT, y crear una fila en el servidor aquí
        // sería un POST silencioso sin que el usuario haya elegido título vía
        // "Guardar". Se persiste solo en SQLite local, bajo doc.document_id
        // (el id local estable que el store asigna desde el momento en que
        // crea el documento) — sin esto, un informe nuevo editado y nunca
        // guardado no tenía NINGÚN respaldo (ni servidor ni SQLite) si se
        // cerraba la pestaña o se cortaba la conexión antes del primer
        // guardado manual. Se recupera desde la sección "Documentos sin
        // conexión" de ReportsAdminModal.tsx (vía findOrphanedLocalDrafts;
        // el efecto de arranque automático que la ofrecía antes quedó
        // comentado más abajo, ver handleRestoreOfflineDraft).
        if (!currentReportId) {
          await persistCurrentDocOffline(doc);
          return;
        }
        // Sin conexión real (verificada contra el propio backend, no solo
        // navigator.onLine — ver connectivityMonitor.ts) O con un conflicto
        // offline sin resolver (ADR-022: el usuario eligió seguir trabajando
        // con su copia local aunque haya vuelto la señal — ver el efecto de
        // reconexión de arriba): el guardado sigue yendo a SQLite local, no
        // al servidor, hasta que el usuario resuelva el conflicto al
        // presionar "Guardar" (handleSaveReport).
        if (connectivity.state === 'OFFLINE' || workingOfflineConflict) {
          await persistCurrentDocOffline(doc);
          return;
        }
        const saved = await saveReportAsync({
          id: currentReportId,
          title: currentReportTitle,
          contentJson: JSON.stringify(doc),
          status: workflowStatus,
          createdBy: session.userId,
          company: session.company || 'default',
        });
        // ADR-021 (revisado): cada autosave confirmado también genera una
        // revisión nueva (ADR-015) — sin esto, "Versión: vN" se quedaba
        // desactualizado entre guardados manuales.
        if (typeof saved?.version_number === 'number') {
          useEditorStore.getState().setCurrentReportVersionNumber(saved.version_number);
        }
      },
      currentReportId,
    );
    return () => { stopAutosave(); unsub(); };
  }, [currentReportId, session?.username, connectivity.state, workingOfflineConflict, currentReportVersionNumber, persistCurrentDocOffline]);

  // ── Checkpoint forzado cada 3 minutos en línea (pedido explícito del
  // negocio, ADR-022) ──
  // Independiente del autosave de arriba (que solo guarda cuando detecta un
  // diff, cada 5s): esto es una red de seguridad adicional — mientras haya
  // conexión real y el informe no tenga un conflicto offline sin resolver,
  // fuerza un guardado del estado actual cada 3 minutos exactos,
  // incondicionalmente (haya o no haya diff detectado), para garantizar que
  // la base de datos centralizada nunca quede más de 3 minutos desactualizada
  // aunque el autosave por diff fallara silenciosamente por algún motivo.
  // Trade-off aceptado y documentado en ADR-022: puede generar una entrada
  // de report_content_revision con contenido idéntico si no hubo cambios
  // reales — costo bajo frente a la garantía de frescura.
  useEffect(() => {
    if (!session || !currentReportId) return undefined;
    const CHECKPOINT_INTERVAL_MS = 3 * 60 * 1000;
    const timer = setInterval(async () => {
      if (connectivity.state === 'OFFLINE' || workingOfflineConflict) return;
      try {
        const currentDoc = useEditorStore.getState().doc;
        const saved = await saveReportAsync({
          id: currentReportId,
          title: currentReportTitle,
          contentJson: JSON.stringify(currentDoc),
          status: workflowStatus,
          createdBy: session.userId,
          company: session.company || 'default',
        });
        if (typeof saved?.version_number === 'number') {
          useEditorStore.getState().setCurrentReportVersionNumber(saved.version_number);
        }
      } catch (err) {
        log.error('[CHECKPOINT_3MIN] Sincronización periódica falló', err);
      }
    }, CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentReportId, session, currentReportTitle, workflowStatus, connectivity.state, workingOfflineConflict]);

  // ── Workflow transitions ──
  // ADR-017: el servidor es la autoridad de la máquina de estados. Antes,
  // esto solo tocaba estado local de React y esperaba al próximo ciclo de
  // autosave para llegar al backend — una transición inválida (o rechazada
  // por otro motivo) quedaba "aceptada" en la UI sin que el usuario lo supiera
  // hasta minutos después. Ahora se llama al backend de inmediato y el
  // estado local solo avanza si el servidor confirma la transición.
  // ADR-012: al firmar, cada widget kpi/sensor debe congelar el valor citado
  // (snapshot) para que el informe firmado sea reproducible aunque el dato
  // real cambie después. Hallazgo real durante la implementación: ni
  // ReadOnlyViewer.tsx ni exportEngine.ts (DOCX) ni el export PDF (que reusa
  // ReadOnlyViewer, ADR-016) leían nunca `props.value`/snapshot alguno para
  // kpi/sensor — un informe con esos bloques se veía vacío ("—") al
  // exportarlo o abrirlo en solo-lectura, incluso ya firmado. No se tocó el
  // polling en vivo de MiningKpiWidget/SensorWidget (sigue igual durante la
  // edición activa, cero riesgo a esa funcionalidad ya verificada) — en su
  // lugar, justo antes de confirmar la transición a 'signed', se re-consulta
  // el valor actual de cada kpi/sensor citado en el documento (mismas
  // funciones de API que ya usan los propios widgets) y se escribe como
  // `element.props.snapshot` vía el store, antes de guardar.
  const captureLiveSnapshotsForSigning = useCallback(async () => {
    const currentDoc = useEditorStore.getState().doc;
    const kpiTargets: Array<{ pageNumber: number; element: any }> = [];
    const sensorTargets: Array<{ pageNumber: number; element: any }> = [];
    const seismicTargets: Array<{ pageNumber: number; element: any }> = [];
    for (const page of currentDoc.pages) {
      for (const element of page.elements) {
        if (element.type === 'kpi') kpiTargets.push({ pageNumber: page.page_number, element });
        else if (element.type === 'sensor') sensorTargets.push({ pageNumber: page.page_number, element });
        else if (element.type === 'seismic-report') seismicTargets.push({ pageNumber: page.page_number, element });
      }
    }
    if (kpiTargets.length === 0 && sensorTargets.length === 0 && seismicTargets.length === 0) {
      return;
    }

    const capturedAt = new Date().toISOString();
    const updateElementFn = useEditorStore.getState().updateElement;

    if (kpiTargets.length > 0) {
      try {
        const kpis = await fetchMiningKpis();
        for (const { pageNumber, element } of kpiTargets) {
          const kpi = kpis.find((k: any) => String(k.code || '') === String(element.props?.kpiCode || ''));
          if (!kpi) continue;
          updateElementFn(pageNumber, element.id, {
            props: {
              ...element.props,
              snapshot: {
                value: kpi.current_value != null ? Number(kpi.current_value) : null,
                unit: kpi.unit || '',
                trendDirection: kpi.trend_direction || '',
                trendPercent: kpi.trend_percent != null ? Number(kpi.trend_percent) : null,
                capturedAt,
                sourceVersion: kpi.updated_at || capturedAt,
              },
            },
          });
        }
      } catch (err) {
        log.error('No se pudo capturar snapshot de KPI antes de firmar', err);
      }
    }

    if (sensorTargets.length > 0) {
      try {
        const sensors = await fetchMineSensors(telemetryTenantId);
        for (const { pageNumber, element } of sensorTargets) {
          const sid = Number(element.props?.sensorId);
          const sensor = sensors.find((s: any) => Number(s.id) === sid);
          if (!sensor) continue;
          updateElementFn(pageNumber, element.id, {
            props: {
              ...element.props,
              snapshot: {
                value: sensor.current_value != null ? Number(sensor.current_value) : null,
                unit: sensor.unit || '',
                capturedAt,
              },
            },
          });
        }
      } catch (err) {
        log.error('No se pudo capturar snapshot de sensores antes de firmar', err);
      }
    }

    if (seismicTargets.length > 0) {
      // Cada bloque puede tener su propio rango de fechas -- se consulta uno
      // por uno (no hay endpoint batch) en vez de asumir un rango compartido.
      for (const { pageNumber, element } of seismicTargets) {
        const start = element.props?.startDate;
        const end = element.props?.endDate;
        if (!start || !end) continue;
        try {
          const data = await fetchSeismicReport(start, end);
          updateElementFn(pageNumber, element.id, {
            props: {
              ...element.props,
              snapshot: {
                igpEvents: data?.igp?.events || [],
                companyCount: (data?.company?.events || []).length,
                fetchedAt: capturedAt,
              },
            },
          });
        } catch (err) {
          log.error('No se pudo capturar snapshot de reporte sísmico antes de firmar', err);
        }
      }
    }
  }, [telemetryTenantId]);

  const handleWorkflowTransition = useCallback(async (nextStatus: WorkflowStatus, comment: string) => {
    if (!currentReportId) {
      setAiStatus('Guarde el informe antes de cambiar su estado de workflow.');
      return;
    }
    const previousStatus = workflowStatus;
    let docToSave = doc;
    if (nextStatus === 'signed') {
      await captureLiveSnapshotsForSigning();
      docToSave = useEditorStore.getState().doc;
    }
    try {
      const saved = await saveReportAsync({
        id: currentReportId,
        title: currentReportTitle,
        contentJson: JSON.stringify(docToSave),
        status: nextStatus,
        createdBy: session?.userId,
        company: session?.company || 'default',
        // ADR-030: el comentario (p.ej. motivo de rechazo) viaja al servidor
        // para quedar en la entrada de auditoría de esta transición. Antes
        // solo se guardaba en el `auditLog` local (bitácora en pantalla y
        // export .miningreport), nunca llegaba al rastro forense real.
        workflowComment: comment,
      });
      // ADR-021 (revisado): una transición de workflow también confirma una
      // revisión nueva (mismo UPDATE atómico en el backend).
      if (typeof saved?.version_number === 'number') {
        setCurrentReportVersionNumber(saved.version_number);
      }
    } catch (err: any) {
      const serverError = err?.response?.data?.error || '';
      const serverNeed = err?.response?.data?.need || '';
      const serverStatus = err?.response?.status;
      // ADR-079: el backend es la autoridad real — estos casos pueden
      // dispararse aunque el botón ya esté filtrado por permiso (p.ej. el
      // permiso del usuario cambió en otra pestaña, o el estado del informe
      // cambió mientras se revisaba).
      if (serverStatus === 400 && serverError.startsWith('invalid_workflow_transition')) {
        setAiStatus(`Transición rechazada: ${previousStatus} → ${nextStatus} no es válida.`);
      } else if (serverStatus === 403 && serverError === 'forbidden') {
        setAiStatus(`No tiene permiso para esta acción${serverNeed ? ` (requiere: ${serverNeed})` : ''}.`);
      } else if (serverStatus === 409 && serverError === 'report_immutable') {
        setAiStatus('Este informe ya está firmado/archivado y no puede modificarse.');
      } else {
        log.error('Workflow transition failed', err);
        setAiStatus('Error al aplicar la transición de workflow. Intente nuevamente.');
      }
      return;
    }
    const prevHash = auditLog.length > 0 ? auditLog[auditLog.length - 1].hash : '00000000';
    const entry = createWorkflowEntry(
      `${previousStatus} → ${nextStatus}`,
      loggedAuthor,
      prevHash,
      comment,
    );
    setAuditLog((prev) => [...prev, entry]);
    setWorkflowStatus(nextStatus);
    setAiStatus(`Workflow: ${nextStatus.toUpperCase()}`);
    // ADR-018: la firma documental (nombre/cargo/fecha) la calcula el
    // servidor, nunca el cliente — se refresca desde el servidor tras firmar
    // en vez de fabricarla localmente.
    if (nextStatus === 'signed') {
      try {
        const refreshed = await fetchReportById(currentReportId);
        const signedByName = refreshed.signed_by_name ?? refreshed.signedByName ?? '';
        setReportSignature(
          signedByName
            ? {
                name: signedByName,
                role: refreshed.signed_by_role ?? refreshed.signedByRole ?? '',
                signedAt: refreshed.signed_at ?? refreshed.signedAt ?? '',
              }
            : null,
        );
      } catch (err) {
        log.error('No se pudo refrescar la firma documental tras firmar', err);
      }
    }
  }, [workflowStatus, auditLog, loggedAuthor, currentReportId, currentReportTitle, doc, session, captureLiveSnapshotsForSigning]);

  // ── .mreport export/import (portátil, cifrado server-side) ──
  // El archivo se genera y descifra SIEMPRE en el backend (única parte que
  // conoce BEEMETRY_REPORT_EXPORT_KEY) — por eso exportar exige que el
  // informe ya esté guardado (id real): no hay nada que cifrar del lado del
  // cliente sin pasar antes por el servidor.
  const handleExportMiningReport = useCallback(async () => {
    if (!currentReportId) {
      void requestNotice(t('notice.saveBeforePortable'));
      return;
    }
    setAiStatus('Exportando .mreport...');
    try {
      const { blob, filename } = await fetchReportPortableBlob(currentReportId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setAiStatus('Archivo .mreport exportado exitosamente.');
    } catch (err) {
      log.error('Export .mreport failed', err);
      setAiStatus('Error al exportar .mreport.');
    }
  }, [currentReportId]);

  const handleImportMiningReport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mreport';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const bytes = await file.arrayBuffer();
        const result = await importReportPortable(bytes);
        loadDocument(result.document, null, result.title);
        setWorkflowStatus('draft');
        setAuditLog([]);
        setAiStatus(
          result.tenant_match
            ? `Importado sin cambios: ${result.title || 'Informe'} (misma unidad minera).`
            : `Importado SOLO ESTRUCTURA: ${result.title || 'Informe'} — imágenes, KPIs, gráficos, mapas y sensores de "${result.source_company}" fueron ocultados (unidad minera distinta). El texto y las tablas se mantienen intactos.`,
        );
      } catch (err) {
        log.error('Import .mreport failed', err);
        setAiStatus('Error al importar archivo .mreport (¿corrupto o de otro backend?).');
      }
    };
    input.click();
  }, [loadDocument]);

  // Importar un documento Word MODERNO (.docx) y pintarlo en el lienzo --
  // ribbon Datos > Importación, pedido explícito 2026-09-09. mammoth.js solo
  // entiende el formato .docx (Office Open XML) -- un .doc viejo (formato
  // binario de Word 97-2003) no lo puede leer, por eso el selector de
  // archivo se restringe a esa extensión y se vuelve a validar al elegir
  // (un usuario puede forzar "todos los archivos" y elegir cualquier cosa).
  // Reutiliza el MISMO parser (`parseRichClipboardBlocks`) que ya usa el
  // pegado de Word/Google Docs -- mammoth convierte el .docx a HTML
  // (imágenes ya embebidas como data: URI, sin descargas aparte) y de ahí en
  // adelante es indistinguible de un pegado real. `mammoth` se importa DE
  // FORMA DINÁMICA (no al tope del archivo): es una librería pesada
  // (parseo de OOXML + JSZip) que la inmensa mayoría de sesiones nunca usa,
  // cargarla solo cuando de verdad se hace clic acá evita inflar el bundle
  // inicial de toda la app por una función que casi nadie dispara.
  const handleImportDocx = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.docx')) {
        setAiStatus('Solo se admiten documentos Word modernos (.docx) -- un .doc antiguo no es compatible.');
        return;
      }
      setAiStatus(`Importando "${file.name}"…`);
      try {
        const rawArrayBuffer = await file.arrayBuffer();
        // Nivela los DOS mecanismos de salto de página manual que existen
        // en el formato (Ctrl+Enter dentro del texto vs. "agregar salto de
        // página antes" como propiedad del párrafo -- este segundo NO lo
        // entiende mammoth en absoluto) para que ambos se vean iguales de
        // acá en adelante -- ver el comentario largo en docxPageBreaks.ts.
        const pageBreaksBuffer = await expandParagraphPageBreaks(rawArrayBuffer);
        // Color de texto directo + tamaño de fuente -- pedido explícito
        // 2026-09-10, probado en vivo con un TDR real ("no se estan
        // trayendo bien los colores del texto, tamaños"). Ver el comentario
        // largo en lib/docxPageBreaks.ts::enrichDocxTextStyles para el
        // porqué hace falta un paso aparte (mammoth ni siquiera lee el
        // color a su modelo interno).
        const { arrayBuffer, styleMap: textStyleMap } = await enrichDocxTextStyles(pageBreaksBuffer);
        const mammothModule = (await import('mammoth')) as unknown as { default?: typeof import('mammoth') };
        const mammoth = mammothModule.default ?? (mammothModule as unknown as typeof import('mammoth'));
        // `styleMap` para saltos de página MANUALES -- pedido explícito
        // 2026-09-09: "si hay texto en la página 1, es un solo bloque; si
        // hay texto en la página 2, es otro bloque". mammoth DESCARTA por
        // completo un salto de página manual (Ctrl+Enter en Word) al
        // convertir a HTML -- sin este mapeo, el texto de dos páginas
        // separadas por un salto queda indistinguible de un solo párrafo
        // largo. Esto lo redirige a un marcador (`<hr class="docx-page-break">`)
        // que `parseRichClipboardBlocks` (lib/richPaste.ts) reconoce y usa
        // para forzar el corte entre bloques de texto.
        // `transformDocument` + `DOCX_ALIGNMENT_STYLE_MAP` -- pedido explícito
        // 2026-09-09: "que traiga también la disposición del texto... si está
        // centrado... justificación". Ver el comentario largo en
        // lib/docxPageBreaks.ts::markParagraphAlignment para el por qué hace
        // falta esto (mammoth lee la alineación del .docx pero nunca la usa).
        const result = await mammoth.convertToHtml({ arrayBuffer }, {
          transformDocument: (element: any) => markRunFontSize(markParagraphAlignment(element)),
          styleMap: ["br[type='page'] => hr.docx-page-break", ...DOCX_ALIGNMENT_STYLE_MAP, ...DOCX_HIGHLIGHT_STYLE_MAP, ...textStyleMap],
        });
        const blocks = parseRichClipboardBlocks(result.value);
        if (blocks.length === 0) {
          setAiStatus(`No se pudo extraer contenido de "${file.name}".`);
          return;
        }
        // Sombreado de celda/encabezado -- pedido explícito 2026-09-10
        // ("los colores en la tabla"). mammoth no trae esto en el HTML en
        // absoluto (ver el comentario largo en
        // lib/docxPageBreaks.ts::extractDocxTableShading), así que se
        // extrae aparte del XML crudo y se empareja acá con el N-ésimo
        // bloque `table` -- mismo orden de documento en ambos lados.
        try {
          const shadingByTable = await extractDocxTableShading(rawArrayBuffer);
          let tableIndex = 0;
          blocks.forEach((block) => {
            if (block.kind !== 'table') return;
            const shading = shadingByTable[tableIndex];
            tableIndex += 1;
            if (!shading || shading.length === 0) return;
            shading.forEach(({ row, col, fill }) => {
              if (block.backgrounds[row] && block.backgrounds[row][col] === undefined) {
                block.backgrounds[row][col] = `#${fill}`;
              }
            });
          });
        } catch (shadingErr) {
          // El sombreado es un extra, nunca debe tumbar el import completo.
          log.warn('No se pudo extraer el sombreado de tabla del .docx', shadingErr);
        }
        // Tamaño/orientación/márgenes REALES del documento de origen --
        // mismo criterio que ya usa el import de PDF+OCR (ADR-199 §7,
        // arriba en handleImportPdfOcr) en vez de dejar todo en el A4
        // vertical por defecto del editor. Tiene que aplicarse ANTES de
        // `setPendingImportBlocks` -- el auto-paginado/auto-ajuste de
        // PageCanvas.tsx::processPasteBlocks calcula el ancho/alto
        // disponible contra el paperSize/orientation/margins YA vigentes
        // en el store en ese momento.
        try {
          const pageSetup = await extractDocxPageSetup(rawArrayBuffer);
          if (pageSetup) {
            const store = useEditorStore.getState();
            store.setPaperSize(pageSetup.paperSize);
            store.setOrientation(pageSetup.orientation);
            store.setPageMargins(pageSetup.margins);
          }
        } catch (pageSetupErr) {
          // El tamaño de página es un extra -- nunca debe tumbar el resto
          // del import (mismo criterio que el sombreado de tabla arriba).
          log.warn('No se pudo extraer el tamaño de página del .docx', pageSetupErr);
        }
        useEditorStore.getState().setPendingImportBlocks(blocks);
        setAiStatus(`"${file.name}" importado -- acomodando el contenido en el lienzo…`);
      } catch (err) {
        log.error('Import .docx failed', err);
        setAiStatus('Error al importar el documento Word (¿archivo corrupto o protegido?).');
      }
    };
    input.click();
  }, []);

  // Importar un PDF con OCR AVANZADO (ADR-199) -- ribbon Datos > Importación,
  // mismo lugar que "Importar Word (.docx)". A diferencia del .docx (parseo
  // 100% en el navegador con mammoth), acá el trabajo pesado ocurre en el
  // backend -> ai_engine -> sidecar ocr_engine (PaddleOCR PP-StructureV2):
  // texto digital cuando el PDF ya lo trae, OCR real solo en páginas
  // escaneadas -- ver docs/decisions/199-importacion-pdf-ocr-avanzado.md.
  // Puede tardar de verdad (varios minutos en un documento con muchas
  // páginas escaneadas), por eso el estado intermedio es explícito en vez de
  // un genérico "Importando…".
  const handleImportPdfOcr = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.bmp,application/pdf,image/png,image/jpeg,image/bmp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const lowerName = file.name.toLowerCase();
      const isSupportedName = /\.(pdf|png|jpe?g|bmp)$/.test(lowerName);
      if (!isSupportedName) {
        setAiStatus('Solo se admiten archivos PDF o imágenes PNG/JPG/JPEG/BMP.');
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        // Firma real del archivo ANTES de subirlo -- gap que ADR-173 dejó
        // pendiente para .docx (validación solo por extensión), resuelto
        // acá desde el día 1: un archivo renombrado a .pdf que no lo es se
        // rechaza acá mismo, sin gastar una subida completa ni tiempo de OCR.
        const header = new Uint8Array(bytes.slice(0, 8));
        const isPdfSignature = String.fromCharCode(...header.slice(0, 5)) === '%PDF-';
        const isPngSignature = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
        const isJpegSignature = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
        const isBmpSignature = header[0] === 0x42 && header[1] === 0x4d;
        if (!isPdfSignature && !isPngSignature && !isJpegSignature && !isBmpSignature) {
          setAiStatus('El archivo no es un PDF/imagen compatible real (firma inválida) -- ¿fue renombrado?');
          return;
        }
        setAiStatus(`Extrayendo texto y aplicando OCR a "${file.name}"… esto puede tardar varios minutos si el documento tiene páginas escaneadas o imágenes grandes.`);
        const result = await importReportPdfOcr(bytes, file.name);
        if (!result.ok || !result.pages) {
          if (result.error === 'too_many_scanned_pages') {
            setAiStatus(
              `"${file.name}" tiene demasiadas páginas escaneadas para procesar de una vez (${result.scanned_pages} > límite de ${result.limit}). Dividí el archivo en partes más chicas e intentá de nuevo.`,
            );
          } else if (result.error === 'not_a_pdf' || result.error === 'unsupported_file_type' || result.error === 'invalid_size') {
            setAiStatus(`No se pudo importar "${file.name}": el archivo no es un PDF/imagen válido o es demasiado grande.`);
          } else {
            setAiStatus(`Error al importar "${file.name}" (OCR no disponible en este momento: ${result.error || 'error desconocido'}).`);
          }
          return;
        }
        const ocrResponse = { page_count: result.page_count || result.pages.length, pages: result.pages };
        // Modo réplica (ADR-209): fondo + texto en posición absoluta, página
        // por página -- no pasa por el auto-flujo de pegado (esa vía
        // reacomodaba el texto con otra fuente/interlineado y producía las
        // superposiciones reportadas).
        if (isReplicaResponse(ocrResponse)) {
          const replica = buildReplicaPages(ocrResponse);
          if (replica.pages.length === 0) {
            setAiStatus(`No se pudo extraer contenido de "${file.name}".`);
            return;
          }
          useEditorStore.getState().importReplicaPages(replica.pages);
          setAiStatus(formatPdfOcrSummary(file.name, replica.summary));
          return;
        }
        const { blocks, summary, pageSetup } = convertPdfOcrResponseToBlocks(ocrResponse);
        if (blocks.length === 0) {
          setAiStatus(`No se pudo extraer contenido de "${file.name}".`);
          return;
        }
        // Configura el documento con el tamaño/orientación/márgenes REALES
        // del PDF de origen (primera página) en vez de dejarlo en el A4
        // vertical por defecto -- fidelidad ampliada, ver ADR-199 §7.
        // Mutaciones ya existentes del store (ADR-174), nada nuevo del lado
        // del editor.
        if (pageSetup) {
          const store = useEditorStore.getState();
          store.setPaperSize(pageSetup.paperSize);
          store.setOrientation(pageSetup.orientation);
          store.setPageMargins(pageSetup.margins);
        }
        useEditorStore.getState().setPendingImportBlocks(blocks);
        setAiStatus(formatPdfOcrSummary(file.name, summary));
      } catch (err) {
        log.error('Import PDF+OCR failed', err);
        setAiStatus('Error al importar el PDF (¿archivo corrupto o el servicio de OCR no está disponible?).');
      }
    };
    input.click();
  }, []);

  // Vista previa de impresión (ADR-080): abre el mismo visor de solo lectura
  // que ya reusa el export server-side (ReadOnlyViewer), acotando la
  // impresión nativa del navegador al contenido del informe en vez de a la
  // página completa de la app (antes onPrint llamaba window.print() directo).
  // Declarado antes de handleExportPdf porque su fallback cliente lo reusa.
  const handlePrintPreview = useCallback(() => {
    setReadOnlyReport({
      id: currentReportId,
      title: currentReportTitle,
      contentJson: doc,
      tenantId: session?.tenantId,
    });
    setShowReadOnly(true);
  }, [currentReportId, currentReportTitle, doc, session]);

  // Visualizador de PPT (pantalla completa, flechas/espacio para pasar
  // diapositiva, transición real por diapositiva) — usa el documento EN
  // MEMORIA (igual que la vista previa de impresión), no una versión
  // guardada del servidor: no tiene sentido exigir guardar solo para
  // previsualizar la presentación dentro de la propia app.
  const handleStartPresentation = useCallback(() => {
    if (doc.meta?.layoutMode !== 'presentation') return;
    setReadOnlyReport({
      id: currentReportId,
      title: currentReportTitle,
      contentJson: doc,
      tenantId: session?.tenantId,
    });
    setShowPresentation(true);
  }, [currentReportId, currentReportTitle, doc, session]);

  // "Generar Reporte Demo Completo" (Mis Informes) -- portado del avance de
  // Luder (2026-09-11): corre DENTRO del editor real (mismas acciones del
  // store que un usuario), así valida en vivo el motor de márgenes/
  // anti-colisión/auto-resize con el 100% de tipos de sensor/gráfico. No
  // auto-guarda: el documento generado queda cargado en el lienzo y el
  // usuario confirma con el botón "Guardar" normal. Es la herramienta que
  // se usó para calibrar la optimización de exportación (informe de prueba
  // de 2104 páginas/6300 gráficos) -- sin dependencia de backend nuevo.
  const handleGenerateDemoReport = useCallback(async () => {
    const confirmed = await requestConfirmation(
      '¿Generar el informe demo de prueba exhaustiva (100% de tipos de sensor x 100% de tipos de gráfico, en A4/A3)? Reemplaza el contenido del lienzo actual (sin guardar automáticamente).',
    );
    if (!confirmed) return;
    setShowReportsAdmin(false);
    setAiStatus('Generando reporte demo…');
    try {
      const result = await generateDemoReport((p: DemoReportProgress) => {
        setAiStatus(`${p.phase} (${p.current}/${p.total})`);
      });
      setAiStatus(
        `Reporte demo generado: ${result.pageCount} páginas, ${result.sensorTypeCount} tipos de sensor, ${result.chartCount} diagramas. Revise y presione "Guardar" para conservarlo.`,
      );
    } catch (err) {
      log.error('Error al generar reporte demo:', err);
      const message = err instanceof Error ? err.message : '';
      setAiStatus(
        message.toLowerCase().includes('ya hay una generación')
          ? message
          : 'Error al generar el reporte demo. Verifique el catálogo de sensores del tenant.',
      );
    }
  }, []);

  // "Enlace + QR" (ADR-138) -- portado del avance de Luder (2026-09-11): el
  // hook/modal ya existían en el repo (useShareLink.ts, ShareLinkModal.tsx)
  // pero nunca se habían conectado a la cinta. Genera un enlace de acceso
  // directo (sin contraseña, vence en 48h) al PDF ya guardado del informe.
  const { generateLink: generateShareLink, link: shareLink, clearLink: clearShareLink } = useShareLink();
  const handleGenerateShareLink = useCallback(async () => {
    if (!currentReportId) {
      setAiStatus('Guarda el informe antes de generar un enlace de acceso directo.');
      return;
    }
    setAiStatus('Generando enlace de acceso directo...');
    try {
      await generateShareLink(currentReportId);
      setAiStatus('Enlace de acceso directo generado.');
    } catch (err) {
      log.error('No se pudo generar el enlace de acceso directo', err);
      setAiStatus('No se pudo generar el enlace de acceso directo.');
    }
  }, [currentReportId, generateShareLink]);

  // ── Export handlers ──
  // ADR-016/080: reusa el mismo pipeline server-side (Chromium headless +
  // ReadOnlyViewer, ver usePdfExport.ts) que "Descargar PDF protegido" —
  // renderiza lo que está guardado en el servidor, no el DOM en vivo del
  // editor, así que primero hay que guardar (handleSaveReport siempre
  // persiste el estado actual, para que el PDF nunca quede desactualizado
  // respecto a lo que el usuario ve en el lienzo).
  // `unprotected` (default false, ADR-080 sigue siendo el comportamiento
  // normal): solo lo puede pedir un rol con `informes.export_sin_clave`
  // (ver `canExportPdfUnprotected` más abajo, gatea el botón "PDF (sin
  // contraseña)" en la cinta) -- si de todos modos llegara acá sin el
  // permiso, el backend lo rechaza con 403 (report_routes.cpp).
  // `noWatermark` (ADR-204, default false): mismo criterio pero para
  // `informes.export_sin_marca_agua` (ver `canToggleWatermark`/checkbox
  // "Sin sello de agua" en la cinta).
  const handleExportPdf = useCallback(async (unprotected = false, noWatermark = false) => {
    setAiStatus('Guardando informe...');
    try {
      const saved = await handleSaveReport();
      if (!saved) {
        setAiStatus('Exportación cancelada.');
        return;
      }
      const reportId = useEditorStore.getState().currentReportId;
      if (!reportId) {
        setAiStatus('No se pudo generar el PDF: el informe no tiene un ID válido.');
        return;
      }
      setAiStatus(unprotected ? 'Generando PDF (sin contraseña)...' : 'Generando PDF protegido...');
      await measurePerfAsync('export', () => downloadProtectedPdf(reportId, unprotected, noWatermark));
      setAiStatus('PDF exportado');
      requestSupportAvatar('report', reportId); // ADR-164
    } catch (err) {
      log.error('Exportación PDF falló', err);
      setAiStatus('No se pudo generar el PDF.');
    }
  }, [handleSaveReport, downloadProtectedPdf]);

  // DOCX ahora se enruta al pipeline SERVIDOR (sidecar Chromium, /render-docx
  // + reportDocxBuilder.js) en vez del pipeline 100% cliente de ADR-139 --
  // mismo patrón asíncrono que PPTX (job + polling + descarga), y requiere
  // por eso un informe ya guardado (el sidecar renderiza lo persistido en
  // servidor, no el borrador en memoria del editor). El pipeline cliente
  // (exportDOCX de exportEngine.ts) se conserva SOLO como fallback cuando el
  // backend responde 503 `docx_export_disabled` (sidecar no configurado en
  // este entorno) -- cualquier otro error es un fallo real de exportación,
  // no de routing, y se reporta como tal sin enmascararlo.
  // `layout`: 'absolute' (default, botón "DOCX") o 'flow' (botón "DOCX
  // (fluido)") -- ver createDocxExportJob en lib/api.ts para el detalle de
  // qué cambia. El fallback cliente (503) ignora `layout` -- exportDOCX no
  // soporta flow todavía, así que ese caso siempre sale en absoluto (se
  // avisa en el mensaje de estado para no hacerlo pasar por lo pedido).
  const handleExportDocx = useCallback(async (layout: 'absolute' | 'flow' = 'absolute') => {
    if (!currentReportId) {
      setAiStatus('Guarda el informe antes de exportar a DOCX — el servidor necesita un informe guardado para renderizarlo.');
      return;
    }
    setAiStatus('Guardando informe...');
    const saved = await handleSaveReport();
    if (!saved) {
      setAiStatus('Exportación cancelada.');
      return;
    }
    setAiStatus('Generando DOCX (servidor)...');
    setExportProgress(null);
    try {
      const { job_id: jobId } = await measurePerfAsync('export', () => createDocxExportJob(currentReportId, layout));
      const finalStatus = await pollExportJob(currentReportId, jobId, {
        onProgress: makeExportProgressHandler('DOCX', 'Generando DOCX (renderizando páginas)...'),
      });
      setExportProgress(null);
      if (finalStatus.status !== 'success') {
        setAiStatus(`Error al exportar DOCX${finalStatus.error_message ? `: ${finalStatus.error_message}` : ''}`);
        return;
      }
      const { blob } = await fetchExportJobBlob(currentReportId, jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generateFilename(currentReportTitle || doc.meta?.title, 'docx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAiStatus('DOCX exportado (server)');
      requestSupportAvatar('report', currentReportId ?? undefined); // ADR-164
    } catch (err) {
      setExportProgress(null);
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        log.warn('[EXPORT][DOCX] Sidecar no configurado (503), usando fallback cliente:', err);
        setAiStatus(
          layout === 'flow'
            ? 'Servidor no disponible: exportando DOCX con diseño exacto (el pipeline cliente aún no soporta texto fluido)...'
            : 'Exportando DOCX (cliente, servidor no disponible)...',
        );
        const result = await measurePerfAsync('export', () => exportDOCX(doc, { author: loggedAuthor, title: currentReportTitle }));
        setAiStatus(result.success ? `DOCX exportado (${result.method})` : 'Error al exportar DOCX');
        if (result.success) requestSupportAvatar('report', currentReportId ?? undefined);
        return;
      }
      log.warn('[EXPORT][DOCX] Falló el pipeline servidor:', err);
      setAiStatus(`Error al exportar DOCX${(err as Error)?.message ? `: ${(err as Error).message}` : ''}`);
    }
  }, [doc, loggedAuthor, currentReportTitle, currentReportId, handleSaveReport, makeExportProgressHandler]);

  // Export XLSX: alcance explícito -- exporta ÚNICAMENTE las tablas ya
  // insertadas en el informe (una hoja real por tabla + un índice con
  // hipervínculos), sin restricción de layoutMode. Mismo patrón asíncrono
  // que DOCX/PPTX (requiere el informe guardado en servidor).
  const handleExportXlsx = useCallback(async () => {
    if (!currentReportId) {
      setAiStatus('Guarda el informe antes de exportar a XLSX — el servidor necesita un informe guardado para renderizarlo.');
      return;
    }
    setAiStatus('Guardando informe...');
    const saved = await handleSaveReport();
    if (!saved) {
      setAiStatus('Exportación cancelada.');
      return;
    }
    setAiStatus('Generando XLSX (servidor)...');
    setExportProgress(null);
    try {
      const { job_id: jobId } = await measurePerfAsync('export', () => createXlsxExportJob(currentReportId));
      const finalStatus = await pollExportJob(currentReportId, jobId, {
        onProgress: makeExportProgressHandler('XLSX', 'Generando XLSX (tablas del informe)...'),
      });
      setExportProgress(null);
      if (finalStatus.status !== 'success') {
        setAiStatus(`Error al exportar XLSX${finalStatus.error_message ? `: ${finalStatus.error_message}` : ''}`);
        return;
      }
      const { blob } = await fetchExportJobBlob(currentReportId, jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generateFilename(currentReportTitle || doc.meta?.title, 'xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAiStatus('XLSX exportado (servidor)');
      requestSupportAvatar('report', currentReportId); // ADR-164
    } catch (err) {
      setExportProgress(null);
      log.warn('[EXPORT][XLSX] Falló el pipeline servidor:', err);
      setAiStatus(`Error al exportar XLSX${(err as Error)?.message ? `: ${(err as Error).message}` : ''}`);
    }
  }, [doc, currentReportTitle, currentReportId, handleSaveReport, makeExportProgressHandler]);

  // Export PPTX (modo presentación): igual que el PDF, requiere un informe ya
  // guardado (el servidor renderiza /print-report.html, no puede hacerlo
  // sobre un borrador que solo existe en memoria del navegador). A diferencia
  // del PDF, no hay fallback cliente sensato — sin sidecar no hay PPTX. Job
  // asíncrono (report_export_job): se crea, se hace polling hasta
  // success/failed, y recién ahí se descarga.
  //
  // Bug real reportado (SCRUM-35, "exporta en formato de Word/documento"):
  // este handler decía en el comentario de arriba que se comporta "igual
  // que el PDF", pero handleExportPdf SIEMPRE fuerza handleSaveReport()
  // antes de pedir el render server-side (ver ese handler) y este NUNCA lo
  // hacía. Como print-report.html renderiza lo que está GUARDADO en el
  // servidor, no el DOM en vivo del editor, la falta de ese guardado
  // forzado dejaba una ventana real de condición de carrera: al cambiar a
  // modo presentación, `setLayoutMode('presentation')` solo actualiza el
  // store del navegador -- la persistencia al backend depende del
  // autoguardado con debounce (ver lib/autosaveEngine.ts), que puede no
  // haber corrido todavía cuando el usuario, seguiendo la instrucción en
  // pantalla, vuelve a hacer clic en "PPTX" de inmediato. El servidor
  // entonces renderizaba la versión guardada ANTERIOR (`layoutMode:
  // 'document'`, hoja A4 vertical) -- de ahí que el .pptx resultante se
  // viera armado con paginas de Word en vez de diapositivas 16:9. Ahora se
  // fuerza el guardado en los dos puntos que antes dependían del
  // autoguardado: justo despues de cambiar el modo, y de nuevo justo antes
  // de encolar el job (cubre tambien ediciones de contenido sin guardar
  // ajenas al cambio de modo, el mismo caso que ya cubre el PDF).
  const handleExportPptx = useCallback(async () => {
    if (!currentReportId) {
      setAiStatus('Guarda el informe antes de exportar a PPTX — el servidor necesita un informe guardado para renderizarlo.');
      return;
    }
    const layoutMode = doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
    if (layoutMode !== 'presentation') {
      const wantsSwitch = await requestConfirmation(
        'El PPTX solo se genera en modo presentación (lienzo 16:9). ¿Cambiar el informe a modo presentación ahora?',
      );
      if (!wantsSwitch) return;
      setLayoutMode('presentation');
      setAiStatus('Guardando cambio a modo presentación...');
      await handleSaveReport();
      setAiStatus('Informe cambiado a modo presentación. Vuelve a hacer clic en "PPTX" para exportarlo.');
      return;
    }
    setAiStatus('Guardando informe...');
    const saved = await handleSaveReport();
    if (!saved) {
      setAiStatus('Exportación cancelada.');
      return;
    }
    setAiStatus('Generando PPTX (servidor)...');
    setExportProgress(null);
    try {
      const { job_id: jobId } = await measurePerfAsync('export', () => createPptxExportJob(currentReportId));
      const finalStatus = await pollExportJob(currentReportId, jobId, {
        onProgress: makeExportProgressHandler('PPTX', 'Generando PPTX (renderizando diapositivas)...'),
      });
      setExportProgress(null);
      if (finalStatus.status !== 'success') {
        setAiStatus(`Error al exportar PPTX${finalStatus.error_message ? `: ${finalStatus.error_message}` : ''}`);
        return;
      }
      setLastPptxJobId(jobId);
      const { blob } = await fetchExportJobBlob(currentReportId, jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // El nombre que manda el servidor en Content-Disposition es genérico
      // (no el título del informe) -- se descarta y se genera acá con el
      // mismo criterio que ya usa DOCX (generateFilename), para que el
      // archivo se llame igual que como se guardó el informe.
      a.download = generateFilename(currentReportTitle, 'pptx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAiStatus('PPTX exportado (servidor)');
      requestSupportAvatar('report', currentReportId); // ADR-164
    } catch (err) {
      setExportProgress(null);
      log.error('Export PPTX server-side falló', err);
      const backendError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAiStatus(
        backendError === 'layout_mode_not_presentation'
          ? 'El informe no está en modo presentación.'
          : 'Error al exportar PPTX.',
      );
    }
  }, [currentReportId, doc, setLayoutMode, handleSaveReport, currentReportTitle]);

  // Convierte el último PPTX exportado en esta sesión (lastPptxJobId) a un
  // MP4 sin narración (Stage 3) — no vuelve a renderizar el informe, el
  // backend reutiliza las imágenes de diapositiva ya generadas para ese job.
  const handleConvertPptxToVideo = useCallback(async () => {
    if (!currentReportId || !lastPptxJobId) {
      setAiStatus('Exporta primero el informe a PPTX para poder convertirlo a vídeo.');
      return;
    }
    setAiStatus('Generando video (servidor)...');
    try {
      const { job_id: videoJobId } = await measurePerfAsync('export', () =>
        createVideoExportJob(currentReportId, lastPptxJobId, { slideDurationSeconds: 4, transition: 'cut' }),
      );
      const finalStatus = await pollExportJob(currentReportId, videoJobId, {
        onProgress: () => setAiStatus('Generando video (componiendo diapositivas)...'),
      });
      if (finalStatus.status !== 'success') {
        setAiStatus(`Error al generar el video${finalStatus.error_message ? `: ${finalStatus.error_message}` : ''}`);
        return;
      }
      const { blob, filename } = await fetchExportJobBlob(currentReportId, videoJobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAiStatus('Video exportado (servidor)');
    } catch (err) {
      log.error('Convertir PPTX a video falló', err);
      const backendError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAiStatus(
        backendError === 'pptx_job_not_ready'
          ? 'El PPTX de referencia ya no está disponible — vuelve a exportarlo.'
          : 'Error al generar el video.',
      );
    }
  }, [currentReportId, lastPptxJobId]);

  // Sube la narración de una página al job pptx activo (NarrationModal la
  // llama por cada página con audio/notas antes de disparar la conversión).
  const handleUploadNarrationPage = useCallback(
    async (pageNumber: number, payload: { audioBlob: Blob; durationSeconds: number } | { speakerNotes: string }) => {
      if (!currentReportId || !lastPptxJobId) return;
      await uploadSlideNarration(currentReportId, lastPptxJobId, pageNumber, payload);
    },
    [currentReportId, lastPptxJobId],
  );

  // ── Version snapshots ──
  const handleCreateSnapshot = useCallback(async () => {
    const version = doc.meta?.version || 1;
    const desc = await promptForTitle(
      t('snapshot.defaultDescription', { version }),
      t('snapshot.descriptionTitle'),
    );
    if (desc === null) return;
    const snap = createSnapshot(doc, loggedAuthor, desc);
    setSnapshots((prev) => [...prev, snap]);
    setAiStatus(`Snapshot v${snap.version} creado.`);
  }, [doc, loggedAuthor, promptForTitle, t]);

  const handleRestoreSnapshot = useCallback((snap: VersionSnapshot) => {
    loadDocument(snap.documentData, currentReportId, currentReportTitle);
    setAiStatus(`Restaurado a versión ${snap.version}.`);
  }, [loadDocument, currentReportId, currentReportTitle]);

  // ADR-015: el historial de versiones es autoritativo en el servidor — al
  // abrir el panel se reemplazan los snapshots locales (que se perdían al
  // recargar la página) por las revisiones reales guardadas en
  // report_content_revision, generadas automáticamente en cada autosave
  // exitoso (ver App.jsx::handleWorkflowTransition / autosave engine).
  useEffect(() => {
    if (!showVersionHistory || !currentReportId) return;
    let cancelled = false;
    (async () => {
      try {
        const revisions = await fetchReportRevisions(currentReportId);
        if (cancelled) return;
        const summaryLabels: Record<string, string> = {
          creacion_inicial: 'Creación inicial',
          autosave: 'Autoguardado',
          // ADR-022, cierre CA-3 de SPEC-014 (2026-09-13): resoluciones de
          // conflicto offline, antes indistinguibles de un guardado normal.
          offline_conflict_overwrite: 'Conflicto offline resuelto: sobrescribió versión del servidor',
          offline_conflict_kept_as_new: 'Conflicto offline resuelto: guardado como informe nuevo',
        };
        const mapped: VersionSnapshot[] = revisions.map((rev: any) => {
          const content = rev.content_json || {};
          const pages = content.pages || [];
          return {
            id: `rev-${rev.revision_id}`,
            timestamp: rev.created_at,
            version: rev.version_number,
            author: rev.created_by || 'Sistema',
            description: summaryLabels[rev.change_summary] || rev.change_summary || `Versión ${rev.version_number}`,
            pageCount: pages.length,
            elementCount: pages.reduce((sum: number, p: any) => sum + (p.elements?.length || 0), 0),
            documentData: content,
            sizeBytes: JSON.stringify(content).length,
          };
        });
        // Conserva los snapshots manuales de esta sesión (aún no persistidos
        // al servidor) junto con las revisiones autoritativas del servidor,
        // en vez de descartarlos al reabrir el panel.
        setSnapshots((prev) => {
          const localOnly = prev.filter((s) => s.id.startsWith('snap-'));
          return [...mapped, ...localOnly];
        });
      } catch (err) {
        log.error('No se pudo cargar el historial de versiones del servidor', err);
      }
    })();
    return () => { cancelled = true; };
  }, [showVersionHistory, currentReportId]);

  // ── Voice dictation insert ──
  const handleVoiceInsert = useCallback((text: string) => {
    addElement('text', {
      props: { text, fontFamily: 'Inter', fontSize: 12, fontColor: '#1e293b' },
    });
    setAiStatus(`Dictado insertado (${text.length} caracteres)`);
  }, [addElement]);

  // ── Accessibility init ──
  useEffect(() => {
    initAccessibility();
    return () => destroyAccessibility();
  }, []);

  const [designToolbarHost, setDesignToolbarHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setDesignToolbarHost(document.getElementById('report-v2-design-toolbar-host'));
  }, []);

  const designToolbar = (
    <RibbonToolbar
      onExportPdf={() => handleExportPdf(false, noWatermark)}
      onExportPdfUnprotected={() => handleExportPdf(true, noWatermark)}
      canExportPdfUnprotected={hasReportPermission('informes.export_sin_clave')}
      noWatermark={noWatermark}
      onToggleNoWatermark={() => setNoWatermark((v) => !v)}
      canToggleWatermark={hasReportPermission('informes.export_sin_marca_agua')}
      onGenerateShareLink={handleGenerateShareLink}
      onExportVideo={handleRecordScreenToCanvas}
      onPrint={handlePrintPreview}
      onStartPresentation={handleStartPresentation}
      onReviewDocument={handleReviewDocument}
      onOptimizeDocument={handleOptimizeDocument}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onZoomSet={handleZoomSet}
      gridEnabled={gridEnabled}
      snapEnabled={snapEnabled}
      onToggleGrid={() => setGridEnabled(!gridEnabled)}
      onToggleSnap={() => setSnapEnabled(!snapEnabled)}
      isOptimizing={isOptimizing}
      zoomPercent={zoomPercent}
      onOpenReportsAdmin={() => setShowReportsAdmin(true)}
      onNewReport={handleNewReport}
      onSaveReport={handleSaveReport}
      isSaving={isSaving}
      saveLabel={saveLabel}
      onOpenFormulaAnalysis={() => setShowFormulaAnalysis(true)}
      onSyncMiningKpis={handleSyncMiningKpis}
      isSyncingKpis={isSyncingKpis}
      kpiAutoSyncEnabled={kpiAutoSyncEnabled}
      onToggleKpiAutoSync={() => setKpiAutoSyncEnabled((prev) => !prev)}
      layoutMode={layoutMode}
      onLayoutModeChange={setLayoutMode}
      paperSize={paperSize}
      onPaperSizeChange={(v) => setPaperSize(v === 'A3' ? 'A3' : 'A4')}
      orientation={orientation}
      onOrientationChange={(v) => setOrientation(v === 'landscape' ? 'landscape' : 'portrait')}
      pageMargins={pageMargins}
      onSetPageMargins={setPageMargins}
      globalTextFormat={globalTextFormat}
      onApplyGlobalTextFormat={applyGlobalTextFormat}
      onOpenDocumentLayout={() => setShowDocumentLayout(true)}
      onAddComment={handleAddComment}
      onInsertElement={(type) => {
        if (type === 'map') setShowMapCapture(true);
        else if (type === 'image') openImageInsertForNew();
        else if (type === 'video') openVideoInsertForNew();
        else addElement(type);
      }}
      onInsertShape={(shapeType) => addElement('shape', { props: { shapeType } })}
      onAddPage={addPage}
      onDuplicatePage={() => duplicatePage(selectedPage)}
      onAddTemplate={(tmpl) => addTextTemplate(tmpl)}
      onOpenDocumentTemplates={() => { setRightPanelVisible(true); setShowTemplatesPanel(true); }}
      onAddTechnicalBlock={handleAddTechnicalBlock}
      onAddSectionTemplate={handleAddSectionTemplate}
      onAddStaticChart={handleAddStaticChart}
      // Corrección de precisión (2026-07-24): este botón del ribbon decía
      // "Insertar tabla de contenidos automática" pero solo abría el panel
      // de navegación flotante (showToc) -- nunca insertaba el bloque TOC
      // real en el documento. El botón que sí inserta (handleAddToc) vivía
      // solo en la biblioteca lateral ("Índice"). Ahora ambos hacen lo mismo,
      // consistente con lo que el título del botón promete.
      onInsertTOC={handleAddToc}
      // Bug real (QA TC-COV-01, corregido 2026-07-27): "Insertar Carátula"
      // no hacía NADA — el prop `onInsertCoverPage` nunca se pasaba desde
      // App.tsx. Ahora además las 5 opciones del dropdown (corporate/
      // technical/executive/field/normative) insertan 5 diseños REALES y
      // distintos (Gerencia/Control Interno/Auditoría Interna/Campo/
      // Normativo — ver lib/coverTemplates.ts), no el mismo diseño 5 veces.
      onInsertCoverPage={(templateId) => addElement('cover', { props: { coverTemplate: templateId } })}
      onApplySlideLayout={applySlideLayout}
      onStartWorkflow={() => setShowWorkflow((v) => !v)}
      onToggleLeftPanel={() => setLeftPanelVisible((v) => !v)}
      onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
      onExportMiningReport={handleExportMiningReport}
      onImportMiningReport={handleImportMiningReport}
      onImportDocx={handleImportDocx}
      onImportPdfOcr={handleImportPdfOcr}
      onExportDocx={handleExportDocx}
      onExportDocxFlow={() => handleExportDocx('flow')}
      onExportXlsx={handleExportXlsx}
      onExportPptx={handleExportPptx}
      onExportPptxVideo={() => setShowNarrationModal(true)}
      canExportPptxVideo={!!lastPptxJobId}
      onCreateSnapshot={handleCreateSnapshot}
      onShowVersionHistory={() => setShowVersionHistory((v) => !v)}
      onShowComparator={() => setShowComparator((v) => !v)}
      onToggleVoiceDictation={() => setShowVoiceDictation((v) => !v)}
      onTogglePerfDashboard={() => setShowPerfDashboard((v) => !v)}
      currentFontFamily={currentFontFamily}
      currentFontSize={currentFontSize}
      currentFontColor={currentFontColor}
      currentHighlightColor={currentHighlightColor}
      currentHeadingStyle={currentHeadingStyle}
      currentAlignment={currentAlignment}
      currentBold={isBold}
      currentItalic={isItalic}
      currentUnderline={isUnderline}
      onApplyHeadingStyle={(style) => handleUpdateSelectedProps({
        // Estilo Word-like: aplicar un Heading reemplaza TODO el formato del
        // bloque de una sola vez (fuente, tamaño, color, negrita, cursiva,
        // subrayado, alineación, interlineado) — antes solo tocaba
        // tamaño/negrita/color y dejaba fuente/cursiva/subrayado/alineación
        // con lo que ya tuviera el bloque, inconsistente con cómo funcionan
        // los Estilos rápidos en Word.
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.fontWeight >= 600,
        italic: style.italic,
        underline: style.underline,
        fontColor: style.color,
        textAlign: style.textAlign,
        lineHeight: style.lineHeight,
        // ADR-011 (revisado): tagea el bloque con el nivel de encabezado
        // aplicado — sin esto, generateTocData() (TableOfContents.tsx) no
        // tiene ninguna señal confiable para detectar secciones (antes solo
        // cambiaba el estilo visual, nunca marcaba qué era un heading).
        // 'quote' SÍ se tagea (a diferencia de antes) para que "Estilo
        // actual" en el ribbon pueda mostrar "Cita" — generateTocData()
        // igual lo excluye explícitamente de la numeración (no es un
        // encabezado real), así que esto no afecta al índice.
        headingStyle: style.id === 'normal' ? undefined : style.id,
      })}
      customTextStyles={customTextStyles}
      onOpenSaveTextStyle={handleOpenSaveTextStyle}
      onDeleteCustomTextStyle={handleDeleteCustomTextStyle}
      onToggleBold={() => { if (!tryApplyToActiveTextSelection({ bold: true })) handleUpdateSelectedProps({ bold: !isBold }); }}
      onToggleItalic={() => { if (!tryApplyToActiveTextSelection({ italic: true })) handleUpdateSelectedProps({ italic: !isItalic }); }}
      onToggleUnderline={() => { if (!tryApplyToActiveTextSelection({ underline: true })) handleUpdateSelectedProps({ underline: !isUnderline }); }}
      onCopy={() => {
        if (selectedPage && selectedElementId) copyElement(selectedPage, selectedElementId);
      }}
      onPaste={() => {
        if (selectedPage) pasteElement(selectedPage);
      }}
      onSetAlignment={(align) => handleUpdateSelectedProps({ textAlign: align })}
      currentTextAlign={currentProps.textAlign}
      onSetListStyle={applyListStyleToWholeBlock}
      currentListStyle={currentListStyle}
      onSetFontFamily={(font) => { if (!tryApplyToActiveTextSelection({ fontFamily: font })) handleUpdateSelectedProps({ fontFamily: font }); }}
      onSetFontSize={(size) => { if (!tryApplyToActiveTextSelection({ fontSize: size })) handleUpdateSelectedProps({ fontSize: size }); }}
      onSetFontColor={(color) => { if (!tryApplyToActiveTextSelection({ color })) handleUpdateSelectedProps({ fontColor: color }); }}
      onSetHighlightColor={(color) => { if (!tryApplyToActiveTextSelection({ highlightColor: color })) handleUpdateSelectedProps({ highlightColor: color }); }}
      onApplyCase={() => { if (!tryApplyCaseToActiveTextSelection()) applyCaseToWholeBlock(); }}
      // Interlineado es un atributo de PÁRRAFO/bloque (igual que en Word),
      // no de carácter — siempre se aplica a todo el bloque seleccionado,
      // nunca a una palabra suelta.
      currentLineHeight={currentProps.lineHeight}
      onSetLineHeight={(lineHeight) => handleUpdateSelectedProps({ lineHeight })}
    />
  );


  // testing by jhon
  useEffect(()=>{
    console.log(session)
  },[])

  return (
    <div className="app-shell">
      {designToolbarHost ? createPortal(designToolbar, designToolbarHost) : designToolbar}
      {syncToast ? (
        <div className={`sync-toast sync-toast--${syncToast.type}`}>
          <span>{syncToast.message}</span>
          <button type="button" onClick={() => setSyncToast(null)} aria-label="Cerrar">
            ×
          </button>
        </div>
      ) : null}

      <div className="studio-layout">
        {leftPanelVisible && (
          <LeftLibrary
            onAdd={handleLeftLibraryAdd}
            onAddPage={addPage}
            onDuplicatePage={handleDuplicatePage}
            onAddFindings={handleAddFindings}
            onAddAnnexes={handleAddAnnexes}
            onAddReferences={handleAddReferences}
            onAddApa7Citation={handleOpenApa7Modal}
            onAddTechnicalBlock={handleAddTechnicalBlock}
            onAddSectionTemplate={handleAddSectionTemplate}
            onAddStaticChart={handleAddStaticChart}
            onAddCover={handleAddCover}
            onAddToc={handleAddToc}
            onInsertCompanyImage={handleInsertCompanyImage}
            onExportVideo={handleRecordScreenToCanvas}
          />
        )}

        <SlideThumbnailRail collapsed={rightInspectorExpanded} />

        <main className="studio-main">
          <div className="doc-header-meta">
            <span>ID: <b style={{color:'gray'}}>{doc.document_id}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Autor: <b style={{color:'gray'}}>{loggedAuthor}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Versión: <b style={{color:'gray'}}>{versionLabel}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <WorkflowStatusBadge status={workflowStatus} />
            <span className={`autosave-indicator autosave-indicator--${autosaveStatus}`}>
              {autosaveStatus === 'saving' ? '● Guardando...' : autosaveStatus === 'saved' ? '✓ Guardado' : autosaveStatus === 'error' ? '✕ Error' : '○ Auto'}
            </span>
            {aiStatus ? (
              <>
                <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{aiStatus}</span>
              </>
            ) : null}
          </div>

          {exportProgress ? (
            <div className="export-progress-bar" role="status" aria-live="polite">
              <span className="export-progress-bar__label">
                Exportando {exportProgress.format}: {exportProgress.captured}/{exportProgress.total} páginas
                {' · '}
                {Math.min(100, Math.round((exportProgress.captured / exportProgress.total) * 100))}%
              </span>
              <div className="export-progress-bar__track">
                <div
                  className="export-progress-bar__fill"
                  style={{
                    width: `${Math.min(100, Math.round((exportProgress.captured / exportProgress.total) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {offlineSince && (
            <div
              role="status"
              style={{
                margin: '8px 0',
                padding: '8px 14px',
                borderRadius: 6,
                background: '#7c2d12',
                color: '#fff7ed',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ⚠ FUERA DE LÍNEA desde {new Date(offlineSince).toLocaleString('es-PE')} — los cambios
              se están guardando localmente en este equipo y se sincronizarán al recuperar la conexión.
            </div>
          )}

          {!offlineSince && workingOfflineConflict && (
            <div
              role="status"
              style={{
                margin: '8px 0',
                padding: '8px 14px',
                borderRadius: 6,
                background: '#78350f',
                color: '#fff7ed',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              🔌 Hay conexión al servidor, pero este INFORME sigue en modo OFFLINE — otra
              terminal guardó una versión distinta mientras trabajabas sin conexión. Al
              presionar "Guardar" podrás elegir sobrescribir esa versión o guardar tus
              cambios como un informe nuevo.
            </div>
          )}

          {showWorkflow && (
            <WorkflowPanel
              reportId={currentReportId ?? undefined}
              currentStatus={workflowStatus}
              signature={reportSignature}
              auditLog={auditLog}
              onTransition={handleWorkflowTransition}
              onClose={() => setShowWorkflow(false)}
              currentUser={loggedAuthor}
              hasPermission={hasReportPermission}
            />
          )}
          {showVersionHistory && (
            <VersionHistory
              snapshots={snapshots}
              currentVersion={doc.meta?.version}
              onRestore={handleRestoreSnapshot}
              onPreview={(snap) => setAiStatus(`Vista previa: v${snap.version} — ${snap.description}`)}
              onClose={() => setShowVersionHistory(false)}
            />
          )}
          {showComparator && (
            <VersionComparator
              snapshots={snapshots}
              currentDoc={doc}
              onClose={() => setShowComparator(false)}
            />
          )}
          {showVoiceDictation && (
            <VoiceDictation
              onInsertText={handleVoiceInsert}
              onTranscriptUpdate={(t) => setAiStatus(`🎤 ${t.slice(0, 40)}…`)}
              language="es-PE"
            />
          )}
          {showPerfDashboard && (
            <PerformanceDashboard
              visible={showPerfDashboard}
              onClose={() => setShowPerfDashboard(false)}
            />
          )}

          <MultipageView
            zoomPercent={zoomPercent}
            onRequestImageReplace={openImageInsertForReplace}
            onRequestCoverImage={openImageInsertForCompanyImage}
            tenantId={session?.tenantId}
            currentUserId={session?.userId}
            currentUserName={loggedAuthor}
          />
        </main>
        <div id="aria-live-region" aria-live="polite" />

        {rightPanelVisible && (
          <RightInspector
            onRequestImageReplace={openImageInsertForReplace}
            showTemplatesPanel={showTemplatesPanel}
            onCloseTemplatesPanel={() => setShowTemplatesPanel(false)}
            onExpandedChange={setRightInspectorExpanded}
          />
        )}
      </div>

      {showReview && reviewResult ? (
        <div className="review-modal-overlay" onClick={() => setShowReview(false)}>
          <div className="review-modal" onClick={(event) => event.stopPropagation()}>
            <div className="review-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <h3>Revisión Global del Informe</h3>
              </div>
              <button
                className="btn-premium-outline"
                style={{ background: '#1e293b', color: '#f8fafc', borderColor: '#334155', padding: '7px 16px' }}
                onClick={() => setShowReview(false)}
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="review-kpis">
              <div className="review-kpi"><b>{reviewResult.pages}</b><span>Páginas</span></div>
              <div className="review-kpi"><b>{reviewResult.textBlocks}</b><span>Bloques de texto</span></div>
              <div className="review-kpi"><b>{reviewResult.optimizedCandidates}</b><span>Optimizables IA</span></div>
              <div className="review-kpi"><b style={{ color: reviewResult.score >= 80 ? '#10b981' : reviewResult.score >= 50 ? '#f59e0b' : '#ef4444' }}>{reviewResult.score}%</b><span>Calidad estimada</span></div>
            </div>

            <p className="review-summary">{reviewResult.summary}</p>

            <div className="review-issues">
              {reviewResult.issues.length === 0 ? (
                <p style={{ color: '#10b981', fontWeight: 600, margin: 0 }}>✓ Sin observaciones críticas. El informe está consistente.</p>
              ) : (
                reviewResult.issues.map((issue, index) => (
                  <div key={`${issue}-${index}`} className="review-issue-item">• {issue}</div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showAiReview ? (
        <div className="review-modal-overlay" onClick={() => setShowAiReview(false)}>
          <div className="review-modal ai-review-modal" onClick={(event) => event.stopPropagation()}>
            <div className="review-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px #6366f1' }} />
                <h3>Optimización IA — Revisión por Bloque</h3>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn-premium-outline"
                  style={{ background: '#fef9c3', color: '#854d0e', borderColor: '#fde047' }}
                  onClick={applyHighSeveritySuggestions}
                  title="Aplicar automáticamente solo las sugerencias de alta severidad"
                >
                  ⚡ Solo Severidad Alta
                </button>
                <button
                  className="btn-premium-outline"
                  style={{ background: '#d1fae5', color: '#065f46', borderColor: '#6ee7b7' }}
                  onClick={applyAllPendingSuggestions}
                  title="Aplicar todas las sugerencias pendientes (no rechazadas)"
                >
                  ✓ Aplicar Seleccionados
                </button>
                <button
                  className="btn-premium-outline"
                  style={{ background: '#1e293b', color: '#f8fafc', borderColor: '#334155', padding: '7px 16px' }}
                  onClick={() => setShowAiReview(false)}
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>

            <div className="review-summary" style={{ marginBottom: 14 }}>
              Se encontraron <b>{aiSuggestions.length}</b> sugerencias de mejora de sintaxis y orden.
            </div>

            <div className="ai-filter-row">
              <div className="ai-filter-kpis">
                <span className="ai-mini-chip">Total: {aiCounters.total}</span>
                <span className="ai-mini-chip ai-mini-chip-high">Alta: {aiCounters.alta}</span>
                <span className="ai-mini-chip ai-mini-chip-mid">Media: {aiCounters.media}</span>
                <span className="ai-mini-chip ai-mini-chip-low">Leve: {aiCounters.leve}</span>
              </div>
              <div className="ai-filter-controls">
                <input
                  className="input-premium"
                  placeholder="Buscar en texto, propuesta o página..."
                  value={aiSearchTerm}
                  onChange={(event) => setAiSearchTerm(event.target.value)}
                />
                <select
                  className="input-premium"
                  value={aiSeverityFilter}
                  onChange={(event) => setAiSeverityFilter(event.target.value)}
                >
                  <option value="todas">Todas las severidades</option>
                  <option value="alta">🔴 Alta</option>
                  <option value="media">🟡 Media</option>
                  <option value="leve">🟢 Leve</option>
                </select>
              </div>
            </div>

            <div className="ai-review-list">
              {aiFilteredSuggestions.length === 0 ? (
                <div className="ai-empty">No hay sugerencias para el filtro actual.</div>
              ) : aiFilteredSuggestions.map((item) => (
                <div key={item.id} className="ai-suggestion-card">
                  <div className="ai-suggestion-head">
                    <span>Página {item.pageNumber}</span>
                    <div className="ai-head-pills">
                      <span className={`ai-severity-pill ai-severity-${item.severity}`}>{item.severity}</span>
                      <span className={`ai-decision-pill ai-${item.decision}`}>{item.decision}</span>
                    </div>
                  </div>

                  <div className="ai-columns">
                    <div>
                      <h4>Texto original</h4>
                      <pre>{item.originalText || '(vacío)'}</pre>
                    </div>
                    <div>
                      <h4>Propuesta IA</h4>
                      <pre>{item.optimizedText || '(vacío)'}</pre>
                    </div>
                  </div>

                  <div className="ai-actions">
                    <button
                      className="btn-premium-outline"
                      style={{ background: '#d1fae5', color: '#065f46', borderColor: '#6ee7b7' }}
                      onClick={() => applySingleSuggestion(item)}
                    >
                      ✓ Aceptar
                    </button>
                    <button
                      className="btn-premium-outline"
                      style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' }}
                      onClick={() => markSuggestion(item.id, 'rejected')}
                    >
                      ✕ Rechazar
                    </button>
                    <button
                      className="btn-premium-outline"
                      onClick={() => markSuggestion(item.id, 'pending')}
                    >
                      ↺ Pendiente
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Reports Admin modals ───────────────────────────────────────────── */}
      {showReportsAdmin && (
        <ReportsAdminModal
          onClose={() => setShowReportsAdmin(false)}
          onOpenRead={handleOpenRead}
          onOpenEdit={handleOpenEdit}
          onGenerateDemo={handleGenerateDemoReport}
          onDuplicate={handleDuplicateReport}
          refreshToken={reportsRefreshToken}
          currentReportId={currentReportId}
          onRestoreOfflineDraft={handleRestoreOfflineDraft}
        />
      )}

      {shareLink && (
        <ShareLinkModal
          url={shareLink.url}
          expiresInHours={shareLink.expiresInHours}
          onClose={clearShareLink}
        />
      )}

      {showDocumentLayout && (
        <DocumentLayoutModal
          margins={pageMargins}
          textFormat={globalTextFormat}
          onClose={() => setShowDocumentLayout(false)}
          onApply={(margins, format) => {
            setPageMargins(margins);
            applyGlobalTextFormat(format);
          }}
        />
      )}

      {showReadOnly && readOnlyReport && (
        <ReadOnlyViewer
          report={readOnlyReport}
          onClose={() => { setShowReadOnly(false); setReadOnlyReport(null); }}
        />
      )}

      {showPresentation && readOnlyReport && (
        <ReadOnlyViewer
          report={readOnlyReport}
          presenterMode
          onClose={() => { setShowPresentation(false); setReadOnlyReport(null); }}
        />
      )}

      {pdfPassword && currentReportId && (
        <PdfPasswordModal password={pdfPassword} reportId={currentReportId} onClose={clearPdfPassword} />
      )}

      {showShareModal && shareTarget && (
        <ShareReportModal
          report={shareTarget}
          onClose={() => { setShowShareModal(false); setShareTarget(null); }}
          onSuccess={(msg) => { setShowShareModal(false); setShareTarget(null); setAiStatus(msg); }}
        />
      )}

      {showDeleteModal && deleteTarget && (
        <DeleteReportConfirm
          report={deleteTarget}
          onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
          onSuccess={(msg) => {
            setReportsRefreshToken((token) => token + 1);
            setShowDeleteModal(false);
            setDeleteTarget(null);
            setAiStatus(msg);
          }}
        />
      )}

      {typeof document !== 'undefined' && showMapCapture
        ? createPortal(
            <MapCaptureModal
              onClose={() => setShowMapCapture(false)}
              onCaptureComplete={handleMapCaptureComplete}
              companyName={session?.company}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && showImageInsertModal
        ? createPortal(
            <ImageInsertModal
              key={`img-insert-${imageInsertOpenSeq}`}
              onClose={closeImageInsertModal}
              onComplete={handleImageInsertComplete}
              telemetryTenantId={telemetryTenantId}
              assetTenantId={session?.tenantId}
              initialTab={imageInsertInitialTab}
              openSequence={imageInsertOpenSeq}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && showVideoInsertModal
        ? createPortal(
            <VideoInsertModal
              key={`video-insert-${videoInsertOpenSeq}`}
              onClose={closeVideoInsertModal}
              onComplete={handleVideoInsertComplete}
              initialTab={videoInsertInitialTab}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && showNarrationModal
        ? createPortal(
            <NarrationModal
              pageCount={doc.pages?.length || 1}
              onClose={() => setShowNarrationModal(false)}
              onUploadPage={handleUploadNarrationPage}
              onSubmit={handleConvertPptxToVideo}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && showSaveTextStyleModal
        ? createPortal(
            <SaveTextStyleModal
              initialFormat={initialTextFormat}
              onConfirm={handleConfirmSaveTextStyle}
              onCancel={() => setShowSaveTextStyleModal(false)}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && showApa7Modal
        ? createPortal(
            <Apa7CitationModal
              onClose={closeApa7Modal}
              onInsert={handleApa7Insert}
            />,
            document.body,
          )
        : null}

      {typeof document !== 'undefined' && titlePromptState
        ? createPortal(
            <SaveTitleModal
              defaultValue={titlePromptState.defaultValue}
              heading={titlePromptState.heading}
              onConfirm={(value) => {
                titlePromptState.resolve(value);
                setTitlePromptState(null);
              }}
              onCancel={() => {
                titlePromptState.resolve(null);
                setTitlePromptState(null);
              }}
            />,
            document.body,
          )
        : null}

      {showFormulaAnalysis && (
        <FormulaAnalysisModal onClose={() => setShowFormulaAnalysis(false)} />
      )}

      <SupportChatWidget />
    </div>
  );
}
