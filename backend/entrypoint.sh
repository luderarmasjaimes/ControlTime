#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${BEEMETRY_API_KEYS:-}" ]]; then
  echo "[entrypoint] API Keys configured"
fi

if [[ -n "${BEEMETRY_CARTOON_ONNX_MODEL:-}" ]]; then
  if [[ -f "${BEEMETRY_CARTOON_ONNX_MODEL}" ]]; then
    sz=$(stat -c%s "${BEEMETRY_CARTOON_ONNX_MODEL}" 2>/dev/null || wc -c < "${BEEMETRY_CARTOON_ONNX_MODEL}")
    echo "[entrypoint] Cartoon ONNX: ${BEEMETRY_CARTOON_ONNX_MODEL} (${sz} bytes)"
  else
    echo "[entrypoint] WARN: BEEMETRY_CARTOON_ONNX_MODEL no es archivo: ${BEEMETRY_CARTOON_ONNX_MODEL}"
  fi
fi
if command -v ldconfig >/dev/null 2>&1; then
  ldconfig || true
fi

SDK_DIR="${BEEMETRY_DERMALOG_SDK_DIR:-/opt/dermalog-sdk}"

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

echo "[entrypoint] Starting beemetry_backend"
exec /app/build/beemetry_backend
