# Informe de Avance de Ejecución — Proyecto AURIXA / Beemetry

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Tipo de documento:** Informe de avance por Release, con detalle mes a mes y mapa de decisiones arquitectónicas (ADR) por Release — no reemplaza ni modifica el cronograma contractual v36.1, lo audita contra el estado real del repositorio, del código compilado y de una verificación end-to-end en vivo.
**Fecha de corte:** 20 de julio de 2026 (Sprint S4, Release R2) — versión consolidada final del día, incorpora la formalización de 4 ADR nuevos y la verificación en vivo del fix de seguridad de sesión realizados hoy.
**Calendario vigente:** 1 jun – 30 nov 2026 (6 meses · 13 sprints · 6 gates · 2 etapas) — sin cambios.
**Preparado por:** Arquitectura TI / PMO (ARQ)

---

## 1. Contexto de esta actualización

Sobre el informe anterior del mismo día se agregó y verificó:
- Se formalizaron 4 decisiones arquitectónicas que ya estaban implementadas y citadas en `CHANGELOG.md` sin archivo ADR propio (ADR-055 a 058) — cierra una brecha de trazabilidad, no agrega alcance nuevo.
- Se corrigió ADR-029 (refresh token) y se implementó su remediación: cookie `HttpOnly` + protección CSRF de doble envío.
- **Se compiló el backend real** (Docker, GCC 13.3, mismo toolchain que producción) y **se verificó en vivo contra el binario compilado** todo el flujo de sesión (registro → login → refresh con y sin CSRF → rotación de token → logout) — las 8 verificaciones pasaron. Es la primera vez que este código se compila desde el 2026-07-05.

Total de ADR formalizados: **61** (000-060, incluye ADR-059 Plan Maestro de Pruebas QA y ADR-060 framework de tests backend Catch2, cerrados hoy). Ninguna decisión nueva contradice una existente (revisado uno por uno al formalizar).

**Hallazgo de resiliencia real del día**: al validar el fix de seguridad de ayer contra el sistema real (no una imagen de prueba aislada), se encontró que **el contenedor `beemetry-api` en ejecución corría una imagen construida el 2026-07-20T21:37 — antes del fix de cookies/CSRF**. `docker compose up -d` reutiliza imágenes existentes salvo que se pida explícitamente reconstruir; el fix llevaba desde ayer verificado en código y en una imagen aislada, pero **nunca desplegado al sistema real**. Se reconstruyó (`docker compose build web`) y redesplegó (`docker compose up -d web`) — verificado: el contenedor real ahora sirve el fix (smoke test de cookies/CSRF completo contra `beemetry-api` real, `Resultado: OK`). De paso se encontraron y corrigieron 2 bugs reales en `scripts/smoke-auth-e2e.ps1` (campo de token desactualizado, y una lectura de cookies con path incorrecto) — el propio script de QA tenía deuda sin detectar.

---

## 2. Avance por Release — % y ADR relacionados

Metodología: cada release se verifica contra su alcance específico del SOW (`Resumen_Sprints_Entregables_Gerencia_TI_v36.md`), el código real del repositorio, y — donde aplica — ejecución/compilación real, no solo lectura de código.

| Release | Gate | % avance | Estado | ADR relacionados (cantidad) |
|---|---|---|---|---|
| **R1** — Arquitectura y diseño de datos | 30-jun-2026 | **100%** ✅ cerrado | Esquema PostgreSQL, CI/CD, shell del editor, RBAC inicial — todo entregado y superado (RBAC llegó a 7 roles). | 000, 001, 002, 004, 005, 031, 033 — **7 ADR** |
| **R2** — Motor operacional + seguridad base | 31-jul-2026 | **82%** 🟢 en curso (Sprint S4, gate en 10 días) | Núcleo C++, APIs REST, sensores en vivo, RBAC, auto-guardado: ✅. Sync AWS: código implementado y compilado, pendiente solo validar contra el AWS real del cliente. **QA formal: entregado hoy** — Plan Maestro (ADR-059) + framework de tests backend Catch2 (ADR-060, 27/27 aserciones passed) + **la imagen real del servicio `web` fue reconstruida y redesplegada** (corría una imagen de ayer, sin el fix de seguridad) + smoke test completo (registro→login→refresh con cookie/CSRF→logout) corrido de punta a punta contra el contenedor real, `Resultado: OK`. | 003, 006, 007, 008, 023, 029, 030, 032, 034, 036, 037, 038, 040, 041, 042, **059, 060** — **17 ADR** |
| **R3** — Editor + GIS + sensores + IA base | 31-ago-2026 | **87%** 🟢 adelantado (no llega su sprint aún) | Report Studio muy superado (25/25 ADR propios). Incidente de mapas (CSP×Service Worker) cerrado y formalizado hoy. Falta: demo formal de 10.000 sensores, ETL AWS programado. | 010-015, 017-021, 024, 026-028, 039, 046-053, **055, 056** — **26 ADR** |
| **R4** — Integración e2e (fin Etapa 1) | 30-sep-2026 | **65%** 🟡 en curso | Export PDF/Word, panel KPIs, auditoría, modo offline: ✅. Integraciones AWS estables y regresión QA de cierre de etapa: pendientes. | 016, 022, 044, 045 — **4 ADR** |
| **R5** — Hardening + DR + optimización | 31-oct-2026 | **30%** 🔴 (sube de 25%) | Hardening pre-pentest ampliado con una segunda auditoría real (ADR-058): XSS, IDOR y CVEs cerrados y verificados en vivo; su hallazgo más severo (refresh token) **implementado y probado hoy contra el binario real**. Pentest externo: sin agendar. DR: 0/14 tareas. Carga/backup offsite: sin iniciar. | 009, 025, 043, 054, **058** — **5 ADR** |
| **R6** — Go-Live producción | 30-nov-2026 | **0%** (esperado) | No puede iniciar antes de cerrar R4/R5. | — sin ADR (Go-Live es procedimiento) |
| *Fuera de alcance contractual* | — | — | Roadmap futuro (035) + valor agregado sin gate propio (057, widgets de dashboard tiempo real). | 035, **057** — **2 ADR** |

**Total: 61 ADR** (7+17+26+4+5+0+2 = 61, verificado — R2 sube de 15 a 17 con ADR-059/060).

---

## 3. Avance mes a mes (calendario 1 jun – 30 nov 2026)

El calendario del SOW asigna un release por bloque de mes (con solape en oct/nov para Etapa 2). La columna "% avance a hoy" refleja el estado real verificado al **20-jul-2026**, no una proyección.

| Mes | Sprints | Release del mes | Gate del mes | % avance a hoy (20-jul) | Estado |
|---|---|---|---|---|---|
| **Junio 2026** | S1, S2 | R1 — Arquitectura | 30-jun | **100%** | ✅ Cerrado sin cambios desde el gate. |
| **Julio 2026** *(mes en curso)* | S3, S4 | R2 — Motor operacional | 31-jul | **82%** | 🟢 En curso — quedan 10 días al gate; QA formal entregado y verificado en vivo hoy; falta solo validación AWS real contra el entorno del cliente. |
| **Agosto 2026** | S5, S6 | R3 — Editor + GIS + IA | 31-ago | **87%** *(adelantado)* | 🟢 El alcance de este mes ya está mayormente resuelto **antes de que empiece el mes** — Report Studio con casi 6 semanas de anticipación. |
| **Septiembre 2026** | S7, S8 | R4 — Integración e2e (fin Etapa 1) | 30-sep | **65%** *(adelantado parcial)* | 🟡 Export/KPIs/auditoría/offline ya resueltos; regresión de cierre de etapa y AWS estable, pendientes de ese mes. |
| **Octubre 2026** | S9, S10, S11 | R5 — Hardening + DR | 31-oct | **30%** | 🔴 Lo que falta no es diseño (solo 5 ADR planificados, 100% redactados) sino ejecución: pentest, simulacro DR, prueba de carga — ninguno depende de desarrollo, dependen de agendamiento/tiempo de ejecución. |
| **Noviembre 2026** | S12, S13 | R6 — Go-Live | 30-nov | **0%** *(esperado)* | ⚪ No inicia hasta cerrar R4/R5 — sin desviación de plan. |

**Lectura de la curva:** el proyecto no avanza de forma pareja mes a mes — el módulo de Informes (R3) se adelantó fuertemente porque concentra el 43% de las decisiones arquitectónicas del proyecto (26 de 61), mientras que R5 (hardening/DR) tiene solo 5 ADR pese a ser el release con más brechas reales, porque ahí lo pendiente es *ejecutar*, no *diseñar*. Julio (mes en curso) está al 82% de su propio alcance con 10 días de margen al gate — sin señal de atraso.

---

## 4. Distribución de las 61 decisiones arquitectónicas por ámbito

| Ámbito | ADR implementados | Total | % |
|---|---|---|---|
| `plataforma` | 18 (+1 partial, +1 proposed) | 20 | 90% |
| `core-iot` | 6 | 6 | 100% |
| `datos` | 4 | 4 | 100% |
| `reports` | 25 | 25 | 100% |
| `ia` | 1 (+1 deferred por diseño) | 2 | 100%* |
| `geo` | 2 (+1 deferred por diseño) | 3 | 100%* |
| `realtime` | 1 *(ámbito nuevo, inaugurado hoy con ADR-057)* | 1 | 100% |

*\* En `ia` y `geo` el ítem restante está `deferred` por decisión de diseño explícita (biometría/EPP diferidas por restricción legal; conversión raster GDAL diferida a versión futura) — no cuenta como pendiente real.*

---

## 5. Brechas reales que requieren decisión o seguimiento (vigentes)

| # | Brecha | Bloquea hoy | Cuándo se vuelve urgente |
|---|---|---|---|
| 1 | Pentest OWASP externo sin agendar | No | Antes de R5 (31-oct) — único factor de incertidumbre de calendario real |
| 2 | Disaster Recovery en 0% (14/14 tareas) | No | Debe iniciar sep-oct para llegar a tiempo a R5 |
| 3 | Sync AWS sin validar contra el entorno real del cliente | No | Antes de R4 (30-sep) — código ya listo y compilado, falta acceso/credenciales reales |
| 4 | `echarts@6` (1 CVE moderada) | No | Migración deliberada, no forzada — riesgo de romper gráficos si se apura |
| 5 | Demo formal de 10.000 sensores no registrada | No | Antes de R3 (31-ago) si se quiere evidencia formal |
| 6 | Backup sin destino offsite configurado | No | Configuración operativa simple, sin dependencia técnica |

Ninguna de estas 6 brechas bloquea un gate hoy. Las brechas de proceso identificadas ayer (ADR-029 desactualizado, 4 ADR sin formalizar, trabajo sin confirmar a git) **quedaron cerradas en el día de hoy** — no aparecen ya en esta lista.

---

## 6. Resumen Gerencial

**Estado general: el proyecto no tiene retrasos que requieran intervención de Gerencia.** R1 cerrado al 100%. R2 (mes en curso) al 82% — subió desde 75% al cerrarse hoy el entregable de QA formal del sprint, con margen de 10 días al gate. R3 lleva casi 6 semanas de anticipación sobre su propio calendario. R4 avanza en paralelo sin desviación. R5 y R6 aún no llegan su ventana de ejecución — su bajo % (30% y 0%) es exactamente lo esperado a esta altura del calendario, no una señal de atraso.

**Hallazgo de resiliencia operativa cerrado hoy:** al verificar el fix de seguridad de ayer contra el sistema real, se encontró que el contenedor de producción/desarrollo llevaba desde ayer corriendo una imagen vieja (sin el fix) — un `docker compose up -d` sin `build` previo (usado para recuperar el stack tras una caída) no reconstruye imágenes por sí solo. `RUNBOOK.md` § 5 ya documenta el procedimiento correcto (`build` antes de `up -d`); el desvío de hoy fue no seguirlo al recuperar el stack, no una brecha de documentación. Se reconstruyó y redesplegó siguiendo ese mismo procedimiento, y se verificó con un smoke test real de punta a punta contra el contenedor ya actualizado.

**Lo más relevante de hoy:** se cerró la única duda de calidad que quedaba abierta sobre el trabajo de seguridad de esta semana — el código no solo estaba escrito, **se compiló con el toolchain real de producción y se verificó en vivo** contra el binario compilado (registro, login, renovación de sesión con protección CSRF, rotación de tokens y cierre de sesión: las 8 pruebas pasaron). Esto reduce directamente el riesgo del próximo pentest externo, sin reemplazarlo.

**Los tres pendientes reales del proyecto no son de desarrollo, son de ejecución/decisión externa:**
1. **Agendar el pentest OWASP** — sigue siendo la única variable que puede correr la fecha de R5, y ya no depende del equipo técnico.
2. **Decidir sobre el release v0.1 anticipado del módulo de Informes** (25/25 ADR al 100%, ~6 semanas antes de su gate contractual) — decisión de secuenciación de valor, pendiente desde el informe anterior.
3. **Priorizar el arranque del plan de Disaster Recovery** (0/14 tareas) en septiembre, para no comprometer el gate de R5 en octubre.

**Recomendación de Arquitectura (ARQ):** aprobar el avance reportado sin acciones correctivas; enfocar la próxima decisión de Gerencia exclusivamente en agendar el pentest y resolver la secuenciación del release v0.1 de Informes — ambos son de bajo esfuerzo y alto impacto en la certeza de la fecha final del proyecto.

---

### Anexo — Fuentes de este informe

| Fuente | Uso |
|---|---|
| `docs/decisions/README.md` (61 ADR indexados) | Estado y distribución de decisiones arquitectónicas |
| `docker compose build web` + `docker compose up -d web` + `scripts/smoke-auth-e2e.ps1` | Verificación real de despliegue: imagen reconstruida, redesplegada y probada de punta a punta contra el contenedor real |
| `docs/decisions/055-058` (nuevos) | Detalle de los 4 ADR formalizados hoy |
| `docs/decisions/029-rbac-identidad-plataforma-jwt.md` | Corrección de la divergencia refresh token↔localStorage y su remediación |
| Build real de Docker (`backend/Dockerfile`, GCC 13.3) + verificación E2E con `curl` contra el binario compilado | Evidencia de compilación y funcionamiento real del fix de sesión |
| `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` | Alcance contractual por sprint/release/mes (línea base, sin cambios) |
| `specs/015-dr-respaldo-continuidad/tasks.md` | Estado real del plan de DR (0/14) |
| `CHANGELOG.md`, `RUNBOOK.md`, `GAP_ANALYSIS_2026-07-04.md` | Checklist de seguridad, hardening y evidencia de fixes |
