import React, { useCallback, useEffect, useState } from 'react';
import {
  UserSearch, Search, RotateCcw, AlertTriangle, ChevronLeft, ChevronRight,
  Loader2, X, Download, FileWarning,
} from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { usePermissions } from '../../../../auth/usePermissions';
import {
  searchCvCandidates,
  getCvCandidateDetail,
  cvCandidateFileUrl,
  type CvCandidateSummary,
  type CvCandidateDetail,
  type CvCandidateFilters,
  type SupportAdminSearchResult,
} from '../../lib/api';

/* ─────────────────────────────────────────────────────────────────────────
   PANEL DE CANDIDATOS RRHH (ADR-122) -- postulaciones de CV recibidas por el
   bot de WhatsApp (categoría rrhh), con los campos extraídos y el score de
   triaje generados por IA local (Ollama). Mismo lenguaje visual y patrón de
   paginación server-side que SupportAdminView.tsx.

   RBAC (aplicada por el backend, esto solo refleja el contrato en la UI):
     GET /api/support/admin/candidates(/{id}(/file)?)?: soporte.view,
     soporte.manage, o department === 'rrhh' -- sin variante "global sin
     filtro", un candidato de CV es siempre del dominio rrhh.

   El score es una señal de APOYO para priorizar revisión humana, nunca una
   decisión automática -- ver ADR-122. La copy de este panel lo dice
   explícitamente en el detalle de cada candidato.
   ───────────────────────────────────────────────────────────────────────── */

const STATUS_OPTIONS = [
  { value: 'received', label: 'Recibido' },
  { value: 'extracted', label: 'Texto extraído' },
  { value: 'extraction_failed', label: 'Extracción falló' },
  { value: 'scored', label: 'Puntuado' },
  { value: 'notified', label: 'Notificado' },
  { value: 'notify_failed', label: 'Notificación falló' },
];

const PAGE_SIZE = 20;
const TODAY = new Date().toISOString().slice(0, 10);
const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

const emptyFilters = (): CvCandidateFilters => ({
  q: '',
  status: 'all',
  scoreMin: undefined,
  scoreMax: undefined,
  dateFrom: NINETY_DAYS_AGO,
  dateTo: TODAY,
});

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function scoreBadgeCls(score: number | null): string {
  if (score === null || score === undefined) return 'bg-slate-800 text-slate-400';
  if (score >= 70) return 'bg-emerald-500/15 text-emerald-400';
  if (score >= 40) return 'bg-amber-500/15 text-amber-400';
  return 'bg-rose-500/15 text-rose-400';
}

const inputCls = 'form-input-base';
const labelCls = 'form-label';

export default function CandidatesRrhhView() {
  const session = getSession();
  const company = session?.company || '';
  const { loading: permsLoading } = usePermissions();

  const [filters, setFilters] = useState<CvCandidateFilters>(emptyFilters);
  const [applied, setApplied] = useState<CvCandidateFilters>(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SupportAdminSearchResult<CvCandidateSummary> | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CvCandidateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await searchCvCandidates(applied, page, PAGE_SIZE);
    setResult(r);
    setLoading(false);
  }, [applied, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [applied]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    getCvCandidateDetail(selectedId).then((d) => {
      if (!cancelled) { setDetail(d); setDetailLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  if (permsLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
        Cargando permisos...
      </div>
    );
  }

  const totalPages = result?.pages || 1;

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-2 lg:p-3 overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <UserSearch className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Candidatos RRHH</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {company || 'EMPRESA NO IDENTIFICADA'} · Postulaciones de CV por WhatsApp
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        {/* Filtros */}
        <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 backdrop-blur-xl shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <div>
              <label className={labelCls}>Fecha inicio</label>
              <input type="date" className={inputCls} value={filters.dateFrom || ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Fecha fin</label>
              <input type="date" className={inputCls} value={filters.dateTo || ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Estado</label>
              <select className={inputCls} value={filters.status || 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="all">Todos</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Score mín.</label>
              <input type="number" min={0} max={100} className={inputCls} value={filters.scoreMin ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, scoreMin: e.target.value === '' ? undefined : Number(e.target.value) }))} />
            </div>
            <div>
              <label className={labelCls}>Score máx.</label>
              <input type="number" min={0} max={100} className={inputCls} value={filters.scoreMax ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, scoreMax: e.target.value === '' ? undefined : Number(e.target.value) }))} />
            </div>
            <div className="col-span-2 md:col-span-2 lg:col-span-2">
              <label className={labelCls}>Nombre, apellido, cargo o teléfono</label>
              <input type="text" className={inputCls} placeholder="Buscar…" value={filters.q || ''}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
            </div>
            <div className="flex items-end gap-2 col-span-2 lg:col-span-1">
              <button type="button"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                onClick={() => { const empty = emptyFilters(); setFilters(empty); setApplied(empty); }}>
                <RotateCcw size={12} />
              </button>
              <button type="button"
                className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
                onClick={() => setApplied(filters)}>
                <Search size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl backdrop-blur-xl overflow-hidden flex flex-col">
          {result?.error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
              <AlertTriangle className="text-amber-400" size={28} />
              <p className="text-xs font-bold text-center max-w-md">
                {result.status === 403
                  ? 'No tienes permiso para ver candidatos de RRHH (se requiere soporte.view, soporte.manage o el departamento RRHH).'
                  : 'No se pudo cargar la lista de candidatos.'}
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-xl">
                  <tr className="text-slate-400 uppercase tracking-widest text-[9px] font-black">
                    <th className="px-3 py-2">Candidato</th>
                    <th className="px-3 py-2">Cargo</th>
                    <th className="px-3 py-2">Residencia</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Recibido</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      <Loader2 className="inline animate-spin mr-2" size={14} /> Buscando…
                    </td></tr>
                  ) : (result?.items.length || 0) === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Sin postulaciones.</td></tr>
                  ) : (
                    result!.items.map((c) => (
                      <tr key={c.submission_id}
                        className="border-t border-white/5 text-slate-300 hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => setSelectedId(c.submission_id)}>
                        <td className="px-3 py-2 font-bold text-slate-200">
                          {[c.nombres, c.apellidos].filter(Boolean).join(' ') || c.original_filename || '—'}
                        </td>
                        <td className="px-3 py-2 max-w-[200px] truncate" title={c.cargo_postulado}>{c.cargo_postulado || '—'}</td>
                        <td className="px-3 py-2">{c.lugar_residencia || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{c.phone_e164}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full font-black text-[10px] ${scoreBadgeCls(c.score)}`}>
                            {c.score === null || c.score === undefined ? '—' : `${c.score}/100`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{c.status}</td>
                        <td className="px-3 py-2 text-slate-500">{formatDate(c.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* Paginación */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 shrink-0 text-[10px] text-slate-400">
            <span>{result?.total ?? 0} resultado{(result?.total ?? 0) !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                <ChevronLeft size={13} />
              </button>
              <span>Página {page} de {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Panel de detalle */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedId(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-slate-900/95 backdrop-blur-xl">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">Detalle de la postulación</h2>
              <button type="button" onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-200">
                <X size={18} />
              </button>
            </div>
            {detailLoading || !detail ? (
              <div className="p-8 text-center text-slate-500">
                <Loader2 className="inline animate-spin mr-2" size={14} /> Cargando…
              </div>
            ) : (
              <div className="p-5 space-y-4 text-[12px] text-slate-300">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-lg font-black text-slate-100">
                      {[detail.nombres, detail.apellidos].filter(Boolean).join(' ') || 'Nombre no extraído'}
                    </p>
                    <p className="text-slate-400">{detail.cargo_postulado || 'Cargo no indicado'}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full font-black text-sm ${scoreBadgeCls(detail.score)}`}>
                    {detail.score === null ? 'Sin score' : `${detail.score}/100`}
                  </span>
                </div>

                <p className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 font-bold">
                  Puntaje generado por IA como apoyo de priorización — revisa siempre el CV original antes de decidir.
                </p>

                {detail.score_rationale && (
                  <p className="italic text-slate-400">"{detail.score_rationale}"</p>
                )}

                <a href={cvCandidateFileUrl(detail.submission_id)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider">
                  <Download size={12} /> Descargar CV ({detail.original_filename})
                </a>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Teléfono fijo" value={detail.telefono_fijo} />
                  <Field label="Celular" value={detail.celular} />
                  <Field label="WhatsApp" value={detail.whatsapp} />
                  <Field label="Edad" value={detail.edad ? String(detail.edad) : ''} />
                  <Field label="Centro de estudios" value={detail.centro_estudios} />
                  <Field label="Lugar de residencia" value={detail.lugar_residencia} />
                  <Field label="Años de experiencia" value={detail.anios_experiencia ? String(detail.anios_experiencia) : ''} />
                  <Field label="Pretensiones económicas" value={detail.pretensiones_economicas} />
                  <Field label="Inglés (lectura)" value={detail.ingles_lectura} />
                  <Field label="Inglés (escritura)" value={detail.ingles_escritura} />
                  <Field label="Inglés (conversación)" value={detail.ingles_conversacion} />
                </div>

                {detail.experiencia_laboral?.length > 0 && (
                  <div>
                    <p className={labelCls}>Experiencia laboral</p>
                    <ul className="space-y-1 mt-1">
                      {detail.experiencia_laboral.map((e, i) => (
                        <li key={i} className="bg-slate-800/40 rounded-lg px-3 py-2">
                          <span className="font-bold text-slate-200">{e.empresa || 'Empresa no indicada'}</span>
                          {e.funciones ? <span className="text-slate-400"> — {e.funciones}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail.cursos_capacitacion?.length > 0 && (
                  <Field label="Cursos de capacitación" value={detail.cursos_capacitacion.join(', ')} />
                )}
                {detail.otra_informacion && (
                  <Field label="Otra información relevante" value={detail.otra_informacion} />
                )}

                {detail.extraction_warnings?.length > 0 && (
                  <div className="flex items-start gap-2 text-[10px] text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                    <FileWarning size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold uppercase tracking-wider mb-1">Advertencias de extracción</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {detail.extraction_warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black">{label}</p>
      <p className="text-slate-200">{value}</p>
    </div>
  );
}
