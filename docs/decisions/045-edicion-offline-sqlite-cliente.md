# ADR-045 — Edición offline del Informe Técnico con SQLite local del cliente

**Status**: accepted (implementado y verificado end-to-end 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: reports

> El negocio describió el Informe Técnico como un lienzo de 1 o más páginas
> con texto, imágenes, tablas, fotos, KPIs y dashboards — muchos de estos
> bloques con conexión viva a telemetría que se actualiza minuto a minuto —
> y pidió explícitamente que la edición pudiera continuar sin conexión a
> internet, con aviso visible de la fecha/hora del corte, y que los cambios
> offline se graben localmente en una base **SQLite** descargada del
> servidor en la primera prueba de conectividad del navegador.

## Contexto

El editor (ReportStudioV2) ya autoguardaba cada 5s contra el servidor
(`autosaveEngine.ts`) y tenía un respaldo en `localStorage` como red de
seguridad, pero:
- No existía ninguna detección real de "sin conexión" more allá de
  `navigator.onLine` (poco fiable: wifi conectado a un router sin salida a
  internet real sigue marcando `true`).
- El respaldo en `localStorage` no es lo que pidió el negocio (SQLite,
  explícitamente) y no tenía ningún mecanismo de reconciliación al volver la
  conexión — quedaba huérfano.
- Ya existía `frontend/src/lib/connectivityMonitor.ts` (heartbeat real contra
  `/api/health` con histéresis de 3 estados: `ONLINE_PLENO` / `DEGRADADO` /
  `OFFLINE`), construido originalmente para mapas — se reutiliza aquí tal
  cual en vez de duplicar detección de conectividad.
- Existía además `offlineSyncEngine.ts`, un motor de cola en `localStorage`
  nunca conectado a ningún componente real y apuntando a endpoints que no
  existen (`/api/reports/save`, etc.) — código muerto, se eliminó.

## Decisión

### SQLite real en el navegador: sql.js (WASM), no IndexedDB crudo
El negocio pidió SQLite por nombre, no "algo persistente" — se usa
[`sql.js`](https://github.com/sql-js/sql.js) (SQLite compilado a WebAssembly)
en vez de reimplementar el mismo objetivo con IndexedDB. El binario WASM
(`sql-wasm.wasm`, ~650KB) se sirve como asset estático de `public/`.

### La plantilla SQLite se descarga del servidor, no se genera en el cliente
Nuevo endpoint `GET /api/reports/offline-template` (autenticado) devuelve una
base SQLite de solo esquema (~28KB), generada una vez con `sql.js` desde
Node (`gen_offline_template.mjs`, no committeado) y **embebida como arreglo
de bytes en C++** (`backend/src/reports/offline_template_data.hpp`) — así el
backend no necesita `libsqlite3` enlazada ni gestionar un archivo estático en
el runtime del contenedor, solo servir bytes ya generados
(`makeOctetResponse`, reutilizado de ADR-044).

Esquema (`offline_reports`, `offline_connectivity_events`, `offline_meta`):
guarda el último documento editado por informe (`dirty` flag), y el
instante exacto de cada corte/recuperación de conexión.

### Persistencia local: Cache API, no IndexedDB manual
`sql.js` mantiene la base íntegra en memoria; hace falta serializarla a bytes
y guardarla en algún storage persistente del navegador tras cada escritura.
Se usa la **Cache API** (`caches.open('beemetry-offline-sqlite-v1')`,
guardando los bytes como el body de una `Response` sintética) en vez de
IndexedDB crudo — el proyecto ya usa Cache API para
`tile-cache-sw.js` (mapas offline), y aquí el objetivo real es "cachear un
blob binario", exactamente el caso de uso de esa API — evita reimplementar
transacciones IndexedDB para un problema más simple.

### Aviso en el lienzo con fecha/hora exacta
`App.tsx` usa `useConnectivity()` (el hook ya existente) y, en la transición
a `OFFLINE`, graba `new Date().toISOString()` como `offlineSince` y lo
persiste también en `offline_connectivity_events` (`recordWentOffline`).
El lienzo muestra un banner:
> ⚠ FUERA DE LÍNEA desde `<fecha/hora>` — los cambios se están guardando
> localmente en este equipo y se sincronizarán al recuperar la conexión.

### Autosave: rama offline explícita, no intento-y-reintento contra el servidor
El callback de `autosaveEngine.ts` ahora comprueba `connectivity.state`
**antes** de llamar al servidor: si es `OFFLINE`, escribe directamente en
SQLite local (`saveOfflineSnapshot`) sin siquiera intentar la red — evita
generar minutos de reintentos fallidos contra un backend inalcanzable.

### Reconciliación al reconectar — dos caminos, no uno
1. **Reconexión en vivo** (la pestaña sigue abierta cuando vuelve la señal):
   un efecto en `App.tsx` detecta la transición `OFFLINE → *`, llama
   `recordCameOnline`, y si hay un snapshot local `dirty` para el informe
   abierto, lo empuja al servidor (mismo `saveReportAsync` que usa el save
   manual) y lo marca sincronizado.
2. **Reapertura tras cerrar la pestaña estando offline** (el camino 1 no
   puede dispararse solo si el usuario cerró el navegador antes de
   reconectar): al abrir un informe existente (`handleOpenEdit`), se
   consulta si hay un snapshot local `dirty` para ese id y, si lo hay, se
   pregunta al usuario si quiere restaurarlo antes de sobreescribir con la
   versión del servidor — nunca se descarta silenciosamente.

## Consecuencias

### Positivas
- Verificado end-to-end contra el stack real (no solo unitario): banner con
  timestamp real, edición offline simulada (heartbeat de
  `connectivityMonitor` interceptado) escrita en SQLite local (confirmado
  vía Cache API: 28672 bytes), reconexión con recuperación explícita
  (confirm) y sincronización real al servidor (`PUT /api/reports/{id}` 200,
  confirmado además leyendo `content_json` directamente en Postgres — el
  bloque de texto insertado offline llegó intacto).
- Reutiliza infraestructura ya construida (`connectivityMonitor.ts`,
  `authFetch`/ADR-041, `makeOctetResponse`/ADR-044) en vez de duplicarla.
- Elimina código muerto (`offlineSyncEngine.ts`) que apuntaba a endpoints
  inexistentes y nunca estuvo conectado a ningún componente real.

### Hallazgo de seguridad corregido durante la implementación: CSP bloqueaba WASM
La Content-Security-Policy existente (`script-src 'self'
https://cdn.tailwindcss.com`, aplicada tanto en `router.cpp` como en
`frontend/nginx.conf`) no incluía `'wasm-unsafe-eval'` — Chromium rechazaba
compilar el módulo WASM de sql.js con `CompileError: ... violates ...
script-src`, confirmado en consola real antes del fix. Se agregó
`'wasm-unsafe-eval'` en los 3 bloques de `nginx.conf` y en `router.cpp` —
token específico para WebAssembly, no habilita `eval()` de JS arbitrario
(que seguiría bloqueado por no tener `'unsafe-eval'`).

### Hallazgo corregido: fetch sin autenticar al endpoint de plantilla
La primera implementación de `fetchTemplateBytes()` usaba `fetch()` crudo —
el endpoint exige sesión (como el resto de `/api/reports`), así que todo
intento de descargar la plantilla devolvía 401 y el autosave offline fallaba
en silencio (agravado por un segundo hallazgo: `log.warn` no emite en build
de producción — ver abajo). Se corrigió usando `authFetch` (ADR-041), la
misma función que ya usa el resto de la plataforma.

### Hallazgo corregido: fallos de autosave invisibles en producción
`autosaveEngine.ts` registraba los fallos con `log.warn`, que
(`logger.ts`) es un no-op fuera de `import.meta.env.DEV` — un fallo real de
guardado (offline o no) no dejaba ningún rastro en la consola de un build de
producción. Se cambió a `log.error` (siempre visible): un fallo de autosave
es accionable por definición (dato del usuario en riesgo), a diferencia de
otros warnings de diagnóstico.

### Negativas / Trade-offs
- +~650KB (wasm) al bundle servido la primera vez que se necesita el motor
  offline (se descarga bajo demanda vía `initSqlJs`, no bloquea el bundle
  principal).
- La reconciliación en reconexión-en-vivo asume que el usuario no reabrió el
  MISMO informe en otra pestaña mientras estaba offline en esta — no hay
  detección de edición concurrente entre pestañas del mismo navegador (fuera
  de alcance: el negocio pidió continuidad offline de una sesión, no
  multi-pestaña).
- Sin compresión de la base local (mismo trade-off que ADR-044: no se agregó
  zlib como dependencia nueva de build).

## Alternativas descartadas

### IndexedDB directo en vez de sql.js
Cumpliría el objetivo técnico de persistencia local, pero el negocio pidió
SQLite explícitamente por nombre — y SQLite real permite migrar el motor
offline a operaciones más complejas (consultas, múltiples informes en cola)
sin reimplementar sobre primitivas de IndexedDB.

### Generar la plantilla SQLite en el propio cliente (sql.js `new Database()` vacía)
Técnicamente más simple, pero no cumple "se descarga automáticamente del
servidor al cliente" — y deja el esquema offline fuera del control/versión
del backend (un cambio de esquema requeriría coordinar un despliegue de
frontend sin que el servidor pueda invalidar copias viejas).

## Referencias
- `frontend/src/components/ReportStudioV2/lib/offlineSqlite.ts` (nuevo)
- `frontend/src/lib/connectivityMonitor.ts` (reutilizado, ya existente)
- `frontend/src/components/ReportStudioV2/App.tsx` (banner, rama offline del
  autosave, reconciliación en vivo y al reabrir)
- `frontend/src/components/ReportStudioV2/lib/autosaveEngine.ts` (log.error)
- `frontend/src/components/ReportStudioV2/lib/offlineSyncEngine.ts`
  (eliminado — código muerto, nunca conectado)
- `backend/src/reports/offline_template_data.hpp` (nuevo, generado)
- `backend/src/reports/report_routes.cpp`
  (`GET /api/reports/offline-template`)
- `backend/src/http/router.cpp`, `frontend/nginx.conf` (CSP:
  `'wasm-unsafe-eval'`)
- ADR-041 (`authFetch`), ADR-044 (`.mreport`, `makeOctetResponse`)
