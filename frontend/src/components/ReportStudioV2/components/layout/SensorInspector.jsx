import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ListChecks, MapPin, Hash } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../../../auth/telemetryTenant';
import { fetchSensorDashboardCatalog } from '../../lib/api';
import { useEditorStore } from '../../store/useEditorStore';

function slugFromTypeName(name, unit) {
  const n = String(name || '').toLowerCase();
  const u = String(unit || '').toLowerCase();
  if (n.includes('temp') || u.includes('°c') || u === '°c') return 'temperature';
  if (n.includes('humed') || n.includes('hum')) return 'humidity';
  if (n.includes('pres')) return 'pressure';
  if (n.includes('gas')) return 'gas';
  if (n.includes('vib')) return 'vibration';
  return 'temperature';
}

export default function SensorInspector({ element, onUpdate }) {
  const [catalog, setCatalog] = useState({
    zones: [],
    sensor_types: [],
    sensors: [],
    categories: [],
  });
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState('');
  const [mode, setMode] = useState('zone');
  const [zoneFilter, setZoneFilter] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [picked, setPicked] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const session = getSession();
      const tenantId = telemetryTenantIdFromSession(session);
      let data = await fetchSensorDashboardCatalog({
        tenant_id: tenantId,
      });
      if (!Array.isArray(data.sensors) || data.sensors.length === 0) {
        data = await fetchSensorDashboardCatalog({});
      }
      setCatalog({
        zones: Array.isArray(data.zones) ? data.zones : [],
        sensor_types: Array.isArray(data.sensor_types) ? data.sensor_types : [],
        sensors: Array.isArray(data.sensors) ? data.sensors : [],
        categories: Array.isArray(data.categories) ? data.categories : [],
      });
    } catch (e) {
      setLoadError(e?.message || 'No se pudo cargar el catálogo de sensores');
      setCatalog({ zones: [], sensor_types: [], sensors: [], categories: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const typeById = useMemo(() => {
    const m = new Map();
    catalog.sensor_types.forEach((t) => m.set(Number(t.id), t));
    return m;
  }, [catalog.sensor_types]);

  const filteredSensors = useMemo(() => {
    let list = catalog.sensors;
    if (typeFilter) {
      const tid = Number(typeFilter);
      list = list.filter((s) => Number(s.type_id) === tid);
    }
    if (mode === 'zone' && zoneFilter) {
      const zid = Number(zoneFilter);
      list = list.filter((s) => Number(s.zone_id) === zid);
    }
    if (mode === 'ids' && idFilter.trim()) {
      const q = idFilter.trim().toLowerCase();
      list = list.filter((s) => String(s.id).includes(q) || String(s.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [catalog.sensors, typeFilter, mode, zoneFilter, idFilter]);

  const togglePick = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = Number(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setPicked(new Set(filteredSensors.map((s) => Number(s.id))));
  };

  const clearPicked = () => setPicked(new Set());

  const applyToDocument = () => {
    const ids = [...picked];
    if (ids.length === 0) return;

    const propsBase = element.props || {};
    const addElement = useEditorStore.getState().addElement;

    const buildProps = (sensorRow) => {
      const t = typeById.get(Number(sensorRow.type_id));
      const slug = slugFromTypeName(t?.name, t?.unit);
      return {
        ...propsBase,
        sensorId: Number(sensorRow.id),
        sensorTypeId: Number(sensorRow.type_id),
        sensorType: slug,
        title: String(sensorRow.name || `Sensor ${sensorRow.id}`),
      };
    };

    const orderedRows = [...picked]
      .map((pid) => catalog.sensors.find((s) => Number(s.id) === Number(pid)))
      .filter(Boolean);
    if (orderedRows.length === 0) return;

    onUpdate({
      props: buildProps(orderedRows[0]),
    });

    for (let i = 1; i < orderedRows.length; i += 1) {
      addElement('sensor', { props: buildProps(orderedRows[i]) });
    }
    setPicked(new Set());
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label">Sensor en tiempo real (dashboard)</span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Catálogo desde la base de datos (tipos, zonas y sensores). Elija uno o varios y aplique: el primero actualiza
        este bloque; el resto se inserta como bloques adicionales en el lienzo.
      </p>

      {loading ? (
        <p style={{ fontSize: 12, color: '#64748b' }}>Cargando catálogo de sensores…</p>
      ) : null}
      {loadError ? (
        <p style={{ fontSize: 12, color: '#b91c1c' }}>{loadError}</p>
      ) : null}

      <div className="input-group">
        <label>Tipo de sensor (filtro)</label>
        <select className="input-premium" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Todos los tipos</option>
          {catalog.sensor_types.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
              {t.unit ? ` (${t.unit})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="input-group">
        <label>Modo de selección</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={mode === 'zone' ? 'btn-premium-outline' : 'btn-premium-outline'}
            style={{
              flex: 1,
              minWidth: 120,
              borderColor: mode === 'zone' ? '#6366f1' : undefined,
              background: mode === 'zone' ? '#eef2ff' : undefined,
            }}
            onClick={() => setMode('zone')}
          >
            <MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Por zona
          </button>
          <button
            type="button"
            className="btn-premium-outline"
            style={{
              flex: 1,
              minWidth: 120,
              borderColor: mode === 'ids' ? '#6366f1' : undefined,
              background: mode === 'ids' ? '#eef2ff' : undefined,
            }}
            onClick={() => setMode('ids')}
          >
            <Hash size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Por ID / nombre
          </button>
        </div>
      </div>

      {mode === 'zone' ? (
        <div className="input-group">
          <label>Zona operativa</label>
          <select className="input-premium" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">Todas las zonas</option>
            {catalog.zones.map((z) => (
              <option key={z.id} value={String(z.id)}>
                {z.name_es} ({z.code})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="input-group">
          <label>Buscar por ID o nombre</label>
          <input
            className="input-premium"
            value={idFilter}
            onChange={(e) => setIdFilter(e.target.value)}
            placeholder="Ej: 3 o presión"
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-premium-outline" onClick={selectAllFiltered}>
          <ListChecks size={14} style={{ marginRight: 6 }} />
          Marcar listado filtrado
        </button>
        <button type="button" className="btn-premium-outline" onClick={clearPicked}>
          Limpiar
        </button>
        <button type="button" className="btn-premium-outline" onClick={load}>
          <Activity size={14} style={{ marginRight: 6 }} />
          Refrescar BD
        </button>
      </div>

      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 8,
          background: '#f8fafc',
          padding: 6,
        }}
      >
        {filteredSensors.length === 0 ? (
          <p style={{ margin: 8, fontSize: 11, color: '#64748b' }}>Sin sensores con el filtro actual.</p>
        ) : (
          filteredSensors.map((s) => {
            const idn = Number(s.id);
            const checked = picked.has(idn);
            const t = typeById.get(Number(s.type_id));
            return (
              <label
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: '#0f172a',
                  background: checked ? '#e0e7ff' : 'transparent',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => togglePick(s.id)} />
                <span style={{ fontWeight: 700, minWidth: 28 }}>{s.id}</span>
                <span style={{ flex: 1 }}>{s.name}</span>
                <span style={{ color: '#64748b', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.zone_code || '—'}
                </span>
                <span style={{ color: '#64748b' }}>{t?.name || '—'}</span>
              </label>
            );
          })
        )}
      </div>

      <button
        type="button"
        className="btn-premium-outline"
        style={{
          width: '100%',
          marginTop: 10,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontWeight: 700,
          borderColor: '#6366f1',
          background: '#eef2ff',
        }}
        disabled={picked.size === 0}
        onClick={applyToDocument}
      >
        Aplicar al documento ({picked.size} seleccionado{picked.size === 1 ? '' : 's'})
      </button>
    </div>
  );
}
