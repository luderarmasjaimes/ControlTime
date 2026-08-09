# ADR-093 — Vite 8/Rolldown: migración parcial sin commitear, bug de interop CJS→ESM en Plotly, fix aplicado

**Status**: partial — toolchain actualizado y el bug encontrado corregido, pero **todo el árbol sigue sin commitear** (ver Consecuencias)
**Fecha**: 2026-08-07
**Autores**: EC (auditoría de ADRs pendientes solicitada por Gerencia)
**Ámbito**: plataforma
**Relación**: se apoya sobre ADR-069 (`migracion-frontend-typescript-estricto`), cuyo estado real también se corrige aquí (ver Consecuencias); reemplaza la hipótesis no confirmada de la sección "3 specs siguen fallando" de ADR-059 (`plan-maestro-pruebas-qa`).

## Contexto

Durante la auditoría general de ADRs pendientes se encontró que `frontend/`
tiene **~739 archivos sin commitear** en el working tree (ninguno en
`git log`), acumulados desde al menos el 24 de julio de 2026 (fecha de
ADR-069). La mayor parte es la migración JS→TS que ADR-069 ya documenta como
"implemented, verificado" citando `npm run build: OK` — pero esa verificación
nunca llegó a un commit real; el ADR describe un estado que solo existe en
disco, no en git.

Sobre ese árbol, con fecha más reciente (2 y 3 de agosto de 2026, según
comentarios de código y `mtime` de archivo), alguien agregó — también sin
commitear y **sin ADR**:

- `vite` `^5.2.0` → `^8.2.0` (Vite 8 reemplaza Rollup por **Rolldown**, su
  nuevo bundler en Rust, para el build de producción).
- `vitest` `1.3.9` → `4.1.10`, `@vitejs/plugin-react` `4.2.1` → `6.0.5`.
- `frontend/src/components/ReportStudioV2/components/dashboard/LiveChartBlock.tsx`
  (nuevo, sin commitear): reemplaza el bundle completo de `plotly.js` por
  `plotly.js-basic-dist-min` (~1MB vs 4.75MB) vía `react-plotly.js/factory`,
  para reducir el peso del único componente de la plataforma que usa Plotly.

Verificado en vivo (login real `larmas`/Alpayana/123456 y también
`demo_beemetry_admin`/Beemetry): abrir **Informes → Informes** producía una
pantalla en blanco para **cualquier usuario**, sin excepción, con
`TypeError: (0, $a.default) is not a function` en el chunk minificado de
`ReadOnlyViewer` (build de producción) o `TypeError: createPlotlyComponent is
not a function` en `LiveChartBlock.tsx:21` (dev). Esto invalidaba la
hipótesis sin confirmar de ADR-059 ("3 specs Playwright fallan, ¿gate de
permisos de ADR-079?") — se verificó por SQL directo que tanto `operator`
como `manager` tienen `informes.edit` en la matriz por defecto y que no hay
override de tenant para Alpayana: el gate de permisos **no es la causa**. El
árbol sin commitear roto, sirviéndose en dev/dist, sí lo es.

## Causa raíz

`react-plotly.js/factory` es CJS con `exports.default = fn` propio
(`__esModule: true`). `plotly.js-basic-dist-min` es UMD puro (sin
`__esModule`, `module.exports` es directamente el objeto `Plotly`). El
interop CJS→ESM para el **import por namespace** (`import * as X from
'modulo'`) de un módulo que YA declara su propio `.default` difiere entre
bundlers:

- **esbuild** (usado por Vite en dev para el prebundle de dependencias,
  `node_modules/.vite/deps/*`): envuelve DOS veces —
  `X.default = { default: fn }` — porque respeta el `.default` propio del
  módulo y además añade el suyo.
- **Rolldown** (bundler nuevo de Vite 8 para `vite build`, reemplaza a
  Rollup): envuelve UNA vez — `X.default = fn`.

El código original (`import createPlotlyComponent from
'react-plotly.js/factory'`, import por defecto simple) dependía de que el
bundler resolviera automáticamente ese único nivel de interop — funcionaba
bajo Rollup (Vite 5) pero Rolldown (Vite 8) resulta en una llamada
`(0,$a.default)(...)` donde `$a.default` no es la función esperada. Un primer
intento de arreglo (`X.default ?? X`) solo corrige Rolldown y rompe esbuild
(doble envoltura → sigue sin ser función), confirmando que el número de
envolturas **no es fijo entre bundlers** para este tipo de módulo.

## Decisión

1. **Fix aplicado en `LiveChartBlock.tsx`**: en vez de asumir un número fijo
   de niveles de interop, se importa por namespace (`import * as
   PlotlyFactoryModule from 'react-plotly.js/factory'`) y se pela `.default`
   en un bucle hasta encontrar una función real:
   ```ts
   function unwrapDefault<T>(mod: unknown): T {
     let value: any = mod;
     while (value && typeof value !== 'function' && 'default' in value) {
       value = value.default;
     }
     return value as T;
   }
   ```
   Esto resuelve correctamente tanto el doble envoltorio de esbuild (dev)
   como el envoltorio simple de Rolldown (build), sin depender de un
   comportamiento específico de un bundler. Para `plotly.js-basic-dist-min`
   (UMD puro, sin `.default` propio) el envoltorio siempre es simple, así
   que `X.default ?? X` es suficiente ahí.
2. **No se revierte** el upgrade a Vite 8/Rolldown ni el swap de Plotly —
   Gerencia decidió "arreglar hacia adelante" en vez de revertir al ver el
   hallazgo, para conservar la reducción de peso del bundle y no perder el
   trabajo de toolchain ya hecho.
3. **Se corrige el estado de ADR-069**: su texto original describe la
   migración TS como "verificada" sin aclarar que nunca se commiteó. Este
   ADR dejó constancia del hallazgo real (ver Consecuencias) sin reescribir
   el ADR original, según la convención del proyecto (nunca editar el texto
   de un ADR ya escrito).

## Verificación

- `npm run type-check`: OK (0 errores) tras el fix — el primer intento de
  tipar `unwrapDefault<typeof import('react-plotly.js/factory').default>`
  falló (`TS2694`, el módulo no tiene tipos reales — `vite-env.d.ts` lo
  declara con `declare module 'react-plotly.js/factory';` vacío); se tipó el
  resultado como el shape real de la función factory en vez de depender de
  un tipo inexistente.
- `npx vite build`: OK, sin cambios de tamaño de bundle relevantes
  (`ReadOnlyViewer` sigue en ~143.8 kB / ~48 kB gzip).
- Verificado en navegador real contra **ambos** bundlers: `npm run dev`
  (esbuild) y `vite preview` sirviendo el `dist/` de producción (Rolldown).
  En ambos, login real `larmas`/Alpayana/123456 → Informes → Informes
  renderiza un informe real (`rep_2026_01`, borrador) sin ningún error de
  consola, donde antes crasheaba en los dos.

## Consecuencias

- **El módulo Informes vuelve a funcionar** para cualquier usuario/tenant en
  el árbol de trabajo actual (dev y build de producción).
- **ADR-069 queda con un estado incorrecto sin corregir en su propio
  texto**: dice "implemented, verificado" pero nada de esa migración está en
  git. Mientras el árbol siga sin commitear, cualquier `git checkout`/`git
  reset`/clon nuevo pierde por completo el trabajo — TS, Vite 8, el fix de
  este ADR, y los ~739 archivos. Esto queda fuera del alcance de este ADR
  (es una decisión de gestión de repositorio, no de arquitectura) pero debe
  quedar explícito: **hasta que alguien commitee ese árbol, "implemented" en
  ADR-069 no es cierto en ningún sentido que sobreviva a un checkout**.
- El patrón `unwrapDefault` queda como referencia para cualquier otra
  dependencia UMD/CJS-con-`.default`-propio que se agregue mientras el
  proyecto tenga que soportar builds bajo dos bundlers distintos (dev
  esbuild / build Rolldown) — no es exclusivo de Plotly.

## Alternativas descartadas

- **Revertir Vite 8/vitest/plugin-react/plotly-basic-dist a las versiones
  previas**: descartado por decisión explícita de Gerencia (arreglar hacia
  adelante en vez de revertir).
- **Volver a `plotly.js` completo** (sin el swap a `-basic-dist-min`):
  evitaría el bug de interop sin arreglarlo, pero reintroduce 3.75MB extra
  de bundle sin necesidad — el bug es del interop del import, no del paquete
  basic-dist en sí.
- **Fijar `X.default.default` a mano**: funcionaría hoy pero se rompería de
  nuevo ante cualquier cambio de versión de esbuild/Rolldown que ajuste su
  profundidad de envoltura; el bucle de `unwrapDefault` es robusto a eso.

## Referencias

- `frontend/src/components/ReportStudioV2/components/dashboard/LiveChartBlock.tsx`
- `frontend/package.json` (versiones de `vite`, `vitest`,
  `@vitejs/plugin-react`, `plotly.js-basic-dist-min`)
- `frontend/src/vite-env.d.ts` (`declare module 'react-plotly.js/factory'`
  sin tipos)
- ADR-069 (`migracion-frontend-typescript-estricto`)
- ADR-059 (`plan-maestro-pruebas-qa`) — sección "3 specs siguen fallando",
  hipótesis de gate de permisos descartada por este hallazgo
