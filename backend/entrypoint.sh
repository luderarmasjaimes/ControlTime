#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CARTOON_ONNX_MODEL:-}" ]]; then
  if [[ -f "${CARTOON_ONNX_MODEL}" ]]; then
    sz=$(stat -c%s "${CARTOON_ONNX_MODEL}" 2>/dev/null || wc -c < "${CARTOON_ONNX_MODEL}")
    echo "[entrypoint] Cartoon ONNX: ${CARTOON_ONNX_MODEL} (${sz} bytes)"
  else
    echo "[entrypoint] WARN: CARTOON_ONNX_MODEL no es archivo: ${CARTOON_ONNX_MODEL}"
  fi
fi
if command -v ldconfig >/dev/null 2>&1; then
  ldconfig || true
fi

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
