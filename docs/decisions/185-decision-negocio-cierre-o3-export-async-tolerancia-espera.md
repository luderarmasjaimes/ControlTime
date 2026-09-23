# ADR-185 — Decisión de negocio: se cierra SPEC-007 T15/O3 aceptando el tiempo de export medido y optimizado (proceso asíncrono, no crítico en tiempo real)

> **Actualización 2026-09-14 — countersign formal del Arquitecto TI, sirve
> como acta de cierre de R3 (decisión pendiente #1 del corte gerencial del
> 30-ago, reiterada sin acta en el informe del 13-sep).** La decisión de
> negocio de abajo (2026-09-13) fue tomada por el developer (Luder Armas);
> el corte gerencial exigía, además, el countersign formal de un rol de
> arquitectura/Gerencia General para dar por cerrado el gate R3 con esta
> desviación documentada. El Arquitecto TI del proyecto confirma por
> escrito, en estos términos:
>
> 1. **El tiempo de proceso obtenido (ADR-184, ~24-27s en el peor caso
>    medido) no puede mejorarse hasta llegar al objetivo original de 5s**
>    sin una inversión de arquitectura no justificada hoy (ver
>    "Alternativas descartadas" abajo, sin cambios) — no es una limitación
>    de esfuerzo, es un costo fijo real de la virtualización de páginas que
>    protege al sistema de exports de miles de páginas (ADR-170).
> 2. **Refuerzo del razonamiento de negocio de ADR-185**: además de ser un
>    proceso asíncrono que no bloquea al usuario, la exportación **no es de
>    uso operativo frecuente** — el informe técnico está pensado para
>    **vivir dentro de la propia plataforma minera** (ReportStudio, consulta
>    en línea), no para exportarse a PDF/Word de forma rutinaria. La
>    exportación es una capacidad puntual (compartir con un tercero, un
>    registro fuera de línea), no el modo de consumo principal del informe.
>
> Con este countersign, **R3 queda cerrado al 100%** (antes 97.1%, 68/70,
> con este único punto pendiente de acta) y el criterio O3 de SPEC-007 T15
> queda cerrado sin condiciones adicionales. El texto original de este ADR,
> abajo, no se edita.

**Status**: accepted (decisión de negocio, 2026-09-13); countersign formal del Arquitecto TI 2026-09-14 — R3 cerrado al 100%

**Fecha**: 2026-09-13

**Autores**: Luder Armas (decisión explícita: "el tiempo no es tan crítico en
este proceso... el usuario puede esperar un poco más de tiempo para
completar la tarea"), con Claude Code

**Ámbito**: reports

**Relación**: cierra el ciclo abierto por ADR-183 (benchmark real, criterio
NO cumplido) y ADR-184 (2 fixes reales, mejora medida sin cerrar el
criterio). Este ADR no agrega código ni mediciones nuevas — es la decisión
de negocio que faltaba para cerrar formalmente SPEC-007 T15 y, con ella,
R3.

## Contexto

El SOW original de SPEC-007 (`specs/007-editor-informes-reportstudio/spec.md`,
CA-2/O3) fija: **exportación de un informe a PDF/Word en menos de 5
segundos**. ADR-183 midió el criterio real contra informes reales del
tenant Alpayana y encontró que NO se cumple: 29,4s/56 páginas, 28,9s/63
páginas (~5,9× el umbral), por un costo fijo real de arquitectura
(virtualización de páginas para proteger documentos muy grandes, ver
ADR-170: 2104 páginas/6300 diagramas). ADR-184 investigó a fondo si había
una ineficiencia corregible, encontró y corrigió 2 bugs reales (fuentes de
Google sin caché por worker; una espera de red redundante en
`page.goto()`), y midió una mejora real de 6-28% según tamaño — pero el
criterio de <5s sigue sin cumplirse: 26,8s/56 páginas, 27,2s/63 páginas,
extrapola a **~24s para 50 páginas** con gráficos de sensor reales
(documentos livianos, mayormente texto, sí llegan cerca: 4,6s/11 páginas).

Ambos ADR dejaron la brecha restante (~24s → <5s, ~5×) explícitamente como
una decisión de Gerencia/arquitectura, no como trabajo de desarrollo o
medición pendiente. Este ADR resuelve esa decisión.

## Decisión

Se acepta el tiempo de export medido y optimizado (ADR-184) como resultado
final de O3 para efectos de cierre de SPEC-007 T15, revisando el criterio
de aceptación operativo bajo el siguiente razonamiento: **la exportación
es un proceso asíncrono en segundo plano** (job + polling vía
`usePdfExport.ts`, con indicador de progreso propio), no una operación que
bloquee al usuario ni la interfaz — el usuario dispara el export y puede
seguir trabajando en la plataforma mientras se genera. Un tiempo de espera
de fondo de hasta ~25-30s para el caso más pesado (informe de 50+ páginas
con múltiples gráficos de sensor en vivo) se considera **operacionalmente
aceptable**, y no justifica, en este momento del proyecto, una inversión
adicional de arquitectura para perseguir el valor literal de <5s.

Esto se documenta explícitamente como una **desviación reconocida y
aceptada** del target original de la SOW (`spec.md` CA-2/O3: "<5s"), no
como un cumplimiento del criterio original tal como fue redactado.
`spec.md` no se edita — queda como constancia histórica del target
contractual pactado (misma convención que rige los ADR: el texto original
no se toca, la decisión que lo revisa se documenta aparte).

## Justificación (por qué el tiempo no es crítico para este proceso)

- **No bloquea al usuario**: a diferencia de O2 (autosave, <0,5s — ahí sí
  hay UX en vivo dependiente del tiempo de respuesta), el export corre en
  segundo plano con job asíncrono + polling; el usuario no queda detenido
  esperando frente a la pantalla.
- **El peor caso medido y optimizado es un tiempo de espera razonable en
  términos absolutos**: ~24-27s para un informe de 50-63 páginas con
  decenas de gráficos de sensor en vivo, comparable o mejor al tiempo que
  tomaría producir un documento similar por medios manuales.
- **Los documentos livianos ya cumplen el espíritu del criterio original**:
  4,6s para 11 páginas de texto — el caso que realmente domina el costo
  (gráficos de sensor con datos en vivo, `data-export-ready`) es también
  el caso donde el valor entregado (visualización real de telemetría, no
  una tabla estática) justifica el costo adicional de renderizado.
- **No hay evidencia de queja operativa real** sobre el tiempo de export
  actual registrada en este proyecto — la brecha fue encontrada por
  medición proactiva (ADR-183), no reportada como incidente por un
  usuario.
- **El costo de cerrar la brecha restante es real y no trivial** (ver
  "Alternativas descartadas" abajo) frente a un beneficio no cuantificado
  en este momento — no hay caso de negocio que lo justifique hoy.

## Alternativas descartadas

- **Subir `EXPORT_VIRTUALIZATION_PAGE_THRESHOLD` (25 páginas) para que
  informes de 50 páginas no entren en el modo virtualizado**: descartado
  por el riesgo real de reproducir el incidente que motivó ese umbral en
  primer lugar (exports de miles de páginas, ADR-170) — subir el umbral
  sin un rediseño del camino no-virtualizado arriesga justamente el
  escenario que el R3 actual ya protege.
- **Subir `PDF_CAPTURE_PARALLELISM` (4 workers dedicados) para paralelizar
  más páginas a la vez**: descartado por ahora — no existe medición de la
  capacidad real del host de `pdf-export-service` bajo carga concurrente
  de exports simultáneos de distintos usuarios/tenants; cada worker
  adicional es un proceso Chromium completo, con su propio costo de
  CPU/RAM. Requeriría su propio benchmark de capacidad antes de decidirse,
  fuera del alcance de esta decisión de negocio.
- **Rediseñar el camino virtualizado** (p.ej. capturar páginas en lotes en
  vez de una por una, o pre-renderizar gráficos de sensor fuera del hilo
  de captura): descartado por ahora por el costo de ingeniería que
  implica frente a un beneficio no cuantificado — queda como opción
  disponible si en el futuro cambia el caso de negocio (ver
  "Consecuencias").

## Cierre formal

- **SPEC-007 T15** se cierra (☑): la tarea de medir Y optimizar el
  criterio O3 está cumplida con evidencia real (ADR-183/184); el
  resultado medido se acepta como final por esta decisión de negocio.
- El DoD de O3 en `specs/007-editor-informes-reportstudio/tasks.md` se
  marca cumplido bajo el **criterio revisado** (tiempo de espera
  asíncrono aceptable), explícitamente NO bajo el literal "<5s" de la SOW
  original — la distinción queda documentada aquí para cualquier
  auditoría o revisión futura del SOW con el cliente.
- **R3** queda formalmente cerrado respecto a este punto: no quedan
  tareas de desarrollo, medición ni decisión pendientes bajo SPEC-007 T15.

## Consecuencias

### Positivas
- Cierra el único punto que mantenía a R3 por debajo de 100%, con una
  decisión documentada y trazable en vez de dejarlo indefinidamente
  abierto.
- El tiempo real de export ya es mejor que cuando se detectó el problema
  (ADR-184: -6% a -28% según tamaño, sin regresión en documentos grandes)
  — la decisión de negocio se toma sobre el mejor resultado alcanzado, no
  sobre el peor caso original.
- Dado que esta ADR no oculta la desviación sino que la documenta con
  evidencia medida, queda disponible para una eventual renegociación
  formal del SOW con el cliente si se requiere en el futuro.

### Negativas / Trade-offs
- Es una desviación reconocida del target contractual original de O3
  (<5s) — el criterio de la SOW, tal como está redactado literalmente en
  `spec.md`, sigue sin cumplirse (~24s en el peor caso medido, ~5× el
  valor pactado). Si en el futuro el cliente exige formalmente el valor
  literal, esta ADR deja documentada la brecha real y las alternativas ya
  evaluadas (y por qué se descartaron en este momento).
- No cubre el escenario de múltiples exports concurrentes de distintos
  usuarios/tenants a la vez (solo se midió carga de un export a la vez) —
  si el volumen de uso simultáneo crece, debería revisarse el impacto real
  en el host de `pdf-export-service` antes de asumir que el tiempo por
  export se mantiene igual bajo esa carga.
- Reabre la puerta, explícitamente, a retomar cualquiera de las
  alternativas descartadas (umbral de virtualización, paralelismo,
  rediseño) si en el futuro aparece un caso de negocio real (queja de
  usuario, requisito contractual nuevo, o crecimiento de uso concurrente).

## Referencias
- [[183]] (benchmark real de O3, criterio no cumplido)
- [[184]] (2 fixes reales, mejora medida, criterio sigue sin cumplirse)
- [[170]] (arquitectura de virtualización — motivo real del costo fijo que
  esta decisión acepta en vez de rediseñar)
- `specs/007-editor-informes-reportstudio/spec.md` (CA-2/O3, target
  original de la SOW, sin editar — se conserva como constancia histórica)
- `specs/007-editor-informes-reportstudio/tasks.md` (T15, DoD, Métricas)
