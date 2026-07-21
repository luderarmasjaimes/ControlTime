# ADR-066 — El registro/login del contratista usa la razón social de la empresa MINERA, no la propia

**Status**: implemented, verificado (2026-07-21). Confirmado contra el backend real: un registro con la empresa minera asociada seleccionada ahora resuelve `tenant_id` real (antes quedaba vacío).
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: plataforma

## Contexto

`Auditoria_Registro_RUC_Tenant_2026-07-21.md` documentó un bug real en la pestaña de registro de "empresa contratista" (`AuthGateway.tsx`): el formulario capturaba correctamente la **empresa minera asociada** (selector con empresas reales, usado también para la validación de RUC), pero al enviar el registro (`handleRegister`) **sobreescribía el campo `company`** con `contractorLegalName` (la razón social del contratista, texto libre) antes de llamar a `POST /api/auth/register`:

```ts
const registrationPayload =
    registerTab === 'company'
        ? { ...registerForm, company: String(registerForm.contractorLegalName || '').trim() }
        : registerForm
```

Consecuencia verificada contra el código de persistencia (`auth_storage_pg.cpp`): `POST /api/auth/register` crea una fila nueva en `auth_companies` para **lo que llegue en `company`** — con el bug, la razón social del contratista, que no tiene ninguna fila correspondiente en `mineria_empresas` (la tabla que sí tiene `tenant_id`). El contratista quedaba autenticado (token válido) pero con `tenant_id` vacío — el fallo recién aparecía después, al intentar crear un informe (`tenant_required`, bloqueado correctamente por `userHasRealTenantMembership`, ADR-039), no en el momento del registro.

Gerencia decidió (pedido explícito, 2026-07-21): **para el login, debe usarse la razón social de la compañía minera — no la de la empresa contratista.**

## Decisión

`handleRegister` ya no sobreescribe `company`. Se envía `registerForm` tal cual para ambas pestañas (`'user'` y `'company'`) — el campo `company` conserva siempre el valor elegido en el `<select>` de empresa (real, existente en el catálogo), sea la pestaña de autoregistro normal o la de contratista.

`contractorLegalName` **se sigue capturando y enviando** en el payload (sigue siendo un campo requerido en la validación del formulario, `valuesOk`) — queda disponible como dato informativo del contratista, pero **ya no determina la identidad de empresa/tenant** del usuario registrado. El backend no tiene hoy ningún campo que persista `contractorLegalName` de forma distinta a como ya lo hacía (lo ignora si no lo reconoce, igual que antes) — este ADR no agrega esa persistencia; ver "Alcance no incluido" abajo.

### Verificación real

Registro simulado contra el backend real con el nuevo payload (`company: "Minera Raura"`, `contractorLegalName: "Servicios Mineros ABC SAC"` como campo aparte):

```
REGISTER  → status: registered · company: "Minera Raura" · tenant_id: a0000001-0000-4000-8000-000000000001
LOGIN     → status: authenticated · tenant_id: a0000001-0000-4000-8000-000000000001
```

`tenant_id` resuelve a un UUID real (antes del fix, con el mismo escenario, habría resuelto vacío) — el contratista queda correctamente vinculado a la unidad minera que seleccionó, y puede operar con permisos reales sobre ese tenant desde el primer login.

## Consecuencias

### Positivas
- Un contratista registrado ya puede crear informes desde su primer login — antes quedaba con una cuenta "fantasma" sin tenant real, y el error solo aparecía después de completar todo el flujo (incluida la biometría).
- Cambio mínimo y quirúrgico (una línea de lógica eliminada) — no requirió tocar el backend ni el esquema de datos, porque el problema era exclusivamente de qué valor enviaba el frontend.

### Negativas / Trade-offs
- **`contractorLegalName` queda como dato capturado pero no persistido en ningún lugar distintivo** — hoy no hay forma de saber, mirando la lista de usuarios de "Minera Raura", cuáles son empleados directos y cuáles son de una empresa contratista, ni cuál. Si Gerencia necesita esa distinción a futuro (p. ej. para reportes de personal por contratista), hace falta una decisión de producto aparte: un campo real en el backend (`contractor_name` en la tabla de usuarios, o similar) — **no incluido en este ADR**, que solo resuelve el problema de login/tenant pedido explícitamente.
- Todos los contratistas de una misma empresa minera comparten el mismo tenant que los empleados directos de esa minera — es el comportamiento correcto y pedido (el contratista opera "bajo" la minera), pero implica que el control de acceso entre contratistas de la misma minera, si se necesita, depende de RBAC por rol (ADR-036/063), no de aislamiento por tenant.

### Neutras
- La validación de RUC (`validateCompany`) no cambia — seguía (y sigue) usando `registerForm.company` desde antes del fix, no se vio afectada por el bug ni por esta corrección.

## Alcance no incluido (decisión pendiente de Gerencia, no resuelta aquí)

Del Hallazgo B de la auditoría (el parámetro `company` de `validate-company` nunca se compara contra el RUC) y del Hallazgo G2 del catálogo QA (creación de empresas sin endpoint) — **ninguno de los dos se resuelve en este ADR**. Este ADR resuelve exclusivamente el punto que Gerencia pidió explícitamente: qué razón social identifica al usuario para login/tenant.

## Alternativas descartadas

### Mantener contractorLegalName como company, pero agregar un mapeo manual admin → tenant real
Permitiría conservar la razón social del contratista como identidad visible, resolviendo el tenant por un mapeo aparte — pero exige construir un flujo de aprobación/mapeo que hoy no existe, para un problema que se resuelve de forma directa y ya pedida por Gerencia con el cambio mínimo aplicado. Se deja como posible ADR futuro si Gerencia decide que sí necesita distinguir contratistas por su propia razón social.

## Referencias
- `frontend/src/components/Auth/AuthGateway.tsx` (`handleRegister`)
- `Auditoria_Registro_RUC_Tenant_2026-07-21.md` (hallazgo original, sección 3)
- `backend/src/auth/auth_storage_pg.cpp` (`auth_companies`, resolución de `tenant_id` vía `mineria_empresas`)
- `backend/src/reports/report_routes.cpp` (`userHasRealTenantMembership`, ADR-039 — el chequeo que evitaba el daño real mientras este bug estuvo abierto)
- ADR-039 (migración completa a `tenant_id`)
- ADR-036/063 (RBAC de 7 roles — mecanismo de control de acceso dentro de un mismo tenant, relevante para el trade-off de contratistas compartiendo tenant)
