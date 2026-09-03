import React, { memo, useMemo, useRef, useEffect } from 'react';

export interface WizardCatalogSensor {
  id: string;
  code: string;
  name: string;
  type: string;
  unit: string;
  zone_id?: number | null;
  zone_code?: string;
  zone_name?: string;
  device_key: string;
  connection_status?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface WizardCatalogZone {
  id: number;
  code: string;
  name_es: string;
  sort_order: number;
}

export interface SensorSelection {
  sensorId: string;
  code: string;
  name: string;
  unit: string;
  deviceKey: string;
  zoneId: number | null;
  zoneName: string;
  lat?: number | null;
  lng?: number | null;
}

interface TriStateCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  title?: string;
}

function TriStateCheckbox({ checked, indeterminate, onChange, title }: TriStateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} title={title} />;
}

interface DeviceGroup {
  deviceKey: string;
  label: string;
  sensors: WizardCatalogSensor[];
}

interface ZoneGroup {
  zoneId: number | null;
  label: string;
  devices: DeviceGroup[];
  sensorCount: number;
}

function buildGroups(sensors: WizardCatalogSensor[]): ZoneGroup[] {
  const zoneMap = new Map<string, ZoneGroup>();
  for (const s of sensors) {
    const zoneKey = s.zone_id != null ? String(s.zone_id) : 'null';
    let zone = zoneMap.get(zoneKey);
    if (!zone) {
      zone = {
        zoneId: s.zone_id ?? null,
        label: s.zone_name || 'Sin zona asignada',
        devices: [],
        sensorCount: 0,
      };
      zoneMap.set(zoneKey, zone);
    }
    zone.sensorCount += 1;
    let device = zone.devices.find((d) => d.deviceKey === s.device_key);
    if (!device) {
      device = { deviceKey: s.device_key, label: s.name || s.code, sensors: [] };
      zone.devices.push(device);
    }
    device.sensors.push(s);
  }
  return [...zoneMap.values()].sort((a, b) => a.label.localeCompare(b.label));
}

interface ZoneSensorPickerProps {
  sensors: WizardCatalogSensor[];
  selections: SensorSelection[];
  onChange: (next: SensorSelection[]) => void;
}

function ZoneSensorPicker({ sensors, selections, onChange }: ZoneSensorPickerProps) {
  const groups = useMemo(() => buildGroups(sensors), [sensors]);
  const selectedIds = useMemo(() => new Set(selections.map((s) => s.sensorId)), [selections]);

  const toSelection = (s: WizardCatalogSensor): SensorSelection => ({
    sensorId: s.id,
    code: s.code,
    name: s.name,
    unit: s.unit,
    deviceKey: s.device_key,
    zoneId: s.zone_id ?? null,
    zoneName: s.zone_name || 'Sin zona asignada',
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  });

  const toggleSensor = (s: WizardCatalogSensor) => {
    if (selectedIds.has(s.id)) {
      onChange(selections.filter((sel) => sel.sensorId !== s.id));
    } else {
      onChange([...selections, toSelection(s)]);
    }
  };

  const toggleMany = (rows: WizardCatalogSensor[], allSelected: boolean) => {
    if (allSelected) {
      const ids = new Set(rows.map((r) => r.id));
      onChange(selections.filter((sel) => !ids.has(sel.sensorId)));
    } else {
      const next = [...selections];
      const have = new Set(next.map((s) => s.sensorId));
      for (const r of rows) {
        if (!have.has(r.id)) {
          next.push(toSelection(r));
          have.add(r.id);
        }
      }
      onChange(next);
    }
  };

  if (sensors.length === 0) {
    return (
      <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0' }}>
        Sin sensores de este tipo en el catálogo.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {groups.map((zone) => {
        const zoneRows = zone.devices.flatMap((d) => d.sensors);
        const zoneSelectedCount = zoneRows.filter((r) => selectedIds.has(r.id)).length;
        const zoneAllSelected = zoneSelectedCount === zoneRows.length;
        return (
          <details key={String(zone.zoneId)} open className="wizard-zone-group">
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: zoneSelectedCount > 0 ? '#eef2ff' : '#f8fafc',
                border: '1px solid var(--border, #e2e8f0)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                color: '#0f172a',
                listStyle: 'none',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <TriStateCheckbox
                checked={zoneAllSelected}
                indeterminate={zoneSelectedCount > 0 && !zoneAllSelected}
                onChange={() => toggleMany(zoneRows, zoneAllSelected)}
                title="Seleccionar toda la zona"
              />
              <span style={{ flex: 1 }}>{zone.label}</span>
              <span style={{ fontWeight: 400, color: '#64748b' }}>
                {zoneSelectedCount}/{zoneRows.length}
              </span>
            </summary>
            <div style={{ padding: '6px 4px 4px 26px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {zone.devices.map((device) => {
                if (device.sensors.length === 1) {
                  const s = device.sensors[0];
                  const rowActive = selectedIds.has(s.id);
                  return (
                    <label
                      key={device.deviceKey}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 11,
                        color: '#1e293b',
                        cursor: 'pointer',
                        background: rowActive ? '#eef2ff' : '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: '4px 8px',
                      }}
                    >
                      <input type="checkbox" checked={rowActive} onChange={() => toggleSensor(s)} />
                      <span style={{ flex: 1 }}>{s.name || s.code}</span>
                      <span style={{ color: '#64748b' }}>{s.unit || '—'}</span>
                    </label>
                  );
                }
                const deviceSelectedCount = device.sensors.filter((r) => selectedIds.has(r.id)).length;
                const deviceAllSelected = deviceSelectedCount === device.sensors.length;
                return (
                  <div
                    key={device.deviceKey}
                    style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px' }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: '#1e293b', cursor: 'pointer' }}>
                      <TriStateCheckbox
                        checked={deviceAllSelected}
                        indeterminate={deviceSelectedCount > 0 && !deviceAllSelected}
                        onChange={() => toggleMany(device.sensors, deviceAllSelected)}
                        title="Seleccionar todas las unidades de este dispositivo"
                      />
                      <span>{device.label}</span>
                      <span style={{ fontWeight: 400, color: '#94a3b8' }}>({device.sensors.length} unidades)</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 24 }}>
                      {device.sensors.map((s) => {
                        const unitActive = selectedIds.has(s.id);
                        return (
                          <label
                            key={s.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: 11,
                              color: '#334155',
                              cursor: 'pointer',
                              background: unitActive ? '#eef2ff' : '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: 4,
                              padding: '2px 6px',
                            }}
                          >
                            <input type="checkbox" checked={unitActive} onChange={() => toggleSensor(s)} />
                            <span style={{ flex: 1 }}>{s.type}</span>
                            <span style={{ color: '#64748b' }}>{s.unit || '—'}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default memo(ZoneSensorPicker);
