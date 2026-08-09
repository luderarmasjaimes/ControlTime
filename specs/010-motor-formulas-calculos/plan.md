# PLAN 010 — Motor de fórmulas y cálculos de sensores

| Campo | Valor |
|---|---|
| **Spec** | `specs/010-motor-formulas-calculos/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S5-S6 · R3 |
| **Constitución** | Art. 1 (multitenant), Art. 7 (disciplina IA), Art. 8 (reproducibilidad) |
| **Última revisión** | 2026-06-24 (auditado contra código fuente real) |

---

## 1. Enfoque técnico (auditado 2026-06-24)

> ⚠️ **Aclaración arquitectónica vs diseño previo:**
> El motor de fórmulas está implementado como un **módulo inline del backend C++
> principal**, NO como un microservicio separado `formula_engine` en el puerto 8020.
> La base de datos usada es la **misma BD principal** de la plataforma, no una
> `formula_db` separada. El schema de tablas `mineria_*` se auto-crea en el primer
> login usando `ensureFormulaSchemaPg()`.

La "fórmula" implementada es un **stored procedure PostgreSQL** (`sp_proceso_temperatura`)
que aplica lógica de umbral y calibración lineal sobre lecturas de temperatura. No existe
un parser de expresiones de propósito general — la lógica de transformación está
encapsulada en el SP.

---

## 2. Arquitectura real

```
 Backend C++ (mismo binario que auth/reports/sensors)
   ├── formula_routes.cpp
   │   ├── GET /api/formula/dictionary
   │   ├── GET /api/analysis/catalogos
   │   └── POST /api/analysis/temperaturas
   │
   └── formula_service.cpp
       ├── ensureFormulaSchemaPg()  — crea tablas + SP + seed al primer login
       ├── ensureFormulaCatalogViewPg()  — vista v_mineria_catalogos
       └── (llamada directa a sp_proceso_temperatura vía PQexec)

 PostgreSQL (BD principal — no base de datos separada)
   ├── formula_data_dictionary (diccionario de variables estándar)
   ├── mineria_empresas  (tenant → empresa minera)
   ├── mineria_minas     (empresa → minas activas)
   ├── mineria_variables (empresa → variables de medición)
   ├── mineria_sensores  (empresa+mina → sensores)
   ├── mineria_lecturas  (hypertable de lecturas históricas)
   ├── formula_sessions  (auditoría de sesiones de análisis)
   └── v_mineria_catalogos (VIEW: join de las 4 tablas de catálogo)
```

---

## 3. Modelo de datos (tablas reales)

```sql
-- Empresas (tenants del módulo de fórmulas)
CREATE TABLE mineria_empresas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(40) UNIQUE NOT NULL,
  nombre VARCHAR(200) UNIQUE NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

-- Minas con parámetros de umbral y factor de ajuste
CREATE TABLE mineria_minas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES mineria_empresas(id),
  codigo VARCHAR(40),  nombre VARCHAR(200),
  zona_tipo VARCHAR(20) DEFAULT 'sierra',
  umbral_temp_alerta DECIMAL(6,2) DEFAULT 8.0,
  factor_ajuste DECIMAL(6,4) DEFAULT 0.82,
  activo BOOLEAN DEFAULT TRUE
);

-- Variables de medición (tipo temperatura por ahora)
CREATE TABLE mineria_variables (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES mineria_empresas(id),
  codigo VARCHAR(30),  nombre VARCHAR(200),
  unidad VARCHAR(20),  tipo VARCHAR(50) DEFAULT 'temperatura'
);

-- Sensores
CREATE TABLE mineria_sensores (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES mineria_empresas(id),
  mina_id INTEGER REFERENCES mineria_minas(id),
  variable_id INTEGER REFERENCES mineria_variables(id),
  codigo VARCHAR(40),  nombre VARCHAR(200),  activo BOOLEAN DEFAULT TRUE
);

-- Lecturas históricas (índice compuesto por empresa+mina+variable+ts)
CREATE TABLE mineria_lecturas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER, mina_id INTEGER, variable_id INTEGER,
  timestamp_lectura TIMESTAMPTZ NOT NULL,
  valor DECIMAL(12,4), calidad SMALLINT DEFAULT 100
);
CREATE INDEX idx_mlect_lookup ON mineria_lecturas
  (empresa_id, mina_id, variable_id, timestamp_lectura DESC);

-- Auditoría de sesiones de análisis (Art. 8)
CREATE TABLE formula_sessions (
  id BIGSERIAL PRIMARY KEY,
  usuario_nombre VARCHAR(200),
  accion VARCHAR(20) DEFAULT 'VISUALIZO',
  empresa_id INTEGER,  empresa_nombre VARCHAR(200),
  mina_id INTEGER,     mina_nombre VARCHAR(200),
  variable_id INTEGER, variable_nombre VARCHAR(200),
  fecha_inicio TIMESTAMPTZ, fecha_fin TIMESTAMPTZ,
  formula_json JSONB,  sp_sql_text TEXT,
  total_lecturas INTEGER,
  total_si INTEGER, total_no INTEGER,
  pct_alertas DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Stored procedure: `sp_proceso_temperatura`

El "motor de fórmulas" para el módulo de temperatura es este SP PostgreSQL:

```sql
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
  condicion_resultado VARCHAR(2),    -- 'SI' = alerta, 'NO' = normal
  valor_procesado     DECIMAL(12,4),
  descripcion         TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_umbral DECIMAL(6,2);
  v_factor DECIMAL(6,4);
BEGIN
  SELECT m.umbral_temp_alerta, m.factor_ajuste
  INTO   v_umbral, v_factor
  FROM   mineria_minas m
  WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

  RETURN QUERY
  SELECT l.timestamp_lectura, l.valor, l.calidad,
    v_umbral,
    CASE WHEN l.valor > v_umbral THEN 'SI' ELSE 'NO' END::VARCHAR(2),
    CASE
      WHEN l.valor > v_umbral
        THEN ROUND(CAST(v_umbral + (l.valor - v_umbral) * v_factor AS NUMERIC), 4)
      ELSE ROUND(CAST(l.valor * 0.985 + 0.12 AS NUMERIC), 4)
    END,
    CASE
      WHEN l.valor > v_umbral THEN 'ALERTA: amortiguacion por umbral'
      ELSE 'NORMAL: calibracion lineal'
    END::TEXT
  FROM mineria_lecturas l
  WHERE l.empresa_id = p_empresa_id AND l.mina_id = p_mina_id
    AND l.variable_id = p_variable_id
    AND l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
    AND l.calidad >= 50
  ORDER BY l.timestamp_lectura;
END;
$$;
```

**Lógica:**
- `valor > umbral_alerta` → condición = 'SI', valor_procesado amortiguado por `factor_ajuste`
- `valor <= umbral_alerta` → condición = 'NO', calibración lineal (`valor * 0.985 + 0.12`)

---

## 5. Vista de catálogos

```sql
CREATE VIEW v_mineria_catalogos AS
SELECT
  e.id AS empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
  m.id AS mina_id, m.codigo AS mina_codigo, m.nombre AS mina_nombre,
  m.zona_tipo, m.umbral_temp_alerta,
  s.id AS sensor_id, s.codigo AS sensor_codigo, s.nombre AS sensor_nombre,
  v.id AS variable_id, v.codigo AS variable_codigo,
  v.nombre AS variable_nombre, v.unidad
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id AND m.activo = TRUE
JOIN mineria_variables v ON v.empresa_id = e.id AND v.activo = TRUE AND v.tipo = 'temperatura'
JOIN mineria_sensores s ON s.empresa_id = e.id AND s.mina_id = m.id
  AND s.variable_id = v.id AND s.activo = TRUE;
```

---

## 6. Endpoints (contratos reales)

| Método | Ruta | Lógica | Auth |
|---|---|---|---|
| GET | `/api/formula/dictionary` | SELECT from `formula_data_dictionary` WHERE `is_active=TRUE` | sí |
| GET | `/api/analysis/catalogos` | SELECT from `v_mineria_catalogos` WHERE empresa = tenant | sí |
| POST | `/api/analysis/temperaturas` | ejecuta `sp_proceso_temperatura(empresa_id, mina_id, var_id, t_ini, t_fin)` + INSERT en `formula_sessions` | sí |

---

## 7. Auto-seed en primer login (por empresa)

`ensureFormulaSchemaPg(conn, companyName)` realiza auto-seed una sola vez:
1. Crea empresa en `mineria_empresas` (code = nombre normalizado sin espacios)
2. Inserta mina `UNI-001 / Unidad Minera Principal` con `umbral=8.0`, `factor=0.82`
3. Inserta variable `TEMP-001 / Temperatura Ambiente`
4. Inserta sensor `SEN-001`
5. Inserta 30 días de lecturas sintéticas (seno + ruido, `calidad=100`) si `mineria_lecturas` está vacía

---

## 8. Multitenant (Art. 1)

- Todas las tablas `mineria_*` tienen `empresa_id` como FK principal.
- `ensureFormulaSchemaPg(conn, companyName)` usa el nombre de la empresa de la sesión.
- El endpoint `POST /api/analysis/temperaturas` filtra por la empresa de la sesión.

---

## 9. Reproducibilidad (Art. 8)

- Cada análisis ejecutado inserta un registro en `formula_sessions` con:
  - empresa, mina, variable
  - rango de fechas (`fecha_inicio`, `fecha_fin`)
  - totales SI/NO y porcentaje de alertas
  - `sp_sql_text` para auditar la lógica exacta usada

---

## 10. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-010-1 | Stored procedure en PG (no parser de expresiones en C++) — auditable, sin inyección | Aceptado |
| ADR-010-2 | Diccionario en BD (`formula_data_dictionary`) — actualizable sin redeploy | Aceptado |
| ADR-010-3 | Auto-seed de datos sintéticos al primer login — facilita demo/onboarding | Aceptado |
| ADR-010-4 | Módulo embebido en backend principal (no microservicio) — simplicidad operativa | Aceptado |

---

## 11. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `GET /api/formula/dictionary` → lista con codes, unidades | curl response |
| CA-2 | `GET /api/analysis/catalogos` → empresa/mina/sensor del tenant | curl response |
| CA-3 | `POST /api/analysis/temperaturas` → filas con condicion_resultado SI/NO, valores procesados | curl response |
| CA-4 | Empresa A no ve catálogos ni análisis de empresa B | SQL SELECT cruzado |
| CA-5 | `formula_sessions` registra sesión tras análisis | SELECT post-análisis |

---

## 12. Pendientes

| Prioridad | Trabajo |
|---|---|
| 🟡 Media | Endpoint CRUD para `mining_runtime_kpis` → feed a dashboards |
| 🟡 Media | Endpoint histórico de `formula_sessions` |
| 🟢 Baja | Extender a más tipos de variable (vibración, presión, gas) con nuevos SPs |
