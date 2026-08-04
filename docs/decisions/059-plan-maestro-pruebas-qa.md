# ADR-059 — Plan Maestro de Pruebas QA

**Status**: accepted, primera fase implementada y verificada en vivo (2026-07-21). Ver ADR-060 para el detalle de la Capa 2 (tests backend).
**Fecha**: 2026-07-20
**Autores**: EC
**Ámbito**: plataforma

**Actualización 2026-07-21 — verificación end-to-end real**: se reconstruyó la imagen real del servicio `web`
(`docker compose build web`, la misma que corre `beemetry-api` en el entorno del equipo — no una imagen de
prueba aislada) y se redesplegó (`docker compose up -d web`). Contra ese contenedor real ya con el fix de
ADR-029 vivo, se corrió `scripts/smoke-auth-e2e.ps1` completo de punta a punta: registro → login por
contraseña → login facial → filtro de auditoría → export CSV → **refresh vía cookie `HttpOnly` sin CSRF
(403 correcto) → refresh con CSRF correcto (nuevo `access_token`) → logout con CSRF correcto** — los 6 pasos
terminaron en `Resultado: OK`. De paso se encontraron y corrigieron dos bugs reales y preexistentes en el
propio script (no del backend): (1) leía `$loginPassword.user.token`, campo que ya no existe desde que la
respuesta usa `access_token`; (2) `$session.Cookies.GetCookies($BackendUrl)` nunca iba a devolver las cookies
de sesión porque `CookieContainer.GetCookies()` solo devuelve cookies cuyo `Path` es prefijo del path de la
URI consultada, y las cookies de este ADR usan `Path=/api/auth` — se corrigió a
`GetCookies("$BackendUrl/api/auth/")`. Ambos bugs eran de la Capa 4 (smoke script), no del backend.

## Contexto

El SOW fija el "plan maestro de pruebas QA" como entregable del Sprint S4 (Release R2, gate 31-jul-2026 — **el sprint actual**), y "regresión completa Etapa 1 + acta de cierre funcional (QA)" como entregable del Sprint S8 (Release R4, gate 30-sep-2026). Ninguno de los dos tenía hasta hoy un plan formal — el informe de avance del 20-jul lo listaba explícitamente como "QA formal: sin iniciar".

Un relevamiento exhaustivo del repositorio (no una suposición) encontró que **sí existe tooling de pruebas real**, solo que disperso y sin un plan que lo amarre a los gates del proyecto:
- **Frontend unit**: Vitest, 5 suites (`authApi.test.js`, `MiningDashboard.test.jsx`, `RichTextEditor.test.jsx`, `RichTextEditor.menu.test.jsx`, `MapViewer.test.jsx`).
- **Frontend e2e**: Playwright configurado (`frontend/playwright.config.ts`, 5 specs en `frontend/e2e/`: `dashboard`, `editor-save`, `editor`, `report-v2-admin`, `user-maintenance`), con scripts `test:e2e` y `test:all` en `package.json`.
- **Smoke/integración**: `scripts/ci/smoke_test.sh` (health checks de 3 servicios), `scripts/smoke-auth-e2e.ps1` (flujo de auth: registro → login password → login facial → auditoría → export CSV), `scripts/smoke-test.ps1` (ciclo de vida completo de `docker-compose` + conversión GDAL real), y `docker-compose.e2e-verify.yml` (stack mínimo BD+backend para probar el backend aislado).
- **Backend unit**: **cero** — ni un archivo de test, ni GoogleTest/Catch2/doctest, ni target en `CMakeLists.txt`. Cerrado hoy mismo, ver ADR-060.
- Los `artifacts/run_*` con resultados históricos (`smoke_results.json`, `playwright_run.log`) existieron pero fueron borrados del árbol de trabajo (confirmado por `git status`) — no hay línea base histórica de resultados para comparar.

`RUNBOOK.md` y `GAP_ANALYSIS_2026-07-04.md` ya marcaban "QA manual de flujos de usuario final" como pendiente explícito y no automatizable de un día para otro — este plan no pretende eliminar esa necesidad, sino ubicarla como la última capa de un proceso con capas automatizadas por debajo.

## Decisión

Formalizar **5 capas de prueba**, cada una con responsable, alcance y criterio de salida (*exit criteria*) atado a un gate de release. Las capas 1, 3 y 4 ya existían como tooling suelto — este ADR las convierte en proceso con calendario; la capa 2 es nueva (ADR-060).

| Capa | Qué prueba | Estado a hoy | Exit criteria |
|---|---|---|---|
| **1 — Unit frontend** (Vitest) | Lógica de componentes críticos (auth, editor, mapas) | ✅ 5 suites, 18/18 tests verdes | Mantener verde en cada build; expandir cobertura sin bloquear sprints por un número arbitrario |
| **2 — Unit backend** (Catch2, ADR-060) | Lógica pura del servidor (parseo, hashing) | 🟢 **nuevo hoy** — `http_utils.cpp` cubierto (incluye `extractCookie`, el módulo del fix de seguridad de esta semana) | Gate R2: auth cubierto. Gate R3: extender a `jwt.cpp` (firma/verificación) y `auth_session.cpp` |
| **3 — E2E frontend** (Playwright) | Flujos completos de usuario en navegador real | ✅ 5 specs configurados | Correr contra el build de cada release antes de su gate (mínimo R3, R4) |
| **4 — Smoke/integración backend** (scripts + `docker-compose.e2e-verify.yml`) | Backend real levantado, sin mocks | ✅ existente; **extendido hoy** (`smoke-auth-e2e.ps1` ahora cubre refresh/logout con cookies + CSRF, ver ADR-029) | Correr contra cualquier PR que toque auth/sesión |
| **5 — Regresión de cierre de etapa** (todas las capas + checklist manual) | Cierre funcional formal de Etapa 1 | ⚪ Sprint S8, no iniciada | Gate R4 (30-sep): todas las capas verdes + checklist manual de UX + acta de cierre funcional firmada |

### Cronograma de actividades (sprints)

- **S4 (actual, gate 31-jul)**: este ADR + ADR-060 redactados y con evidencia real; target `beemetry_backend_tests` compilando y linkeando (Catch2); `smoke-auth-e2e.ps1` extendido con el flujo de cookies/CSRF. → **Entregable "Plan maestro de pruebas QA" cumplido.**
- **S5-S6 (ago, R3)**: extender Capa 2 a `jwt.cpp` (roundtrip firma/verificación) y `auth_session.cpp` (con el modo File in-memory, sin necesitar Postgres real); correr Playwright contra el alcance de Informes/GIS antes del gate R3.
- **S7 (sep, previo a R4)**: documentar el checklist manual de la Capa 5 (qué se revisa a mano, quién firma, con qué criterio de aceptación).
- **S8 (sep, gate R4 / fin Etapa 1)**: ejecutar la Capa 5 completa (las 4 capas automatizadas + checklist manual) y firmar el acta de cierre funcional — entregable contractual de este sprint.
- **S9-S11 (oct, R5)**: la Capa 4 ampliada sirve de apoyo/evidencia previa al pentest externo — **no lo reemplaza** (brecha ya conocida, sigue sin agendar).

## Consecuencias

### Positivas
- Cierra el entregable contractual del sprint actual con evidencia real y verificable (compilación real, no solo un documento de intenciones).
- Da un cronograma concreto atado a sprints/gates existentes, no una promesa sin fecha.
- Identifica el hueco real más importante (backend con cero tests) y lo empieza a cerrar el mismo día, con el módulo de mayor riesgo actual (auth/cookies) primero.

### Negativas / Trade-offs
- La Capa 5 (regresión completa + acta) sigue siendo trabajo mayormente futuro (sep) — este ADR la planifica, no la ejecuta.
- La Capa 2 (backend) arranca deliberadamente acotada a un módulo (ver ADR-060) — el grueso de la lógica de negocio del backend sigue sin test automatizado hasta S5-S6.
- Nada de este plan reemplaza el pentest externo de R5 — es una brecha de agendamiento externo, no de QA interno.

### Neutras
- La ausencia de resultados históricos (`artifacts/run_*` borrados) no se puede recuperar — este plan empieza a generar línea base hacia adelante, no hacia atrás.

## Alternativas descartadas

### Contratar QA externo dedicado antes de tener un plan interno
Se descarta priorizarlo en este momento: sin un plan que diga qué correr, cuándo y con qué criterio de salida, sumar personas externas dispersaría el esfuerzo sin objetivo claro. Un plan interno primero, refuerzo externo después si hace falta.

### Exigir una meta de cobertura numérica (p. ej. 80%) desde ya
Se descarta: con el backend en 0% de cobertura hoy, una meta rígida sin acompañamiento generaría tests de relleno sin valor real solo para "subir el número". Se prioriza cubrir la lógica de mayor riesgo real (auth) antes que un porcentaje.

## Referencias
- ADR-060 (framework de pruebas del backend — Catch2)
- ADR-023 (presupuestos de rendimiento y SLA — O1-O7, lo que la Capa 5 debe terminar de validar)
- ADR-029 ("Actualización 2026-07-19" — módulo de auth que motivó el arranque de la Capa 2)
- `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` (S4: "plan maestro de pruebas QA"; S8: "regresión completa Etapa 1 + acta de cierre funcional")
- `frontend/playwright.config.ts`, `frontend/package.json` (`test:e2e`, `test:all`)
- `scripts/smoke-auth-e2e.ps1` (extendido hoy), `scripts/smoke-test.ps1`, `scripts/ci/smoke_test.sh`
- `docker-compose.e2e-verify.yml`
- `RUNBOOK.md`, `GAP_ANALYSIS_2026-07-04.md` (QA manual ya marcado como pendiente explícito)
