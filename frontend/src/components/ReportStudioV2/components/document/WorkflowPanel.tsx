import React, { memo, useState, useMemo } from 'react';
import {
  CheckCircle2, XCircle, Clock, Shield, FileText,
  ChevronRight, User, Hash, Eye,
} from 'lucide-react';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestNotice } from '../../../UI/ConfirmActionDialog';

/* ─────────────────────────────────────────────────────────────────────────────
   WORKFLOW APPROVAL ENGINE
   Flujo: Borrador → Revisión → Aprobación → Firmado
   Bitácora forense inmutable con hash encadenado.
   ───────────────────────────────────────────────────────────────────────── */

export type WorkflowStatus = 'draft' | 'in_review' | 'approved' | 'signed' | 'archived' | 'rejected';

interface WorkflowStateDef {
  label: string;
  color: string;
  icon: React.ElementType;
}

// Vocabulario y transiciones canónicos (ADR-017), idénticos a
// backend/src/reports/report_workflow.hpp — el servidor es la autoridad
// real; este mapa solo debe determinar qué botones mostrar, nunca asumir
// que una transición "se ve bien" sin que el backend la confirme.
const WORKFLOW_STATES: Record<WorkflowStatus, WorkflowStateDef> = {
  draft:     { label: 'Borrador',    color: '#94a3b8', icon: FileText },
  in_review: { label: 'En Revisión', color: '#f59e0b', icon: Eye },
  approved:  { label: 'Aprobado',    color: '#10b981', icon: CheckCircle2 },
  signed:    { label: 'Firmado',     color: '#6366f1', icon: Shield },
  archived:  { label: 'Archivado',   color: '#64748b', icon: Hash },
  rejected:  { label: 'Rechazado',   color: '#ef4444', icon: XCircle },
};

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft:     ['in_review'],
  in_review: ['approved', 'rejected'],
  approved:  ['signed', 'in_review'],
  signed:    ['archived'],
  archived:  [],
  rejected:  ['draft'],
};

// ADR-079: permiso requerido para transicionar SALIENDO de `currentStatus`,
// idéntico al que exige `updateReportPg` (backend/src/reports/report_service.cpp)
// bajo el mismo lock de fila — draft/rejected es iniciativa del autor,
// in_review/approved requiere autoridad de revisión/firma. Antes de este fix
// todos los botones se mostraban a cualquier usuario sin condición.
function requiredPermissionFor(currentStatus: WorkflowStatus): string {
  return currentStatus === 'draft' || currentStatus === 'rejected'
    ? 'informes.edit'
    : 'informes.sign';
}

export interface WorkflowEntry {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  details: string;
  previousHash: string;
  hash: string;
}

function generateForensicHash(entry: Omit<WorkflowEntry, 'hash'>): string {
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

export function createWorkflowEntry(action: string, user: string, previousHash = '00000000', details = ''): WorkflowEntry {
  const entry: WorkflowEntry = {
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

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  const state = WORKFLOW_STATES[status] || WORKFLOW_STATES.draft;
  const Icon = state.icon;
  return (
    <div className="wf-badge" style={{ '--wf-color': state.color } as React.CSSProperties}>
      <Icon size={12} />
      <span>{state.label}</span>
    </div>
  );
}

export interface WorkflowSignature {
  name?: string;
  role?: string;
  signedAt?: string;
}

interface WorkflowPanelProps {
  reportId?: string;
  currentStatus?: WorkflowStatus;
  signature?: WorkflowSignature | null;
  auditLog?: WorkflowEntry[];
  onTransition?: (nextStatus: WorkflowStatus, comment: string) => void;
  onClose?: () => void;
  currentUser?: string;
  /** ADR-079: `usePermissions().hasPermission` — filtra qué transiciones se
   * ofrecen según el permiso real del usuario. Sin esta prop (compat), no se
   * oculta ninguna transición — el servidor sigue siendo quien las rechaza. */
  hasPermission?: (code: string) => boolean;
}

function WorkflowPanel({
  reportId, currentStatus = 'draft', signature = null, auditLog = [],
  onTransition, onClose, hasPermission,
}: WorkflowPanelProps) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const allTransitions = WORKFLOW_TRANSITIONS[currentStatus] || [];
  const availableTransitions = hasPermission
    ? (hasPermission(requiredPermissionFor(currentStatus)) ? allTransitions : [])
    : allTransitions;
  const state = WORKFLOW_STATES[currentStatus] || WORKFLOW_STATES.draft;
  const StatusIcon = state.icon;

  const sortedLog = useMemo(() =>
    [...auditLog].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [auditLog]
  );

  const handleTransition = (nextStatus: WorkflowStatus) => {
    if (!comment.trim() && (nextStatus === 'rejected')) {
      void requestNotice(t('notice.rejectComment'));
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
        <div className="wf-current-status" style={{ '--wf-color': state.color } as React.CSSProperties}>
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

      {/* Firma documental (ADR-018): visible una vez que el informe llegó a
          'signed' (o fue archivado después), nunca antes — el servidor la
          calcula al momento exacto de la transición, no es editable. */}
      {signature?.name && (currentStatus === 'signed' || currentStatus === 'archived') && (
        <div className="wf-signature">
          <Shield size={14} />
          <div>
            <div className="wf-signature-label">Firma documental</div>
            <div className="wf-signature-value">
              {signature.name}
              {signature.role ? ` — ${signature.role}` : ''}
            </div>
            {signature.signedAt && (
              <div className="wf-signature-date">
                {new Date(signature.signedAt).toLocaleString('es-PE')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="wf-progress">
        {(Object.entries(WORKFLOW_STATES) as [WorkflowStatus, WorkflowStateDef][]).filter(([k]) => k !== 'rejected').map(([key, st], idx, arr) => {
          const keys: WorkflowStatus[] = ['draft', 'in_review', 'approved', 'signed', 'archived'];
          const currentIdx = keys.indexOf(currentStatus);
          const thisIdx = keys.indexOf(key);
          const isActive = thisIdx <= currentIdx;
          const StepIcon = st.icon;
          return (
            <React.Fragment key={key}>
              <div className={`wf-step ${isActive ? 'wf-step--active' : ''}`}
                style={isActive ? ({ '--wf-color': st.color } as React.CSSProperties) : {}}>
                <StepIcon size={14} />
                <span>{st.label}</span>
              </div>
              {idx < arr.length - 1 && <ChevronRight size={12} className="wf-step-arrow" />}
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
                  style={{ '--wf-color': ns.color } as React.CSSProperties}
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

export default memo(WorkflowPanel);
