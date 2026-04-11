import React, { useEffect, useMemo, useState } from 'react';
import { X, Sigma, Play } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { fetchAnalysisCatalogs, runTemperatureAnalysis } from '../../lib/api';

function toIsoLocalDateTime(dateStr, endOfDay = false) {
  if (!dateStr) return '';
  return `${dateStr}T${endOfDay ? '23:59:59' : '00:00:00'}-05:00`;
}

export default function FormulaAnalysisModal({ onClose }) {
  const session = getSession();
  const company = session?.company || '';
  const defaultUser = session?.username || session?.fullName || '';
  const [catalogs, setCatalogs] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [usuario, setUsuario] = useState(defaultUser);
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedMinaId, setSelectedMinaId] = useState('');
  const [selectedSensorId, setSelectedSensorId] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAnalysisCatalogs()
      .then((data) => {
        if (!alive) return;
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const users = Array.isArray(data?.usuarios) ? data.usuarios : [];
        setCatalogs(rows);
        setUsuarios(users);
        if (users.length > 0) {
          setUsuario((prev) => (prev && users.includes(prev) ? prev : users[0]));
        }
        if (rows.length > 0) {
          const first = rows[0];
          setSelectedMinaId(String(first.mina_id || ''));
          setSelectedSensorId(String(first.sensor_id || ''));
        }
      })
      .catch((e) => {
        console.error(e);
        const message = e instanceof Error ? e.message : 'No se pudo cargar el catalogo de formula minera.';
        if (alive) setError(message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const minaOptions = useMemo(() => {
    const map = new Map();
    catalogs.forEach((r) => {
      const k = String(r.mina_id || '');
      if (!k || map.has(k)) return;
      map.set(k, { value: k, label: r.mina_nombre || r.mina_codigo || `Mina ${k}` });
    });
    return Array.from(map.values());
  }, [catalogs]);

  const sensorOptions = useMemo(() => {
    return catalogs
      .filter((r) => String(r.mina_id || '') === String(selectedMinaId || ''))
      .map((r) => ({
        value: String(r.sensor_id || ''),
        label: r.sensor_nombre || r.sensor_codigo || `Sensor ${r.sensor_id}`,
      }));
  }, [catalogs, selectedMinaId]);

  const selected = useMemo(
    () =>
      catalogs.find(
        (r) =>
          String(r.mina_id || '') === String(selectedMinaId || '') &&
          String(r.sensor_id || '') === String(selectedSensorId || ''),
      ) || null,
    [catalogs, selectedMinaId, selectedSensorId],
  );

  useEffect(() => {
    if (!selectedMinaId && minaOptions.length > 0) {
      setSelectedMinaId(minaOptions[0].value);
    }
  }, [selectedMinaId, minaOptions]);

  useEffect(() => {
    if (sensorOptions.length === 0) {
      setSelectedSensorId('');
      return;
    }
    const exists = sensorOptions.some((s) => s.value === String(selectedSensorId || ''));
    if (!exists) {
      setSelectedSensorId(sensorOptions[0].value);
    }
  }, [sensorOptions, selectedSensorId]);

  const handleRun = async () => {
    if (!selected) return;
    setRunning(true);
    setError('');
    try {
      const result = await runTemperatureAnalysis({
        mina_id: Number(selectedMinaId),
        sensor_id: Number(selectedSensorId),
        usuario: usuario.trim(),
        fecha_inicio: toIsoLocalDateTime(dateFrom, false),
        fecha_fin: toIsoLocalDateTime(dateTo, true),
      });
      setRows(result.rows || []);
      setSummary(result.summary || null);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'No fue posible ejecutar la formula minera para el rango solicitado.';
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ra-overlay" onClick={onClose}>
      <div className="ra-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ra-header">
          <div className="ra-header-title">
            <Sigma size={20} className="ra-header-icon" />
            <div>
              <h2>Cálculo de Fórmula Minera</h2>
              <p>Reporte multi-tenant por empresa logueada</p>
            </div>
          </div>
          <button className="ra-close-btn" onClick={onClose} title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="ra-filters">
          <div className="ra-filters-grid">
            <div className="ra-field">
              <label>Empresa minera</label>
              <select value={company} disabled>
                <option value={company}>{company || 'Sin empresa'}</option>
              </select>
            </div>
            <div className="ra-field">
              <label>Unidad minera</label>
              <select value={selectedMinaId} disabled>
                {minaOptions.length === 0 ? (
                  <option value="">Sin unidad</option>
                ) : (
                  minaOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))
                )}
              </select>
            </div>
            <div className="ra-field">
              <label>Sensor</label>
              <select value={selectedSensorId} onChange={(e) => setSelectedSensorId(e.target.value)}>
                {sensorOptions.length === 0 ? (
                  <option value="">Sin sensor</option>
                ) : (
                  sensorOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))
                )}
              </select>
            </div>
            <div className="ra-field">
              <label>Usuario</label>
              {usuarios.length > 0 ? (
                <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                  {usuarios.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario responsable" />
              )}
            </div>
            <div className="ra-field">
              <label>Fecha inicio</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="ra-field">
              <label>Fecha fin</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="ra-filter-actions">
            <button className="ra-btn-primary" onClick={handleRun} disabled={!selected || !usuario.trim() || running || loading}>
              <Play size={14} /> {running ? 'Procesando…' : 'Generar reporte'}
            </button>
          </div>
          {error ? <div className="ra-error-msg">{error}</div> : null}
          {summary ? (
            <div className="ra-selected-label">
              Total: <strong>{summary.total_lecturas || 0}</strong> | Alertas: <strong>{summary.total_si || 0}</strong> |
              No alerta: <strong>{summary.total_no || 0}</strong> | % alertas: <strong>{Number(summary.pct_alertas || 0).toFixed(2)}%</strong>
            </div>
          ) : null}
        </div>

        <div className="ra-table-wrap">
          <table className="ra-table">
            <thead>
              <tr>
                <th>Fecha/Hora</th>
                <th>Valor</th>
                <th>Umbral</th>
                <th>Condición</th>
                <th>Procesado</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ra-empty">Sin datos todavía. Ejecuta la fórmula para visualizar resultados.</td>
                </tr>
              ) : (
                rows.slice(0, 500).map((r, idx) => (
                  <tr key={`${r.timestamp_lectura}-${idx}`}>
                    <td>{r.timestamp_lectura || '—'}</td>
                    <td>{Number(r.valor_original || 0).toFixed(2)}</td>
                    <td>{Number(r.umbral_alerta || 0).toFixed(2)}</td>
                    <td>{r.condicion_resultado || '—'}</td>
                    <td>{Number(r.valor_procesado || 0).toFixed(2)}</td>
                    <td>{r.descripcion || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
