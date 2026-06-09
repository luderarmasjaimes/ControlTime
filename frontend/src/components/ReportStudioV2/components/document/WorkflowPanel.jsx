import React, { useState, useMemo } from 'react';
import {
  CheckCircle2, XCircle, Clock, Send, Shield, FileText,
  AlertTriangle, ChevronRight, User, Calendar, Hash, Eye,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   WORKFLOW APPROVAL ENGINE
   Flujo: Borrador → Revisión → Aprobación → Firmado
   Bitácora forense inmutable con hash encadenado.
   ───────────────────────────────────────────────────────────────────────── */

const WORKFLOW_STATES = {
  draft:    { label: 'Borrador',   color: '#94a3b8', icon: FileText },
  review:   { label: 'En Revisión', color: '#f59e0b', icon: Eye },
  approved: { label: 'Aprobado',   color: '#10b981', icon: CheckCircle2 },
  signed:   { label: 'Firmado',    color: '#6366f1', icon: Shield },
  rejected: { label: 'Rechazado',  color: '#ef4444', icon: XCircle },
};

const WORKFLOW_TRANSITIONS = {
  draft:    ['review'],
  review:   ['approved', 'rejected', 'draft'],
  approved: ['signed', 'review'],
  signed:   [],
  rejected: ['draft'],
};

function generateForensicHash(entry) {
  const payload = JSON.stringify({
    timestamp: entry.timestamp,
    action: entry.action,
    user: entry.user,
    previousHash: entry.previousHash,
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const chr = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
}

export function createWorkflowEntry(action, user, previousHash = '00000000', details = '') {
  const entry = {
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    user,
    details,
    previousHash,
    hash: '',
  };
  entry.hash = generateForensicHash(entry);
  return entry;
}

export function WorkflowStatusBadge({ status }) {
  const state = WORKFLOW_STATES[status] || WORKFLOW_STATES.draft;
  const Icon = state.icon;
  return (
    <div className="wf-badge" style={{ '--wf-color': state.color }}>
      <Icon size={12} />
      <span>{state.label}</span>
    </div>
  );
}

export default function WorkflowPanel({
  reportId, currentStatus = 'draft', auditLog = [],
  onTransition, onClose, currentUser = 'Usuario',
}) {
  const [comment, setComment] = useState('');
  const availableTransitions = WORKFLOW_TRANSITIONS[currentStatus] || [];
  const state = WORKFLOW_STATES[currentStatus] || WORKFLOW_STATES.draft;
  const StatusIcon = state.icon;

  const sortedLog = useMemo(() =>
    [...auditLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [auditLog]
  );

  const handleTransition = (nextStatus) => {
    if (!comment.trim() && (nextStatus === 'rejected')) {
      alert('Debe ingresar un comentario para rechazar el documento.');
      return;
    }
    onTransition?.(nextStatus, comment.trim());
    setComment('');
  };

  return (
    <div className="wf-panel">
      <div className="wf-panel-header">
        <div className="wf-panel-title">
          <Shield size={16} />
          <span>Workflow de Aprobación</span>
        </div>
        {onClose && (
          <button type="button" className="wf-close" onClick={onClose}>✕</button>
        )}
      </div>

      {/* Current status */}
      <div className="wf-current">
        <div className="wf-current-status" style={{ '--wf-color': state.color }}>
          <StatusIcon size={20} />
          <div>
            <div className="wf-current-label">Estado actual</div>
            <div className="wf-current-value">{state.label}</div>
          </div>
        </div>
        {reportId && (
          <div className="wf-report-id">
            <Hash size={12} /> {reportId}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="wf-progress">
        {Object.entries(WORKFLOW_STATES).filter(([k]) => k !== 'rejected').map(([key, st], idx) => {
          const keys = ['draft', 'review', 'approved', 'signed'];
          const currentIdx = keys.indexOf(currentStatus);
          const thisIdx = keys.indexOf(key);
          const isActive = thisIdx <= currentIdx;
          const StepIcon = st.icon;
          return (
            <React.Fragment key={key}>
              <div className={`wf-step ${isActive ? 'wf-step--active' : ''}`}
                style={isActive ? { '--wf-color': st.color } : {}}>
                <StepIcon size={14} />
                <span>{st.label}</span>
              </div>
              {idx < 3 && <ChevronRight size={12} className="wf-step-arrow" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Actions */}
      {availableTransitions.length > 0 && (
        <div className="wf-actions">
          <textarea
            className="wf-comment"
            placeholder="Comentario de transición (obligatorio para rechazar)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
          <div className="wf-action-buttons">
            {availableTransitions.map((next) => {
              const ns = WORKFLOW_STATES[next];
              const NIcon = ns.icon;
              return (
                <button
                  key={next}
                  type="button"
                  className="wf-action-btn"
                  style={{ '--wf-color': ns.color }}
                  onClick={() => handleTransition(next)}
                >
                  <NIcon size={14} />
                  <span>{next === 'draft' ? 'Devolver a Borrador' : ns.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Audit log */}
      <div className="wf-log">
        <div className="wf-log-title">
          <Clock size={14} />
          <span>Bitácora Forense ({sortedLog.length})</span>
        </div>
        {sortedLog.length === 0 ? (
          <div className="wf-log-empty">Sin registros de auditoría.</div>
        ) : (
          <div className="wf-log-list">
            {sortedLog.map((entry) => (
              <div key={entry.id} className="wf-log-entry">
                <div className="wf-log-entry-header">
                  <User size={11} />
                  <span className="wf-log-user">{entry.user}</span>
                  <span className="wf-log-action">{entry.action}</span>
                  <span className="wf-log-time">
                    {new Date(entry.timestamp).toLocaleString('es-PE')}
                  </span>
                </div>
                {entry.details && <div className="wf-log-details">{entry.details}</div>}
                <div className="wf-log-hash" title="Hash forense inmutable">
                  #{entry.hash} ← {entry.previousHash}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
