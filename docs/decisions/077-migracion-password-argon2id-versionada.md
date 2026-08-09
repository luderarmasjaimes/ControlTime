# ADR-077 — Migración versionada de contraseñas legacy a Argon2id

## Actualización 2026-08-07 — inventario legacy retirado a cero, verificador legado sin uso real

Cierra el gate operativo que dejó abierto la actualización del 2026-08-05:
las 40 cuentas envueltas (`legacy1:...`) no migraron solas por login natural
en 48h (reconsultado: seguían siendo exactamente 40). Clasificación de esas
40 antes de actuar: 35 son fixtures de QA/e2e desechables creadas por
sesiones de verificación anteriores de este mismo log (`e2e_*`, `qa_*`,
`*test*`, `smoke_*`, `admin_2026*` con timestamp, `contractor_<epoch>`,
`audit_test`, `testfix_13931`), 3 con username numérico ambiguo
(`70007000`/`85187302`/`85187360`, posibles DNI reales de Alpayana) y 1 la
cuenta real del propio usuario de esta sesión (`LUDERARMAS`). Decisión
explícita del usuario (no tomada unilateralmente): resetear las 40, incluida
la propia.

**Ejecución** (sin usar el endpoint HTTP `reset_password` porque ninguna
cuenta con rol `admin` disponible tenía credencial conocida en cada tenant
afectado — se replicó la MISMA función que ese endpoint usa, no un esquema
ad-hoc): `libargon2.so.1` (ya linkeada en la imagen real de `beemetry-api`)
invocada vía Python `ctypes` con los parámetros reales configurados en el
contenedor (`t=3, m=65536, p=1`, iguales a `BEEMETRY_ARGON2_TIME_COST/
MEMORY_KIB/PARALLELISM`) — mismo algoritmo, misma librería, mismos
parámetros que `http_utils::hashPassword()`, no una reimplementación. Una
contraseña aleatoria nueva (`secrets.token_urlsafe(15)`) y un salt CSPRNG de
16 bytes por cuenta; 40 `UPDATE auth_users SET password_hash=... WHERE
id=...` ejecutados contra `sensors_db` real.

**Verificado, no solo ejecutado:**
- Inventario post-reset: `SELECT ... GROUP BY scheme` → **82/82 `$argon2id$`,
  0 `legacy1:`, 0 crudo**.
- Reinicio real de `beemetry-api` (la migración de arranque corre antes de
  aceptar tráfico) → **ningún log `AUTH_PASSWORD`** en los primeros 30s
  (antes: "40 credenciales envueltas pendientes") — confirma que el propio
  código de la app, no solo la consulta SQL, ve el inventario en cero.
- **Login real de extremo a extremo** contra un hash generado por este
  método: `POST /api/auth/login/password` con una de las 40 cuentas
  restablecidas → `200 authenticated`, `access_token` real emitido. Prueba
  que el hash generado fuera del backend es indistinguible, para
  `verifyPassword()`, de uno generado por el backend mismo.
- La cuenta `larmas`/Alpayana quedó **restablecida a su contraseña
  documentada `123456`** (no al valor aleatorio) con el mismo mecanismo,
  porque `frontend/e2e/report-v2-admin.spec.ts` y
  `frontend/e2e/user-maintenance.spec.ts` la usan como credencial real fija
  — perderla habría roto esos 2 specs por una causa nueva y no relacionada a
  la que ya se investigaba ahí (ver ADR-059, actualización 2026-08-05).
- Las contraseñas aleatorias nuevas de las 39 cuentas restantes se
  entregaron una única vez (archivo local, no en este ADR ni en el
  repositorio) y los artefactos temporales (script, SQL, CSV con
  contraseñas en claro) se borraron del contenedor tras copiarlos.

**El verificador legado (`isWrappedLegacyHash`/rama `legacy1:` de
`verifyPassword()`) sigue existiendo en el código** — retirarlo es un cambio
de código aparte (eliminar la rama, no solo vaciar el inventario) fuera del
alcance de esta actualización; con inventario real en cero, ya no tiene
ninguna fila que ejercitar en el entorno verificado.

## Actualización 2026-08-05 — envoltura automática al arranque cierra el riesgo de craqueo offline

Se encontró en el árbol de trabajo (sin commitear, sin ADR ni mención en
`CHANGELOG.md`/índice hasta ahora) `migrateLegacyPasswordHashesPg()`
(`backend/src/auth/auth_storage_pg.cpp`, comentario propio "auditoría
2026-08-02") + `wrapLegacyHash()`/`isWrappedLegacyHash()` (`http_utils.cpp`),
invocada desde `main.cpp` **antes de aceptar tráfico** en cada arranque del
backend, de forma idempotente:

- Todo `password_hash` que no sea ya `$argon2id$...` ni `legacy1:...` se
  recalcula con el hash legado (`std::hash`, rápido) y ese resultado se
  **envuelve** dentro de un Argon2id real (`legacy1:$argon2id$...`) —
  persistido de vuelta a la fila con un `UPDATE ... WHERE password_hash=$3`
  condicionado al valor leído (si el usuario inició sesión y ya se rehasheó a
  Argon2id auténtico entre el `SELECT` y el `UPDATE`, la migración no pisa el
  hash bueno).
- `verifyPassword()` ya reconoce las tres formas: Argon2id auténtico, legado
  envuelto (desenvuelve, recalcula el hash legado de la contraseña recibida y
  verifica contra la envoltura Argon2id) y legado crudo (solo como
  compatibilidad hacia atrás si algo quedara sin migrar). `login` sigue
  disparando el rehash real a Argon2id puro con la contraseña en texto plano
  del usuario cuando el hash no es ya `$argon2id$...`.
- Un fallo de la migración al arrancar (`db_unavailable`, etc.) no bloquea el
  arranque: se registra y el esquema legado sigue verificando como antes —
  no hay downtime nuevo introducido por este cambio.

**Verificado en vivo** (stack Docker real, 2026-08-05): logs de arranque de
`beemetry-api` confirman `"40 credenciales envueltas pendientes de rehash
real"` sin ningún mensaje de `"ATENCION: quedan N hashes legados CRUDOS"`.
Consulta directa a `sensors_db.auth_users` (solo lectura):

| Esquema | Cuentas |
|---|---|
| `$argon2id$` real | 16 |
| `legacy1:` envuelto (Argon2id at-rest, deriva de hash legado) | 40 |
| Legado crudo (`std::hash` plano, craqueable offline) | **0** |

Esto **cierra el riesgo más severo** que este ADR y ADR-043 dejaban abierto
(craqueo offline de una base filtrada vía `std::hash`) sin esperar a que las
40 cuentas restantes inicien sesión — el envoltorio Argon2id protege el dato
en reposo ya mismo. **No cierra** el retiro completo del verificador legado
del backlog (`docs/decisions/README.md` § backlog operativo): esas 40 cuentas
siguen derivando de un hash legado de 64 bits hasta que cada una complete un
login real (rehash oportunista automático) o se ejecute un reset
administrado — ninguna de las dos se fuerza aquí, es la misma decisión
operativa que ADR-043 ya se negó a tomar unilateralmente.

**Pendiente real de esta actualización**: el código existe y se verificó
funcionando contra el stack real, pero está **sin commitear** en la rama
actual (`git status` lo marca `M` junto con otros archivos de
`backend/src/auth/`, `http/`, `main.cpp`) y sin ADR propio ni fila en el
índice hasta esta nota. No se commiteó como parte de esta revisión —
requiere decisión explícita del usuario.

**Status**: implemented y desplegado; inventario legacy retirado a cero y verificado (2026-08-07, ver actualización arriba) — transición legacy operativa (2026-07-29); envoltura automática al arranque cierra el vector de craqueo offline (2026-08-05)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: plataforma
**Relación**: convierte el pendiente de ADR-043 en una decisión ejecutable; refina ADR-029/037/058/060.

## Contexto

`http_utils::hashPassword()` usa actualmente
`std::hash(salt + "::" + password)` y cae al literal
`mining_local_salt_change_me` cuando `BEEMETRY_AUTH_PASSWORD_SALT` no existe.
El runtime auditado continúa emitiendo esa advertencia.

Configurar simplemente un salt nuevo rompería todas las contraseñas actuales,
porque el esquema no guarda versión ni parámetros y la verificación recalcula
el hash con el único salt activo. Además, `std::hash` es rápido y no está
diseñado como función criptográfica de derivación de contraseñas. Por tanto,
el pendiente no se resuelve únicamente agregando una variable de entorno.

## Decisión

1. Adoptar **Argon2id** mediante una biblioteca mantenida del sistema. Cada hash
   almacenará versión, parámetros, salt aleatorio por usuario y resultado en
   un formato autocontenido verificable.
2. Agregar un esquema versionado, preferiblemente dentro del propio string
   (`$argon2id$...`); alternativamente, una columna `password_scheme` con
   migración explícita. Nunca inferir el algoritmo por longitud.
3. Mantener verificación legacy solo durante la transición:
   - si el hash es Argon2id, verificar con Argon2id;
   - si es legacy y la contraseña coincide, rehashear inmediatamente con
     Argon2id en la misma operación de login;
   - cuentas que no ingresen durante la ventana deberán completar un reset
     controlado antes de retirar el verificador legacy.
4. El antiguo salt se conservará temporalmente como secreto de migración,
   separado del nuevo pepper opcional. No se expondrá en logs ni respuestas.
5. Altas, cambios y resets de contraseña usarán Argon2id desde el primer
   despliegue. No se crearán hashes legacy nuevos.
6. La retirada del verificador legacy requiere evidencia de inventario:
   cero cuentas legacy activas o una decisión formal de reset para las
   restantes.

## Parámetros y operación

- Los parámetros de memoria/tiempo/paralelismo se medirán en el contenedor
  productivo y se fijarán por configuración versionada, con objetivo inicial
  de latencia compatible con login humano y resistencia offline.
- Antes del despliegue: backup, prueba de restauración, conteo de hashes por
  esquema y comunicación de la ventana.
- Después: smoke de alta/login/reset, prueba de rehash oportunista, auditoría
  de fallos y rollback que conserve la capacidad de verificar ambos formatos.

## Evidencia de implementación

- `hashPassword()` produce formato autocontenido `$argon2id$` con salt
  CSPRNG de 16 bytes y hash de 32 bytes.
- Parámetros por defecto: tiempo 3, memoria 65536 KiB, paralelismo 1; límites
  defensivos y configuración por entorno.
- `verifyPassword()` acepta Argon2id y el formato histórico durante la
  transición, con comparación constante para el legado.
- PostgreSQL y almacenamiento en archivo rehashean en el primer login legacy
  correcto. Altas y resets crean únicamente Argon2id.
- Catch2 aprobó hash con salts distintos, contraseña válida/inválida y
  detección del esquema legacy. El build productivo ejecutó `ctest` al 100 %.
- E2E: el usuario nuevo `admin_20260727163946086_6c28c6fb` quedó con esquema
  `argon2id` y longitud 97. La cuenta smoke legacy
  `admin_20260727134736203_30c24045` migró a `argon2id` tras un login correcto.
- Inventario final tras la regresión del 2026-07-29: 14 Argon2id y 40 legacy.
  Esas 40 cuentas no se resetean destructivamente: migrarán al próximo acceso
  o por reset administrado. El verificador legacy solo podrá retirarse cuando
  el conteo llegue a cero.

## Compatibilidad y conflictos

- **ADR-029**: no cambia JWT, cookies ni refresh; endurece la autenticación
  previa a emitir la sesión.
- **ADR-037**: el alta administrada sigue permitida sin biometría, pero toda
  contraseña nueva debe nacer en Argon2id.
- **ADR-043**: supersede únicamente la alternativa de “cambiar el salt y
  resetear todo” como única salida. La migración dual evita una interrupción
  masiva y cierra tanto el salt de desarrollo como `std::hash`.
- **ADR-058**: no reemplaza el pentest ni la auditoría; cierra un bloqueante
  conocido antes de someter el sistema a validación externa.
- **ADR-060**: requiere pruebas de hashes correctos/incorrectos, formatos
  corruptos, rehash legacy y parámetros mínimos.

## Consecuencias

### Positivas

- Resistencia adecuada frente a cracking offline de una base filtrada.
- Migración gradual sin invalidar de inmediato a todos los usuarios.
- Parámetros y algoritmo quedan versionados y auditables.

### Riesgos y controles

- Argon2id consume memoria deliberadamente; limitar concurrencia y medir bajo
  carga evita degradar el backend.
- Mantener verificación legacy demasiado tiempo conserva la debilidad; la
  transición necesita fecha límite y métrica.
- Un rollback debe conservar hashes Argon2id ya creados; nunca degradarlos a
  legacy.

## Alternativas descartadas

- **Solo cambiar `BEEMETRY_AUTH_PASSWORD_SALT`**: invalida credenciales y
  mantiene `std::hash`.
- **SHA-256 con salt global**: demasiado rápido para contraseñas.
- **Reset inmediato de toda la base sin transición**: posible como respuesta
  de emergencia, pero innecesariamente disruptivo como plan normal.

## Evidencia y referencias

- `backend/src/http/http_utils.cpp` (`hashPassword`)
- `backend/src/auth/auth_storage_pg.cpp`
- `backend/src/auth/auth_routes.cpp`
- `backend/src/main.cpp`
- ADR-043, ADR-029, ADR-037, ADR-058 y ADR-060.
