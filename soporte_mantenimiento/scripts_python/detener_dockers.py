# -*- coding: utf-8 -*-
"""
Detiene los contenedores de la plataforma AURIXA (docker compose down).
Conserva los volumenes de datos (no usa -v).

Ejecutar con doble clic desde PANEL_SCRIPTS.hta, o:
  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\detener_dockers.py
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    print("=" * 60)
    print(" AURIXA - DETENER PLATAFORMA (docker compose down)")
    print("=" * 60)
    try:
        if subprocess.run(["docker", "info"], cwd=ROOT,
                          stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode != 0:
            print("[!] Docker daemon no esta activo; no hay nada que detener.")
            return 0
    except Exception:
        print("[!] Docker no disponible.")
        return 1
    print("\n[..] Deteniendo servicios (los datos en volumenes se conservan)...\n")
    rc = subprocess.run(["docker", "compose", "down"], cwd=ROOT).returncode
    print("\n[OK] Plataforma detenida." if rc == 0 else f"\n[ERROR] codigo {rc}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
