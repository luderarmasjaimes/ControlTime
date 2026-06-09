import React, { useEffect, useMemo, useState } from 'react';
import { fetchMiningKpiPoints, fetchMiningKpis } from '../../lib/api';

const TREND_VIZ_MODES = new Set(['spark_bars', 'line', 'donut', 'none']);

function formatKpiValue(value, decimals = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('es-PE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function complianceState(kpi) {
  if (!kpi || kpi.target_value == null || Number.isNaN(Number(kpi.target_value))) {
    return { label: 'Sin meta', color: '#64748b' };
  }
  const current = Number(kpi.current_value);
  const target = Number(kpi.target_value);
  if (Number.isNaN(current) || Number.isNaN(target)) {
    return { label: 'Sin meta', color: '#64748b' };
  }

  const meets =
    String(kpi.trend_direction || '').toLowerCase() === 'down' ? current <= target : current >= target;
  const delta = Math.abs(target) > 0 ? Math.abs((current - target) / target) : 0;
  if (meets) {
    return { label: 'Cumple', color: '#059669' };
  }
  if (delta <= 0.05) {
    return { label: 'Atención', color: '#d97706' };
  }
  return { label: 'Crítico', color: '#dc2626' };
}

/** Avance vs meta: arco 0..1 y etiqueta % (valor real vs meta, puede superar 100). */
function donutMeta(kpi) {
  if (kpi?.target_value == null) return null;
  const t = Number(kpi.target_value);
  const c = Number(kpi.current_value);
  if (Number.isNaN(t) || t === 0 || Number.isNaN(c)) return null;
  const dir = String(kpi.trend_direction || 'up').toLowerCase();
  const raw = dir === 'down' ? t / Math.max(c, 1e-9) : c / Math.max(t, 1e-9);
  const arcRatio = Math.min(1, Math.max(0, raw));
  const label = `${Math.min(999, Math.round(raw * 100))}%`;
  return { arcRatio, label, raw };
}

/**
 * Si todos los puntos son casi iguales (p. ej. sync repetido), barras/línea quedan planas.
 * Micro-rampa ilustrativa usando tendencia declarada del KPI (el valor principal del KPI no cambia).
 */
function augmentFlatSeriesForDisplay(series, kpi) {
  if (!series || series.length === 0) return { series: [], illustrated: false };
  const vals = series.map((s) => (Number.isNaN(Number(s.value)) ? 0 : Number(s.value)));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  const scale = Math.max(Math.abs(max), Math.abs(min), 1e-9);
  if (range > scale * 1e-5) {
    return { series, illustrated: false };
  }
  const dir = String(kpi?.trend_direction || 'flat').toLowerCase();
  const tp = Number(kpi?.trend_percent);
  const baseMag =
    Number.isFinite(tp) && Math.abs(tp) > 0.01 ? Math.min(0.05, Math.abs(tp) * 0.001) : 0.024;
  const n = series.length;
  const up = dir === 'down' ? false : dir === 'up' ? true : Number.isFinite(tp) ? tp >= 0 : true;
  const next = series.map((s, i) => {
    const tIdx = n === 1 ? 0.5 : i / (n - 1);
    const along = up ? tIdx : 1 - tIdx;
    const factor = 1 + (along - 0.5) * 2 * baseMag;
    return { ...s, value: Number(s.value) * factor };
  });
  return { series: next, illustrated: true };
}

function KpiTrendLine({ series, stroke }) {
  if (!series || series.length < 2) return null;
  const w = 100;
  const h = 28;
  const pad = 3;
  const vals = series.map((s) => (Number.isNaN(Number(s.value)) ? 0 : Number(s.value)));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pts = series
    .map((s, i) => {
      const x = pad + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * (w - 2 * pad));
      const v = Number(s.value);
      const n = max === min ? 0.5 : (v - min) / (max - min);
      const y = pad + (1 - n) * (h - 2 * pad);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg className="report-kpi-trend-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function KpiDonutRing({ arcRatio, trackColor, arcColor, centerLabel }) {
  const size = 44;
  const cx = size / 2;
  const cy = size / 2;
  const r = 15;
  const sw = 4.5;
  const c = 2 * Math.PI * r;
  const dash = arcRatio * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="report-kpi-donut-svg" aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={arcColor}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {centerLabel ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="report-kpi-donut-label"
          fill="#1e1b4b"
          fontSize="10"
          fontWeight="800"
        >
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}

function KpiTrendViz({ mode, displaySeries, illustrated, kpi, compliance, accentColor }) {
  if (mode === 'none') {
    return null;
  }

  if (mode === 'donut') {
    const meta = donutMeta(kpi);
    if (!meta) {
      return (
        <div className="report-kpi-viz-fallback" aria-hidden>
          Sin meta en BD — use mini barras, línea o defina meta para el KPI.
        </div>
      );
    }
    return (
      <div className="report-kpi-viz-donut">
        <KpiDonutRing
          arcRatio={meta.arcRatio}
          trackColor="#e2e8f0"
          arcColor={compliance.color}
          centerLabel={meta.label}
        />
      </div>
    );
  }

  if (!displaySeries.length) {
    return null;
  }

  const hint = illustrated ? (
    <div
      className="report-kpi-viz-illustrated-hint"
      title="Histórico con el mismo valor repetido; forma guía según tendencia declarada en el KPI."
    >
      Serie uniforme · forma guía
    </div>
  ) : null;

  if (mode === 'line') {
    return (
      <div className="report-kpi-viz-line-wrap">
        <div className="report-kpi-viz-line">
          <KpiTrendLine series={displaySeries} stroke={accentColor} />
        </div>
        {hint}
      </div>
    );
  }

  return (
    <div className="report-kpi-viz-bars-wrap">
      <div className="report-kpi-sparkline" aria-hidden>
        {displaySeries.map((p, idx, arr) => {
          const values = arr.map((x) => (Number.isNaN(Number(x.value)) ? 0 : Number(x.value)));
          const min = Math.min(...values);
          const max = Math.max(...values);
          const normalized = max === min ? 0.5 : (Number(p.value) - min) / (max - min);
          return (
            <span
              key={`${p.ts || idx}`}
              className="report-kpi-sparkline-bar"
              style={{ height: `${Math.max(10, Math.round(normalized * 26))}px` }}
            />
          );
        })}
      </div>
      {hint}
    </div>
  );
}

export default function MiningKpiWidget({
  kpiCode,
  title,
  trendViz,
  width = 200,
  height = 120,
  refreshMs = 30000,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kpi, setKpi] = useState(null);
  const [points, setPoints] = useState([]);
  const [syncNonce, setSyncNonce] = useState(0);

  const vizMode = TREND_VIZ_MODES.has(trendViz) ? trendViz : 'spark_bars';

  useEffect(() => {
    const onSynced = () => setSyncNonce((prev) => prev + 1);
    if (typeof window !== 'undefined') {
      window.addEventListener('report-kpi-sync-complete', onSynced);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('report-kpi-sync-complete', onSynced);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMiningKpis();
        if (cancelled) return;
        const found = rows.find((r) => String(r.code || '') === String(kpiCode || ''));
        if (found) {
          setKpi(found);
          setError('');
          try {
            const p = await fetchMiningKpiPoints(found.code, 7);
            if (!cancelled) {
              setPoints(p);
            }
          } catch {
            if (!cancelled) {
              setPoints([]);
            }
          }
        } else {
          setKpi(null);
          setError('KPI no encontrado en runtime');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'No se pudo cargar KPI');
          setKpi(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    const timer = setInterval(load, Math.max(5000, Number(refreshMs) || 30000));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [kpiCode, refreshMs, syncNonce]);

  const statusColor = useMemo(() => {
    const c = String(kpi?.status_color || '').toLowerCase();
    if (c === 'red') return '#dc2626';
    if (c === 'yellow') return '#d97706';
    return '#059669';
  }, [kpi?.status_color]);
  const compliance = useMemo(() => complianceState(kpi), [kpi]);

  const sparkSeries = useMemo(() => {
    const raw = Array.isArray(points) ? points : [];
    const mapped = raw.slice(-24).map((p) => ({
      value: Number(p.value),
      ts: p.ts || p.label || '',
    }));
    if (mapped.length >= 2) {
      return mapped;
    }
    if (mapped.length === 1 && !Number.isNaN(mapped[0].value)) {
      return [mapped[0], { ...mapped[0], ts: `${mapped[0].ts}-dup` }];
    }
    const v = Number(kpi?.current_value);
    if (!Number.isNaN(v) && kpi) {
      const dir = String(kpi.trend_direction || 'flat').toLowerCase();
      const tp = Number(kpi.trend_percent);
      const mag = Number.isFinite(tp) && Math.abs(tp) > 0.01 ? Math.min(0.04, Math.abs(tp) * 0.0008) : 0.018;
      const up = dir === 'down' ? false : dir === 'up' ? true : Number.isFinite(tp) ? tp >= 0 : true;
      return Array.from({ length: 12 }, (_, i) => {
        const t = i / 11;
        const along = up ? t : 1 - t;
        const factor = 1 + (along - 0.5) * 2 * mag;
        return { value: v * factor, ts: `synth-${i}` };
      });
    }
    return [];
  }, [points, kpi]);

  const { series: displaySpark, illustrated } = useMemo(
    () => augmentFlatSeriesForDisplay(sparkSeries, kpi),
    [sparkSeries, kpi],
  );

  if (loading) {
    return (
      <div className="report-kpi-card report-kpi-card--loading" style={{ width, height }}>
        Cargando KPI...
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-kpi-card report-kpi-card--error" style={{ width, height }}>
        <div className="report-kpi-title">{title || kpiCode || 'KPI'}</div>
        <div className="report-kpi-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="report-kpi-card" style={{ width, height }}>
      <div className="report-kpi-head">
        <span className="report-kpi-title">{title || kpi?.title || kpiCode}</span>
        <span className="report-kpi-pill" style={{ borderColor: statusColor, color: statusColor }}>
          runtime
        </span>
      </div>
      <div className="report-kpi-value">{formatKpiValue(kpi?.current_value)}</div>
      <div className="report-kpi-meta">
        <span>{kpi?.unit || ''}</span>
        <span style={{ color: statusColor }}>
          {kpi?.trend_direction || 'flat'} {formatKpiValue(kpi?.trend_percent, 1)}%
        </span>
      </div>
      <div className="report-kpi-compliance">
        <span className="report-kpi-compliance-dot" style={{ backgroundColor: compliance.color }} />
        <span style={{ color: compliance.color }}>{compliance.label}</span>
      </div>
      <div className="report-kpi-updated-at">
        Actualizado: {kpi?.updated_at ? String(kpi.updated_at).replace('T', ' ').slice(0, 19) : '—'}
      </div>
      {vizMode !== 'none' && (
        <KpiTrendViz
          mode={vizMode}
          displaySeries={displaySpark}
          illustrated={illustrated}
          kpi={kpi}
          compliance={compliance}
          accentColor="#4f46e5"
        />
      )}
    </div>
  );
}
