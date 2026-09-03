#!/usr/bin/env python3
"""
simulate_calc_pipeline.py

Simulación de 1 hora (ver docs/decisions/136-telemetria-calculada-dashboard-simulacion.md):
mientras la telemetría real llega desde ThingsBoard (board.beemetry.com) y se sincroniza
a `telemetry_fact`, este script corre en paralelo y escribe métricas derivadas en
`telemetry_fact_calc` -- simulando, fuera del backend C++, el cálculo que en producción
haría un motor de fórmulas por tipo de sensor.

Fórmula usada: desviación de cada lectura respecto al promedio móvil de las 5 lecturas
anteriores del mismo sensor (`sensor_id_sk`), con nivel de alerta por umbral relativo:
  |valor - promedio_movil| > 30% de |promedio_movil| -> critical
  |valor - promedio_movil| > 15% de |promedio_movil| -> warning
  en otro caso                                       -> normal

Uso:
    python scripts/simulate_calc_pipeline.py --minutes 60 --interval-sec 20

No requiere dependencias de Python fuera de la stdlib: ejecuta `docker exec beemetry-db
psql` para cada ciclo (mismo patrón que scripts/generate_varied_telemetry.py).

NOTA (fix 2026-08-30): la primera version usaba un watermark sobre `captured_at`
(WHERE captured_at > ultimo_visto). Eso se traba cuando ThingsBoard entrega datos
historicos por backfill: muchas filas comparten el mismo `captured_at` exacto (ej.
sensores en grilla de 5 min), y la comparacion estricta '>' las excluye para siempre
en cuanto el watermark cae justo en ese valor. Se reemplaza por un anti-join acotado a
una ventana movil reciente (NOT EXISTS contra telemetry_fact_calc), idempotente via el
propio ON CONFLICT DO NOTHING de la tabla -- reprocesar la misma ventana en cada ciclo
es seguro y barato a esta escala.
"""
import argparse
import subprocess
import sys
import time
from datetime import datetime, timezone

DB_CONTAINER = "beemetry-db"
DB_USER = "sensors"
DB_NAME = "sensors_db"

# Ventana movil acotada: cuanto de telemetry_fact se re-examina por ciclo. No es un
# watermark estricto -- ver nota de arriba sobre por que se abandono ese enfoque.
WINDOW_HOURS = 3

CALC_SQL_TEMPLATE = """
INSERT INTO telemetry_fact_calc
    (tenant_id_sk, sensor_id_sk, metric_code, captured_at, value_numeric, quality_code, alert_level)
SELECT
    src.tenant_id_sk,
    src.sensor_id_sk,
    'deviation_moving_avg5',
    src.captured_at,
    src.value_numeric - src.mov_avg,
    src.quality_code,
    CASE
        WHEN src.mov_avg IS NULL THEN 'normal'
        WHEN ABS(src.value_numeric - src.mov_avg) > GREATEST(ABS(src.mov_avg) * 0.30, 0.001) THEN 'critical'
        WHEN ABS(src.value_numeric - src.mov_avg) > GREATEST(ABS(src.mov_avg) * 0.15, 0.001) THEN 'warning'
        ELSE 'normal'
    END
FROM (
    SELECT
        tenant_id_sk,
        sensor_id_sk,
        captured_at,
        value_numeric,
        quality_code,
        AVG(value_numeric) OVER (
            PARTITION BY sensor_id_sk ORDER BY captured_at
            ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
        ) AS mov_avg
    FROM telemetry_fact
    WHERE captured_at > now() - interval '{window_hours} hours'
) src
WHERE NOT EXISTS (
    SELECT 1 FROM telemetry_fact_calc c
    WHERE c.sensor_id_sk = src.sensor_id_sk
      AND c.metric_code = 'deviation_moving_avg5'
      AND c.captured_at = src.captured_at
)
ON CONFLICT (sensor_id_sk, metric_code, captured_at) DO NOTHING;
"""

ROWCOUNT_SQL = "SELECT count(*) FROM telemetry_fact_calc;"


def psql(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr.strip()}")
    return result.stdout.strip()


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minutes", type=int, default=60)
    parser.add_argument("--interval-sec", type=int, default=15)
    args = parser.parse_args()

    deadline = time.monotonic() + args.minutes * 60
    calc_sql = CALC_SQL_TEMPLATE.format(window_hours=WINDOW_HOURS)

    log(f"Arrancando calc-pipeline (ventana movil {WINDOW_HOURS}h, anti-join), corre {args.minutes} min")

    cycles = 0
    total_before = 0
    try:
        total_before = int(psql(ROWCOUNT_SQL))
    except Exception:
        pass

    while time.monotonic() < deadline:
        cycle_start = time.monotonic()
        try:
            psql(calc_sql)
            cycles += 1
            if cycles % 6 == 0:
                total_now = int(psql(ROWCOUNT_SQL))
                log(f"ciclo={cycles} filas_calc_total={total_now} (+{total_now - total_before})")
        except RuntimeError as exc:
            log(f"WARN ciclo={cycles} fallo: {exc}")
        except Exception as exc:  # noqa: BLE001
            log(f"WARN ciclo={cycles} error inesperado: {exc}")

        elapsed = time.monotonic() - cycle_start
        time.sleep(max(0.0, args.interval_sec - elapsed))

    try:
        total_after = int(psql(ROWCOUNT_SQL))
        log(f"Fin. ciclos={cycles} filas_calc_total={total_after} (+{total_after - total_before})")
    except Exception:
        log(f"Fin. ciclos={cycles}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
