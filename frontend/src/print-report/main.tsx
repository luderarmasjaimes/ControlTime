import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReadOnlyViewer from '../components/ReportStudioV2/components/viewers/ReadOnlyViewer';
import { fetchReportById, fetchTelemetryWizardSeries, setExplicitBearerToken } from '../components/ReportStudioV2/lib/api';
import '../index.css';
import '../components/ReportStudioV2/styles.css';

/**
 * Precarga TODA la telemetría que va a necesitar el documento ANTES de que
 * arranque la captura por-página del sidecar de export (DOCX/PPTX/PDF).
 *
 * Por qué: `SensorMultiChartWidget.tsx` pide sus datos en su propio
 * `useEffect` de montaje -- funciona bien en el editor interactivo, pero en
 * un export grande (miles de páginas) el sidecar monta/desmonta páginas
 * agresivamente según avanza la ventana de virtualización
 * (`EXPORT_VIRTUALIZATION_WINDOW`, ver ReadOnlyViewer.tsx). Reproducido en
 * vivo en un documento de 2104 páginas / 6300 gráficos: la petición de
 * telemetría de un widget se aborta a mitad de vuelo ("net::ERR_ABORTED" en
 * los logs del sidecar) cuando su página cae fuera de esa ventana antes de
 * que la respuesta llegue -- ampliar la ventana ayuda pero no elimina el
 * problema de raíz (con miles de widgets, SIEMPRE hay alguno compitiendo con
 * el reloj), y cada intento fallido reintenta sobre un componente que
 * también puede volver a desmontarse.
 *
 * La solución real: sacar el fetch del ciclo de vida del widget. Casi todos
 * los ~6300 bloques de un documento grande comparten los MISMOS sensores +
 * rango de fechas (mismo sensorType repetido en 20 tipos de gráfico × N
 * repeticiones) -- típicamente son solo ~20-30 combinaciones ÚNICAS de
 * (sensores, from, to). Escanea el documento, dispara esas combinaciones
 * ÚNICAS de una sola vez (la cola/caché de `fetchTelemetryWizardSeries` en
 * api.ts ya deduplica y comparte resultado -- ver `telemetryInFlightQueries`
 * y su TTL de 30 min), y espera a que TODAS terminen antes de dejar avanzar
 * el export. Cuando cada widget monte más adelante, su fetch ya no golpea
 * la red -- lee directo de ese caché, sin ninguna carrera contra la
 * virtualización.
 */
async function prefetchAllSensorTelemetry(doc: any, tenantId: string | undefined): Promise<void> {
  if (!doc || !Array.isArray(doc.pages)) return;
  const seen = new Map<string, { sensorIds: string[]; from: string; to: string }>();
  for (const page of doc.pages) {
    if (!Array.isArray(page?.elements)) continue;
    for (const el of page.elements) {
      if (el?.type !== 'sensor_multi_chart') continue;
      const selections = Array.isArray(el?.props?.selections) ? el.props.selections : [];
      const sensorIds: string[] = selections.map((s: any) => s?.sensorId).filter(Boolean);
      const from = el?.props?.from;
      const to = el?.props?.to;
      // Ventana en vivo ("Última hora"): el widget recalcula su propio rango
      // al montar, un prefetch con el from/to guardado no le serviría.
      if (sensorIds.length === 0 || !from || !to || el?.props?.liveWindowMinutes) continue;
      const key = `${sensorIds.join(',')}|${from}|${to}`;
      if (!seen.has(key)) seen.set(key, { sensorIds, from, to });
    }
  }
  if (seen.size === 0) return;
  await Promise.allSettled(
    Array.from(seen.values()).map(({ sensorIds, from, to }) =>
      fetchTelemetryWizardSeries({ sensorIds, from, to, tenant_id: tenantId })),
  );
}

declare global {
  interface Window {
    __PDF_READY__?: boolean;
    /** Documento parseado (`content_json`), expuesto SOLO para que el
     * sidecar de export DOCX (`pdf-export-service/server.js::/render-docx`)
     * lo lea vía `page.evaluate` sin tener que reconstruirlo desde el DOM —
     * mismo dato que ya usa `ReadOnlyViewer` para renderizar. */
    __REPORT_DOCUMENT__?: unknown;
    /** Chrome de plataforma (empresa/autor) para encabezado/carátula del
     * DOCX server-side. A diferencia del pipeline cliente (que lee la
     * sesión REAL de quien exporta vía `getSession()`), este Chromium
     * headless navega con un token en memoria, sin `localStorage` (ADR-082)
     * — `getSession()` no tiene nada que leer aquí. Se deriva de los
     * metadatos del propio informe en vez de la sesión (más robusto para
     * un render server-side: no depende de que exista una sesión de
     * navegador). No incluye unidad minera (no es un campo del informe) —
     * diferencia de fidelidad conocida frente al pipeline cliente. */
    __REPORT_SESSION_CHROME__?: { company?: string; fullName?: string; tenantId?: string };
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
      .then(async (full) => {
        setReport(full);
        let doc: any;
        try {
          const cj = full?.content_json ?? full?.contentJson;
          doc = typeof cj === 'string' ? JSON.parse(cj) : cj;
          window.__REPORT_DOCUMENT__ = doc;
        } catch {
          window.__REPORT_DOCUMENT__ = undefined;
        }
        window.__REPORT_SESSION_CHROME__ = {
          company: full?.company || full?.company_name,
          fullName: full?.createdByName || full?.created_by_name,
          tenantId: full?.tenant_id || full?.tenantId,
        };
        // Precarga toda la telemetría del documento ANTES de que la captura
        // por-página del sidecar arranque -- ver comentario de
        // `prefetchAllSensorTelemetry` más arriba. Nunca bloquea el export
        // por un error de red puntual (allSettled adentro de la función).
        await prefetchAllSensorTelemetry(doc, full?.tenant_id || full?.tenantId);
        // Esperar la fuente 'Inter' (ver <link> en print-report.html, ahora
        // auto-hospedada -- ADR-184) antes de pintar -- sin esto, el texto
        // se captura con la fuente de respaldo del sistema, de métricas
        // distintas, y una celda de tabla larga envuelve a MÁS líneas de lo
        // que el alto guardado del bloque contempla -- las últimas filas
        // quedan recortadas por el overflow:hidden de su contenedor
        // (encontrado en vivo: una tabla de 6 filas exportaba solo 4).
        // `catch(() => {})` porque `document.fonts.ready` en teoría podría
        // no resolver nunca en un entorno roto -- degradar al
        // comportamiento anterior (2 rAF) es mejor que colgar el export
        // entero; el timeout de 4s queda como red de seguridad aunque ya
        // no se espere alcanzarlo en el camino normal (fuente local).
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]).catch(() => {});
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
  return <ReadOnlyViewer report={report} onClose={null} isPrint={true} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PrintReportRoot />);
