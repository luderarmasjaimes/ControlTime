# TASKS 004 — Réplica de lectura y alta disponibilidad

| Campo | Valor |
|---|---|
| **Plan** | `specs/004-replica-lectura-ha/plan.md` |
| **Sprint·Release** | S10 · R5 (adelantado en R3) |
| **Responsables** | BE3 (DBA/PG), SYS (infra/Docker), BE1 (C++ pool), QA |
| **Última revisión** | 2026-06-24 (auditado contra `docker-compose.yml`, `kpi_service.cpp`, `sensor_service.cpp`) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Configurar primario: `wal_level=replica`, `max_wal_senders=10`, `max_replication_slots=10` | CA-4 | BE3 | Sonnet | ☑ |
| **T2** | Crear slot físico `replica_slot` en primario (`pg_create_physical_replication_slot`) | CA-1,CA-4 | BE3 | Sonnet | ☑ |
| **T3** | Crear rol `replicator` con `REPLICATION LOGIN` | CA-4 | BE3 | Haiku | ☑ |
| **T4** | Crear rol `dashboard_ro` (`SELECT`, `statement_timeout=15s`, grants en CAGG) | CA-2,CA-3 | BE3 | Sonnet | ☑ |
| **T5** | Entrypoint `db_replica`: `pg_basebackup -R` en primera arrancada | CA-4 | SYS | **Opus** (primario/standby) | ☑ |
| **T6** | Configurar réplica: `hot_standby=on`, `hot_standby_feedback=on`, `max_locks_per_transaction=256` | CA-1,CA-4 | SYS | **Opus** (lección aprendida) | ☑ |
| **T7** | Env `REPLICA_DATABASE_URL` en backend C++ (todos los servicios de lectura) | CA-2 | BE1 | Sonnet | ☑ |
| **T8** | PgBouncer para réplica (transaction pooling, `max_client_conn=10000`) | CA-2 | SYS | Sonnet | ☐ |
| **T9** | **Test CA-1**: `pg_stat_replication.lag_bytes = 0` bajo ingesta plena | CA-1 | QA | — | ☑ |
| **T10** | **Test CA-2**: escritura directa a réplica → `ERROR: read-only transaction` | CA-2 | QA | — | ☑ |
| **T11** | **Test CA-3**: 50 dashboards 1h + ingesta 3k/s → CPU primario < 30%, 0 errores | CA-3 | QA | — | ☑ |
| **T12** | **Test CA-4**: `pg_is_in_recovery() = true` en réplica | CA-4 | QA | — | ☑ |
| **T13** | **Test CA-5**: parar réplica → ingesta continúa sin error en primario | CA-5 | QA | — | ☑ |
| **T14** | Métricas: `pg_stat_replication` + `pg_replication_slots` → Prometheus scrape | Art.5 | BE3+SYS | Sonnet | ☐ |
| **T15** | Alerta: lag > 5 MB → notificación (Alertmanager/Grafana) | Art.5 | SYS | Sonnet | ☐ |
| **T16** | Alerta: `slot.active = false` → notificación (slot inactivo acumula WAL) | Art.5 | SYS | Sonnet | ☐ |
| **T17** | Documentar `max_locks_per_transaction=256` en runbook (lección aprendida) | Art.8 | BE3 | Haiku | ☑ |
| **T18** | PgBouncer para primario (transaction pooling, escrituras) | Art.9 | SYS | Sonnet | ☑ |

> **Actualización 2026-08-30**: T18 verificado — `docker-compose.yml` servicio
> `pgbouncer` (`beemetry-pgbouncer`, imagen `edoburu/pgbouncer:v1.23.1-p3`,
> `DB_HOST=db` → primario) con `POOL_MODE=transaction` y
> `MAX_CLIENT_CONN=10000`, exactamente los parámetros que pedía la tarea.
> Confirmado en vivo: el backend real se conecta a través de él
> (`beemetry-api` usa `host=pgbouncer` en su cadena de conexión primaria,
> contenedor `beemetry-pgbouncer` corriendo y healthy). **T8 sigue
> pendiente**: no existe un PgBouncer equivalente delante de la réplica —
> `BEEMETRY_REPLICA_DATABASE_URL` (línea 722 de `docker-compose.yml`)
> conecta directo a `db_replica:5432`, sin pooler. T14-T16 (métricas/alertas
> Prometheus/Grafana/Alertmanager) también siguen pendientes — no existe
> ningún contenedor de esa familia en el stack actual, verificado por
> `docker ps -a`.

> **Nota:** T1-T7, T9-T13, T17 completadas en sesión 2026-06 (réplica funcional,
> lag=0 verificado, aislamiento R/W físico probado). T8, T14-T16, T18 pendientes.

## Secuencia (dependencias)

```
T1 ─► T2 ─► T3 ─► T5 ─► T6       (primario configurado → réplica levantada)
T4                                  (rol dashboard_ro, independiente)
T5 + T6 + T4 ─► T7                 (réplica lista → routing en backend)
T7 ─► T9 ─► T10 ─► T11 ─► T12 ─► T13   (tests secuenciales)
T8, T18 (PgBouncer) en paralelo
T14 ─► T15 ─► T16 (métricas → alertas)
T17 (docs, puede hacerse en paralelo)
```

## Definition of Done (feature 004)

- [x] T1-T7, T9-T13, T17 completadas y enlazadas a commits.
- [x] **CA demostrados:**
  - [x] CA-1 `lag_bytes=0` bajo ingesta plena
  - [x] CA-2 escritura en réplica rechazada físicamente
  - [x] CA-3 CPU primario 25% con 50 dashboards (réplica los absorbe)
  - [x] CA-4 `pg_is_in_recovery()=true`
  - [x] CA-5 ingesta continúa con réplica parada
- [x] T18 PgBouncer primario (transaction pooling, `MAX_CLIENT_CONN=10000`) — verificado 2026-08-30, ver actualización arriba
- [ ] T8 PgBouncer réplica — **pendiente** (`REPLICA_DATABASE_URL` conecta directo, sin pooler)
- [ ] Métricas/alertas (T14-T16) — **pendientes**, sin stack Prometheus/Grafana/Alertmanager en el compose actual
- [ ] ADR-004-1..5 registrados.
- [ ] Sin violar Constitución (Art. 3, 5, 9).
- [ ] Gate R5: evidencia de lag=0 + aislamiento + carga 1h.

## Métricas de éxito (KPIs SOW)

| KPI | Meta | Medido |
|---|---|---|
| Lag réplica bajo ingesta plena | < 1 MB | **0 bytes** |
| CPU primario con 50 dashboards | < 30% | **25%** |
| CPU réplica con 50 dashboards | < 80% | **3-20%** |
| Uptime primario (réplica caída) | 100% ingesta | **100%** |
| Escritura bloqueada en réplica | `ERROR` físico | **confirmado** |

## Evidencias de implementación (retroactivas)

- `docker-compose.yml`: servicio `db_replica` con entrypoint `pg_basebackup -R`
- `docker-compose.yml`: `max_locks_per_transaction=256` en ambos servicios
- `backend/src/mining/kpi_service.cpp`: usa `REPLICA_DATABASE_URL`
- `backend/src/mining/sensor_service.cpp`: usa `REPLICA_DATABASE_URL`
- `backend/src/mining/surveillance_service.cpp`: usa `REPLICA_DATABASE_URL`
- Test 1h: lag=0, primario 25% CPU, réplica 3-20% CPU (2026-06)
- Fix documentado: `max_locks_per_transaction` (lección aprendida → ADR-004-4)
