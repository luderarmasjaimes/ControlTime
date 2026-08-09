import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Mic, X, Check, RefreshCw, Circle, Square, AlertCircle, FileText, Loader2 } from 'lucide-react';

const MAX_RECORDING_SECONDS = 180;

function pickSupportedAudioMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return 'audio/webm';
}

type PageMode = 'none' | 'audio' | 'notes';
interface PageNarrationState {
  mode: PageMode;
  blob?: Blob;
  url?: string;
  durationSeconds?: number;
  notes?: string;
}

interface NarrationModalProps {
  pageCount: number;
  onClose: () => void;
  /** Sube la narración de UNA página — se llama una vez por cada página que
   * tenga audio grabado o notas escritas (las que quedan en 'none' se
   * omiten: sin narración = igual que hoy, silencio en esa diapositiva). */
  onUploadPage: (
    pageNumber: number,
    payload: { audioBlob: Blob; durationSeconds: number } | { speakerNotes: string },
  ) => Promise<void>;
  /** Se llama después de que TODAS las páginas con narración terminaron de
   * subir — dispara la creación del job de video (que ya recoge la
   * narración recién adjuntada) y su descarga. */
  onSubmit: () => Promise<void>;
}

/**
 * Modal "Narrar y convertir a video": una fila por página del informe en
 * modo presentación. Por página, el usuario puede grabar audio (micrófono,
 * MediaRecorder — mismo patrón que VideoInsertModal.tsx, sin la parte de
 * video), escribir notas del orador (guardadas para una futura conversión
 * TTS, sin proveedor integrado todavía — la página queda muda hasta
 * entonces) o dejarla sin narración. "Generar video" sube lo que haya y
 * dispara la conversión.
 */
function NarrationModal({ pageCount, onClose, onUploadPage, onSubmit }: NarrationModalProps) {
  const [pages, setPages] = useState<Map<number, PageNarrationState>>(new Map());
  const [recordingPage, setRecordingPage] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pages.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getPageState = useCallback(
    (pageNumber: number): PageNarrationState => pages.get(pageNumber) || { mode: 'none' },
    [pages],
  );

  const setPageState = useCallback((pageNumber: number, patch: Partial<PageNarrationState>) => {
    setPages((prev) => {
      const next = new Map(prev);
      next.set(pageNumber, { ...(next.get(pageNumber) || { mode: 'none' }), ...patch });
      return next;
    });
  }, []);

  const startRecording = useCallback(async (pageNumber: number) => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('No se pudo acceder al micrófono. Verifique permisos del navegador.');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = pickSupportedAudioMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      setPageState(pageNumber, { mode: 'audio', blob, url, durationSeconds });
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      clearTimer();
      setRecordingPage(null);
    };

    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    recorder.start(300);
    setRecordingPage(pageNumber);
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(secs);
      if (secs >= MAX_RECORDING_SECONDS && recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
    }, 250);
  }, [clearTimer, setPageState]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const discardAudio = useCallback((pageNumber: number) => {
    const p = pages.get(pageNumber);
    if (p?.url) URL.revokeObjectURL(p.url);
    setPageState(pageNumber, { mode: 'none', blob: undefined, url: undefined, durationSeconds: undefined });
  }, [pages, setPageState]);

  const narratedPageCount = Array.from(pages.values()).filter((p) => p.mode !== 'none').length;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      for (const [pageNumber, state] of pages.entries()) {
        if (state.mode === 'audio' && state.blob) {
          await onUploadPage(pageNumber, { audioBlob: state.blob, durationSeconds: state.durationSeconds || 0 });
        } else if (state.mode === 'notes' && state.notes?.trim()) {
          await onUploadPage(pageNumber, { speakerNotes: state.notes.trim() });
        }
      }
      await onSubmit();
      onClose();
    } catch (e) {
      setError('No se pudo generar el video narrado. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }, [pages, onUploadPage, onSubmit, onClose]);

  return (
    <div className="fixed inset-0 z-[20000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200"><Mic size={20} /></div>
            <div>
              <h3 className="font-bold text-slate-900 tracking-tight">Narrar y convertir a video</h3>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest leading-none">
                {narratedPageCount > 0 ? `${narratedPageCount} de ${pageCount} páginas narradas` : 'Opcional — sin narración, el video queda mudo'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition-colors" disabled={submitting}><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6 scrollbar-thin space-y-3">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-sm rounded-2xl flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-500 shrink-0" /> <span>{error}</span>
            </div>
          )}
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => {
            const state = getPageState(pageNumber);
            const isRecordingThis = recordingPage === pageNumber;
            return (
              <div key={pageNumber} className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-slate-700">Página {pageNumber}</span>
                  {state.mode !== 'none' && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                      {state.mode === 'audio' ? `Audio grabado (${state.durationSeconds}s)` : 'Notas guardadas'}
                    </span>
                  )}
                </div>

                {state.mode === 'audio' && state.url ? (
                  <div className="flex items-center gap-3">
                    <audio src={state.url} controls className="flex-1 h-9" />
                    <button
                      type="button"
                      onClick={() => discardAudio(pageNumber)}
                      disabled={submitting}
                      className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                      title="Descartar y grabar de nuevo"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : isRecordingThis ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
                      <Circle size={10} className="fill-rose-600 animate-pulse" /> REC {elapsedSeconds}s
                    </span>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="bg-rose-600 text-white px-4 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5"
                    >
                      <Square size={12} /> Detener
                    </button>
                  </div>
                ) : state.mode === 'notes' ? (
                  <div className="space-y-2">
                    <textarea
                      value={state.notes || ''}
                      onChange={(e) => setPageState(pageNumber, { notes: e.target.value })}
                      disabled={submitting}
                      placeholder="Notas del orador para esta página…"
                      className="w-full text-sm border border-slate-200 rounded-xl p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      rows={2}
                    />
                    <button
                      type="button"
                      onClick={() => setPageState(pageNumber, { mode: 'none', notes: undefined })}
                      disabled={submitting}
                      className="text-xs font-bold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    >
                      Quitar notas
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startRecording(pageNumber)}
                      disabled={submitting || recordingPage !== null}
                      className="px-3 py-1.5 rounded-xl font-bold text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Mic size={12} /> Grabar audio
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageState(pageNumber, { mode: 'notes', notes: '' })}
                      disabled={submitting || recordingPage !== null}
                      className="px-3 py-1.5 rounded-xl font-bold text-xs bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <FileText size={12} /> Notas del orador
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 rounded-2xl font-bold text-sm text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || recordingPage !== null}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {submitting ? 'Generando…' : narratedPageCount > 0 ? 'Generar video narrado' : 'Generar video (sin narración)'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(NarrationModal);
