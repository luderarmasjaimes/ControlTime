/**
 * Servicio de Interoperabilidad Geoespacial con GEOCATMIN — INGEMMET
 *
 * Consultas REST ArcGIS Server, motor de pre-evaluación catastral, conversión
 * geodésica y detección de superposiciones.
 * Conforme a SPEC-024 y ADR-123.
 */

import { log } from './logger';

export interface ConcessionFeature {
  id: string | number;
  codigo: string;
  nombre: string;
  titular: string;
  estado: string; // 'TITULADO' | 'EN TRAMITE' | 'EXTINGUIDO' | 'OTROS'
  sustancia?: string;
  hectareas?: number;
  fechaIngreso?: string;
  hojaIgn?: string;
  zonaUtm?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  geometry?: {
    type: 'Polygon' | 'MultiPolygon' | 'Point';
    coordinates: any;
  };
  attributes?: Record<string, any>;
}

export interface IdentifyResult {
  layerName: string;
  featureName: string;
  attributes: Record<string, any>;
}

export interface OverlapEvaluation {
  hasCollisions: boolean;
  totalConcessions: number;
  totalRestrictedAreas: number;
  concessions: ConcessionFeature[];
  restrictedAreas: {
    nombre: string;
    tipo: string;
    entidad: string;
  }[];
  summary: string;
}

/**
 * Consulta de derechos mineros por nombre, código único o titular en INGEMMET
 */
export async function queryIngemmetConcessions(
  queryText: string,
  limit = 25
): Promise<ConcessionFeature[]> {
  if (!queryText || queryText.trim().length < 2) return [];

  const clean = queryText.trim().toUpperCase().replace(/'/g, "''");
  const whereClause = `upper(CONCESION) LIKE '%${clean}%' OR upper(CODIGOU) LIKE '%${clean}%' OR upper(TITULAR) LIKE '%${clean}%'`;
  const url = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer/0/query?where=${encodeURIComponent(
    whereClause
  )}&outFields=OBJECTID,CODIGOU,CONCESION,TITULAR,ESTADO,SUSTANCIA,HECTAREAS,FEC_DENU,HOJA,ZONA,DPTO,PROV,DIST&returnGeometry=true&outSR=4326&f=json&resultRecordCount=${limit}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();

    if (!data.features || !Array.isArray(data.features)) {
      log.warn('[GeocatminService] No features returned or query error:', data.error);
      return [];
    }

    return data.features.map((f: any) => {
      const a = f.attributes || {};
      let geom: any = undefined;

      if (f.geometry && f.geometry.rings) {
        geom = {
          type: 'Polygon',
          // ArcGIS rings are [ [ [lng, lat], ... ] ]
          coordinates: f.geometry.rings,
        };
      }

      return {
        id: a.OBJECTID || a.CODIGOU,
        codigo: a.CODIGOU || 'S/C',
        nombre: a.CONCESION || 'SIN NOMBRE',
        titular: a.TITULAR || 'NO ESPECIFICADO',
        estado: (a.ESTADO || 'EN TRAMITE').toUpperCase(),
        sustancia: a.SUSTANCIA || 'METÁLICA',
        hectareas: a.HECTAREAS ? parseFloat(a.HECTAREAS) : undefined,
        fechaIngreso: a.FEC_DENU || undefined,
        hojaIgn: a.HOJA || undefined,
        zonaUtm: a.ZONA ? `${a.ZONA}S` : undefined,
        departamento: a.DPTO,
        provincia: a.PROV,
        distrito: a.DIST,
        geometry: geom,
        attributes: a,
      };
    });
  } catch (err) {
    log.warn('[GeocatminService] Concession search failed:', err);
    return [];
  }
}

/**
 * Consulta de atributos al clic sobre el mapa (Identify)
 */
export async function identifyPoint(
  lat: number,
  lng: number
): Promise<IdentifyResult[]> {
  const delta = 0.005;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;

  const results: IdentifyResult[] = [];

  // 1. Identificar en Catastro Minero
  try {
    const url = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer/identify?geometryType=esriGeometryPoint&geometry=${lng},${lat}&sr=4326&layers=all:0&tolerance=5&mapExtent=${bbox}&imageDisplay=800,600,96&returnGeometry=false&f=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      if (data.results && Array.isArray(data.results)) {
        for (const item of data.results) {
          const a = item.attributes || {};
          results.push({
            layerName: 'Catastro Minero INGEMMET',
            featureName: a.CONCESION || a.CODIGOU || 'Derecho Minero',
            attributes: {
              'Código Único': a.CODIGOU,
              'Concesión': a.CONCESION,
              'Titular Actual': a.TITULAR,
              'Estado Legal': a.ESTADO,
              'Sustancia': a.SUSTANCIA,
              'Área (Ha)': a.HECTAREAS,
              'Hoja IGN': a.HOJA,
              'Zona UTM': a.ZONA,
              'Ubicación Política': `${a.DIST || ''}, ${a.PROV || ''} (${a.DPTO || ''})`,
            },
          });
        }
      }
    }
  } catch (e) {
    log.warn('[GeocatminService] Identify catastro failed:', e);
  }

  // 2. Identificar en Geología 100k
  try {
    const geoUrl = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_GEOLOGIA_100K_INTEGRADA/MapServer/identify?geometryType=esriGeometryPoint&geometry=${lng},${lat}&sr=4326&layers=top&tolerance=5&mapExtent=${bbox}&imageDisplay=800,600,96&returnGeometry=false&f=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.results && Array.isArray(geoData.results)) {
        for (const item of geoData.results) {
          const a = item.attributes || {};
          results.push({
            layerName: 'Geología 1:100,000',
            featureName: a.UNIDAD || a.FORMACION || a.ROCA || 'Unidad Geológica',
            attributes: {
              'Unidad': a.UNIDAD || a.COD_UNIDAD,
              'Formación / Grupo': a.FORMACION || a.GRUPO,
              'Litología': a.LITOLOGIA || a.ROCA,
              'Edad Geológica': a.EDAD,
              'Cuadrángulo': a.CUADRANGULO,
            },
          });
        }
      }
    }
  } catch (e) {
    log.warn('[GeocatminService] Identify geology failed:', e);
  }

  // 3. Identificar en Áreas Reservadas / ANP
  try {
    const anpUrl = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_AREA_RESERVADA/MapServer/identify?geometryType=esriGeometryPoint&geometry=${lng},${lat}&sr=4326&layers=top&tolerance=5&mapExtent=${bbox}&imageDisplay=800,600,96&returnGeometry=false&f=json`;
    const anpRes = await fetch(anpUrl, { signal: AbortSignal.timeout(8000) });
    if (anpRes.ok) {
      const anpData = await anpRes.json();
      if (anpData.results && Array.isArray(anpData.results)) {
        for (const item of anpData.results) {
          const a = item.attributes || {};
          results.push({
            layerName: 'Restricción Territorial / ANP',
            featureName: a.NOMBRE || a.AREA_NOMBRE || 'Zona Reservada',
            attributes: {
              'Nombre del Área': a.NOMBRE || a.AREA_NOMBRE,
              'Categoría': a.CATEGORIA || a.TIPO,
              'Entidad Administradora': a.ENTIDAD || a.SECTOR,
              'Norma Legal': a.NORMA_LEGAL || a.BASE_LEGAL,
            },
          });
        }
      }
    }
  } catch (e) {
    log.warn('[GeocatminService] Identify ANP failed:', e);
  }

  return results;
}

/**
 * Pre-evaluación de superposiciones para un punto o polígono dado
 */
export async function evaluateSpatialOverlap(
  lat: number,
  lng: number,
  radiusKm = 2.0
): Promise<OverlapEvaluation> {
  const kmToDeg = 1 / 111.32;
  const delta = radiusKm * kmToDeg;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;

  const concessionsUrl = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer/0/query?geometryType=esriGeometryEnvelope&geometry=${bbox}&inSR=4326&outFields=OBJECTID,CODIGOU,CONCESION,TITULAR,ESTADO,HECTAREAS,ZONA&returnGeometry=true&outSR=4326&f=json&resultRecordCount=50`;

  let concessions: ConcessionFeature[] = [];
  try {
    const res = await fetch(concessionsUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (data.features) {
        concessions = data.features.map((f: any) => ({
          id: f.attributes.OBJECTID || f.attributes.CODIGOU,
          codigo: f.attributes.CODIGOU,
          nombre: f.attributes.CONCESION,
          titular: f.attributes.TITULAR,
          estado: (f.attributes.ESTADO || 'EN TRAMITE').toUpperCase(),
          hectareas: f.attributes.HECTAREAS ? parseFloat(f.attributes.HECTAREAS) : 0,
          zonaUtm: f.attributes.ZONA ? `${f.attributes.ZONA}S` : '',
          geometry: f.geometry?.rings ? { type: 'Polygon', coordinates: f.geometry.rings } : undefined,
          attributes: f.attributes,
        }));
      }
    }
  } catch (e) {
    log.warn('[GeocatminService] Overlap evaluation concessions query failed:', e);
  }

  const restrictedAreas: { nombre: string; tipo: string; entidad: string }[] = [];
  try {
    const anpUrl = `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_AREA_RESERVADA/MapServer/0/query?geometryType=esriGeometryEnvelope&geometry=${bbox}&inSR=4326&outFields=NOMBRE,CATEGORIA,ENTIDAD&returnGeometry=false&f=json`;
    const anpRes = await fetch(anpUrl, { signal: AbortSignal.timeout(10000) });
    if (anpRes.ok) {
      const anpData = await anpRes.json();
      if (anpData.features) {
        for (const f of anpData.features) {
          restrictedAreas.push({
            nombre: f.attributes.NOMBRE || 'Área Restringida',
            tipo: f.attributes.CATEGORIA || 'Zona Protegida',
            entidad: f.attributes.ENTIDAD || 'SERNANP / MINCUL',
          });
        }
      }
    }
  } catch (e) {
    log.warn('[GeocatminService] Overlap evaluation ANP query failed:', e);
  }

  const hasCollisions = concessions.length > 0 || restrictedAreas.length > 0;
  const summary = hasCollisions
    ? `Se detectaron ${concessions.length} derechos mineros colindantes y ${restrictedAreas.length} áreas con restricciones en un radio de ${radiusKm} km.`
    : `Zona libre de superposiciones inmediatas en el radio evaluado (${radiusKm} km).`;

  return {
    hasCollisions,
    totalConcessions: concessions.length,
    totalRestrictedAreas: restrictedAreas.length,
    concessions,
    restrictedAreas,
    summary,
  };
}

/**
 * Conversión de coordenadas Geográficas WGS84 ↔ Proyectadas UTM (Zonas 17S, 18S, 19S)
 */
export function convertWgs84ToUtm(
  lat: number,
  lng: number,
  zoneOverride?: number
): { easting: number; northing: number; zone: number; hemisphere: 'S' } {
  // Determinación de zona UTM en Perú (usualmente 17, 18 o 19)
  const zone = zoneOverride || Math.floor((lng + 180) / 6) + 1;
  const a = 6378137.0; // Semieje mayor WGS84
  const f = 1 / 298.257223563; // Aplanamiento
  const k0 = 0.9996; // Factor de escala meridiano central
  const e = Math.sqrt(2 * f - f * f);
  const ePrimeSq = (e * e) / (1 - e * e);

  const radLat = (lat * Math.PI) / 180;
  const radLng = (lng * Math.PI) / 180;
  const centralLng = (zone * 6 - 183) * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e * e * Math.sin(radLat) * Math.sin(radLat));
  const T = Math.tan(radLat) * Math.tan(radLat);
  const C = ePrimeSq * Math.cos(radLat) * Math.cos(radLat);
  const A = Math.cos(radLat) * (radLng - centralLng);

  const M =
    a *
    ((1 - (e * e) / 4 - (3 * Math.pow(e, 4)) / 64 - (5 * Math.pow(e, 6)) / 256) * radLat -
      ((3 * e * e) / 8 + (3 * Math.pow(e, 4)) / 32 + (45 * Math.pow(e, 6)) / 1024) * Math.sin(2 * radLat) +
      ((15 * Math.pow(e, 4)) / 256 + (45 * Math.pow(e, 6)) / 1024) * Math.sin(4 * radLat) -
      ((35 * Math.pow(e, 6)) / 3072) * Math.sin(6 * radLat));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ePrimeSq) * Math.pow(A, 5)) / 120) +
    500000.0;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(radLat) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ePrimeSq) * Math.pow(A, 6)) / 720));

  if (lat < 0) {
    northing += 10000000.0; // Falso Norte hemisferio sur
  }

  return {
    easting: Math.round(easting * 100) / 100,
    northing: Math.round(northing * 100) / 100,
    zone,
    hemisphere: 'S',
  };
}

/**
 * Conversión inversa: UTM Zona Sur (17S, 18S, 19S) WGS84 ↔ Geográficas Lat/Lng
 */
export function convertUtmToWgs84(
  easting: number,
  northing: number,
  zone: number
): { lat: number; lng: number } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e = Math.sqrt(2 * f - f * f);
  const ePrimeSq = (e * e) / (1 - e * e);
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const x = easting - 500000.0;
  const y = northing - 10000000.0; // Ajuste hemisferio sur

  const M = y / k0;
  const mu =
    M /
    (a *
      (1 -
        (e * e) / 4 -
        (3 * Math.pow(e, 4)) / 64 -
        (5 * Math.pow(e, 6)) / 256));

  const phi1Rad =
    mu +
    ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    ((21 * Math.pow(e1, 2)) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu);

  const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1Rad) * Math.sin(phi1Rad));
  const T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
  const C1 = ePrimeSq * Math.cos(phi1Rad) * Math.cos(phi1Rad);
  const R1 = (a * (1 - e * e)) / Math.pow(1 - e * e * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
  const D = x / (N1 * k0);

  const latRad =
    phi1Rad -
    ((N1 * Math.tan(phi1Rad)) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ePrimeSq) * Math.pow(D, 4)) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ePrimeSq - 3 * C1 * C1) *
          Math.pow(D, 6)) /
          720);

  const centralLngRad = ((zone * 6 - 183) * Math.PI) / 180;
  const lngRad =
    centralLngRad +
    (D -
      ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ePrimeSq + 24 * T1 * T1) * Math.pow(D, 5)) / 120) /
      Math.cos(phi1Rad);

  return {
    lat: Math.round(((latRad * 180) / Math.PI) * 1000000) / 1000000,
    lng: Math.round(((lngRad * 180) / Math.PI) * 1000000) / 1000000,
  };
}
