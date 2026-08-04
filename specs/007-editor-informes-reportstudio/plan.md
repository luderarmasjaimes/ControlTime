# PLAN 007 — Editor de informes ReportStudio + exportación

| Campo | Valor |
|---|---|
| **Spec** | `specs/007-editor-informes-reportstudio/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S5, S7 · R3-R4 |
| **Constitución** | Art. 1 (multitenant), Art. 2 (durabilidad), Art. 6 (auditoría) |
| **Última revisión** | 2026-06-24 (auditado contra `report_service.cpp`, `report_routes.cpp`) |

---

## 1. Enfoque técnico

**CRUD de informes técnicos** con contenido estructurado (JSON rich-text) y
**autosave periódico** para cumplir O2 (<0.5s). Los informes son scoped por empresa
(`company_name` en BD), jamás visibles cross-tenant. La exportación a PDF/Word
se realiza en el servidor (no en browser) para garantizar O3 (<5s).

## 2. Arquitectura

```
 Frontend (rich-text editor)
   │
   ├── [cada 3s o en blur] POST /api/reports/{id}/content ──► primario
   │           (autosave, O2: < 0.5 s)
   │
   ├── GET /api/reports ──────────────────────────────────────► réplica
   │   (lista, filtra por company_name de la sesión)
   │
   ├── GET /api/reports/{id} ─────────────────────────────────► réplica
   │   (sólo si company_name == sesión.company)
   │
   ├── POST /api/reports/{id}/export ─────────────────────────► primario
   │   (genera PDF/Word en servidor, stream al cliente, O3: < 5 s)
   │
   └── DELETE /api/reports/{id} (soft delete, deleted_at) ────► primario

 PostgreSQL
   ├── projects (id, name, description)
   └── reports  (id, project_id, title, content_json, status,
                 created_at, updated_at, deleted_at, company_name)
```

## 3. Modelo de datos

```sql
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id),
  title        TEXT NOT NULL DEFAULT 'Sin título',
  content_json JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','review','approved','archived')),
  company_name TEXT NOT NULL,          -- tenant (denormalizado para queries rápidas)
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ             -- soft delete
);

-- Índices
CREATE INDEX ON reports (company_name, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON reports (project_id) WHERE deleted_at IS NULL;
```

`content_json` almacena el grafo del editor rich-text (nodos/bloques). No se usa
TEXT ni Markdown para mantener la estructura editable en el frontend sin reparsear.

## 4. Endpoints (contratos)

| Método | Ruta | Lógica | Primario/Réplica |
|---|---|---|---|
| GET | `/api/reports` | lista de informes de la empresa | réplica |
| POST | `/api/reports` | crear informe (company = sesión) | primario |
| GET | `/api/reports/{id}` | leer informe (verifica company) | réplica |
| PUT/PATCH | `/api/reports/{id}/content` | autosave (upsert content_json + updated_at) | primario |
| PATCH | `/api/reports/{id}/status` | cambiar estado (requiere rol ≥ manager) | primario |
| DELETE | `/api/reports/{id}` | soft delete (sets deleted_at) | primario |
| POST | `/api/reports/{id}/export` | genera PDF o DOCX → stream | primario |
| GET | `/api/projects` | proyectos (global, sin tenant) | réplica |
| POST | `/api/projects` | crear proyecto | primario |

## 5. Autosave y durabilidad (O2, Art. 2)

- El frontend envía `PATCH /api/reports/{id}/content` cada 3 s (o en `blur`).
- El backend hace `UPDATE reports SET content_json=$1, updated_at=now() WHERE id=$2 AND company_name=$3`.
- Tiempo objetivo: < 0.5 s (el UPDATE es sobre una fila por PK → trivial).
- Conflictos concurrentes (dos pestañas): `updated_at` se usa para last-write-wins
  (no merge). En v1 es suficiente (usuarios editando desde una sola sesión).

## 6. Exportación (O3)

- Backend usa `libharu` (PDF nativo C++) o llama a un proceso externo (`pandoc`,
  `wkhtmltopdf`) para convertir `content_json` → HTML → PDF/DOCX.
- El resultado se stream via `Content-Type: application/pdf` o `application/vnd.openxmlformats`.
- Objetivo O3: < 5 s para un informe típico de 50 páginas.

## 6b. Auditoría de cambios (real en código)

Confirmado en `report_service.cpp`: `createReportPg`, `updateReportPg` y `deleteReportPg`
aceptan parámetros de auditoría (`auditUsername`, `auditCompany`, `auditToken`) y si no
están vacíos abren una transacción con:
```cpp
pgExecAuditContextFromLogin(conn, auditUsername, auditCompany, auditToken);
// → llama fn_audit_context_from_login() → triggers escriben en platform_audit_log
```
Esto garantiza que cada CREATE/UPDATE/DELETE de informe quede registrado con contexto de
usuario en `platform_audit_log` (Art. 6 — trazabilidad completa).

**Soft delete confirmado:** `deleteReportPg` hace:
```sql
UPDATE reports SET deleted_at = NOW()
WHERE id = $id AND company_name = $company AND deleted_at IS NULL
```
Los informes borrados no aparecen en listados (`WHERE deleted_at IS NULL`) pero permanecen
en BD para auditoría.

## 7. Seguridad / multitenant (Art. 1, 6)

```cpp
// report_service.cpp — todos los listados y getById usan company_name de la sesión
std::string sql =
    "SELECT id, title, status, created_at, updated_at FROM reports "
    "WHERE deleted_at IS NULL AND company_name = " + pqEscapeLiteral(conn, company) +
    " ORDER BY created_at DESC";
```
Incluso si el cliente envía un UUID de informe de otra empresa, el filtro
`AND company_name = $company` hace que el backend devuelva `report_not_found`.

## 8. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-007-1 | `content_json JSONB` (no Markdown/TEXT) — estructura preservada sin reparseo | Aceptado |
| ADR-007-2 | `company_name` denormalizado en `reports` (no solo FK a `companies`) — queries rápidas sin JOIN | Aceptado |
| ADR-007-3 | Soft delete (`deleted_at`) — los informes borrados siguen auditables | Aceptado |
| ADR-007-4 | Autosave cada 3 s (no WebSocket ni CRDT) — suficiente para un solo editor | Aceptado |

## 9. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Crear informe, editar, autosave, recargar → contenido persiste | demo grabada |
| CA-2 | Autosave: tiempo de respuesta de PATCH < 0.5 s (O2) | `curl -w %{time_total}` |
| CA-3 | Export PDF de informe con imágenes → descarga en < 5 s (O3) | medición |
| CA-4 | Empresa A ve solo sus informes; empresa B sin acceso | query cross-tenant |
| CA-5 | Delete → `deleted_at` se setea; no aparece en lista | SQL verif. |
| CA-6 | Status change sin rol manager → 403 | curl con token operador |
