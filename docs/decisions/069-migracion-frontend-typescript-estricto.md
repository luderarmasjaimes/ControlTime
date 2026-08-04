# ADR-069 — Migración del frontend a TypeScript estricto

**Status**: implemented, verificado (2026-07-24)
**Fecha**: 2026-07-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

`RUNBOOK.md` y el análisis de brechas registraban TypeScript en 0% y lo
diferían por riesgo. El árbol actual ya contiene la migración prácticamente
completa, pero sin ADR ni actualización de esa línea base. Mantener ambos
relatos hace imposible saber cuál es la fuente real.

## Decisión

El código de producción del frontend se mantiene en `.ts`/`.tsx` con
`strict: true`, `isolatedModules: true` y `noEmit`. Los seis archivos
`.js`/`.jsx` restantes son pruebas/configuración; `allowJs: true` y
`checkJs: false` se conservan solo para compatibilidad incremental de esa
capa. `npm run type-check` es validación obligatoria separada del build Vite.

No se cambia el modelo de ejecución ni la arquitectura React/Zustand/Konva:
esta decisión agrega contratos estáticos y elimina duplicados `.js/.jsx`.

## Consecuencias

- Contratos de props, store, API y bloques del informe quedan verificables en
  compilación.
- Los tests legacy siguen ejecutándose mientras se migran gradualmente.
- `skipLibCheck` permanece para tipos de terceros; no equivale a omitir el
  chequeo del código propio.
- El build todavía genera bundles grandes (4–5 MiB minificados); TypeScript no
  resuelve code splitting y esa advertencia queda como mejora de rendimiento.

## Alternativas descartadas

- **Volver al árbol JavaScript**: perdería el chequeo ya conseguido.
- **Activar `checkJs` sobre todos los tests de una vez**: mezcla la migración
  de producción ya cerrada con una iniciativa separada de tests.
- **Confiar solo en Vite**: transpila TypeScript, pero no sustituye `tsc`.

## Evidencia y referencias

- `frontend/tsconfig.json`, `frontend/package.json`
- Auditoría 2026-07-24: 111 archivos `.ts/.tsx`, 6 `.js/.jsx` (todos
  tests/config); el baseline Git tenía 97 `.js/.jsx`.
- `npm run type-check`: OK; `npm run build`: OK; Vitest: 18/18.
