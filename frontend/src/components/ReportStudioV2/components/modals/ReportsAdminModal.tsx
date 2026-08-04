import React, { memo, useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, X, Search, RotateCcw, Eye, Pencil, Send, Trash2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, FileText, Loader2, Users,
} from 'lucide-react';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { usePermissions } from '../../../../auth/usePermissions';
import { getReportFilterUsers, listReportsAsync } from '../../lib/reportsStorage';
import { ensureCompanyUsers } from '../../lib/userBootstrap';
import UserMaintenanceModal from './UserMaintenanceModal';

import { log } from '../../../../lib/logger';

// Vocabulario canónico completo (ADR-017): antes faltaban 'signed'/'rejected'
// y el fallback a STATUS_LABELS.draft mostraba "Borrador" para informes
// realmente firmados o rechazados — engañoso justo para el caso de uso de
// auditoría/cumplimiento que la firma documental (ADR-018) debe sostener.
const STATUS_LABELS: Record<string, { label: string; color: string; text: string }> = {
  draft:     { label: 'Borrador',    color: '#dbeafe', text: '#1e40af' },
  in_review: { label: 'En Revisión', color: '#fef3c7', text: '#92400e' },
  approved:  { label: 'Aprobado',    color: '#d1fae5', text: '#065f46' },
  signed:    { label: 'Firmado',     color: '#e0e7ff', text: '#3730a3' },
  archived:  { label: 'Archivado',   color: '#f3f4f6', text: '#374151' },
  rejected:  { label: 'Rechazado',   color: '#fee2e2', text: '#991b1b' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] || STATUS_LABELS.draft;
  return (
    <span style={{
      background: cfg.color, color: cfg.text,
      padding: '2px 10px', borderRadius: 999,
      fontSize: '0.72rem', fontWeight: 700,
    }}>
      {cfg.label}
    </span>
  );
}

function SortIcon({ col, sortBy, sortDir }: { col: string; sortBy: string; sortDir: string }) {
  if (sortBy !== col) return <ChevronUp size={12} style={{ opacity: 0.25 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={12} style={{ color: '#6366f1' }} />
    : <ChevronDown size={12} style={{ color: '#6366f1' }} />;
}

const PAGE_SIZE = 15;
const TODAY = new Date().toISOString().slice(0, 10);
// Default: last 60 days so seed reports from the past month are visible
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

interface ReportsAdminModalProps {
  onClose: () => void;
  onOpenRead: (report: any) => void;
  onOpenEdit: (report: any) => void;
}

interface TenantOption { tenant_id: string; tenant_name: string; role: string; active: boolean }

function authHeadersRA(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit,
  // que el backend exige en toda peticion que mute estado.
  return sharedAuthHeaders();
}

function ReportsAdminModal({ onClose, onOpenRead, onOpenEdit }: ReportsAdminModalProps) {
  const session = getSession();
  const company = session?.company || '';
  const tenantId = session?.tenantId || '';
  // ADR-079: mismo permiso que exige el backend en report_service.cpp —
  // reemplaza el hardcode `session.role === 'admin'` que antes decidía esto
  // solo en el cliente, sin reflejar realmente lo que el servidor acepta.
  const { hasPermission } = usePermissions();

  const [filters, setFilters] = useState({
    dateFrom: SIXTY_DAYS_AGO, dateTo: TODAY, createdBy: 'all', reviewedBy: 'all',
    status: 'all', title: '', tenantId,
  });
  const [applied, setApplied] = useState(filters);
  const [createdByOptions, setCreatedByOptions] = useState([{ value: 'all', label: 'Todos' }]);
  const [reviewedByOptions, setReviewedByOptions] = useState([{ value: 'all', label: 'Todos' }]);
  // Unidades mineras a las que pertenece el usuario (multitenant) — si solo
  // tiene una (caso común), el selector se oculta (nada que elegir).
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [showUserMaintenance, setShowUserMaintenance] = useState(false);

  useEffect(() => {
    fetch('/api/auth/tenants', { headers: authHeadersRA() })
      .then((r) => (r.ok ? r.json() : { tenants: [] }))
      .then((data) => setTenantOptions(Array.isArray(data?.tenants) ? data.tenants : []))
      .catch((err) => log.error('ReportsAdminModal: no se pudo cargar unidades', err));
  }, []);

  const fetchReportsData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listReportsAsync({ ...applied, page, pageSize: PAGE_SIZE, sortBy, sortDir });
      setReports(result.data);
      setTotal(result.total);
    } catch (err) {
      log.error('Failed to fetch reports:', err);
    } finally {
      setLoading(false);
    }
  }, [applied, company, page, sortBy, sortDir]);

  // Bootstrap users on modal open
  useEffect(() => {
    if (company) {
      ensureCompanyUsers(company);
    }
  }, [company]);

  useEffect(() => {
    fetchReportsData();
  }, [fetchReportsData]);

  useEffect(() => {
    // Note: getReportFilterUsers might need to be async too if fetching from DB
    const users = getReportFilterUsers(company);
    setCreatedByOptions(users.createdByOptions);
    setReviewedByOptions(users.reviewedByOptions);
  }, [company, total]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [applied]);

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canEdit = (report: any) => {
    if (!session) return false;
    // Quien puede aprobar/firmar (informes.sign) puede editar cualquier
    // informe del tenant; el autor original solo puede editar su propio
    // borrador (informes.edit) — idéntico a la regla de report_service.cpp.
    if (hasPermission('informes.sign')) return true;
    return (
      hasPermission('informes.edit') &&
      report.createdBy === session.username &&
      report.status === 'draft'
    );
  };

  const canDelete = (report: any) => {
    if (!session) return false;
    // ADR-079: un informe firmado es inmutable — no se puede eliminar sin
    // excepción de rol, ni siquiera admin (el backend lo rechaza igual).
    if (report.status === 'signed') return false;
    return hasPermission('informes.sign');
  };

  return (
    <div className="ra-overlay" onClick={onClose}>
      <div className="ra-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Cabecera ── */}
        <div className="ra-header">
          <div className="ra-header-title">
            <FolderOpen size={20} className="ra-header-icon" />
            <div>
              <h2>Administración de Informes Técnicos</h2>
              <p>{tenantOptions.find((t) => t.tenant_id === applied.tenantId)?.tenant_name || company || 'Mi empresa'} — {total} informe{total !== 1 ? 's' : ''} en total</p>
            </div>
          </div>
          <div className="ra-header-actions">
            <button
              className="ra-btn-ghost"
              onClick={() => setShowUserMaintenance(true)}
              title="Abrir gestión de usuarios"
            >
              <Users size={14} /> Gestión de Usuarios
            </button>
            <button className="ra-close-btn" onClick={onClose} title="Cerrar"><X size={18} /></button>
          </div>
        </div>

        {/* ── Panel de filtros ── */}
        <div className="ra-filters">
          <div className="ra-filters-grid">
            {tenantOptions.length > 1 && (
              <div className="ra-field">
                <label>Unidad Minera</label>
                <select
                  value={filters.tenantId}
                  onChange={(e) => setFilters((f) => ({ ...f, tenantId: e.target.value }))}
                >
                  {tenantOptions.map((t) => (
                    <option key={t.tenant_id} value={t.tenant_id}>
                      {t.tenant_name} ({t.role}){t.active ? ' — actual' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="ra-field">
              <label>Fecha inicio</label>
              <input type="date" value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
            </div>
            <div className="ra-field">
              <label>Fecha fin</label>
              <input type="date" value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
            </div>
            <div className="ra-field">
              <label>Generado por</label>
              <select
                value={filters.createdBy}
                onChange={(e) => setFilters((f) => ({ ...f, createdBy: e.target.value }))}
              >
                {createdByOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="ra-field">
              <label>Revisado por</label>
              <select
                value={filters.reviewedBy}
                onChange={(e) => setFilters((f) => ({ ...f, reviewedBy: e.target.value }))}
              >
                {reviewedByOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="ra-field">
              <label>Estado</label>
              <select value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="all">Todos</option>
                <option value="draft">Borrador</option>
                <option value="in_review">En Revisión</option>
                <option value="approved">Aprobado</option>
                <option value="signed">Firmado</option>
                <option value="archived">Archivado</option>
                <option value="rejected">Rechazado</option>
              </select>
            </div>
            <div className="ra-field ra-field-wide">
              <label>Título contiene</label>
              <input type="text" placeholder="Buscar por título…" value={filters.title}
                onChange={(e) => setFilters((f) => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
          <div className="ra-filter-actions">
            <button className="ra-btn-ghost" onClick={() => {
              const empty = { dateFrom: SIXTY_DAYS_AGO, dateTo: TODAY, createdBy: 'all', reviewedBy: 'all', status: 'all', title: '', tenantId };
              setFilters(empty);
              setApplied(empty);
            }}>
              <RotateCcw size={14} /> Limpiar
            </button>
            <button className="ra-btn-primary" onClick={() => setApplied(filters)}>
              <Search size={14} /> Buscar
            </button>
          </div>
        </div>

        {/* ── Tabla ── */}
        <div className="ra-table-wrap">
          {loading ? (
            <div className="ra-loading">
              <Loader2 size={28} className="ra-spin" />
              <span>Buscando informes…</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="ra-empty">
              <FileText size={40} style={{ opacity: 0.25 }} />
              <p>No se encontraron informes con los filtros seleccionados.</p>
              <span>Prueba limpiar los filtros o crear un nuevo informe.</span>
            </div>
          ) : (
            <table className="ra-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th className="ra-sortable" onClick={() => handleSort('title')}>
                    Título <SortIcon col="title" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className="ra-sortable" onClick={() => handleSort('projectName')}>
                    Proyecto <SortIcon col="projectName" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className="ra-sortable" onClick={() => handleSort('createdByName')}>
                    Generado por <SortIcon col="createdByName" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th>Revisado por</th>
                  <th className="ra-sortable" onClick={() => handleSort('status')}>
                    Estado <SortIcon col="status" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className="ra-sortable" onClick={() => handleSort('createdAt')}>
                    Fecha <SortIcon col="createdAt" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th>Ver.</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    className={selected?.id === r.id ? 'ra-row-selected' : ''}
                    onClick={() => setSelected(r)}
                  >
                    <td>
                      <input type="radio" readOnly checked={selected?.id === r.id}
                        style={{ accentColor: '#6366f1', cursor: 'pointer' }} />
                    </td>
                    <td className="ra-cell-title" title={r.title}>{r.title}</td>
                    <td>{r.projectName || '—'}</td>
                    <td>{r.createdByName || r.createdBy || '—'}</td>
                    <td>{r.reviewedByName || r.reviewedBy || <span style={{ opacity: 0.4 }}>Sin revisar</span>}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-PE') : '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: '#6366f1', fontWeight: 700 }}>
                      v{r.versionNumber || 1}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Paginación ── */}
        {!loading && total > PAGE_SIZE && (
          <div className="ra-pagination">
            <span className="ra-page-info">Página {page} de {totalPages} ({total} resultados)</span>
            <div className="ra-page-btns">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                return p <= totalPages ? (
                  <button key={p} className={p === page ? 'ra-page-active' : ''} onClick={() => setPage(p)}>
                    {p}
                  </button>
                ) : null;
              })}
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* ── Barra de acciones ── */}
        <div className={`ra-actions-bar ${selected ? 'ra-actions-visible' : ''}`}>
          {selected ? (
            <>
              <span className="ra-selected-label">
                <FileText size={14} /> <strong>{selected.title}</strong>
              </span>
              <div className="ra-action-btns">
                <button className="ra-action-btn ra-read"
                  onClick={() => onOpenRead(selected)} title="Abrir para leer">
                  <Eye size={15} /> Leer
                </button>
                <button
                  className="ra-action-btn ra-edit"
                  onClick={() => { if (canEdit(selected)) onOpenEdit(selected); }}
                  disabled={!canEdit(selected)}
                  title={canEdit(selected) ? 'Abrir para editar' : 'Sin permisos de edición'}
                >
                  <Pencil size={15} /> Editar
                </button>
                <button className="ra-action-btn ra-send"
                  onClick={() => onOpenRead({ ...selected, _action: 'send' })} title="Enviar a otra persona">
                  <Send size={15} /> Enviar
                </button>
                <button
                  className="ra-action-btn ra-delete"
                  onClick={() => onOpenRead({ ...selected, _action: 'delete' })}
                  disabled={!canDelete(selected)}
                  title={canDelete(selected) ? 'Eliminar informe' : 'Sin permisos para eliminar'}
                >
                  <Trash2 size={15} /> Eliminar
                </button>
              </div>
            </>
          ) : (
            <span className="ra-no-selection">
              Selecciona un informe de la tabla para ver las acciones disponibles.
            </span>
          )}
        </div>

      </div>

      {showUserMaintenance && (
        <UserMaintenanceModal onClose={() => setShowUserMaintenance(false)} />
      )}
    </div>
  );
}

export default memo(ReportsAdminModal);
