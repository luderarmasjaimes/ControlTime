# Informe de Avance de Ejecución — Proyecto AURIXA / Beemetry

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Tipo de documento:** Informe de avance de ejecución (no reemplaza ni modifica el cronograma contractual v36.1 — lo audita contra el estado real del repositorio y del código)
**Fecha de corte:** 20 de julio de 2026 (dentro de Sprint S4, Release R2)
**Calendario vigente:** 1 jun – 30 nov 2026 (6 meses · 13 sprints · 6 gates · 2 etapas) — sin cambios
**Preparado por:** Arquitectura TI / PMO (ARQ)
**Referencia:** actualiza `Informe_Avance_Ejecucion_Gerencia_TI_2026-07-17.md` (corte 17-jul, Sprint S4) con el estado real verificado hoy — 3 días de calendario después

---

## 1. Lectura ejecutiva en una página

| Dimensión | Estado al 17-jul (informe anterior) | Estado al 20-jul (este informe) |
|---|---|---|
| Decisiones arquitectónicas (ADR) formalizadas | 54 registradas | **55 registradas** (ADR-054, sync ThingsBoard/AWS, ya incluido) |
| Trabajo real sin ADR formal | — | **4 hallazgos**: hay commits/cambios fechados 18 y 19 de julio que el propio `CHANGELOG.md` referencia como "ADR-055" a "ADR-058", pero **ningún archivo existe** en `docs/decisions/` con esos números — brecha de documentación, no de código (ver §4) |
| Actividad de commits (git) | último commit 17-jul 13:15 | **sin cambios** — sigue siendo el último commit registrado; todo lo nuevo de esta semana está solo en el árbol de trabajo, sin confirmar (ver §5) |
| Gate más reciente cerrado | R1 (30-jun, aprobado) | **R1 sigue cerrado** — sin cambios |
| Gate en curso | R2 (31-jul) — ~70% | **R2 (31-jul) — ~75%** (sync AWS pasó de "sin código" a "código implementado, pendiente validar contra el AWS real del cliente") |
| Brecha nueva confirmada | AWS sin código; DR en 0% | **AWS: código listo, no validado en producción del cliente. DR: sigue en 0% (14/14 tareas), sin cambios desde jun-24** |
| Hallazgo de seguridad nuevo | — | **Divergencia real no corregida**: ADR-029 describe el refresh token como "server-side", pero la auditoría de seguridad (trabajo sin ADR formal, §4) confirma que sigue viviendo en `localStorage` en el cliente — mismo patrón de divergencia que ya se corrigió en ADR-010/013, pero **este todavía no tiene el bloque de corrección** (ver §6) |

**Mensaje central de este informe:** no hay retroceso ni bloqueo — al contrario, esta semana se cerró una auditoría de seguridad real (XSS, IDOR, CVEs) y se resolvió el primer ítem de integración AWS que llevaba semanas en gap. Pero aparecen **dos brechas de proceso, no de producto**, que conviene cerrar antes de que se acumulen: (a) trabajo ya verificado en vivo que no se formalizó como ADR ni se confirmó a `git`, y (b) una decisión documentada (ADR-029) que el propio equipo ya identificó como desactualizada frente al código real, sin haber aplicado todavía la corrección que la convención del repositorio exige.

---

## 2. Estado real por release — verificado contra código, no por percepción

Metodología: para cada release se listó el alcance específico según `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` (secciones 5-7) y se verificó cada ítem contra el repositorio real (código, specs, scripts, configuración de despliegue, `CHANGELOG.md`) — no contra el juicio del equipo. Sin cambios respecto al 17-jul salvo donde se indica explícitamente.

### R1 — Arquitectura y diseño de datos · Gate 30-jun-2026 · **100%** ✅ (cerrado, sin cambios)
Esquema PostgreSQL, pipeline CI/CD, shell del editor, matriz RBAC inicial: todos entregados. RBAC llegó a 7 roles unificados en una sola fuente de verdad.

### R2 — Motor operacional + seguridad base · Gate 31-jul-2026 · **~75%** (en curso, Sprint S4 — sube desde ~70%)
| Ítem de alcance | Estado al 17-jul | Estado al 20-jul |
|---|---|---|
| Núcleo C++ operativo | ✅ | ✅ sin cambios |
| APIs REST + canal en vivo de sensores | ✅ | ✅ sin cambios |
| Login con usuarios y perfiles (RBAC) | ✅ superado (7 roles) | ✅ sin cambios |
| Auto-guardado del editor en servidor | ✅ | ✅ sin cambios |
| Telemetría base validada con métricas `/api/metrics` | ✅ | ✅ sin cambios |
| Sincronización inicial con AWS | ⚠️ sin código | 🟡 **código implementado y probado** (ADR-054, `thingsboard_sync.{hpp,cpp}`) — backfill REST + WS tiempo real, probado con 6M puntos/10min a 10k/seg contra un ThingsBoard **local aislado**. Falta: validar contra la instancia real del cliente en AWS (sin acceso en ninguna sesión hasta hoy) y activar `BEEMETRY_THINGSBOARD_SYNC_ENABLED` (hoy `false` por diseño) |
| Plan maestro de pruebas QA | ⚠️ no iniciado formalmente | ⚠️ sin cambios |
| Seguridad aplicativa (XSS/IDOR/CVEs) | *(no era ítem explícito de R2)* | ✅ **hallazgo nuevo de esta semana**: auditoría interna cerró XSS almacenado en tablas del editor, IDOR horizontal en `/api/sensors/data`, 3 CVEs altas de dependencias — trabajo de valor para R2/R5 aunque sin ADR formal todavía (ver §4) |

### R3 — Editor + GIS + sensores + IA base · Gate 31-ago-2026 · **~87%** (aún no llega su sprint; sube ~2pp por trabajo adicional verificado)
| Ítem de alcance | Estado |
|---|---|
| Editor ReportStudio (texto, tablas, imágenes) | ✅ muy superado — 24/24 ADR del módulo formalizados, más un bug real de selección de texto corregido esta semana (sin ADR formal, ver §4) |
| Mapa interactivo con puntos y zonas | ✅ — **incidente real cerrado esta semana**: el 100% de los tiles externos (satelital + los 8 WMS gubernamentales del catálogo) estaban rotos por un choque entre la CSP y el Service Worker de caché de tiles; verificado E2E 18/18 tiles OK en cada fuente tras el fix (sin ADR formal, ver §4) |
| Dictado por voz minero | ✅ | 
| Modelos de IA local (Ollama + LanguageTool) | ✅ |
| 10.000 sensores simulados — demo formal | ⚠️ sin cambios — pipeline construido, sin evidencia de demo formal registrada |
| ETL programado desde AWS | 🟡 mismo avance que el ítem de R2 (código listo, no validado contra AWS real) |
| Widgets de dashboard estilo ThingsBoard (Monitoreo→Sensores) | *(no era ítem explícito del SOW)* | ✅ trabajo adicional de esta semana — gauge radial, tarjetas de agregación, doughnut de estado, con datos reales verificados E2E (sin ADR formal, ver §4) |

### R4 — Integración e2e (fin Etapa 1) · Gate 30-sep-2026 · **~65%** (sin cambios)
| Ítem de alcance | Estado |
|---|---|
| Exportar informe a PDF/Word | ✅ |
| Panel gerencial con KPIs | ✅ |
| Auditoría de accesos | ✅ |
| Modo offline con sincronización al reconectar | ✅ |
| Integraciones externas AWS estables | 🟡 mejora parcial — ver nota de R2/R3, sigue sin validar contra el AWS real del cliente |
| Regresión completa Etapa 1 + acta de cierre funcional (QA) | ✕ no iniciada |

### R5 — Hardening + DR + optimización · Gate 31-oct-2026 · **~25%** (sube desde ~20% por la auditoría de seguridad)
| Ítem de alcance | Estado |
|---|---|
| Hardening pre-pentest (IDOR, CORS, headers, salt) | ✅ ampliado esta semana con una segunda pasada de auditoría (XSS en tablas, IDOR en sensores, CVEs de dependencias, HSTS) — de-riesga directamente el pentest formal pendiente |
| Pentest OWASP (interno) | ✕ sin agendar — sin cambios, sigue siendo el mayor factor de incertidumbre de calendario |
| Simulacro de Disaster Recovery | ✕ **sigue en 0%** — `specs/015-dr-respaldo-continuidad/tasks.md`: 14/14 tareas sin iniciar, sin cambios desde su última revisión (24-jun) |
| Backup automático con destino offsite | ✕ `scripts/backup_db.sh` soporta `rclone`, remote sigue sin configurar |
| Pruebas de carga progresivas / estrés | ✕ no se encontraron scripts de load testing — sin cambios |

### R6 — Go-Live producción · Gate 30-nov-2026 · **0%** (esperado — es el gate final)
Sin cambios: ninguno de sus ítems puede iniciar antes de que cierren R4/R5.

---

## 3. Distribución de las decisiones arquitectónicas (ADR) por release

| Release | ADR (cantidad) | Números | Tema dominante |
|---|---|---|---|
| R1 | 7 | 000, 001, 002, 004, 005, 031, 033 | Fundaciones: rebrand, despliegue soberano, gateway C++, diseño de datos |
| R2 | 15 | 003, 006, 007, 008, 023, 029, 030, 032, 034, 036, 037, 038, 040, 041, 042 | Servidor, ingesta, RBAC/JWT, auditoría, réplica, core IoT |
| R3 | 24 | 010-015, 017-021, 024, 026-028, 039, 046-053 | Report Studio completo + cartografía + IA local |
| R4 | 4 | 016, 022, 044, 045 | Export server-side, modo offline, export/import cifrado |
| R5 | 4 | 009, 025, 043, **054 (nuevo)** | Tier frío MinIO, biometría/EPP diferida, hardening pre-pentest, **sync ThingsBoard/AWS** |
| R6 | 0 | — | Sin ADR — Go-Live es procedimiento, no decisión de diseño |
| Fuera de alcance (roadmap futuro) | 1 | 035 | Plataforma enterprise LATAM multi-unidad |
| **Sin ADR formal (brecha de documentación, §4)** | **4** | **055, 056, 057, 058 (referenciados en `CHANGELOG.md`, sin archivo)** | Editor de texto (bug fix), CSP×Service Worker de mapas, widgets de dashboard, auditoría de seguridad integral |

**Total de decisiones arquitectónicas formalizadas: 55 (000-054). Total de trabajo arquitectónicamente relevante ya hecho y verificado, incluyendo lo no formalizado: 59.**

**Lectura clave, sin cambios respecto al 17-jul:** R3 sigue concentrando la mayor parte de las decisiones del proyecto — coincide con por qué el módulo de Informes está tan adelantado. Lo nuevo esta semana es que **ADR-054 mueve a R5 la resolución (a nivel de código) de la brecha de sincronización AWS**, que hasta el informe anterior no tenía ningún ADR ni código asociado.

---

## 4. Trabajo real de esta semana sin ADR formal — brecha de documentación (hallazgo nuevo)

`CHANGELOG.md` registra, con fecha y evidencia de verificación E2E, cuatro bloques de trabajo bajo secciones "[Unreleased] — 2026-07-18" y "2026-07-19" que **citan explícitamente** números de ADR (055 a 058) que **no existen como archivo** en `docs/decisions/` ni están indexados en `docs/decisions/README.md`. Se revisó el contenido de cada uno contra las decisiones ya registradas para descartar contradicciones:

| Ref. citada | Tema | Fecha | ¿Contradice algún ADR existente? |
|---|---|---|---|
| ADR-055 | Editor de texto: bug real de selección visual al cambiar tamaño de fuente por tramo (indicador de selección propio en vez del nativo del navegador) | 19-jul | No — es una corrección de bug sobre la base ya decidida en ADR-050 (formato por selección/spans), la extiende, no la contradice |
| ADR-056 | Incidente: 100% de tiles de mapa rotos por CSP aplicada al Service Worker de caché de tiles, no a la página; fix con `location` dedicada en `nginx.conf` | 18-jul | No — es hardening adicional coherente con ADR-043 (endurecimiento pre-pentest) y no reabre nada de ADR-026 (cartografía offline) |
| ADR-057 | Widgets de dashboard estilo ThingsBoard (gauge, agregación, doughnut) en Monitoreo→Sensores, con datos reales | 19-jul | No — es funcionalidad nueva aditiva; **candidato natural para inaugurar el ámbito `realtime`** que el índice de ADR ya reservaba para "componentes futuros" sin haberlo usado todavía |
| ADR-058 | Auditoría de seguridad integral: XSS en tablas, IDOR en `/api/sensors/data`, CVEs de dependencias, HSTS | 19-jul | **Divergencia real detectada y auto-reportada por el propio trabajo** (no una contradicción entre dos ADR): identifica que ADR-029 describe el refresh token como "server-side" pero el código real lo guarda en `localStorage` del cliente — ver §6 |

**Por qué importa:** el repositorio tiene una convención explícita (`docs/decisions/README.md`, sección "Cómo agregar un ADR nuevo") de que "una decisión arquitectónica sin ADR no existe". Estos cuatro bloques ya están implementados y verificados en vivo — el riesgo no es de calidad de código, es que **el conteo oficial de 55 ADR queda desactualizado** y que la próxima auditoría (como la que generó ADR-046-053 el 17-jul) tenga que reconstruir esta semana desde el `CHANGELOG` en vez de desde el log de decisiones, que es precisamente el problema que la convención de ADR existe para evitar.

**Recomendación:** formalizar los 4 archivos `055-editor-texto-fix-seleccion.md`, `056-csp-service-worker-tiles-mapa.md`, `057-dashboard-widgets-thingsboard-style.md` y `058-auditoria-seguridad-integral-jul2026.md` (numeración y ámbito a confirmar por quien los redacte) antes de que se agregue trabajo nuevo, para no perder la trazabilidad SPEC↔ADR que el resto del proyecto sí mantiene.

---

## 5. Estado de control de versiones (git) — hallazgo operativo

El último commit registrado en el repositorio sigue siendo `9d111b0` (17-jul-2026, 13:15). Todo el trabajo descrito en `CHANGELOG.md` con fecha 18 y 19 de julio (el incidente de mapas, el editor de texto, los widgets de dashboard, la auditoría de seguridad) **existe en el árbol de trabajo pero no está confirmado a git** — junto con una reorganización grande de la carpeta `docs/` hacia `docs_/` y modificaciones en unos 66 archivos de backend, todo también sin confirmar. No se auditó el contenido línea por línea de esos 66 archivos por estar fuera del alcance de este informe (es auditoría de arquitectura/ADR, no code review completo), pero se señala como **riesgo operativo**: trabajo verificado y valioso (la propia auditoría de seguridad cierra vulnerabilidades reales) que hoy solo existe en una máquina, sin respaldo de control de versiones ni posibilidad de rollback punto a punto.

**Recomendación:** confirmar (`git commit`) el trabajo de esta semana en commits separados y descriptivos (idealmente uno por bloque: mapas/CSP, editor de texto, widgets, seguridad, reorganización de docs) antes de que se acumule más trabajo encima.

---

## 6. Divergencia documentación↔código no corregida: ADR-029 vs. refresh token real

La auditoría de seguridad de esta semana (§4, "ADR-058") identificó explícitamente que:

> "El ADR-029 lo describe como 'server-side' pero se entrega y almacena en el cliente" — refiriéndose al refresh token, que hoy vive en `localStorage` (`frontend/src/auth/authStorage.ts`) junto con el access token, ambos robables por el mismo XSS.

Se verificó el archivo `docs/decisions/029-rbac-identidad-plataforma-jwt.md`: su título literal es *"JWT híbrido (access corto + **refresh server-side**)"*, y no tiene ningún bloque de "Actualización" o corrección de auditoría — a diferencia de ADR-010, ADR-013, ADR-008 y ADR-034, que sí recibieron ese tratamiento cuando se detectaron divergencias similares entre lo documentado y el código real (ver convención del repositorio, `docs/decisions/README.md`).

Esto **no es una contradicción entre dos ADR** — es el mismo patrón de "documentación quedó desactualizada frente al código" que el equipo ya sabe corregir (lo hizo con ADR-010/013 el 17-jul), pero que en este caso todavía no se aplicó. Es además el hallazgo de seguridad **abierto** de mayor severidad de la auditoría de esta semana (robo de sesión persistente vía XSS), ya identificado como "cambio arquitectónico" pendiente de decisión del equipo, no cerrable en una sola pasada.

**Recomendación doble:**
1. Agregar a ADR-029 el bloque de "Actualización 2026-07-19" documentando la divergencia (mismo patrón ya usado en otros ADR), sin borrar el texto original.
2. Decidir y planificar la remediación técnica recomendada por la propia auditoría: mover el refresh token a cookie `HttpOnly; Secure; SameSite=Strict` con protección CSRF — priorizar como parte del hardening de R5, antes del pentest externo, porque es exactamente el tipo de hallazgo que un pentest de caja negra encontraría igual.

---

## 7. Brechas reales que requieren decisión o seguimiento (actualizado)

| # | Brecha | Estado 17-jul | Estado 20-jul | Cuándo se vuelve urgente |
|---|---|---|---|---|
| 1 | Sincronización/ETL con AWS | Sin código | 🟡 Código implementado (ADR-054), sin validar contra AWS real del cliente | Antes del gate R4 (30-sep) — conseguir acceso/credenciales de prueba contra el AWS real es ahora el paso siguiente concreto |
| 2 | Plan de Disaster Recovery (0%, 14/14 tareas) | 0% | **Sigue en 0%, sin cambios** | Debe iniciar en Sprint S9-S10 (sep-oct) para llegar a tiempo al gate R5 (31-oct) |
| 3 | Pentest OWASP sin agendar | Sin agendar | **Sigue sin agendar** — pero ahora con menos superficie de hallazgos esperables gracias a la auditoría interna de esta semana | Cuanto antes se agende, más margen para cerrar hallazgos antes de R5 |
| 4 | Backup sin destino offsite configurado | Sin configurar | Sin cambios | Configuración operativa simple, sin dependencias técnicas complejas |
| 5 | Demo formal de 10.000 sensores simulados no registrada | No registrada | Sin cambios | Antes del gate R3 (31-ago) si se quiere evidencia formal |
| 6 *(nuevo)* | Refresh token en `localStorage` (divergencia con ADR-029) | — | **Identificado, sin corregir** (§6) | Antes del pentest externo — es exactamente el tipo de hallazgo que ese pentest encontraría |
| 7 *(nuevo)* | 4 bloques de trabajo sin ADR formal (§4) | — | **Identificado, sin formalizar** | Antes de que se acumule más trabajo nuevo encima sin registro |
| 8 *(nuevo)* | Trabajo de esta semana sin commit a git (§5) | — | **Identificado, sin confirmar** | Cuanto antes — es el único de estos ítems con riesgo de pérdida de trabajo si algo falla en la máquina local |

---

## 8. Progreso del proyecto de reportabilidad (ámbito `reports`) — sin cambios de fondo

Se mantiene en **100% (24/24 ADR de ámbito `reports` implementados)**, sin ADR nuevo de ese ámbito esta semana (los 4 bloques sin formalizar de §4 no son de ámbito `reports`, salvo el bug fix del editor de texto — que de formalizarse sería el ADR-055 de ese ámbito, sin cambiar el 100% ya alcanzado por los 24 planificados).

Lo único que queda es el mismo backlog operativo del informe anterior:
- Pentest externo (no iniciado — ver brecha #3, ahora con menos superficie esperable de hallazgos).
- QA funcional formal v0.1 (cobertura parcial vía smoke tests repetidos).
- Release v0.1: Deploy + Documentación + GO-LIVE formal.

**Fecha referencial de término: se mantiene fines de julio 2026 (referencial, no comprometido)** — sin cambios respecto al informe anterior; sigue dependiendo únicamente de cuándo se agende el pentest externo, que no depende del equipo de desarrollo.

---

## 9. Pedido a Gerencia de TI

1. **Tomar nota** del avance real de R2 (~75%) y R3 (~87%) — ambos en curso, sin acción requerida todavía.
2. **Decidir** sobre el release v0.1 anticipado del módulo de Informes, pendiente desde el informe del 17-jul (sección 6 de ese informe) — sigue sin decisión registrada.
3. **Priorizar el agendamiento del pentest OWASP** — sigue siendo el único ítem que, si se demora, corre la fecha de R5 en la misma medida. La auditoría interna de esta semana reduce el riesgo de hallazgos críticos, pero no reemplaza al pentest externo contractual.
4. **Tomar conocimiento** de las 3 brechas de proceso nuevas de esta semana (§7, ítems 6-8): una decisión de seguridad documentada (ADR-029) que quedó desactualizada sin corregir, trabajo real sin ADR formal, y trabajo real sin confirmar a git. Ninguna bloquea un gate hoy, pero las tres son de bajo costo de cerrar ahora y de costo creciente si se acumulan.
5. **Tomar conocimiento** de que el plan de Disaster Recovery (R5) y la validación de la integración AWS contra el entorno real del cliente (R2-R4) siguen sin iniciar/completar — no requieren decisión hoy, pero deben pasar a seguimiento activo de sprint.

> **Recomendación de Arquitectura (ARQ):** el proyecto sigue sin retrasos que requieran intervención de Gerencia hoy. La novedad de esta semana es puramente positiva en producto (seguridad, mapas, dashboards) pero deja tres pendientes de higiene de proceso (ADR-029, ADR sin formalizar, commits pendientes) que recomendamos cerrar en los próximos días, antes de la próxima sesión de desarrollo.

---

### Anexo — Fuentes de este informe

| Fuente | Uso |
|---|---|
| `docs/decisions/README.md` (55 ADR indexados al 17-jul) | Estado de decisiones arquitectónicas formalizadas |
| `docs/decisions/029-rbac-identidad-plataforma-jwt.md` | Verificación de que no existe bloque de corrección para la divergencia del refresh token |
| `docs/decisions/054-sync-thingsboard-legacy-aws.md` | Detalle de la resolución (a nivel de código) de la brecha de sincronización AWS |
| `CHANGELOG.md` (secciones "[Unreleased]" 18 y 19 de julio) | Origen de los 4 hallazgos de trabajo sin ADR formal (§4) |
| `git log` / `git status` del repositorio | Confirmación de que no hay commits nuevos desde el 17-jul y del volumen de cambios sin confirmar |
| `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` | Alcance contractual por sprint/release (línea base, sin cambios) |
| `specs/015-dr-respaldo-continuidad/tasks.md` | Estado real del plan de DR (sigue en 0/14) |
| `RUNBOOK.md`, `GAP_ANALYSIS_2026-07-04.md` | Checklist de seguridad y hardening |
| `scripts/backup_db.sh` | Confirmación de que el remote de backup offsite sigue sin configurar |
| `Informe_Avance_Ejecucion_Gerencia_TI_2026-07-17.md` | Línea base de comparación de este informe |
