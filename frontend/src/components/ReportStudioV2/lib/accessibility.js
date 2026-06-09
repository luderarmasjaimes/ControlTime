/* ─────────────────────────────────────────────────────────────────────────────
   ACCESSIBILITY — WCAG 2.1 AA compliance utilities
   FX04: Keyboard navigation, ARIA labels, contraste
   ───────────────────────────────────────────────────────────────────────── */

/** Keyboard shortcut registry for the entire app */
const shortcuts = new Map();

/**
 * Registra un atajo de teclado global
 * @param {string} combo - Combinación (e.g. 'ctrl+s', 'ctrl+shift+e')
 * @param {Function} handler - Callback
 * @param {string} description - Descripción para ayuda
 */
export function registerShortcut(combo, handler, description = '') {
  shortcuts.set(combo.toLowerCase(), { handler, description });
}

export function unregisterShortcut(combo) {
  shortcuts.delete(combo.toLowerCase());
}

export function getRegisteredShortcuts() {
  return Array.from(shortcuts.entries()).map(([combo, { description }]) => ({ combo, description }));
}

/** Global keyboard listener */
function handleGlobalKeyDown(event) {
  const parts = [];
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

export function initAccessibility() {
  document.addEventListener('keydown', handleGlobalKeyDown);

  // Default shortcuts
  registerShortcut('ctrl+s', () => {
    document.querySelector('[data-action="save"]')?.click();
  }, 'Guardar informe');

  registerShortcut('ctrl+p', () => {
    window.print();
  }, 'Imprimir');

  registerShortcut('ctrl+z', () => {
    document.querySelector('[data-action="undo"]')?.click();
  }, 'Deshacer');

  registerShortcut('ctrl+shift+z', () => {
    document.querySelector('[data-action="redo"]')?.click();
  }, 'Rehacer');

  registerShortcut('f11', () => {
    document.querySelector('[data-action="fullscreen"]')?.click();
  }, 'Pantalla completa');

  registerShortcut('ctrl+shift+p', () => {
    document.querySelector('[data-action="perf-monitor"]')?.click();
  }, 'Monitor de rendimiento');

  registerShortcut('ctrl+shift+v', () => {
    document.querySelector('[data-action="voice-dictation"]')?.click();
  }, 'Dictado por voz');

  registerShortcut('escape', () => {
    document.querySelector('[data-action="close-panel"]')?.click();
  }, 'Cerrar panel activo');
}

export function destroyAccessibility() {
  document.removeEventListener('keydown', handleGlobalKeyDown);
  shortcuts.clear();
}

/** ARIA role helpers */
export function ariaLabel(element, label) {
  if (element) element.setAttribute('aria-label', label);
}

export function ariaLive(element, politeness = 'polite') {
  if (element) element.setAttribute('aria-live', politeness);
}

/** Announce to screen readers */
export function announce(message, politeness = 'polite') {
  const el = document.getElementById('aria-live-region');
  if (el) {
    el.setAttribute('aria-live', politeness);
    el.textContent = message;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }
}

/** Skip navigation link creator */
export function createSkipLink(targetId, text = 'Saltar al contenido') {
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

/** Contrast checker (WCAG AA requires 4.5:1 for normal text) */
export function checkContrast(fg, bg) {
  const getLuminance = (hex) => {
    const rgb = hex.replace('#', '').match(/.{2}/g).map(c => {
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
export function createFocusTrap(containerEl) {
  const focusable = containerEl.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const handler = (e) => {
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
