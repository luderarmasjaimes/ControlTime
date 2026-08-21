# SPEC 006 — Autenticación, RBAC, multitenant y auditoría

| Campo | Valor |
|---|---|
| **ID** | 006 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | KPI **O7** (100% acciones auditadas), Seguridad (S3-S4, R2; hardening S9) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (seguridad/trazabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-006**; fuente ADR: `docs/decisions/`.

- **ADR-029** — [`029-rbac-identidad-plataforma-jwt.md`](../../docs/decisions/029-rbac-identidad-plataforma-jwt.md)
- **ADR-030** — [`030-auditoria-100-acciones-server.md`](../../docs/decisions/030-auditoria-100-acciones-server.md)
- **ADR-036** — [`036-rbac-siete-roles-unificados.md`](../../docs/decisions/036-rbac-siete-roles-unificados.md)
- **ADR-043** — [`043-endurecimiento-seguridad-pre-pentest.md`](../../docs/decisions/043-endurecimiento-seguridad-pre-pentest.md)
- **ADR-058** — [`058-auditoria-seguridad-integral-jul2026.md`](../../docs/decisions/058-auditoria-seguridad-integral-jul2026.md)
- **ADR-063** — [`063-correccion-rbac-siete-roles-asignables.md`](../../docs/decisions/063-correccion-rbac-siete-roles-asignables.md)
- **ADR-066** — [`066-login-usa-razon-social-minera-no-contratista.md`](../../docs/decisions/066-login-usa-razon-social-minera-no-contratista.md)
- **ADR-067** — [`067-autoregistro-provisiona-tenant-real.md`](../../docs/decisions/067-autoregistro-provisiona-tenant-real.md)
- **ADR-073** — [`073-modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon.md`](../../docs/decisions/073-modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon.md)
- **ADR-075** — [`075-internacionalizacion-pais-idioma-acceso.md`](../../docs/decisions/075-internacionalizacion-pais-idioma-acceso.md)
- **ADR-076** — [`076-separacion-identificadores-secretos-csprng.md`](../../docs/decisions/076-separacion-identificadores-secretos-csprng.md)
- **ADR-077** — [`077-migracion-password-argon2id-versionada.md`](../../docs/decisions/077-migracion-password-argon2id-versionada.md)
- **ADR-078** — [`078-alta-administrada-empresa-tenant-deduplicada.md`](../../docs/decisions/078-alta-administrada-empresa-tenant-deduplicada.md)
- **ADR-085** — [`085-crud-empresas-y-pantalla-administracion.md`](../../docs/decisions/085-crud-empresas-y-pantalla-administracion.md)
- **ADR-086** — [`086-rbac-granular-empresas-view-manage.md`](../../docs/decisions/086-rbac-granular-empresas-view-manage.md)
- **ADR-087** — [`087-validacion-ruc-registro-externo-opcional.md`](../../docs/decisions/087-validacion-ruc-registro-externo-opcional.md)
- **ADR-088** — [`088-seed-empresas-distribuidoras-usuarios-demo.md`](../../docs/decisions/088-seed-empresas-distribuidoras-usuarios-demo.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-100** — [`100-onnxruntime-thread-limit-insightface.md`](../../docs/decisions/100-onnxruntime-thread-limit-insightface.md)
- **ADR-101** — [`101-fix-bucle-reintento-registro.md`](../../docs/decisions/101-fix-bucle-reintento-registro.md)
- **ADR-102** — [`102-validacion-fiscal-ecuador-chile-costa-rica-fallback.md`](../../docs/decisions/102-validacion-fiscal-ecuador-chile-costa-rica-fallback.md)
- **ADR-106** — [`106-accesibilidad-contraste-formularios-ui.md`](../../docs/decisions/106-accesibilidad-contraste-formularios-ui.md)
- **ADR-107** — [`107-geolocalizacion-cliente-login-contrasena.md`](../../docs/decisions/107-geolocalizacion-cliente-login-contrasena.md)


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
