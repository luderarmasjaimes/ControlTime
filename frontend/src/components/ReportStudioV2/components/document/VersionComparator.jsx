import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ArrowLeftRight, Eye, EyeOff, ChevronLeft, ChevronRight, Plus, Minus,
  FileText, AlertTriangle, CheckCircle2, Diff, LayoutGrid,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   VERSION COMPARATOR — Diff side-by-side con highlighting de cambios
   FX01: Comparador visual entre versiones informe
   ───────────────────────────────────────────────────────────────────────── */

function diffTexts(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diffs = [];
  for (let i = 0; i < maxLen; i++) {
    const ol = oldLines[i] ?? '';
    const nl = newLines[i] ?? '';
    if (ol === nl) {
      diffs.push({ type: 'equal', left: ol, right: nl, line: i + 1 });
    } else if (!ol && nl) {
      diffs.push({ type: 'added', left: '', right: nl, line: i + 1 });
    } else if (ol && !nl) {
      diffs.push({ type: 'removed', left: ol, right: '', line: i + 1 });
    } else {
      diffs.push({ type: 'changed', left: ol, right: nl, line: i + 1 });
    }
  }
  return diffs;
}

function diffElements(oldEls, newEls) {
  const changes = [];
  const oldMap = new Map((oldEls || []).map(e => [e.id, e]));
  const newMap = new Map((newEls || []).map(e => [e.id, e]));

  for (const [id, nel] of newMap) {
    if (!oldMap.has(id)) {
      changes.push({ type: 'added', id, element: nel, detail: `Elemento añadido: ${nel.type}` });
    } else {
      const oel = oldMap.get(id);
      const oldText = oel.props?.text || '';
      const newText = nel.props?.text || '';
      if (oldText !== newText) {
        changes.push({ type: 'modified', id, oldElement: oel, element: nel, detail: `Texto modificado en ${nel.type}` });
      }
      if (oel.x !== nel.x || oel.y !== nel.y || oel.width !== nel.width || oel.height !== nel.height) {
        changes.push({ type: 'moved', id, element: nel, detail: `Posición/tamaño cambió` });
      }
    }
  }
  for (const [id, oel] of oldMap) {
    if (!newMap.has(id)) {
      changes.push({ type: 'removed', id, element: oel, detail: `Elemento eliminado: ${oel.type}` });
    }
  }
  return changes;
}

function PageDiffView({ leftPage, rightPage, pageNum }) {
  const leftEls = leftPage?.elements || [];
  const rightEls = rightPage?.elements || [];
  const changes = useMemo(() => diffElements(leftEls, rightEls), [leftEls, rightEls]);

  const colorForType = (t) => {
    if (t === 'added') return '#10b981';
    if (t === 'removed') return '#ef4444';
    if (t === 'modified') return '#f59e0b';
    if (t === 'moved') return '#6366f1';
    return '#64748b';
  };

  return (
    <div className="vc-page-diff">
      <div className="vc-page-label">Página {pageNum}</div>
      <div className="vc-diff-columns">
        <div className="vc-diff-col vc-diff-col--left">
          <div className="vc-diff-col-title"><Eye size={12} /> Versión anterior</div>
          {leftEls.map(el => {
            const ch = changes.find(c => c.id === el.id);
            const borderColor = ch?.type === 'removed' ? '#ef4444' : ch?.type === 'modified' ? '#f59e0b' : 'rgba(100,116,139,.15)';
            return (
              <div key={el.id} className="vc-el-block" style={{ borderColor }}>
                <span className="vc-el-type">{el.type}</span>
                <span className="vc-el-text">{el.props?.text?.slice(0, 80) || `[${el.type}]`}</span>
                {ch?.type === 'removed' && <span className="vc-badge vc-badge--removed">Eliminado</span>}
                {ch?.type === 'modified' && <span className="vc-badge vc-badge--modified">Modificado</span>}
              </div>
            );
          })}
        </div>
        <div className="vc-diff-divider"><ArrowLeftRight size={14} /></div>
        <div className="vc-diff-col vc-diff-col--right">
          <div className="vc-diff-col-title"><Eye size={12} /> Versión actual</div>
          {rightEls.map(el => {
            const ch = changes.find(c => c.id === el.id);
            const borderColor = ch?.type === 'added' ? '#10b981' : ch?.type === 'modified' ? '#f59e0b' : ch?.type === 'moved' ? '#6366f1' : 'rgba(100,116,139,.15)';
            return (
              <div key={el.id} className="vc-el-block" style={{ borderColor }}>
                <span className="vc-el-type">{el.type}</span>
                <span className="vc-el-text">{el.props?.text?.slice(0, 80) || `[${el.type}]`}</span>
                {ch?.type === 'added' && <span className="vc-badge vc-badge--added">Nuevo</span>}
                {ch?.type === 'modified' && <span className="vc-badge vc-badge--modified">Modificado</span>}
                {ch?.type === 'moved' && <span className="vc-badge vc-badge--moved">Movido</span>}
              </div>
            );
          })}
        </div>
      </div>
      {changes.length > 0 && (
        <div className="vc-changes-summary">
          {changes.map((ch, i) => (
            <div key={i} className="vc-change-item" style={{ '--ch-color': colorForType(ch.type) }}>
              <span className="vc-change-dot" />
              <span>{ch.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VersionComparator({ snapshots = [], currentDoc, onClose }) {
  const [leftIdx, setLeftIdx] = useState(snapshots.length > 1 ? snapshots.length - 2 : 0);
  const [rightIdx, setRightIdx] = useState(snapshots.length - 1);
  const [viewMode, setViewMode] = useState('side-by-side'); // side-by-side | unified

  const leftDoc = snapshots[leftIdx]?.documentData || { pages: [] };
  const rightDoc = rightIdx === -1 ? currentDoc : (snapshots[rightIdx]?.documentData || { pages: [] });

  const leftLabel = snapshots[leftIdx]?.description || `v${snapshots[leftIdx]?.version}`;
  const rightLabel = rightIdx === -1 ? 'Documento actual' : (snapshots[rightIdx]?.description || `v${snapshots[rightIdx]?.version}`);

  const maxPages = Math.max(leftDoc.pages?.length || 0, rightDoc.pages?.length || 0);
  const totalChanges = useMemo(() => {
    let count = 0;
    for (let i = 0; i < maxPages; i++) {
      const lp = leftDoc.pages?.[i];
      const rp = rightDoc.pages?.[i];
      count += diffElements(lp?.elements, rp?.elements).length;
    }
    return count;
  }, [leftDoc, rightDoc, maxPages]);

  return (
    <div className="vc-panel">
      <div className="vc-header">
        <Diff size={16} />
        <span className="vc-header-title">Comparador de Versiones</span>
        <span className="vc-changes-badge">{totalChanges} cambios</span>
        {onClose && <button type="button" className="wf-close" onClick={onClose}>✕</button>}
      </div>

      <div className="vc-controls">
        <div className="vc-select-group">
          <label>Izquierda:
            <select value={leftIdx} onChange={(e) => setLeftIdx(Number(e.target.value))}>
              {snapshots.map((s, i) => (
                <option key={s.id} value={i}>v{s.version} — {s.description}</option>
              ))}
            </select>
          </label>
        </div>
        <ArrowLeftRight size={16} style={{ color: '#64748b' }} />
        <div className="vc-select-group">
          <label>Derecha:
            <select value={rightIdx} onChange={(e) => setRightIdx(Number(e.target.value))}>
              <option value={-1}>📄 Documento actual</option>
              {snapshots.map((s, i) => (
                <option key={s.id} value={i}>v{s.version} — {s.description}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="vc-body">
        {maxPages === 0 ? (
          <div className="vc-empty"><FileText size={20} /><p>Seleccione dos versiones para comparar.</p></div>
        ) : (
          Array.from({ length: maxPages }).map((_, i) => (
            <PageDiffView
              key={i}
              pageNum={i + 1}
              leftPage={leftDoc.pages?.[i]}
              rightPage={rightDoc.pages?.[i]}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { diffTexts, diffElements };
