import { describe, it, expect } from 'vitest';
import { officialGeoStyle, officialZoneIdOf } from './MapViewer';

/**
 * SPEC-009 T11 (check-point → highlight de zona, cierre 2026-09-12): cubre
 * solo la lógica pura de resaltado (sin montar Leaflet/mapa real, que
 * requiere DOM/canvas no disponible en este entorno de test). Verifica que
 * una zona con al menos un marcador real adentro (según
 * `/api/map/compliance-intersections`) recibe un estilo visualmente
 * distinto al de una zona sin marcadores.
 */
describe('officialZoneIdOf', () => {
  it('usa properties.id cuando existe', () => {
    expect(officialZoneIdOf({ properties: { id: 'zona-1', zone_id: 'otro' } })).toBe('zona-1');
  });

  it('cae a properties.zone_id si no hay id', () => {
    expect(officialZoneIdOf({ properties: { zone_id: 'zona-2' } })).toBe('zona-2');
  });

  it('devuelve null si no hay ningún identificador', () => {
    expect(officialZoneIdOf({ properties: {} })).toBeNull();
    expect(officialZoneIdOf({})).toBeNull();
  });
});

describe('officialGeoStyle — highlight de zona activa', () => {
  const zonaConMarcador = { properties: { id: 'zona-alpha', severity: 'high' } };
  const zonaSinMarcador = { properties: { id: 'zona-beta', severity: 'high' } };

  it('resalta (borde más grueso, más relleno) la zona con un marcador real adentro', () => {
    const activeZoneIds = new Set(['zona-alpha']);
    const activo = officialGeoStyle(zonaConMarcador, activeZoneIds);
    const inactivo = officialGeoStyle(zonaSinMarcador, activeZoneIds);

    expect(activo.weight).toBeGreaterThan(inactivo.weight);
    expect(activo.fillOpacity).toBeGreaterThan(inactivo.fillOpacity);
  });

  it('sin activeZoneIds (aún sin cargar compliance) ninguna zona se resalta', () => {
    const sinDatos = officialGeoStyle(zonaConMarcador, undefined);
    const base = officialGeoStyle(zonaConMarcador, new Set());
    expect(sinDatos).toEqual(base);
  });

  it('conserva el color por severidad independientemente del highlight', () => {
    const alta = officialGeoStyle({ properties: { id: 'z1', severity: 'high' } }, new Set(['z1']));
    const baja = officialGeoStyle({ properties: { id: 'z2', severity: 'low' } }, new Set(['z2']));
    expect(alta.color).toBe('#f87171');
    expect(baja.color).toBe('#4ade80');
  });
});
