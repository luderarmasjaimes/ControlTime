# ADR-067 — El autoregistro (`POST /api/auth/register`) provisiona un tenant real propio, en vez de caer en el fallback compartido

**Status**: implemented, verificado (2026-07-21). Backend reconstruido y redesplegado; verificado con un registro real nuevo (empresa "Minera Prueba Fix", nunca antes vista) que resuelve un tenant propio y puede crear un informe en el primer login.
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: plataforma

## Contexto

Al reemplazar la inyección de token falso por login real en las pruebas Playwright (`report-v2-admin.spec.ts`, `user-maintenance.spec.ts`, ver commit `9782c09`), se detectó que dos cuentas reales preexistentes (`larmas`/Alpayana, `JUANP`/Alpayana) no podían crear informes: `POST /api/reports` devolvía `400 tenant_required` — *"Tu usuario no esta vinculado a ninguna unidad minera (tenant) real"* — pese a que el login sí autenticaba y el JWT sí traía un `tenant_id`.

Investigación (`auth_storage_pg.cpp`, `resolveTelemetryTenantIdPg`):

- El `tenant_id` del JWT se resuelve en dos pasos: (1) `mineria_empresas.nombre` == la empresa, si tiene `tenant_id` asignado; (2) si no, la fila `is_default` en `auth_user_tenant` del usuario; (3) si ninguna existe, cae a una constante compartida `kMiningTelemetryDemoTenantId`.
- Esa constante **no es un tenant demo aislado**: es el UUID real de **"Compañía Minera Antamina"**, un tenant sembrado con datos propios en `tenants`.
- `POST /api/auth/register` (autoregistro RUC/representante legal, `handleRegister` en `main.cpp`) **nunca insertaba una fila en `auth_user_tenant`** — a diferencia de `handleAdminCreateUser` (alta admin-driven), que sí lo hace correctamente heredando el tenant del admin que crea al usuario (`auth_routes.cpp:339-354`).
- Consecuencia verificada en la base real: de 28 usuarios en `auth_users`, **23 no tenían ninguna fila en `auth_user_tenant`** — prácticamente todo el autoregistro histórico. Todos esos usuarios, de 4 empresas distintas y sin relación real entre sí (Alpayana, Minera Raura, Compañía Minera Raura, Activos Mineros, LUDER), quedaban silenciosamente resueltos al **mismo tenant compartido** (Antamina) cada vez que iniciaban sesión.
- ADR-039 (migración completa, 2026-07-13) ya había identificado este mismo escenario ("5 `company_name` legacy, ningún tenant real asociado") y decidió explícitamente **no inventar** a qué tenant real pertenecía cada uno — correcto como decisión de negocio en ese momento, pero dejó sin resolver **por qué el autoregistro nunca provisiona uno**. Ese "por qué" es la causa raíz que corrige este ADR.
- Sesiones de prueba anteriores (incluida la corrección manual aplicada hoy mismo antes de este análisis, para las 2 cuentas de prueba) habían insertado filas `auth_user_tenant` apuntando **a mano al tenant de Antamina/Minera Las Bambas** para destrabar pruebas puntuales — repitiendo, sin darse cuenta, el mismo antipatrón que el fallback ya producía silenciosamente.

Riesgo real (no solo inconveniente de pruebas): cualquier endpoint que confíe en `session.tenantId` sin verificar membresía real (`userHasRealTenantMembership`, no solo `userBelongsToTenant`) puede exponer o mezclar datos entre usuarios de empresas distintas que caigan en el mismo fallback. Los endpoints de creación/edición de informes ya estaban correctamente protegidos (ADR-039) — por eso el síntoma observado fue un bloqueo (`400`) y no una fuga de datos — pero el fallback seguía activo para cualquier lectura que no hiciera esa verificación estricta.

## Decisión

1. **Nueva función `findOrCreateTenantForCompanyPg`** (`auth_storage_pg.cpp`/`.hpp`): busca un tenant por `tenant_name == company`; si no existe, lo crea (`INSERT ... ON CONFLICT DO NOTHING` + relectura, idempotente ante carreras concurrentes); vincula al usuario en `auth_user_tenant` (`is_default = true`, rol real).
2. **`handleRegister`** (`main.cpp`, modo Postgres) invoca esta función inmediatamente después de `registerUserPg`, con la `company` y el `role` ya validados del payload. Si falla, se loguea en el servidor pero **no se aborta el registro** — el usuario ya quedó creado; queda con el mismo comportamiento de antes (fallback), no peor.
3. No se tocó `handleAdminCreateUser` (ya vinculaba correctamente al tenant activo del admin) ni el mecanismo de fallback en sí (`kMiningTelemetryDemoTenantId` sigue existiendo — su propósito documentado, mostrar datos demo a un usuario legacy sin tenant en el dashboard de telemetría, sigue siendo válido; lo que se corrige es que el autoregistro deje de *depender* de él permanentemente).

### Backfill de datos (`db_scripts/48_tenant_provisioning_autoregistro_legacy_companies.sql`)

Para los 23 usuarios ya existentes sin membresía real, se creó un tenant dedicado por cada `company_name` legacy (Alpayana, Minera Raura, Compañía Minera Raura, Activos Mineros, LUDER) y se corrigieron **todas** las filas `auth_user_tenant` de esos usuarios (incluidas las insertadas a mano hoy y en sesiones previas hacia Antamina/Las Bambas) para apuntar a su propio tenant. `mineria_empresas.tenant_id` se alineó igual (incluyendo "Activos Mineros", que también estaba incorrectamente enlazada a Antamina desde antes). Se eliminaron 3 informes de prueba que habían quedado mal etiquetados bajo el tenant de Antamina durante la verificación de hoy — mismo criterio que la limpieza ya precedente de ADR-039 (artefactos de prueba, cero dato de cliente real en juego).

### Verificación real

Registro de una empresa nunca antes vista contra el backend reconstruido:

```
REGISTER  → company: "Minera Prueba Fix ####" · auth_user_tenant creado: tenant propio (no Antamina)
LOGIN     → tenant_id: <uuid propio, distinto de a0000001-...>
POST /api/reports → 201 Created (antes: 400 tenant_required)
```

Suite Playwright completa (6/6) re-ejecutada tras el backfill y el redeploy: sigue en 6/6, ahora contra el tenant dedicado y correcto de Alpayana en vez del prestado de Antamina.

## Consecuencias

### Positivas
- Cualquier empresa que se autoregistre desde ahora obtiene un tenant real y aislado desde el primer registro — puede crear informes sin ninguna intervención manual de un admin/DBA.
- Se corrige un aislamiento multi-tenant roto en datos ya existentes (23 usuarios de 5 empresas distintas mezclados en el mismo tenant real de otra empresa).
- Cambio acotado: una función nueva + 6 líneas de invocación en `handleRegister`; no toca el esquema de `auth_users`, ni el flujo de login, ni `handleAdminCreateUser`.

### Negativas / Trade-offs
- El tenant creado automáticamente usa el nombre de la empresa tal cual lo escribió quien se registró (`tenant_name = company`), sin normalización ni deduplicación semántica — "Minera Raura" y "Compañía Minera Raura" (dos usuarios reales de esta base escriben el nombre de forma distinta) generan **dos tenants distintos** para lo que probablemente sea la misma empresa real. Este ADR no resuelve esa ambigüedad de nombres — es una decisión de negocio/producto (¿fusionar?, ¿pedir selección de un catálogo existente en vez de texto libre?), coincide con el Hallazgo G2 ya documentado en ADR-061 (falta de un flujo real de alta de empresa/tenant) y **sigue sin endpoint dedicado** tras este fix.
- `mineria_empresas` no se actualiza automáticamente para empresas nuevas (solo se hizo en el backfill puntual de las 5 legacy) — una empresa que se autoregistre hoy obtiene tenant y puede operar informes, pero no aparecerá en `mineria_empresas` hasta que alguien la dé de alta ahí manualmente (afecta solo a telemetría/dashboards de sensores, no a informes).
- Un tenant de prueba (`Minera Prueba Fix ####`, usado para la verificación de este ADR) no pudo eliminarse limpiamente por el trigger append-only de `platform_audit_log` (bloquea el `ON DELETE SET NULL` en cascada) — queda como artefacto vacío e inofensivo, mismo patrón que otras cuentas `e2e_*`/`test*_user` ya presentes en esta base de desarrollo.

### Neutras
- El campo `tenant_id` que devuelve el JSON de `/api/auth/register` (`authUserSessionJson`, `auth_storage_file.cpp`) sigue siendo **cosmético**: aplica su propio fallback a la constante compartida si `AuthUser.tenantId` viene vacío, independientemente de si ya existe una fila `auth_user_tenant` real. No refleja necesariamente el tenant que terminará en el JWT (ese se resuelve de nuevo, correctamente, en el siguiente login vía `resolveTelemetryTenantIdPg`). No se corrigió en este ADR por ser puramente de despliegue visual en la respuesta HTTP de registro, no de autorización real — se deja anotado para un futuro ADR de limpieza si genera confusión operativa.

## Alcance no incluido (decisión pendiente, no resuelta aquí)

- Deduplicación/normalización de nombres de empresa para autoregistro (Hallazgo G2, ADR-061) — sigue pendiente de decisión de producto.
- Sincronización automática `mineria_empresas` en el autoregistro — solo se corrigió para las 5 empresas legacy vía backfill puntual.
- El campo cosmético `tenant_id` en la respuesta de `/api/auth/register` (`authUserSessionJson`) — anotado como posible limpieza futura.

## Alternativas descartadas

### Seguir resolviendo el tenant solo en el login (dejar el autoregistro como está)
Es lo que había — el problema es exactamente que esto deja al usuario en modo "fallback compartido" indefinidamente, sin ninguna forma de autorepararse. Descartado por ser la causa raíz del defecto, no una mitigación.

### Bloquear el autoregistro si la empresa no existe ya en un catálogo curado
Requeriría un flujo de aprobación/alta de empresa que hoy no existe (mismo gap G2) — más seguro en teoría, pero cambia el producto (el autoregistro deja de ser self-service) y excede el pedido explícito de esta corrección ("solucionar el defecto real... para todos los casos que ocurran en la plataforma" se interpretó como corregir el defecto de aislamiento, no rediseñar el onboarding). Se deja como decisión de producto futura si Gerencia lo requiere.

## Referencias
- `backend/src/auth/auth_storage_pg.cpp` / `.hpp` (`findOrCreateTenantForCompanyPg`, `resolveTelemetryTenantIdPg`)
- `backend/src/main.cpp` (`handleRegister`)
- `backend/src/auth/auth_routes.cpp` (`handleAdminCreateUser`, patrón ya correcto que este ADR replica para autoregistro)
- `backend/src/auth/permissions.hpp` (`userHasRealTenantMembership` — el chequeo que evitó daño real mientras este defecto estuvo abierto)
- `db_scripts/48_tenant_provisioning_autoregistro_legacy_companies.sql` (backfill)
- ADR-039 (migración completa a `tenant_id`, identificó el mismo escenario sin resolver el autoregistro)
- ADR-061 (catálogo QA, Hallazgo G2 — falta de endpoint de creación de empresa/tenant)
- ADR-066 (fix relacionado de login/razón social — mismo área de código, `handleRegister`/tenant)
