# Plan maestro — Plataforma Minera Beemetry
**Corte 2026-09-23 · Sprint vigente S9 · Go-live objetivo condicionado: S13 (2026-11-27)**

> Documento operativo derivado de [ADR-210](decisions/210-auditoria-integral-2026-09-23-cierre-adr-y-conflictos.md) (auditoría), [ADR-211](decisions/211-saneamiento-ledger-migraciones-version-81-duplicada-y-seeds-dev.md) (migraciones) y [ADR-212](decisions/212-plan-maestro-2026-09-23-pendientes-riesgos-decisiones-gerencia.md) (registro de decisiones). Si este documento y el ADR-212 difieren, manda el ADR. El avance mide ejecución documentada, no aceptación productiva.

## 1. Resumen ejecutivo

| Indicador | Valor |
|---|---|
| Avance oficial (script) | **72,5%** — 148/204 tareas normalizadas |
| Avance auditado estricto | **73,3%** — 162/221 (SPEC-027 recalculada: 14/22) |
| Backlog fino de salida a producción | **≈ 47 tareas** en 8 SPEC |
| Releases | R1 100% · R2 100% · R3 97,1% · **R4 90,3%** · **R5 45,2%** · R6 no habilitado |
| Decisiones de negocio ya cerradas | Operaciones de Campo fuera de alcance (ADR-178) · Dermalog descartado (ADR-180) · O3 export PDF aceptado con desviación (ADR-185) · Enterprise LATAM como requisito de producto (ADR-035) |
| Log de decisiones | 213 ADR (000-212) · 167 implemented |
| Base técnica | ≈56.000 líneas C++ (backend) · ≈95.000 líneas TS/TSX · 116 migraciones SQL · 23 contenedores sanos · 27 SPEC |
| Capacidad probada | 25.000 eventos/s sostenidos (100.000 **no** aprobado, ADR-108) · 200 conexiones SSE simultáneas PASS (ADR-181) |

**Lectura:** la plataforma está construida en lo esencial (ingesta, tiempo real, reportabilidad, seguridad, biometría, mapas, fórmulas, alarmas, sincronización con el legado). Lo que falta ya no es construir: es **certificar la operación** — pentest, continuidad de negocio, restore, UAT — y **conectar la realidad de campo** (4 sensores reales con credencial de 81.050 filas; 1 regla de alarma). **No debe declararse go-live** hasta cerrar los 10 controles de la sección 8.

## 2. Hallazgos de la auditoría que requieren acción inmediata

| # | Hallazgo | Acción | Plazo |
|---|---|---|---|
| H3 | 400 cambios sin commit (ADR-171 a 209 y migraciones 93-116 fuera de git; último commit 2026-09-11) | Commit por bloques temáticos + etiqueta de corte | **48 h** |
| H1 | Migraciones 115 y 116 no aplicadas en la BD viva; el backend ya usa su columna y permiso | Aplicar y registrar (comandos en ADR-210) | S9 día 1-2 |
| H2 | Runner de migraciones aborta en la versión 81 (dos scripts con ese prefijo); ledger sin 82-92/95-99 | Ejecutar ADR-211 | S9 |
| H4 | La métrica oficial no veía SPEC-027 ni el esfuerzo real de DR/EPP/STT | **CERRADO 2026-09-23:** `scripts/project-status-metrics.ps1` publica `Official`, `AuditedStrict` y `ProductionExitBacklog` | S9 |
| H5 | SPEC-025/026 en el REGISTRY sin carpeta `specs/` | Crear `spec.md`/`tasks.md` | S9-S10 |

## 3. Lo construido, mes a mes (real)

| Mes | Sprints | Logro principal | Evidencia |
|---|---|---|---|
| **Junio** | S1-S2 · R1 | Análisis, SOW, arquitectura (C++ gateway, dos BD, on-prem soberano), diseño de BD, CI/CD, design system | ADR-000 a 034 base; candidatos de junio |
| **Julio** | S3-S4 · R2 | Motor C++ (Boost.Beast), REST, JWT, WebSocket, RBAC/multitenant, auditoría append-only, versionado server, export PDF servidor, offline (SQLite/WASM) | ADR-001 a 073; hallazgos originales del RUNBOOK resueltos |
| **Agosto** | S5-S6 · R3 | Editor Tiptap/Konva, GIS/MBTiles, sensores IoT, IA local (Ollama/LanguageTool), OCR, biometría DeepFace+SilentFace, chatbot WhatsApp, ingesta 25k/s, portabilidad, replicación | ADR-074 a 134; prueba 25k/s (ADR-108); fix crítico de escalada de privilegios (ADR-134) |
| **Septiembre (1-23)** | S7-S8 · R4 y arranque S9 | SSE de KPIs real (bug de origen corregido), export de 20 tipos de gráfico, cierre O3, alertas con Art. 5, offline con tests, CCTV, motor de fórmulas real (27→28 plantillas), sincronización ThingsBoard (2.269 sensores), alarma de inactividad, mapa con estado compuesto, auditoría de latencia (16 hallazgos), importación PDF/OCR/réplica, export XLSX/PPTX nativo, fotocheck y avatar rediseñados, CRUD de zonas | ADR-135 a 209; 457/457 tests frontend al 2026-09-13 |
| **Octubre** | S9-S11 · R5 | *(plan)* pentest, DR, tier frío, restore, portabilidad, campo real | sección 5 |
| **Noviembre** | S12-S13 · R6 | *(plan)* retest, simulacro, UAT, marcha blanca, go-live | sección 5 |
| **Diciembre en adelante** | Etapa 2 | *(plan)* backlog diferido | sección 7 |

## 4. Estado por SPEC (24 canónicas + 2 por formalizar)

| SPEC | Capacidad | Estado | Pendiente |
|---|---|---|---|
| 001 | Ingesta durable | ✅ 4/4 | — |
| 002 | Dashboard tiempo real | ✅ 10/10 (con corrección ADR-200) | Validar con datos reales |
| 003 | Tier frío | 🟡 7/13 | T2, T9, T10, T12, T16, T17, T18 |
| 004 | Réplica/HA | 🟡 8/13 | T8, T14, T15, T16 |
| 005 | Push SSE | ✅ 9/9 | Mantener prueba de regresión |
| 006 | Auth/RBAC/multitenant | ✅ 7/7 | Pentest externo |
| 007 | ReportStudio/export | ✅ 6/6 (O3 con desviación aceptada) | `tasks.md` de la elaboración posterior (ADR-172…209) |
| 008 | Biometría | ✅ 7/7 | Calibración FMR/FNMR (G-17); validación visual del avatar (UAT-2) |
| 009 | GIS/mapas | 🟡 5/6 | T17 PostGIS (Etapa 2); carga WS mapa (ADR-196) |
| 010 | Fórmulas | ✅ 7/7 | `linear_settlement_cell` (G-8) |
| 011 | IA de texto | 🟡 5/6 | T17 fine-tuning (Etapa 2) |
| 012 | GDAL | 🟡 3/4 | T14-T15 (Etapa 2) |
| 013 | CCTV | 🟡 7/8 | T15 EPP (Etapa 2) |
| 014 | Offline | 🟡 7/9 | T13 pruebas, T15 runbook |
| 015 | DR/continuidad | 🔴 0/14 | Todo — **P0** |
| 016 | Alertas | 🟡 4/5 | T14 badge; demo en vivo con `alarmas.manage` |
| 017 | Visión EPP | ⏸ 0/20 | Etapa 2 (G-16) |
| 018 | Dictado STT | ⏸ 0/21 | Etapa 2 (G-16) |
| 019 | RP/Odoo | 🟡 19/20 | CA-4 Odoo productivo (Etapa 2) |
| 020 | Telemetría 25k/s | ✅ 9/9 | No prometer 100k |
| 021 | Zonas y multiserie | ✅ 10/10 | — |
| 023 | Portabilidad/restore/CI-CD | 🟡 6/11 | T7-T11 |
| 024 | GEOCATMIN | 🟡 8/12 | T6, T15-T19 |
| 025 | Soporte/WhatsApp | 🟡 sin `tasks.md` | Alta formal; cuentas Meta/Twilio (G-3) |
| 026 | Sitio público (propuesta) | ⏳ sin carpeta | Alta formal |
| 027 | Sensores directo+gateway | 🟡 14/22 | T6, T9, T15, T16, T18, T20-T22 |
| 022 | Operaciones de Campo | ⛔ fuera de alcance (ADR-178) | — |

## 5. Plan por sprint (S9 a S13)

Roles: **Dev** = arquitecto/desarrollador principal · **DevOps** · **QA** · **Ger. TI** · **Ger. General** · **Campo** = Steven/equipo técnico de campo. Toda tarea cierra con evidencia enlazada en su `tasks.md` o ADR (regla de la Constitución).

### S9 — 2026-09-21 → 10-02 · "Congelar, sanear y contratar" (R5, semana 1-2)

| ID | Tarea | Dueño | Salida verificable |
|---|---|---|---|
| A1 | Commit por bloques + etiqueta `corte-2026-09-23`; verificar `git status` limpio | Dev | 0 archivos sin seguimiento relevantes |
| A2 | ADR-211: aplicar 115/116, baseline `--record-only` 82-92/95-99, mover seeds a `seeds_dev/`, endurecer runner, guardia de CI | Dev/DevOps | `apply_migrations.sh` exit 0 en volumen vacío |
| D1 | **CERRADO:** corregir `project-status-metrics.ps1` (incluye SPEC-027 auditada) | Dev | Script validado: oficial 72,5%, auditado 73,3%, backlog fino 47 |
| D2 | Crear `specs/025-*` y `specs/026-*` | Dev | `spec.md` + `tasks.md` |
| C5 | Alta de `tasks.md` de la elaboración SPEC-007 (ADR-172, 173, 174, 199, 201, 204, 206, 209) | Dev | Tareas medibles |
| B1 | Inventario físico real de sensores (SPEC-027 T6) | Campo | Listado marca/modelo/protocolo/directo-gateway |
| B8 | Decisión técnica de `linear_settlement_cell` | Ger. TI + Dev | Decisión escrita (G-8) |
| A4a | DR: SPEC-015 T1-T3 (WAL archiving, pgBackRest, bucket `db-backups`) — inicio | DevOps | WAL llegando a MinIO |
| C2 | SPEC-016 T14 (badge) y demo con usuario `alarmas.manage` | Dev/QA | Demo registrada |
| G | **Firmar G-1 (pentest), G-2 (fecha DR), G-7 (inventario), G-13, G-16** | Gerencias | Actas |
| D4 | Regenerar plan ClickUp y presentación desde ADR-212 | Dev | Archivos actualizados |

**Gate S9:** repositorio íntegro y versionado, migraciones sanas, proveedor de pentest elegido, DR iniciado.

### S10 — 2026-10-05 → 10-16 · "Continuidad y datos reales" (R5, semana 3-4; feriado 10-08)

| ID | Tarea | Dueño | Salida verificable |
|---|---|---|---|
| A4b | SPEC-015 T4-T7 (promoción de réplica, fencing, reruteo, replay Redpanda) | DevOps/Dev | Procedimiento ejecutado en entorno de prueba |
| A4c | SPEC-004 T8, T14-T16 (PgBouncer réplica, métricas y alertas de lag/slot) | DevOps | Alertas disparan en prueba |
| A4d | SPEC-003 T2, T9, T10, T12 (versionado del bucket, cron de archivado, variables, prueba de `drop_chunks`) | DevOps | Job semanal corriendo |
| A5a | SPEC-023 T7-T8 (checksums/SBOM/manifest, cifrado y custodia) | DevOps | Manifest firmado |
| A0 | **Ventana ADR-131 fases 6/8/13** (G-5), con rollback ensayado | Dev/DevOps | Fases aplicadas o reprogramadas por escrito |
| B2-B4 | SPEC-027 T9, T15, T16 (anotar modo de conexión; comparación numérica de plantillas con dato real; overrides por dispositivo incl. `YR.PZ-05R*`) | Dev/Campo | Tablas de veredicto con dato real |
| B5-B6 | T18 decisión por cadena (Cuajone/Huarón/Brocal); T20 cierre | Ger. TI | Decisión por cadena |
| B9 | Plan de reglas de alarma reales por sensor/tenant | Dev/Campo | Reglas mínimas cargadas |
| B10 | Prueba de carga del WS del mapa (ADR-196) y E2E de zonas en Alpayana (ADR-208) | QA | Informe de prueba |
| C1 | SPEC-024 T6, T15-T19 | Dev/QA | Búsqueda por cuadrícula/coordenadas + tests |
| G | **Firmar G-3, G-4, G-5, G-6, G-8, G-11, G-12, G-14, G-17** | Gerencias | Actas |

**Gate S10:** DR con procedimientos ejecutables, tier frío operativo, reglas de alarma mínimas, decisión de fecha (G-14).

### S11 — 2026-10-19 → 10-30 · "Pentest y restore" (R5, semana 5-6)

| ID | Tarea | Dueño | Salida verificable |
|---|---|---|---|
| A3a | **Ejecución del pentest externo** (ADR-169: alcance, PTES/NIST/CVSS) | Proveedor | Informe con hallazgos clasificados |
| A3b | Remediación de hallazgos críticos/altos (inicio) | Dev | Tickets cerrados con evidencia |
| A4e | SPEC-015 T8-T11 (réplica geográfica, alertas, **runbook DR**, restore automatizado) | DevOps | Runbook publicado; restore cron OK |
| A4f | SPEC-003 T16-T18 (pruebas de borde y auditoría de archivado) | QA/DevOps | Tests verdes |
| A5b | SPEC-023 T9 **restore en host limpio** con suites | DevOps | Reporte de restore (depende de A2) |
| B7 | SPEC-027 T21-T22: ADR de cierre y registro | Dev | ADR y REGISTRY/BACKLOG actualizados |
| B11 | Migración de alarmas del legado (ADR-198) según decisión T18 | Dev | Alarmas cargadas en `platform_alarm_rules` |
| C3 | SPEC-014 T13, T15 (pruebas y runbook offline) | QA/Dev | Runbook + tests |
| C4 | UAT-1 (ADR-188, 189, 196, 208, 161) y UAT-2 (ADR-156-159, 163, 164, 202, 203, 207) con registro/cámara reales | QA/Campo | Lista de verificación firmada |
| D3 | Actualizar README/REGISTRY/BACKLOG/CHANGELOG | Dev | Documentos alineados |

**Gate S11:** informe de pentest recibido, restore en host limpio exitoso, runbook DR publicado.

### S12 — 2026-11-02 → 11-13 · "Retest, simulacro y UAT" (R6, semana 1-2)

| ID | Tarea | Dueño | Salida verificable |
|---|---|---|---|
| A3c | Remediación completa y **retest** del pentest | Proveedor/Dev | 0 hallazgos críticos/altos abiertos |
| A4g | **Simulacro DR cronometrado** (SPEC-015 T12: RTO < 15 min), T13 (operador distinto), T14 (prueba de split-brain) | DevOps + operador ajeno al autor | Acta con tiempos |
| A5c | SPEC-023 T10-T11 (simulacro RTO/RPO + **rollback**, CI/CD progresivo) | DevOps | Rollback ensayado |
| A6a | **UAT con operadores** (G-4): casos, usuarios, acta | Ger. General/QA | UAT firmado |
| A7 | Prueba de estrés a la carga objetivo declarada (no exceder 25k/s sin nueva aprobación, ADR-108) | QA | Informe |
| B | Cierre de sensores reales inventariados: credenciales, plantillas y reglas | Campo/Dev | Sensores reales operando con alarmas |

**Gate S12:** DR probado, pentest limpio, UAT firmado.

### S13 — 2026-11-16 → 11-27 · "Marcha blanca y go-live condicionado" (R6, semana 3-4)

| ID | Tarea | Dueño | Salida verificable |
|---|---|---|---|
| A6b | **Marcha blanca** con monitoreo reforzado | Ger. General/DevOps | Acta de marcha blanca |
| A6c | Correcciones finales; congelamiento de versión y etiqueta de release | Dev | Release etiquetado |
| A6d | Revisión de los 10 controles de go/no-go (sección 8) | Ger. General/Ger. TI | Acta go/no-go |
| A6e | **Go-live** solo si todos los controles están en verde; si no, activar plan B (ventana posterior) | Ger. General | Decisión firmada |

## 6. Riesgos priorizados

| Prio | Riesgo | Impacto | Mitigación | Dueño |
|---|---|---|---|---|
| P0 | 12 días de trabajo sin commit | Pérdida de trabajo y de trazabilidad | A1 en 48 h | Dev |
| P0 | Migraciones desfasadas / runner bloqueado | Despliegue y restore fallan | ADR-211 | Dev/DevOps |
| P0 | DR en 0% (14 tareas, 3 pruebas cronometradas) | Bloquea go-live | A4a-g desde S9 | DevOps |
| P0 | Pentest sin proveedor ni fecha | Bloquea go-live seguro | G-1 antes del 10-02 | Ger. General |
| P0 | UAT y marcha blanca sin fecha | Bloquea aceptación | G-4 | Ger. General |
| P1 | 4 sensores reales de 81.050; 1 regla de alarma | Go-live sin operación real | B1-B9 | Campo/Ger. TI |
| P1 | `linear_settlement_cell` (error posible 10×-100×) | Decisiones operativas erróneas | B8 / G-8 | Ger. TI |
| P1 | GPU en un laptop (avatar, OCR, export extenso) | Capacidad y continuidad | G-6 | Ger. TI |
| P1 | WhatsApp/SMS sin cuentas comerciales | Alcance contractual parcial | G-3 | Ger. General |
| P2 | Métrica oficial ya publica lectura auditada y backlog fino; falta aprobación gerencial G-13 | Credibilidad | D1 cerrado / G-13 | Dev |
| P2 | Volumen de cambios en ReportStudio sin `tasks.md` | Regresiones | C5, suite en cada corte | Dev/QA |
| P2 | Deuda ADR-176 | Mantenibilidad | G-11 | Ger. TI |

## 7. Etapa 2 (posterior al go-live, sin fecha comprometida)

Odoo productivo (SPEC-019 CA-4) · PostGIS (SPEC-009 T17) · GDAL thread-pool y persistencia de jobs (SPEC-012 T14-T15) · fine-tuning de LLM minero (SPEC-011 T17) · Visión EPP (SPEC-017/013 T15) · Dictado STT (SPEC-018) · Parte B de ADR-194 (ACC→VEL→DIS) · topología LATAM edge+hub F1-F4 (ADR-035) · versionado `/api/v1` (ADR-033) · calibración biométrica formal si el cliente la exige · canales WhatsApp/SMS comerciales si no entran antes · Operaciones de Campo **solo** como iniciativa independiente (ADR-178).

## 8. Condiciones de go/no-go (las 10 son obligatorias)

1. Pentest externo sin hallazgos críticos/altos abiertos (ADR-169).
2. Simulacro DR cronometrado con RTO < 15 min, operador distinto del autor (SPEC-015).
3. Restore automatizado exitoso en host limpio (SPEC-023 T9).
4. UAT firmado por usuarios operativos y acta de marcha blanca.
5. Rollback ensayado y documentado (SPEC-023 T10).
6. Migraciones al día y ledger verificable (ADR-211).
7. Todo el código y la documentación bajo control de versiones con etiqueta de release.
8. Sensores reales inventariados y reglas de alarma mínimas por tenant.
9. `linear_settlement_cell` resuelta o excluida por escrito.
10. Cuentas y canales externos confirmados o excluidos del alcance por escrito.

## 9. Decisiones de Gerencia abiertas (resumen — detalle y recomendaciones en ADR-212)

| ID | Decisión | Límite |
|---|---|---|
| G-1 | Pentest externo: proveedor y presupuesto | **10-02** |
| G-2 | Fecha del simulacro DR y operador ajeno | 10-02 |
| G-3 | Cuentas comerciales Meta WhatsApp y Twilio SMS | 10-09 |
| G-4 | Fechas y usuarios de UAT y marcha blanca | 10-16 |
| G-5 | Ventana de ADR-131 fases 6/8/13 | 10-09 |
| G-6 | VPS/GPU de producción | 10-09 |
| G-7 | Inventario de sensores y cadenas de alarma legado | 10-02 |
| G-8 | `linear_settlement_cell`, acumulados, ADR-194 B | 10-09 |
| G-9 | Infraestructura LATAM F1-F4 | Trimestral |
| G-10 | Rename de BD y `/api/v1` | Etapa 2 |
| G-11 | Deuda ADR-176 | 10-16 |
| G-12 | App MovilMinero | 10-16 |
| G-13 | Aprobar lectura de avance (72,5 / 73,3 / ≈47) | 09-30 |
| G-14 | Fecha de go-live: base vs. contingencia | 10-09 |
| G-15 | Odoo productivo | Etapa 2 |
| G-16 | EPP y STT como Etapa 2 | 10-02 |
| G-17 | Calibración FMR/FNMR para go-live | 10-16 |

## 10. Supuestos y límites de este análisis

- Cifras de avance salen de `scripts/project-status-metrics.ps1`, validado el 2026-09-23: `Official` 148/204 (72,5%), `AuditedStrict` 162/221 (73,3%) y `ProductionExitBacklog` 47 tareas. No se re-ejecutaron en esta pasada las suites de tests ni las pruebas de carga.
- Las fechas límite de decisión y la ventana de contingencia son **recomendaciones del análisis**, no compromisos.
- No se modeló la disponibilidad de personas ni los plazos del proveedor de pentest.
- Los ADR cuyo estado dice "verificado en vivo" conservan la evidencia que cada uno documenta.

## 11. Cierre de fuentes y métrica para presentación gerencial

Fuente ejecutable vigente: `scripts/project-status-metrics.ps1`.

| Salida | Valor | Uso en presentación |
|---|---:|---|
| `Official` | 148/204 = **72,5%** | Comparabilidad con cortes anteriores |
| `AuditedStrict` | 162/221 = **73,3%** | Cifra recomendada para Gerencia; incluye SPEC-027 en 14/22 |
| `ProductionExitBacklog` | **47 tareas** | Lista real que bloquea go-live: DR, tier frío, HA, restore, GEOCATMIN, sensores, alertas y offline |

Regla de lectura: no inflar avance por encima de 73,3% hasta que exista evidencia nueva en `tasks.md`, ADR o pruebas ejecutadas. Para la presentación, el mensaje correcto es: **producto construido en lo esencial, salida a producción condicionada a cerrar 10 controles P0/P1**.

