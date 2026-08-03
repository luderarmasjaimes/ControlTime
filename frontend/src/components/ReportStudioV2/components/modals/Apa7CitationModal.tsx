import React, { useState, useCallback } from 'react';
import { BookMarked, X, Check, AlertCircle, Sparkles, Search, ShieldCheck } from 'lucide-react';
import { formatApa7Citation, searchTrustedReferences, verifyReference, type Apa7CitationFields, type ReferenceSearchResult } from '../../lib/api';

interface Apa7CitationModalProps {
  onClose: () => void;
  onInsert: (apaText: string) => void;
}

/**
 * Modal "Agregar Referencia (APA 7)": dos caminos, ambos con verificación
 * humana antes de insertar nada:
 * (a) buscar una fuente real (Tavily; Serper.dev como fallback) — el backend filtra
 *     los resultados a una lista de dominios de confianza curada (gobierno,
 *     universidades, organismos internacionales, editoriales académicas);
 *     el LLM NUNCA decide qué fuente es confiable, solo esa lista de
 *     dominios lo hace. Requiere una API key configurada en el backend; si
 *     no, el paso de búsqueda queda deshabilitado con aviso.
 * (b) ingresar a mano los datos de una fuente que el usuario ya identificó.
 * En ambos casos, el usuario revisa/confirma los campos antes de darles
 * formato APA 7 (IA local, con fallback determinístico que nunca inventa).
 */
function Apa7CitationModal({ onClose, onInsert }: Apa7CitationModalProps) {
  const [fields, setFields] = useState<Apa7CitationFields>({ author: '', year: '', title: '', source: '', url: '' });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReferenceSearchResult[] | null>(null);
  const [excludedCount, setExcludedCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<{ verified: boolean; matched_year: boolean; matched_title: boolean } | null>(null);
  const [verifyUnavailable, setVerifyUnavailable] = useState(false);

  const setField = (key: keyof Apa7CitationFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [key]: e.target.value }));
    setPreview(null);
  };

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchError(null);
    setSearching(true);
    setSearchResults(null);
    try {
      const result = await searchTrustedReferences(q);
      setSearchResults(result.results);
      setExcludedCount(result.excluded_untrusted_count || 0);
    } catch (e: any) {
      const backendError = e?.response?.data?.error;
      setSearchError(
        backendError === 'search_not_configured' || backendError === 'serper_not_configured'
          ? 'La búsqueda real de fuentes no está configurada en el servidor (falta la API key de Tavily o Serper.dev).'
          : 'No se pudo completar la búsqueda. Intente de nuevo.',
      );
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const pickResult = useCallback((r: ReferenceSearchResult) => {
    setFields((prev) => ({ ...prev, title: r.title, url: r.url, source: prev.source || r.domain }));
    setPickedUrl(r.url);
    setPreview(null);
    setVerification(null);
    setVerifyUnavailable(false);
  }, []);

  const canGenerate = (fields.author || '').trim().length > 0 || (fields.title || '').trim().length > 0;

  const handleGenerate = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await formatApa7Citation(fields);
      setPreview(result.apa);
      setPreviewSource(result.source);
    } catch (e: any) {
      setError(e?.response?.data?.error === 'missing_fields'
        ? 'Ingrese al menos el autor o el título.'
        : 'No se pudo dar formato a la cita. Intente de nuevo.');
    } finally {
      setBusy(false);
    }

    const url = (fields.url || '').trim();
    if (url) {
      setVerification(null);
      setVerifyUnavailable(false);
      setVerifying(true);
      try {
        const v = await verifyReference(url, fields.title, fields.year);
        setVerification(v);
      } catch (e: any) {
        if (e?.response?.data?.error === 'tavily_not_configured') {
          setVerifyUnavailable(true);
        }
      } finally {
        setVerifying(false);
      }
    }
  }, [fields]);

  const handleInsert = useCallback(() => {
    if (preview) onInsert(preview);
  }, [preview, onInsert]);

  return (
    <div className="fixed inset-0 z-[20000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200"><BookMarked size={20} /></div>
            <div>
              <h3 className="font-bold text-slate-900 tracking-tight">Agregar Referencia (APA 7)</h3>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest leading-none">Bibliografía / Referencias</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition-colors"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Search size={13} /> Buscar una fuente real sobre el tema del informe
            </label>
            <div className="flex gap-2 mt-1.5">
              <input
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                placeholder="p.ej. estabilidad de taludes en minería a cielo abierto"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-50 shrink-0"
              >
                {searching ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
              <ShieldCheck size={11} /> Solo se muestran resultados de dominios de confianza (gobierno, universidades, organismos internacionales, editoriales académicas) — nunca la IA decidiendo por su cuenta.
            </p>
            <p className="text-[10px] text-amber-600 mt-1">
              Al pulsar Buscar, solo esta consulta se envía al proveedor bibliográfico externo; no se envía el cuerpo del informe ni la telemetría.
            </p>

            {searchError && (
              <div className="mt-2 p-2.5 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle size={13} className="text-rose-500 shrink-0" /> <span>{searchError}</span>
              </div>
            )}

            {searchResults && (
              <div className="mt-2 space-y-1.5 max-h-52 overflow-auto">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">
                    Sin resultados en dominios de confianza{excludedCount > 0 ? ` (se descartaron ${excludedCount} resultado(s) de dominios no confiables)` : ''}.
                  </p>
                ) : (
                  searchResults.map((r) => (
                    <button
                      key={r.url}
                      type="button"
                      onClick={() => pickResult(r)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors ${pickedUrl === r.url ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-100'}`}
                    >
                      <p className="text-xs font-bold text-slate-800 line-clamp-1">{r.title}</p>
                      <p className="text-[10px] text-emerald-600 font-semibold">{r.domain}</p>
                      <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">{r.snippet}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Revise/complete los datos abajo (autor y año no siempre vienen en el resultado de búsqueda) antes de darles formato:
          </p>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-sm rounded-2xl flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-500 shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-600">Autor (persona u organismo)</label>
              <input className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" placeholder="p.ej. Ministerio de Energía y Minas del Perú"
                value={fields.author} onChange={setField('author')} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600">Año</label>
              <input className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" placeholder="2023"
                value={fields.year} onChange={setField('year')} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600">Fuente / Editorial</label>
              <input className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" placeholder="p.ej. MINEM"
                value={fields.source} onChange={setField('source')} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-600">Título</label>
              <input className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" placeholder="Título del documento/artículo"
                value={fields.title} onChange={setField('title')} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-600">URL (opcional)</label>
              <input className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" placeholder="https://..."
                value={fields.url} onChange={setField('url')} />
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || busy}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-2xl font-bold text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            <Sparkles size={14} /> {busy ? 'Dando formato…' : 'Dar formato APA 7'}
          </button>

          {preview && (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">
                Vista previa {previewSource === 'ollama' ? '(IA local)' : '(formato mecánico)'}
              </p>
              <p className="text-sm text-slate-800 italic">{preview}</p>
              {(fields.url || '').trim() && (
                <div className="mt-2 pt-2 border-t border-indigo-100">
                  {verifying ? (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">Verificando la fuente…</p>
                  ) : verifyUnavailable ? (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                      <AlertCircle size={12} /> Verificación automática no disponible (Tavily no configurado).
                    </p>
                  ) : verification ? (
                    verification.verified ? (
                      <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                        <ShieldCheck size={12} /> Verificado: la página de la URL contiene el {verification.matched_year && verification.matched_title ? 'año y el título' : verification.matched_year ? 'año' : 'título'} declarado.
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1">
                        <AlertCircle size={12} /> No se pudo confirmar el año/título en el contenido de esa URL — revise manualmente antes de insertar.
                      </p>
                    )
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-2xl font-bold text-sm text-slate-600 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={!preview}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <Check size={14} /> Insertar en Referencias
          </button>
        </div>
      </div>
    </div>
  );
}

export default Apa7CitationModal;
