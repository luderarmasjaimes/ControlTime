import { useCallback, useState } from 'react';
import { createPdfExportJob, pollExportJob, fetchExportJobBlob } from './api';

/**
 * ADR-080: descarga el PDF protegido (marca de agua + contraseña generada
 * en el momento) y expone la contraseña recibida para que el llamador la
 * muestre una sola vez (ver PdfPasswordModal). Cada instancia del hook
 * maneja su propio estado — App.tsx (ribbon) y ReadOnlyViewer (vista previa)
 * usan cada uno la suya, sin compartir modal.
 *
 * Job asíncrono (report_export_job, /render-pdf) -- antes llamaba a
 * `fetchReportPdfBlob` (GET síncrono, ADR-016): un informe de miles de
 * páginas puede terminar de renderizar bien y aun así jamás llegar a
 * responder dentro del presupuesto de un request HTTP directo. Mismo
 * patrón que ya usa DOCX/PPTX (`handleExportDocx`/`handleExportPptx` en
 * App.tsx): crear el job, esperar a que resuelva, recién ahí descargar.
 */
export function usePdfExport() {
  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadPdf = useCallback(async (reportId: string) => {
    setExporting(true);
    setError(null);
    try {
      const { job_id: jobId } = await createPdfExportJob(reportId);
      const finalStatus = await pollExportJob(reportId, jobId);
      if (finalStatus.status !== 'success') {
        throw new Error(finalStatus.error_message || 'pdf_export_failed');
      }
      const { blob, filename, password: pw } = await fetchExportJobBlob(reportId, jobId);
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
