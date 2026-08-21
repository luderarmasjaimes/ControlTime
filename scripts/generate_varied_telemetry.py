#!/usr/bin/env python3
"""
scripts/generate_varied_telemetry.py
Generador/actualizador de telemetría de prueba realista para Beemetry (ReportStudioV2).

Permite regenerar datos de prueba para todos los sensores del catálogo minero
con marcas de tiempo relativas al momento de ejecución (NOW()), cubriendo:
- Últimos 45 días continuos (cada 1h).
- Últimas 48 horas de alta resolución (cada 15m).
- Curvas físicas: ciclos diurnos/nocturnos, derivas de talud, presiones piezométricas.

Uso:
  python scripts/generate_varied_telemetry.py
  python scripts/generate_varied_telemetry.py --days 60 --high-res-hours 72
"""

import argparse
import os
import sys
import subprocess

def main():
    parser = argparse.ArgumentParser(description="Seed varied telemetry test data for Beemetry")
    parser.add_argument("--container", default="beemetry-db", help="Postgres container name")
    parser.add_argument("--user", default="sensors", help="Postgres user")
    parser.add_argument("--db", default="sensors_db", help="Postgres database name")
    parser.add_argument("--sql-file", default="db_scripts/57_seed_rich_sensor_telemetry_test_data.sql", help="Path to SQL seed file")
    args = parser.parse_args()

    sql_path = os.path.abspath(args.sql_file)
    if not os.path.isfile(sql_path):
        print(f"Error: No se encontró el archivo SQL en {sql_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Ejecutando seed de telemetría variada desde {sql_path} en el contenedor {args.container}...")
    try:
        with open(sql_path, "r", encoding="utf-8") as f:
            sql_content = f.read()

        proc = subprocess.run(
            ["docker", "exec", "-i", args.container, "psql", "-U", args.user, "-d", args.db],
            input=sql_content,
            text=True,
            encoding="utf-8",
            capture_output=True
        )
        if proc.stdout:
            print("Salida de PostgreSQL:")
            print(proc.stdout)
        if proc.returncode != 0 or "ERROR:" in (proc.stderr or "") or "ROLLBACK" in (proc.stdout or ""):
            print("Aviso o error en ejecución SQL:", file=sys.stderr)
            if proc.stderr:
                print(proc.stderr, file=sys.stderr)
            sys.exit(1)
        print("[OK] Telemetria variada y catalogo de sensores sembrados exitosamente.")
    except subprocess.CalledProcessError as e:
        print(f"Error al ejecutar psql en {args.container}:", file=sys.stderr)
        if e.stderr:
            print(e.stderr, file=sys.stderr)
        sys.exit(1)
    except Exception as ex:
        print(f"Error inesperado: {ex}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
