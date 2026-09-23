# ADR-177 — Decomiso completo de la autoasignación de rol en el autoregistro público

**Status**: implemented, verificado por lectura de código y por build real (ver "Verificación")

**Fecha**: 2026-09-12

**Autores**: Luder Armas (decisión de negocio), con Claude Code (implementación)

**Ámbito**: plataforma, seguridad, auth

**Relación**: decomisiona por completo el mecanismo que [ADR-134](134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md) había mitigado (no retirado) y que [ADR-135](135-mfa-totp-alertas-seguridad-ruc-bootstrap.md) había endurecido con una excepción de RUC — esa mitigación y ese endurecimiento quedan superseded por este ADR, no por sí solos inseguros, sino porque la capacidad completa que protegían se elimina.

## Contexto

ADR-134 (26-ago) documentó y corrigió un hallazgo crítico: `POST /api/auth/register`
aceptaba `role: "admin"` (explícito en el payload, o vía el heurístico
`resolveRoleForUsername()` para cualquier username `admin`/`admin_*`) contra
una empresa **ya existente** con usuarios reales, permitiendo a cualquier
anónimo tomar control administrativo total de un tenant activo. El fix de
ADR-134 downgradeaba ese rol a `"viewer"` cuando la empresa ya tenía usuarios,
pero **conservaba deliberadamente** la posibilidad de autoasignarse `"admin"`
para una empresa **nueva** — el bootstrap legítimo del primer usuario de un
tenant recién creado. ADR-135 (mismo día) añadió una exigencia de RUC con
checksum válido sobre ese caso conservado, para subir el costo de un ataque
de *typosquatting* de nombre de empresa (crear una empresa con un nombre
visualmente similar a una real para calificar como "nueva" y auto-nombrarse
admin).

Instrucción explícita de Gerencia/developer (2026-09-12): **esa capacidad
conservada — autoasignarse un rol, incluido "admin", a través del
autoregistro público — nunca fue un requisito real de producto; fue
exclusivamente un atajo de pruebas del ambiente de desarrollo**. En
producción, el alta de una empresa minera cliente y de su primer
administrador es un proceso comercial/administrativo (ver ADR-035, postura
Enterprise LATAM confirmada 2026-09-11), no un campo de un formulario público
sin invitación ni verificación de identidad de negocio. Se ordena eliminar la
funcionalidad, no solo seguir endureciéndola.

## Decisión

1. **`POST /api/auth/register` ya no acepta ningún rol del cliente.** Se
   retira el campo `role` del payload de registro como fuente de rol —
   aunque lo mande, se ignora. `role` pasa a ser una constante local
   (`defaultSelfRegisteredRole()`) que **siempre** vale `"operator"` (el rol
   operativo normal, ya era el default de facto para el 100% de los
   registros reales del producto, que nunca mandan `"role"` — ver
   `frontend/src/auth/authApi.ts::registerUser`). Nunca `"admin"` ni ningún
   otro de los 7 roles.
2. **`resolveRoleForUsername()` queda eliminada del código**, no solo
   deshabilitada por configuración — junto con el heurístico que otorgaba
   `"admin"` a cualquier username `admin`/`admin_*` o a la lista
   `BEEMETRY_AUTH_ADMIN_USERS`. La variable de entorno queda documentada como
   retirada en `docker-compose.yml`/`docker-compose.e2e-verify.yml`, no
   solo sin efecto.
3. **El bloque de downgrade de ADR-134** (`companyAlreadyHasUsers && role !=
   "viewer"` → forzar `"viewer"`, con alerta `auth_register_role_downgraded`)
   **y la exigencia de RUC de ADR-135** (`!companyAlreadyHasUsers && role ==
   "admin"` → exigir checksum válido) quedan **retirados del handler**, no
   solo inalcanzables: con `role` ya siempre `"operator"`, ambas condiciones
   nunca se cumplían, así que el código muerto se eliminó en vez de dejarse
   como defensa en profundidad decorativa.
4. **Único camino restante para crear un usuario con rol elevado**: el alta
   admin-driven ya autenticada (`auth_routes.cpp::handleAdminCreateUser`),
   que exige el permiso `usuarios.manage` de un admin ya existente. Esto deja
   sin resolver el bootstrap del *primer* administrador de una empresa
   genuinamente nueva vía autoregistro — ver "Consecuencias".
5. **Fallback de deserialización de usuarios legados** (`auth_storage_file.cpp`,
   modo File/dev): un registro en disco sin campo `"role"` explícito también
   cae a `defaultSelfRegisteredRole()` (`"operator"`), nunca a un heurístico
   de username.

## Consecuencias

### Positivas
- Cierra por completo, no solo mitiga, el vector de escalada de privilegios
  vía HTTP que ADR-134 encontró — no queda ningún camino en el autoregistro
  público que produzca un usuario con privilegios por encima de `"operator"`.
- Elimina el riesgo residual de *typosquatting* de nombre de empresa que
  ADR-134/135 habían dejado documentado como no resuelto (ya no hay premio:
  registrar una empresa "nueva" con un nombre parecido a uno real ya no
  otorga admin bajo ninguna condición).
- Simplifica el handler: se retiran ~65 líneas de lógica de gate
  (`companyAlreadyHasUsers`, la consulta a Postgres/archivo para
  determinarlo, el downgrade con alerta de seguridad, y la validación de RUC
  condicionada a admin) que ya no tienen ninguna condición que las active.

### Negativas / Trade-offs
- **El autoregistro público ya no puede crear el primer administrador de una
  empresa nueva.** Esto es intencional (ver Contexto: la capacidad se
  consideró exclusivamente de pruebas), pero **deja sin definir cuál es el
  proceso real de alta del primer admin de un cliente minero nuevo en
  producción** — no resuelto por este ADR, es una decisión de proceso
  comercial/operativo pendiente (candidatos: alta manual vía acceso directo a
  BD/script por el equipo de Beemetry al firmar un cliente nuevo, o un flujo
  de invitación admin-driven desde una cuenta interna — ninguno construido
  todavía).
- Toda cuenta de prueba/desarrollo que dependía de autoregistrarse como
  `"admin"` (vía username `admin`/`admin_*` o payload `role`) deja de poder
  hacerlo; quienes necesiten un admin de prueba deben crearlo por otra vía
  (alta admin-driven con una cuenta admin ya existente, o directamente en
  base de datos/seed).
- `BEEMETRY_AUTH_ADMIN_USERS` queda como variable de entorno documentada pero
  sin efecto en `docker-compose.yml`/`docker-compose.e2e-verify.yml` — no se
  retiró la línea del todo, se dejó comentada explicando por qué, para no
  perder la trazabilidad de que existió.

## Verificación

Cambios de código revisados línea por línea (sin dependencias colgantes
confirmado por grep: `companyAlreadyHasUsers`, `normalizeTaxId`,
`validateTaxIdChecksum`, `validateCompanyPg`, `country` ya no aparecen en
`main.cpp` fuera de este ADR; `resolveRoleForUsername` ya no existe en
ningún `.cpp`/`.hpp`). **Build real corrido y verificado** (`backend/Dockerfile.verify`,
`docker build`, imagen `beemetry-backend-verify:adr177`): compila limpio
—`main.cpp.o`, `auth_session.cpp.o`, `auth_storage_file.cpp.o` incluidos—,
linkea (`beemetry_backend`) y el suite de CTest pasa 100% (1/1,
`backend_unit_tests`). No se corrió un test funcional en vivo contra
`POST /api/auth/register` (requeriría el stack completo con Postgres/frontend
levantado) — queda como verificación end-to-end pendiente antes de dar por
cerrado el hallazgo en un ambiente con tráfico real.

## Referencias

- `backend/src/main.cpp` (handler de `POST /api/auth/register`)
- `backend/src/auth/auth_session.cpp` (`defaultSelfRegisteredRole()`,
  reemplaza a `resolveRoleForUsername()` retirada)
- `backend/src/auth/auth_session.hpp` (declaración)
- `backend/src/auth/auth_storage_file.cpp` (fallback de deserialización)
- `backend/src/security/security_alerts.hpp` (comentario de ejemplo
  actualizado, ya no cita `auth_register_role_downgraded`)
- `docker-compose.yml` / `docker-compose.e2e-verify.yml`
  (`BEEMETRY_AUTH_ADMIN_USERS`, comentado con explicación)
- [ADR-134](134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md)
  (hallazgo original; también documenta por qué no se requiere auditoría
  retroactiva ni notificación a clientes — plataforma en desarrollo, sin
  clientes reales en producción ni certificación a la fecha)
- [ADR-135](135-mfa-totp-alertas-seguridad-ruc-bootstrap.md) (endurecimiento
  con RUC que este ADR vuelve innecesario, no incorrecto)
- ADR-035 (postura Enterprise LATAM confirmada — el alta de un cliente real
  es un proceso comercial, no autoregistro)
