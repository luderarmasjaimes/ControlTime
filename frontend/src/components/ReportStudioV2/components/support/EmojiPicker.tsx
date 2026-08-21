import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Selector de emojis del widget de chat de soporte (frontend-only, sin
 * dependencias nuevas -- confirmado que no hay ninguna librería de emoji
 * picker en package.json). Popover posicionado absoluto que se cierra al
 * hacer click afuera o con el botón X; NO se cierra al elegir un emoji para
 * poder insertar varios seguidos.
 */

const COMMON_EMOJIS = ['😀', '🙂', '😂', '😊', '👍', '👎', '❤️', '🙏', '👀', '🤔', '✅', '❌', '🎉', '👏', '🔥', '💡', '⏰', '📌'];
const MINING_EMOJIS = ['⛏️', '🚧', '⚠️', '🦺', '🏗️', '🔩', '🪨', '⛑️', '🚛', '📡', '🛠️', '🔦', '🧯', '🏔️', '🚨', '⚡', '🔧', '📋'];

type TabKey = 'comunes' | 'mineria';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [tab, setTab] = useState<TabKey>('comunes');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 'mousedown' -- se registra un tick después de montar para no cerrar el
    // picker inmediatamente por el mismo click que lo abrió (ese click ya
    // terminó su fase 'mousedown' antes de que este listener exista).
    const id = window.setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const emojis = tab === 'comunes' ? COMMON_EMOJIS : MINING_EMOJIS;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 6,
        width: 240,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 10,
        boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
        zIndex: 10000,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #334155', padding: '4px 6px' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setTab('comunes')}
            style={{
              background: tab === 'comunes' ? '#1e293b' : 'transparent',
              border: 'none',
              borderRadius: 6,
              color: tab === 'comunes' ? '#e2e8f0' : '#64748b',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            Comunes
          </button>
          <button
            type="button"
            onClick={() => setTab('mineria')}
            style={{
              background: tab === 'mineria' ? '#1e293b' : 'transparent',
              border: 'none',
              borderRadius: 6,
              color: tab === 'mineria' ? '#e2e8f0' : '#64748b',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            Minería
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar"
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <X size={13} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, padding: 6, maxHeight: 160, overflowY: 'auto' }}>
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            title={emoji}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              lineHeight: '28px',
              width: 32,
              height: 32,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#1e293b'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
