import React, { memo, useState, useMemo } from 'react';
import { Clock, RotateCcw, Eye, GitBranch, ChevronDown, ChevronUp, User, Calendar } from 'lucide-react';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';

/* ─────────────────────────────────────────────────────────────────────────────
   VERSION HISTORY — Snapshots con rollback y comparación visual
   ───────────────────────────────────────────────────────────────────────── */

export interface VersionSnapshot {
  id: string;
  timestamp: string;
  version: number;
  author: string;
  description: string;
  pageCount: number;
  elementCount: number;
  documentData: any;
  sizeBytes: number;
}

export function createSnapshot(doc: any, author: string, description = ''): VersionSnapshot {
  return {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    timestamp: new Date().toISOString(),
    version: doc.meta?.version || 1,
    author,
    description: description || `Versión ${doc.meta?.version || 1}`,
    pageCount: (doc.pages || []).length,
    elementCount: (doc.pages || []).reduce((sum: number, p: any) => sum + (p.elements?.length || 0), 0),
    documentData: JSON.parse(JSON.stringify(doc)),
    sizeBytes: JSON.stringify(doc).length,
  };
}

interface VersionHistoryProps {
  snapshots?: VersionSnapshot[];
  currentVersion?: number;
  onRestore?: (snap: VersionSnapshot) => void;
  onPreview?: (snap: VersionSnapshot) => void;
  onClose?: () => void;
}

function VersionHistory({ snapshots = [], currentVersion, onRestore, onPreview, onClose }: VersionHistoryProps) {
  const { t } = useI18n();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = useMemo(() => [...snapshots].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [snapshots]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="version-panel">
      <div className="version-header">
        <GitBranch size={16} />
        <span>Historial de Versiones</span>
        <span className="version-count">{sorted.length}</span>
        {onClose && <button type="button" className="wf-close" onClick={onClose}>✕</button>}
      </div>
      <div className="version-current">
        <span>Versión actual:</span>
        <strong>v{currentVersion || 1}</strong>
      </div>
      <div className="version-list">
        {sorted.length === 0 ? (
          <div className="version-empty"><Clock size={20} /><p>Sin snapshots guardados aún.</p></div>
        ) : sorted.map((snap) => (
          <div key={snap.id} className={`version-card ${expandedId === snap.id ? 'version-card--expanded' : ''}`}>
            <div className="version-card-header" onClick={() => setExpandedId(expandedId === snap.id ? null : snap.id)}>
              <div className="version-card-badge">v{snap.version}</div>
              <div className="version-card-info">
                <span className="version-card-desc">{snap.description}</span>
                <span className="version-card-meta">
                  <User size={10} /> {snap.author} · <Calendar size={10} /> {new Date(snap.timestamp).toLocaleString('es-PE')}
                </span>
              </div>
              {expandedId === snap.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {expandedId === snap.id && (
              <div className="version-card-body">
                <div className="version-stats">
                  <span>{snap.pageCount} páginas</span>
                  <span>{snap.elementCount} elementos</span>
                  <span>{formatSize(snap.sizeBytes)}</span>
                </div>
                <div className="version-actions">
                  <button type="button" className="alarm-btn alarm-btn--ack" onClick={() => onPreview?.(snap)}>
                    <Eye size={14} /> Vista previa
                  </button>
                  <button type="button" className="alarm-btn alarm-btn--report" onClick={async () => {
                    if (await requestConfirmation(t('confirm.restoreVersion', { version: snap.version }))) {
                      onRestore?.(snap);
                    }
                  }}>
                    <RotateCcw size={14} /> Restaurar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(VersionHistory);
