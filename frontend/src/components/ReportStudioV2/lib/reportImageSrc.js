/** Placeholder si falta `src` en la raíz del elemento (documentos antiguos o bloques vacíos). */
export const REPORT_IMAGE_PLACEHOLDER_SVG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect fill="#e2e8f0" width="400" height="240"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="14">Sin imagen — use Propiedades</text></svg>',
  );

/**
 * URL de imagen del bloque: prioriza `element.src` (modelo actual), luego `element.props.src` (legado).
 */
export function resolveReportImageSrc(element) {
  const root = String(element?.src ?? '').trim();
  if (root.length > 12) {
    return root;
  }
  const nested = String(element?.props?.src ?? '').trim();
  if (nested.length > 12) {
    return nested;
  }
  return REPORT_IMAGE_PLACEHOLDER_SVG;
}

export function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(file);
  });
}
