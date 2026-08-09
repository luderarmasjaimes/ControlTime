import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReadOnlyViewer from '../components/ReportStudioV2/components/viewers/ReadOnlyViewer';
import { fetchReportById, setExplicitBearerToken } from '../components/ReportStudioV2/lib/api';

declare global {
  interface Window {
    __PDF_READY__?: boolean;
  }
}

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
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  // Solo el sidecar de export PPTX navega con esto (server-side, nunca lo
  // agrega un usuario) — ver ReadOnlyViewer.tsx::hideOverlayText y
  // pdf-export-service/server.js::/render-pptx.
  const hideOverlayText = params.get('pptxOverlay') === '1';

  useEffect(() => {
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) {
      setError('missing_id_or_token');
      window.__PDF_READY__ = true;
      return;
    }
    // ADR-082: el resto de la app se autentica por cookie HttpOnly, pero este
    // Chromium headless no tiene las cookies del usuario — el sidecar le pasa
    // el token en la URL. Se instala en memoria del módulo (no en
    // localStorage, como antes: ahí quedaba un JWT escrito en disco del
    // contenedor de export, legible por cualquier cosa que corriera en esa
    // página).
    setExplicitBearerToken(token);
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
  return <ReadOnlyViewer report={report} onClose={null} hideOverlayText={hideOverlayText} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PrintReportRoot />);
