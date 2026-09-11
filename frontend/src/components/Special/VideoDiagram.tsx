import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
    Activity,
    Camera,
    MapPin,
    Monitor,
    Radio,
    RefreshCw,
    AlertTriangle,
    Video,
    Copy,
    Check,
} from 'lucide-react'
import CctvStreamVideo from './CctvStreamVideo'
import MiningWorkbenchHeader from '../Dashboard/MiningWorkbenchHeader'
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../auth/telemetryTenant'
import { fetchWithAuthRetry } from '../../lib/fetchWithAuth'

import { log } from '../../lib/logger';

function statusStyles(status: unknown): string {
    const s = String(status || '').toLowerCase()
    if (s === 'online' || s === 'ok') {
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
    }
    if (s === 'warning' || s === 'degraded') {
        return 'border-amber-500/40 bg-amber-500/15 text-amber-200'
    }
    if (s === 'offline' || s === 'down' || s === 'error') {
        return 'border-rose-500/40 bg-rose-500/15 text-rose-200'
    }
    return 'border-slate-600 bg-slate-800/80 text-slate-300'
}

function streamKind(url: unknown): string {
    if (!url || !String(url).trim()) return 'none'
    const u = String(url).trim().toLowerCase()
    if (u.startsWith('rtmp://') || u.startsWith('rtmps://')) return 'rtmp'
    if (u.startsWith('http://') || u.startsWith('https://')) {
        if (u.includes('.m3u8') || u.includes('type=m3u8')) return 'hls'
        return 'http'
    }
    return 'other'
}

interface VideoDiagramProps {
    telemetryTenantId?: string;
}

const VideoDiagram = ({ telemetryTenantId = TELEMETRY_DEFAULT_TENANT_ID }: VideoDiagramProps) => {
    const [cameras, setCameras] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
    const [webcamActive, setWebcamActive] = useState(false)
    const [copiedId, setCopiedId] = useState<string | number | null>(null)
    const localVideoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)

    const loadCameras = useCallback(async () => {
        if (typeof process !== 'undefined' && (process as any).env?.VITEST) {
            setLoading(false)
            return
        }
        try {
            setLoadError(null)
            const apiUrl = new URL('/api/surveillance/cameras', window.location.origin)
            if (telemetryTenantId) apiUrl.searchParams.set('tenant_id', telemetryTenantId)

            const res = await fetchWithAuthRetry(apiUrl.toString())
            const text = await res.text()
            let data: any = {}
            try {
                data = text ? JSON.parse(text) : {}
            } catch {
                setLoadError('Respuesta no válida del servidor')
                return
            }
            if (!res.ok) {
                setLoadError(data.error || `Error ${res.status}`)
                setCameras([])
                return
            }
            setCameras(Array.isArray(data.cameras) ? data.cameras : [])
            setHasLoadedOnce(true)
        } catch (err) {
            log.error('Failed to load cameras', err)
            setLoadError('No se pudo conectar con /api/surveillance/cameras')
            setCameras([])
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [telemetryTenantId])

    useEffect(() => {
        setLoading(true)
        loadCameras()
    }, [loadCameras])

    const onRefresh = () => {
        setRefreshing(true)
        loadCameras()
    }

    const stats = useMemo(() => {
        const dbTotal = cameras.length
        const dbOnline = cameras.filter((c) => String(c.status || '').toLowerCase() === 'online').length
        const dbWebView = cameras.filter((c) => streamKind(c.rtmp_url) === 'http' || streamKind(c.rtmp_url) === 'hls')
            .length

        // Contabiliza la webcam local cuando está habilitada.
        const webcamCount = webcamActive ? 1 : 0

        const total = dbTotal + webcamCount
        const online = dbOnline + webcamCount
        const withStream = dbWebView + webcamCount

        return {
            total,
            online,
            offline: Math.max(total - online, 0),
            withStream,
            localOnline: webcamCount,
        }
    }, [cameras, webcamActive])

    const stopWebcam = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (localVideoRef.current) localVideoRef.current.srcObject = null
        setWebcamActive(false)
    }

    const startWebcam = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false,
            })
            streamRef.current = stream
            if (localVideoRef.current) localVideoRef.current.srcObject = stream
            setWebcamActive(true)
        } catch (err) {
            log.error('Webcam:', err)
        }
    }

    const copyUrl = async (id: string | number, url: string) => {
        try {
            await navigator.clipboard.writeText(url)
            setCopiedId(id)
            setTimeout(() => setCopiedId(null), 2000)
        } catch {
            /* ignore */
        }
    }

    useEffect(() => () => stopWebcam(), [])

    if (loading && !hasLoadedOnce) {
        return (
            <div className="flex h-full min-h-0 w-full flex-col items-center justify-center bg-[#020617] p-8">
                <Activity size={48} className="mb-4 animate-pulse text-sky-500" />
                <p className="mining-workbench-page-subtitle !mt-0 text-center !text-slate-500">Cargando cámaras…</p>
            </div>
        )
    }

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#020617] p-4 sm:p-6 vid-scroll">
            <MiningWorkbenchHeader
                title="Videovigilancia"
                subtitle="Cámaras disponibles en la plataforma (MP4/HLS)."
                icon={Camera}
                actions={
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="mining-workbench-action-btn inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                }
            />

            {cameras.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                    {cameras.map((c) => {
                        const on = String(c.status || '').toLowerCase() === 'online'
                        return (
                            <div
                                key={c.id}
                                className="flex max-w-full items-center gap-2 rounded-xl border border-slate-700/90 bg-slate-900/70 px-3 py-2"
                                style={{ fontFamily: 'var(--font-mining-ui)' }}
                            >
                                <span
                                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${on ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500'}`}
                                    title={on ? 'En línea' : 'Fuera de línea'}
                                />
                                <span className="truncate text-sm font-semibold text-slate-100">{c.name || `Cámara ${c.id}`}</span>
                                <span className="hidden text-xs text-slate-500 sm:inline">{on ? 'En línea' : 'Fuera de línea'}</span>
                            </div>
                        )
                    })}
                </div>
            )}

            {loadError && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/35 bg-rose-950/40 p-4 text-sm text-rose-100">
                    <AlertTriangle className="mt-0.5 shrink-0 text-rose-400" size={20} />
                    <div>
                        <div className="font-bold">No se pudieron cargar las cámaras</div>
                        <div className="mt-1 text-rose-200/80">{loadError}</div>
                    </div>
                </div>
            )}

            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                    { label: 'Cámaras totales', value: stats.total, tone: 'text-slate-100', note: `${cameras.length} de plataforma` },
                    { label: 'En línea', value: stats.online, tone: 'text-emerald-400', note: stats.localOnline ? '+ webcam local activa' : 'sin webcam local' },
                    { label: 'Sin señal', value: stats.offline, tone: 'text-rose-300', note: 'requieren revisión' },
                    { label: 'Vista en web', value: stats.withStream, tone: 'text-sky-400', note: 'MP4 / HLS disponibles' },
                ].map((k) => (
                    <div
                        key={k.label}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 backdrop-blur-sm"
                    >
                        <div className="text-xs font-semibold text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            {k.label}
                        </div>
                        <div className={`mt-1 text-3xl font-bold tabular-nums ${k.tone}`} style={{ fontFamily: 'var(--font-mining-display)' }}>
                            {k.value}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            {k.note}
                        </div>
                    </div>
                ))}
            </section>

            {cameras.length === 0 && !loadError && (
                <div className="mb-6 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center">
                    <Video className="mx-auto mb-3 text-slate-600" size={40} />
                    <p className="text-sm font-semibold text-slate-300">No hay cámaras para este ámbito</p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                        No hay cámaras asignadas a su unidad. Solicite la configuración al administrador.
                    </p>
                </div>
            )}

            <section>
                <h2
                    className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-300"
                    style={{ fontFamily: 'var(--font-mining-ui)' }}
                >
                    <Radio size={16} className="text-sky-500" />
                    Vista de cámaras
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {cameras.map((cam) => {
                        const kind = streamKind(cam.rtmp_url)
                        const playable = kind === 'http' || kind === 'hls'
                        const st = statusStyles(cam.status)
                        return (
                            <article
                                key={cam.id}
                                className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl"
                            >
                                <div className="relative aspect-video bg-black">
                                    {playable && cam.rtmp_url ? (
                                        <CctvStreamVideo
                                            streamUrl={cam.rtmp_url}
                                            className="h-full w-full object-cover"
                                            muted
                                        />
                                    ) : (
                                        <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-900 to-black p-4 text-center">
                                            <Monitor className="text-slate-600" size={36} />
                                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                                {kind === 'rtmp'
                                                    ? 'RTMP (no reproducible en navegador)'
                                                    : 'Sin URL de vídeo HTTP(S)'}
                                            </span>
                                            {kind === 'rtmp' && cam.rtmp_url && (
                                                <p className="text-[10px] leading-snug text-slate-600">
                                                    Use un servidor intermedio HLS o un visor que soporte RTMP.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-2">
                                        <span
                                            className={`pointer-events-none rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${st}`}
                                        >
                                            {cam.status || '—'}
                                        </span>
                                        {playable && (
                                            <span className="rounded bg-emerald-600/90 px-2 py-0.5 text-[9px] font-black text-white">
                                                STREAM
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-2 border-t border-slate-800/80 p-4">
                                    <div>
                                        <div className="text-sm font-bold text-slate-100">{cam.name || `Cámara ${cam.id}`}</div>
                                        {cam.location && (
                                            <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                                                <MapPin size={12} className="shrink-0 text-sky-600" />
                                                {cam.location}
                                            </div>
                                        )}
                                    </div>
                                    <div className="font-mono text-[10px] text-slate-500">
                                        ID #{cam.id} ·{' '}
                                        {Number.isFinite(Number(cam.lat)) && Number.isFinite(Number(cam.lng))
                                            ? `${Number(cam.lat).toFixed(5)}, ${Number(cam.lng).toFixed(5)}`
                                            : 'Sin coordenadas'}
                                    </div>
                                    {cam.rtmp_url ? (
                                        <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                                            <code className="min-w-0 flex-1 break-all text-[10px] text-sky-200/90">
                                                {cam.rtmp_url}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => copyUrl(cam.id, cam.rtmp_url)}
                                                className="shrink-0 rounded border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                                                title="Copiar URL"
                                            >
                                                {copiedId === cam.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-[10px] text-slate-600">Campo rtmp_url vacío en base de datos.</p>
                                    )}
                                </div>
                            </article>
                        )
                    })}
                </div>
            </section>

            <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            <Monitor className="text-amber-400" size={18} />
                            Cámara de este equipo
                        </h2>
                        <p className="mt-1 text-xs text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            Opcional: pruebe la webcam local. No forma parte del CCTV de mina.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => (webcamActive ? stopWebcam() : startWebcam())}
                        className={`shrink-0 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                            webcamActive
                                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                : 'border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                    >
                        {webcamActive ? 'Detener webcam' : 'Activar webcam'}
                    </button>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-black">
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className={`aspect-video w-full object-cover ${webcamActive ? 'opacity-100' : 'opacity-30'}`}
                    />
                    {!webcamActive && (
                        <p className="border-t border-slate-800 bg-slate-900/90 px-3 py-2 text-center text-[10px] text-slate-500">
                            Vista en espera — active la webcam si necesita comprobar el dispositivo local.
                        </p>
                    )}
                </div>
            </section>

            <style>{`
                .vid-scroll::-webkit-scrollbar { width: 6px; }
                .vid-scroll::-webkit-scrollbar-track { background: transparent; }
                .vid-scroll::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
            `}</style>
        </div>
    )
}

// Mismo razonamiento que AdvancedSensors/TelemetryDashboard: único prop es
// telemetryTenantId (primitivo, estable salvo cambio real de tenant).
export default memo(VideoDiagram)
