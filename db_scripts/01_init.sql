-- Initial Database Schema for Mining Reports System
-- Requires PostGIS extension

DO $$
BEGIN
    BEGIN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis';
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'postgis not available or failed to install: %', SQLERRM;
    END;
END$$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table for storing mining projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing technical reports associated with a project
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content_json JSONB NOT NULL DEFAULT '{}', -- Rich text editor content (TipTap/Slate)
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing geometric/3D data associated with reports (e.g. Drillholes/Trajectories)
-- PostGIS used for geospatial location (Point, LineString) if needed
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        EXECUTE '
            CREATE TABLE IF NOT EXISTS geometric_data (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
                name VARCHAR(255),
                data_type VARCHAR(50) NOT NULL, -- ''drillhole'', ''gallery'', ''pointcloud''
                location GEOMETRY(POINT, 4326),  -- Optional geographic coordinates
                binary_data_url TEXT, -- Path to .glTF or binary array buffer on disk/S3
                metadata JSONB DEFAULT ''{}'',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        ';
    ELSE
        RAISE NOTICE 'Skipping geometric_data table creation because postgis is not available.';
    END IF;
END$$;

-- trigger for updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_modtime BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_reports_modtime BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_modified_column();
