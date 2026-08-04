/* ─────────────────────────────────────────────────────────────────────────────
   tenantLogo — logotipo corporativo por tenant (encabezado + carátula)
   Fuente: GET /api/v1/tenants/{tenantId}/logo.svg (tenant_logo_routes.cpp).
   Cacheado en memoria + localStorage por tenant para que el encabezado siga
   mostrando el logo aun sin conexión (zonas de mala conectividad) una vez que
   se cargó al menos una vez en ese navegador.
   ───────────────────────────────────────────────────────────────────────── */

import { authHeaders as sharedAuthHeaders } from '../../../auth/authStorage';

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit.
  return sharedAuthHeaders();
}

const memoryCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function storageKey(tenantId: string): string {
  return `beemetry_tenant_logo_${tenantId}`;
}

/** Convierte el texto SVG a data URL (evita problemas de encoding con btoa + UTF-8). */
function toDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

/**
 * Devuelve el data URL del logo del tenant, o null si no hay logo configurado
 * ni copia cacheada disponible. Nunca lanza: cualquier error de red cae al
 * cache local si existe.
 */
export async function getTenantLogoDataUrl(tenantId: string | undefined | null): Promise<string | null> {
  if (!tenantId) return null;
  if (memoryCache.has(tenantId)) return memoryCache.get(tenantId)!;

  const existing = inflight.get(tenantId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/logo.svg`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
      const svgText = await res.text();
      const dataUrl = toDataUrl(svgText);
      memoryCache.set(tenantId, dataUrl);
      try {
        localStorage.setItem(storageKey(tenantId), dataUrl);
      } catch {
        // localStorage puede fallar (cuota, modo privado) — el cache en
        // memoria de esta sesión sigue funcionando igual.
      }
      return dataUrl;
    } catch {
      try {
        const cached = localStorage.getItem(storageKey(tenantId));
        if (cached) {
          memoryCache.set(tenantId, cached);
          return cached;
        }
      } catch {
        // ignorar
      }
      return null;
    } finally {
      inflight.delete(tenantId);
    }
  })();

  inflight.set(tenantId, promise);
  return promise;
}

/** Sube (o reemplaza) el logotipo del tenant — solo admin (verificado server-side). */
export async function uploadTenantLogo(tenantId: string, svgContent: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/logo`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'image/svg+xml', ...authHeaders() },
      body: svgContent,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    memoryCache.delete(tenantId);
    try {
      localStorage.removeItem(storageKey(tenantId));
    } catch {
      // ignorar
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
