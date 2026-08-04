import { useCallback, useState } from 'react';
import { fetchReportPdfBlob } from './api';

/**
 * ADR-080: descarga el PDF protegido (marca de agua + contraseña generada
 * en el momento) y expone la contraseña recibida para que el llamador la
 * muestre una sola vez (ver PdfPasswordModal). Cada instancia del hook
 * maneja su propio estado — App.tsx (ribbon) y ReadOnlyViewer (vista previa)
 * usan cada uno la suya, sin compartir modal.
 */
export function usePdfExport() {
  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadPdf = useCallback(async (reportId: string) => {
    setExporting(true);
    setError(null);
    try {
      const { blob, filename, password: pw } = await fetchReportPdfBlob(reportId);
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
      setError('No se pudo generar el PDF protegido.');
      throw err;
    } finally {
      setExporting(false);
    }
  }, []);

  const clearPassword = useCallback(() => setPassword(null), []);

  return { downloadPdf, exporting, password, clearPassword, error };
}
