# Informe de Avance de Ejecución — Proyecto AURIXA / Beemetry

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Tipo de documento:** Informe de avance de ejecución (no reemplaza ni modifica el cronograma contractual v36.1 — lo audita contra el código real)
**Fecha de corte:** 17 de julio de 2026 (dentro de Sprint S4, Release R2)
**Calendario vigente:** 1 jun – 30 nov 2026 (6 meses · 13 sprints · 6 gates · 2 etapas) — sin cambios
**Preparado por:** Arquitectura TI / PMO (ARQ)
**Referencia:** actualiza `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` (corte 23-jun-2026, Sprint S2) con el estado real verificado hoy

---

## 1. Lectura ejecutiva en una página

| Dimensión | Estado al 23-jun (v36.1) | Estado al 17-jul (este informe) |
|---|---|---|
| Decisiones arquitectónicas (ADR) | 46 registradas | **54 registradas** (+8 esta semana) |
| Gate más reciente cerrado | R1 (30-jun, aprobado) | **R1 sigue cerrado** — sin cambios |
| Gate en curso | — (aún no llegaba) | **R2 (31-jul) — ~70% de su alcance específico** |
| Brechas nuevas confirmadas | — | **2**: sin código de sincronización AWS; plan de Disaster Recovery en 0% (specs/015, 14/14 tareas sin iniciar) |
| Corrección de documentación | — | ADR-010/013 corregidos (premisa de texto no aplicaba al editor real) |

**Mensaje central de este informe:** el proyecto avanza **muy por delante del calendario en el módulo de Informes** (Report Studio) — alcance completo de R3 cerrado con casi 6 semanas de anticipación — pero **dos ítems de alcance transversal (integración AWS y Disaster Recovery) están en 0% de avance real** y no tienen ADR ni tarea iniciada. Ninguno de los dos bloquea el gate R2 (31-jul), pero sí deben quedar en el radar de R4 y R5 respectivamente para no descubrirse tarde.

---

## 2. Estado real por release — verificado contra código, no por percepción

Metodología: para cada release se listó el alcance específico según `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` (secciones 5-7) y se verificó cada ítem contra el repositorio real (código, specs, scripts, configuración de despliegue) — no contra el juicio del equipo.

### R1 — Arquitectura y diseño de datos · Gate 30-jun-2026 · **100%** ✅ (cerrado, sin cambios)
- Esquema PostgreSQL, pipeline CI/CD, shell del editor, matriz RBAC inicial: todos entregados.
- Superado: RBAC llegó a 7 roles unificados en una sola fuente de verdad (no solo "matriz inicial").

### R2 — Motor operacional + seguridad base · Gate 31-jul-2026 · **~70%** (en curso, Sprint S4)
| Ítem de alcance | Estado |
|---|---|
| Núcleo C++ operativo | ✅ |
| APIs REST + canal en vivo de sensores | ✅ |
| Login con usuarios y perfiles (RBAC) | ✅ — superado (7 roles) |
| Auto-guardado del editor en servidor | ✅ |
| Telemetría base validada con métricas `/api/metrics` | ✅ confirmado (`backend/src/main.cpp::handleMetrics`) |
| Sincronización inicial con AWS | ⚠️ **no encontrado código de integración AWS en el backend** |
| Plan maestro de pruebas QA | ⚠️ **no iniciado formalmente** |

### R3 — Editor + GIS + sensores + IA base · Gate 31-ago-2026 · **~85%** (aún no llega su sprint, pero el editor ya está completo)
| Ítem de alcance | Estado |
|---|---|
| Editor ReportStudio (texto, tablas, imágenes) | ✅ **muy superado** — 24/24 ADR del módulo, incluye formato de texto tipo Word por selección, cerrado esta semana |
| Mapa interactivo con puntos y zonas | ✅ |
| Dictado por voz minero | ✅ |
| Modelos de IA local (Ollama + LanguageTool) | ✅ |
| 10.000 sensores simulados — demo formal | ⚠️ pipeline construido en código; no se encontró evidencia de una demo/ejecución formal registrada |
| ETL programado desde AWS | ⚠️ mismo gap que R2 |

### R4 — Integración e2e (fin Etapa 1) · Gate 30-sep-2026 · **~65%**
| Ítem de alcance | Estado |
|---|---|
| Exportar informe a PDF/Word | ✅ |
| Panel gerencial con KPIs | ✅ |
| Auditoría de accesos | ✅ |
| Modo offline con sincronización al reconectar | ✅ |
| Integraciones externas AWS estables | ⚠️ gap sin resolver desde R2 |
| Regresión completa Etapa 1 + acta de cierre funcional (QA) | ✕ no iniciada |

### R5 — Hardening + DR + optimización · Gate 31-oct-2026 · **~20%**
| Ítem de alcance | Estado |
|---|---|
| Hardening pre-pentest (IDOR, CORS, headers, salt) | ✅ — es preparación, no el hardening completo de Sprint S9 |
| Pentest OWASP (interno) | ✕ **sin agendar** |
| Simulacro de Disaster Recovery | ✕ **`specs/015-dr-respaldo-continuidad/tasks.md`: 14/14 tareas sin iniciar** (WAL archiving, pgBackRest, promoción de réplica, fencing, runbook, simulacro cronometrado — nada arrancó) |
| Backup automático con destino offsite | ✕ script (`scripts/backup_db.sh`) soporta `rclone`, pero el remote no está configurado |
| Pruebas de carga progresivas / estrés | ✕ no se encontraron scripts de load testing en el repositorio |

### R6 — Go-Live producción · Gate 30-nov-2026 · **0%** (esperado — es el gate final)
Prueba de estrés 10k real, UAT con operadores mineros, marcha blanca, Go-Live y transferencia: ninguno puede iniciar antes de que cierren R4/R5.

---

## 3. Distribución de las 54 decisiones arquitectónicas (ADR) por release

| Release | ADR (cantidad) | Números | Tema dominante |
|---|---|---|---|
| R1 | 7 | 000, 001, 002, 004, 005, 031, 033 | Fundaciones: rebrand, despliegue soberano, gateway C++, diseño de datos |
| R2 | 15 | 003, 006, 007, 008, 023, 029, 030, 032, 034, 036, 037, 038, 040, 041, 042 | Servidor, ingesta, RBAC/JWT, auditoría, réplica, core IoT |
| R3 | 24 | 010-015, 017-021, 024, 026-028, 039, 046-053 | Report Studio completo + cartografía + IA local |
| R4 | 4 | 016, 022, 044, 045 | Export server-side, modo offline, export/import cifrado |
| R5 | 3 | 009, 025, 043 | Tier frío MinIO, biometría/EPP diferida, hardening pre-pentest |
| R6 | 0 | — | Sin ADR — Go-Live es procedimiento, no decisión de diseño |
| Fuera de alcance (roadmap futuro) | 1 | 035 | Plataforma enterprise LATAM multi-unidad |

**Lectura clave:** R3 concentra el 44% de todas las decisiones arquitectónicas del proyecto — coincide con por qué el módulo de Informes está tan adelantado. R5, en cambio, tiene solo 3 ADR pese a ser el release con más brechas reales: **lo que falta en R5 no es diseño, es ejecución** (correr el pentest, correr el simulacro DR, correr la prueba de carga) — no hay ninguna decisión arquitectónica pendiente ahí.

---

## 4. Corrección de documentación realizada esta semana

Al auditar el código para redactar los 8 ADR nuevos (046-053), se encontró que **ADR-010 y ADR-013** (verificados 2026-07-06) documentaban que el texto del editor se guarda como Tiptap/ProseMirror-JSON — pero el código real de Report Studio v2 (desde antes de esta semana) usa un modelo de string plano con estilos por rango. Era una divergencia entre documentación y código, **no un defecto del producto**. Se corrigió agregando un bloque de actualización a ambos ADR (sin borrar el texto original, según la convención del repositorio) y se documentó el modelo real vigente en el nuevo ADR-050. No requiere ninguna acción de gerencia — se reporta por transparencia y trazabilidad.

---

## 5. Brechas reales que requieren decisión o seguimiento

| # | Brecha | Impacto | Cuándo se vuelve urgente |
|---|---|---|---|
| 1 | Sin código de sincronización/ETL con AWS | Alcance explícito de R2/R3/R4 sin iniciar | Antes del gate R4 (30-sep) — hoy no bloquea R2 |
| 2 | Plan de Disaster Recovery en 0% (14/14 tareas) | Alcance explícito de R5 | Debe iniciar en Sprint S9-S10 (sep-oct) para llegar a tiempo al gate R5 (31-oct) |
| 3 | Pentest OWASP sin agendar | Bloqueante ya conocido para certificar R5 | Cuanto antes se agende, más margen para cerrar hallazgos antes de R5 |
| 4 | Backup sin destino offsite configurado | Parte de la evidencia de R5 (continuidad) | Configuración operativa simple, sin dependencias técnicas complejas |
| 5 | Demo formal de 10.000 sensores simulados no registrada | Evidencia esperada en el gate R3 | Antes del gate R3 (31-ago) si se quiere evidencia formal |

---

## 6. Propuesta en evaluación: release v0.1 anticipado del módulo de Informes

El módulo de Informes (alcance contractual de R3) está al 100% de su propio alcance (24/24 ADR), con casi 6 semanas de anticipación sobre el gate R3 (31-ago). Sigue pendiente de decisión de Gerencia: **¿se libera un v0.1 anticipado solo de ese módulo ahora** (condicionado únicamente a agendar el pentest), **o se espera a que R3/R4 cierren su alcance completo** (incluyendo los ítems de AWS aún pendientes)? Ninguna opción tiene impacto en el costo o plazo total del proyecto — es una decisión de secuenciación de entrega de valor, no de alcance.

---

## 7. Pedido a Gerencia de TI

1. **Tomar nota** del avance real de R2 (~70%) y R3 (~85%) — ambos en curso, sin acción requerida todavía.
2. **Decidir** sobre el release v0.1 anticipado del módulo de Informes (Sección 6).
3. **Priorizar el agendamiento del pentest OWASP** — es el único ítem que, si se demora, corre la fecha de R5 en la misma medida.
4. **Tomar conocimiento** de que el plan de Disaster Recovery (R5) y la integración AWS (R2-R4) están en 0% — no requieren decisión hoy, pero si no inician en las próximas semanas pondrán en riesgo sus gates respectivos.

> **Recomendación de Arquitectura (ARQ):** el proyecto no tiene retrasos que requieran intervención de Gerencia hoy. Las dos brechas de la Sección 5 (AWS, DR) deben pasar a seguimiento activo de sprint para no convertirse en sorpresas en R4/R5.

---

### Anexo — Fuentes de este informe

| Fuente | Uso |
|---|---|
| `docs/decisions/README.md` (54 ADR auditados) | Estado de decisiones arquitectónicas |
| `Resumen_Sprints_Entregables_Gerencia_TI_v36.md` | Alcance contractual por sprint/release (línea base, sin cambios) |
| `specs/015-dr-respaldo-continuidad/tasks.md` | Estado real del plan de DR |
| `RUNBOOK.md`, `GAP_ANALYSIS_2026-07-04.md` | Checklist de seguridad y hardening |
| Código fuente (`backend/src`, `frontend/src`, `scripts/`) | Verificación directa de cada ítem de alcance (no autoreportado) |
