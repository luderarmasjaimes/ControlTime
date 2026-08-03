# TASKS 015 — DR, respaldo geográfico y continuidad

| Campo | Valor |
|---|---|
| **Plan** | `specs/015-dr-respaldo-continuidad/plan.md` |
| **Sprint·Release** | S10 · R5 |
| **Responsables** | BE3 (DBA/recovery), SYS (infra/DRP), ARQ (gate), QA |
| **Última revisión** | 2026-06-24 (plan y tasks revisados — todo ☐ pendiente, Sprint S10) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Activar WAL archiving en primario (`archive_mode`, `archive_command` → MinIO) | CA-1,CA-3 | BE3 | Sonnet | ☐ |
| **T2** | Configurar **pgBackRest** (stanza, base backups, retención, cifrado) | CA-1 | BE3 | **Opus** (PITR delicado) | ☐ |
| **T3** | Bucket `db-backups` en MinIO + versionado | CA-1,CA-5 | SYS | Haiku | ☐ |
| **T4** | Procedimiento de **promoción** de `db_replica` (pg_promote + reenrutado) | CA-2 | BE3+SYS | **Opus** | ☐ |
| **T5** | **Fencing** del primario antes de promover (anti split-brain) | CA-2 | SYS | **Opus** | ☐ |
| **T6** | Reenrutado de la app al nuevo primario (pgbouncer/DATABASE_URL) | CA-2 | BE1/SYS | Sonnet | ☐ |
| **T7** | Reanudación del consumidor Redpanda tras failover (replay) | CA-3 | BE1 | **Opus** | ☐ |
| **T8** | Replicación geográfica de backups + objetos (mc mirror/rclone, cifrado) | CA-5 | SYS | Sonnet | ☐ |
| **T9** | Métricas/alertas: lag réplica, edad de backup, estado de slot, WAL archiving | CA-6 | SYS+BE3 | Sonnet | ☐ |
| **T10** | **Runbook DR** (Escenario A y B) en `docs/09_Manuales_Operativos/` | CA-4 | BE3+ARQ | ChatGPT/Haiku | ☐ |
| **T11** | Restore de verificación automatizado (cron) | CA-1 | BE3 | Sonnet | ☐ |
| **T12** | **Simulacro DR cronometrado** (matar primario → < 15 min) | CA-2,CA-3 | QA+SYS+BE3 | — | ☐ |
| **T13** | Ejecución del runbook por operador distinto al autor | CA-4 | SYS (otro) | — | ☐ |
| **T14** | Prueba negativa controlada de split-brain (validar fencing) | CA-2 | QA | Sonnet | ☐ |

## Secuencia (dependencias)
```
T1 ─► T2 ─► T3 ─► T11        (PITR: archiving → backup → bucket → verificación)
T4 ─► T5 ─► T6 ─► T7         (failover: promover → fencing → reenrutar → replay)
T8, T9, T10 en paralelo
(todo) ─► T12 (simulacro) ─► T13 (otro operador) ─► T14 (prueba split-brain)
```

## Definition of Done (feature 015)
- [ ] T1-T14 cerradas y enlazadas a evidencia.
- [ ] **Cada CA demostrado:**
  - [ ] CA-1 restore probado (entorno limpio)
  - [ ] CA-2 **simulacro DR < 15 min** (cronómetro adjunto)
  - [ ] CA-3 pérdida ≈ 0 (RPO) con replay Redpanda
  - [ ] CA-4 runbook ejecutado por otro operador
  - [ ] CA-5 backups presentes y restaurables en sitio secundario
  - [ ] CA-6 alertas funcionando
- [ ] ADR-015-1..5 registrados.
- [ ] Sin violar Constitución (Art. 2, 5, 9).
- [ ] Gate R5 (ARQ + Gerencia TI): evidencia de DR + carga + pentest.

## Métricas de éxito (KPIs SOW)
| KPI | Meta | Cómo se mide en T12 |
|---|---|---|
| RTO | < 15 min | cronómetro del simulacro |
| RPO | ≈ 0 | conteo pre/post failover + offsets Kafka |
| Uptime | > 99.9% (O5) | proyección anual con RTO/frecuencia |
