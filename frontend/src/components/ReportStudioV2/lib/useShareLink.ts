import { useCallback, useState } from 'react';
import { createReportShareLink } from './api';

/**
 * ADR-138: genera el enlace de acceso directo (sin contraseña) y expone su
 * URL para que el llamador la muestre (ver ShareLinkModal) — mismo patrón de
 * estado por-instancia que usePdfExport, sin compartir entre App.tsx y
 * ReadOnlyViewer.
 */
export function useShareLink() {
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresInHours: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateLink = useCallback(async (reportId: string) => {
    setGenerating(true);
    setError(null);
    try {
      const result = await createReportShareLink(reportId);
      setLink(result);
      return result;
    } catch (err) {
      setError('No se pudo generar el enlace de acceso directo.');
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  const clearLink = useCallback(() => setLink(null), []);

  return { generateLink, generating, link, clearLink, error };
}
