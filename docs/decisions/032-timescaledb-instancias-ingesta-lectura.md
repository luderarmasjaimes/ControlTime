# ADR-032 — TimescaleDB: separación de instancias ingesta (primaria) vs lectura/reportes (réplica)

**Status**: implemented (verificado 2026-07-06: `db_replica` con streaming replication real vía `pg_basebackup` + `hot_standby=on`; backend usa `REPLICA_DATABASE_URL` para lecturas y `pgbouncer` para escrituras)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: datos

## Contexto

`sensors_db` (ADR-005) atiende dos cargas opuestas sobre la misma data: **escritura de alta tasa** (ingesta de telemetría, ADR-007/008) y **lectura analítica pesada** (dashboards en vivo, KPIs sobre continuous aggregates, consultas para informes). Si ambas viven en una sola instancia, las consultas de lectura (un reporte que barre histórico, un dashboard que recalcula) **compiten con la ingesta** y ponen en riesgo tanto el throughput de escritura como la latencia de lectura. Además, una sola instancia es un único punto de falla para la telemetría.

## Decisión

`sensors_db` se despliega en **dos instancias TimescaleDB sincronizadas por streaming replication de PostgreSQL**:

- **Primaria (read-write)** — dedicada a la **ingesta**: recibe las escrituras del gateway/consumidor (ADR-007/008). Es la única que acepta writes.
- **Réplica (read-only)** — dedicada a **lectura/reportes/analítica**: dashboards en vivo, KPIs, continuous aggregates y consultas de informes leen de acá. No acepta writes.

Ambas se mantienen en sincronía por replicación en streaming; la réplica está en consistencia eventual (lag de replicación pequeño).

### Reglas duras
- Toda **escritura** de telemetría va a la **primaria**; ninguna ruta de ingesta escribe en la réplica.
- Todo **dashboard/reporte/analítica** lee de la **réplica**; el gateway enruta lecturas a la réplica y escrituras a la primaria (pools separados, ADR-005).
- La réplica es **read-only** a nivel de servidor (no solo por convención) para evitar escrituras accidentales.
- Los snapshots de widgets (ADR-012) toleran el lag de replicación: un informe cita el valor leído de la réplica con su `capturedAt`; la consistencia eventual es aceptable porque el snapshot es explícito.

### Tecnología de replicación (etapa actual vs futuro)

- **Etapa actual (v0.1 / Etapa 1-2)**: la sincronización usa la **replicación nativa de streaming de PostgreSQL** (la que provee TimescaleDB), sin componentes extra. Es lo probado, suficiente y de menor riesgo operativo.
- **Futuro (gateado por métricas)**: **según demanda o análisis de métricas de BD** (lag de replicación, throughput, contención), se podría optimizar la replicación con un **middleware nativo en C++**. No es trabajo de v0.1 ni se asume hasta que las métricas lo justifiquen; sería un ADR superseding propio.

## Consecuencias

### Positivas
- Aísla la carga de lectura de la ingesta: protege el SLA de escritura (10k, ADR-008) y la latencia de dashboard.
- Escala lecturas (se pueden agregar más réplicas si hace falta).
- La réplica funciona además como **warm standby** para DR/failover (apoya el objetivo de continuidad de Etapa 2).

### Negativas / Trade-offs
- **Consistencia eventual** en lecturas: un reporte puede ver datos con unos segundos de lag — aceptable y explícito (snapshots con timestamp).
- Más infraestructura a operar (replicación, monitoreo de lag, procedimiento de failover) — cubierto por SYS/BE3 en hardening.

### Neutras
- Es replicación estándar de PostgreSQL; no ata a tecnología propietaria.
- En entornos chicos (dev) puede correr una sola instancia; la separación es de producción.

## Alternativas descartadas

### Una sola instancia para todo
Más simple, pero las lecturas pesadas de reportes compiten con la ingesta y arriesgan ambos SLAs; además es SPOF de telemetría. Rechazada para producción.

### Solo OLAP aparte (Parquet/DuckDB) sin réplica
El archivado frío a Parquet (ADR-009) cubre analítica histórica, pero no las lecturas calientes de dashboards/reportes sobre datos recientes. La réplica es necesaria para esa ventana caliente.

### Replicación lógica de un subconjunto
Más flexible (replicar solo ciertas tablas), pero más compleja de operar y mantener consistente; streaming replication física de toda la instancia es más simple y robusto para este caso.

## Referencias
- ADR-005 (dos DBs + pools separados), ADR-006 (hypertables/retención), ADR-007/008 (ingesta), ADR-009 (Parquet/MinIO), ADR-012 (snapshot tolera lag), ADR-016 (export lee de réplica)
- `plan.md` § 7 (convenciones operativas — detalle de replicación/failover en runbooks)
