import React, { useCallback, useEffect, useState } from 'react';
import {
  LifeBuoy, Search, RotateCcw, AlertTriangle, ChevronLeft, ChevronRight,
  Ticket, MessagesSquare, Loader2,
} from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { usePermissions } from '../../../../auth/usePermissions';
import {
  searchSupportTickets,
  searchSupportChatMessages,
  type SupportTicket,
  type SupportChatMessageAdminRow,
  type SupportTicketFilters,
  type SupportChatMessageFilters,
  type SupportAdminSearchResult,
} from '../../lib/api';

/* ─────────────────────────────────────────────────────────────────────────
   PANEL ADMIN DE SOPORTE -- búsqueda de tickets y de mensajes de chat,
   paginada en SERVIDOR (page/page_size viajan en cada request, nunca se trae
   todo para filtrar en cliente). Mismo lenguaje visual que WhatsappConfigView/
   UserManagementView/PermissionsManagementView (slate-900/950, uppercase
   tracking-widest, indigo-600 primario, backdrop-blur).

   RBAC (aplicada por el backend, esto solo refleja el contrato en la UI):
     - GET /api/support/admin/tickets: soporte.view, soporte.manage, o
       usuario "department-scoped" (tiene session.department) -- en ese
       último caso el backend fuerza `category` a su departamento server-side;
       si el frontend manda otra categoría, responde 403. Por eso, si el
       usuario está department-scoped, el filtro de categoría queda fijo
       (sin selector "Todas") en vez de editable.
     - GET /api/support/admin/chat-messages: SOLO soporte.view/soporte.manage
       -- un usuario solo-department (sin esos permisos) recibe 403, así que
       la pestaña "Mensajes de chat" se oculta directamente para ese caso.

   Enums reconciliados con el backend real (db_scripts/59, 62; support_ticket
   CHECK constraints en support_ticket.category/status/channel/priority):
   category=soporte|comercial|reclamo|agenda|rrhh (ADR-115), status=abierto|
   en_proceso|resuelto|cerrado, channel del TICKET=whatsapp|web (no confundir
   con el channel del MENSAJE de chat, que es HomeMinero|MovilMinero -- ADR-117
   -- esta tabla es de tickets, no de mensajes de chat). priority=baja|media|alta.
   ───────────────────────────────────────────────────────────────────────── */

const CATEGORY_OPTIONS = [
  { value: 'soporte', label: 'Soporte técnico' },
  { value: 'comercial', label: 'Área comercial' },
  { value: 'reclamo', label: 'Reclamo' },
  { value: 'agenda', label: 'Agenda de visita' },
  { value: 'rrhh', label: 'Recursos Humanos' },
];
const STATUS_OPTIONS = [
  { value: 'abierto', label: 'Abierto' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'resuelto', label: 'Resuelto' },
  { value: 'cerrado', label: 'Cerrado' },
];
const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'web', label: 'Web (widget)' },
];
const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const PAGE_SIZE = 20;
const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

type AdminTab = 'tickets' | 'messages';

const emptyTicketFilters = (defaultCategory: string): SupportTicketFilters => ({
  category: defaultCategory,
  status: 'all',
  channel: 'all',
  priority: 'all',
  q: '',
  dateFrom: THIRTY_DAYS_AGO,
  dateTo: TODAY,
});

const emptyMessageFilters = (): SupportChatMessageFilters => ({
  conversationId: '',
  tenantId: '',
  q: '',
  dateFrom: THIRTY_DAYS_AGO,
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

const inputCls = 'form-input-base';
const labelCls = 'form-label';

const tabBtnCls = (active: boolean) =>
  `px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
    active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
  }`;

export default function SupportAdminView() {
  const session = getSession();
  const company = session?.company || '';
  const { isAdmin, hasPermission, loading: permsLoading } = usePermissions();

  // Un usuario con soporte.view/soporte.manage NO está "department-scoped" en
  // el sentido del contrato aunque tenga un department asignado -- el flag
  // solo importa para decidir si el filtro de categoría queda fijo.
  const canSeeChatMessages = isAdmin || hasPermission('soporte.view') || hasPermission('soporte.manage');
  const isDepartmentScoped = Boolean(session?.department);
  const defaultCategory = isDepartmentScoped ? (session?.department as string) : 'all';

  const [tab, setTab] = useState<AdminTab>('tickets');

  // ── Tickets ──
  const [ticketFilters, setTicketFilters] = useState<SupportTicketFilters>(() => emptyTicketFilters(defaultCategory));
  const [ticketApplied, setTicketApplied] = useState<SupportTicketFilters>(ticketFilters);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketResult, setTicketResult] = useState<SupportAdminSearchResult<SupportTicket> | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);

  const loadTickets = useCallback(async () => {
    setTicketLoading(true);
    const result = await searchSupportTickets(
      { ...ticketApplied, category: isDepartmentScoped ? defaultCategory : ticketApplied.category },
      ticketPage,
      PAGE_SIZE,
    );
    setTicketResult(result);
    setTicketLoading(false);
  }, [ticketApplied, ticketPage, isDepartmentScoped, defaultCategory]);

  useEffect(() => {
    if (tab === 'tickets') loadTickets();
  }, [tab, loadTickets]);

  useEffect(() => { setTicketPage(1); }, [ticketApplied]);

  // ── Mensajes de chat ──
  const [msgFilters, setMsgFilters] = useState<SupportChatMessageFilters>(emptyMessageFilters);
  const [msgApplied, setMsgApplied] = useState<SupportChatMessageFilters>(msgFilters);
  const [msgPage, setMsgPage] = useState(1);
  const [msgResult, setMsgResult] = useState<SupportAdminSearchResult<SupportChatMessageAdminRow> | null>(null);
  const [msgLoading, setMsgLoading] = useState(false);

  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    const result = await searchSupportChatMessages(msgApplied, msgPage, PAGE_SIZE);
    setMsgResult(result);
    setMsgLoading(false);
  }, [msgApplied, msgPage]);

  useEffect(() => {
    if (tab === 'messages' && canSeeChatMessages) loadMessages();
  }, [tab, canSeeChatMessages, loadMessages]);

  useEffect(() => { setMsgPage(1); }, [msgApplied]);

  if (permsLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
        Cargando permisos...
      </div>
    );
  }

  const ticketTotalPages = ticketResult?.pages || 1;
  const msgTotalPages = msgResult?.pages || 1;

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-2 lg:p-3 overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <LifeBuoy className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Administración de Soporte</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {company || 'EMPRESA NO IDENTIFICADA'}
              {isDepartmentScoped ? ` · Departamento: ${session?.department}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={tabBtnCls(tab === 'tickets')} onClick={() => setTab('tickets')}>
            <Ticket size={13} /> Tickets
          </button>
          {canSeeChatMessages && (
            <button type="button" className={tabBtnCls(tab === 'messages')} onClick={() => setTab('messages')}>
              <MessagesSquare size={13} /> Mensajes de chat
            </button>
          )}
        </div>
      </div>

      {tab === 'tickets' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {/* Filtros */}
          <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 backdrop-blur-xl shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className={labelCls}>Fecha inicio</label>
                <input type="date" className={inputCls} value={ticketFilters.dateFrom || ''}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Fecha fin</label>
                <input type="date" className={inputCls} value={ticketFilters.dateTo || ''}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, dateTo: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Categoría</label>
                {isDepartmentScoped ? (
                  <div className={`${inputCls} flex items-center text-slate-400 cursor-not-allowed`} title="Fijo a tu departamento">
                    {CATEGORY_OPTIONS.find((c) => c.value === defaultCategory)?.label || defaultCategory}
                  </div>
                ) : (
                  <select className={inputCls} value={ticketFilters.category || 'all'}
                    onChange={(e) => setTicketFilters((f) => ({ ...f, category: e.target.value }))}>
                    <option value="all">Todas</option>
                    {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <select className={inputCls} value={ticketFilters.status || 'all'}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, status: e.target.value }))}>
                  <option value="all">Todos</option>
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Canal</label>
                <select className={inputCls} value={ticketFilters.channel || 'all'}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, channel: e.target.value }))}>
                  <option value="all">Todos</option>
                  {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Prioridad</label>
                <select className={inputCls} value={ticketFilters.priority || 'all'}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, priority: e.target.value }))}>
                  <option value="all">Todas</option>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="col-span-2 md:col-span-3 lg:col-span-4">
                <label className={labelCls}>Texto libre (asunto, descripción, contacto)</label>
                <input type="text" className={inputCls} placeholder="Buscar…" value={ticketFilters.q || ''}
                  onChange={(e) => setTicketFilters((f) => ({ ...f, q: e.target.value }))} />
              </div>
              <div className="flex items-end gap-2 col-span-2 lg:col-span-2">
                <button type="button"
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                  onClick={() => { const empty = emptyTicketFilters(defaultCategory); setTicketFilters(empty); setTicketApplied(empty); }}>
                  <RotateCcw size={12} /> Limpiar
                </button>
                <button type="button"
                  className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
                  onClick={() => setTicketApplied(ticketFilters)}>
                  <Search size={12} /> Buscar
                </button>
              </div>
            </div>
          </div>

          {/* Tabla */}
          <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl backdrop-blur-xl overflow-hidden flex flex-col">
            {ticketResult?.error && (ticketResult.status === 403) && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                <AlertTriangle className="text-amber-400" size={28} />
                <p className="text-xs font-bold text-center max-w-md">No tienes permiso para ver estos tickets (se requiere soporte.view, soporte.manage o un departamento asignado).</p>
              </div>
            )}
            {ticketResult?.error && ticketResult.status !== 403 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                <AlertTriangle className="text-amber-400" size={28} />
                <p className="text-xs font-bold text-center max-w-md">No se pudo cargar la lista de tickets.</p>
              </div>
            )}
            {!ticketResult?.error && (
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-xl">
                    <tr className="text-slate-400 uppercase tracking-widest text-[9px] font-black">
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Canal</th>
                      <th className="px-3 py-2">Categoría</th>
                      <th className="px-3 py-2">Contacto</th>
                      <th className="px-3 py-2">Asunto</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Prioridad</th>
                      <th className="px-3 py-2">Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticketLoading ? (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        <Loader2 className="inline animate-spin mr-2" size={14} /> Buscando…
                      </td></tr>
                    ) : (ticketResult?.items.length || 0) === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Sin resultados.</td></tr>
                    ) : (
                      ticketResult!.items.map((tk) => (
                        <tr key={tk.id} className="border-t border-white/5 text-slate-300 hover:bg-slate-800/30">
                          <td className="px-3 py-2 font-mono text-slate-400">{tk.code}</td>
                          <td className="px-3 py-2">{tk.channel}</td>
                          <td className="px-3 py-2">{tk.category}</td>
                          <td className="px-3 py-2">{tk.contact_name || tk.phone_e164 || '—'}</td>
                          <td className="px-3 py-2 max-w-[220px] truncate" title={tk.subject}>{tk.subject}</td>
                          <td className="px-3 py-2">{tk.status}</td>
                          <td className="px-3 py-2">{tk.priority}</td>
                          <td className="px-3 py-2 text-slate-500">{formatDate(tk.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {/* Paginación */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 shrink-0 text-[10px] text-slate-400">
              <span>{ticketResult?.total ?? 0} resultado{(ticketResult?.total ?? 0) !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={ticketPage <= 1} onClick={() => setTicketPage((p) => Math.max(1, p - 1))}
                  className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                  <ChevronLeft size={13} />
                </button>
                <span>Página {ticketPage} de {ticketTotalPages}</span>
                <button type="button" disabled={ticketPage >= ticketTotalPages} onClick={() => setTicketPage((p) => Math.min(ticketTotalPages, p + 1))}
                  className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'messages' && canSeeChatMessages && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {/* Filtros */}
          <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 backdrop-blur-xl shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Fecha inicio</label>
                <input type="date" className={inputCls} value={msgFilters.dateFrom || ''}
                  onChange={(e) => setMsgFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Fecha fin</label>
                <input type="date" className={inputCls} value={msgFilters.dateTo || ''}
                  onChange={(e) => setMsgFilters((f) => ({ ...f, dateTo: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Conversation ID</label>
                <input type="text" className={inputCls} placeholder="uuid…" value={msgFilters.conversationId || ''}
                  onChange={(e) => setMsgFilters((f) => ({ ...f, conversationId: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Texto libre</label>
                <input type="text" className={inputCls} placeholder="Buscar en el contenido…" value={msgFilters.q || ''}
                  onChange={(e) => setMsgFilters((f) => ({ ...f, q: e.target.value }))} />
              </div>
              <div className="flex items-end gap-2 col-span-2 md:col-span-4">
                <button type="button"
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                  onClick={() => { const empty = emptyMessageFilters(); setMsgFilters(empty); setMsgApplied(empty); }}>
                  <RotateCcw size={12} /> Limpiar
                </button>
                <button type="button"
                  className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
                  onClick={() => setMsgApplied(msgFilters)}>
                  <Search size={12} /> Buscar
                </button>
              </div>
            </div>
          </div>

          {/* Tabla */}
          <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl backdrop-blur-xl overflow-hidden flex flex-col">
            {msgResult?.error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                <AlertTriangle className="text-amber-400" size={28} />
                <p className="text-xs font-bold text-center max-w-md">
                  {msgResult.status === 403
                    ? 'No tienes permiso para ver los mensajes de chat (se requiere soporte.view o soporte.manage).'
                    : 'No se pudo cargar la lista de mensajes.'}
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-xl">
                    <tr className="text-slate-400 uppercase tracking-widest text-[9px] font-black">
                      <th className="px-3 py-2">Conversación</th>
                      <th className="px-3 py-2">Canal</th>
                      <th className="px-3 py-2">Rol</th>
                      <th className="px-3 py-2">Contenido</th>
                      <th className="px-3 py-2">Intención</th>
                      <th className="px-3 py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {msgLoading ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                        <Loader2 className="inline animate-spin mr-2" size={14} /> Buscando…
                      </td></tr>
                    ) : (msgResult?.items.length || 0) === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Sin resultados.</td></tr>
                    ) : (
                      msgResult!.items.map((m) => (
                        <tr key={m.id} className="border-t border-white/5 text-slate-300 hover:bg-slate-800/30 align-top">
                          <td className="px-3 py-2 font-mono text-slate-500 max-w-[140px] truncate" title={m.conversation_id}>{m.conversation_id}</td>
                          <td className="px-3 py-2">{m.channel}</td>
                          <td className="px-3 py-2">{m.role}</td>
                          <td className="px-3 py-2 max-w-[360px] truncate" title={m.content}>{m.content}</td>
                          <td className="px-3 py-2 text-slate-500">{m.intent || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{formatDate(m.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {/* Paginación */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 shrink-0 text-[10px] text-slate-400">
              <span>{msgResult?.total ?? 0} resultado{(msgResult?.total ?? 0) !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={msgPage <= 1} onClick={() => setMsgPage((p) => Math.max(1, p - 1))}
                  className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                  <ChevronLeft size={13} />
                </button>
                <span>Página {msgPage} de {msgTotalPages}</span>
                <button type="button" disabled={msgPage >= msgTotalPages} onClick={() => setMsgPage((p) => Math.min(msgTotalPages, p + 1))}
                  className="p-1 rounded bg-slate-800 disabled:opacity-30 hover:bg-slate-700">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
