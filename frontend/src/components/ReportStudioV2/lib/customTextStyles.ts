import type { HeadingStyleDef } from './headingStyles';

/**
 * Estilos de texto personalizados -- "Crear nuevo estilo a partir del
 * formato" de Word, aplicado al ribbon (Inicio → Estilos). Misma forma que
 * HeadingStyleDef (así se pueden aplicar con el mismo mecanismo que Título/
 * H1-H6, ver App.tsx::onApplyHeadingStyle) salvo que `tag` queda fijo en
 * 'p' -- un estilo personalizado NUNCA debe contar como encabezado real
 * para la Tabla de Contenidos (ver TableOfContents.tsx::headingLevelFor,
 * que ya ignora cualquier id que no sea title/h1-h6 -- 'p' es solo
 * documentación de esa intención, no hace falta para la lógica en sí).
 * Persistidos en localStorage (no hay backend de preferencias de usuario en
 * este proyecto todavía -- mismo criterio que los "colores recientes" de
 * ColorPalette.tsx) para que estén disponibles la próxima vez que el
 * usuario abra el editor, sin importar qué informe esté editando.
 */
export interface CustomTextStyle extends HeadingStyleDef {
  tag: 'p';
}

const STORAGE_KEY = 'reportstudio-v2-custom-text-styles';
const MAX_CUSTOM_STYLES = 24;

export function loadCustomTextStyles(): CustomTextStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is CustomTextStyle => !!s && typeof s.id === 'string') : [];
  } catch {
    return [];
  }
}

function persist(styles: CustomTextStyle[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
  } catch {
    // localStorage no disponible (privado/cuota) -- no crítico, se omite.
  }
}

/** Agrega un estilo nuevo al final de la lista y persiste. `label` ya viene
 * recortado/con fallback resuelto por el modal que lo pide. */
export function saveCustomTextStyle(label: string, format: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'>): CustomTextStyle[] {
  const style: CustomTextStyle = {
    id: `custom-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    label,
    tag: 'p',
    ...format,
  };
  const next = [...loadCustomTextStyles(), style].slice(-MAX_CUSTOM_STYLES);
  persist(next);
  return next;
}

export function deleteCustomTextStyle(id: string): CustomTextStyle[] {
  const next = loadCustomTextStyles().filter((s) => s.id !== id);
  persist(next);
  return next;
}
