import React from 'react';
import { useDragPreviewStore } from '../../store/useDragPreviewStore';

/**
 * Fantasma flotante que sigue al cursor mientras se arrastra un bloque --
 * ver el comentario largo en useDragPreviewStore.ts para el por qué. Un
 * único `<div position:fixed>` montado UNA vez (en MultipageView.tsx),
 * fuera de cualquier <Stage> de Konva, así que nunca queda recortado por
 * los límites de una página ni por el contenedor con scroll.
 */
export default function DragPreviewOverlay() {
  const preview = useDragPreviewStore();
  if (!preview.active) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: preview.left,
        top: preview.top,
        width: Math.max(1, preview.width),
        height: Math.max(1, preview.height),
        border: '1.5px dashed #2563eb',
        borderRadius: 4,
        background: 'rgba(37, 99, 235, 0.07)',
        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.22)',
        pointerEvents: 'none',
        zIndex: 10000,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      {preview.kind === 'text' && (
        <div
          style={{
            padding: 4,
            width: '100%',
            height: '100%',
            fontFamily: preview.fontFamily,
            fontSize: preview.fontSize,
            color: preview.fontColor,
            lineHeight: preview.lineHeight,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
          }}
        >
          {preview.text}
        </div>
      )}
      {preview.kind === 'image' && preview.src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      )}
      {preview.kind === 'generic' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            fontSize: 12,
            fontWeight: 600,
            color: '#2563eb',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {preview.label || 'Elemento'}
        </div>
      )}
    </div>
  );
}
