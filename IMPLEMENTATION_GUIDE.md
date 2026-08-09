# 🚀 GUÍA DE IMPLEMENTACIÓN — v0.1 Release (2 Semanas)

**Estado**: 🟢 KICKOFF TODAY  
**Equipo**: Backend Dev, Frontend Dev, DevOps/BD  
**Timeline**: 14 días (Día 1-7: Sprint 1, Día 8-14: Sprint 2)  
**Repositorio Branch**: `feature/v01-hallazgos` (crear hoy)

---

## DAY 1 (Lunes) — KICKOFF + VERIFICACIÓN CRÍTICA

### Morning (9:00-12:00): Sync Inicial + Setup

**15 min Standup General**:
- Confirmar responsables por tarea
- Distribuir branches
- Resolver dudas iniciales

**Setup Local (Cada equipo)**:
```bash
# Todo el equipo
git checkout -b feature/v01-hallazgos
git pull origin main

# Frontend Dev
cd frontend
npm install
npm run dev

# Backend Dev
cd backend
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release

# DevOps/BD
psql -d sensors_db -c "SELECT version();"
```

**Crear Branches por Tarea**:
```bash
# Frontend
git checkout -b feature/01-cover-toc
git checkout -b feature/02-konva-persist
git checkout -b feature/03-workflow-ui

# Backend
git checkout -b feature/01-cover-toc-api
git checkout -b feature/03-workflow-be
git checkout -b feature/04-idor-audit

# DevOps
git checkout -b feature/03-workflow-bd
git checkout -b feature/05-hypertables
```

### Afternoon (13:00-16:00): VERIFICACIÓN CRÍTICA #1 — Workflow States

**🔴 BLOCKER**: Necesitamos validar QUÉ usa BD hoy.

**Backend Dev + DevOps/BD**:
```bash
# Conectar a BD y revisar estado actual
psql -d formula_db -U postgres -c \
  "SELECT DISTINCT status FROM reports LIMIT 10;"

# Ver qué script 19 define
grep -A 20 "CREATE TABLE reports" db_scripts/19_report_technical_mining_enterprise.sql

# Verificar constraint
psql -d formula_db -U postgres -c \
  "SELECT constraint_name FROM information_schema.table_constraints 
   WHERE table_name='reports';"
```

**Compilar Hallazgos en 30 min Sync**:
- ¿BD usa `review` o `in_review`?
- ¿Hay constraint de transiciones?
- ¿Frontend y Backend ya validan?

**ACCIÓN**: Documentar en Slack el hallazgo exacto → define orden de implementación.

---

### Afternoon (16:00-17:00): Tareas Independientes Comienzan

**Frontend Dev**: 
- ✅ Setup local completo
- ✅ Abrir PR draft: `feature/01-cover-toc`
- ✅ Leer miningReportFormat.js completo

**Backend Dev**:
- ✅ Setup CMake
- ✅ Leer report_routes.cpp + report_service.cpp
- ✅ Listar todos endpoints (security audit prep)

**DevOps/BD**:
- ✅ Conectar a BD
- ✅ Revisar script 19
- ✅ Preparar template de migración

---

## HALLAZGO #1: Cover/TOC Serialización (Frontend + Backend)

### Frontend: MININGREPORT FORMAT

**Archivo**: `frontend/src/components/ReportStudioV2/lib/miningReportFormat.js`

**Paso 1**: Extender enum de tipos (línea ~100)

```javascript
// ANTES
const BLOCK_TYPES = ['text', 'image', 'table', 'sensor', 'kpi', 'chart'];

// DESPUÉS
const BLOCK_TYPES = ['text', 'image', 'table', 'sensor', 'kpi', 'chart', 'cover', 'toc'];

// Agregar funciones de esquema tipado
export const BLOCK_SCHEMAS = {
  text: {
    doc: null,       // ProseMirror JSON
    fontFamily: 'Arial',
    fontSize: 16,
  },
  cover: {
    title: '',
    company: '',
    author: '',
    date: new Date().toISOString(),
    classification: 'CONFIDENCIAL',
    logo: null,      // image ref
  },
  toc: {
    autoGenerate: true,
    title: 'Tabla de Contenidos',
  },
  // ... rest
};
```

**Paso 2**: Validar y serializar en `exportMiningReport()`

```javascript
export async function exportMiningReport(doc, metadata = {}) {
  // ... existing code ...
  
  // Validar tipos de bloque
  if (doc.pages) {
    doc.pages.forEach((page, idx) => {
      if (!page.elements) return;
      page.elements.forEach((el) => {
        if (!BLOCK_TYPES.includes(el.type)) {
          throw new Error(`Página ${idx}: tipo de bloque desconocido "${el.type}"`);
        }
        // Validar schema según tipo
        const schema = BLOCK_SCHEMAS[el.type];
        if (!el.props) el.props = schema;
      });
    });
  }
  
  // ... rest of export ...
}
```

**Paso 3**: Actualizar App.jsx para conectar botones

```javascript
// Buscar onInsertCoverPage (probablemente en RibbonToolbar.jsx)
const onInsertCoverPage = useCallback(() => {
  addElement('cover', {
    title: doc.meta?.title || 'Informe Sin Título',
    company: platformCompanyName || 'Empresa',
    author: loggedAuthor,
    date: new Date().toISOString(),
  });
}, [addElement, doc.meta?.title, platformCompanyName, loggedAuthor]);

// Similar para TOC
const onInsertToc = useCallback(() => {
  addElement('toc', {
    autoGenerate: true,
    title: 'Tabla de Contenidos',
  });
}, [addElement]);
```

**Testing**:
```javascript
// Crear test: frontend/src/components/ReportStudioV2/lib/miningReportFormat.test.js
test('serializa cover y toc en JSON', async () => {
  const doc = {
    pages: [{
      page_number: 1,
      elements: [
        { id: '1', type: 'cover', props: { title: 'Test' } },
        { id: '2', type: 'toc', props: { autoGenerate: true } },
      ]
    }]
  };
  
  const blob = await exportMiningReport(doc);
  const text = await blob.text();
  const envelope = JSON.parse(text);
  
  expect(envelope.document.pages[0].elements[0].type).toBe('cover');
  expect(envelope.document.pages[0].elements[1].type).toBe('toc');
});
```

### Backend: REPORT ROUTES + SERVICE

**Archivo**: `backend/src/reports/report_service.cpp`

**Paso 1**: Validar tipos de bloque en deserialización

```cpp
#include <set>

namespace {
  const std::set<std::string> VALID_BLOCK_TYPES = {
    "text", "image", "table", "sensor", "kpi", "chart", "cover", "toc"
  };
}

bool validateReportContent(const std::string& contentJson, std::string& error) {
  try {
    auto doc = json::parse(contentJson);
    
    if (doc.is_object() && doc.as_object().count("pages")) {
      auto pages = doc.at("pages");
      for (size_t i = 0; i < pages.size(); ++i) {
        auto page = pages[i];
        if (page.is_object() && page.as_object().count("elements")) {
          auto elements = page.at("elements");
          for (size_t j = 0; j < elements.size(); ++j) {
            auto el = elements[j];
            if (el.is_object()) {
              auto type_str = el.at("type").as_string();
              if (VALID_BLOCK_TYPES.find(type_str) == VALID_BLOCK_TYPES.end()) {
                error = "Página " + std::to_string(i) + ": tipo de bloque inválido: " + type_str;
                return false;
              }
            }
          }
        }
      }
    }
    return true;
  } catch (const std::exception& e) {
    error = std::string("JSON inválido: ") + e.what();
    return false;
  }
}
```

**Paso 2**: Llamar validación en createReportPg()

```cpp
std::string error;
if (!validateReportContent(r.contentJson, error)) {
  return makeJsonResponse(http::status::bad_request, 
    json::object{{"error", error}});
}
```

**Testing**:
```bash
# Test manual: crear report con cover/toc
curl -X POST http://localhost:8443/api/reports \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Test Cover/TOC",
    "content_json": "{\"pages\": [{\"page_number\": 1, \"elements\": [{\"type\": \"cover\", \"props\": {}}]}]}"
  }'
```

---

## HALLAZGO #2: Konva Layout Persistence

### Frontend: PAGECANVAS + STORE

**Archivo**: `frontend/src/components/ReportStudioV2/components/document/PageCanvas.jsx`

**Paso 1**: Agregar handlers de Konva

```javascript
// Buscar componente Rect y agregar:
<Rect
  x={element.x || 0}
  y={element.y || 0}
  width={element.width || 100}
  height={element.height || 100}
  draggable
  onDragEnd={(e) => {
    const node = e.target;
    updateElement(pageNumber, element.id, {
      x: Math.round(node.x()),
      y: Math.round(node.y()),
    });
  }}
  onTransformEnd={(e) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    updateElement(pageNumber, element.id, {
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width: Math.round(node.width() * scaleX),
      height: Math.round(node.height() * scaleY),
      scaleX: 1,
      scaleY: 1,
    });
    node.scaleX(1);
    node.scaleY(1);
  }}
  // ... rest of props
/>
```

**Archivo**: `frontend/src/components/ReportStudioV2/store/useEditorStore.js`

**Paso 2**: Extender updateElement()

```javascript
// Buscar función updateElement (línea ~518)
updateElement: (pageNumber, elementId, patch) => {
  set((state) => {
    const pages = [...state.doc.pages];
    const pageIdx = pages.findIndex((p) => p.page_number === pageNumber);
    if (pageIdx === -1) return state;
    
    const elements = [...pages[pageIdx].elements];
    const elIdx = elements.findIndex((e) => e.id === elementId);
    if (elIdx === -1) return state;
    
    // Agregar soporte para x, y, width, height
    elements[elIdx] = {
      ...elements[elIdx],
      ...patch,  // Ahora incluye x, y, width, height
      props: {
        ...elements[elIdx].props,
        ...(patch.props || {}),
      },
    };
    
    pages[pageIdx].elements = elements;
    return { doc: { ...state.doc, pages } };
  });
},
```

**Testing**:
```javascript
test('persiste posición de elemento al drag', () => {
  const store = useEditorStore.getState();
  
  // Crear elemento
  store.addElement('text');
  const el = store.doc.pages[0].elements[0];
  
  // Actualizar posición
  store.updateElement(1, el.id, { x: 100, y: 200 });
  
  // Verificar
  const updated = store.doc.pages[0].elements[0];
  expect(updated.x).toBe(100);
  expect(updated.y).toBe(200);
});
```

---

## HALLAZGO #3: Workflow States Alignment

### VERIFICATION DAY 1 AFTERNOON

**Tarea Urgente**: Revisar qué usa BD hoy.

```bash
# DevOps/BD: Ejecutar ASAP
psql -d formula_db -U postgres << 'SQL'
  -- Ver valores actuales de status en reportes
  SELECT DISTINCT status, COUNT(*) FROM reports GROUP BY status;
  
  -- Ver definición de tabla
  SELECT column_definition FROM information_schema.columns 
  WHERE table_name='reports' AND column_name='status';
  
  -- Ver constraint si existe
  SELECT constraint_definition FROM information_schema.table_constraints t
  JOIN information_schema.check_constraints c ON t.constraint_name = c.constraint_name
  WHERE t.table_name='reports';
SQL
```

**Compilar Resultado en Slack** (formato):
```
Estado actual en BD:
- Valores encontrados: [list them]
- Constraint: [yes/no]
- Transiciones validadas: [yes/no]

Recomendación de acción:
[ ] Migrar BD a 'in_review'
[ ] Actualizar Frontend a 'in_review'
[ ] Coordinar deploy order: BD > Backend > Frontend
```

### ASUMIENDO: BD usa 'review' (CASO MÁS PROBABLE)

**Archivo**: `db_scripts/30_workflow_states_migration.sql` (CREAR NUEVO)

```sql
BEGIN;

-- Migración de estados: review → in_review
UPDATE reports SET status = 'in_review' WHERE status = 'review';

-- Verificar
SELECT DISTINCT status FROM reports;

COMMIT;
```

**Archivo**: `frontend/src/components/ReportStudioV2/components/document/WorkflowPanel.jsx`

```javascript
// Línea 15: Cambiar
const WORKFLOW_STATES = {
  draft:    { label: 'Borrador',   color: '#94a3b8', icon: FileText },
  in_review: { label: 'En Revisión', color: '#f59e0b', icon: Eye },  // ← CAMBIO
  approved: { label: 'Aprobado',   color: '#10b981', icon: CheckCircle2 },
  signed:   { label: 'Firmado',    color: '#6366f1', icon: Shield },
  rejected: { label: 'Rechazado',  color: '#ef4444', icon: XCircle },
};

const WORKFLOW_TRANSITIONS = {
  draft:    ['in_review'],  // ← CAMBIO
  in_review: ['approved', 'rejected', 'draft'],  // ← CAMBIO
  approved: ['signed', 'in_review'],  // ← CAMBIO
  signed:   [],
  rejected: ['draft'],
};
```

**Archivo**: `backend/src/reports/report_service.cpp`

```cpp
enum class ReportStatus {
  DRAFT,
  IN_REVIEW,    // ← CAMBIO (era REVIEW)
  APPROVED,
  SIGNED,
  REJECTED,
  ARCHIVED,
};

const std::map<std::string, ReportStatus> STATUS_MAP = {
  {"draft", ReportStatus::DRAFT},
  {"in_review", ReportStatus::IN_REVIEW},  // ← CAMBIO
  {"approved", ReportStatus::APPROVED},
  {"signed", ReportStatus::SIGNED},
  {"rejected", ReportStatus::REJECTED},
  {"archived", ReportStatus::ARCHIVED},
};

bool isValidTransition(ReportStatus from, ReportStatus to) {
  const std::map<ReportStatus, std::set<ReportStatus>> VALID = {
    {ReportStatus::DRAFT, {ReportStatus::IN_REVIEW}},
    {ReportStatus::IN_REVIEW, {ReportStatus::APPROVED, ReportStatus::REJECTED, ReportStatus::DRAFT}},
    {ReportStatus::APPROVED, {ReportStatus::SIGNED, ReportStatus::IN_REVIEW}},
    {ReportStatus::SIGNED, {}},
    {ReportStatus::REJECTED, {ReportStatus::DRAFT}},
    {ReportStatus::ARCHIVED, {}},
  };
  
  return VALID.at(from).count(to) > 0;
}
```

**Deploy Order**:
1. Day 3 Morning: Apply `30_workflow_states_migration.sql` to DB
2. Day 3 Afternoon: Deploy Backend with new enum
3. Day 4 Morning: Deploy Frontend with UI change

---

## HALLAZGO #4: IDOR / RBAC Audit

### Backend: Create Audit Matrix

**Tarea**: Listar TODOS los endpoints y verificar tenant check.

**Archivo**: `SECURITY_AUDIT_CHECKLIST.md` (CREAR)

```markdown
# Security Audit Checklist

## Reports Module
- [ ] GET /api/reports — valida session->company ✅
- [ ] GET /api/reports/{id} — valida session->company ✅
- [ ] POST /api/reports — valida session->company ✅
- [ ] PUT /api/reports/{id} — valida session->company ✅
- [ ] DELETE /api/reports/{id} — valida session->company ✅

## Auth Module
- [ ] GET /api/users — valida session->company ❓
- [ ] GET /api/users/{id} — valida session->company ❓
- [ ] POST /api/users — valida session->company ❓
- [ ] PUT /api/users/{id} — valida session->company ❓
- [ ] PUT /api/roles/{id} — valida session->company ❓

## Mining Module
- [ ] GET /api/sensors — valida session->company ❓
- [ ] POST /api/kpi — valida session->company ❓

## Formula Module
- [ ] GET /api/formulas — valida session->company ❓
```

**Backend Dev**: Completar checklist en 2 horas. Marcar ✅ o ❓.

### Crear Middleware Centralizado

**Archivo**: `backend/src/security/api_auth.hpp`

```cpp
namespace security {
  class TenantGuard {
  public:
    static bool checkTenantOwnership(
      const std::string& resourceType,
      const std::string& resourceId,
      const std::string& userTenant,
      const std::string& dbUrl,
      std::string& error
    );
  };
}
```

**Archivo**: `backend/src/security/api_auth.cpp`

```cpp
bool TenantGuard::checkTenantOwnership(
  const std::string& resourceType,
  const std::string& resourceId,
  const std::string& userTenant,
  const std::string& dbUrl,
  std::string& error
) {
  if (resourceType == "report") {
    Report r;
    if (!getReportByIdPg(dbUrl, resourceId, userTenant, r, error)) {
      error = "Forbidden";
      return false;
    }
  } else if (resourceType == "user") {
    // Implement user ownership check
  } else if (resourceType == "role") {
    // Implement role ownership check
  }
  return true;
}
```

**Usage in endpoints**:
```cpp
// Before returning response
std::string secError;
if (!TenantGuard::checkTenantOwnership(
  "report", reportId, session->company, gDatabaseUrl, secError)) {
  return makeJsonResponse(http::status::forbidden,
    json::object{{"error", "Forbidden"}});
}
```

---

## HALLAZGO #5: TimescaleDB Hypertables

### DevOps/BD: Create Migration Script

**Archivo**: `db_scripts/30_timescale_hypertables.sql` (CREAR NUEVO)

```sql
BEGIN;

-- ============================================================================
-- Migración: mineria_lecturas tabla plana → hypertable
-- ============================================================================

-- 1. Verificar estructura actual
-- SELECT * FROM timescaledb_information.hypertables;

-- 2. Crear hypertable temporal con mismo schema
CREATE TABLE mineria_lecturas_hyper AS 
SELECT * FROM mineria_lecturas 
WHERE FALSE;  -- Solo schema

-- Convertir a hypertable (si no lo es)
SELECT create_hypertable('mineria_lecturas_hyper', 'timestamp', if_not_exists => TRUE);

-- 3. COPY datos históricos
INSERT INTO mineria_lecturas_hyper 
SELECT * FROM mineria_lecturas;

-- 4. Verificar volumen
SELECT COUNT(*) as row_count FROM mineria_lecturas_hyper;

-- 5. Renombrar tablas
ALTER TABLE mineria_lecturas RENAME TO mineria_lecturas_old;
ALTER TABLE mineria_lecturas_hyper RENAME TO mineria_lecturas;

-- 6. Recrear índices
CREATE INDEX idx_mineria_lecturas_sensor_time 
  ON mineria_lecturas (sensor_id, timestamp DESC);

-- 7. Aplicar políticas TimescaleDB
SELECT add_compression_policy('mineria_lecturas', 
  INTERVAL '7 days', if_not_exists => TRUE);

SELECT add_retention_policy('mineria_lecturas', 
  INTERVAL '45 days', if_not_exists => TRUE);

-- 8. Crear continuous aggregate para KPI queries
CREATE MATERIALIZED VIEW IF NOT EXISTS mineria_lecturas_hour AS
SELECT 
  sensor_id,
  time_bucket('1 hour', timestamp) AS hour,
  AVG(value) as avg_value,
  MAX(value) as max_value,
  MIN(value) as min_value
FROM mineria_lecturas
GROUP BY sensor_id, hour;

-- Refresh policy
SELECT add_continuous_aggregate_policy('mineria_lecturas_hour',
  start_offset => INTERVAL '3 hours',
  if_not_exists => TRUE);

COMMIT;
```

**Pre-Migration Testing**:
```bash
# DevOps: En ambiente DE DESARROLLO primero
psql -d sensors_db -f db_scripts/30_timescale_hypertables.sql

# Verificar
psql -d sensors_db -c "SELECT * FROM timescaledb_information.hypertables;"
psql -d sensors_db -c "SELECT COUNT(*) FROM mineria_lecturas;"
```

**Stress Test**:
```bash
# Simular 10k sensores/seg durante 1 minuto
# (requiere script Python o similar — preparar antes de deploy)
time python3 scripts/stress_test_10k_sensors.py --duration=60s
```

---

## HALLAZGO #6: Auditoría 100% (SPRINT 2)

### Backend: Create Audit Service (START DAY 8)

**Archivo**: `backend/src/audit/audit_service.hpp` (CREAR NUEVO)

```cpp
#pragma once

#include <boost/json.hpp>
#include <string>
#include <chrono>

namespace audit {

struct AuditEntry {
  std::string id;
  std::string timestamp;
  std::string userId;
  std::string username;
  std::string action;
  std::string resourceType;
  std::string resourceId;
  std::string details;
  std::string ipAddress;
  std::string prevHash;
  std::string hash;
};

class AuditService {
public:
  AuditService(const std::string& dbUrl);
  
  bool logAction(
    const std::string& userId,
    const std::string& username,
    const std::string& action,
    const std::string& resourceType,
    const std::string& resourceId,
    const std::string& details,
    const std::string& ipAddress,
    std::string& error
  );

private:
  std::string dbUrl_;
  std::string computeHash(const AuditEntry& entry);
};

}
```

---

## TIMELINE RESUMIDO

```
DAY 1 (Lunes):     Kickoff + Setup + Workflow verification
DAY 2-3:           Hallazgo #1 (Cover/TOC) + #2 (Konva)
DAY 4-5:           Hallazgo #3 (Workflow) + #4 (IDOR)
DAY 6-7:           Hallazgo #5 (Hypertables) + Sprint 1 integration
DAY 8-10:          Hallazgo #6 (Auditoría)
DAY 11-12:         Testing + Pentest
DAY 13:            Hotfixes
DAY 14:            Release v0.1
```

---

**Documento Actualizado**: 2026-07-03 | Listo para que equipo comience
