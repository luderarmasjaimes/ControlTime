import React, { useState } from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { deleteReportAsync } from '../../lib/reportsStorage';

const CONFIRM_WORD = 'ELIMINAR';

export default function DeleteReportConfirm({ report, onClose, onSuccess }) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const confirmed = typed === CONFIRM_WORD;

  const handleDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    try {
      const ok = await deleteReportAsync(report.id);
      if (ok) {
        onSuccess?.('Informe eliminado correctamente.');
        onClose();
      } else {
        throw new Error('Delete failed');
      }
    } catch {
      setError('No se pudo eliminar. Intenta nuevamente.');
      setDeleting(false);
    }
  };

  return (
    <div className="ra-overlay" onClick={onClose}>
      <div className="ra-sub-modal ra-delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ra-sub-header">
          <AlertTriangle size={18} style={{ color: '#ef4444' }} />
          <h3 style={{ color: '#ef4444' }}>Eliminar Informe — Acción Irreversible</h3>
          <button className="ra-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="ra-delete-warning">
          <p>Estás a punto de eliminar permanentemente el informe:</p>
          <p className="ra-delete-title">"{report.title}"</p>
          <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 8 }}>
            Esta acción no se puede deshacer. El informe quedará marcado como eliminado
            y no podrá recuperarse desde la interfaz.
          </p>
        </div>

        <div className="ra-field" style={{ marginTop: 16 }}>
          <label>
            Para confirmar, escribe <strong style={{ color: '#ef4444' }}>{CONFIRM_WORD}</strong> en el campo:
          </label>
          <input
            type="text"
            placeholder={`Escribe ${CONFIRM_WORD} para confirmar`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              borderColor: typed && !confirmed ? '#ef4444' : confirmed ? '#10b981' : undefined,
            }}
          />
        </div>

        {error && <p className="ra-error">{error}</p>}

        <div className="ra-sub-footer">
          <button className="ra-btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            className="ra-btn-danger"
            onClick={handleDelete}
            disabled={!confirmed || deleting}
            title={!confirmed ? `Debes escribir "${CONFIRM_WORD}" para habilitar este botón` : ''}
          >
            <Trash2 size={14} />
            {deleting ? 'Eliminando…' : 'Confirmar Eliminación'}
          </button>
        </div>
      </div>
    </div>
  );
}
