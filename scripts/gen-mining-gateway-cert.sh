#!/usr/bin/env bash
# Regenera el par cert/key self-signed para el mining gateway TLS (puerto
# 8443, backend/src/main.cpp). El original quedó expuesto en el historial de
# git (certs/server.key trackeado hasta el hardening de 2026-07-10) — cualquier
# par generado antes de esa fecha debe considerarse comprometido.
#
# Uso: ./scripts/gen-mining-gateway-cert.sh [CN]
set -euo pipefail

CN="${1:-mining-gateway.local}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
mkdir -p "$OUT_DIR"

# MSYS_NO_PATHCONV=1: en Git Bash/MSYS (Windows), el argumento "/CN=..." se
# interpreta como una ruta y se reescribe a "C:/Program Files/Git/CN=..." —
# openssl entonces falla al parsear el subject. El fallo es especialmente
# traicionero porque `-keyout` YA escribió la clave nueva antes de abortar: el
# par queda desparejado (clave nueva, certificado viejo) y el gateway TLS deja
# de negociar. En Linux/macOS la variable no tiene ningún efecto.
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "$OUT_DIR/server.key" -out "$OUT_DIR/server.crt" \
  -days 365 -subj "/CN=${CN}"

# Comprobación explícita de que cert y clave son el mismo par: si el comando de
# arriba fallara a medias, esto lo detecta aquí y no en producción.
_key_pub="$(openssl rsa -in "$OUT_DIR/server.key" -pubout 2>/dev/null | openssl sha256)"
_crt_pub="$(openssl x509 -in "$OUT_DIR/server.crt" -noout -pubkey | openssl sha256)"
if [ "$_key_pub" != "$_crt_pub" ]; then
  echo "[gen-mining-gateway-cert] ERROR: la clave y el certificado no son el mismo par." >&2
  exit 1
fi

chmod 600 "$OUT_DIR/server.key"
echo "[gen-mining-gateway-cert] Nuevo par generado en $OUT_DIR (CN=${CN}, 365 días)."
echo "[gen-mining-gateway-cert] Reiniciar el servicio web para que tome el cert nuevo:"
echo "  docker compose up -d --force-recreate web"
