-- Seed data for Sensor3D Demonstration
INSERT INTO projects (name, description) VALUES 
('Mina Raura - Zona Norte', 'Proyecto de demostración geomecánica avanzada'),
('Unidad Minera Pallca', 'Análisis de estabilidad de taludes y galerías')
ON CONFLICT DO NOTHING;

-- Get the ID of the first project
DO $$
DECLARE
    proj_id UUID;
    rep_id UUID;
BEGIN
    SELECT id INTO proj_id FROM projects LIMIT 1;

    INSERT INTO reports (project_id, title, content_json, status) VALUES 
    (proj_id, 'Informe de Estabilidad Crucero 340-N', '{"ops":[{"insert":"Informe de demostración generado automáticamente.\\n"}]}', 'published')
    RETURNING id INTO rep_id;

    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'geometric_data') THEN
        INSERT INTO geometric_data (report_id, name, data_type, binary_data_url, metadata) VALUES 
        (rep_id, 'Testigo Perforación T-45', 'drillhole', '/data/demo/drillhole_demo.glb', '{"azimuth": 45, "installation_angle": 55, "rqd": 82.4}'),
        (rep_id, 'Video Análisis Fracturas', 'video_stream', '/data/demo/fracture_analysis.mp4', '{"fps": 60, "resolution": "1080p"}');
    ELSE
        RAISE NOTICE 'Skipping geometric_data seed: table not present (PostGIS may be missing).';
    END IF;
END $$;
