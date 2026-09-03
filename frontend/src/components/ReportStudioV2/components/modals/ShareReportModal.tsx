import React, { memo, useState, useEffect } from 'react';
import { Send, X, User, Search, Mail, MessageCircle, Smartphone, Bell, Check, AlertCircle } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { shareReportAsync } from '../../lib/reportsStorage';
import { fetchCompanyUsers, type CompanyUser, type ShareReportChannelResult } from '../../lib/api';

interface ShareReportModalProps {
  report: { id: string; title?: string };
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

const CHANNEL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  in_app: { label: 'Notificación interna', icon: <Bell size={13} /> },
  email: { label: 'Correo electrónico', icon: <Mail size={13} /> },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle size={13} /> },
  sms: { label: 'SMS', icon: <Smartphone size={13} /> },
};

/**
 * Sub-modal para enviar un informe a otro usuario de la empresa.
 * Antes leía una lista mock de localStorage (solo iniciales como "avatar",
 * sin garantía de reflejar los usuarios reales) y el envío era un mock que no
 * tocaba el backend. Ahora usa GET /api/auth/users (avatar real incluido) y
 * POST /api/reports/{id}/share (persiste + notifica in-app/email/WhatsApp/SMS).
 */
function ShareReportModal({ report, onClose, onSuccess }: ShareReportModalProps) {
  const session = getSession();
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<CompanyUser | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [allUsers, setAllUsers] = useState<CompanyUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [channelResults, setChannelResults] = useState<ShareReportChannelResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCompanyUsers().then((users) => {
      if (cancelled) return;
      setAllUsers(users.filter((u) => u.username !== session?.username));
      setLoadingUsers(false);
    });
    return () => { cancelled = true; };
  }, [session?.username]);

  const filtered = search
    ? allUsers.filter(
        (u) =>
          `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
          u.username.toLowerCase().includes(search.toLowerCase())
      )
    : allUsers;

  const handleSend = async () => {
    if (!selectedUser) { setError('Selecciona un destinatario.'); return; }
    setSending(true);
    setError('');
    setChannelResults(null);
    const outcome = await shareReportAsync(report.id, { toUserId: selectedUser.id, message });
    setSending(false);
    if (!outcome.ok) {
      setError('No se pudo enviar el informe. Intenta nuevamente.');
      return;
    }
    setChannelResults(outcome.channels);
    const sentChannels = outcome.channels.filter((c) => c.ok).map((c) => CHANNEL_LABELS[c.channel]?.label || c.channel);
    const summary = sentChannels.length > 0 ? ` (${sentChannels.join(', ')})` : '';
    onSuccess?.(`Informe enviado a ${outcome.recipientName || `${selectedUser.firstName} ${selectedUser.lastName}`}${summary}`);
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
          {loadingUsers ? (
            <div className="ra-empty-sm">
              <span>Cargando usuarios…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="ra-empty-sm">
              <User size={24} style={{ opacity: 0.25 }} />
              <span>No se encontraron usuarios de la empresa.</span>
            </div>
          ) : filtered.map((u) => (
            <div
              key={u.id}
              className={`ra-user-item ${selectedUser?.id === u.id ? 'ra-user-selected' : ''}`}
              onClick={() => setSelectedUser(u)}
            >
              {u.avatarBase64 ? (
                <img
                  className="ra-user-avatar"
                  src={`data:image/png;base64,${u.avatarBase64}`}
                  alt=""
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className="ra-user-avatar">{(u.firstName || u.username)[0]?.toUpperCase() || '?'}</div>
              )}
              <div>
                <div className="ra-user-name">{u.firstName} {u.lastName}</div>
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

        {/* Resultado por canal de la última notificación disparada */}
        {channelResults && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {channelResults.map((c) => (
              <div key={c.channel} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: c.ok ? '#065f46' : '#94a3b8' }}>
                {CHANNEL_LABELS[c.channel]?.icon}
                <span>{CHANNEL_LABELS[c.channel]?.label || c.channel}</span>
                {c.ok ? <Check size={13} color="#10b981" /> : <AlertCircle size={13} />}
                {!c.ok && <span style={{ opacity: 0.7 }}>({c.detail || 'no disponible'})</span>}
              </div>
            ))}
          </div>
        )}

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

export default memo(ShareReportModal);
