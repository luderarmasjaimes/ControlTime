# ADR-023 — Presupuestos de rendimiento y SLAs operativos

## Actualización 2026-08-03 — O3 no aplica tal cual a exports asíncronos con job (ADR-083/084)

O3 (`export PDF/Word <5s`) se escribió pensando en un export que responde
directo; ADR-016 ya lo implementó como un job — pero seguía siendo un solo
salto síncrono cliente↔sidecar dentro de esos 5s. ADR-083 (PPTX) y ADR-084
(PPTX→MP4 narrado) rompen ese supuesto: son un `POST` que crea un job
(`202`, responde en milisegundos) seguido de **polling** hasta que el
sidecar termina — Chromium + composición de PPTX puede tardar hasta
`BEEMETRY_PPTX_EXPORT_TIMEOUT_MS` (60s configurados) y la composición de
video con `ffmpeg` hasta `BEEMETRY_VIDEO_EXPORT_TIMEOUT_MS` (180s) — un
orden de magnitud (PPTX) o casi dos (video) por encima de la ventana de 5s.

**Hallazgo de instrumentación, no solo de presupuesto**: el código actual
(`App.tsx::handleExportPptx`) envuelve en `measurePerfAsync('export', ...)`
únicamente la llamada de creación del job
(`createPptxExportJob`) — rápida por diseño, cumple O3 trivialmente — no el
ciclo completo hasta la descarga (`pollExportJob` + `fetchExportJobBlob`).
Esto significa que el dashboard de presupuestos (`PerformanceDashboard.tsx`)
mostraría "O3 cumplido" para un export que el usuario percibe tardando
decenas de segundos — la métrica sería técnicamente correcta sobre lo que
mide, pero no representativa de la experiencia real. Mismo tipo de
divergencia "el código hace algo distinto de lo que el ADR/la métrica
implican" que este log ya cerró varias veces (ADR-053, ADR-068, ADR-071),
detectada aquí durante la propia implementación, no después.

**Resolución, mismo criterio que la partición de O6 en ADR-068** (tareas
generativas que tampoco cabían en `<1s` se midieron aparte, con su propio
progreso visible, en vez de forzar el número original o fingir
cumplimiento): O3 **permanece sin cambios para PDF/DOCX** (export síncrono
de un salto, ADR-016/080). Para exports basados en job asíncrono con
polling (PPTX/MP4, ADR-083/084) se **propone** un código de presupuesto
separado — p.ej. `O3b: tiempo total job de export (creación→descarga) <
timeout configurado del job, con progreso visible al usuario` — en vez de
forzar la ventana de 5s a un pipeline que involucra Chromium y/o `ffmpeg`.
**No implementado en esta actualización** (es una propuesta de alcance,
igual que otros bloques "OPEN" de este log): la instrumentación real de
`measurePerfAsync` sobre el ciclo completo queda como trabajo pendiente
explícito, no una corrección silenciosa.

## Actualización 2026-07-24 — O6 dividido por clase de tarea (ADR-068)

La meta O6 `<1 s` permanece para corrección automática LanguageTool/reglas.
Las tareas generativas locales no cumplen ese número en el hardware real:
benchmark de 20 iteraciones, aproximadamente p50 7 s para reescritura con
`gemma2:2b` y 18 s para APA con `qwen2.5:7b`. ADR-068 reemplaza el alcance
único de O6: ambas acciones son asíncronas, instrumentadas y con progreso
visible. Los demás presupuestos permanecen sin cambio.

**Status**: implemented, alcance de cliente interactivo (completado 2026-07-07). Hallazgo adicional durante la implementación: `measurePerfAsync()` existía en `performanceMonitor.ts` pero **nunca se llamaba desde ningún flujo real** (autosave/export/IA corrían sin medir) — `autosaveMs`/`exportMs` siempre estaban en 0. Cerrado así:

1. **`PERFORMANCE_BUDGETS`** en `performanceMonitor.ts` fija los números exactos de este ADR (O1=20ms, O2=500ms, O3=5000ms, O6=1000ms) — antes los "umbrales" del dashboard (100/500ms render, etc.) eran bandas de UX arbitrarias, no los presupuestos reales del ADR.
2. **Contador de violaciones real** (`getBudgetViolations()`): cada vez que una operación excede su presupuesto, se incrementa un contador por código (O1/O2/O3/O6) y se loguea `[ADR-023][código] presupuesto excedido...` — visible ahora en `PerformanceDashboard.tsx`.
3. **Instrumentación real conectada** (antes inexistente): `autosaveEngine.ts` mide cada autoguardado contra O2; `App.tsx` mide los 3 export (PDF servidor+fallback, DOCX, PPTX) contra O3; `PageCanvas.tsx` mide las 3 llamadas de corrección/reescritura IA (`runQuickCorrection`, `runAIImprovement`, `runAdvancedCorrection`) contra O6.

Nota de alcance honesta: para una app interactiva de cliente, "enforcement" no significa bloquear un render o un autosave por ser lento (no tiene sentido rechazar la acción del usuario) — significa medir contra el número real y hacer la violación **visible y contable**, no una percepción. Eso es lo que se implementó. O4 (10k sensores) se valida vía prueba de carga (ver ADR-008, prueba de 21 lecturas end-to-end sin pérdidas), no vía gate en código. O7 (100% auditado) es responsabilidad de ADR-030. ZDL (0% pérdida de datos) depende de modo offline, que sigue diferido (ADR-022) — no aplicable hasta que ese ADR se implemente.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El SOW fija KPIs/SLA medibles que son, en la práctica, **presupuestos de rendimiento** que condicionan decisiones de diseño y se convierten en criterios de hito verificables. Sin escribirlos como restricción explícita, se erosionan en implementación. El autoguardado (`autosaveEngine.js`, cada 5s + retry) y la latencia de pantalla son los más sensibles para el usuario de campo.

## Decisión

Adoptamos los siguientes presupuestos como **restricciones de diseño no negociables**, cada uno con su criterio de validación:

| Código | Presupuesto | Meta | Validación |
|---|---|---|---|
| O1 | Latencia de pantalla (local) | < 20 ms | benchmark de render en S9/S11 |
| O2 | Autoguardado por operación | < 0.5 s | medición de autosave en S4 |
| O3 | Export PDF/Word | < 5 s | job de export en S7 |
| O4 | Sensores simultáneos | 10.000 | simulación S6, estrés S12 |
| O6 | IA local por párrafo | < 1 s | corrección/reescritura S6/S11 |
| O7 | Acciones auditadas | 100% | auditoría S4/S8 |
| ZDL | Pérdida de datos | 0% | prueba offline+reconexión S8 |

### Reglas duras
- Cualquier decisión que viole un presupuesto se rechaza o requiere ADR superseding explícito.
- El autosave es incremental (no guarda el documento entero cada vez) para sostener <0.5 s.
- Las mediciones son comandos reproducibles (ver `plan.md` § 6, hitos), no percepciones.

## Consecuencias

### Positivas
- Convierte KPIs de negocio en restricciones técnicas verificables.
- Da criterios objetivos de aceptación por sprint.

### Negativas / Trade-offs
- Presupuestos agresivos (20 ms, 10k) condicionan el stack (de ahí C++ en hot path, ADR-003/004) y exigen tuning — asumido.

### Neutras
- Algunos presupuestos (10k, DR) se validan recién en Etapa 2; en Etapa 1 se simulan.

## Alternativas descartadas

### Dejar los KPIs solo en el SOW
Quedan como aspiración de negocio sin tracción técnica; se erosionan. Escribirlos como ADR los hace enforced.

## Referencias
- `Referencias/docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` § 3 (KPIs/SLA)
- `Referencias/frontend/src/components/ReportStudioV2/lib/autosaveEngine.js`
- ADR-003 (Boost.Beast), ADR-004 (políglota), ADR-022 (offline), `plan.md` § 6 (hitos)
