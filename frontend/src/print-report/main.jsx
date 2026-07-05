import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReadOnlyViewer from '../components/ReportStudioV2/components/viewers/ReadOnlyViewer';
import { fetchReportById } from '../components/ReportStudioV2/lib/api';

/**
 * Entry point aislado (ADR-016) para el export PDF server-side: Chromium
 * headless (pdf-export-service) navega aquí con ?id=<report>&token=<sesión>,
 * reutilizando el MISMO componente de solo-lectura (ReadOnlyViewer) y su CSS
 * @media print que ya ve el usuario — cero lógica de renderizado duplicada,
 * cero riesgo de que el PDF diverja visualmente del editor.
 *
 * window.__PDF_READY__ se marca recién cuando el informe terminó de cargar
 * (o falló), para que el sidecar sepa cuándo es seguro capturar el PDF en
 * vez de adivinar un timeout fijo.
 */
function PrintReportRoot() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) {
      setError('missing_id_or_token');
      window.__PDF_READY__ = true;
      return;
    }
    // Reutiliza el mismo mecanismo de sesión que el resto de la app (el
    // interceptor de axios en lib/api.js lee este localStorage), sin
    // duplicar el cliente HTTP solo para esta página de impresión.
    localStorage.setItem('mining_auth_session_v1', JSON.stringify({ token }));
    fetchReportById(id)
      .then((full) => {
        setReport(full);
        // Deja que React pinte el DOM del informe antes de marcar listo.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__PDF_READY__ = true;
        }));
      })
      .catch((err) => {
        setError(err?.message || 'fetch_failed');
        window.__PDF_READY__ = true;
      });
  }, []);

  if (error) {
    return <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#b91c1c' }}>Error: {error}</div>;
  }
  if (!report) {
    return <div style={{ padding: 24, fontFamily: 'sans-serif' }}>Cargando informe…</div>;
  }
  return <ReadOnlyViewer report={report} onClose={null} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintReportRoot />);
