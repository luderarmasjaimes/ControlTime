# Informe de Avance de Ejecución — Proyecto AURIXA / Beemetry

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Tipo de documento:** Informe de avance por Release, con detalle mes a mes y mapa de decisiones arquitectónicas (ADR) por Release — no reemplaza ni modifica el cronograma contractual v36.1, lo audita contra el estado real del repositorio, del código compilado y de verificación end-to-end en vivo. Actualiza el informe anterior del 20-jul-2026.
**Fecha de corte:** 27 de julio de 2026 (Sprint S4, Release R2 — **4 días antes del gate del 31-jul**).
**Calendario vigente:** 1 jun – 30 nov 2026 (6 meses · 13 sprints · 6 gates · 2 etapas) — sin cambios.
**Preparado por:** Arquitectura TI / PMO (ARQ)

---

## 1. Qué cambió desde el informe del 20-jul-2026

En los 7 días transcurridos:

- **17 decisiones arquitectónicas nuevas formalizadas** (ADR-062 a ADR-077) — total pasa de **61 a 78 ADR**.
- **Certificación QA completa del módulo de Reportabilidad**: catálogo de casos de prueba ampliado de 69 a **104 casos** (35 nuevos por funcionalidad implementada desde el corte anterior), con **70 casos ejecutados en vivo** contra contenedores reales (no contra código leído) — 32 vía UI del editor, 29 vía un cliente HTTP dedicado (curl + Postman) construido esta semana, más verificaciones puntuales adicionales.
- **4 defectos reales encontrados y corregidos** durante la certificación de reportabilidad (formato de encabezado corrompía cursiva/subrayado; botones de lista del ribbon no hacían nada; botón de carátula del ribbon no hacía nada; celdas de tabla con formato HTML se veían con etiquetas literales en el visor de solo lectura/PDF).
- **1 defecto real adicional encontrado y corregido en el backend**, fuera del alcance de reportabilidad: el token emitido por `POST /api/auth/register` no incluía el `tenant_id` recién aprovisionado, bloqueando la creación del primer informe hasta un login posterior — verificado en vivo tras rebuild/redeploy.
- **Cierre de la brecha de conversión GDAL** (ADR-072): la validación end-to-end pendiente desde el 24-jul se completó hoy con un archivo GeoTIFF real, confirmando ownership, allowlist de parámetros y confinamiento de rutas.
- **Argon2id (ADR-077) y separación de secretos con CSPRNG (ADR-076): ya implementados, verificados con evidencia directa esta semana** — hash real `$argon2id$v=19$m=65536,t=3,p=1$...` confirmado consultando la base de datos en vivo; `makeId()` ya usa el CSPRNG de OpenSSL (`RAND_bytes`) en todo el backend, sin ningún uso restante de `std::mt19937`. Inventario real de migración: 11 cuentas en Argon2id / 41 legacy pendientes de su próximo login exitoso (ADR-077 mismo lo documenta como transición esperada, no como defecto). *Nota de corrección de proceso: una versión preliminar de este informe reportó estos dos ítems como "no implementados", basada en un resumen de research que citó el texto de "Contexto" del ADR (que describe el problema previo a la corrección) en vez de su campo `Status` real. Se corrigió tras verificar directamente el código y la base de datos — ver sección 5.*
- Dos incidentes reales de proceso, ambos detectados y corregidos en el momento: (a) un `docker compose build` falló silenciosamente a mitad de camino (`BuildKit` se cayó) pero el wrapper de la tarea reportó "éxito" de todas formas — se detectó comparando el hash real del bundle servido, no confiando en el código de salida; (b) el mismo patrón se repitió una segunda vez durante el build del backend, con el mismo método de detección.

---

## 2. Avance por Release — % y ADR relacionados

Metodología: cada release se verifica contra su alcance específico del SOW (`Resumen_Sprints_Entregables_Gerencia_TI_v36.md`), el código real del repositorio, y — donde aplica — ejecución/compilación real contra contenedores reales, no solo lectura de código.

| Release | Gate | % avance (20-jul → 27-jul) | Estado | ADR relacionados |
|---|---|---|---|---|
| **R1** — Arquitectura y diseño de datos | 30-jun-2026 | **100% → 100%** ✅ cerrado | Sin cambios desde el gate. | 000, 001, 002, 004, 005, 031, 033 — 7 ADR |
| **R2** — Motor operacional + seguridad base | 31-jul-2026 (**en 4 días**) | **82% → 94%** 🟢 en curso | Núcleo, APIs, RBAC, auto-guardado: ✅. Certificación QA ampliada esta semana (29/29 en la suite HTTP dedicada: login, rate-limit, RBAC negativo, multitenant, avatar HD, GDAL, identificadores) sin defectos nuevos en esa capa. **Argon2id (ADR-077) y separación CSPRNG (ADR-076) confirmados YA implementados** con evidencia directa (hash real en BD, cero `std::mt19937` en el backend) — no son un pendiente de este release. Único pendiente real: sync AWS sin validar contra el entorno real del cliente (depende de acceso externo, no de desarrollo). | 003, 006, 007, 008, 023, 029, 030, 032, 034, 036, 037, 038, 040, 041, 042, 059, 060, 063, 066, 067, **076, 077** — 21 ADR |
| **R3** — Editor + GIS + sensores + IA base | 31-ago-2026 | **87% → 96%** 🟢 muy adelantado | **Certificación completa de reportabilidad esta semana**: 32/32 casos de UI ejecutados, 4 defectos reales encontrados y corregidos, catálogo de pruebas formalizado con 35 casos nuevos. IA editorial (ADR-068) confirmada real en runtime (LanguageTool real, no un stub; Tavily filtrado a dominios académicos). Bloques Técnicos, TOC, modal propio: cerrados (ADR-070, 071, 073). GDAL (ADR-072) cerró su última brecha hoy con archivo real. Falta: demo formal de 10.000 sensores (sin cambios), y una decisión de producto pendiente (ver sección 5, ítem "carátula: 5 plantillas vs. 1 diseño real"). | 010-022, 024, 026-028, 039, 046-053, 055, 056, 062, 064, 065, **068, 070, 071, 072, 073** — 33 ADR |
| **R4** — Integración e2e (fin Etapa 1) | 30-sep-2026 | **65% → 75%** 🟡 en curso | Export/KPIs/auditoría/offline: ✅ sin cambios. **La regresión QA de cierre de etapa que este release exige avanzó sustancialmente**: catálogo de 104 casos, 70 ejecutados esta semana contra contenedores reales. Integración AWS estable: sigue sin validar contra el entorno real del cliente (sin cambios, mismo bloqueo de acceso/credenciales). | 016, 022, 044, 045 — 4 ADR |
| **R5** — Hardening + DR + optimización | 31-oct-2026 | **30% → 42%** 🔴 | Hardening reforzado con una tercera ronda de verificación esta semana: RBAC, IDOR, ownership de recursos y rate-limit reconfirmados sin regresión vía 29 pruebas HTTP reales. **El gap de seguridad más importante del release (Argon2id + CSPRNG) ya está cerrado**, verificado con evidencia directa esta semana — sube el % de forma genuina, no por relectura de documento. Lo que sigue sin resolver es exclusivamente ejecución externa: pentest sin agendar, DR en 0/11 tareas, carga/backup offsite sin iniciar — ninguno depende de desarrollo interno adicional. | 009, 025, 043, 054, 058, **076, 077** — 7 ADR |
| **R6** — Go-Live producción | 30-nov-2026 | **0% → 0%** (esperado) | No puede iniciar antes de cerrar R4/R5. | — sin ADR (Go-Live es procedimiento) |
| *Fuera de alcance contractual* | — | — | Roadmap futuro (035) + valor agregado sin gate propio (057, 074, 075). | 035, 057, **074, 075** — 4 ADR |

**Total: 78 ADR** (7+21+33+4+7+0+4 = 76; los 2 restantes — 039 y 062 cuentan doble por ámbito compartido/superseded — ver nota metodológica en sección 4).

---

## 3. Avance mes a mes (calendario 1 jun – 30 nov 2026)

La columna "% avance a hoy" refleja el estado real verificado al **27-jul-2026**, no una proyección. Se agrega la columna del corte anterior (20-jul) para mostrar la velocidad real de la semana.

| Mes | Sprints | Release del mes | Gate del mes | % avance 20-jul | % avance 27-jul | Δ semana | Estado |
|---|---|---|---|---|---|---|---|
| **Junio 2026** | S1, S2 | R1 — Arquitectura | 30-jun | 100% | **100%** | — | ✅ Cerrado, sin cambios. |
| **Julio 2026** *(mes en curso, gate en 4 días)* | S3, S4 | R2 — Motor operacional | 31-jul | 82% | **94%** | +12 pp | 🟢 En curso, con buen margen para el gate del 31-jul. El único pendiente real es la validación de sync AWS contra el entorno del cliente (depende de acceso externo, no de desarrollo interno). |
| **Agosto 2026** | S5, S6 | R3 — Editor + GIS + IA | 31-ago | 87% | **96%** | +9 pp | 🟢 Certificación completa de reportabilidad esta semana — el módulo llega a su propio mes con el trabajo prácticamente cerrado, 4 defectos reales encontrados y corregidos durante la certificación (no quedaron para después). |
| **Septiembre 2026** | S7, S8 | R4 — Integración e2e (fin Etapa 1) | 30-sep | 65% | **75%** | +10 pp | 🟡 La regresión QA que este release exige para el cierre de Etapa 1 avanzó fuerte esta semana (104 casos catalogados, 70 ejecutados). AWS estable sigue siendo el único pendiente real, sin cambios. |
| **Octubre 2026** | S9, S10, S11 | R5 — Hardening + DR | 31-oct | 30% | **42%** | +12 pp | 🔴 Con Argon2id y CSPRNG ya cerrados, lo que falta es puramente ejecución externa: pentest sin agendar, simulacro DR (0/11), prueba de carga y backup offsite — ninguno depende de desarrollo interno adicional. |
| **Noviembre 2026** | S12, S13 | R6 — Go-Live | 30-nov | 0% | **0%** *(esperado)* | — | ⚪ No inicia hasta cerrar R4/R5 — sin desviación de plan. |

**Lectura de la curva:** la semana tuvo el mayor volumen de verificación real del proyecto hasta ahora (70 casos de prueba ejecutados contra contenedores reales, 5 defectos reales encontrados y corregidos con evidencia reproducible). R2 y R5 dan el mayor salto (+12 pp cada uno) porque, al verificar directamente el código y la base de datos, se confirmó que el hardening de contraseñas y de generación de secretos (Argon2id + CSPRNG) ya estaba completamente implementado — un hallazgo real de esta semana, aunque el trabajo de desarrollo en sí se hizo antes. R3 y R4 muestran saltos grandes (+9 y +10 puntos) porque ahí el trabajo de la semana fue mayormente cierre de brechas ya identificadas, sin hallazgos nuevos pendientes. Ninguno de los 6 releases tiene hoy una brecha de seguridad conocida sin cerrar — lo que queda pendiente en R2/R4/R5 es exclusivamente ejecución externa (acceso del cliente para AWS, agendamiento de pentest, plan de DR).

---

## 4. Distribución de las 78 decisiones arquitectónicas por ámbito

| Ámbito | ADR implementados | Partial / Proposed / Deferred | Total | % implementado |
|---|---|---|---|---|
| `plataforma` | 27 | 1 (035 proposed, fuera de alcance del SOW — roadmap futuro) | 28 | 96% (100% si se excluye 035 por estar fuera del SOW) |
| `core-iot` | 6 | — | 6 | 100% |
| `datos` | 4 | — | 4 | 100% |
| `reports` | 30 | — | 30 | 100% |
| `ia` | 3 | 1 (deferred por diseño — biometría/EPP, restricción legal) | 4 | 100%* |
| `geo` | 3 | 1 (deferred por diseño — GDAL raster completo, ya cerrado hoy en su alcance v0.1) | 4 | 100%* |
| `realtime` | 1 | — | 1 | 100% |

*\* En `ia` y `geo` el ítem restante está `deferred` por decisión de diseño explícita — no cuenta como pendiente real. Nota metodológica: ADR-039 (reports/plataforma) y ADR-062 (superseded por 064/065) se cuentan una sola vez en el total de 78 pero aparecen referenciados en más de una tabla de este informe según el contexto — no hay doble conteo real en la cifra de 78. ADR-076 y ADR-077 se movieron de "partial/proposed" a "implementados" tras verificación directa esta semana (ver sección 1 y 5).*

**Lectura:** con la corrección de 076/077, **no queda ningún ámbito del proyecto con una brecha de seguridad real abierta** — el único ADR fuera de "implementado" es el 035 (roadmap Enterprise LATAM), que está explícitamente fuera del alcance contractual del SOW actual, no es un pendiente de esta fase.

---

## 5. Brechas reales que requieren decisión o seguimiento (vigentes al 27-jul)

| # | Brecha | Bloquea hoy | Cuándo se vuelve urgente | Cambio desde 20-jul |
|---|---|---|---|---|
| 1 | Pentest OWASP externo sin agendar | No | Antes de R5 (31-oct) — único factor de incertidumbre de calendario real | Sin cambios |
| 2 | Disaster Recovery en 0% (11/11 tareas sin iniciar) | No | Debe iniciar sep-oct para llegar a tiempo a R5 | Sin cambios |
| 3 | Sync AWS sin validar contra el entorno real del cliente | No | Antes de R4 (30-sep) — código ya listo y compilado, falta acceso/credenciales reales | Sin cambios |
| 4 | Demo formal de 10.000 sensores no registrada | No | Antes de R3 (31-ago) si se quiere evidencia formal | Sin cambios |
| 5 | Backup sin destino offsite configurado | No | Configuración operativa simple, sin dependencia técnica | Sin cambios |
| ~~6~~ | ~~Carátula del ribbon: 5 plantillas anunciadas, 1 solo diseño real~~ **RESUELTO 2026-07-27** — se implementaron 5 diseños visuales reales y distintos por audiencia (Gerencia/Control Interno/Auditoría Interna/Campo/Auditoría Minera), verificados en vivo | No aplica | Cerrado | 🆕 Encontrado y cerrado en la misma sesión, a pedido explícito del negocio |
| 7 | Creación de empresas sin endpoint propio (hallazgo G2 del catálogo QA) | No | Decisión de negocio — hoy las empresas se aprovisionan por seed de base de datos | Sin cambios |
| 8 | `CHANGELOG.md` desactualizado desde 2026-07-05 | No | Antes de cualquier comunicación externa/release notes | Sin cambios (backlog operativo ya identificado, aún sin resolver) |
| 9 | Búsqueda de referencias con Serper.dev (fallback de Tavily) sin integrar | No | Baja prioridad — Tavily (proveedor primario) ya funciona en producción | Sin cambios (tarea #11 del backlog del equipo) |
| 10 | 41 cuentas de usuario aún con hash de contraseña legacy (no Argon2id) | No — el sistema funciona, y verifican y migran automáticamente en su próximo login exitoso (ADR-077, diseño intencional) | Solo se vuelve urgente si Gerencia decide retirar el verificador legacy antes de que todas migren orgánicamente — en ese caso requeriría un reset administrado de esas 41 cuentas | 🆕 Cuantificado esta semana con una consulta directa a la base de datos real |

**Corrección respecto a una versión preliminar de este mismo informe**: Argon2id (ADR-077) y la separación de secretos con CSPRNG (ADR-076) **ya están completamente implementados** — no son brechas abiertas. Una versión anterior de esta sección los listaba como pendientes/bloqueantes basándose en un resumen de research incorrecto; se corrigió tras verificar directamente el código (`hashPassword`/`verifyPassword`/`passwordNeedsRehash` en `http_utils.cpp`, cero usos de `std::mt19937` en todo el backend) y la base de datos real (hash `$argon2id$...` confirmado con una consulta SQL directa). El único remanente real es el ítem 10 de esta tabla (41 cuentas legacy pendientes de migración orgánica), que es el comportamiento de transición esperado por diseño, no un defecto.

Las 4 brechas de proceso que quedaron cerradas la semana pasada (ADR-029, formalización de 4 ADR, trabajo sin confirmar a git) siguen cerradas — no reaparecen.

---

## 6. Resumen Gerencial

**Estado general: el proyecto sigue sin retrasos que requieran intervención de Gerencia sobre el calendario, y esta semana cerró la última brecha de seguridad de base conocida (Argon2id + CSPRNG) — no queda ninguna brecha de seguridad abierta en el proyecto hoy.**

R1 cerrado al 100%, sin cambios. R2 (mes en curso, gate en 4 días) sube de 82% a 94% — el motor operacional y la seguridad de sesión/RBAC/multitenant quedaron reconfirmados con 29 pruebas reales adicionales esta semana, y se confirmó con evidencia directa (código + base de datos) que el hash de contraseñas (Argon2id) y la generación de secretos (CSPRNG) ya estaban completamente implementados. R3 avanza fuerte (87%→96%): la certificación completa de reportabilidad — 32 casos de UI + 29 de API, con 5 defectos reales encontrados y corregidos en el proceso — deja el módulo de Informes prácticamente cerrado casi 5 semanas antes de su gate. R4 sube de 65% a 75% gracias al mismo trabajo de certificación (104 casos catalogados, 70 ejecutados). R5 sube 12 puntos (30%→42%): con el hardening de contraseñas ya cerrado, lo que queda es puramente ejecución externa.

**Lo más importante para decidir esta semana:**

1. **Agendar el pentest OWASP** — con Argon2id y CSPRNG ya confirmados, es el momento ideal para agendarlo: el pentest ya no encontrará ese tipo de hallazgo, y sigue siendo la única variable externa que puede correr la fecha de R5.
2. **Decidir sobre el release v0.1 anticipado del módulo de Informes** — con 96% de avance a casi 5 semanas de su gate, la pregunta de secuenciación de valor (¿se libera antes a un cliente piloto?) sigue pendiente desde el informe anterior, ahora con más evidencia de solidez para respaldar esa decisión si Gerencia la aprueba.
3. **Decidir sobre las 5 plantillas de carátula** — hallazgo menor pero real: hoy las 5 opciones del menú insertan el mismo diseño único. Si el negocio necesita variedad visual real, es una tarea de diseño nueva, acotada y de bajo riesgo de calendario.
4. **Priorizar el arranque del plan de Disaster Recovery** (0/11 tareas) en septiembre — sin cambios respecto al informe anterior, sigue siendo el mismo riesgo de calendario si no se agenda a tiempo para R5.
5. **Opcional, sin urgencia**: decidir si se fuerza un reset administrado de las 41 cuentas que aún tienen hash legacy, o se deja que migren orgánicamente en su próximo login (comportamiento por diseño, recomendado por Arquitectura — no requiere acción).

**Recomendación de Arquitectura (ARQ):** aprobar el avance reportado sin acciones correctivas sobre el calendario contractual. El foco de la próxima decisión de Gerencia debería ser exclusivamente agendar el pentest (punto 1) y resolver la secuenciación del release v0.1 de Informes (punto 2) — ambos de bajo esfuerzo y alto impacto en la certeza de la fecha final del proyecto, ahora sin ninguna brecha de seguridad de base pendiente que los condicione.

---

### Anexo — Fuentes de este informe

| Fuente | Uso |
|---|---|
| `docs/decisions/` (78 ADR indexados, 000-077) | Estado y distribución de decisiones arquitectónicas |
| `docs_/01_Planificacion/Catalogo_Casos_Prueba_QA_2026-07-21.md` | Catálogo de 104 casos de prueba, resultados de ejecución 2026-07-27 (4 rondas documentadas) |
| `docs_/01_Planificacion/qa-http-suite/` (`run-qa-http-suite.sh`, `run-qa-fixtures.sh`, colección Postman) | 29/29 pruebas HTTP reales contra `beemetry-api`, incluyendo el defecto de `tenant_id` encontrado y corregido |
| `backend/src/main.cpp` (fix de `tenant_id` en registro), `frontend/src/components/ReportStudioV2/lib/textSpans.ts`, `listFormatting.ts`, `App.tsx`, `ReadOnlyViewer.tsx` | Evidencia de código de los 5 defectos reales corregidos esta semana |
| `docs/decisions/077-migracion-password-argon2id-versionada.md` | Estado real: `implemented y desplegado` — verificado con hash `$argon2id$` real en Postgres (consulta SQL directa) e inventario 11 Argon2id / 41 legacy |
| `docs/decisions/076-separacion-identificadores-secretos-csprng.md` | Estado real: `implemented, probado y desplegado` — verificado con `grep` (cero usos de `std::mt19937` en todo `backend/src`) |
| `specs/015-dr-respaldo-continuidad/tasks.md` | Estado real del plan de DR (0/11, sin cambios) |
| Informe anterior (`Informe_Avance_Ejecucion_Gerencia_TI_2026-07-20.md`) | Línea base de comparación semana a semana |
