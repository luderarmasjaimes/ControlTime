# PLAN 004 — Réplica de lectura y alta disponibilidad (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/004-replica-lectura-ha/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE3 (DBA/PG), SYS (infra), BE1 (C++ pool) |
| **Sprint·Release** | S10 · R5 (infraestructura, adelantado en R3 por necesidad) |
| **Constitución** | Art. 3 (aislamiento R/W), Art. 5 (observabilidad), Art. 9 (recursos) |
| **Última revisión** | 2026-06-24 (plan verificado — configuración replicación confirmada con docker-compose y código C++) |

---

## 1. Enfoque técnico

**PostgreSQL streaming replication (réplica física hot standby).** El primario aplica
WAL a disco y lo envía en tiempo real al standby vía protocolo de replicación binario.
El standby recibe y aplica el WAL antes de confirmarlo → **lag típico < 100 ms**
(medido: **0 bytes** en condiciones normales).

El aislamiento R/W no es solo un rol de BD: el standby **físicamente rechaza toda
escritura** (es un proceso en modo recovery). Esto hace que el Art. 3 sea imposible
de violar accidentalmente desde la réplica.

> Resultado medido en test de 1h: primario **25% CPU** (solo escritura de ingesta
> a 3.000/s); réplica **3-20% CPU** sirviendo 50 dashboards concurrentes.
> Sin réplica: primario al **620% CPU** con pérdida de 1,74M mensajes.

## 2. Topología

```
PostgreSQL PRIMARIO (db)
  ├── wal_level = replica
  ├── max_wal_senders = 10
  ├── max_replication_slots = 10
  ├── max_locks_per_transaction = 256  ← CRÍTICO: réplica debe coincidir
  └── slot: replica_slot (physical)
            │
            │ streaming WAL (protocolo binario, lag ~0 bytes)
            ▼
db_replica (PostgreSQL standby)
  ├── standby.signal
  ├── primary_conninfo = "host=db port=5432 user=replicator slot=replica_slot"
  ├── hot_standby = on              ← permite lecturas concurrentes
  ├── hot_standby_feedback = on     ← evita vacuum + query abortadas
  ├── max_locks_per_transaction = 256  ← DEBE COINCIDIR con primario
  └── Rol dashboard_ro: SELECT únicamente, statement_timeout=15s

Backend C++
  ├── DATABASE_URL          → primario (pool PgBouncer, escrituras)
  └── REPLICA_DATABASE_URL  → réplica (pool PgBouncer-replica, lecturas)
```

## 3. Configuración paso a paso

### 3.1 Primario (docker-compose.yml)

```yaml
db:
  image: timescale/timescaledb:latest-pg16
  command: >
    postgres
      -c wal_level=replica
      -c max_wal_senders=10
      -c max_replication_slots=10
      -c max_locks_per_transaction=256
      -c track_commit_timestamp=on
      -c hot_standby=on
  environment:
    POSTGRES_USER: aurixa
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_DB: aurixa_db
```

**Slot de replicación** (en `db_init/`):
```sql
SELECT pg_create_physical_replication_slot('replica_slot');
```

**Rol replicador** y **rol lectura** (en `db_init/`):
```sql
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATOR_PASSWORD}';
CREATE ROLE dashboard_ro WITH LOGIN PASSWORD '${DASHBOARD_RO_PASSWORD}';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
ALTER ROLE dashboard_ro SET statement_timeout = '15s';
```

### 3.2 Réplica (entrypoint + docker-compose)

```yaml
db_replica:
  image: timescale/timescaledb:latest-pg16
  depends_on: [db]
  environment:
    PGDATA: /var/lib/postgresql/data
    PRIMARY_HOST: db
    REPLICATION_USER: replicator
    REPLICATION_PASSWORD: ${REPLICATOR_PASSWORD}
  entrypoint:
    - /bin/bash
    - -c
    - |
      if [ ! -f "$PGDATA/PG_VERSION" ]; then
        pg_basebackup -h db -U replicator -D "$PGDATA" -Fp -Xs -P -R
      fi
      exec postgres \
        -c hot_standby=on \
        -c hot_standby_feedback=on \
        -c max_locks_per_transaction=256 \
        -c max_connections=400 \
        -c max_wal_size=4GB
  command: ""  # entrypoint sobreescribe command
```

La flag `-R` de `pg_basebackup` escribe `standby.signal` + `primary_conninfo`
automáticamente → la réplica inicia en modo standby al levantar.

### 3.3 PgBouncer réplica (pool de conexiones)

```ini
# pgbouncer_replica.ini
[databases]
aurixa_db = host=db_replica port=5432 dbname=aurixa_db user=dashboard_ro

[pgbouncer]
pool_mode = transaction
max_client_conn = 10000
default_pool_size = 20
server_reset_query = DISCARD ALL
```

### 3.4 Routing en el backend C++

```cpp
// kpi_service.cpp, sensor_service.cpp, surveillance_service.cpp
// — usan REPLICA_DATABASE_URL, no DATABASE_URL

const char* dsn = std::getenv("REPLICA_DATABASE_URL");
// pg_connect(dsn) → pool de réplica; solo SELECT
```

## 4. Problema conocido y solución (max_locks_per_transaction)

TimescaleDB usa muchos locks internos por hypertable (particiones temporales).
El valor por defecto de PostgreSQL es 64. Con TimescaleDB + hypertables pesados,
la réplica lanzaba:

```
FATAL: insufficient parameter settings for hot standby
DETAIL: max_locks_per_transaction is set to 64 on the standby
        but primary requires at least 256
```

**Solución:** la réplica debe tener **exactamente el mismo** (o mayor) valor que
el primario: `max_locks_per_transaction=256` en **ambos** contenedores.

## 5. Verificación de la réplica

```sql
-- En primario: verificar streaming activo y lag
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lsn - replay_lsn AS lag_bytes
FROM pg_stat_replication;
-- resultado esperado: lag_bytes = 0 (o < 1 MB en carga alta)

-- En réplica: confirmar hot standby
SELECT pg_is_in_recovery();   -- → true
SELECT pg_is_wal_receiver_up(); -- → true (PG16+)
```

## 6. Observabilidad (Art. 5)

| Métrica | Fuente | Alerta |
|---|---|---|
| `pg_stat_replication.lag_bytes` | primario | > 5 MB |
| `pg_wal_receiver_status.status` | réplica | != 'streaming' |
| CPU réplica | cAdvisor/node_exporter | > 80% |
| Slot `replica_slot` activo | `pg_replication_slots` | inactive > 5 min |

Exponer en `/api/metrics` (Prometheus) → alerta si réplica desconectada o lag alto.

## 7. Decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-004-1 | **Slot físico** (`replica_slot`) en vez de sin slot — garantiza que WAL no se elimina antes de que la réplica lo consuma | Aceptado |
| ADR-004-2 | `hot_standby_feedback=on` — la réplica informa al primario las transacciones en vuelo; evita vacuum killer | Aceptado |
| ADR-004-3 | `pg_basebackup -R` en entrypoint del contenedor — la réplica se auto-configura en primera arrancada | Aceptado |
| ADR-004-4 | `max_locks_per_transaction=256` **en ambos** — TimescaleDB hypertables lo requieren | Aceptado (lección aprendida) |
| ADR-004-5 | **PgBouncer independiente por rol** (primario y réplica con pools separados) | Propuesto |

## 8. Plan de pruebas (cada CA con evidencia)

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `pg_stat_replication.lag_bytes = 0` bajo ingesta plena | captura SQL adjunta |
| CA-2 | Escritura directa a réplica → rechazada | `ERROR: cannot execute INSERT in a read-only transaction` |
| CA-3 | Ingesta a 3.000/s + 50 dashboards 1h: CPU primario < 30% | reporte de esfuerzo |
| CA-4 | `pg_is_in_recovery() = true` en réplica | captura SQL |
| CA-5 | Parar réplica → ingesta sigue sin error | primario no depende de réplica |
| Alerta | Lag > 5 MB → alerta se dispara | captura de Prometheus/alertmanager |

## 9. Despliegue / rollback

- **Rollback:** apuntar `REPLICA_DATABASE_URL` al primario (degradado; Art. 3 no aplica, pero funcional).
- Scripts: `db_scripts/`, rol `dashboard_ro` en `db_init/`.
- Env: `REPLICA_DATABASE_URL=postgresql://dashboard_ro:…@db_replica:5432/aurixa_db`.

## 10. Costo / recursos (Art. 9)

- Réplica: 4 CPU / 4 GB RAM (mismo spec que primario; standby replica todo el estado).
- WAL extra por `wal_level=replica`: +10-15% vs minimal — aceptable.
- Slot físico retiene WAL si réplica se cae; monitorear `pg_replication_slots.active` + `wal_size`.
