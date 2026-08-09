# 🔧 REFACTORING PLAN — Pre-v0.1 Code Quality

**Objetivo**: Optimizar, documentar y refactorizar ANTES de v0.1  
**Timeline**: 2-3 semanas (paralelo a algunos cambios v0.1)  
**Prioridad**: 🔴 CRÍTICA (mejora escalabilidad y mantenibilidad)

---

## FASE 1: ANÁLISIS COMPLETO (EN PROGRESO)

### Categorías de Problemas Identificados

#### 🔴 CRÍTICA: SQL Hardcodeado en Código Fuente
**Ubicaciones**:
- `backend/src/auth/auth_storage_pg.cpp:81-134` — DDL table creation
- `backend/src/auth/auth_storage_pg.cpp:139-141` — INSERT query
- `backend/src/auth/auth_storage_pg.cpp:146` — UPDATE query específica (usuarios hardcodeados)
- `backend/src/mining/telemetry_ingest.cpp:119-120` — SELECT sensor cache
- `backend/src/reports/report_service.cpp` — ❓ TBD (revisando)
- `backend/src/mining/kpi_service.cpp` — ❓ TBD (revisando)

**Impacto**:
- ❌ Imposible cambiar schema sin recompilar
- ❌ N+1 queries sin optimización
- ❌ Caché de sensores ineficiente
- ❌ Usuarios hardcodeados para seed (INSEGURO)

**Solución**: Migrar a **stored procedures + views**

---

#### 🔴 CRÍTICA: Falta de Documentación de Código
**Evidencia**:
```cpp
// ANTES
bool resolveSensor(const std::string& code,
                   std::string& sensor_id,
                   std::string& tenant_id) const {
  auto it = sensor_cache_.find(code);
  if (it == sensor_cache_.end()) return false;
  sensor_id = it->second.first;
  tenant_id = it->second.second;
  return true;
}

// FALTA: documentación de qué hace, parámetros, valores de retorno
```

**Impacto**:
- ❌ Código sin javadoc/doxygen
- ❌ Parámetros sin validación documentada
- ❌ Valores mágicos sin explicación

**Solución**: Agregar **Doxygen comments**

---

#### 🟠 ALTA: Faltan Constantes (Magic Numbers)
**Ubicaciones**:
- `backend/src/mining/telemetry_ingest.cpp:54-56` — Magic numbers 1000, 200, 200000
- `backend/src/mining/telemetry_ingest.cpp:123` — factor × 2
- `backend/src/server/connection_pool.cpp` — ❓ pool size?

**Solución**: Crear `backend/src/config/constants.hpp`

---

#### 🟠 ALTA: Faltan Validaciones de Entrada
**Ubicaciones**:
- `auth_storage_pg.cpp` — No valida username/password format antes de SQL
- `report_routes.cpp` — ❓ No valida content_json antes de guardar
- `telemetry_ingest.cpp` — ❓ No valida valores de sensores

**Solución**: Crear **validators.hpp**

---

#### 🟠 ALTA: Ineficiencia de React Components
**Ubicaciones**:
- `PageCanvas.jsx` — Re-renderiza todo al cambiar 1 elemento (falta React.memo)
- `WorkflowPanel.jsx` — No usa useMemo para computaciones
- Componentes sin TypeScript types
- Hardcoded strings (sin i18n)

**Solución**: Optimizar con React.memo, useMemo, TypeScript

---

#### 🟡 MEDIA: Memory Leaks Potenciales en C++
**Ubicaciones**:
- `telemetry_ingest.cpp:94-95` — delete sin try/catch
- Uso de `new` sin RAII (raw pointers)
- PGresult* sin siempre PQclear

**Solución**: Usar **smart pointers (unique_ptr)**

---

#### 🟡 MEDIA: Falta de Error Handling
**Ubicaciones**:
- `ensureAuthSchemaPg()` — Ignora errores en ALTER TABLE
- `loadSensorCache()` — Falla silenciosa sin log
- Funciones sin try/catch

**Solución**: Agregar **error handling explícito**

---

#### 🟡 MEDIA: Código Duplicado
**Ubicaciones**:
- SQL escape patterns duplicados en varios archivos
- Conexión a DB duplicada (sin pool)
- Código de validación de JWT duplicado

**Solución**: Crear **utilities.hpp** compartidas

---

## FASE 2: PLAN DE REFACTORING (3 SEMANAS)

### SEMANA 1: Backend C++ Refactoring

#### Sprint 1A: SQL → Stored Procedures (3 días)

**Tarea 1: Migrar DDL a migrations**
```sql
-- db_scripts/99_refactor_stored_procedures.sql
CREATE OR REPLACE FUNCTION sp_load_active_sensors()
RETURNS TABLE(sensor_code TEXT, sensor_id UUID, tenant_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT s.code, s.id, s.tenant_id 
  FROM sensors s 
  WHERE s.is_active = TRUE;
END;
$$ LANGUAGE plpgsql;
```

Cambio en C++:
```cpp
// ANTES
const char* sql = "SELECT sensor_code, sensor_id::text, tenant_id::text FROM sensors WHERE is_active = true";
PGresult* res = PQexec(c, sql);

// DESPUÉS
PGresult* res = PQexec(c, "SELECT * FROM sp_load_active_sensors()");
```

**Tarea 2: Migrar SELECT queries a views**
```sql
-- Vista para sensor cache
CREATE OR REPLACE VIEW v_sensor_cache AS
SELECT sensor_code, sensor_id::text, tenant_id::text
FROM sensors
WHERE is_active = TRUE;
```

**Tarea 3: Migrar UPDATE/INSERT a stored procedures**
```sql
-- Crear SP en lugar de hardcodeado
CREATE OR REPLACE FUNCTION sp_seed_auth_users()
RETURNS TABLE(username TEXT, status TEXT) AS $$
BEGIN
  -- Seed logic, NO hardcodeado en C++
END;
$$ LANGUAGE plpgsql;
```

---

#### Sprint 1B: Code Quality (2 días)

**Tarea 1: Crear constants.hpp**
```cpp
// backend/src/config/constants.hpp
#pragma once

namespace config {
  // Telemetry Ingestor defaults
  constexpr std::size_t DEFAULT_BATCH_SIZE = 1000;
  constexpr int DEFAULT_FLUSH_MS = 200;
  constexpr std::size_t DEFAULT_MAX_QUEUE = 200000;
  
  // Connection Pool
  constexpr int DB_POOL_SIZE = 10;
  constexpr int DB_TIMEOUT_MS = 5000;
  
  // Auth
  constexpr int SESSION_TIMEOUT_HOURS = 24;
  constexpr int PASSWORD_MIN_LENGTH = 8;
  
  // Telemetry
  constexpr std::size_t SENSOR_CACHE_RESERVE_FACTOR = 2;
}
```

**Tarea 2: Crear validators.hpp**
```cpp
// backend/src/security/validators.hpp
#pragma once
#include <string>

namespace security {
  class Validator {
  public:
    static bool isValidUsername(const std::string& username);
    static bool isValidPassword(const std::string& password);
    static bool isValidJsonDocument(const std::string& json);
    static bool isValidSensorValue(double value);
  };
}
```

**Tarea 3: Agregar Doxygen comments**
```cpp
// ANTES
bool resolveSensor(const std::string& code,
                   std::string& sensor_id,
                   std::string& tenant_id) const;

// DESPUÉS
/**
 * @brief Resuelve código de sensor a IDs internos desde caché.
 * 
 * @param code Código único del sensor (ej: "TEMP_001")
 * @param[out] sensor_id UUID del sensor en BD
 * @param[out] tenant_id UUID del tenant propietario
 * @return true si sensor encontrado en caché, false si no existe
 * 
 * @note O(1) lookup en caché de sensores cargado al startup
 * @see loadSensorCache()
 */
bool resolveSensor(const std::string& code,
                   std::string& sensor_id,
                   std::string& tenant_id) const;
```

---

#### Sprint 1C: Memory Safety (2 días)

**Tarea 1: Reemplazar raw pointers con smart pointers**
```cpp
// ANTES
PGconn* c = PQconnectdb(db_url_.c_str());
// ... code ...
PQfinish(c);

// DESPUÉS
class PGConnDeleter {
public:
  void operator()(PGconn* conn) const { if (conn) PQfinish(conn); }
};
std::unique_ptr<PGconn, PGConnDeleter> conn(PQconnectdb(db_url_.c_str()));
// Auto cleanup
```

**Tarea 2: Agregar error handling**
```cpp
bool ensureAuthSchemaPg(PGconn *conn) {
  try {
    // Existing code...
    if (!pgExecOk(conn, sql)) {
      throw std::runtime_error("Failed to create auth schema");
    }
    // ...
  } catch (const std::exception& e) {
    std::cerr << "[AUTH] Schema init failed: " << e.what() << std::endl;
    return false;
  }
}
```

---

### SEMANA 2: Frontend React Refactoring

#### Sprint 2A: React Optimization (2 días)

**Tarea 1: Memoization**
```javascript
// ANTES
export default function PageCanvas({ elements, onUpdate }) {
  return (
    <div>
      {elements.map(el => <Element key={el.id} data={el} />)}
    </div>
  );
}

// DESPUÉS
const Element = React.memo(({ data }) => {
  return <div>{data.type}</div>;
});

export default function PageCanvas({ elements, onUpdate }) {
  const memoizedElements = useMemo(() => 
    elements.map(el => <Element key={el.id} data={el} />),
    [elements]
  );
  return <div>{memoizedElements}</div>;
}
```

**Tarea 2: TypeScript Migration**
```typescript
// ANTES
export default function WorkflowPanel({ reportId, currentStatus, auditLog, onTransition }) { ... }

// DESPUÉS
interface WorkflowPanelProps {
  reportId: string;
  currentStatus: 'draft' | 'in_review' | 'approved' | 'signed' | 'archived';
  auditLog: AuditEntry[];
  onTransition: (newStatus: WorkflowStatus, comment: string) => Promise<void>;
}

export default function WorkflowPanel({
  reportId,
  currentStatus,
  auditLog,
  onTransition,
}: WorkflowPanelProps): JSX.Element { ... }
```

**Tarea 3: Internationalization**
```javascript
// ANTES
<span>Enviar a revisión</span>

// DESPUÉS
import { useTranslation } from 'react-i18next';
export function WorkflowPanel() {
  const { t } = useTranslation('workflow');
  return <span>{t('sendForReview')}</span>;
}
```

---

#### Sprint 2B: Component Documentation (1 día)

**Agregar JSDoc comments**:
```javascript
/**
 * Editor visual de informes técnicos mineros con Tiptap + Konva.
 * 
 * @component
 * @example
 * <PageCanvas pageNumber={1} onUpdate={updateHandler} />
 * 
 * @param {number} pageNumber - Número de página actual (1-indexed)
 * @param {function} onUpdate - Callback(pageNumber, elementId, updates)
 * @returns {JSX.Element} Lienzo interactivo de edición
 * 
 * @performance Renderiza solo elementos visibles (virtualization ready)
 */
export function PageCanvas({ pageNumber, onUpdate }) { ... }
```

---

### SEMANA 3: Database & Optimization

#### Sprint 3A: Database Optimization (2 días)

**Tarea 1: Agregar índices faltantes**
```sql
-- Índices en queries frecuentes
CREATE INDEX IF NOT EXISTS idx_reports_tenant_created 
  ON reports(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sensors_tenant_active
  ON sensors(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_time
  ON platform_audit_log(user_id, created_at DESC);
```

**Tarea 2: Crear vistas para queries complejas**
```sql
CREATE OR REPLACE VIEW v_reports_with_status_summary AS
SELECT 
  r.id,
  r.title,
  r.status,
  COUNT(CASE WHEN a.action = 'transition' THEN 1 END) as transitions,
  MAX(a.created_at) as last_modified
FROM reports r
LEFT JOIN platform_audit_log a ON a.entity_id = r.id
GROUP BY r.id, r.title, r.status;
```

**Tarea 3: Query profiling**
```bash
# Identificar slow queries
psql -d formula_db -c "
  SELECT query, mean_time, calls 
  FROM pg_stat_statements 
  WHERE mean_time > 100 
  ORDER BY mean_time DESC LIMIT 20;
"
```

---

#### Sprint 3B: Performance Tuning (1 día)

**Tarea 1: Connection pool optimization**
```cpp
// Ajustar tamaño de pool según carga
const int OPTIMAL_POOL_SIZE = std::thread::hardware_concurrency() + 2;
```

**Tarea 2: Caché invalidation strategy**
```cpp
// Sensor cache con TTL
class CachedSensor {
private:
  std::chrono::steady_clock::time_point last_refresh_;
  static constexpr auto CACHE_TTL = std::chrono::minutes(5);
  
public:
  bool isExpired() const {
    return std::chrono::steady_clock::now() - last_refresh_ > CACHE_TTL;
  }
};
```

---

## FASE 3: VALIDACIÓN & QA

### Checklist de Refactoring

- [ ] Todos los SQL migrados a stored procedures
- [ ] Todas las funciones tienen Doxygen comments
- [ ] No hay magic numbers (todos en constants.hpp)
- [ ] Input validation en todos los endpoints
- [ ] React components memoizados
- [ ] TypeScript types en todos los componentes
- [ ] Error handling en todos los paths críticos
- [ ] No hay raw pointers (solo smart pointers)
- [ ] Base de datos con índices optimizados
- [ ] Conexiones usando pool
- [ ] Tests unitarios para funciones críticas
- [ ] Performance profiling realizado

---

## TIMELINE

```
Week 1 (Backend):    SQL + Constants + Doxygen + Memory Safety
Week 2 (Frontend):   React optimization + TypeScript + i18n
Week 3 (Database):   Indexes + Views + Query tuning
───────────────────────────────────────
Semana 4: v0.1 Implementation (con código REFACTORIZADO)
```

---

## EXPECTED IMPROVEMENTS

| Métrica | Before | After | Gain |
|---|---|---|---|
| Build time | ? | -20% | Menos SQL parsing |
| Query time | ? | -40% | Índices + vistas |
| Memory usage | ? | -15% | Smart pointers + cleanup |
| React renders | ? | -60% | Memoization |
| Code docs | 0% | 100% | Doxygen |
| Test coverage | ? | +30% | Mejor testabilidad |

---

**Next Step**: Esperar resultado del agent analyzer, compilar lista completa de issues, y empezar FASE 1.
