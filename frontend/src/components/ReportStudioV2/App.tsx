import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RibbonToolbar from './components/layout/RibbonToolbar';
import LeftLibrary from './components/layout/LeftLibrary';
import RightInspector from './components/layout/RightInspector';
import MultipageView from './components/document/MultipageView';
import WorkflowPanel, { createWorkflowEntry, WorkflowStatusBadge, type WorkflowStatus, type WorkflowEntry, type WorkflowSignature } from './components/document/WorkflowPanel';
import VersionHistory, { createSnapshot, type VersionSnapshot } from './components/document/VersionHistory';
import VersionComparator from './components/document/VersionComparator';
import VoiceDictation from './components/document/VoiceDictation';
import PerformanceDashboard from './components/dashboard/PerformanceDashboard';
import { useEditorStore, type OptimizationSuggestion } from './store/useEditorStore';
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
import FormulaAnalysisModal from './components/modals/FormulaAnalysisModal';
import SupportChatWidget from './components/support/SupportChatWidget';
import { saveReportAsync } from './lib/reportsStorage';
import { startAutosave, stopAutosave, subscribeAutosave } from './lib/autosaveEngine';
import { exportPDF, exportDOCX } from './lib/exportEngine';
import { initAccessibility, destroyAccessibility } from './lib/accessibility';
import { measurePerfAsync } from './lib/performanceMonitor';
import {
  fetchReportById,
  fetchReportRevisions,
  fetchReportPdfBlob,
  fetchReportPortableBlob,
  importReportPortable,
  syncMiningKpisFromDashboard,
  syncMiningKpisFromExternal,
  fetchMiningKpis,
  fetchMineSensors,
  fetchSeismicReport,
  createPptxExportJob,
  createVideoExportJob,
  uploadSlideNarration,
  pollExportJob,
  fetchExportJobBlob,
} from './lib/api';
import { getSession, type Session } from '../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../auth/telemetryTenant';
import { useConnectivity } from '../../lib/connectivityMonitor';
import {
  saveOfflineSnapshot,
  loadOfflineSnapshot,
  markOfflineSnapshotSynced,
  recordWentOffline,
  recordCameOnline,
} from './lib/offlineSqlite';
import { log } from '../../lib/logger';
import { tryApplyToActiveTextSelection, tryApplyCaseToActiveTextSelection } from './lib/activeTextFormatBridge';
import { applyListToText } from './lib/listFormatting';
import { useI18n } from '../../i18n/I18nProvider';
import { requestConfirmation, requestNotice } from '../UI/ConfirmActionDialog';
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

  const doc = useEditorStore((s) => s.doc);
  const addElement = useEditorStore((s) => s.addElement);
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

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [reviewResult, setReviewResult] = useState<ReturnType<typeof reviewDocumentQuality> | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [showAiReview, setShowAiReview] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiSeverityFilter, setAiSeverityFilter] = useState('todas');
  const [aiSearchTerm, setAiSearchTerm] = useState('');

  // ── Reports Admin ──────────────────────────────────────────────────────────
  const [showReportsAdmin, setShowReportsAdmin] = useState(false);
  const [showReadOnly, setShowReadOnly] = useState(false);
  const [readOnlyReport, setReadOnlyReport] = useState<any>(null);
  // ADR-080: contraseña del PDF recién descargado desde el ribbon — se
  // muestra una sola vez (ver PdfPasswordModal), no se persiste.
  const [pdfPassword, setPdfPassword] = useState<string | null>(null);
  // Stage 3 (PPTX -> video): job pptx exitoso más reciente de ESTA sesión —
  // habilita el botón "Convertir a MP4"; se reinicia si el informe cambia
  // (evita reusar un job de otro reportId al cambiar de informe abierto).
  const [lastPptxJobId, setLastPptxJobId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Guardar');
  const [showMapCapture, setShowMapCapture] = useState(false);
  const [showImageInsertModal, setShowImageInsertModal] = useState(false);
  const [showVideoInsertModal, setShowVideoInsertModal] = useState(false);
  const [showNarrationModal, setShowNarrationModal] = useState(false);
  const [showApa7Modal, setShowApa7Modal] = useState(false);
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
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>('draft');
  // Firma documental (ADR-018): solo lectura en el cliente, la escribe el
  // servidor en el momento exacto de la transición a 'signed'.
  const [reportSignature, setReportSignature] = useState<WorkflowSignature | null>(null);
  const [auditLog, setAuditLog] = useState<WorkflowEntry[]>([]);
  const [autosaveStatus, setAutosaveStatus] = useState('idle');

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

  const handleUpdateSelectedProps = useCallback((newProps: Record<string, unknown>) => {
    if (!selectedElementId || !selectedPage || !selectedElement) return;
    updateElement(selectedPage, selectedElementId, { props: { ...(selectedElement.props || {}), ...newProps } });
  }, [selectedElementId, selectedPage, selectedElement, updateElement]);

  const currentProps = selectedElement?.props || {};
  const currentFontFamily = currentProps.fontFamily;
  const currentFontSize = currentProps.fontSize;
  const currentFontColor = currentProps.fontColor;
  const currentHighlightColor = currentProps.highlightColor;

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
  const handleSaveReport = async () => {
    if (!session) {
      void requestNotice(t('notice.loginToSave'));
      return;
    }

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
            createdBy: session.username,
            company: session.company || 'default',
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
        } catch (err) {
          log.error('Error al guardar informe offline como nuevo:', err);
          setSaveLabel('Error');
          setTimeout(() => setSaveLabel('Guardar'), 3000);
        } finally {
          setIsSaving(false);
        }
        return;
      }
      // Sobrescribir: sigue el flujo normal de abajo, pero SIN
      // expectedVersion (fuerza el guardado, el usuario ya confirmó
      // explícitamente que quiere pisar la versión del servidor).
      setWorkingOfflineConflict(false);
    }

    let title = currentReportTitle;
    if (!currentReportId) {
      const input = await promptForTitle(title, 'Nombrar informe nuevo');
      if (input === null) return; // cancelled
      title = (input || '').trim() || title;
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
        createdBy: session.username,
        createdByName: session.fullName || session.username,
        company: session.company || 'default',
      });
      log.debug('Report saved successfully:', saved);
      // Backend might return the full object with id
      if (saved && saved.id) {
        setCurrentReportId(saved.id);
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
    } catch (err: any) {
      log.error('Error al guardar informe:', err);
      setSaveLabel('Error');
      setTimeout(() => setSaveLabel('Guardar'), 3000);
      // ADR-039 (migración completa): un usuario sin tenant asignado ya no
      // puede crear/editar informes (antes caía a company_name legacy).
      if (err?.response?.data?.error === 'tenant_required') {
        void requestNotice(t('notice.noTenant'));
      }
    } finally {
      setIsSaving(false);
    }
  };

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
              createdBy: session.username,
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
  }, [connectivity.state, currentReportId]);

  // ── Autosave engine ──
  useEffect(() => {
    const unsub = subscribeAutosave((state) => setAutosaveStatus(state.status));
    startAutosave(
      () => useEditorStore.getState().doc,
      async (doc) => {
        if (!session || !currentReportId) return;
        // Sin conexión real (verificada contra el propio backend, no solo
        // navigator.onLine — ver connectivityMonitor.ts) O con un conflicto
        // offline sin resolver (ADR-022: el usuario eligió seguir trabajando
        // con su copia local aunque haya vuelto la señal — ver el efecto de
        // reconexión de arriba): el guardado sigue yendo a SQLite local, no
        // al servidor, hasta que el usuario resuelva el conflicto al
        // presionar "Guardar" (handleSaveReport).
        if (connectivity.state === 'OFFLINE' || workingOfflineConflict) {
          await saveOfflineSnapshot(
            currentReportId,
            currentReportTitle,
            doc,
            currentReportVersionNumber ?? doc.meta?.version ?? 1,
          );
          return;
        }
        const saved = await saveReportAsync({
          id: currentReportId,
          title: currentReportTitle,
          contentJson: JSON.stringify(doc),
          status: workflowStatus,
          createdBy: session.username,
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
  }, [currentReportId, session?.username, connectivity.state, workingOfflineConflict, currentReportVersionNumber]);

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
          createdBy: session.username,
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
        createdBy: session?.username,
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

  // ── Export handlers ──
  // ADR-016: si el informe ya está guardado, usa el export server-side real
  // (Chromium headless, misma fidelidad visual que el visor de lectura). Si
  // aún no tiene id (borrador sin guardar) o el servidor falla, no hay nada
  // que renderizar todavía server-side — cae al viejo camino cliente, que
  // ahora abre la vista previa de impresión (.ro-overlay) en vez de llamar
  // window.print() sobre el editor completo (ver exportEngine.ts::exportPDF).
  // Exports medidos contra el presupuesto O3 de ADR-023 (<5s) — antes
  // measurePerfAsync existía pero no se llamaba desde ningún export real.
  const handleExportPdf = useCallback(async () => {
    if (currentReportId) {
      setAiStatus('Exportando PDF (servidor)...');
      try {
        const { blob, filename, password } = await measurePerfAsync('export', () => fetchReportPdfBlob(currentReportId));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setAiStatus('PDF exportado (servidor)');
        // ADR-080: el PDF llega cifrado y con marca de agua — la contraseña
        // se muestra una única vez, nunca queda guardada en el backend.
        if (password) setPdfPassword(password);
        return;
      } catch (err) {
        log.error('Export PDF server-side falló, usando fallback cliente', err);
      }
    }
    setAiStatus('Exportando PDF...');
    const result = await measurePerfAsync('export', () => exportPDF(doc, { author: loggedAuthor }));
    if (result.method === 'print-fallback') {
      setAiStatus('Sin conexión con el servidor de export — abriendo vista previa de impresión...');
      handlePrintPreview();
      return;
    }
    setAiStatus(result.success ? `PDF exportado (${result.method})` : 'Error al exportar PDF');
  }, [doc, loggedAuthor, currentReportId, handlePrintPreview]);

  const handleExportDocx = useCallback(async () => {
    setAiStatus('Exportando DOCX...');
    const result = await measurePerfAsync('export', () => exportDOCX(doc, { author: loggedAuthor }));
    setAiStatus(result.success ? `DOCX exportado (${result.method})` : 'Error al exportar DOCX');
  }, [doc, loggedAuthor]);

  // Export PPTX (modo presentación): igual que el PDF, requiere un informe ya
  // guardado (el servidor renderiza /print-report.html, no puede hacerlo
  // sobre un borrador que solo existe en memoria del navegador). A diferencia
  // del PDF, no hay fallback cliente sensato — sin sidecar no hay PPTX. Job
  // asíncrono (report_export_job): se crea, se hace polling hasta
  // success/failed, y recién ahí se descarga.
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
      setAiStatus('Informe cambiado a modo presentación. Vuelve a hacer clic en "PPTX" para exportarlo.');
      return;
    }
    setAiStatus('Generando PPTX (servidor)...');
    try {
      const { job_id: jobId } = await measurePerfAsync('export', () => createPptxExportJob(currentReportId));
      const finalStatus = await pollExportJob(currentReportId, jobId, {
        onProgress: (status) => {
          setAiStatus(
            status.status === 'running'
              ? 'Generando PPTX (renderizando diapositivas)...'
              : 'PPTX en cola de exportación...',
          );
        },
      });
      if (finalStatus.status !== 'success') {
        setAiStatus(`Error al exportar PPTX${finalStatus.error_message ? `: ${finalStatus.error_message}` : ''}`);
        return;
      }
      setLastPptxJobId(jobId);
      const { blob, filename } = await fetchExportJobBlob(currentReportId, jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAiStatus('PPTX exportado (servidor)');
    } catch (err) {
      log.error('Export PPTX server-side falló', err);
      const backendError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAiStatus(
        backendError === 'layout_mode_not_presentation'
          ? 'El informe no está en modo presentación.'
          : 'Error al exportar PPTX.',
      );
    }
  }, [currentReportId, doc, setLayoutMode]);

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
      onExportPdf={handleExportPdf}
      onExportVideo={handleRecordScreenToCanvas}
      onPrint={handlePrintPreview}
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
      onInsertElement={(type) => {
        if (type === 'map') setShowMapCapture(true);
        else if (type === 'image') openImageInsertForNew();
        else if (type === 'video') openVideoInsertForNew();
        else addElement(type);
      }}
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
      onStartWorkflow={() => setShowWorkflow((v) => !v)}
      onToggleLeftPanel={() => setLeftPanelVisible((v) => !v)}
      onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
      onExportMiningReport={handleExportMiningReport}
      onImportMiningReport={handleImportMiningReport}
      onExportDocx={handleExportDocx}
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
      onToggleBold={() => { if (!tryApplyToActiveTextSelection({ bold: true })) handleUpdateSelectedProps({ bold: !isBold }); }}
      onToggleItalic={() => { if (!tryApplyToActiveTextSelection({ italic: true })) handleUpdateSelectedProps({ italic: !isItalic }); }}
      onToggleUnderline={() => { if (!tryApplyToActiveTextSelection({ underline: true })) handleUpdateSelectedProps({ underline: !isUnderline }); }}
      onSetAlignment={(align) => handleUpdateSelectedProps({ textAlign: align })}
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

        <main className="studio-main">
          <div className="doc-header-meta">
            <span>ID: <b>{doc.document_id}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Autor: <b>{loggedAuthor}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Versión: <b>{versionLabel}</b></span>
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
          />
        </main>
        <div id="aria-live-region" aria-live="polite" />

        {rightPanelVisible && (
          <RightInspector
            onRequestImageReplace={openImageInsertForReplace}
            showTemplatesPanel={showTemplatesPanel}
            onCloseTemplatesPanel={() => setShowTemplatesPanel(false)}
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
        />
      )}

      {showReadOnly && readOnlyReport && (
        <ReadOnlyViewer
          report={readOnlyReport}
          onClose={() => { setShowReadOnly(false); setReadOnlyReport(null); }}
        />
      )}

      {pdfPassword && (
        <PdfPasswordModal password={pdfPassword} onClose={() => setPdfPassword(null)} />
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
          onSuccess={(msg) => { setShowDeleteModal(false); setDeleteTarget(null); setAiStatus(msg); }}
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
