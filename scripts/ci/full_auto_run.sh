#!/usr/bin/env bash
set -euo pipefail

echo "== Auto full run: preflight, detect namespace, build, up, smoke, deploy =="

SCRIPTS_DIR="$(dirname "$0")"

echo "0) Run preflight checks"
"$SCRIPTS_DIR/preflight.sh"

echo "1) Detectando owner del repo y escribiendo .env"
"$SCRIPTS_DIR/auto_set_namespace.sh"

echo "2) Construyendo imágenes locales"
make build

echo "3) Levantando stack local"
make up

echo "Esperando servicios (15s)"
sleep 15

echo "4) Ejecutando smoke tests"
make smoke

echo "5) Desplegando producción (make deploy)"
make deploy

echo "== Auto run complete =="
