# TASKS 006 — Autenticación, RBAC, multitenant y auditoría

| Campo | Valor |
|---|---|
| **Plan** | `specs/006-auth-rbac-multitenant/plan.md` |
| **Sprint·Release** | S3-S4 · R2 |
| **Responsables** | BE1 (C++/auth), BE3 (DBA/schema), QA |
| **Última revisión** | 2026-06-24 v2 (T21+T22 implementados — rate limiting + logout/refresh) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Schema SQL: `auth_companies`, `auth_users`, `auth_sessions`, `auth_audit_logs` | CA-1,CA-4 | BE3 | Sonnet | ☑ |
| **T2** | `REVOKE UPDATE, DELETE ON auth_audit_logs` — inmutabilidad por BD | CA-4,CA-5 | BE3 | Haiku | ☑ |
| **T3** | `authLookupIdentityForCompanyPg` — resolución de identidad (empresa + DNI/usr) | CA-1 | BE1 | **Opus** (seguridad) | ☑ |
| **T4** | `POST /api/auth/login/password` — bcrypt verify + emit token + audit INSERT | CA-1,CA-4 | BE1 | **Opus** | ☑ |
| **T5** | `POST /api/auth/login/face` — delegar a spec 008 + emit token si ok | CA-1 | BE1 | Sonnet | ☑ |
| **T6** | `resolveAuthSession(req, query)` — lookup token → {tenant_id, rol, username} | CA-2,CA-3 | BE1 | **Opus** | ☑ |
| **T7** | `GET /api/auth/companies` — lista empresas activas (PG o fallback fichero) | CA-1 | BE1 | Haiku | ☑ |
| **T8** | `GET/POST /api/auth/login/check-identity` — resuelve username | CA-1 | BE1 | Sonnet | ☑ |
| **T9** | `GET /api/auth/validate-company` — valida RUC (11 dígitos numéricos) | CA-1 | BE1 | Haiku | ☑ |
| **T10** | `POST /api/auth/register` + `GET /api/auth/users` (solo admin) | CA-3 | BE1 | Sonnet | ☑ |
| **T11** | `POST /api/auth/users/maintenance` — baja/reset (audit INSERT) | CA-3,CA-4 | BE1 | Sonnet | ☑ |
| **T12** | `GET /api/auth/audit` — historial paginado (solo admin/auditor) | CA-5 | BE1 | Sonnet | ☑ |
| **T13** | `GET /api/auth/audit/export.csv` — COPY stream (sin cargar en memoria) | CA-5 | BE1 | Sonnet | ☑ |
| **T14** | Dual storage: `AuthStorageMode::File` para desarrollo local | dev UX | BE1 | Haiku | ☑ |
| **T15** | **Test CA-1**: login válido → response contiene `tenant_id` + `role` | CA-1 | QA | — | ☑ |
| **T16** | **Test CA-2**: token empresa A → 0 filas de empresa B | CA-2 | QA | — | ☑ |
| **T17** | **Test CA-3**: endpoint admin con token operador → 403 | CA-3 | QA | — | ☑ |
| **T18** | **Test CA-4**: login → fila en `auth_audit_logs` | CA-4 | QA | — | ☑ |
| **T19** | **Test CA-5**: export.csv → todas las filas, CSV válido | CA-5 | QA | — | ☑ |
| **T20** | Token expirado → 401 (test negativo) | Neg | QA | — | ☑ |
| **T21** | Rotación de tokens: `POST /api/auth/logout` + `POST /api/auth/refresh` (token nuevo, viejo revocado) | S9 | BE1 | **Opus** | ✅ |
| **T22** | Rate limiting login: 5 fallos / 5 min por `company\|username` → 429 con mensaje | S9/seguridad | BE1 | Sonnet | ✅ |

> **Nota de auditoría 2026-06-24:** El mecanismo de auditoría usa dos capas:
> 1. **`auth_audit_logs`** — INSERT directo desde código C++ (login, register, maintenance).
> 2. **`fn_audit_context_from_login()`** — función PG que establece GUC de sesión para que
>    triggers escriban en **`platform_audit_log`** (mig. 20-21). Ambas son complementarias.
>    El plan menciona `auth_audit_logs`; `platform_audit_log` es para auditoría de triggers DML.

## Secuencia

```
T1 ─► T2                          (schema + inmutabilidad)
T3 ─► T4 ─► T5 ─► T6             (flujo de auth: lookup→login→sesión)
T7 ─► T8 ─► T9                   (endpoints públicos)
T10 ─► T11                       (gestión de usuarios)
T12 ─► T13                       (auditoría)
T14 (paralelo, solo dev)
(T1-T14) ─► T15-T20 (tests)
T21, T22 (hardening S9, paralelo)
```

## Definition of Done

- [x] T1-T14 completadas (código en repo).
- [x] CA-1..CA-5 demostradas: login, aislamiento, RBAC, audit, export.
- [x] CA-6 (roles BD dashboard_ro) — enlazado a spec 004: T4 (`Crear rol dashboard_ro`) ya estaba ☑ ahí desde 2026-06; verificado 2026-08-30 que la infraestructura de réplica que lo consume sigue real y activa (PgBouncer primario confirmado, ver spec 004).
- [x] T21 — `POST /api/auth/logout` (revoca token) + `POST /api/auth/refresh` (rotación: token nuevo, viejo revocado; también limpia EMA de gafas).
- [x] T22 — Rate limiter en-memoria: 5 fallos/300 s por `company|username` → HTTP 429; se limpia en login exitoso.
- [x] ADR-006-1..5 registrados.
- [x] KPI O7 (100% auditado): `auth_audit_logs` cubre login, register, maintenance.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O7 Auditoría | 100% acciones | ☑ login + register + maintenance auditados |
| Login latencia | < 200 ms | ☑ bcrypt (~100ms) + PG lookup (~5ms) |
| Token expiración | 8h | ☑ |
