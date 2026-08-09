/* ─────────────────────────────────────────────────────────────────────────────
   tenantGallery — galería de imágenes JPEG por tenant (fotos de la unidad
   minera), insertables "bajo demanda" en la carátula o cualquier página del
   informe. Fuente: tenant_gallery_image (ADR-047, tenant_assets_routes.cpp).

   Diseño pensado para zonas de mala conectividad: listar la galería trae
   SOLO miniaturas pequeñas (una sola respuesta JSON, ver GET .../gallery);
   el archivo JPEG completo se descarga recién cuando el usuario efectivamente
   selecciona una imagen para insertarla en el lienzo (GET .../gallery/{id}).
   ───────────────────────────────────────────────────────────────────────── */

import { authHeaders as sharedAuthHeaders } from '../../../auth/authStorage';

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit.
  return sharedAuthHeaders();
}

export interface TenantGalleryImage {
  image_id: string;
  filename: string;
  width_px: number;
  height_px: number;
  thumbnail_data_url: string;
}

export async function fetchTenantGallery(tenantId: string | undefined | null): Promise<TenantGalleryImage[]> {
  if (!tenantId) return [];
  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/gallery`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.images) ? data.images : [];
  } catch {
    return [];
  }
}

/** Descarga el JPEG completo de una imagen de galería y lo devuelve como data URL — "bajo demanda", solo al insertar. */
export async function fetchTenantGalleryImageDataUrl(tenantId: string, imageId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/gallery/${encodeURIComponent(imageId)}`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
