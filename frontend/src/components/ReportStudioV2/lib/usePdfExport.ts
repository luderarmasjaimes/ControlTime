import { useCallback, useState } from 'react';
import { fetchReportPdfBlob, createPdfExportJob, pollExportJob, fetchExportJobBlob } from './api';

/**
 * ADR-080: descarga el PDF protegido (marca de agua + contraseña generada
 * en el momento) y expone la contraseña recibida para que el llamador la
 * muestre una sola vez (ver PdfPasswordModal). Cada instancia del hook
 * maneja su propio estado — App.tsx (ribbon) y ReadOnlyViewer (vista previa)
 * usan cada uno la suya, sin compartir modal.
 *
 * Intenta primero el pipeline ASÍNCRONO (job, portado del avance de Luder
 * 2026-09-11 -- mismo patrón ya probado con DOCX/PPTX): un informe de miles
 * de páginas puede terminar de renderizar bien y aun así jamás llegar a
 * responder dentro del presupuesto de un request HTTP directo. Si el
 * backend todavía no expone `/export/pdf` como job (404), cae de vuelta al
 * pipeline síncrono (`fetchReportPdfBlob`, el único confirmado hoy) -- así
 * no se arriesga a romper la descarga de PDF mientras no esté confirmado
 * que el backend real ya soporta la ruta nueva.
 *
 * `noWatermark` (ADR-204, default `false`): pide el PDF sin marca de agua --
 * el backend rechaza con 403 si el rol no tiene `informes.export_sin_marca_agua`
 * (perfiles avanzados), el caller (App.tsx) solo debe ofrecer este parámetro
 * detrás del mismo permiso en la UI.
 */
export function usePdfExport() {
  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadPdf = useCallback(async (reportId: string, unprotected = false, noWatermark = false) => {
    setExporting(true);
    setError(null);
    try {
      let blob: Blob;
      let filename: string;
      let pw: string | null;
      try {
        const { job_id: jobId } = await createPdfExportJob(reportId, unprotected, noWatermark);
        const finalStatus = await pollExportJob(reportId, jobId);
        if (finalStatus.status !== 'success') {
          throw new Error(finalStatus.error_message || 'pdf_export_failed');
        }
        ({ blob, filename, password: pw } = await fetchExportJobBlob(reportId, jobId));
      } catch (jobErr) {
        // 404 = el backend todavía no expone /export/pdf como job -- único
        // caso que cae de vuelta al pipeline síncrono confirmado. Cualquier
        // otro error (job creado pero falló, timeout de polling, etc.) es un
        // fallo real de exportación, no de routing: se relanza tal cual.
        const status = (jobErr as { response?: { status?: number } })?.response?.status;
        if (status !== 404) throw jobErr;
        ({ blob, filename, password: pw } = await fetchReportPdfBlob(reportId, noWatermark));
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (pw) setPassword(pw);
      return true;
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'export_busy'
          ? 'Ya hay una exportación pesada en curso. Espere a que termine.'
          : 'No se pudo generar el PDF protegido.',
      );
      throw err;
    } finally {
      setExporting(false);
    }
  }, []);

  const clearPassword = useCallback(() => setPassword(null), []);

  return { downloadPdf, exporting, password, clearPassword, error };
}
