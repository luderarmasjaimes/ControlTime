#!/usr/bin/env bash
set -euo pipefail

SDK_DIR="${DERMALOG_SDK_DIR:-/opt/dermalog-sdk}"

if [[ -d "${SDK_DIR}" ]]; then
  shopt -s nullglob
  debs=("${SDK_DIR}"/*.deb)
  shopt -u nullglob

  if (( ${#debs[@]} > 0 )); then
    echo "[entrypoint] Installing Dermalog SDK packages from ${SDK_DIR}"
    apt-get update
    apt-get install -y --no-install-recommends "${debs[@]}"
    rm -rf /var/lib/apt/lists/*
    ldconfig || true
  fi
fi

exec /app/build/mapas_backend
