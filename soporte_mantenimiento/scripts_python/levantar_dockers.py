# -*- coding: utf-8 -*-
"""
Levanta TODOS los contenedores de la plataforma AURIXA (docker compose up -d).

- Verifica el daemon de Docker; si Docker Desktop no esta corriendo, intenta iniciarlo
  y espera hasta que responda.
- Construye imagenes que falten y levanta los 8 servicios en segundo plano.
- Muestra el estado final.

Pensado para ejecutarse con doble clic desde PANEL_SCRIPTS.hta, o:
  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\levantar_dockers.py
"""
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCKER_DESKTOP_PATHS = [
    r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
    r"C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe",
]


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, **kw)


def daemon_ok():
    try:
        r = subprocess.run(["docker", "info"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return r.returncode == 0
    except Exception:
        return False


def ensure_daemon(timeout=180):
    if daemon_ok():
        print("[OK] Docker daemon ya esta activo.")
        return True
    print("[..] Docker daemon no responde. Intentando iniciar Docker Desktop...")
    for p in DOCKER_DESKTOP_PATHS:
        if os.path.exists(p):
            try:
                subprocess.Popen([p])
                print(f"[..] Lanzado: {p}")
                break
            except Exception as e:
                print(f"[!] No se pudo lanzar {p}: {e}")
    else:
        print("[!] No se encontro Docker Desktop. Inicialo manualmente y reintenta.")
    print(f"[..] Esperando al daemon (hasta {timeout}s)", end="", flush=True)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if daemon_ok():
            print("\n[OK] Docker daemon activo.")
            return True
        print(".", end="", flush=True)
        time.sleep(4)
    print("\n[ERROR] El daemon no respondio a tiempo.")
    return False


def main():
    print("=" * 60)
    print(" AURIXA - LEVANTAR PLATAFORMA (docker compose up -d)")
    print("=" * 60)
    if not shutil.which("docker"):
        print("[ERROR] 'docker' no esta en el PATH.")
        return 1
    if not ensure_daemon():
        return 2
    print("\n[..] Levantando servicios (construye imagenes que falten)...\n")
    rc = run(["docker", "compose", "up", "-d"]).returncode
    if rc != 0:
        print(f"\n[ERROR] docker compose up devolvio codigo {rc}.")
        return rc
    print("\n[OK] Servicios levantados. Estado actual:\n")
    run(["docker", "compose", "ps"])
    print("\nAccesos rapidos:")
    print("  Frontend:        http://localhost:5173")
    print("  Backend/API:     http://localhost:8082")
    print("  Tileserver GIS:  http://localhost:8000/services")
    print("  Formula engine:  http://localhost:18020/api/catalogos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
