# PLAN 006 — Autenticación, RBAC, multitenant y auditoría

| Campo | Valor |
|---|---|
| **Spec** | `specs/006-auth-rbac-multitenant/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S3-S4 · R2 (hardening S9) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (seguridad), Art. 7 (disciplina IA) |

---

## 1. Enfoque técnico

Sistema de identidad propio (no OAuth externo en esta versión) con **tres capas**:

1. **Resolución de identidad** — empresa + credencial (usuario/DNI/RUC) → `username` normalizado.
2. **Login con factor** — contraseña (hash bcrypt) o biometría facial (delegado a spec 008).
3. **Sesión con `tenant_id` + rol** — token de sesión adjunto a cada request; todo handler
   lo resuelve con `resolveAuthSession(req, query)` y lo usa como filtro en BD.

La clave del diseño: **nada del código de negocio conoce `tenant_id` directamente** —
siempre lo extrae de la sesión resuelta. Esto hace imposible que un bug en un parámetro
de URL exponga datos de otra empresa (Art. 1 garantizado por diseño, no por convención).

## 2. Arquitectura

```
Cliente                   Backend C++                          PostgreSQL
  │                            │                                    │
  ├─ GET /companies ──────────►│─► auth_routes.cpp                 │
  │                            │   SELECT active companies          │─► auth_companies
  │                            │◄──────────────────────────────────┤
  ├─ GET /check-identity ─────►│─► authLookupIdentityForCompanyPg  │─► auth_users
  │   (empresa + DNI/usr)      │   normaliza → resolvedUsername     │
  │                            │                                    │
  ├─ POST /login/password ────►│─► bcrypt_verify(hash, password)   │─► auth_sessions (insert)
  │                            │   emit token (uuid, exp 8h)        │
  │◄── {token, tenant_id, rol} │                                    │
  │                            │                                    │
  ├─ [cualquier request] ─────►│─► resolveAuthSession(req,query)   │─► auth_sessions (SELECT)
  │   Authorization: Bearer …  │   → {tenant_id, rol, username}    │
  │                            │   handler usa tenant_id            │
  │                            │                                    │
  ├─ GET /audit ───────────────►│─► SELECT auth_audit_logs          │─► auth_audit_logs
  ├─ GET /audit/export.csv ───►│   → CSV stream                    │
```

## 3. Modelo de datos

```sql
-- Empresas (tenants)
CREATE TABLE auth_companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  ruc         TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Usuarios
CREATE TABLE auth_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES auth_companies(id),
  username    TEXT NOT NULL,
  dni         TEXT,
  password_hash TEXT,  -- bcrypt
  role        TEXT NOT NULL CHECK (role IN ('admin','operator','manager','analyst','auditor')),
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ON auth_users(company_id, username);

-- Sesiones
CREATE TABLE auth_sessions (
  token      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth_users(id),
  tenant_id  UUID REFERENCES auth_companies(id),
  role       TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auditoría (solo append, nunca DELETE/UPDATE)
CREATE TABLE auth_audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID,
  username   TEXT,
  action     TEXT NOT NULL,
  result     TEXT NOT NULL,
  detail     JSONB,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Sin índice en ts DESC para evitar actualización de índice en hot path
-- GRANT INSERT ON auth_audit_logs TO aurixa;
-- REVOKE UPDATE, DELETE ON auth_audit_logs FROM aurixa;
```

## 4. Endpoints (contratos)

| Método | Ruta | Lógica | Auth requerida |
|---|---|---|---|
| GET | `/api/auth/companies` | lista empresas activas | no |
| GET/POST | `/api/auth/login/check-identity` | empresa+identidad → username normalizado | no |
| GET | `/api/auth/validate-company` | empresa+RUC → válido | no |
| POST | `/api/auth/login/password` | username+password → token+tenant_id+rol | no |
| POST | `/api/auth/login/face` | foto base64 → verificación + token (delegado a 008) | no |
| POST | `/api/auth/register` | alta de usuario en empresa | admin |
| GET | `/api/auth/users` | lista usuarios de la empresa de la sesión | admin |
| POST | `/api/auth/users/maintenance` | dar de baja / resetear password | admin |
| GET | `/api/auth/users/maintenance/audit` | auditoría de cambios en usuarios | admin/auditor |
| GET | `/api/auth/audit` | historial de acciones (paginado) | admin/auditor |
| GET | `/api/auth/audit/export.csv` | descarga CSV completo | admin/auditor |

**Comportamiento por defecto = denegar.** `resolveAuthSession` devuelve `std::nullopt`
si el token es inválido/expirado → el handler devuelve 401 sin tocar BD de negocio.

## 5. RBAC (roles y permisos)

| Rol | Acceso |
|---|---|
| `admin` | todo en su empresa (sin cross-tenant) |
| `operator` | dashboard, sensores, reportes propios |
| `manager` | todo de operador + aprobaciones |
| `analyst` | datos, fórmulas, GIS (solo lectura) |
| `auditor` | solo auditoría (logs, export) |

Los checks de rol se hacen en cada handler explícitamente:
```cpp
if (!session || session->role != "admin")
    return makeJsonResponse(http::status::forbidden, ...);
```

## 6. Auditoría (Art. 6, KPI O7)

- Cada login (éxito/fallo), registro de usuario, cambio de contraseña, baja de
  usuario → `INSERT INTO auth_audit_logs(tenant_id, username, action, result, detail)`.
- La tabla tiene `REVOKE UPDATE, DELETE` → inmutable por diseño.
- El export CSV usa `COPY ... TO stdout` para stream sin cargar en memoria.
- **KPI O7**: 100% de acciones de gestión auditadas → verificable consultando la tabla.

## 7. Seguridad (Art. 6)

- Contraseñas: bcrypt (factor configurable, default 12).
- Tokens: UUID v4 random (128 bits), no firmados (simple lookup en BD).
  → ADR-006-2: JWT firmado sería más escalable pero añade complejidad (secreto, rotación).
- `statement_timeout=15s` en rol `dashboard_ro` (no puede hacer queries largas de auditoría).
- El fallback a fichero (`AuthStorageMode::File`) existe para desarrollo local sin BD.

## 8. Decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-006-1 | `tenant_id` **siempre de la sesión** — nunca de parámetro URL/body | Aceptado |
| ADR-006-2 | Token de sesión como UUID en BD (no JWT firmado) en v1 | Aceptado (rev. en S9) |
| ADR-006-3 | `auth_audit_logs` con `REVOKE UPDATE/DELETE` — inmutable por BD, no por código | Aceptado |
| ADR-006-4 | Dual storage (Postgres/File) — facilita dev local sin Docker DB | Aceptado |
| ADR-006-5 | RBAC explícito en cada handler (no middleware centralizado) | Aceptado (explicitness > magia) |

## 9. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Login válido → response contiene `tenant_id` y `role` | curl response |
| CA-2 | Token empresa A consulta datos → 0 filas de empresa B | inspección query |
| CA-3 | Endpoint admin con token de operador → 403 | curl response |
| CA-4 | Login → verificar fila en `auth_audit_logs` | SELECT post-login |
| CA-5 | `GET /api/auth/audit/export.csv` → CSV válido, todas las filas | wc -l |
| CA-6 | `dashboard_ro` intenta INSERT en replica → rechazado | test de escritura |
| Neg | Token expirado → 401 | curl con token viejo |
| Neg | RUC con 10 dígitos → validate-company rechaza | curl |
