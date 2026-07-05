import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RibbonToolbar from './components/layout/RibbonToolbar';
import LeftLibrary from './components/layout/LeftLibrary';
import RightInspector from './components/layout/RightInspector';
import MultipageView from './components/document/MultipageView';
import TableOfContents from './components/document/TableOfContents';
import WorkflowPanel, { createWorkflowEntry, WorkflowStatusBadge } from './components/document/WorkflowPanel';
import VersionHistory, { createSnapshot } from './components/document/VersionHistory';
import VersionComparator from './components/document/VersionComparator';
import VoiceDictation from './components/document/VoiceDictation';
import PerformanceDashboard from './components/dashboard/PerformanceDashboard';
import { useEditorStore } from './store/useEditorStore';
import ReportsAdminModal from './components/modals/ReportsAdminModal';
import ReadOnlyViewer from './components/viewers/ReadOnlyViewer';
import ShareReportModal from './components/modals/ShareReportModal';
import DeleteReportConfirm from './components/modals/DeleteReportConfirm';
import MapCaptureModal from './components/modals/MapCaptureModal';
import ImageInsertModal from './components/modals/ImageInsertModal';
import FormulaAnalysisModal from './components/modals/FormulaAnalysisModal';
import { saveReportAsync } from './lib/reportsStorage';
import { startAutosave, stopAutosave, subscribeAutosave } from './lib/autosaveEngine';
import { downloadMiningReport, importMiningReport, reconcileDocuments } from './lib/miningReportFormat';
import { exportPDF, exportDOCX, exportPPTX } from './lib/exportEngine';
import { initAccessibility, destroyAccessibility } from './lib/accessibility';
import {
  fetchReportById,
  fetchReportRevisions,
  fetchReportPdfBlob,
  syncMiningKpisFromDashboard,
  syncMiningKpisFromExternal,
} from './lib/api';
import { getSession } from '../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../auth/telemetryTenant';
import { log } from '../../lib/logger';
import './styles.css';
import './ribbon.css';

export default function App({
  openFormulaOnLoad = false,
  platformCompanyName,
  telemetryTenantId: telemetryTenantIdProp,
}) {
  const session = getSession();
  const telemetryTenantId = telemetryTenantIdProp ?? telemetryTenantIdFromSession(session);
  const loggedAuthor = session?.fullName || session?.username || 'Usuario';

  const doc = useEditorStore((s) => s.doc);
  const addElement = useEditorStore((s) => s.addElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const addTextTemplate = useEditorStore((s) => s.addTextTemplate);
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

  const [isRecording, setIsRecording] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [reviewResult, setReviewResult] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [showAiReview, setShowAiReview] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiSeverityFilter, setAiSeverityFilter] = useState('todas');
  const [aiSearchTerm, setAiSearchTerm] = useState('');

  // ── Reports Admin ──────────────────────────────────────────────────────────
  const [showReportsAdmin, setShowReportsAdmin] = useState(false);
  const [showReadOnly, setShowReadOnly] = useState(false);
  const [readOnlyReport, setReadOnlyReport] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Guardar');
  const [showMapCapture, setShowMapCapture] = useState(false);
  const [showImageInsertModal, setShowImageInsertModal] = useState(false);
  const [imageInsertReplaceTarget, setImageInsertReplaceTarget] = useState(null);
  const [imageInsertInitialTab, setImageInsertInitialTab] = useState('file');
  const [imageInsertOpenSeq, setImageInsertOpenSeq] = useState(0);
  /** Evita cierre con estado obsoleto al completar desde el portal (ref sincronizado al abrir). */
  const imageInsertIntentRef = useRef(null);
  const [showFormulaAnalysis, setShowFormulaAnalysis] = useState(openFormulaOnLoad);
  const [isSyncingKpis, setIsSyncingKpis] = useState(false);
  const [kpiAutoSyncEnabled, setKpiAutoSyncEnabled] = useState(true);
  const [syncToast, setSyncToast] = useState(null);

  // ── Stage 1 new state ──
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState('draft');
  // Firma documental (ADR-018): solo lectura en el cliente, la escribe el
  // servidor en el momento exacto de la transición a 'signed'.
  const [reportSignature, setReportSignature] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
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
  const [showToc, setShowToc] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  // ── Stage 2 state ──
  const [showComparator, setShowComparator] = useState(false);
  const [showVoiceDictation, setShowVoiceDictation] = useState(false);
  const [showPerfDashboard, setShowPerfDashboard] = useState(false);

  const currentReportId = useEditorStore((s) => s.currentReportId);
  const currentReportTitle = useEditorStore((s) => s.currentReportTitle);
  const setCurrentReportId = useEditorStore((s) => s.setCurrentReportId);
  const setCurrentReportTitle = useEditorStore((s) => s.setCurrentReportTitle);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  const setLayoutMode = useEditorStore((s) => s.setLayoutMode);

  const selectedElement = useMemo(() => {
    if (!selectedElementId || !selectedPage) return null;
    const page = doc.pages.find(p => p.page_number === selectedPage);
    return page?.elements?.find(e => e.id === selectedElementId) || null;
  }, [doc.pages, selectedPage, selectedElementId]);

  const handleUpdateSelectedProps = useCallback((newProps) => {
    if (!selectedElementId || !selectedPage || !selectedElement) return;
    updateElement(selectedPage, selectedElementId, { props: { ...(selectedElement.props || {}), ...newProps } });
  }, [selectedElementId, selectedPage, selectedElement, updateElement]);

  const currentProps = selectedElement?.props || {};
  const currentFontFamily = currentProps.fontFamily;
  const currentFontSize = currentProps.fontSize;
  const currentFontColor = currentProps.fontColor;
  const currentAlignment = currentProps.textAlign;
  const isBold = currentProps.bold;
  const isItalic = currentProps.italic;
  const isUnderline = currentProps.underline;

  // ── Guardar informe ────────────────────────────────────────────────────────
  const handleSaveReport = async () => {
    if (!session) {
      alert('Por favor inicia sesión para guardar un informe.');
      return;
    }

    let title = currentReportTitle;
    if (!currentReportId) {
      const input = window.prompt('Nombre del informe:', title);
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
      
      setCurrentReportTitle(title);
      setSaveLabel('¡Guardado!');
      setTimeout(() => setSaveLabel('Guardar'), 2000);
    } catch (err) {
      log.error('Error al guardar informe:', err);
      setSaveLabel('Error');
      setTimeout(() => setSaveLabel('Guardar'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Abrir informe desde modal (Leer / Editar / Enviar / Eliminar) ──────────
  const handleOpenRead = async (report) => {
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
        const full = await fetchReportById(report.id);
        setReadOnlyReport({ ...report, ...full });
      } catch (err) {
        log.error('handleOpenRead: fetchReportById', err);
      }
    }
  };

  const handleOpenEdit = async (report) => {
    setShowReportsAdmin(false);
    try {
      const full = await fetchReportById(report.id);
      const docPayload = full.content_json ?? full.contentJson;
      loadDocument(docPayload, full.id, full.title);
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
    } catch (err) {
      log.error('handleOpenEdit', err);
      setAiStatus('No se pudo cargar el informe para editar.');
      alert('No se pudo cargar el informe desde el servidor. Revisa la sesión o la red.');
    }
  };

  const handleExportVideo = useCallback(async () => {
    if (!navigator?.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      alert('Exportacion a video no disponible en este navegador.');
      return;
    }

    try {
      setIsRecording(true);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `informe-tecnico-minero-${Date.now()}.webm`;
        link.click();
        URL.revokeObjectURL(url);
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
      };

      recorder.start(300);
      const maxSeconds = 30;
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, maxSeconds * 1000);
    } catch (error) {
      log.error('No se pudo grabar video del informe', error);
      setIsRecording(false);
      alert('No se pudo iniciar la grabacion de video.');
    }
  }, []);

  const versionLabel = useMemo(() => `v${doc.meta.version}`, [doc.meta.version]);

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

    setAiSuggestions(suggestions.map((item) => ({ ...item, decision: 'pending' })));
    setAiSeverityFilter('todas');
    setAiSearchTerm('');
    setShowAiReview(true);
    setAiStatus(`IA detectó ${suggestions.length} mejora(s). Revisa y decide aplicar.`);
  };

  const markSuggestion = (id, decision) => {
    setAiSuggestions((prev) => prev.map((item) => (item.id === id ? { ...item, decision } : item)));
  };

  const applySingleSuggestion = (item) => {
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

  // ── Callbacks estables para LeftLibrary (React.memo) ──
  // Antes eran arrow functions inline en el JSX: se recreaban en cada
  // render de App.jsx (que tiene ~30 useState) y anulaban cualquier memo
  // posible en LeftLibrary, sin importar cómo estuviera implementado.
  const handleLeftLibraryAdd = useCallback((type) => {
    if (type === 'map') {
      setShowMapCapture(true);
    } else if (type === 'image') {
      openImageInsertForNew();
    } else {
      addElement(type);
    }
  }, [addElement, openImageInsertForNew]);

  const handleDuplicatePage = useCallback(() => {
    duplicatePage(selectedPage);
  }, [duplicatePage, selectedPage]);

  const handleAddHeader = useCallback(() => addTextTemplate('header'), [addTextTemplate]);
  const handleAddFooter = useCallback(() => addTextTemplate('footer'), [addTextTemplate]);
  const handleAddFindings = useCallback(() => addTextTemplate('findings'), [addTextTemplate]);
  const handleAddCover = useCallback(() => addElement('cover'), [addElement]);
  const handleAddToc = useCallback(() => addElement('toc'), [addElement]);

  const openImageInsertForReplace = useCallback(
    (pageNumber, elementId, initialTab = 'file') => {
      const tab = ['file', 'camera', 'network'].includes(initialTab) ? initialTab : 'file';
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

  const handleImageInsertComplete = useCallback(
    (imageDataUrl) => {
      if (!imageDataUrl || imageDataUrl.length < 32) {
        setAiStatus('Error: imagen vacía o inválida.');
        return;
      }
      const target = imageInsertIntentRef.current;
      if (target?.pageNumber != null && target?.elementId) {
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
    [addElement, updateElement],
  );

  const closeImageInsertModal = useCallback(() => {
    imageInsertIntentRef.current = null;
    setShowImageInsertModal(false);
    setImageInsertReplaceTarget(null);
  }, []);

  // ── Handler para insertar imagen capturada del mapa ──
  const handleMapCaptureComplete = (imageDataUrl) => {
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

  const handleZoomIn = () => setZoomPercent((prev) => Math.min(180, prev + 10));
  const handleZoomOut = () => setZoomPercent((prev) => Math.max(60, prev - 10));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    } catch (err) {
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

  // ── Autosave engine ──
  useEffect(() => {
    const unsub = subscribeAutosave((state) => setAutosaveStatus(state.status));
    startAutosave(
      () => useEditorStore.getState().doc,
      async (doc) => {
        if (!session || !currentReportId) return;
        await saveReportAsync({
          id: currentReportId,
          title: currentReportTitle,
          contentJson: JSON.stringify(doc),
          status: workflowStatus,
          createdBy: session.username,
          company: session.company || 'default',
        });
      },
      currentReportId,
    );
    return () => { stopAutosave(); unsub(); };
  }, [currentReportId, session?.username]);

  // ── Workflow transitions ──
  // ADR-017: el servidor es la autoridad de la máquina de estados. Antes,
  // esto solo tocaba estado local de React y esperaba al próximo ciclo de
  // autosave para llegar al backend — una transición inválida (o rechazada
  // por otro motivo) quedaba "aceptada" en la UI sin que el usuario lo supiera
  // hasta minutos después. Ahora se llama al backend de inmediato y el
  // estado local solo avanza si el servidor confirma la transición.
  const handleWorkflowTransition = useCallback(async (nextStatus, comment) => {
    if (!currentReportId) {
      setAiStatus('Guarde el informe antes de cambiar su estado de workflow.');
      return;
    }
    const previousStatus = workflowStatus;
    try {
      await saveReportAsync({
        id: currentReportId,
        title: currentReportTitle,
        contentJson: JSON.stringify(doc),
        status: nextStatus,
        createdBy: session.username,
        company: session.company || 'default',
        // ADR-030: el comentario (p.ej. motivo de rechazo) viaja al servidor
        // para quedar en la entrada de auditoría de esta transición. Antes
        // solo se guardaba en el `auditLog` local (bitácora en pantalla y
        // export .miningreport), nunca llegaba al rastro forense real.
        workflowComment: comment,
      });
    } catch (err) {
      const serverError = err?.response?.data?.error || '';
      if (err?.response?.status === 400 && serverError.startsWith('invalid_workflow_transition')) {
        setAiStatus(`Transición rechazada: ${previousStatus} → ${nextStatus} no es válida.`);
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
  }, [workflowStatus, auditLog, loggedAuthor, currentReportId, currentReportTitle, doc, session]);

  // ── .miningreport export/import ──
  const handleExportMiningReport = useCallback(async () => {
    try {
      await downloadMiningReport(doc, {
        author: loggedAuthor,
        company: session?.company,
        unit: session?.miningUnit,
        title: currentReportTitle,
        auditLog,
        workflow: { status: workflowStatus },
      });
      setAiStatus('Archivo .miningreport exportado exitosamente.');
    } catch (err) {
      log.error('Export .miningreport failed', err);
      setAiStatus('Error al exportar .miningreport.');
    }
  }, [doc, loggedAuthor, session, currentReportTitle, auditLog, workflowStatus]);

  const handleImportMiningReport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.miningreport';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const result = await importMiningReport(file);
        if (!result.isValid) {
          const proceed = confirm('⚠️ La firma SHA-256 no es válida. ¿Desea abrir el archivo de todas formas?');
          if (!proceed) return;
        }
        loadDocument(result.document, null, result.manifest?.title);
        setWorkflowStatus(result.workflow?.status || 'draft');
        setAuditLog(result.auditLog || []);
        setAiStatus(`Importado: ${result.manifest?.title || 'Informe'} (${result.isValid ? 'firma válida ✓' : 'firma inválida ⚠'})`);
      } catch (err) {
        log.error('Import .miningreport failed', err);
        setAiStatus('Error al importar archivo .miningreport.');
      }
    };
    input.click();
  }, [loadDocument]);

  // ── Export handlers ──
  // ADR-016: si el informe ya está guardado, usa el export server-side real
  // (Chromium headless, misma fidelidad visual que el visor de lectura). Si
  // aún no tiene id (borrador sin guardar), no hay nada que el servidor
  // pueda renderizar todavía — cae al viejo camino cliente (window.print()).
  const handleExportPdf = useCallback(async () => {
    if (currentReportId) {
      setAiStatus('Exportando PDF (servidor)...');
      try {
        const { blob, filename } = await fetchReportPdfBlob(currentReportId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setAiStatus('PDF exportado (servidor)');
        return;
      } catch (err) {
        log.error('Export PDF server-side falló, usando fallback cliente', err);
      }
    }
    setAiStatus('Exportando PDF...');
    const result = await exportPDF(doc, { author: loggedAuthor });
    setAiStatus(result.success ? `PDF exportado (${result.method})` : 'Error al exportar PDF');
  }, [doc, loggedAuthor, currentReportId]);

  const handleExportDocx = useCallback(async () => {
    setAiStatus('Exportando DOCX...');
    const result = await exportDOCX(doc, { author: loggedAuthor });
    setAiStatus(result.success ? `DOCX exportado (${result.method})` : 'Error al exportar DOCX');
  }, [doc, loggedAuthor]);

  const handleExportPptx = useCallback(async () => {
    setAiStatus('Exportando PPTX...');
    const result = await exportPPTX(doc, { author: loggedAuthor });
    setAiStatus(result.success ? 'PPTX exportado' : 'Error al exportar PPTX');
  }, [doc, loggedAuthor]);

  // ── Version snapshots ──
  const handleCreateSnapshot = useCallback(() => {
    const desc = prompt('Descripción del snapshot:', `Versión ${doc.meta?.version || 1}`);
    if (desc === null) return;
    const snap = createSnapshot(doc, loggedAuthor, desc);
    setSnapshots((prev) => [...prev, snap]);
    setAiStatus(`Snapshot v${snap.version} creado.`);
  }, [doc, loggedAuthor]);

  const handleRestoreSnapshot = useCallback((snap) => {
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
        const summaryLabels = {
          creacion_inicial: 'Creación inicial',
          autosave: 'Autoguardado',
        };
        const mapped = revisions.map((rev) => {
          const content = rev.content_json || {};
          const pages = content.pages || [];
          return {
            id: `rev-${rev.revision_id}`,
            timestamp: rev.created_at,
            version: rev.version_number,
            author: rev.created_by || 'Sistema',
            description: summaryLabels[rev.change_summary] || rev.change_summary || `Versión ${rev.version_number}`,
            pageCount: pages.length,
            elementCount: pages.reduce((sum, p) => sum + (p.elements?.length || 0), 0),
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
  const handleVoiceInsert = useCallback((text) => {
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

  const [designToolbarHost, setDesignToolbarHost] = useState(null);
  useLayoutEffect(() => {
    setDesignToolbarHost(document.getElementById('report-v2-design-toolbar-host'));
  }, []);

  const designToolbar = (
    <RibbonToolbar
      onExportPdf={handleExportPdf}
      onExportVideo={handleExportVideo}
      onPrint={() => window.print()}
      onReviewDocument={handleReviewDocument}
      onOptimizeDocument={handleOptimizeDocument}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      gridEnabled={gridEnabled}
      snapEnabled={snapEnabled}
      onToggleGrid={() => setGridEnabled(!gridEnabled)}
      onToggleSnap={() => setSnapEnabled(!snapEnabled)}
      isRecording={isRecording}
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
      onInsertElement={(type) => {
        if (type === 'map') setShowMapCapture(true);
        else if (type === 'image') openImageInsertForNew();
        else addElement(type);
      }}
      onAddPage={addPage}
      onDuplicatePage={() => duplicatePage(selectedPage)}
      onAddTemplate={(tmpl) => addTextTemplate(tmpl)}
      onInsertTOC={() => setShowToc((v) => !v)}
      onStartWorkflow={() => setShowWorkflow((v) => !v)}
      onToggleLeftPanel={() => setLeftPanelVisible((v) => !v)}
      onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
      onExportMiningReport={handleExportMiningReport}
      onImportMiningReport={handleImportMiningReport}
      onExportDocx={handleExportDocx}
      onExportPptx={handleExportPptx}
      onCreateSnapshot={handleCreateSnapshot}
      onShowVersionHistory={() => setShowVersionHistory((v) => !v)}
      onShowComparator={() => setShowComparator((v) => !v)}
      onToggleVoiceDictation={() => setShowVoiceDictation((v) => !v)}
      onTogglePerfDashboard={() => setShowPerfDashboard((v) => !v)}
      currentFontFamily={currentFontFamily}
      currentFontSize={currentFontSize}
      currentFontColor={currentFontColor}
      currentAlignment={currentAlignment}
      currentBold={isBold}
      currentItalic={isItalic}
      currentUnderline={isUnderline}
      onApplyHeadingStyle={(style) => handleUpdateSelectedProps({ fontSize: style.fontSize, bold: style.fontWeight >= 600, fontColor: style.color })}
      onToggleBold={() => handleUpdateSelectedProps({ bold: !isBold })}
      onToggleItalic={() => handleUpdateSelectedProps({ italic: !isItalic })}
      onToggleUnderline={() => handleUpdateSelectedProps({ underline: !isUnderline })}
      onSetAlignment={(align) => handleUpdateSelectedProps({ textAlign: align })}
      onSetFontFamily={(font) => handleUpdateSelectedProps({ fontFamily: font })}
      onSetFontSize={(size) => handleUpdateSelectedProps({ fontSize: size })}
      onSetFontColor={(color) => handleUpdateSelectedProps({ fontColor: color })}
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
            onAddHeader={handleAddHeader}
            onAddFooter={handleAddFooter}
            onAddFindings={handleAddFindings}
            onAddCover={handleAddCover}
            onAddToc={handleAddToc}
            onExportVideo={handleExportVideo}
            isRecording={isRecording}
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

          {showToc && <TableOfContents doc={doc} onRefresh={() => setShowToc(true)} />}
          {showWorkflow && (
            <WorkflowPanel
              reportId={currentReportId}
              currentStatus={workflowStatus}
              signature={reportSignature}
              auditLog={auditLog}
              onTransition={handleWorkflowTransition}
              onClose={() => setShowWorkflow(false)}
              currentUser={loggedAuthor}
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

          <MultipageView zoomPercent={zoomPercent} onRequestImageReplace={openImageInsertForReplace} />
        </main>
        <div id="aria-live-region" aria-live="polite" />

        {rightPanelVisible && (
          <RightInspector onRequestImageReplace={openImageInsertForReplace} />
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
              initialTab={imageInsertInitialTab}
              openSequence={imageInsertOpenSeq}
            />,
            document.body,
          )
        : null}

      {showFormulaAnalysis && (
        <FormulaAnalysisModal onClose={() => setShowFormulaAnalysis(false)} />
      )}
    </div>
  );
}
