#include "formula_service.hpp"
#include "../config/app_config.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <initializer_list>
#include <mutex>
#include <string>
#include <vector>

using auth::pgExecOk;
using auth::trimCompanyName;
#define gFormulaSchemaReady   config::AppConfig::instance().gFormulaSchemaReady
#define gFormulaSchemaInitMutex config::AppConfig::instance().gFormulaSchemaInitMutex

namespace formula {

#if HAS_LIBPQ

bool ensureFormulaCatalogViewPg(PGconn *conn) {
  static const char *kDropCatalogView = "DROP VIEW IF EXISTS v_mineria_catalogos CASCADE;";
  static const char *kCreateCatalogView = R"SQL(
CREATE VIEW v_mineria_catalogos AS
SELECT
    e.id AS empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
    m.id AS mina_id, m.codigo AS mina_codigo, m.nombre AS mina_nombre, m.zona_tipo, m.umbral_temp_alerta,
    s.id AS sensor_id, s.codigo AS sensor_codigo, s.nombre AS sensor_nombre,
    v.id AS variable_id, v.codigo AS variable_codigo, v.nombre AS variable_nombre, v.unidad
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id AND m.activo = TRUE
JOIN mineria_variables v ON v.empresa_id = e.id AND v.activo = TRUE AND v.tipo = 'temperatura'
JOIN mineria_sensores s ON s.empresa_id = e.id AND s.mina_id = m.id AND s.variable_id = v.id AND s.activo = TRUE;
)SQL";
  (void)pgExecOk(conn, kDropCatalogView);
  return pgExecOk(conn, kCreateCatalogView);
}

bool ensureFormulaSchemaPg(PGconn *conn, const std::string &companyName) {
  if (!gFormulaSchemaReady.load(std::memory_order_acquire)) {
    std::lock_guard<std::mutex> lk(gFormulaSchemaInitMutex);
    if (!gFormulaSchemaReady.load(std::memory_order_relaxed)) {
      const char *sql = R"SQL(
CREATE TABLE IF NOT EXISTS mineria_empresas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(200) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mineria_minas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    zona_tipo VARCHAR(20) NOT NULL DEFAULT 'sierra',
    umbral_temp_alerta DECIMAL(6,2) NOT NULL DEFAULT 8.0,
    factor_ajuste DECIMAL(6,4) NOT NULL DEFAULT 0.82,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_variables (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(30) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    unidad VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'temperatura',
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_sensores (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_lecturas (
    id BIGSERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    timestamp_lectura TIMESTAMPTZ NOT NULL,
    valor DECIMAL(12,4),
    calidad SMALLINT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mlect_lookup ON mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura DESC);
CREATE OR REPLACE FUNCTION sp_proceso_temperatura(
    p_empresa_id   INTEGER,
    p_mina_id      INTEGER,
    p_variable_id  INTEGER,
    p_fecha_inicio TIMESTAMPTZ,
    p_fecha_fin    TIMESTAMPTZ
)
RETURNS TABLE (
    timestamp_lectura   TIMESTAMPTZ,
    valor_original      DECIMAL(12,4),
    calidad             SMALLINT,
    umbral_alerta       DECIMAL(6,2),
    condicion_resultado VARCHAR(2),
    valor_procesado     DECIMAL(12,4),
    descripcion         TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_umbral DECIMAL(6,2);
    v_factor DECIMAL(6,4);
BEGIN
    SELECT m.umbral_temp_alerta, m.factor_ajuste
    INTO   v_umbral, v_factor
    FROM   mineria_minas m
    WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina no encontrada para el tenant';
    END IF;

    RETURN QUERY
    SELECT
        l.timestamp_lectura,
        l.valor AS valor_original,
        l.calidad,
        v_umbral AS umbral_alerta,
        CASE WHEN l.valor > v_umbral THEN 'SI' ELSE 'NO' END::VARCHAR(2) AS condicion_resultado,
        CASE
            WHEN l.valor > v_umbral THEN ROUND(CAST(v_umbral + (l.valor - v_umbral) * v_factor AS NUMERIC), 4)
            ELSE ROUND(CAST(l.valor * 0.985 + 0.12 AS NUMERIC), 4)
        END AS valor_procesado,
        CASE
            WHEN l.valor > v_umbral THEN 'ALERTA: amortiguacion por umbral'
            ELSE 'NORMAL: calibracion lineal'
        END::TEXT AS descripcion
    FROM mineria_lecturas l
    WHERE l.empresa_id = p_empresa_id
      AND l.mina_id = p_mina_id
      AND l.variable_id = p_variable_id
      AND l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
      AND l.calidad >= 50
    ORDER BY l.timestamp_lectura;
END;
$$;
CREATE TABLE IF NOT EXISTS formula_sessions (
    id BIGSERIAL PRIMARY KEY,
    usuario_nombre VARCHAR(200),
    accion VARCHAR(20) DEFAULT 'VISUALIZO',
    empresa_id INTEGER,
    empresa_nombre VARCHAR(200),
    mina_id INTEGER,
    mina_nombre VARCHAR(200),
    variable_id INTEGER,
    variable_nombre VARCHAR(200),
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    formula_json JSONB,
    sp_sql_text TEXT,
    total_lecturas INTEGER,
    total_si INTEGER,
    total_no INTEGER,
    pct_alertas DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsess_empresa ON formula_sessions(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fsess_mina ON formula_sessions(mina_id);
CREATE INDEX IF NOT EXISTS idx_fsess_created ON formula_sessions(created_at DESC);
)SQL";

      if (!pgExecOk(conn, sql)) {
        return false;
      }
      gFormulaSchemaReady.store(true, std::memory_order_release);
    }
  }

  std::string trimmed = trimCompanyName(companyName);
  std::string normalized = trimmed.empty() ? "Empresa Minera" : trimmed;
  std::string code = normalized;
  for (char &ch : code) {
    if (!std::isalnum(static_cast<unsigned char>(ch))) ch = '_';
  }
  // Helper local: ejecuta un comando parametrizado (fire-and-forget) y
  // devuelve si terminó OK. Evita concatenar literales en los seeds.
  const auto execParams = [&](const char *sql,
                              std::initializer_list<const char *> vals) -> bool {
    std::vector<const char *> pv(vals);
    PGresult *r = PQexecParams(conn, sql, static_cast<int>(pv.size()), nullptr,
                               pv.data(), nullptr, nullptr, 0);
    const bool ok = r && (PQresultStatus(r) == PGRES_COMMAND_OK ||
                          PQresultStatus(r) == PGRES_TUPLES_OK);
    if (r) PQclear(r);
    return ok;
  };

  (void)execParams(
      "INSERT INTO mineria_empresas(codigo,nombre,activo) "
      "VALUES($1, $2, true) ON CONFLICT (nombre) DO NOTHING",
      {code.c_str(), normalized.c_str()});

  (void)execParams(
      "INSERT INTO mineria_minas(empresa_id,codigo,nombre,zona_tipo,"
      "umbral_temp_alerta,factor_ajuste,activo) "
      "SELECT id,'UNI-001','Unidad Minera Principal','sierra',8.0,0.82,true "
      "FROM mineria_empresas WHERE nombre=$1 "
      "ON CONFLICT (empresa_id,codigo) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      "INSERT INTO mineria_variables(empresa_id,codigo,nombre,unidad,tipo,"
      "activo) "
      "SELECT id,'TEMP-001','Temperatura Ambiente','C','temperatura',true "
      "FROM mineria_empresas WHERE nombre=$1 "
      "ON CONFLICT (empresa_id,codigo) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      "INSERT INTO mineria_sensores(empresa_id,mina_id,variable_id,codigo,"
      "nombre,activo) "
      "SELECT e.id,m.id,v.id,'SEN-001','Sensor Temperatura Principal',true "
      "FROM mineria_empresas e "
      "JOIN mineria_minas m ON m.empresa_id=e.id "
      "JOIN mineria_variables v ON v.empresa_id=e.id AND v.codigo='TEMP-001' "
      "WHERE e.nombre=$1 ON CONFLICT (empresa_id,codigo) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      R"SQL(
INSERT INTO mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad)
SELECT e.id, m.id, v.id, ts,
       ROUND(CAST(9.5 + 4.2 * SIN(EXTRACT(EPOCH FROM ts) / 86400.0 * 2 * PI()) + (random() * 2.5 - 1.2) AS NUMERIC), 2),
       100
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id
JOIN mineria_variables v ON v.empresa_id = e.id AND v.codigo = 'TEMP-001'
CROSS JOIN generate_series(NOW() - INTERVAL '30 days', NOW(), INTERVAL '30 minutes') ts
WHERE e.nombre = $1
  AND NOT EXISTS (
  SELECT 1 FROM mineria_lecturas l
  WHERE l.empresa_id = e.id AND l.mina_id = m.id AND l.variable_id = v.id
);
)SQL",
      {normalized.c_str()});

  // ADR-131: dual-write hacia el modelo consolidado, mismo patrón que
  // telemetry_ingest.cpp (upsert de dimensiones + INSERT en la hypertable
  // de hechos), acotado a la empresa recién sembrada. mineria_empresas no
  // trae tenant_id real en este flujo (se resuelve más tarde por
  // 28_mining_telemetry_uuid_tenant.sql o queda como placeholder solo con
  // legacy_mineria_empresa_id) -- dim_tenant lo soporta (CHECK exige al
  // menos uno de los dos, no ambos).
  (void)execParams(
      "INSERT INTO dim_tenant (legacy_mineria_empresa_id, display_name) "
      "SELECT e.id, e.nombre FROM mineria_empresas e WHERE e.nombre = $1 "
      "ON CONFLICT (legacy_mineria_empresa_id) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      "INSERT INTO dim_site (legacy_mineria_mina_id, tenant_id_sk, display_name) "
      "SELECT m.id, dt.tenant_id_sk, m.nombre "
      "FROM mineria_minas m JOIN mineria_empresas e ON e.id = m.empresa_id "
      "JOIN dim_tenant dt ON dt.legacy_mineria_empresa_id = e.id "
      "WHERE e.nombre = $1 "
      "ON CONFLICT (legacy_mineria_mina_id) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      "INSERT INTO dim_sensor (source_system, legacy_mineria_sensor_id, tenant_id_sk, "
      "site_id_sk, sensor_code, sensor_type, unit, is_active) "
      "SELECT 'formula', ms.id, dt.tenant_id_sk, dsi.site_id_sk, ms.codigo, v.tipo, v.unidad, ms.activo "
      "FROM mineria_sensores ms "
      "JOIN mineria_empresas e ON e.id = ms.empresa_id "
      "JOIN mineria_variables v ON v.id = ms.variable_id "
      "JOIN dim_tenant dt ON dt.legacy_mineria_empresa_id = e.id "
      "LEFT JOIN dim_site dsi ON dsi.legacy_mineria_mina_id = ms.mina_id "
      "WHERE e.nombre = $1 "
      "ON CONFLICT (legacy_mineria_sensor_id) DO NOTHING",
      {normalized.c_str()});

  (void)execParams(
      R"SQL(
INSERT INTO telemetry_fact_formula (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code)
SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, l.timestamp_lectura, l.valor::real, l.calidad
FROM mineria_lecturas l
JOIN mineria_sensores ms ON ms.empresa_id = l.empresa_id AND ms.mina_id = l.mina_id AND ms.variable_id = l.variable_id
JOIN mineria_empresas e ON e.id = l.empresa_id
JOIN dim_sensor ds ON ds.legacy_mineria_sensor_id = ms.id
WHERE e.nombre = $1
ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;
)SQL",
      {normalized.c_str()});

  if (!ensureFormulaCatalogViewPg(conn)) {
    return false;
  }
  return true;
}

#endif // HAS_LIBPQ

} // namespace formula
