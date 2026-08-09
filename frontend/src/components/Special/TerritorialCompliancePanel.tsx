import React, { memo } from 'react';
import { ShieldCheck, AlertTriangle, CircleDot, ExternalLink, ClipboardCheck, MapPinned } from 'lucide-react';

interface TerritorialCompliancePanelProps {
    siteLabel?: string;
    totals?: { warning?: number; total?: number };
    showExternalWms?: boolean;
    wmsStatus?: string;
    wmsUrl?: string;
    wmsLayerName?: string;
    showGeofences?: boolean;
    loading?: boolean;
    catalogSourceName?: string;
    catalogRegionLabel?: string;
    docUrl?: string;
    geoCompliance?: any;
    geoComplianceLoading?: boolean;
    geoComplianceError?: string;
}

/**
 * Panel lateral de cumplimiento territorial: semáforo operativo + checklist de capas y datos.
 */
function TerritorialCompliancePanel({
    siteLabel,
    totals,
    showExternalWms,
    wmsStatus,
    wmsUrl,
    wmsLayerName,
    showGeofences,
    loading,
    catalogSourceName,
    catalogRegionLabel,
    docUrl,
    geoCompliance,
    geoComplianceLoading,
    geoComplianceError,
}: TerritorialCompliancePanelProps) {
    const warning = totals?.warning ?? 0;
    const total = totals?.total ?? 0;
    const intersections: any[] = Array.isArray(geoCompliance?.intersections) ? geoCompliance.intersections : [];

    let level: 'green' | 'yellow' | 'red' = 'green';
    let title = 'Estable';
    let detail = 'Sin alertas activas en la ventana de mapa actual.';
    if (warning >= 3) {
        level = 'red';
        title = 'Crítico';
        detail = 'Tres o más activos en alerta: priorizar revisión de campo y reporte regulatorio.';
    } else if (warning >= 1) {
        level = 'yellow';
        title = 'Atención';
        detail = 'Hay alertas abiertas; cruce con capas oficiales y geocercas antes del cierre de turno.';
    }

    if (showExternalWms && String(wmsStatus || '').includes('Error')) {
        if (level === 'green') {
            level = 'yellow';
            title = 'Atención';
        }
        detail = `${detail} Revise el servicio WMS (error de teselas o capa inválida).`;
    }

    const criticalGeo = intersections.some(
        (row) =>
            String(row.status || '').toLowerCase() === 'warning' &&
            row.polygons?.some((p: any) => String(p.severity || '').toLowerCase() === 'high'),
    );
    if (criticalGeo) {
        level = 'red';
        title = 'Crítico — espacio regulado';
        detail =
            'Activo en alerta dentro de polígono oficial de severidad alta; priorizar notificación y revisión de permisos.';
    } else {
        const anyInHigh = intersections.some((row) =>
            row.polygons?.some((p: any) => String(p.severity || '').toLowerCase() === 'high'),
        );
        if (intersections.length > 0 && anyInHigh && level === 'green') {
            level = 'yellow';
            title = 'Atención — zona regulatoria';
            detail =
                'Hay activos dentro de polígono de severidad alta; validar trazabilidad y condicionantes del título.';
        }
    }

    if (geoComplianceError && level === 'green') {
        level = 'yellow';
        title = 'Atención';
        detail = `No se pudo evaluar el cruce GeoJSON en backend: ${geoComplianceError}`;
    }

    const semColors: Record<string, string> = {
        green: 'from-emerald-500/25 to-emerald-950/40 border-emerald-500/40 text-emerald-200',
        yellow: 'from-amber-500/25 to-amber-950/40 border-amber-500/40 text-amber-100',
        red: 'from-rose-500/30 to-rose-950/45 border-rose-500/45 text-rose-100',
    };

    const checklist = [
        {
            ok: !loading && total >= 0,
            label: 'Datos operativos sincronizados',
            hint: loading ? 'Cargando marcadores…' : `${total} activo(s) en vista`,
        },
        {
            ok: showGeofences,
            label: 'Geocercas visibles para auditoría espacial',
            hint: showGeofences ? 'Perímetros operativos activos' : 'Active geocercas en el mapa',
        },
        {
            ok: Boolean(String(wmsUrl || '').trim()),
            label: 'Conector WMS configurado',
            hint: String(wmsUrl || '').trim() ? 'URL definida' : 'Elija catálogo o URL manual',
        },
        {
            ok: !showExternalWms || Boolean(String(wmsLayerName || '').trim()),
            label: 'Capa WMS nominada antes de superponer',
            hint:
                showExternalWms && !String(wmsLayerName || '').trim()
                    ? 'Indique workspace:capa o desactive WMS'
                    : showExternalWms
                      ? `Superposición: ${wmsLayerName || '—'}`
                      : 'WMS apagado (válido para solo operación interna)',
        },
        {
            ok: Boolean(geoCompliance?.zones_loaded),
            label: 'Polígonos oficiales (GeoJSON) cargados en backend',
            hint: geoCompliance?.zones_loaded
                ? `${geoCompliance.zone_count} zona(s) · ${geoCompliance.zones_path || 'ruta'}`
                : geoCompliance?.geojson_error ||
                  'Coloque map_official_polygons.geojson en MAPAS_DATA_ROOT o defina OFFICIAL_ZONES_GEOJSON',
        },
    ];

    return (
        <aside className="flex w-[min(100%,340px)] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/90 p-4 text-slate-100 shadow-2xl backdrop-blur-md">
            <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 shrink-0 text-cyan-400" size={20} />
                <div>
                    <h2 className="text-sm font-bold tracking-wide text-white">Cumplimiento territorial</h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                        Semáforo y checklist para cruce operativo con capas oficiales (MINAM, regional, USGS).
                    </p>
                    {siteLabel ? (
                        <p className="mt-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-1 text-[10px] text-slate-300">
                            {siteLabel}
                        </p>
                    ) : null}
                </div>
            </div>

            <div
                className={`rounded-xl border bg-gradient-to-br p-3 ${semColors[level]}`}
            >
                <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider opacity-90">
                    <CircleDot size={14} />
                    Semáforo operativo
                </div>
                <div className="text-lg font-bold">{title}</div>
                <p className="mt-1.5 text-[11px] leading-relaxed opacity-95">{detail}</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <ClipboardCheck size={13} />
                    Checklist de capas
                </div>
                <ul className="space-y-2">
                    {checklist.map((row) => (
                        <li
                            key={row.label}
                            className={`flex gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                                row.ok
                                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                                    : 'border-amber-500/20 bg-amber-500/5 text-amber-100/90'
                            }`}
                        >
                            <span className="shrink-0 font-bold">{row.ok ? '✓' : '!'}</span>
                            <span>
                                <span className="font-semibold">{row.label}</span>
                                <span className="mt-0.5 block text-[10px] opacity-80">{row.hint}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>

            {(catalogRegionLabel || catalogSourceName) && (
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2.5 py-2 text-[10px] text-slate-400">
                    <div className="font-semibold text-slate-300">Catálogo activo</div>
                    <div className="mt-0.5">
                        {catalogRegionLabel}
                        {catalogSourceName ? ` · ${catalogSourceName}` : ''}
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-cyan-500/25 bg-slate-900/55 p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-cyan-300">
                    <MapPinned size={14} />
                    Cruce activo ↔ polígono oficial
                </div>
                {geoComplianceLoading ? (
                    <p className="text-[11px] text-slate-400">Evaluando intersecciones en servidor…</p>
                ) : null}
                {geoComplianceError ? (
                    <p className="text-[11px] text-rose-300">{geoComplianceError}</p>
                ) : null}
                {geoCompliance?.geojson_error ? (
                    <p className="mt-1 text-[10px] text-amber-200/90">{geoCompliance.geojson_error}</p>
                ) : null}
                {geoCompliance && !geoComplianceError ? (
                    <p className="text-[11px] text-slate-300">
                        <span className="font-semibold text-white">{geoCompliance.markers_in_official_zone ?? 0}</span>{' '}
                        activo(s) intersectan polígono(s) ·{' '}
                        <span className="text-slate-500">{geoCompliance.generated_at || '—'}</span>
                    </p>
                ) : null}
                {intersections.length === 0 && !geoComplianceLoading && geoCompliance?.zones_loaded ? (
                    <p className="mt-1 text-[10px] text-slate-500">Ningún marcador cae dentro de las zonas oficiales cargadas.</p>
                ) : null}
                {intersections.length > 0 ? (
                    <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-[10px]">
                        {intersections.slice(0, 12).map((row) => (
                            <li
                                key={row.marker_id}
                                className="rounded-md border border-slate-700/80 bg-slate-950/60 px-2 py-1.5"
                            >
                                <div className="font-semibold text-slate-100">
                                    {row.marker_name || `ID ${row.marker_id}`}{' '}
                                    <span className="font-normal text-slate-500">({row.marker_type})</span>
                                </div>
                                <div className="mt-0.5 text-slate-400">
                                    {(row.polygons || []).map((p: any) => (
                                        <div key={p.id}>
                                            <span
                                                className={
                                                    String(p.severity).toLowerCase() === 'high'
                                                        ? 'text-rose-300'
                                                        : 'text-amber-200/90'
                                                }
                                            >
                                                {p.name || p.id}
                                            </span>
                                            {p.rule_codes?.length ? (
                                                <span className="text-slate-500">
                                                    {' '}
                                                    · {p.rule_codes.join(', ')}
                                                </span>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2.5 py-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400">
                    <AlertTriangle size={12} className="text-amber-400" />
                    Enlaces de referencia
                </div>
                <div className="flex flex-col gap-1.5">
                    {docUrl ? (
                        <a
                            href={docUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
                        >
                            Documentación proveedor seleccionado
                            <ExternalLink size={11} />
                        </a>
                    ) : null}
                    <a
                        href="https://geoservidor.minam.gob.pe/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
                    >
                        MINAM Geoservidor (Perú)
                        <ExternalLink size={11} />
                    </a>
                </div>
            </div>
        </aside>
    );
}

export default memo(TerritorialCompliancePanel);
