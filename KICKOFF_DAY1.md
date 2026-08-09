# 🎯 DAY 1 KICKOFF — LUNES (HOY)

**Duración Total**: 8 horas  
**Hora Inicio**: 09:00  
**Hora Fin**: 17:00

---

## 09:00-09:15 — ALL TEAM: Sync Inicial (15 min)

**Lugar**: Videocall o sala reunión  
**Agenda**:
1. Confirmar asignaciones
2. Resolver blockers iniciales
3. Preguntas rápidas

**Presentador**: Tech Lead  
**Materiales**: Este documento + IMPLEMENTATION_GUIDE.md

---

## 09:15-10:00 — Cada Equipo: Setup Local (45 min)

### Frontend Dev (1-2 personas)

```bash
# Terminal 1: Setup Git
cd ~/projects/InformeCliente
git fetch origin
git checkout main && git pull
git checkout -b feature/v01-hallazgos
git push -u origin feature/v01-hallazgos

# Terminal 2: Setup Node
cd frontend
npm install --legacy-peer-deps  # Si hay conflictos
npm run dev
# ✅ Verificar: http://localhost:5173 muestra ReportStudio

# Crear branch personal
git checkout -b feature/01-cover-toc
```

**Checklist**:
- [ ] npm run dev muestra UI sin errores
- [ ] ReportStudioV2 carga
- [ ] Puede insertar elementos (text, image, etc.)
- [ ] Zustand store accesible en DevTools

### Backend Dev (1-2 personas)

```bash
# Setup Git
cd ~/projects/InformeCliente
git fetch origin
git checkout main && git pull
git checkout -b feature/v01-hallazgos
git push -u origin feature/v01-hallazgos

# Setup CMake
cd backend
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release

# Crear branch personal
git checkout -b feature/01-cover-toc-api
```

**Checklist**:
- [ ] CMake configura sin errores
- [ ] Build completa en <5 min
- [ ] Binary generado: backend/build/mapas_backend (o .exe en Windows)

### DevOps/BD (1 persona)

```bash
# Conectar a BD
psql -d formula_db -U postgres -h localhost

# Verificar
SELECT version();  -- Debería ver PostgreSQL 15+

# Conectar a sensors_db
psql -d sensors_db -U postgres -h localhost
SELECT COUNT(*) FROM mineria_lecturas LIMIT 1;
```

**Checklist**:
- [ ] Conexión exitosa a formula_db
- [ ] Conexión exitosa a sensors_db
- [ ] Puede ejecutar queries

---

## 10:00-12:00 — PARALELO: Tareas Independientes (2 horas)

### Frontend Dev: Revisar Código (2 horas)

**Tarea**: Entender estructura de miningReportFormat.js

```bash
# Abrir archivo
code frontend/src/components/ReportStudioV2/lib/miningReportFormat.js

# Leer secciones:
# 1. Lines 1-50: Exports y utils
# 2. Lines 80-120: exportMiningReport()
# 3. Lines 125-135: downloadMiningReport()
# 4. Lines 140-160: importMiningReport()

# Entender ESTRUCTURA JSON actual
# Buscar: "pages", "elements", "type"
```

**Tomar Notas**:
- ¿Qué tipos de bloque hay ahora? (text, image, table, sensor, kpi, chart, ?)
- ¿Dónde se define enum de tipos?
- ¿Cómo se serializa cada tipo?
- ¿Dónde está el schema de validación?

**Crear Draft PR**:
```bash
git add -A
git commit -m "WIP: Feature/01-cover-toc initial structure"
git push origin feature/01-cover-toc
# Crear PR en GitHub (Mark as DRAFT)
# Descripción: Agrega tipos 'cover' y 'toc' a miningReportFormat.js
```

### Backend Dev: Audit de Endpoints (2 horas)

**Tarea**: Crear checklist de todos los endpoints

```bash
# Abrir archivo
code backend/src/reports/report_routes.cpp

# Buscar todos los handleGetXxx, handlePostXxx, handlePutXxx, handleDeleteXxx
grep -n "^static http::response" backend/src/reports/report_routes.cpp
grep -n "^static http::response" backend/src/auth/auth_routes.cpp
grep -n "^static http::response" backend/src/mining/mining_routes.cpp

# Para CADA endpoint, verificar:
# - ¿Llama a resolveAuthSession()?
# - ¿Usa session->company para filtrar?
# - ¿Valida que el recurso pertenece al tenant?
```

**Crear SECURITY_AUDIT_CHECKLIST.md**:
```markdown
# Security Audit — Endpoint Tenant Validation

## Reports Module (report_routes.cpp)
- [ ] GET /api/reports — session->company ✅ (line 44)
- [ ] GET /api/reports/{id} — session->company ✅ (line 71)
- [ ] POST /api/reports — session->company ✅ (line ??)
- [ ] PUT /api/reports/{id} — session->company ✅ (line ??)
- [ ] DELETE /api/reports/{id} — session->company ✅ (line ??)

## Auth Module (auth_routes.cpp)
- [ ] GET /api/users — ? (line ??)
- [ ] GET /api/users/{id} — ? (line ??)
- [ ] PUT /api/users/{id} — ? (line ??)
... etc
```

**Crear Draft PR**:
```bash
git add SECURITY_AUDIT_CHECKLIST.md
git commit -m "WIP: Security audit checklist"
git push origin feature/v01-hallazgos
```

### DevOps/BD: Workflow State Verification (2 horas)

**TAREA CRÍTICA**: Determinar exactamente qué usa BD hoy.

```bash
# Ejecutar queries
psql -d formula_db -U postgres << 'SQL'

-- 1. Ver valores de status en tabla reports
SELECT status, COUNT(*) as count FROM reports 
GROUP BY status ORDER BY count DESC;

-- 2. Ver definición de columna
\d reports
-- Buscar línea "status"

-- 3. Ver si hay constraint
SELECT constraint_name, constraint_definition 
FROM information_schema.table_constraints t
WHERE t.table_name='reports'
AND t.constraint_type='CHECK';

-- 4. Ver script que define tabla
SELECT pg_get_constraintdef(oid) FROM pg_constraint 
WHERE conrelid = 'reports'::regclass;

SQL
```

**Documentar Resultado** en Slack #dev:
```
📋 Workflow States — BD Status Report

Valores encontrados en BD:
- [list them]

Observaciones:
- [Current constraint if any]
- [Default value if any]

Conclusión:
BD usa [review / in_review / other]

NEXT STEP: Validar si Frontend envía lo mismo ✅ o necesita cambio ❌
```

**Crear script de migración template**:
```sql
-- db_scripts/30_workflow_states_migration.sql
BEGIN;

-- Migración propuesta: cambiar estados a canónico
-- Current: [list]
-- Proposed: draft, in_review, approved, signed, archived, rejected

-- Placeholder para migración
-- UPDATE reports SET status = 'in_review' WHERE status = 'review';

COMMIT;
```

**Crear Draft PR**:
```bash
git add db_scripts/30_workflow_states_migration.sql
git commit -m "WIP: Workflow states migration template"
git push origin feature/v01-hallazgos
```

---

## 12:00-13:00 — ALMUERZO (1 hora)

---

## 13:00-15:00 — Equipo Completo: Workflow Verification Sync (2 horas)

**Lugar**: Sync virtual  
**Agenda**:
1. **DevOps/BD presenta**: Hallazgos de BD (10 min)
   - ¿Qué valores de status hay?
   - ¿Qué dice el script 19?
   
2. **Frontend Dev valida**: ¿Qué envía el frontend? (10 min)
   - Grep "review" en WorkflowPanel.jsx
   - Ver qué estados están hardcodeados
   
3. **Backend Dev valida**: ¿Qué acepta el backend? (10 min)
   - Grep en report_service.cpp
   - Ver si hay validación de transiciones
   
4. **Compilar Decisión**: (20 min)
   - Opción A: Cambiar BD a 'in_review' (recomendado)
   - Opción B: Cambiar Frontend a 'review' (no recomendado)
   - Opción C: Cambiar Backend a aceptar ambos (parche)
   
5. **Definir Orden de Deploy**: (10 min)
   - Si cambio BD: BD → Backend → Frontend
   - Timeline: Day 3 Morning, Day 3 Afternoon, Day 4 Morning

**Outcome Esperado**:
- ✅ Decisión tomada
- ✅ Script de migración final
- ✅ Timeline confirmado
- ✅ Documentado en Slack + IMPLEMENTATION_GUIDE.md

---

## 15:00-16:00 — Cada Equipo: Crear Branches Finales (1 hora)

**Frontend Dev**:
```bash
# Si aún no lo hizo
git checkout -b feature/02-konva-persist
git checkout -b feature/03-workflow-ui
git push -u origin feature/02-konva-persist
git push -u origin feature/03-workflow-ui
```

**Backend Dev**:
```bash
git checkout -b feature/03-workflow-be
git checkout -b feature/04-idor-audit
git push -u origin feature/03-workflow-be
git push -u origin feature/04-idor-audit
```

**DevOps/BD**:
```bash
git checkout -b feature/03-workflow-bd
git checkout -b feature/05-hypertables
git push -u origin feature/03-workflow-bd
git push -u origin feature/05-hypertables
```

---

## 16:00-17:00 — Stand-up Final (1 hora)

**Cada equipo reporta**:
1. ✅ Setup completo?
2. ✅ Branches creadas?
3. ✅ PRs draft creadas?
4. ❓ Blockers encontrados?

**Tech Lead**:
- Compila hallazgos del día
- Confirma timeline para mañana
- Asigna responsables por tarea
- Responde preguntas

---

## 📋 CHECKLIST EOD (Fin de Día)

**Frontend Dev**:
- [ ] npm run dev funciona
- [ ] Entendí estructura de miningReportFormat.js
- [ ] Draft PR creada en GitHub
- [ ] Branches 01, 02, 03 creadas localmente

**Backend Dev**:
- [ ] CMake build completa sin errores
- [ ] SECURITY_AUDIT_CHECKLIST completado
- [ ] Draft PR creada en GitHub
- [ ] Branches 01, 03, 04 creadas localmente

**DevOps/BD**:
- [ ] Conexión a BD confirada
- [ ] Queries de workflow state completadas
- [ ] Script de migración template creado
- [ ] Resultado documentado en Slack
- [ ] Branches 03, 05 creadas localmente

**Tech Lead**:
- [ ] Workflow state decision tomada
- [ ] Deploy order confirmado
- [ ] Timeline actualizado en IMPLEMENTATION_GUIDE.md
- [ ] Sync mañana 09:00 scheduled

---

## Mañana (DAY 2)

**Frontend Dev**: Empezar implementación de HALLAZGO #1 (Cover/TOC serialización)  
**Backend Dev**: Empezar HALLAZGO #1 (API validation) + HALLAZGO #4 (IDOR audit)  
**DevOps/BD**: Ejecutar migración workflow states en dev DB

---

**Generated**: 2026-07-03 | Imprime este documento y tenlo a mano
