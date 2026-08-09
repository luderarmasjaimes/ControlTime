# SPEC 006 — Autenticación, RBAC, multitenant y auditoría

| Campo | Valor |
|---|---|
| **ID** | 006 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | KPI **O7** (100% acciones auditadas), Seguridad (S3-S4, R2; hardening S9) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (seguridad/trazabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-006**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)

## Decisiones vigentes complementarias

- **ADR-029** — JWT híbrido, refresh HttpOnly y CSRF `csrf_token_v2`.
- **ADR-043/058** — hardening y auditoría de seguridad.
- **ADR-066/067** — razón social minera y tenant real en autoregistro.
- **ADR-073/075** — diálogos accesibles e internacionalización del acceso.
- **ADR-076** — IDs DB-safe y secretos CSPRNG implementados.
- **ADR-077** — Argon2id y rehash oportunista legacy implementados.
- **ADR-078** — alta administrada de empresa con tenant real y deduplicación.

> ADR-076 y ADR-077 tienen código, Catch2, despliegue y E2E. El verificador
> legacy se conserva hasta que su inventario llegue a cero.


## 1. Problema
Varias empresas mineras comparten la plataforma; cada usuario debe ver y operar
**solo** lo de su empresa, con permisos por rol, y **toda acción sensible debe
quedar auditada** (requisito contractual O7 = 100%).

## 2. Objetivo
Acceso seguro por empresa + usuario, con control de permisos por rol (RBAC),
aislamiento multitenant total y auditoría completa de acciones.

## 3. Usuarios y contexto
- **Roles:** admin de empresa, operador, gerente, analista, auditor.
- **Multitenant:** login resuelve empresa; toda sesión lleva `tenant_id`.

## 4. Alcance
**Incluye:** login por empresa+credencial (password/face), gestión de usuarios,
RBAC, auditoría y su exportación. **NO incluye:** la biometría facial en sí (008),
SSO externo.

## 5. Criterios de aceptación
- [ ] **CA-1:** Login valida empresa + identidad; sesión emitida lleva `tenant_id` y rol.
- [ ] **CA-2:** (multitenant) Ningún endpoint devuelve datos fuera del `tenant_id` de la sesión.
- [ ] **CA-3:** (RBAC) Endpoints sensibles responden `unauthorized` / `admin access required` sin el rol adecuado (comportamiento por defecto = denegar).
- [ ] **CA-4:** **100% de acciones sensibles** (login, alta/baja usuario, cambios) quedan en `auth_audit_logs` con usuario, empresa, acción, resultado, timestamp.
- [ ] **CA-5:** La auditoría es exportable (`/api/auth/audit/export.csv`) e inmutable (solo append).
- [ ] **CA-6:** Roles separados de BD: escritura (ingesta) vs `dashboard_ro` (lectura) — la analítica no puede escribir.
- [x] **CA-7:** Login y registro de persona/empresa permiten seleccionar país
  e idioma desde la primera pantalla; soportan español, inglés, francés y
  portugués de Brasil, persisten la preferencia y actualizan `<html lang>`.
- [x] **CA-8:** Campos, ayudas, botones, tooltips, estados y mensajes del flujo
  de acceso están traducidos; el documento fiscal y prefijo telefónico se
  adaptan al país sin cambiar la empresa minera que define el tenant.
- [x] **CA-9:** Auditoría, cambio de unidad, mantenimiento y confirmaciones
  sensibles usan avisos propios accesibles y traducidos; no dependen de
  `alert`, `confirm` o `prompt` nativos.
- [x] **CA-10:** El smoke real cubre alta, contraseña, rostro, auditoría/CSV,
  refresh con cookie HttpOnly + CSRF y logout; las identidades de prueba y los
  UUID de usuario tienen longitud determinista.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Auditoría | 100% (O7) |
| Hash de contraseña | algoritmo fuerte, salteado |
| Sesión | token con expiración; revocación |
| Internacionalización | `es-PE`, `en-US`, `fr-CA`, `pt-BR`; cambio inmediato y fallback local |

## 7. Contratos (endpoints reales)
- `GET /api/auth/companies`, `GET/POST /api/auth/login/check-identity`, `GET /api/auth/validate-company`
- `POST /api/auth/login/password`, `POST /api/auth/login/face`, `POST /api/auth/register`
- `GET /api/auth/users`, `POST /api/auth/users/maintenance`, `GET /api/auth/users/maintenance/audit`
- `GET /api/auth/audit`, `GET /api/auth/audit/export.csv`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Fuga cross-tenant por query sin filtro | revisión: todo query lleva `tenant_id`; tests multitenant |
| Auditoría incompleta | trigger/guardas en escritura; gate de seguridad pre-R4 |
