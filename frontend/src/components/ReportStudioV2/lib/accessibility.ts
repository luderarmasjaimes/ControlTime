/* ─────────────────────────────────────────────────────────────────────────────
   ACCESSIBILITY — WCAG 2.1 AA compliance utilities
   FX04: Keyboard navigation, ARIA labels, contraste
   ───────────────────────────────────────────────────────────────────────── */

type ShortcutHandler = (event: KeyboardEvent) => void;

/** Keyboard shortcut registry for the entire app */
const shortcuts = new Map<string, { handler: ShortcutHandler; description: string }>();

/**
 * Registra un atajo de teclado global
 * @param combo - Combinación (e.g. 'ctrl+s', 'ctrl+shift+e')
 * @param handler - Callback
 * @param description - Descripción para ayuda
 */
export function registerShortcut(combo: string, handler: ShortcutHandler, description = ''): void {
  shortcuts.set(combo.toLowerCase(), { handler, description });
}

export function unregisterShortcut(combo: string): void {
  shortcuts.delete(combo.toLowerCase());
}

export function getRegisteredShortcuts(): { combo: string; description: string }[] {
  return Array.from(shortcuts.entries()).map(([combo, { description }]) => ({ combo, description }));
}

/** Global keyboard listener */
function handleGlobalKeyDown(event: KeyboardEvent): void {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  const key = event.key.toLowerCase();
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) parts.push(key);
  const combo = parts.join('+');

  const shortcut = shortcuts.get(combo);
  if (shortcut) {
    event.preventDefault();
    event.stopPropagation();
    shortcut.handler(event);
  }
}

export function initAccessibility(): void {
  document.addEventListener('keydown', handleGlobalKeyDown);

  // Default shortcuts
  registerShortcut('ctrl+s', () => {
    (document.querySelector('[data-action="save"]') as HTMLElement | null)?.click();
  }, 'Guardar informe');

  registerShortcut('ctrl+p', () => {
    window.print();
  }, 'Imprimir');

  registerShortcut('ctrl+z', () => {
    (document.querySelector('[data-action="undo"]') as HTMLElement | null)?.click();
  }, 'Deshacer');

  registerShortcut('ctrl+shift+z', () => {
    (document.querySelector('[data-action="redo"]') as HTMLElement | null)?.click();
  }, 'Rehacer');

  registerShortcut('f11', () => {
    (document.querySelector('[data-action="fullscreen"]') as HTMLElement | null)?.click();
  }, 'Pantalla completa');

  registerShortcut('ctrl+shift+p', () => {
    (document.querySelector('[data-action="perf-monitor"]') as HTMLElement | null)?.click();
  }, 'Monitor de rendimiento');

  registerShortcut('ctrl+shift+v', () => {
    (document.querySelector('[data-action="voice-dictation"]') as HTMLElement | null)?.click();
  }, 'Dictado por voz');

  registerShortcut('escape', () => {
    (document.querySelector('[data-action="close-panel"]') as HTMLElement | null)?.click();
  }, 'Cerrar panel activo');
}

export function destroyAccessibility(): void {
  document.removeEventListener('keydown', handleGlobalKeyDown);
  shortcuts.clear();
}

/** ARIA role helpers */
export function ariaLabel(element: Element | null | undefined, label: string): void {
  if (element) element.setAttribute('aria-label', label);
}

export function ariaLive(element: Element | null | undefined, politeness = 'polite'): void {
  if (element) element.setAttribute('aria-live', politeness);
}

/** Announce to screen readers */
export function announce(message: string, politeness = 'polite'): void {
  const el = document.getElementById('aria-live-region');
  if (el) {
    el.setAttribute('aria-live', politeness);
    el.textContent = message;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }
}

/** Skip navigation link creator */
export function createSkipLink(targetId: string, text = 'Saltar al contenido'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `#${targetId}`;
  link.className = 'skip-link';
  link.textContent = text;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) { target.focus(); target.scrollIntoView(); }
  });
  return link;
}

export interface ContrastResult {
  ratio: string;
  passAA: boolean;
  passAAA: boolean;
  passLargeAA: boolean;
}

/** Contrast checker (WCAG AA requires 4.5:1 for normal text) */
export function checkContrast(fg: string, bg: string): ContrastResult {
  const getLuminance = (hex: string): number => {
    const rgb = hex.replace('#', '').match(/.{2}/g)!.map(c => {
      const val = parseInt(c, 16) / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return {
    ratio: ratio.toFixed(2),
    passAA: ratio >= 4.5,
    passAAA: ratio >= 7,
    passLargeAA: ratio >= 3,
  };
}

/** Focus trap for modals */
export function createFocusTrap(containerEl: HTMLElement): () => void {
  const focusable = containerEl.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  containerEl.addEventListener('keydown', handler);
  first?.focus();

  return () => containerEl.removeEventListener('keydown', handler);
}
