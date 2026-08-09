# ADR-022 — Modo offline: cola de operaciones versionada + IndexedDB + conflicto explícito

**Actualización 2026-07-13 (cierre parcial vía ADR-045)**: el modo offline
diferido aquí se implementó, pero con un diseño distinto al que este ADR
pedía como condición — usa **SQLite compilado a WASM (sql.js)** en vez de
IndexedDB (una de las alternativas que este mismo ADR ya anticipaba si
IndexedDB no superaba la PoC: "SQLite WASM con OPFS"), persistido vía Cache
API. Cumple los criterios reales de la PoC (documento >5MB posible,
durabilidad ante recarga/cierre del navegador, verificado end-to-end). En
ese momento **no** cumplía la regla dura "prohibido last-write-wins
silencioso" — quedó documentado como pendiente.

**Actualización 2026-07-13 (cierre completo — la pieza pendiente de arriba
ya está implementada)**: el negocio pidió explícitamente resolver ese
pendiente: detectar cuándo otra terminal actualizó el informe mientras esta
terminal editaba offline, preguntar al usuario si quiere traer la versión
del servidor o seguir con su copia, y — si sigue con su copia — dejarlo
elegir entre sobrescribir la versión del servidor o guardar como un informe
nuevo al guardar. Además se agregó un checkpoint forzado cada 3 minutos en
línea (pedido de negocio, no parte del ADR original) como red de seguridad
adicional sobre el autosave por diff existente. Ver el detalle completo más
abajo, en la sección "Cierre completo (2026-07-13)".

**Status**: implemented — ambas piezas pendientes (persistencia offline real
y resolución de conflictos por versión-base) cerradas. Único desvío
consciente frente al diseño original: SQLite/WASM en vez de IndexedDB (ver
arriba), y confirm()/prompt() nativos en vez de una UI de conflicto dedicada
(ver "Alternativas descartadas" al final).

## Cierre completo (2026-07-13)

### Concurrencia optimista real, no solo del lado del cliente

La pieza que realmente cierra "prohibido last-write-wins silencioso" vive en
el **backend**, no en el navegador — un chequeo del lado del cliente por sí
solo tiene una ventana de carrera (TOCTOU: alguien puede actualizar el
informe justo entre que el cliente consulta la versión y envía su guardado).

`updateReportPg` (`report_service.cpp`) acepta un `expectedVersion` opcional.
Dentro de la MISMA transacción con `SELECT ... FOR UPDATE` que ya existía
(ADR-017, para la máquina de estados), se lee también el `version_number`
real y se compara contra `expectedVersion` **antes** de aplicar cualquier
cambio — si no coincide, se hace `ROLLBACK` sin tocar un byte y se devuelve
`error="version_conflict:<versionActual>"`. `report_routes.cpp` lo traduce a
`409 Conflict` con `{error: "version_conflict", server_version: N}`. Vacío
(comportamiento normal de autosave/guardado en línea, que siempre parte de
la versión recién confirmada) preserva el comportamiento anterior sin
chequeo — no hay riesgo real de conflicto en ese camino.

### Versión-base del snapshot offline

`offlineSqlite.ts`: la tabla `offline_reports` gana una columna
`base_version_number` (migrada en el sitio con `ALTER TABLE` idempotente,
sin necesidad de regenerar/versionar la plantilla SQLite embebida — ver
`ensureSchemaUpgraded()`). Se fija a la versión del servidor vigente cuando
empieza la divergencia offline, y **se preserva** (no se pisa) mientras el
snapshot siga `dirty=1` — sucesivos autoguardados offline del mismo informe
no deben mover la versión-base, solo el primero importa.

### Flujo de reconexión con conflicto real

Al volver la conectividad (`App.tsx`), si hay un snapshot offline `dirty`
para el informe abierto, se intenta el `PUT` con `expected_version` =
versión-base local:

- **Sin conflicto** (nadie más tocó el informe): el servidor acepta
  directamente — caso común, ningún prompt.
- **Con conflicto** (`409`): se pregunta al usuario (`confirm()`, ver nota
  de UI abajo) — *"El informe fue actualizado en el servidor (versión N)
  mientras trabajabas sin conexión... ¿Actualizar tu copia con la versión
  del servidor?"*
  - **Sí** → se descarta la copia offline, se trae el contenido real del
    servidor (`fetchReportById` + `loadDocument`), se marca el snapshot
    local como sincronizado (ya resuelto, no vuelve a preguntar).
  - **No** → el informe queda marcado `workingOfflineConflict = true`: un
    banner persistente indica *"Hay conexión al servidor, pero este INFORME
    sigue en modo OFFLINE"* — el autosave (cada 5s) sigue escribiendo en
    SQLite local, NO en el servidor, aunque haya red real, hasta que el
    usuario resuelva el conflicto explícitamente.

### Resolución al presionar "Guardar" con conflicto pendiente

`handleSaveReport` detecta `workingOfflineConflict` y pregunta de nuevo,
esta vez la decisión final:
- **Sobrescribir** → seguir con el guardado normal (PUT sin
  `expected_version` esta vez — el usuario ya confirmó explícitamente pisar
  la versión del servidor).
- **Guardar como informe nuevo** → `POST /api/reports` (nunca PUT sobre el
  id viejo) con un título nuevo (propuesto: `"<título> (copia offline)"`,
  editable); el informe viejo queda intacto con la versión del servidor, el
  contenido offline sobrevive como un documento propio. **Nunca se descarta
  trabajo silenciosamente**, cumpliendo la regla dura original de este ADR.

### Checkpoint forzado cada 3 minutos en línea (pedido de negocio adicional)

Nuevo `useEffect` en `App.tsx`, independiente del autosave por diff (5s):
mientras haya conexión real y el informe no tenga un conflicto offline sin
resolver, fuerza un guardado del estado actual cada 3 minutos exactos,
**incondicionalmente** (haya o no diff detectado) — red de seguridad
adicional para que la base de datos centralizada nunca quede más de 3
minutos desactualizada aunque el autosave por diff fallara silenciosamente
por algún motivo no previsto. Trade-off aceptado: puede generar una entrada
de `report_content_revision` con contenido idéntico si no hubo cambios
reales — costo bajo (una fila de historial) frente a la garantía de
frescura que pidió el negocio.

### Verificado end-to-end contra el backend y navegador reales

- Backend (curl): crear informe (v1) → actualizar sin `expected_version`
  (v2, comportamiento normal) → actualizar con `expected_version` viejo (v1)
  → `409 version_conflict` con `server_version: 2` correcto, **contenido
  sin modificar** (verificado leyendo el título tras el intento fallido) →
  actualizar con la versión correcta (v2) → acepta, v3.
- Navegador real (sin recargar la página, transición de conectividad en
  vivo): informe creado y guardado (v1) → simulada la caída de red → editado
  offline (bloque de texto insertado, persistido en SQLite local vía Cache
  API) → **otra "terminal" (petición HTTP directa) actualiza el mismo
  informe a v2** mientras el navegador seguía "offline" → reconexión real →
  `409` detectado, `confirm()` respondido "no" → banner de "informe en modo
  OFFLINE" visible correctamente → al presionar "Guardar" con `confirm()`
  "no" (guardar como nuevo) → nuevo informe creado con el contenido offline,
  **el informe original permaneció con el título de la v2 del servidor,
  sin pisar ni perder ningún dato**. Datos de prueba limpiados tras
  verificar.

## Alternativas descartadas (cierre 2026-07-13)

### UI de conflicto dedicada (modal propio) en vez de `confirm()`/`prompt()` nativos
Sería más pulido visualmente, pero el propio código base ya usa
`window.confirm`/`window.prompt` para decisiones equivalentes de guardado
(nombrar un informe nuevo, restaurar un snapshot offline recuperado al
reabrir — ver ADR-045). Construir un modal dedicado solo para este flujo,
cuando el patrón ya establecido en el proyecto resuelve el mismo problema
(decisión bloqueante, dos opciones claras) sin trabajo de diseño nuevo, era
sobre-ingeniería para el alcance pedido. Revisitable si UX pide pulir esta
interacción específica más adelante.

### Rechazar la reconexión-con-conflicto en vez de ofrecer "seguir offline"
Forzar sí-o-sí a elegir "traer la versión del servidor" en el momento de
reconectar habría sido más simple, pero descarta la posibilidad de que el
usuario quiera revisar con calma qué cambió antes de decidir — exactamente
el escenario que la regla dura de este ADR ("resolución manual, nunca
automática") pide evitar.

---
**Nota original (2026-06-24), antes del cierre parcial de 2026-07-13**:

**Status**: deferred, confirmado (verificado 2026-07-06: cero referencias a `indexedDB`/`idb`/cola offline en todo `frontend/src` — el diferimiento declarado es exacto, no se implementó nada por debajo de la mesa)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

La promesa dura #1 incluye 0% de pérdida de datos operando aun sin conectividad (campo, socavón). El SOW descarta app nativa: el offline es en web responsive (tablet). El código actual usa una **cola en localStorage** (`offlineSyncEngine.js`, clave `aurixa_offline_queue`) + polling de `/api/health`, sin estrategia de conflictos definida. localStorage es frágil (límite ~5MB, síncrono, se puede limpiar) y last-write-wins silencioso arriesga pisar datos.

## Decisión

El modo offline **no entra en v0.1**: se **difiere a una versión futura, condicionado a superar una PoC** que valide una técnica de almacenamiento local por encima del límite de **~5MB de localStorage** (que se estima insuficiente para una sesión de trabajo offline real, con documentos e imágenes). El candidato principal de la PoC es **IndexedDB** (la opción elegida abajo). **Superada la PoC**, el modo offline se implementará con una **cola de operaciones versionada en IndexedDB** y **resolución de conflictos explícita**:

1. Cada cambio offline se encola con su **versión-base** (la versión del documento sobre la que se editó).
2. Al reconectar, el servidor aplica la operación **solo si la versión-base coincide**; si no, marca **conflicto** y lo deja para **resolución manual** (no auto-merge silencioso).
3. La cola persiste en **IndexedDB** (no localStorage) por durabilidad y capacidad.
4. Nada se descarta sin registrar: una operación en conflicto se conserva y se audita = 0% pérdida real.

### Criterios de éxito de la PoC (precondición para implementar)

- Almacenar y recuperar de forma fiable una cola/documento offline de **tamaño realista** (objetivo: ≫ 5MB; p.ej. 50–200 MB con imágenes) sin el tope de localStorage.
- **Durabilidad**: el dato sobrevive recargas, cierre del navegador y reinicio del dispositivo (tablet de campo).
- **Cuota/limpieza** del navegador entendida y manejada: si el navegador puede purgar datos, se detecta y se evita pérdida silenciosa (alinea con 0% pérdida).
- Rendimiento de lectura/escritura de la cola aceptable bajo ese volumen.

Si la PoC no se supera con IndexedDB, se evalúan alternativas (Origin Private File System / File System Access API, SQLite WASM con OPFS) antes de comprometer el modo offline.

### Reglas duras
- Migrar la cola de localStorage → IndexedDB.
- Prohibido last-write-wins silencioso: un conflicto siempre es visible y resoluble.
- La detección de conexión no depende solo de polling; usa eventos de red + verificación contra `/api/health`.
- Los campos autoritativos (ADR-021) los gana la BD en la reconciliación; el contenido en conflicto se preserva para el usuario.

## Consecuencias

### Positivas
- 0% pérdida real: ningún cambio se pierde silenciosamente.
- IndexedDB soporta documentos grandes y es robusto ante recargas.

### Negativas / Trade-offs
- Resolución manual de conflictos exige UX adicional — necesaria para no pisar trabajo.
- Más complejo que last-write-wins — justificado por la promesa de 0% pérdida.

### Neutras
- No es co-edición en tiempo real (eso sería CRDT); es edición offline con reconciliación.

## Alternativas descartadas

### Last-write-wins por timestamp
Muy simple, pero puede pisar silenciosamente el trabajo de otro → viola 0% pérdida. Rechazado.

### CRDT (merge automático)
Robusto para co-edición concurrente, pero complejo y costoso para informes estructurados/firmables; sobre-ingeniería para v0.1. Reevaluable si aparece co-edición simultánea real.

### Seguir con localStorage
Frágil (tamaño, limpieza del navegador, síncrono). Rechazado por durabilidad.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/lib/offlineSyncEngine.js`
- `Referencias/docs/02_Arquitectura/Arquitectura_Solucion_AURIXA_v36.md` § 8.1
- ADR-015 (versionado server), ADR-021 (metadatos), ADR-023 (autosave)
- ADR-045 (persistencia offline SQLite/WASM — la primera mitad de este cierre)
- `backend/src/reports/report_service.hpp/.cpp` (`expectedVersion`,
  `version_conflict`), `backend/src/reports/report_routes.cpp` (409)
- `frontend/src/components/ReportStudioV2/lib/offlineSqlite.ts`
  (`base_version_number`, `ensureSchemaUpgraded`)
- `frontend/src/components/ReportStudioV2/App.tsx` (flujo de reconexión con
  conflicto, `workingOfflineConflict`, checkpoint de 3 minutos)
