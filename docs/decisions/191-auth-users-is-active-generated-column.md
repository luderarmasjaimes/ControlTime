# ADR-191 — `auth_users.is_active` pasa a columna GENERATED derivada de `account_status`

**Status**: implemented (2026-09-16)

**Fecha**: 2026-09-16

**Ámbito**: auth, base de datos

## Contexto

Reporte del usuario: login con DNI `09637521` / empresa `Alpayana` no
entraba a la plataforma, sin cerrar sesión de forma visible ni mostrar
ningún código de error.

Reproducido en vivo (navegador propio + logs de red): el `POST
/api/auth/login/password` respondía `200 OK` con tokens válidos, el
dashboard llegaba a cargar (tenants, permisos, avatar), pero segundos
después el primer `POST /api/auth/refresh` fallaba con
`invalid_or_expired_refresh_token`. El frontend trata eso como "sesión
vencida" y limpia las cookies, devolviendo a la pantalla de login sin
mostrar nada — indistinguible, para el usuario, de que el login nunca
hubiera funcionado.

### Causa raíz

`auth_users` tenía **dos columnas independientes** para lo mismo (si la
cuenta puede autenticarse), y cada una la validaba un código distinto:

- `account_status` (varchar: `active`/`blocked`/`suspended`/`deleted`,
  con mensaje propio por estado) — validada únicamente por
  `loginPasswordPg()` (`auth_storage_pg.cpp:915-924`).
- `is_active` (boolean) — validada únicamente por
  `findValidRefreshTokenUserPg()` (`auth_storage_pg.cpp:1744`, el JOIN
  que emite el refresh).

Ningún camino de escritura las mantenía sincronizadas:

- El único endpoint de administración real,
  `POST /api/auth/users/maintenance` (`auth_routes.cpp:1846`,
  acciones `block`/`unblock`/`suspend`/`delete`/`change_profile`, vía
  `executeUserMaintenancePg`), escribe **solo** `account_status`.
- `scripts/delete-company-users-docker.ps1`, una herramienta de ops
  para dar de baja masivamente a todos los usuarios de una empresa,
  escribía **solo** `is_active` directo por SQL — al margen del
  endpoint anterior, con un comentario propio (ya desactualizado) que
  afirmaba que el backend exige `is_active=true` "tanto en login como
  en refresh" (falso desde que se agregó el chequeo de
  `account_status` al login).

La cuenta afectada (`wewewe` / Luder Armas / Alpayana) tenía
`account_status='active'` (pasaba el login) e `is_active=false`
(fallaba el refresh) — casi seguro producto de una ejecución anterior
de ese script sobre datos de prueba. Se encontraron dos filas más con
el mismo drift al auditar (`09637999`, `09637902`), confirmando que no
era un caso aislado.

Nada en `backend/src` escribía `is_active=false` — por eso un grep
inicial del código de aplicación no explicaba cómo esa columna había
quedado en `false`; hacía falta auditar también scripts de ops fuera
de `backend/src`.

## Decisión

**Una sola fuente de verdad escribible.** En vez de sincronizar dos
columnas a mano en cada write path presente y futuro (frágil: basta
que aparezca un tercer script u otra acción de admin que solo toque
una de las dos), `account_status` queda como la única columna que se
escribe, e `is_active` pasa a ser una columna **`GENERATED ALWAYS AS
(...) STORED`** calculada a partir de ella
(`db_scripts/101_auth_users_is_active_generated_from_status.sql`):

```sql
ALTER TABLE auth_users DROP COLUMN is_active;

ALTER TABLE auth_users ADD COLUMN is_active BOOLEAN
    GENERATED ALWAYS AS (
        COALESCE(account_status, 'active') = 'active'
        OR COALESCE(account_status, 'active') = ''
    ) STORED;
```

La expresión replica exactamente la condición de aceptación que ya
usaba `loginPasswordPg` (rechaza solo si `account_status` es una
cadena no vacía distinta de `'active'`), así que `NULL`/`''` (filas
legadas anteriores a la columna) se siguen tratando como activas,
igual que hoy en el login.

Esto da tres garantías estructurales, no solo la corrección del dato:

1. **Autocura el drift existente**: al aplicar el ALTER, Postgres
   recalcula `is_active` para cada fila desde su `account_status`
   actual — las tres cuentas encontradas con el drift quedaron
   corregidas por el propio `ALTER`, sin necesidad de un `UPDATE`
   manual adicional.
2. **Hace la clase de bug irrepetible, no solo el caso puntual**: desde
   este `ALTER`, Postgres **rechaza cualquier `UPDATE` directo a
   `is_active`** (`ERROR: column "is_active" can only be updated to
   DEFAULT`). Un futuro script de ops, una migración nueva o un `psql`
   manual que intente tocar `is_active` sin pasar por `account_status`
   falla de inmediato y en voz alta, en vez de crear un drift
   silencioso que solo se nota cuando un usuario reporta que "no puede
   entrar".
3. **Cero cambios de código en el camino caliente**: `findValidRefreshTokenUserPg`
   sigue leyendo `u.is_active = true` sin modificarse — esa lectura
   ahora es correcta por construcción. `trg_fn_audit_auth_users_sensitive`
   (trigger de auditoría que compara `OLD.is_active` vs `NEW.is_active`)
   tampoco necesita cambios: los triggers ven columnas `GENERATED
   STORED` ya calculadas en `NEW`, así que `is_active_changed` en el
   log de auditoría sigue funcionando, y ahora refleja fielmente
   cualquier cambio real de `account_status`.

### Script de ops corregido

`scripts/delete-company-users-docker.ps1` se actualizó para leer y
escribir `account_status` (`'active'`/`'blocked'`) en vez de
`is_active`, alineándolo con la misma semántica que ya usa el endpoint
de administración (`block`/`unblock`). Documentación del script
actualizada para no repetir la afirmación desactualizada sobre qué
columna valida el login.

### Fuera de alcance (limitación conocida, no corregida aquí)

El modo de almacenamiento **File** (sin Postgres, fallback de
dev/offline — ver comentarios existentes en `auth_session.cpp`) no
tiene ningún concepto de `account_status`/`is_active`: `struct
AuthUser` (`auth_types.hpp`) no tiene un campo de estado, y ni
`auth_storage_file.cpp` ni `auth_storage_file.hpp` implementan bloqueo,
suspensión o baja lógica. Una cuenta en modo File nunca puede
bloquearse. Esto es preexistente a este ADR y consistente con que ese
modo es explícitamente solo para desarrollo/offline, no la ruta de
producción — no se extiende aquí para no mezclar esta corrección con
una funcionalidad nueva.

El mock de administración de usuarios en el frontend
(`frontend/src/components/ReportStudioV2/lib/userMaintenanceStorage.ts`,
un fallback local a `localStorage`, no la llamada real al backend) ya
escribía ambos campos en cada acción (`is_active` y `account_status`
juntos) — no contradice este ADR y no requirió cambios.

## Consecuencias

- Las tres cuentas con drift (`09637521`, `09637999`, `09637902`)
  quedaron reactivadas automáticamente por el `ALTER`.
- Cualquier intento futuro (script, migración, `psql` manual) de
  escribir `is_active` directamente falla con un error de Postgres en
  el momento del intento, no como un bug reportado semanas después por
  un usuario real.
- Si se agrega un tercer punto de código que necesite decidir "¿puede
  esta cuenta autenticarse?", debe leer `account_status` (fuente de
  verdad, con los mensajes por estado ya definidos en
  `loginPasswordPg`) o `is_active` (su espejo booleano) — nunca
  introducir una tercera columna o bandera propia.

## Referencias

- `db_scripts/101_auth_users_is_active_generated_from_status.sql`
- `backend/src/auth/auth_storage_pg.cpp` (`loginPasswordPg`,
  `findValidRefreshTokenUserPg`, `executeUserMaintenancePg`)
- `backend/src/auth/auth_routes.cpp:1846` (`POST
  /api/auth/users/maintenance`)
- `scripts/delete-company-users-docker.ps1`
