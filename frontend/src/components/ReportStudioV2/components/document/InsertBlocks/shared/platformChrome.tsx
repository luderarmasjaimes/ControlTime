import { useEffect, useState } from 'react';
import { getTenantLogoDataUrl } from '../../../../lib/tenantLogo';

/** Tipografía "impactante" de plataforma para encabezado/pie de página fijos
 * (ADR-046 revisado) — Arial Black (o su fallback sans-serif bold) a 9px,
 * la misma en ambos bloques para que luzcan como una sola franja corporativa
 * consistente, no como texto de contenido editable. */
export const PLATFORM_CHROME_FONT = "'Arial Black', 'Arial Bold', Arial, sans-serif";
export const PLATFORM_CHROME_FONT_SIZE = 9;
/** Gris de encabezado/pie estilo Word (Word usa un gris ~#595959 para texto
 * de encabezado/pie por defecto, no negro puro) — pedido explícito del
 * usuario tras ver el primer color (#0f172a, casi negro) demasiado oscuro. */
export const PLATFORM_CHROME_COLOR = '#595959';

/** Logo corporativo del encabezado/carátula — carga async (fetch + cache, ver
 * lib/tenantLogo.ts) con placeholder discreto mientras no hay logo
 * configurado o falla la red y no hay copia cacheada (nunca bloquea el
 * render del resto del bloque). Compartido por HeaderBlock y CoverBlock. */
export function HeaderLogoImg({ tenantId }: { tenantId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!tenantId) {
      setSrc(null);
      return undefined;
    }
    getTenantLogoDataUrl(tenantId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!src) {
    return (
      <div style={{
        width: 90, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#cbd5e1', fontStyle: 'italic', textAlign: 'right',
      }}>
        {tenantId ? '' : 'Sin logo'}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Logotipo de la empresa"
      style={{ height: '100%', width: 'auto', maxWidth: 140, objectFit: 'contain', display: 'block' }}
    />
  );
}
