-- Marcadores de mapa operativo + columna temporal para filtros en frontend.
-- Usado por /api/map/markers y /api/map/compliance-intersections (cruce con GeoJSON oficial en /data).

CREATE TABLE IF NOT EXISTS map_markers (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  name VARCHAR(200),
  status VARCHAR(40),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE map_markers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

INSERT INTO map_markers (type, lat, lng, name, status)
SELECT v.type, v.lat, v.lng, v.name, v.status
FROM (
  VALUES
    ('sensor'::varchar, -17.245::double precision, -70.61::double precision, 'Sensor geotécnico A'::varchar, 'warning'::varchar),
    ('equipment'::varchar, -17.2462::double precision, -70.6115::double precision, 'Camión 12'::varchar, 'online'::varchar),
    ('personnel'::varchar, -17.259::double precision, -70.625::double precision, 'Cuadrilla norte'::varchar, 'online'::varchar)
) AS v(type, lat, lng, name, status)
WHERE NOT EXISTS (SELECT 1 FROM map_markers m WHERE m.name = v.name);
