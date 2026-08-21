import React, { memo, useEffect, useMemo, useState } from 'react';
import { RefreshCw, X, Radar } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../../../auth/telemetryTenant';
import { fetchTelemetryWizardCatalog } from '../../lib/api';
import { useEditorStore, type ReportElement } from '../../store/useEditorStore';
import ZoneSensorPicker, { type WizardCatalogSensor, type SensorSelection } from './ZoneSensorPicker';
import ChartTypePicker, { type SensorMultiChartType } from './ChartTypePicker';

interface SensorMultiChartInspectorProps {
  element: ReportElement;
  onUpdate: (patch: Partial<ReportElement>) => void;
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function SensorMultiChartInspector({ element, onUpdate }: SensorMultiChartInspectorProps) {
  const props = element.props || {};

  const [sensorTypes, setSensorTypes] = useState<{ type: string; unit: string; count: number }[]>([]);
  const [sensorsForType, setSensorsForType] = useState<WizardCatalogSensor[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingSensors, setLoadingSensors] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado local del wizard — NO se escribe en el documento hasta el clic en
  // "Insertar gráfico" (mismo patrón que SensorInspector.applyToDocument:
  // stage local, commit explícito), así el bloque recién insertado no
  // muestra un gráfico a medio configurar mientras el usuario recorre los pasos.
  const [sensorType, setSensorType] = useState<string>(props.sensorType || '');
  const [selections, setSelections] = useState<SensorSelection[]>(
    Array.isArray(props.selections) ? props.selections : [],
  );
  // Selección múltiple: cada tipo marcado genera su propio bloque al
  // insertar (ver handleInsert) — "generar los diagramas", en plural.
  const [chartTypes, setChartTypes] = useState<SensorMultiChartType[]>(
    props.chartType ? [props.chartType as SensorMultiChartType] : [],
  );
  const [from, setFrom] = useState<string>(props.from || '');
  const [to, setTo] = useState<string>(props.to || '');

  const tenantId = useMemo(() => telemetryTenantIdFromSession(getSession()), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTypes(true);
      setLoadError(null);
      try {
        const data = await fetchTelemetryWizardCatalog({ tenant_id: tenantId });
        if (cancelled) return;
        setSensorTypes(Array.isArray(data.sensor_types) ? data.sensor_types : []);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error)?.message || 'No se pudo cargar el catálogo de sensores');
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (!sensorType) {
      setSensorsForType([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoadingSensors(true);
      setLoadError(null);
      try {
        const data = await fetchTelemetryWizardCatalog({ sensor_type: sensorType, tenant_id: tenantId });
        if (!cancelled) setSensorsForType(Array.isArray(data.sensors) ? data.sensors : []);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error)?.message || 'No se pudo cargar los sensores de este tipo');
      } finally {
        if (!cancelled) setLoadingSensors(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sensorType, tenantId]);

  const handleSensorTypeChange = (next: string) => {
    setSensorType(next);
    // Cambiar el tipo invalida la selección anterior — pertenecía a otro
    // catálogo de sensores.
    setSelections([]);
  };

  const applyQuickRange = (hours: number) => {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - hours * 60 * 60 * 1000);
    setFrom(fromDate.toISOString());
    setTo(toDate.toISOString());
  };

  const unitSummary = useMemo(() => {
    const units = new Set(selections.map((s) => s.unit || '—'));
    return [...units];
  }, [selections]);

  const zoneSummaryCount = useMemo(() => new Set(selections.map((s) => s.zoneId)).size, [selections]);

  const validRange = Boolean(from) && Boolean(to) && new Date(from) < new Date(to);
  const canInsert = Boolean(sensorType) && selections.length > 0 && chartTypes.length > 0 && validRange;

  const handleInsert = () => {
    if (!canInsert) return;
    const sharedProps = { ...props, sensorType, selections, from, to };
    // El primer tipo actualiza ESTE bloque (el que ya está en el lienzo,
    // recién insertado desde la biblioteca); cada tipo adicional agrega un
    // bloque nuevo — mismo patrón que SensorInspector.applyToDocument.
    onUpdate({ props: { ...sharedProps, chartType: chartTypes[0] } });
    const addElement = useEditorStore.getState().addElement;
    for (let i = 1; i < chartTypes.length; i += 1) {
      addElement('sensor_multi_chart', { props: { ...sharedProps, chartType: chartTypes[i] } });
    }
  };

  const removeSelection = (sensorId: string) => {
    setSelections((prev) => prev.filter((s) => s.sensorId !== sensorId));
  };

  return (
    <div className="inspector-form">
      <span className="inspector-section-label" title="Gráfico ECharts unificado combinando varios sensores por zona, tipo y rango de fecha">
        <Radar size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
        Gráfico de sensores
      </span>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
        Elija primero el tipo de sensor, luego los sensores por zona o de forma individual, el tipo de gráfico y el
        rango de fecha/hora. El botón de abajo se habilita cuando todo esté completo.
      </p>

      {loadError ? <p style={{ fontSize: 12, color: '#b91c1c' }}>{loadError}</p> : null}

      {/* Paso 1: tipo de sensor (gate) */}
      <div className="input-group" title="Primer paso obligatorio: el resto del panel se habilita al elegir un tipo">
        <label>1. Tipo de sensor</label>
        <select
          className="input-premium"
          value={sensorType}
          onChange={(e) => handleSensorTypeChange(e.target.value)}
          disabled={loadingTypes}
        >
          <option value="">{loadingTypes ? 'Cargando…' : 'Seleccione un tipo de sensor'}</option>
          {sensorTypes.map((t) => (
            <option key={`${t.type}-${t.unit}`} value={t.type}>
              {t.type} {t.unit ? `(${t.unit})` : ''} — {t.count} sensor{t.count === 1 ? '' : 'es'}
            </option>
          ))}
        </select>
      </div>

      {/* Paso 2: selección por zona / dispositivo / unidad */}
      <div className="input-group" style={{ opacity: sensorType ? 1 : 0.5, pointerEvents: sensorType ? 'auto' : 'none' }}>
        <label>2. Sensores por zona</label>
        {loadingSensors ? (
          <p style={{ fontSize: 11, color: '#64748b' }}>Cargando sensores…</p>
        ) : (
          <ZoneSensorPicker sensors={sensorsForType} selections={selections} onChange={setSelections} />
        )}
      </div>

      {/* Paso 3: resumen */}
      {selections.length > 0 && (
        <div className="input-group">
          <label>3. Resumen de la selección</label>
          <p style={{ fontSize: 11, color: '#334155', margin: '0 0 6px' }}>
            {selections.length} sensor{selections.length === 1 ? '' : 'es'} · {zoneSummaryCount} zona
            {zoneSummaryCount === 1 ? '' : 's'} · unidades: {unitSummary.join(', ') || '—'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selections.map((s) => (
              <span
                key={s.sensorId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  background: '#eef2ff',
                  color: '#3730a3',
                  borderRadius: 999,
                  padding: '3px 8px',
                }}
              >
                {s.name || s.code}
                {s.unit ? ` (${s.unit})` : ''}
                <button
                  type="button"
                  onClick={() => removeSelection(s.sensorId)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#4338ca', padding: 0, display: 'flex' }}
                  title="Quitar de la selección"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Paso 4: tipo(s) de gráfico — vista reducida de los modelos Apache
         ECharts disponibles para esta serie de datos; marcar varios inserta
         un bloque por cada uno. Rotulado explícito con "Apache ECharts"
         porque no era evidente que estos checkboxes fueran justamente el
         selector de modelos de gráfico. */}
      <div className="input-group" style={{ opacity: selections.length > 0 ? 1 : 0.5, pointerEvents: selections.length > 0 ? 'auto' : 'none' }}>
        <label>4. Tipo de gráfico (Apache ECharts)</label>
        <p style={{ margin: '0 0 8px', fontSize: 10, color: '#94a3b8' }}>
          Marque uno o varios modelos — se inserta un gráfico por cada uno con los mismos sensores y rango.
        </p>
        <ChartTypePicker values={chartTypes} onChange={setChartTypes} disabled={selections.length === 0} />
      </div>

      {/* Paso 5: rango de fecha/hora */}
      <div className="input-group" style={{ opacity: selections.length > 0 ? 1 : 0.5, pointerEvents: selections.length > 0 ? 'auto' : 'none' }}>
        <label>5. Rango de fecha/hora</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 10, color: '#64748b' }}>Desde</span>
            <input
              type="datetime-local"
              className="input-premium"
              value={isoToLocalInput(from)}
              onChange={(e) => setFrom(localInputToIso(e.target.value))}
            />
          </div>
          <div>
            <span style={{ fontSize: 10, color: '#64748b' }}>Hasta</span>
            <input
              type="datetime-local"
              className="input-premium"
              value={isoToLocalInput(to)}
              onChange={(e) => setTo(localInputToIso(e.target.value))}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn-premium-outline" style={{ flex: 1, fontSize: 11 }} onClick={() => applyQuickRange(24)}>
            Últimas 24h
          </button>
          <button type="button" className="btn-premium-outline" style={{ flex: 1, fontSize: 11 }} onClick={() => applyQuickRange(24 * 7)}>
            Últimos 7 días
          </button>
          <button type="button" className="btn-premium-outline" style={{ flex: 1, fontSize: 11 }} onClick={() => applyQuickRange(24 * 30)}>
            Últimos 30 días
          </button>
        </div>
        {from && to && !validRange && (
          <p style={{ fontSize: 11, color: '#b91c1c', marginTop: 6 }}>La fecha "Desde" debe ser anterior a "Hasta".</p>
        )}
      </div>

      {/*
        NO usar position:sticky aquí: sin un espaciador reservando su altura,
        un botón sticky se monta ENCIMA de los últimos campos del paso 5
        (los botones "Últimos N días") y bloquea los clics sobre ellos —
        exactamente el bug reportado ("ya no puede editarse, está
        desactivado"): los campos no estaban deshabilitados, el botón los
        tapaba. Flujo normal, con margen arriba, como el resto de los
        inspectores (ver SensorInspector "Aplicar al documento").
      */}
      <button
        type="button"
        className="btn-premium-outline"
        style={{
          width: '100%',
          marginTop: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontWeight: 700,
          borderColor: canInsert ? '#6366f1' : undefined,
          background: canInsert ? '#eef2ff' : undefined,
        }}
        disabled={!canInsert}
        onClick={handleInsert}
        title={canInsert ? 'Insertar un gráfico por cada tipo marcado, con la configuración actual' : 'Complete los 5 pasos para habilitar la inserción'}
      >
        <RefreshCw size={14} />
        Insertar {chartTypes.length > 1 ? `${chartTypes.length} gráficos` : 'gráfico'} ({selections.length} sensor{selections.length === 1 ? '' : 'es'})
      </button>
    </div>
  );
}

export default memo(SensorMultiChartInspector);
