import React, { useState } from 'react';
import { Send, X, User, Search } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { shareReportAsync } from '../../lib/reportsStorage';

/**
 * Sub-modal para enviar un informe a otro usuario de la empresa.
 * Usa la lista de usuarios guardados en localStorage (creados con el sistema de auth).
 */
export default function ShareReportModal({ report, onClose, onSuccess }) {
  const session = getSession();
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Obtener usuarios de la empresa desde localStorage (auth users)
  const allUsers = (() => {
    try {
      const raw = localStorage.getItem('mining_auth_users_v1');
      if (!raw) return [];
      const users = JSON.parse(raw);
      return users.filter(
        (u) => u.is_active !== false &&
          u.company === session?.company &&
          u.username !== session?.username
      );
    } catch {
      return [];
    }
  })();

  const filtered = search
    ? allUsers.filter(
        (u) =>
          (u.first_name + ' ' + u.last_name).toLowerCase().includes(search.toLowerCase()) ||
          u.username.toLowerCase().includes(search.toLowerCase())
      )
    : allUsers;

  const handleSend = async () => {
    if (!selectedUser) { setError('Selecciona un destinatario.'); return; }
    setSending(true);
    setError('');
    try {
      await shareReportAsync(report.id, {
        toUsername: selectedUser.username,
        toFullName: `${selectedUser.first_name} ${selectedUser.last_name}`.trim(),
        message,
        fromUsername: session?.username || '',
      });
      onSuccess?.(`Informe enviado a ${selectedUser.first_name} ${selectedUser.last_name}`);
      onClose();
    } catch (e) {
      setError('No se pudo enviar el informe. Intenta nuevamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ra-overlay" onClick={onClose}>
      <div className="ra-sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ra-sub-header">
          <Send size={18} style={{ color: '#10b981' }} />
          <h3>Enviar Informe</h3>
          <button className="ra-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <p className="ra-sub-desc">
          Enviando: <strong>{report.title}</strong>
        </p>

        {/* Buscador de usuarios */}
        <div className="ra-field" style={{ marginBottom: 10 }}>
          <label>Buscar destinatario</label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Nombre o usuario…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 30 }}
            />
          </div>
        </div>

        {/* Lista de usuarios */}
        <div className="ra-user-list">
          {filtered.length === 0 ? (
            <div className="ra-empty-sm">
              <User size={24} style={{ opacity: 0.25 }} />
              <span>No se encontraron usuarios de la empresa.</span>
            </div>
          ) : filtered.map((u) => (
            <div
              key={u.username}
              className={`ra-user-item ${selectedUser?.username === u.username ? 'ra-user-selected' : ''}`}
              onClick={() => setSelectedUser(u)}
            >
              <div className="ra-user-avatar">{(u.first_name || u.username)[0].toUpperCase()}</div>
              <div>
                <div className="ra-user-name">{u.first_name} {u.last_name}</div>
                <div className="ra-user-meta">{u.username} · {u.role || 'operator'}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Mensaje opcional */}
        <div className="ra-field" style={{ marginTop: 14 }}>
          <label>Mensaje opcional (máx. 500 caracteres)</label>
          <textarea
            placeholder="Escribe un comentario o indicación para el destinatario…"
            value={message}
            maxLength={500}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', minHeight: 72 }}
          />
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{message.length}/500</span>
        </div>

        {error && <p className="ra-error">{error}</p>}

        <div className="ra-sub-footer">
          <button className="ra-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="ra-btn-success" onClick={handleSend} disabled={sending || !selectedUser}>
            <Send size={14} /> {sending ? 'Enviando…' : 'Enviar Informe'}
          </button>
        </div>
      </div>
    </div>
  );
}
