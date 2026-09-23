# ADR-212 — Plan maestro actualizado (corte 2026-09-23): pendientes consolidados, riesgos y registro único de decisiones de Gerencia

**Status**: accepted (2026-09-23) — el plan y el registro de decisiones son vigentes; cada decisión G-n sigue **abierta** hasta que Gerencia la firme. Este ADR es el lugar canónico donde viven los pendientes que antes estaban dispersos en ADR-035, 033, 110, 117, 131, 168, 169, 170, 176, 194 y 210.

**Fecha**: 2026-09-23

**Autores**: Luder Armas (Gerencia de proyecto) con Claude Code

**Ámbito**: plataforma / gobierno

**Relación**: sucede al plan del 2026-09-17; se apoya en ADR-210 (auditoría) y ADR-211 (migraciones); consolida ADR-035, 033, 110→178, 117, 131, 168, 169, 170, 176, 185, 192, 194. Documento operativo detallado por sprint: [`docs/PLAN_MAESTRO_2026-09-23.md`](../PLAN_MAESTRO_2026-09-23.md).

## Contexto

Estamos en el sprint **S9** (2026-09-21 → 10-02) del calendario de 13 sprints (S1 2026-06-01 → S13 2026-11-27, `scripts/generate_clickup_import.py::SPRINTS`). Quedan **≈ 47 días hábiles** hasta la ventana de go-live de S13. Los releases R1-R3 cerraron; R4 está en 90,3%; R5 (hardening, DR, restore, pentest) en 45,2%; R6 (UAT, marcha blanca, go-live) no habilitado.

Estado consolidado (fuente: `scripts/project-status-metrics.ps1` y ADR-210):

| Medición | Valor | Uso |
|---|---|---|
| Avance oficial automatizado | **72,5%** (148/204) | repetible; no ve SPEC-027 |
| Avance auditado estricto | **73,3%** (162/221) | recomendado para Gerencia |
| Backlog fino de salida a producción | **≈ 47 tareas** | esfuerzo real restante |
| ADR | 210 (000-209) → 213 con este ADR | 167 implemented, 24 accepted, resto abiertos |
| SPEC canónicas | 24 medibles + SPEC-025/026 sin carpeta | |

## Decisión

Adoptar el plan por pistas y sprints de abajo, el registro G-1…G-17 como lista única de decisiones de Gerencia, y las condiciones de go/no-go de la sección final.

### Backlog fino de salida a producción (alcance real ≈ 47 tareas)

| SPEC | Tareas abiertas (detalle en `tasks.md`) | Nº |
|---|---|---:|
| 015 DR/continuidad | T1-T14 (WAL+pgBackRest, promoción, fencing, reruteo, replay Redpanda, réplica geográfica, alertas, runbook, restore automatizado, simulacro, operador distinto, prueba split-brain) | 14 |
| 003 Tier frío | T2, T9, T10, T12, T16, T17, T18 | 7 |
| 004 Réplica/HA | T8 (PgBouncer réplica), T14, T15, T16 (métricas y alertas de replicación) | 4 |
| 023 Portabilidad | T7-T11 (checksums/SBOM, cifrado, restore en host limpio, simulacro RTO/RPO, CI/CD) | 5 |
| 024 GEOCATMIN | T6, T15, T16, T17, T18, T19 | 6 |
| 027 Sensores | T6, T9, T15 (parcial), T16, T18, T20, T21, T22 | 8 |
| 016 Alertas | T14 (badge) + demo en vivo con cuenta `alarmas.manage` | 1 |
| 014 Offline | T13 (pruebas), T15 (manual/runbook) | 2 |
| **Total** | | **47** |

Fuera del conteo, por decisión ya tomada: SPEC-012 T14-T15, SPEC-009 T17 (PostGIS), SPEC-011 T17 (fine-tuning), SPEC-013 T15 y SPEC-017 (EPP), SPEC-018 (STT), SPEC-019 CA-4 (Odoo productivo) → **Etapa 2**. SPEC-022 (Operaciones de Campo) → fuera del proyecto (ADR-178).

### Pistas de trabajo

**Pista A — Salida a producción (P0)**
- **A1** Congelar corte y commitear por bloques temáticos (400 cambios sin commit; ver ADR-210 H3). S9, 1-2 días. *Cero costo, riesgo alto si no se hace.*
- **A2** Saneamiento de migraciones (ADR-211): aplicar 115/116, baseline `--record-only` de 82-92/95-99, mover seeds a `seeds_dev/`, endurecer runner, guardia de CI. S9.
- **A3** Pentest externo (ADR-169): decisión de proveedor S9 → ejecución S11 → remediación S11-S12 → retest S12.
- **A4** DR y continuidad: SPEC-015 T1-T3 (S9-S10), T4-T7 (S10), T8-T11 (S11), simulacro T12-T14 (S12); en paralelo SPEC-003 (S10-S11) y SPEC-004 T8/T14-T16 (S10).
- **A5** SPEC-023 T7-T11: SBOM y manifest (S10), cifrado/custodia (S10), restore automatizado en host limpio (S11, depende de ADR-211), simulacro RTO/RPO + rollback (S12, junto con A4), CI/CD progresivo (S12).
- **A6** UAT, marcha blanca, acta y rollback probado (S12-S13); go-live condicionado (S13).

**Pista B — Sensores y datos de campo (SPEC-027, ADR-187 a 198)**
- **B1** T6 inventario físico real (dueño: Steven/equipo técnico) S9 → **B2** T9 anotar `connection_mode` S9-S10.
- **B3** T15 comparación numérica campo-a-campo de las 28 plantillas contra dato real; **B4** T16 mecanismo de override por dispositivo (Boroo Misquichilca, GF.PZ VW-1703, Yauricocha **y `YR.PZ-05R*`**, hallazgo nuevo) S10.
- **B5** T18 decisión por cadena de alarma legado (Cuajone/Huarón/Brocal) S10; **B6** T20 confirmar cierre ("ya resuelto por ADR-054"); **B7** T21/T22 ADR y registro de cierre S11.
- **B8** Resolver `linear_settlement_cell` (posible error de 10× a 100× en `MCA`/`ALT`; ver `specs/027/tasks.md` hallazgo crítico 1) antes de cualquier uso productivo. S9-S10.
- **B9** Plan de reglas de alarma reales por sensor/tenant (hoy 1 regla en toda la BD). S10-S11.
- **B10** Prueba de carga del WebSocket del mapa (ADR-196) y verificación E2E de zonas en Alpayana (ADR-208). S10.
- **B11** Migración de alarmas del legado (ADR-198: motor listo, "analizado sin insertar") tras B5.

**Pista C — Producto residual**
- **C1** SPEC-024: T6 (búsqueda por cuadrícula IGN/coordenadas), T15-T17 (tests), T18 (corregir "134 servicios" vs 38 reales), T19 (`plan.md`). S10.
- **C2** SPEC-016 T14 y demo en vivo con usuario `alarmas.manage`. S9-S10.
- **C3** SPEC-014 T13/T15: pruebas y runbook de operación offline. S11.
- **C4** Validaciones en vivo: **UAT-1** (ADR-188, 189, 196, 208, 161) y **UAT-2** con registro/cámara real (ADR-156, 157, 158, 159, 163, 164, 202, 203, 207). S11-S12.
- **C5** SPEC-007: dar de alta `tasks.md` para la elaboración posterior a T18 (ADR-172, 173, 174, 199, 201, 204, 206, 209) y depurar T12/T13 obsoletos. S9-S10.
- **C6** Calibración biométrica FMR/FNMR: solo si Gerencia la exige para go-live (G-17).

**Pista D — Gobierno y documentación**
- **D1 CERRADO 2026-09-23** Corregir `project-status-metrics.ps1` para publicar oficial + auditado + backlog fino. Salida validada: `Official` 148/204 (72,5%), `AuditedStrict` 162/221 (73,3%) y `ProductionExitBacklog` 47.
- **D2** Crear `specs/025-*` y `specs/026-*` (`spec.md`/`tasks.md`). S9-S10.
- **D3** Mantener `README.md` del log, `REGISTRY.md`, `BACKLOG.md`, `CHANGELOG.md` alineados al cierre de cada sprint. Continuo.
- **D4** Regenerar el plan ClickUp/PPT desde este ADR al cierre de S9. S9.

**Pista E — Etapa 2 (posterior al go-live, sin fecha)**
Odoo productivo (SPEC-019 CA-4), PostGIS (SPEC-009 T17), GDAL thread-pool/persistencia (SPEC-012 T14-T15), fine-tuning LLM (SPEC-011 T17), EPP (SPEC-017/013 T15), STT (SPEC-018), topología LATAM F1-F4 (ADR-035), versionado `/api/v1` (ADR-033), SMS/WhatsApp comerciales si no entran antes.

### Calendario mes a mes

| Mes | Sprints | Estado | Foco |
|---|---|---|---|
| Junio | S1-S2 (R1) | ✅ 100% | Kick-off, SOW, arquitectura, BD, CI/CD, design system |
| Julio | S3-S4 (R2) | ✅ 100% | Motor C++, REST, JWT, WebSocket, RBAC, ingesta durable, auto-save |
| Agosto | S5-S6 (R3) | ✅ 97,1% | Editor, GIS, sensores, IA, OCR, biometría, reportabilidad |
| Septiembre | S7-S8 (R4) cerrados · S9 en curso | 🟡 R4 90,3% | Exportaciones, offline, alertas, integración sensores; arranca hardening |
| Octubre | S9-S11 (R5) | 🔴 R5 45,2% | Pentest, DR, tier frío, restore, portabilidad, campo real |
| Noviembre | S12-S13 (R6) | ⏳ no habilitado | Retest, simulacro DR, UAT, marcha blanca, go-live |
| Diciembre + | Etapa 2 | ⏳ | Backlog diferido (pista E) |

Feriado laboral a considerar: 2026-10-08 (Combate de Angamos).

### Registro único de decisiones de Gerencia (abiertas)

| ID | Decisión | Origen | Dueño | Fecha límite | Recomendación |
|---|---|---|---|---|---|
| G-1 | Contratar pentest externo (proveedor, alcance ADR-169, presupuesto) | ADR-043/058/169 | Gerencia General | **2026-10-02** | Aprobar; sin esto no hay go-live seguro |
| G-2 | Fecha del simulacro DR, responsable y operador distinto del autor | SPEC-015 T12-T13 | Gerencia TI | 2026-10-02 | Semana del 2026-11-02 |
| G-3 | Cuentas comerciales Meta WhatsApp Business y Twilio SMS | ADR-137/168 | Gerencia General | 2026-10-09 | Comprar solo si el bot y el SMS son requisito del go-live; si no, diferir a Etapa 2 y quitar del alcance R6 |
| G-4 | Fechas, usuarios, casos y acta de UAT y marcha blanca | SPEC-023/R6 | Gerencia General | 2026-10-16 | UAT en S12; marcha blanca en S13 |
| G-5 | Ventana de despliegue de ADR-131 fases 6/8/13 (reinicio coordinado del backend en producción) | ADR-131 | Gerencia TI | 2026-10-09 | Fin de semana de S10, con rollback ensayado |
| G-6 | Dimensionamiento y proveedor de VPS/GPU de producción | ADR-170 | Gerencia TI | 2026-10-09 | Decidir antes de A5 y de UAT; hoy la GPU es un laptop RTX 5060 |
| G-7 | Inventario físico de sensores y decisión por cadena de alarma legado (Cuajone/Huarón/Brocal) | SPEC-027 T6/T18 | Gerencia TI (Steven) | 2026-10-02 | Entregar inventario; portar solo las 3 cadenas de alarma real |
| G-8 | Corrección de `linear_settlement_cell`, estrategia de acumulados y Parte B de ADR-194 (ACC→VEL→DIS) | ADR-189/194, SPEC-027 | Gerencia TI | 2026-10-09 | Aplicar factor de conversión por familia (desdoblar plantilla); Parte B a Etapa 2 |
| G-9 | Infraestructura LATAM F1-F4 (edge+hub) | ADR-035 | Gerencia General | trimestral | Diferir; los pilotos siguen sobre la VPS de Perú |
| G-10 | Rename de BD y versionado `/api/v1` | ADR-033 | Gerencia TI | Etapa 2 | No renombrar BD; versionar API solo cuando exista cliente externo |
| G-11 | Deuda de ADR-176: `authSessionManager.ts` (conectar/eliminar), `pnpm-workspace.yaml` | ADR-176 | Gerencia TI | 2026-10-16 | Conectar `authSessionManager` (sesiones de tablet inactivas); eliminar `pnpm-workspace.yaml` |
| G-12 | ¿App MovilMinero dentro del alcance? | ADR-117 | Gerencia General | 2026-10-16 | Confirmar como fuera de alcance salvo pedido contractual |
| G-13 | Aprobar la lectura de avance: 72,5% oficial / 73,3% auditado / ≈47 tareas | ADR-210 | Gerencia TI | 2026-09-30 | Aprobar |
| G-14 | Mantener go-live 2026-11-27 condicionado, o adoptar ventana de contingencia | este ADR | Gerencia General | 2026-10-09 | Ver "Escenarios" |
| G-15 | Integración Odoo productiva (SPEC-019 CA-4) | ADR-103 | Gerencia General | Etapa 2 | Reprogramar tras go-live |
| G-16 | Confirmar EPP (SPEC-017) y STT (SPEC-018) como Etapa 2 | ADR-025 | Gerencia General | 2026-10-02 | Confirmar; el bucket R5 pasa de 45,2% a ≈54% al excluirlas |
| G-17 | ¿Se exige calibración estadística FMR/FNMR (ISO/IEC 30107-3) para el go-live? | ADR-119/162 | Gerencia General | 2026-10-16 | Exigir solo si el cliente lo pide contractualmente; requiere muestra mayor |

### Riesgos priorizados

| Prio | Riesgo | Prob. | Impacto | Mitigación / dueño |
|---|---|---|---|---|
| P0 | Trabajo de 12 días sin commit; ADR-171 a 212 y migraciones 93-116 fuera de git | Alta | Crítico | A1 en 48 h (developer) |
| P0 | Desfase migraciones 115/116 y runner bloqueado en 81 | Alta | Alto | A2 / ADR-211 (developer) |
| P0 | DR en 0% de 14 tareas con 3 pruebas cronometradas | Alta | Bloquea go-live | A4, G-2 |
| P0 | Pentest sin proveedor ni fecha; plazo típico 1-2 semanas + remediación | Alta | Bloquea go-live | G-1 antes del 2026-10-02 |
| P0 | UAT y marcha blanca sin fecha ni usuarios | Media | Bloquea go-live | G-4 |
| P1 | Solo 4 sensores reales con credencial de 81.050 filas; 1 regla de alarma | Alta | Go-live sin operación real | B1-B9, G-7 |
| P1 | `linear_settlement_cell`: posible error 10×-100× en asentamiento | Media | Decisiones operativas erróneas | B8, G-8 |
| P1 | Dependencia de un laptop con GPU para avatar/OCR/export extenso | Media | Capacidad y continuidad | G-6 |
| P1 | Canales WhatsApp/SMS no productivos | Alta | Alcance contractual parcial | G-3 |
| P2 | Métrica oficial no reflejaba SPEC-027 ni esfuerzo real | Baja | Credibilidad del reporte | **Mitigado por D1 cerrado**; G-13 mantiene aprobación gerencial |
| P2 | Regresiones por volumen de cambios sin cierre de trazabilidad en frontend (ReportStudio, ADR-172 a 209) | Media | Calidad | C5, suite 457/457 al último corte verificado, 2026-09-13 |
| P2 | Deuda de ADR-176 y `tasks.md` obsoletos | Media | Mantenibilidad | G-11, C5 |

### Escenarios de fecha

- **Base — go-live en S13 (2026-11-27), condicionado**: exige G-1 y G-2 firmados el 2026-10-02, pentest en S11, y DR completo en S12. Holgura de una semana: es un plan ajustado, no cómodo.
- **Contingencia (recomendada como plan B explícito)**: si G-1 no está firmado el 2026-10-09 o el simulacro DR falla en S12, mover el go-live una ventana posterior (propuesta: semana del 2026-12-07) y usar S13 para retest y marcha blanca ampliada. Es una recomendación de este análisis, no una decisión tomada.
- En ambos escenarios rige el criterio de que **ningún hallazgo crítico o alto del pentest puede quedar abierto**.

### Condiciones de go/no-go (todas obligatorias)
1. Pentest externo sin hallazgos críticos/altos abiertos (ADR-169, 8 criterios de cierre).
2. Simulacro DR cronometrado: RTO < 15 min y RPO acordado, ejecutado por operador distinto del autor (SPEC-015).
3. Restore automatizado exitoso en host limpio (SPEC-023 T9).
4. UAT firmado por usuarios operativos y acta de marcha blanca (G-4).
5. Rollback ensayado y documentado (SPEC-023 T10).
6. Migraciones al día y ledger verificable (ADR-211).
7. Todo el código y la documentación bajo control de versiones con etiqueta de release (A1).
8. Sensores reales inventariados y reglas de alarma mínimas configuradas por tenant (B1, B9).
9. `linear_settlement_cell` resuelta o excluida por escrito (G-8).
10. Cuentas y canales externos confirmados o excluidos del alcance por escrito (G-3).

## Consecuencias

### Positivas
- Una sola lista de decisiones con dueño y fecha; ningún pendiente queda "en silencio" (regla de SPEC-027).
- Gerencia puede leer estado, riesgo y fecha con tres cifras honestas y una regla de go/no-go objetiva.
- Los ADR abiertos dejan de acumular pendientes dispersos: los enlaza este registro.

### Negativas / trade-offs
- Las fechas límite propuestas (2026-10-02, 10-09, 10-16) son recomendaciones del análisis; requieren aceptación de Gerencia para ser compromisos.
- El plan asume capacidad equivalente a la de los últimos sprints; no se modeló ausencia de personas ni tiempos de proveedor externo.

## Alternativas descartadas
- **Declarar el go-live con lo actual**: R5 al 45,2% y sin DR/pentest/UAT no cumple los controles de salida del propio proyecto.
- **Inflar el avance por encima de 73,3%**: contradice el principio de ADR-090 y de `specs/BACKLOG.md` ("el porcentaje mide ejecución documentada, no aceptación productiva"). La fuente ejecutable vigente ya publica las tres lecturas gerenciales.
- **Reabrir Operaciones de Campo en este plan**: ADR-178 lo excluye explícitamente.

## Referencias
- ADR-035, 033, 043, 058, 090, 103, 110, 117, 119, 131, 137, 162, 168, 169, 170, 176, 178, 185, 189, 192, 194, 196, 198, 208, 210, 211.
- `specs/REGISTRY.md`, `specs/BACKLOG.md`, `specs/027-integracion-sensores-directo-gateway/tasks.md`, `scripts/generate_clickup_import.py`.

