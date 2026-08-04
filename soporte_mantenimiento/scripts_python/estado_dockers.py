# -*- coding: utf-8 -*-
"""
Muestra el ESTADO de los contenedores de la plataforma AURIXA.

Ejecutar con doble clic desde PANEL_SCRIPTS.hta, o:
  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\estado_dockers.py
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def daemon_ok():
    try:
        return subprocess.run(["docker", "info"], cwd=ROOT,
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL).returncode == 0
    except Exception:
        return False


def main():
    print("=" * 60)
    print(" AURIXA - ESTADO DE CONTENEDORES")
    print("=" * 60)
    if not daemon_ok():
        print("[!] Docker daemon no esta activo. Ejecuta 'levantar_dockers.py' primero.")
        return 1
    print("\n>> Servicios AURIXA (docker compose ps)\n")
    subprocess.run(["docker", "compose", "ps"], cwd=ROOT)
    # IDs SOLO del proyecto compose AURIXA (no otros stacks del host)
    ids = subprocess.run(["docker", "compose", "ps", "-q"], cwd=ROOT,
                         capture_output=True, text=True).stdout.split()
    if not ids:
        print("\n[!] No hay contenedores AURIXA en ejecucion.")
        return 0
    print("\n>> Uso de recursos SOLO AURIXA (docker stats):\n")
    subprocess.run(["docker", "stats", "--no-stream",
                    "--format", "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}",
                    *ids], cwd=ROOT)
    # Resumen salud
    fmt = "{{.Service}}|{{.Health}}|{{.State}}"
    ps = subprocess.run(["docker", "compose", "ps", "--format", fmt],
                        cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()
    total = len(ps)
    healthy = sum(1 for l in ps if "healthy" in l.lower())
    print(f"\n>> SALUD: {healthy}/{total} servicios healthy",
          "-> PLATAFORMA 100% OPERATIVA" if healthy == total and total else "-> REVISAR")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
