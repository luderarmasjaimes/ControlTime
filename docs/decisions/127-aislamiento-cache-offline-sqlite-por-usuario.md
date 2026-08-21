# ADR-127 — Aislamiento por usuario/tenant del caché offline SQLite del navegador + purga en logout

**Status**: implemented (2026-08-20/21, hallado y documentado en auditoría 2026-08-21)

**Fecha**: 2026-08-20

**Ámbito**: reports

**Relación**: extiende ADR-022 (offline cola versionada / SQLite) y ADR-045
(edición offline SQLite cliente) — corrige un gap de aislamiento de datos
entre usuarios que ninguno de los dos ADR originales contemplaba.

## Contexto

ReportStudioV2 está pensado explícitamente para tablet de campo **compartida
entre técnicos** (ver ADR-022/045). El caché offline SQLite del navegador
(Cache API, `caches.open(...)`) usaba, hasta este ADR, **un único nombre de
caché fijo para todo el origen** (`beemetry-offline-sqlite-v1`) —
compartido por *cualquier* usuario que iniciara sesión en el mismo
navegador/dispositivo, sin importar cuál. En la práctica: los borradores
offline (contenido de informe técnico, datos de cliente) de un usuario
quedaban legibles y mezclados con los del siguiente técnico que iniciara
sesión en el mismo dispositivo, y sobrevivían indefinidamente al cierre de
sesión — un riesgo de exposición de datos entre usuarios reales en el
escenario de uso explícitamente previsto por el propio diseño offline.

Ni ADR-022 ni ADR-045 contemplaban este escenario multiusuario-por-
dispositivo al decidir el nombre de caché original.

## Decisión

1. **`resolveCacheName()`**: nombre de caché aislado por `userId` + `tenantId`
   (`beemetry-offline-sqlite-v2__${userId}__${tenantId}`), resuelto desde la
   sesión activa (`getSession()` de `authStorage.ts`). Se usa `userId`, no
   `username` — un mismo `username` puede repetirse entre tenants distintos.
   Sin sesión activa (no debería ocurrir — este módulo solo se usa dentro de
   ReportStudioV2, montado detrás de autenticación) se preserva el nombre
   legado como fallback, igual de aislado que el comportamiento previo a
   este cambio.
2. **`migrateLegacyGlobalCache()`**: migración de una sola vez desde la
   caché global heredada hacia la caché aislada del usuario actual, ejecutada
   solo cuando la caché aislada está vacía (primer uso tras esta
   actualización) — evita que un borrador offline sin sincronizar, guardado
   *antes* de este cambio, quede huérfano e inaccesible. La atribución es
   *best-effort*: si la caché legada tenía datos de un usuario distinto al
   que abre la app primero tras actualizar, se migran igual a ese primer
   usuario (no hay forma de recuperar el dueño real de datos que nunca
   estuvieron etiquetados) — preferible a descartarlos en silencio. Solo
   borra la caché legada **después** de confirmar que la escritura a la
   nueva caché tuvo éxito.
3. **`purgeOfflineCacheOnLogout()`** (llamada desde `App.tsx` en el logout
   explícito, mismo patrón que `invalidatePermissionsCache()` de
   `usePermissions.ts`): resetea el singleton `dbPromise` en memoria (sin
   esto, la `Database` de sql.js ya abierta seguiría apuntando a la caché
   del usuario saliente durante el resto de la pestaña, aunque otro usuario
   inicie sesión después en la misma SPA sin recarga completa) y **purga del
   navegador la caché SQLite del usuario que se desconecta, pero SOLO si no
   quedan filas `dirty=1`** (cambios offline sin sincronizar) —
   la regla dura de ADR-022 es 0% pérdida de datos; cerrar sesión nunca debe
   ser una forma de perder un borrador offline. Si hay cambios pendientes, la
   caché se preserva intacta (se recupera al volver a iniciar sesión con el
   mismo usuario en el mismo dispositivo) y solo se resetea el singleton en
   memoria. Ante cualquier error verificando `dirty` (fail-safe), **no se
   purga** — se prefiere preservar de más antes que borrar de más.

## Consecuencias

### Positivas
- Cierra una exposición real de datos de cliente entre técnicos que
  comparten un dispositivo de campo — el escenario de uso explícito del
  propio diseño offline.
- La migración de una sola vez evita pérdida de datos para instalaciones que
  ya tenían un borrador offline guardado bajo el esquema legado.
- La purga condicional en logout mantiene la garantía de 0% pérdida de datos
  de ADR-022 sin sacrificar el aislamiento por usuario.

### Negativas / Trade-offs
- La atribución de la migración legada es best-effort (no hay forma de saber
  con certeza de qué usuario eran los datos preexistentes) — riesgo pequeño
  y aceptado, acotado al momento único de la migración.
- Un dispositivo con varios usuarios que **nunca cierran sesión
  explícitamente** (cierran la pestaña/navegador directamente) no se
  beneficia de la purga en logout — la caché de ese usuario queda hasta que
  alguien cierre sesión explícitamente o el navegador la expulse por presión
  de espacio. No se consideró forzar logout ni agregar un timeout de
  inactividad como parte de este ADR — fuera de alcance.
- Dado que el aislamiento depende de `getSession()`, cualquier fallo en la
  resolución de sesión (bug no relacionado) haría caer al nombre legado
  compartido — riesgo residual pequeño, mitigado por que este módulo vive
  detrás de autenticación obligatoria.

## Alternativas descartadas

- **IndexedDB por usuario en vez de Cache API**: habría sido un cambio de
  almacenamiento más grande, sin beneficio adicional sobre simplemente
  namespacing el nombre de la caché existente.
- **Purgar siempre en logout, sin chequear `dirty`**: descartado — violaría
  la garantía de 0% pérdida de datos de ADR-022; el costo de conservar una
  caché con cambios pendientes hasta que se sincronicen es aceptable frente
  al riesgo de perder trabajo de campo real.
- **Requerir un vaciado manual del caché por el usuario**: descartado por
  UX — un técnico de campo no debería tener que saber que existe un caché de
  navegador que limpiar manualmente.

## Referencias

- `frontend/src/components/ReportStudioV2/lib/offlineSqlite.ts`
  (`resolveCacheName`, `migrateLegacyGlobalCache`, `purgeOfflineCacheOnLogout`)
- `frontend/src/App.tsx` (`purgeOfflineCacheOnLogout` en `onLogout`)
- `frontend/src/auth/authStorage.ts` (`getSession`)
- ADR-022 (offline cola versionada, garantía de 0% pérdida de datos),
  ADR-045 (edición offline SQLite cliente, escenario de tablet compartida)
