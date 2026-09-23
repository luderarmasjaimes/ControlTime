# ADR-176 — Catálogo de pendientes menores: código sin conectar, artefactos sin efecto y utilidades a revisar

**Status**: 📋 proposed — este ADR cataloga, no decide; cada ítem queda con su propia decisión pendiente, ver "Decisión"
**Fecha**: 2026-09-12
**Autores**: Luder Armas (con Claude Code)
**Ámbito**: reports

## Contexto

La auditoría de conformidad del frontend (2026-09-11/12) encontró, además
de los conflictos críticos y la funcionalidad mayor ya formalizada en
ADR-171 a 175, un puñado de hallazgos menores que no ameritan una decisión
de arquitectura por sí solos pero tampoco deben quedar sueltos sin
registro — exactamente el tipo de ítem que este log está pensado para
capturar: "una decisión arquitectónica sin ADR no existe" también aplica a
la decisión de **posponer** algo a propósito. Este ADR no resuelve ninguno
de los tres — los deja bien sustentados (evidencia + opciones reales) para
que se decida más adelante con contexto completo, sin tener que releer el
código desde cero.

## Decisión

No se toma ninguna acción de código en este ADR. Se registra cada ítem con
su estado real, la evidencia que lo sustenta, y las opciones concretas para
decidir después.

### 1. `auth/authSessionManager.ts` — completo pero desconectado

**Estado real**: código terminado y funcional, cero errores, depende solo
de funciones ya existentes y exportadas (`getSession`/
`isAccessTokenExpiringSoon` de `authStorage.ts`, `refreshAccessToken` de
`authApi.ts`). Exporta una sola función pública,
`startAuthSessionManager(): () => void` (línea 62), que arranca un
intervalo de `CHECK_INTERVAL_MS = 30_000` (30s) y renueva el access token
cuando falta menos de `REFRESH_MARGIN_SECONDS = 120` (2 min) para que
venza, más renovación en los eventos `visibilitychange` y `focus`.

**Evidencia de que está desconectado**: búsqueda exhaustiva (`grep -rn
"authSessionManager" frontend/src`) no encuentra ningún import fuera del
propio archivo — le falta exactamente la línea de wiring (`useEffect(() =>
startAuthSessionManager(), [])` o equivalente) en el punto de arranque de
la app (`App.tsx`, junto a `installNavClickGuard`).

**Qué complementaría, no reemplaza**: hoy la sesión se renueva de forma
**reactiva** por dos caminos ya activos — `App.tsx` refresca una vez al
montar la sesión, y `authApi.ts` reintenta con refresh cuando un `fetch`
responde 401. `authSessionManager.ts` agregaría renovación **proactiva**
para pestañas abiertas e inactivas (tablet de campo dejada abierta),
evitando el 401 en primer lugar en vez de recuperarse después de que ya
ocurrió.

**Opciones para decidir**:
- **(A) Conectarlo**: agregar la línea de wiring en `App.tsx`. Beneficio:
  cierra la ventana pequeña de peticiones fallidas en sesiones largas e
  inactivas. Costo: un intervalo adicional de 30s corriendo mientras la app
  esté abierta (footprint bajo, ya está escrito para limpiarse solo vía el
  cleanup que devuelve).
- **(B) Eliminarlo**: si se decide que el mecanismo reactivo ya es
  suficiente para el uso real observado, borrar el archivo en vez de
  dejarlo como código muerto indefinidamente.
- **(C) Dejarlo como está**: sin acción — riesgo bajo hoy (no se ejecuta),
  pero acumula como deuda de "¿por qué existe esto si nadie lo usa?" para
  quien lea el código más adelante.

### 2. `pnpm-workspace.yaml` — artefacto sin efecto

**Estado real**: contenido completo del archivo:
```yaml
allowBuilds:
  es5-ext: set this to true or false
```
Es literalmente el placeholder que `pnpm` genera cuando bloquea el script
de postinstall de un paquete (`es5-ext`) y pide aprobación explícita del
desarrollador — nadie completó el valor (la cadena no es `true` ni `false`,
no es YAML de configuración válido en ese campo).

**Por qué no afecta nada hoy**: el proyecto compila con **npm**
(`package-lock.json`, `frontend/Dockerfile` invoca `npm ci`/`npm run
build`) — npm ignora por completo `pnpm-workspace.yaml`. El archivo está
**sin trackear en git** (`git status` lo marca `??`, sin historial), así
que tampoco se propaga a otro checkout.

**Opciones para decidir**:
- **(A) Borrarlo** — recomendado por simplicidad: es un residuo de que
  alguien probó `pnpm install` localmente en algún momento; no bloquea
  nada, pero puede confundir a quien vea el archivo y asuma que el
  proyecto usa pnpm.
- **(B) Dejarlo** — sin urgencia real, dado que no está trackeado y no
  afecta CI/Docker.

### 3. Utilidades menores nuevas — sin riesgo, solo catalogadas

Tres archivos nuevos que la auditoría revisó y no encontró ningún problema,
se dejan documentados acá para que el catálogo de "qué es cada cosa nueva"
quede completo, no porque requieran una decisión:

- **`lib/usePopover.ts`**: hook de posicionamiento de popover vía
  `getBoundingClientRect` + portal, extraído de `RibbonToolbar.tsx` para
  reusar en `PageCanvas.tsx`; cierra al hacer click fuera. Extracción
  limpia, sin riesgo.
- **`lib/useSharedPoll.ts`**: hook con `useSyncExternalStore` que comparte
  un único timer/fetch HTTP entre todos los widgets que sondean la misma
  `key` — evita N peticiones idénticas por N bloques de sensor/KPI en el
  lienzo (usado, entre otros, por `MiningKpiWidget.tsx` tras la
  reorganización de ADR-174). Mejora de eficiencia real, sin riesgo
  funcional.
- **`lib/sensorMockData.ts`**: generador determinístico de series falsas
  (patrones por tipo de sensor: piezómetro, inclinómetro, radar, etc.) para
  `SensorMultiChartWidget.tsx` cuando falta telemetría real — **no
  exclusivo del sitio público**, también se inyecta en el widget real del
  editor de informes. Riesgo de mostrar datos falsos como reales ya
  mitigado en el propio código: la insignia "DATOS DE PRUEBA" se fuerza
  visible siempre (comentario explícito: *"ni en el editor ni en un export
  ya generado... por eso va siempre visible"*), incluida en capturas a
  PDF/DOCX/PPTX — no se encontró forma de ocultarla.

**Opción para decidir**: ninguna acción requerida; queda como referencia
para no tener que re-auditar estos tres archivos en una pasada futura.

## Consecuencias

### Positivas
- Ningún hallazgo de esta lista queda "perdido" entre el código y la
  memoria de quien hizo la auditoría — cualquiera puede retomar la decisión
  con el contexto completo acá.
- Separa explícitamente "esto no importa" (utilidades menores) de "esto sí
  requiere una decisión, solo que no urgente" (los otros dos).

### Negativas / Trade-offs
- Ninguna — este ADR no cambia comportamiento, solo documenta.

## Alternativas descartadas

### Resolver los tres ítems ahora mismo (conectar/borrar de una vez)
Se descartó a propósito: el pedido explícito fue dejarlos "bien
sustentados... para su revisión posterior y toma de decisiones luego" — no
todos los pendientes de un proyecto deben resolverse en el momento en que
se los encuentra, y forzar una decisión sin más contexto de negocio (¿hay
reportes reales de sesiones que se cortan por inactividad? ¿alguien más en
el equipo usa pnpm?) sería decidir a ciegas.

## Referencias
- `frontend/src/auth/authSessionManager.ts`
- `frontend/src/auth/authStorage.ts` (`isAccessTokenExpiringSoon`), `frontend/src/auth/authApi.ts` (`refreshAccessToken`)
- `frontend/pnpm-workspace.yaml`
- `frontend/src/components/ReportStudioV2/lib/usePopover.ts`, `useSharedPoll.ts`, `sensorMockData.ts`
- ADR-174 (`useSharedPoll` en uso real dentro de `MiningKpiWidget.tsx`)
