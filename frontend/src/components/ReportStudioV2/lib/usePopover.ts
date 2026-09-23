import { useEffect, useRef, useState } from 'react';

/**
 * Popover posicionado vía `getBoundingClientRect()` del elemento ancla +
 * `createPortal(..., document.body)` en el consumidor -- evita que un
 * dropdown quede recortado por el `overflow` de un contenedor con scroll
 * (el problema real que llevó a este patrón: las galerías de portada/diseño
 * de diapositiva en RibbonToolbar.tsx). Se cierra solo con un click fuera de
 * `rootRef`/`popoverRef`. Extraído de RibbonToolbar.tsx para reusarlo
 * también en PageCanvas.tsx (selector de transición de diapositiva).
 */
export function usePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!isOpen && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setIsOpen((prev) => !prev);
  };

  const close = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current && !rootRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return { isOpen, toggle, close, coords, rootRef, popoverRef };
}
