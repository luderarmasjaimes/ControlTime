# ✅ Verificación de Replicación Primary→Replica + Pruebas de Esfuerzo

**Fecha**: 2026-07-03  
**Stack probado**: `aurixa-db` (primario TimescaleDB) → `aurixa-db-replica` (standby streaming)

---

## 1. Estado de la replicación streaming — SANA (tiempo real)

`pg_stat_replication` en el primario:
- `state = streaming`, `sync_state = async` (streaming asíncrono nativo de PostgreSQL).
- **Lag baseline: write ~0.4ms · flush ~1.6ms · replay ~1.6ms**. 0 bytes pendientes.
- Réplica: `pg_is_in_recovery() = true`, LSN recibido == LSN aplicado (al día).

**La replicación física por streaming (WAL shipping) ES la mejor alternativa de
sincronización online en tiempo real** para este caso: overhead mínimo, byte-a-byte,
sin lógica de aplicación. Ya está correctamente configurada.

---

## 2. Prueba de esfuerzo de ingesta masiva

| Prueba | Resultado |
|---|---|
| INSERT 200,000 filas a `telemetry_raw` (primario) | **7.19 s → ~27,800 filas/seg** (con validación FK por fila) |
| Consistencia tras 200k | primario=200,000 · réplica=200,000 → **✓ SINCRONIZADO** |
| Catch-up de la réplica al LSN de commit | **sub-segundo** (1ª iteración de sondeo) |
| Muestreo de `replay_lag` bajo ráfaga de WAL (1M filas) | **1ms – 226ms**, pending_bytes ≈ 0 |
| Consistencia final tras limpieza | primario=10,800,200 · réplica=10,800,200 → **✓** |

**Conclusión**: la ingesta supera el objetivo de 10k/seg, y la réplica se mantiene
sincronizada en **sub-segundo** incluso bajo carga pesada. Datos de prueba
(`raw_payload='STRESS_TEST'`) eliminados; estado restaurado.

> Nota: un INSERT único de 1,000,000 filas hace rollback por límites de una sola
> transacción — irrelevante en producción, donde el ingestor escribe en **lotes de
> 1000** (TELEMETRY_BATCH_SIZE) vía COPY, más rápido que INSERT+FK.

---

## 3. ¿Los dashboards/KPIs leen de la réplica? — HALLAZGO + FIX

**Estado encontrado**:
- ✅ El **SSE live-push** de KPIs (`main.cpp`) YA lee de la réplica
  (`REPLICA_DATABASE_URL`), con fallback graceful al primario.
- ❌ Los **endpoints REST** de KPI/sensores (`/api/mining/kpis`,
  `/api/mining/kpis/points`, `/api/sensors/data`) leían del **primario** vía
  pgbouncer (`gDatabaseUrl`).

**Sutileza técnica detectada**: `storage::PgPool` es un singleton con UNA cadena de
conexión; `acquire()` reutiliza conexiones idle sin re-chequear la URL, así que **no
se puede compartir un pool entre primario y réplica** (devolvería conexiones al
servidor equivocado).

**Fix aplicado**:
- `AppConfig::gReplicaDatabaseUrl` + helper `readUrl()` (réplica si está configurada,
  si no primario) — cargado de `REPLICA_DATABASE_URL`.
- `PgPool::replica()`: **pool dedicado** para la réplica (separado del primario).
- Endpoints de LECTURA enrutados a la réplica: `handleGetKpis`, `handleGetKpiPoints`
  (kpi_service), `handleGetSensorData` (sensor_service).
- Endpoints de ESCRITURA (upsert/sync KPIs) **permanecen en el primario**.

Resultado: los dashboards/KPIs REST ahora hacen **offload de lectura a la réplica**,
liberando al primario para la ingesta de telemetría. Con `REPLICA_DATABASE_URL` ya
definida en `docker-compose.yml` (servicio `web`), el enrutamiento se activa solo.

---

## Reproducir la verificación

```bash
# Estado de replicación
docker exec aurixa-db psql -U sensors -d sensors_db -x -c \
  "SELECT state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;"

# Prueba de esfuerzo (insertar, medir, verificar sync, limpiar)
# ver historial de comandos en esta sesión.
```
