-- =============================================================================
-- 02_multitenant_scope_registry.sql  (base de datos FORMULA / formula_db)
-- Registro de alcance por diagram_id: referencias lógicas a sensors_db sin FK
-- entre contenedores. Ejecutar en la misma instancia que blocks/connections.
-- =============================================================================

CREATE TABLE IF NOT EXISTS formula_diagram_scope (
    diagram_id TEXT PRIMARY KEY,
    sensors_tenant_id UUID,
    empresa_id INTEGER,
    mina_id INTEGER,
    primary_country_iso2 CHAR(2),
    default_locale TEXT DEFAULT 'es-419',
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_formula_scope_tenant ON formula_diagram_scope (sensors_tenant_id);
CREATE INDEX IF NOT EXISTS idx_formula_scope_emp_mina ON formula_diagram_scope (empresa_id, mina_id);

COMMENT ON TABLE formula_diagram_scope IS
    'Mapea diagram_id (p. ej. emp1_mina2) a claves de negocio y tenant UUID en sensors_db; sin FK cruzada.';

CREATE OR REPLACE FUNCTION update_formula_scope_modtime()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_formula_diagram_scope_modtime ON formula_diagram_scope;
CREATE TRIGGER trg_formula_diagram_scope_modtime
    BEFORE UPDATE ON formula_diagram_scope
    FOR EACH ROW EXECUTE FUNCTION update_formula_scope_modtime();
