import React from 'react';
import { 
  Trash2, 
  Lock, 
  Unlock, 
  Settings, 
  RefreshCw, 
  Pencil, 
  Camera, 
  Maximize2 
} from 'lucide-react';

export default function FloatingContextualToolbar({ 
  element, 
  onUpdate, 
  onRemove, 
  onOpenInspector,
  onAction 
}) {
  if (!element) return null;

  const handleToggleLock = (e) => {
    e.stopPropagation();
    onUpdate({ locked: !element.locked });
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    onRemove();
  };

  return (
    <div className="floating-contextual-toolbar">
      <div className="floating-toolbar-group">
        <button 
          className="floating-tool-btn" 
          onClick={onOpenInspector}
          title="Ver todas las propiedades"
        >
          <Settings size={14} />
        </button>
        <button 
          className={`floating-tool-btn ${element.locked ? 'active' : ''}`} 
          onClick={handleToggleLock}
          title={element.locked ? 'Desbloquear elemento' : 'Bloquear elemento'}
        >
          {element.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
      </div>

      <div className="floating-toolbar-divider" />

      <div className="floating-toolbar-group">
        {element.type === 'text' && (
          <button 
            className="floating-tool-btn" 
            onClick={() => onAction('edit')}
            title="Editar texto"
          >
            <Pencil size={14} />
          </button>
        )}
        
        {element.type === 'image' && (
          <button 
            className="floating-tool-btn" 
            onClick={() => onAction('replace')}
            title="Cambiar imagen"
          >
            <Camera size={14} />
          </button>
        )}

        {(element.type === 'sensor' || element.type === 'kpi') && (
          <button 
            className="floating-tool-btn" 
            onClick={() => onAction('refresh')}
            title="Sincronizar datos"
          >
            <RefreshCw size={14} />
          </button>
        )}

        {element.type === 'table' && (
          <button 
            className="floating-tool-btn" 
            onClick={() => onAction('expand')}
            title="Expandir tabla"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      <div className="floating-toolbar-divider" />

      <div className="floating-toolbar-group">
        <button 
          className="floating-tool-btn floating-tool-btn--danger" 
          onClick={handleRemove}
          title="Eliminar elemento"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
