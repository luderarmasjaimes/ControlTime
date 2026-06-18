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
    print("\n>> docker compose ps\n")
    subprocess.run(["docker", "compose", "ps"], cwd=ROOT)
    print("\n>> Uso de recursos (docker stats, instantanea):\n")
    subprocess.run(["docker", "stats", "--no-stream",
                    "--format", "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
                   cwd=ROOT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
