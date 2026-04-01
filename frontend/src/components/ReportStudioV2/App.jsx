import React, { useMemo, useState } from 'react';
import TopToolbar from './components/layout/TopToolbar';
import LeftLibrary from './components/layout/LeftLibrary';
import RightInspector from './components/layout/RightInspector';
import MultipageView from './components/document/MultipageView';
import { useEditorStore } from './store/useEditorStore';
import ReportsAdminModal from './components/modals/ReportsAdminModal';
import ReadOnlyViewer from './components/viewers/ReadOnlyViewer';
import ShareReportModal from './components/modals/ShareReportModal';
import DeleteReportConfirm from './components/modals/DeleteReportConfirm';
import MapCaptureModal from './components/modals/MapCaptureModal';
import { saveReportAsync } from './lib/reportsStorage';
import { fetchReportById } from './lib/api';
import { getSession } from '../../auth/authStorage';
import './styles.css';

export default function App() {
  const session = getSession();
  const loggedAuthor = session?.fullName || session?.username || 'Usuario';

  const doc = useEditorStore((s) => s.doc);
  const addElement = useEditorStore((s) => s.addElement);
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

  const currentReportId = useEditorStore((s) => s.currentReportId);
  const currentReportTitle = useEditorStore((s) => s.currentReportTitle);
  const setCurrentReportId = useEditorStore((s) => s.setCurrentReportId);
  const setCurrentReportTitle = useEditorStore((s) => s.setCurrentReportTitle);
  const loadDocument = useEditorStore((s) => s.loadDocument);

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
      console.log('Report saved successfully:', saved);
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
      console.error('Error al guardar informe:', err);
      setSaveLabel('Error');
      setTimeout(() => setSaveLabel('Guardar'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Abrir informe desde modal (Leer / Editar / Enviar / Eliminar) ──────────
  const handleOpenRead = (report) => {
    if (report._action === 'send') {
      setShareTarget(report);
      setShowShareModal(true);
    } else if (report._action === 'delete') {
      setDeleteTarget(report);
      setShowDeleteModal(true);
    } else {
      setReadOnlyReport(report);
      setShowReadOnly(true);
    }
  };

  const handleOpenEdit = async (report) => {
    setShowReportsAdmin(false);
    try {
      const full = await fetchReportById(report.id);
      const docPayload = full.content_json ?? full.contentJson;
      loadDocument(docPayload, full.id, full.title);
    } catch (err) {
      console.error('handleOpenEdit', err);
      setAiStatus('No se pudo cargar el informe para editar.');
      alert('No se pudo cargar el informe desde el servidor. Revisa la sesión o la red.');
    }
  };

  const handleExportVideo = async () => {
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
      console.error('No se pudo grabar video del informe', error);
      setIsRecording(false);
      alert('No se pudo iniciar la grabacion de video.');
    }
  };
 
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

  // ── Handler para insertar imagen capturada del mapa ──
  const handleMapCaptureComplete = (imageDataUrl) => {
    if (!imageDataUrl || imageDataUrl.length < 100) {
      console.error('Imagen de captura vacía o inválida');
      setAiStatus('Error: La imagen del mapa no se capturó correctamente. Intenta nuevamente.');
      return;
    }

    // Cerramos el modal
    setShowMapCapture(false);
    
    // Creamos un elemento de imagen con la captura
    const page = doc.pages.find((p) => p.page_number === selectedPage);
    if (!page) {
      console.error('Página actual no encontrada');
      return;
    }

    const newElement = {
      id: `map-image-${selectedPage}-${Date.now()}`,
      type: 'image',
      x: 40,
      y: page.elements.length ? Math.max(...page.elements.map((e) => e.y + e.height)) + 12 : 90,
      width: 350,
      height: 280,
      zIndex: page.elements.length,
      locked: false,
      src: imageDataUrl,
      objectFit: 'cover',
      props: {
        alt: 'Captura del Mapa Detallado Pro',
        borderRadius: 8,
        borderColor: '#cbd5e1',
        borderWidth: 2
      }
    };

    // Insertamos el elemento en la página actual
    const updatedPages = doc.pages.map((p) => {
      if (p.page_number === selectedPage) {
        return { ...p, elements: [...p.elements, newElement] };
      }
      return p;
    });

    useEditorStore.setState({
      doc: {
        ...doc,
        pages: updatedPages,
        meta: { ...doc.meta, version: doc.meta.version + 1, updatedAt: new Date().toISOString() }
      },
      selectedElementId: newElement.id
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

  return (
    <div className="app-shell">
      <TopToolbar
        onExportPdf={() => window.print()}
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
      />

      <div className="studio-layout">
        <LeftLibrary
          onAdd={(type) => {
            if (type === 'map') {
              setShowMapCapture(true);
            } else {
              addElement(type);
            }
          }}
          onAddPage={addPage}
          onDuplicatePage={() => duplicatePage(selectedPage)}
          onAddHeader={() => addTextTemplate('header')}
          onAddFooter={() => addTextTemplate('footer')}
          onAddFindings={() => addTextTemplate('findings')}
          onExportVideo={handleExportVideo}
          isRecording={isRecording}
        />

        <main className="studio-main">
          <div className="doc-header-meta">
            <span>ID: <b>{doc.document_id}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Autor: <b>{loggedAuthor}</b></span>
            <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
            <span>Versión: <b>{versionLabel}</b></span>
            {aiStatus ? (
              <>
                <span style={{ height: '14px', width: '1px', background: 'var(--border)' }}></span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{aiStatus}</span>
              </>
            ) : null}
          </div>
          <MultipageView zoomPercent={zoomPercent} />
        </main>

        <RightInspector />
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

      {showMapCapture && (
        <MapCaptureModal
          onClose={() => setShowMapCapture(false)}
          onCaptureComplete={handleMapCaptureComplete}
        />
      )}
    </div>
  );
}
