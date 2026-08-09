# ADR-073 — Modal propio reemplaza diálogos nativos del navegador; correcciones de consistencia visual del ribbon

**Status**: implemented, ampliado y verificado (2026-07-27)
**Fecha**: 2026-07-25
**Autores**: EC
**Ámbito**: reports

**Actualización 2026-07-27:** se eliminó el estado/render muerto `showToc`.
La acción visible “Índice” conserva una sola semántica: insertar/refrescar el
bloque TOC paginado de ADR-071; ya no existe un panel flotante inaccesible.
**Relación**: extiende ADR-050/053/070 (mismo sistema de bloques y estilos); no cambia el modelo de documento.

> Estado de despliegue 2026-07-27: la ampliación completa compila, pasa
> Vitest y no deja llamadas nativas activas en fuente. La imagen frontend
> debe reconstruirse/activarse para que el host global de confirmaciones y
> avisos quede disponible en el contenedor.

## Contexto

Tres hallazgos independientes, encontrados por el usuario probando la
aplicación real y confirmados en vivo, uno tras otro en la misma sesión:

1. **Guardar un informe nuevo usaba `window.prompt()`/`window.confirm()`**
   nativos del navegador para pedir el título (y, en el caso de conflicto
   offline de ADR-022, para elegir sobrescribir vs. copia nueva). Funcional
   para una persona real (ve el diálogo, escribe, acepta), pero visualmente
   inconsistente con el resto de la aplicación (tipografía/colores del
   sistema operativo, no de la plataforma) y, más grave desde el punto de
   vista de calidad: **no automatizable**. `window.prompt()` devuelve `null`
   sin intervención humana en cualquier navegador dirigido por automatización
   (Playwright y equivalentes) — al probar el guardado con el navegador
   controlado por IA, el código entraba a `if (input === null) return;` y
   **nunca llegaba a guardar nada**, sin ningún error visible. Esto hizo
   perder un informe de prueba de 27 páginas construido en la misma sesión
   (nunca persistido en `reports`, confirmado con `SELECT count(*)` contra
   Postgres real) antes de diagnosticarse la causa exacta.
2. **La barra flotante contextual** (controles de corrector ortográfico,
   dictado, edición) usaba un fondo *glass* translúcido oscuro sobre la hoja
   BLANCA del lienzo — botones sin superficie visible en reposo (fondo
   transparente) e íconos de bajo contraste (`--text-dim: #94a3b8`),
   reportado directamente por el usuario como "no son visibles por la falta
   de contraste".
3. **El ribbon usaba `overflow-x:auto`** en una sola fila: en viewports
   angostos, los grupos "Bloques Técnicos", "Secciones" y "Gráficos con
   datos" (ADR-070) quedaban ocultos tras scroll horizontal sin ninguna
   pista visual de que existían más grupos.

## Decisión

1. **`SaveTitleModal.tsx`** reemplaza ambos `window.prompt()` de
   `handleSaveReport` (informe nuevo; copia offline nueva de ADR-022) con un
   modal propio que reutiliza las clases `ra-*` ya existentes en
   `styles.css` (las mismas de `ReportsAdminModal`/`DeleteReportConfirm`):
   overlay con blur, tarjeta `#0f172a`/borde `#334155`, encabezado `#0a1020`
   con acento índigo, botones `ra-btn-ghost`/`ra-btn-primary`. Contrato
   idéntico a `window.prompt()` (resuelve con el string o `null` al
   cancelar) vía una promesa (`promptForTitle`), así que no hubo que tocar
   la lógica de guardado en sí, solo el mecanismo de entrada.
2. **Barra flotante**: fondo sólido `#0f1e38` (ya no *glass* translúcido),
   botones con superficie visible en reposo (`rgba(255,255,255,.08)` + borde
   sutil) e íconos claros (`#e2e8f0`); hover en índigo.
3. **Ribbon**: `.ribbon-body` pasa a `flex-wrap:wrap` — los grupos que no
   caben bajan a una segunda fila en vez de ocultarse tras scroll.

## Consecuencias

- El guardado de informes nuevos ahora es determinístico y **automatizable**
  end-to-end (probado: guardar con título → `POST /api/reports → 201`, fila
  real verificada en Postgres; cancelar → cero informes nuevos en la tabla).
- Ningún modelo de datos ni contrato de API cambia — es una sustitución de
  mecanismo de entrada de un string, no una decisión de datos.
- El panel de navegación flotante (`showToc`, ver actualización de ADR-071)
  no se relaciona con este ADR; es un hallazgo aparte encontrado la misma
  sesión.
- No quedan llamadas activas a `window.alert()`, `window.confirm()` ni
  `window.prompt()` en `frontend/src`; las coincidencias restantes son
  comentarios explicativos o funciones internas de componentes.

## Actualización 2026-07-27 — cierre completo de diálogos nativos

`ConfirmActionDialog.tsx` aporta un host global accesible (`role=alertdialog`)
para confirmaciones y avisos. Se migraron los conflictos offline, restauración
de versiones, sesión/tenant faltante, errores de carga, exportación portable,
rechazo de workflow, eliminación de alarmas/canales y revocación/reset de
permisos. El texto se obtiene del diccionario ES/EN/FR/PT-BR. La descripción
de snapshots reutiliza `SaveTitleModal`; `Esc` y clic exterior cancelan de
forma determinista.

Esta ampliación cierra expresamente el riesgo aceptado en la versión inicial
del ADR y es compatible con ADR-022: cambia la presentación de la decisión,
no la semántica de conservación de copias ni la resolución de conflictos.

## Alternativas descartadas

- **Dejar `window.prompt()` y solo documentar la limitación**: no resuelve
  la inconsistencia visual reportada por el usuario ni el riesgo real de
  pérdida de trabajo (ya ocurrió una vez en esta misma sesión).
- **Reescribir la barra flotante con un tema claro** en vez de oscuro sólido:
  el resto del *chrome* de edición (ribbon, sidebar) ya es oscuro; un tema
  claro aislado sería la inconsistencia inversa.

## Evidencia y referencias

- `frontend/src/components/ReportStudioV2/components/modals/SaveTitleModal.tsx`
- `frontend/src/components/ReportStudioV2/App.tsx` (`promptForTitle`,
  `handleSaveReport`)
- `frontend/src/components/ReportStudioV2/styles.css`
  (`.floating-contextual-toolbar`, `.floating-tool-btn`)
- `frontend/src/components/ReportStudioV2/ribbon.css` (`.ribbon-body`)
- Verificado en vivo (navegador real, no solo build): estilos computados del
  modal coinciden exactamente con la paleta `ra-*` (`rgb(15,23,42)` fondo,
  `rgb(51,65,85)` borde, `rgb(79,70,229)` botón primario); guardar con
  título real produce `201 Created` + fila en `reports`; cancelar no
  persiste nada (conteo de filas sin cambio). `npm run type-check` y
  `npm run build`: OK.
