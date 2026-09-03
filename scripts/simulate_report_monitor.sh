#!/usr/bin/env bash
# simulate_report_monitor.sh
# Corre 10 ciclos de 6 minutos (60 min totales) e imprime un informe de estado
# por ciclo: ingesta real (telemetry_raw/telemetry_fact desde ThingsBoard),
# crecimiento de telemetry_fact_calc, lag de replicacion db_replica, y estado
# del contenedor de sync tb-sync-sim-1h. Cada bloque "=== INFORME" es un punto
# de notificacion para quien esta observando este proceso.
set -u

CYCLES="${1:-10}"
INTERVAL_SEC="${2:-360}"
DB=beemetry-db

run_sql() {
  docker exec "$DB" psql -U sensors -d sensors_db -t -A -c "$1" 2>&1
}

for i in $(seq 1 "$CYCLES"); do
  sleep "$INTERVAL_SEC"
  now_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  raw_6min=$(run_sql "SELECT count(*) FROM telemetry_raw tr JOIN sensors s ON s.sensor_id=tr.sensor_id WHERE s.external_id LIKE 'tb:%' AND tr.captured_at > now() - interval '${INTERVAL_SEC} seconds';")
  raw_total=$(run_sql "SELECT count(*) FROM telemetry_raw tr JOIN sensors s ON s.sensor_id=tr.sensor_id WHERE s.external_id LIKE 'tb:%' AND tr.captured_at > now() - interval '1 hour';")
  fact_6min=$(run_sql "SELECT count(*) FROM telemetry_fact WHERE captured_at > now() - interval '${INTERVAL_SEC} seconds';")
  calc_6min=$(run_sql "SELECT count(*) FROM telemetry_fact_calc WHERE captured_at > now() - interval '${INTERVAL_SEC} seconds';")
  calc_total=$(run_sql "SELECT count(*) FROM telemetry_fact_calc;")
  replica_lag=$(run_sql "SELECT COALESCE(string_agg(state || ' write=' || COALESCE(write_lag::text,'?') || ' replay=' || COALESCE(replay_lag::text,'?'), ' | '), 'sin filas en pg_stat_replication') FROM pg_stat_replication;")
  sync_errors=$(run_sql "SELECT count(*) FROM etl_sync_run WHERE peer_id NOT IN (SELECT peer_id FROM etl_sync_peer WHERE is_active) OR status = 'error';" )
  container_status=$(docker ps --filter name=tb-sync-sim-1h --format '{{.Status}}' 2>&1)

  cat <<EOF
=== INFORME ciclo $i/$CYCLES  ($now_utc) ===
tb-sync-sim-1h estado: ${container_status:-NO_ENCONTRADO}
telemetry_raw  (sensores tb:) ultimos ${INTERVAL_SEC}s: $raw_6min | ultima hora: $raw_total
telemetry_fact ultimos ${INTERVAL_SEC}s: $fact_6min
telemetry_fact_calc ultimos ${INTERVAL_SEC}s: $calc_6min | total acumulado: $calc_total
replicacion db_replica: $replica_lag
etl_sync_run con status=error (historico): $sync_errors
=== FIN INFORME $i/$CYCLES ===
EOF
done

echo "=== SIMULACION 1H COMPLETA ==="
