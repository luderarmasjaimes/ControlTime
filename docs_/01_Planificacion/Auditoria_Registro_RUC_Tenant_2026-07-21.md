# Auditoría del flujo de registro RUC / representante legal → creación de tenant

**Fecha:** 21 de julio de 2026
**Alcance:** revisión con máximo detalle de la pantalla de registro de usuario/empresa (`AuthGateway.tsx`), pedida para confirmar qué validación queda pendiente antes de pasar a certificación QA.
**Conclusión ejecutiva:** no es una validación menor pendiente — es un **bug real de asociación de tenant** que deja contratistas registrados sin unidad minera funcional, con el fallo apareciendo recién cuando intentan crear un informe, no en el momento del registro. Se documenta con evidencia completa; la corrección requiere una decisión de producto (ver §4), no se aplicó unilateralmente.

---

## 1. Cómo funciona hoy (verificado línea por línea)

La pantalla de registro tiene dos pestañas, ambas en `AuthGateway.tsx`:

- **Pestaña "Persona"** (`registerTab === 'user'`): usuario operativo normal. El campo "Empresa Asignada" es un `<select>` poblado por `fetchCompanies()` (`GET /api/auth/companies`) — **solo permite elegir una empresa ya existente**, no texto libre.
- **Pestaña "Empresa"** (`registerTab === 'company'`, título en pantalla: *"Registro de empresa contratista"*): pensada para un **contratista** (subcontratista) que se asocia a una empresa minera existente. Tiene:
  - `select` "Empresa minera asociada" → también poblado por `fetchCompanies()`, misma lista cerrada.
  - Campo "RUC de la Empresa (Validación automática)" → 11 dígitos, valida en vivo contra `GET /api/auth/validate-company`.
  - Campo de texto libre "Razón social" (`contractorLegalName`) → el nombre del contratista mismo.
  - Sección "Representante Legal": DNI, nombres, apellidos + captura biométrica facial obligatoria.

## 2. La validación de RUC es real, pero incompleta (dos hallazgos)

`GET /api/auth/validate-company` (`auth_routes.cpp:643-680`) implementa el **algoritmo real de dígito verificador de RUC peruano** (módulo 11, pesos `{5,4,3,2,7,6,5,4,3,2}`, prefijos válidos `10/15/17/20`) — matemáticamente correcto, no es un placeholder.

**Hallazgo A — el parámetro `company` nunca se usa.** La función recibe `company` y `ruc` por query string, pero la validación **solo mira el RUC** — el nombre de empresa se lee y se descarta sin comparar contra nada. Se puede escribir un RUC matemáticamente válido junto con cualquier nombre de empresa (incluso uno que no tiene relación real) y el check pasa igual (`rucValid: true`).

**Hallazgo B — sin verificación contra un registro real (SUNAT/RENIEC).** Aceptable dado el diseño on-prem sin dependencias externas (ADR-001), pero debe quedar explícito: esto valida que el RUC **tiene la forma correcta**, no que la empresa **existe y está activa** en el padrón real. Hoy no hay ninguna nota en el código ni en el ADR de auth que lo aclare — un QA podría asumir que "RUC válido ✓" significa "empresa verificada", y no es así.

## 3. El bug real: la empresa asociada seleccionada se descarta antes de enviarse

Esto es lo más importante de esta auditoría.

En el `<select>` "Empresa minera asociada" el usuario elige, por ejemplo, **"Minera Raura"** (una empresa real de la lista). Ese valor queda en `registerForm.company` y se usa para la llamada de validación de RUC (`validateCompany(registerForm.company, registerForm.ruc)`, línea 685).

Pero al enviar el formulario (`handleRegister`, línea 2159-2165):

```ts
const registrationPayload =
    registerTab === 'company'
        ? {
              ...registerForm,
              company: String(registerForm.contractorLegalName || '').trim(),
          }
        : registerForm
```

**El campo `company` se sobreescribe con `contractorLegalName`** (la razón social del contratista, texto libre) justo antes de llamar a `registerUser()` → `POST /api/auth/register`. La empresa minera asociada que el usuario eligió en el `select` **nunca llega al backend** — no existe en `RegisterForm` ningún campo separado (`parentCompany`, `contractorOf`, etc.) que la preserve. Se confirmó además que **el backend no tiene ningún concepto de "contratista de" o "empresa padre"** (`grep` sin resultados para `contractor|parent_company|parent_tenant` en todo `backend/src`).

### Consecuencia técnica, verificada contra el código de persistencia

`auth_storage_pg.cpp:155-160` — `POST /api/auth/register` siempre hace:
```sql
INSERT INTO auth_companies(name, active) VALUES($1, true) ON CONFLICT (name) DO NOTHING
```
con `$1` = el nombre que llega en `company` — es decir, **la razón social del contratista**, no "Minera Raura". Se crea una fila nueva en `auth_companies` (tabla que **no tiene columna `tenant_id`** — solo `name, active, created_at`).

El `tenant_id` real se resuelve en otra tabla completamente distinta, `mineria_empresas` (`auth_storage_pg.cpp:400-406`, `SELECT me.tenant_id FROM mineria_empresas WHERE nombre = $1`), que se provisiona **por separado** (semilla de base de datos / motor de fórmulas, `formula_service.cpp`), no por esta pantalla de registro.

**Resultado real:** la razón social del contratista nunca tiene fila en `mineria_empresas` → `tenant_id` resuelve vacío → el contratista queda autenticado (con `access_token` válido) pero **sin tenant real**, a pesar de haber elegido correctamente "Minera Raura" en el formulario.

### Dónde se nota el fallo (y por qué es un mal diseño de validación)

El fallo **no se bloquea en el registro** — se completa todo el flujo, incluida la captura biométrica facial (varios minutos). El usuario recién descubre el problema cuando intenta usar la plataforma: `report_routes.cpp:239-247` (y los mismos chequeos en update/delete) exigen `userHasRealTenantMembership(session->userId, session->tenantId)` antes de crear/editar/borrar un informe — si no hay membresía real, responde:
```json
{"error": "tenant_required", "detail": "Tu usuario no esta vinculado a ninguna unidad minera (tenant) real; no se puede crear un informe."}
```
Este chequeo (ADR-039) **funciona correctamente y evita el daño real** (que el informe quede huérfano o mezclado con datos de otro tenant) — pero el usuario ya invirtió tiempo completo en un registro que nunca podía funcionar, sin ningún aviso previo.

## 4. Qué falta para certificar esta pantalla en QA (validaciones pendientes reales)

1. **Bloquear el registro de contratista si la empresa minera asociada no se va a poder resolver a un tenant real** — hoy nada lo impide; el `select` ya limita a empresas de la lista `fetchCompanies()`, pero esa lista no filtra por "tiene tenant real en `mineria_empresas`" — sería el primer paso más simple.
2. **Decisión de producto pendiente (no la tomé yo):** ¿el contratista debe operar **bajo el tenant de la empresa minera asociada** que eligió (lo más consistente con lo que la pantalla parece prometer), o debe generarse **su propio tenant nuevo** (lo que exigiría un flujo de aprobación/provisión que hoy no existe)? La corrección de código depende de esta decisión — implementar cualquiera de las dos sin confirmarlo sería un cambio de producto no solicitado.
3. **Corregir la validación de RUC para que sí compare contra la empresa** (Hallazgo A) — o, si se decide que no debe comparar (por ejemplo, porque el RUC es del contratista y la empresa del select es la minera, dos identidades distintas a propósito), **documentarlo explícitamente** en el código y en un ADR, para que un futuro QA no lo reporte como bug por desconocimiento.
4. **Agregar un caso de prueba de regresión** una vez decidido el punto 2 — verificar que un contratista recién registrado SÍ puede crear un informe (o, si se decide que no debe poder hasta aprobación, que el mensaje de error aparece en el momento del registro, no después).
5. **Defecto menor, no bloqueante:** eliminar o corregir la copia muerta de `validateCompany()` en `frontend/src/components/ReportStudioV2/lib/api.ts:260` (usa `'\auth\validate-company'` con backslashes, URL inválida) — confirmado que no se usa en ningún flujo real (`AuthGateway.tsx` importa la versión correcta de `authApi.ts`), pero es deuda que puede reactivarse por error si alguien la reutiliza sin revisar.

## Referencias
- `frontend/src/components/Auth/AuthGateway.tsx` (líneas 574-694, 2143-2182, 2949-2998, 3050-3070)
- `frontend/src/auth/authApi.ts:511-519` (`validateCompany`, versión correcta y en uso)
- `frontend/src/components/ReportStudioV2/lib/api.ts:260-263` (copia muerta con bug de URL)
- `backend/src/auth/auth_routes.cpp:642-680` (`/api/auth/validate-company`, algoritmo de dígito verificador)
- `backend/src/auth/auth_storage_pg.cpp:155-160` (`INSERT INTO auth_companies ON CONFLICT DO NOTHING`), líneas 400-406 (`resolveTenantId` vía `mineria_empresas`)
- `backend/src/reports/report_routes.cpp:239-247` (`userHasRealTenantMembership`, ADR-039 — el chequeo que evita el daño real)
- ADR-039 (migración completa a `tenant_id`), ADR-038 (delegación de acceso por tenant)
- Catálogo de casos de prueba QA (`Catalogo_Casos_Prueba_QA_2026-07-21.md`, §2 "Creación de empresas") — este hallazgo reemplaza/detalla lo que ese catálogo dejó como pregunta abierta (hallazgo G2)
