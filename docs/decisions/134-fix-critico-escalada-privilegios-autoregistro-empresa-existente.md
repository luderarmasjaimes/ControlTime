# ADR-134 — Fix crítico: escalada de privilegios vía autoregistro en empresa existente

> **Actualización 2026-09-11 — pendiente de notificación/auditoría retroactiva
> cerrado por decisión explícita del developer/Gerencia.** El informe de
> estado del 2026-08-30 había dejado abierta la pregunta de si correspondía
> notificar o auditar retroactivamente a los tenants que existían antes del
> fix (2026-08-26), dado que el endpoint estuvo expuesto un tiempo
> indeterminado antes de corregirse. Decisión: **no se requiere auditoría de
> log ni notificación** — la plataforma sigue en etapa de desarrollo; aunque
> los datos de las empresas mineras usadas (p. ej. "Minera Raura") son
> reales, **ningún cliente tiene la plataforma en uso**, ni en entorno de
> prueba ni productivo, a la fecha del hallazgo ni a la fecha de esta
> decisión. Sin usuarios de cliente reales expuestos, no hay a quién
> notificar ni una ventana de explotación con impacto de negocio que auditar.
> Este criterio aplica únicamente a este hallazgo, en este momento del
> proyecto — no exime de auditoría retroactiva a hallazgos de severidad
> crítica que se descubran una vez la plataforma tenga clientes reales en
> producción. Cierra el pendiente correspondiente del informe del 30-ago y
> del corte gerencial del 2026-09-10.

**Status**: implemented, verificado en vivo contra el stack corriendo (ver Verificación)
**Fecha**: 2026-08-26
**Autores**: EC
**Ámbito**: plataforma
**Severidad**: CRÍTICA — el hallazgo más grave de todo el ejercicio de seguridad de esta sesión

> Continuación del mismo ejercicio de red-team que produjo [ADR-133](133-endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada.md).
> Este hallazgo se descubrió DESPUÉS, probando técnicas adicionales pedidas explícitamente por el
> usuario ("procede con los pendientes y pruebas de seguridad para lograr la máxima protección
> posible").

## Contexto

`POST /api/auth/register` es público (autoregistro, sin sesión previa) y por diseño provisiona un
tenant real para `company` si no existía (ADR-078/067) — pensado para que el primer empleado de
una empresa minera nueva pueda dar de alta su propia cuenta y arrancar el tenant.

**Hallazgo real, explotado en vivo contra el stack corriendo**: el mismo endpoint, contra una
empresa que **YA EXISTE** con usuarios reales (`"company": "Minera Raura"`), aceptó
`"role": "admin"` en el body y devolvió `201 Created` con una sesión completa: `role: "admin"`,
`is_admin: true`, `tenant_id` real de Minera Raura, y el conjunto COMPLETO de permisos
administrativos (`usuarios.manage`, `permisos.manage`, `empresas.manage`,
`org.cross_tenant.manage`, etc.) — verificado contra `GET /api/auth/permissions` con la sesión
recién creada. **Cualquier persona anónima en internet podía convertirse en administrador total
de cualquier empresa minera cliente ya existente con una sola petición HTTP, sin invitación,
aprobación, ni verificación de identidad más allá de un `face_template` numérico de relleno
(aceptado "para pruebas de contrato" según la documentación de la API).**

Un segundo vector, independiente y también explotable, hacía lo mismo SIN necesitar el campo
`role` en absoluto: `resolveRoleForUsername()` (`auth_session.cpp`) ya otorgaba `"admin"`
automáticamente a cualquier `username` igual a `"admin"` (o a la lista `BEEMETRY_AUTH_ADMIN_USERS`)
o que empezara con `"admin_"` — un heurístico pensado para bootstrap local de un único admin de
desarrollo, nunca auditado contra el hecho de que el registro público lo alimenta con un username
elegido libremente por cualquier anónimo.

## Decisión

**Regla nueva**: el registro público solo puede auto-asignarse un rol (explícito en el payload, o
vía el heurístico de `username`) cuando la empresa es **nueva** (nadie más a quien perjudicar
todavía — es el bootstrap legítimo del primer admin de un tenant recién creado, el caso de uso
real que este endpoint debe servir). Si la empresa **ya tiene al menos un usuario registrado**, el
rol se fuerza a `"viewer"` (el más bajo de los 7 roles) **sin excepción**, sin importar qué haya
pedido el cliente o qué sugiera el heurístico de username.

Implementación (`backend/src/main.cpp`, handler de `POST /api/auth/register`): justo después de
validar longitud/caracteres de `first_name`/`last_name`/`company` (ver ADR-133), se comprueba si
la empresa ya tiene usuarios — `validateCompanyPg(dbUrl, company, "", err)` en modo Postgres
(reutiliza una función YA EXISTENTE, antes sin usar en este flujo), o el equivalente sobre
`loadAuthUsers()` en modo File (dev/offline). Si ya existe, `role` se sobreescribe a `"viewer"` y
se deja un log `[AUTH_REGISTER_ROLE_DOWNGRADED]` (compañía, usuario, rol solicitado) — señal de
detección para cualquier intento futuro, igual que el resto del endurecimiento de ADR-133.

Cualquier elevación de rol REAL para un usuario de una empresa ya existente debe pasar por el alta
admin-driven (`auth_routes.cpp::handleAdminCreateUser`), que ya exige sesión autenticada y el
permiso `usuarios.manage` del admin que la ejecuta — ese camino no se toca, sigue siendo el único
correcto.

## Consecuencias

### Positivas
- Cierra por completo la toma de control total y no autorizada de un tenant existente vía
  autoregistro — el hallazgo más grave encontrado en esta sesión.
- Cierra también el vector independiente del heurístico de `username` (`admin`/`admin_*`), sin
  tocar ese heurístico en sí (sigue siendo válido SOLO para el bootstrap de empresa nueva).
- El bootstrap legítimo (primer usuario de una empresa nueva) no se ve afectado en absoluto.

### Negativas / Trade-offs
- Cualquier cuenta que ya haya explotado este bug ANTES de este fix (en producción, si llegó a
  desplegarse sin él) queda con su rol elevado intacto en la base de datos — este fix cierra la
  vía de entrada, no revierte el daño ya hecho. Requiere una auditoría manual puntual de
  `auth_users`/`auth_audit_logs` en cualquier entorno que haya corrido la versión vulnerable, para
  detectar y corregir cuentas con `role='admin'` creadas por autoregistro en empresas que no
  deberían tener ese admin.
- No cierra un vector relacionado, más difícil de resolver sin input de negocio: **typosquatting
  de nombre de empresa** — `validateCompanyPg` compara `company_name` por igualdad exacta
  (`ADR-066`: "razón social EXACTA"), así que `"Minera Raura "` (espacio final) o una variante de
  mayúsculas/acentos distinta cuenta como empresa "nueva" y permite bootstrap como admin de un
  tenant que a simple vista parece el mismo. Cerrar esto bien requeriría, como mínimo, normalizar
  el nombre antes de comparar (trim + casefold) y, más a fondo, condicionar el bootstrap de admin a
  una verificación real (RUC contra el registro fiscal, ya existente para el alta de empresa
  admin-driven vía `tax_registry_client.hpp`, pero NUNCA usada en el autoregistro público) — se
  deja como trabajo futuro explícito, no resuelto en esta entrega.

## Hallazgo adicional (mismo round de pruebas): inyección de fórmulas CSV

Revisando `auditRowsToCsv` (`auth_storage_file.cpp`) — el export `GET /api/auth/audit/export.csv`
usado por auditoría/cumplimiento — se encontró que `csvEscape` solo neutralizaba comillas/comas/
saltos de línea, no el patrón clásico de **CSV formula injection** (OWASP): un valor de
`username`/`company_name`/`detail` que empiece con `=`, `+`, `-` o `@` se interpreta como fórmula
al abrir el CSV en Excel/LibreOffice/Sheets. Dado que `company_name` (y `detail`, que puede
incluir texto de origen de usuario en algunos mensajes de auditoría) solo bloquean `<`/`>`
(ADR-133) y permiten esos caracteres al inicio sin restricción, un registro con
`"company": "=cmd|'/c calc'!A1"` habría quedado guardado tal cual y ejecutado como fórmula (hasta
potencial ejecución de comandos vía DDE en Excel) en la máquina del admin que exportara y abriera
el CSV. Fix: `csvEscape` antepone un apóstrofo a cualquier celda que empiece con esos caracteres
(fuerza texto plano en la hoja de cálculo, sin alterar el valor legible como texto plano) — igual
en las dos copias de la función (`auth_storage_file.cpp`, la realmente usada por el export de
auditoría, y `http_utils.cpp`, hoy sin caller activo pero endurecida por si algún export futuro la
reutiliza).

## Verificación

- **Escalada de privilegios**: repetido el ataque original (`role: "admin"` contra
  `"Minera Raura"`, empresa ya poblada) → ahora devuelve `role: "viewer"` en la sesión creada, y el
  backend registra `[AUTH_REGISTER_ROLE_DOWNGRADED] company=Minera Raura user=... requested_role=admin
  -> viewer`. Repetido también el vector independiente (`username: "admin_..."`, SIN campo `role`)
  contra la misma empresa → también `role: "viewer"`. Confirmado que el bootstrap legítimo (empresa
  genuinamente nueva, `role: "admin"`) sigue funcionando sin cambios.
- **CSV injection**: pendiente de verificación en vivo contra el build en curso (registrar un
  usuario/empresa con un valor que empiece en `=`/`+`/`-`/`@` y confirmar que el CSV exportado trae
  el apóstrofo antepuesto).

## Referencias
- `backend/src/main.cpp` (handler de `POST /api/auth/register`)
- `backend/src/auth/auth_storage_pg.cpp` (`validateCompanyPg`, reutilizada sin cambios)
- `backend/src/auth/auth_session.cpp` (`resolveRoleForUsername`, heurístico de bootstrap sin tocar)
- `backend/src/auth/auth_routes.cpp` (`handleAdminCreateUser`, único camino correcto de elevación)
- `backend/src/auth/auth_storage_file.cpp` (`csvEscape`, fix de inyección de fórmulas CSV)
- `backend/src/http/http_utils.cpp` (`csvEscape`, mismo fix, copia sin caller activo hoy)
- [ADR-133](133-endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada.md) (mismo ejercicio de red-team)
- [ADR-078](078-alta-administrada-empresa-tenant-deduplicada.md) / ADR-067 (autoregistro con provisión de tenant — contexto del diseño original)
