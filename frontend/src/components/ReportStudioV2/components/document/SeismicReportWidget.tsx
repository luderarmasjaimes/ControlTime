import React, { memo, useEffect, useRef, useState } from 'react';
import { fetchSeismicReport } from '../../lib/api';

interface SeismicReportWidgetProps {
  title?: string;
  /** 'igp' | 'company' | 'both' -- controla si se renderiza 1 o 2 columnas. */
  source?: string;
  startDate?: string;
  endDate?: string;
  width?: number | string;
  height?: number | string;
  /** Igual que MiningKpiWidget: en `false` deja de sondear y congela el
   * último resultado cargado (usado además al firmar, ver props.snapshot). */
  connected?: boolean;
  /** Datos congelados al firmar el informe (ADR-012) -- si vienen presentes
   * se ignora la llamada en vivo y se renderiza esto, para que el informe
   * firmado sea reproducible sin depender de una llamada de red al exportar. */
  snapshot?: { igpEvents: any[]; companyCount: number; fetchedAt: string } | null;
}

function IgpColumn({ events, startDate, endDate }: { events: any[]; startDate?: string; endDate?: string }) {
  const rows = (events || []).slice(-10).reverse();
  return (
    <div className="report-seismic-col">
      <div className="report-seismic-col-title">Sismos Oficiales IGP/CENSIS ({startDate} → {endDate})</div>
      <div className="report-seismic-table-wrap">
        <table className="report-seismic-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Mag.</th>
              <th>Prof.(km)</th>
              <th>Referencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((ev: any, i: number) => (
              <tr key={ev.codigo || i}>
                <td className="tabular-nums">{String(ev.fecha_local || '—').slice(0, 10)}</td>
                <td className="tabular-nums report-seismic-mag">{ev.magnitud ?? '—'}</td>
                <td className="tabular-nums">{ev.profundidad ?? '—'}</td>
                <td className="report-seismic-ref">{ev.referencia || '—'}</td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="report-seismic-empty">Sin sismos oficiales en el rango.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="report-seismic-source">Fuente: IGP (Instituto Geofísico del Perú) / CENSIS — no INDECI/Defensa Civil.</div>
    </div>
  );
}

function CompanyColumn({ count, startDate, endDate }: { count: number; startDate?: string; endDate?: string }) {
  return (
    <div className="report-seismic-col">
      <div className="report-seismic-col-title">Microsismicidad — Sensores Propios de la Mina</div>
      <div className="report-seismic-company-box">
        <div className="report-seismic-company-value">{count}</div>
        <div className="report-seismic-company-label">Eventos detectados ({startDate} → {endDate})</div>
      </div>
      <div className="report-seismic-source">Red interna de geófonos/acelerógrafos por nivel estructural.</div>
    </div>
  );
}

function SeismicReportWidget({
  title = 'Reporte Sismográfico',
  source = 'both',
  startDate,
  endDate,
  width = 600,
  height = 320,
  connected = true,
  snapshot = null,
}: SeismicReportWidgetProps) {
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState('');
  const [igpEvents, setIgpEvents] = useState<any[]>(snapshot?.igpEvents || []);
  const [companyCount, setCompanyCount] = useState<number>(snapshot?.companyCount ?? 0);
  const reqIdRef = useRef(0);

  useEffect(() => {
    // Snapshot congelado (informe firmado/exportado): no se llama a la red,
    // igual que MiningKpiWidget con connected=false.
    if (snapshot) {
      setIgpEvents(snapshot.igpEvents || []);
      setCompanyCount(snapshot.companyCount ?? 0);
      setLoading(false);
      return undefined;
    }
    if (!connected || !startDate || !endDate) {
      setLoading(false);
      return undefined;
    }
    const reqId = ++reqIdRef.current;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchSeismicReport(startDate, endDate);
        if (cancelled || reqId !== reqIdRef.current) return;
        setIgpEvents(data?.igp?.events || []);
        setCompanyCount((data?.company?.events || []).length);
        setError('');
      } catch (err) {
        if (!cancelled && reqId === reqIdRef.current) {
          setError((err as Error)?.message || 'No se pudo cargar el reporte sísmico');
        }
      } finally {
        if (!cancelled && reqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, connected, snapshot]);

  const showIgp = source === 'igp' || source === 'both';
  const showCompany = source === 'company' || source === 'both';

  return (
    <div className="report-seismic-card" style={{ width, height }}>
      <div className="report-seismic-head">
        <span className="report-seismic-title">{title}</span>
        {snapshot ? (
          <span className="report-seismic-pill" title="Datos congelados al firmar — no se actualizan">congelado</span>
        ) : connected ? (
          <span className="report-seismic-pill report-seismic-pill--live">IGP en vivo</span>
        ) : (
          <span className="report-seismic-pill" title="Desconectado — valor congelado, no se actualiza">desconectado</span>
        )}
      </div>
      {loading ? (
        <div className="report-seismic-loading">Cargando reporte sísmico...</div>
      ) : error ? (
        <div className="report-seismic-error">{error}</div>
      ) : (
        <div className={`report-seismic-cols ${showIgp && showCompany ? 'report-seismic-cols--2' : 'report-seismic-cols--1'}`}>
          {showIgp && <IgpColumn events={igpEvents} startDate={startDate} endDate={endDate} />}
          {showCompany && <CompanyColumn count={companyCount} startDate={startDate} endDate={endDate} />}
        </div>
      )}
    </div>
  );
}

export default memo(SeismicReportWidget);
