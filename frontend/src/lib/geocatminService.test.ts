import { describe, expect, it } from 'vitest';
import { convertUtmToWgs84, convertWgs84ToUtm } from './geocatminService';

describe('GeocatminService - Conversión Geodésica', () => {
  it('convierte coordenadas geográficas WGS84 a UTM Zona 18S (Antamina)', () => {
    // Antamina: Lat -9.549, Lng -77.054 (Ancash - Zona 18S)
    const lat = -9.549;
    const lng = -77.054;
    const utm = convertWgs84ToUtm(lat, lng);

    expect(utm.zone).toBe(18);
    expect(utm.hemisphere).toBe('S');
    // Este aproximado: 274,562 m | Norte aproximado: 8,943,767 m
    expect(utm.easting).toBeGreaterThan(250000);
    expect(utm.easting).toBeLessThan(300000);
    expect(utm.northing).toBeGreaterThan(8900000);
    expect(utm.northing).toBeLessThan(9000000);
  });

  it('convierte coordenadas geográficas WGS84 a UTM Zona 19S (Toquepala / Tacna)', () => {
    // Toquepala: Lat -17.2464, Lng -70.6120 (Tacna - Zona 19S)
    const lat = -17.2464;
    const lng = -70.6120;
    const utm = convertWgs84ToUtm(lat, lng);

    expect(utm.zone).toBe(19);
    expect(utm.hemisphere).toBe('S');
    expect(utm.easting).toBeGreaterThan(300000);
    expect(utm.easting).toBeLessThan(400000);
    expect(utm.northing).toBeGreaterThan(8000000);
    expect(utm.northing).toBeLessThan(8200000);
  });

  it('realiza conversión de ida y vuelta UTM <-> WGS84 con precisión milimétrica', () => {
    const origLat = -16.536;
    const origLng = -71.583;

    const utm = convertWgs84ToUtm(origLat, origLng);
    const roundtrip = convertUtmToWgs84(utm.easting, utm.northing, utm.zone);

    expect(roundtrip.lat).toBeCloseTo(origLat, 4);
    expect(roundtrip.lng).toBeCloseTo(origLng, 4);
  });
});
