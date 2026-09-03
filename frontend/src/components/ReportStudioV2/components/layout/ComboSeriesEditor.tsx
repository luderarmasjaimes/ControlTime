import React, { memo } from 'react';
import type { SensorSelection } from './ZoneSensorPicker';

export interface ComboSeriesEntry {
  type: 'line' | 'bar';
  secondaryAxis: boolean;
}

export type ComboSeriesConfig = Record<string, ComboSeriesEntry>;

export function comboEntryFor(config: ComboSeriesConfig, sensorId: string): ComboSeriesEntry {
  return config[sensorId] || { type: 'line', secondaryAxis: false };
}

interface ComboSeriesEditorProps {
  selections: SensorSelection[];
  config: ComboSeriesConfig;
  onChange: (next: ComboSeriesConfig) => void;
}

/**
 * Réplica del diálogo "Insertar gráfico > Combinado > Combinación
 * personalizada" de Word/Excel: una fila por serie (sensor) con su propio
 * tipo de trazo (línea/barra) y un checkbox de eje secundario. A diferencia
 * de Word (series arbitrarias sin relación entre sí), acá todas las series
 * comparten la misma unidad física -- el eje secundario sigue siendo útil
 * cuando un sensor tiene una magnitud muy distinta al resto del mismo tipo
 * (p. ej. un extensómetro con lecturas ~10x mayores que sus pares).
 */
function ComboSeriesEditor({ selections, config, onChange }: ComboSeriesEditorProps) {
  const setEntry = (sensorId: string, patch: Partial<ComboSeriesEntry>) => {
    const current = comboEntryFor(config, sensorId);
    onChange({ ...config, [sensorId]: { ...current, ...patch } });
  };

  if (selections.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 8,
          padding: '6px 10px',
          background: '#f1f5f9',
          fontSize: 9,
          fontWeight: 700,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        <span>Sensor (serie)</span>
        <span>Tipo</span>
        <span>2.º eje</span>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {selections.map((sel, i) => {
          const entry = comboEntryFor(config, sel.sensorId);
          return (
            <div
              key={sel.sensorId}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 8,
                alignItems: 'center',
                padding: '6px 10px',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <span
                style={{ fontSize: 11, color: '#334155', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={sel.name || sel.code}
              >
                {sel.name || sel.code}
              </span>
              <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                <button
                  type="button"
                  onClick={() => setEntry(sel.sensorId, { type: 'line' })}
                  title="Trazar como línea"
                  style={{
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: entry.type === 'line' ? '#6366f1' : '#f8fafc',
                    color: entry.type === 'line' ? '#fff' : '#475569',
                  }}
                >
                  Línea
                </button>
                <button
                  type="button"
                  onClick={() => setEntry(sel.sensorId, { type: 'bar' })}
                  title="Trazar como barra"
                  style={{
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    border: 'none',
                    borderLeft: '1px solid #cbd5e1',
                    cursor: 'pointer',
                    background: entry.type === 'bar' ? '#6366f1' : '#f8fafc',
                    color: entry.type === 'bar' ? '#fff' : '#475569',
                  }}
                >
                  Barra
                </button>
              </div>
              <input
                type="checkbox"
                checked={entry.secondaryAxis}
                onChange={(e) => setEntry(sel.sensorId, { secondaryAxis: e.target.checked })}
                title={`Mostrar "${sel.name || sel.code}" en el eje Y secundario (derecha)`}
                style={{ margin: 0, justifySelf: 'center' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ComboSeriesEditor);
