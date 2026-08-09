#!/usr/bin/env bash
# ==========================================================================
# deploy-mining-gateway-cert.sh — Despliega el par TLS del mining gateway
#   (puerto 8443) en la VPS y recrea el servicio.
#
# EJECUTAR POR SSH EN LA VPS, desde la raíz del repo desplegado.
#
# Por qué un script y no tres comandos sueltos: rotar este certificado es
# irreversible en la práctica (los sensores externos que lo tengan fijado
# dejan de conectar) y a mitad de camino deja el gateway sin TLS válido. El
# script comprueba ANTES de tocar nada que el par es coherente, guarda el
# anterior para poder revertir, y VERIFICA después que el 8443 está sirviendo
# de verdad el certificado nuevo — que es el paso que se suele olvidar y por
# el que uno se entera del fallo cuando llama el cliente.
#
# Uso:
#   ./scripts/deploy-mining-gateway-cert.sh            # despliega y verifica
#   ./scripts/deploy-mining-gateway-cert.sh --check    # solo diagnostica
#   ./scripts/deploy-mining-gateway-cert.sh --rollback # vuelve al backup
# ==========================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$REPO_ROOT/certs"
BACKUP_DIR="$REPO_ROOT/tmp/cert-backup-$(date +%Y%m%d-%H%M%S)"
SERVICE="web"
GATEWAY_PORT="${BEEMETRY_GATEWAY_PORT:-8443}"

log()  { printf '[cert-deploy] %s\n' "$*"; }
fail() { printf '[cert-deploy] ERROR: %s\n' "$*" >&2; exit 1; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# ── Comprobaciones previas ────────────────────────────────────────────────
check_pair() {
  [ -f "$CERT_DIR/server.key" ] || fail "falta $CERT_DIR/server.key"
  [ -f "$CERT_DIR/server.crt" ] || fail "falta $CERT_DIR/server.crt"

  local key_pub crt_pub
  key_pub="$(openssl rsa -in "$CERT_DIR/server.key" -pubout 2>/dev/null | openssl sha256)" \
    || fail "no se pudo leer la clave privada (¿corrupta o cifrada?)"
  crt_pub="$(openssl x509 -in "$CERT_DIR/server.crt" -noout -pubkey | openssl sha256)" \
    || fail "no se pudo leer el certificado"

  if [ "$key_pub" != "$crt_pub" ]; then
    fail "la clave y el certificado NO son el mismo par — no se despliega nada.
       Regenerar con: ./scripts/gen-mining-gateway-cert.sh"
  fi

  local subject notafter
  subject="$(openssl x509 -in "$CERT_DIR/server.crt" -noout -subject)"
  notafter="$(openssl x509 -in "$CERT_DIR/server.crt" -noout -enddate)"
  log "par coherente — $subject / $notafter"

  # Aviso si ya está caducado o le queda menos de 30 días.
  if ! openssl x509 -in "$CERT_DIR/server.crt" -noout -checkend 0 >/dev/null; then
    fail "el certificado ya está CADUCADO; regenerarlo antes de desplegar"
  fi
  if ! openssl x509 -in "$CERT_DIR/server.crt" -noout -checkend 2592000 >/dev/null; then
    log "AVISO: caduca en menos de 30 días."
  fi
}

# Huella del cert que está sirviendo AHORA el puerto 8443 (cadena vacía si no responde).
live_fingerprint() {
  echo | timeout 10 openssl s_client -connect "127.0.0.1:${GATEWAY_PORT}" 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
    | sed 's/.*=//' || true
}

file_fingerprint() {
  openssl x509 -in "$CERT_DIR/server.crt" -noout -fingerprint -sha256 | sed 's/.*=//'
}

# ── Modos ─────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--check" ]; then
  check_pair
  log "huella en disco : $(file_fingerprint)"
  log "huella en :$GATEWAY_PORT : $(live_fingerprint || echo '(sin respuesta)')"
  exit 0
fi

if [ "${1:-}" = "--rollback" ]; then
  latest="$(ls -1d "$REPO_ROOT"/tmp/cert-backup-* 2>/dev/null | tail -1)"
  [ -n "$latest" ] || fail "no hay backups en $REPO_ROOT/tmp/"
  log "restaurando desde $latest"
  cp "$latest/server.key" "$latest/server.crt" "$CERT_DIR/"
  chmod 600 "$CERT_DIR/server.key"
  compose up -d --force-recreate "$SERVICE"
  log "rollback hecho. Verificar con --check."
  exit 0
fi

# ── Despliegue ────────────────────────────────────────────────────────────
check_pair

before="$(live_fingerprint)"
target="$(file_fingerprint)"
log "huella actual en :$GATEWAY_PORT : ${before:-(sin respuesta)}"
log "huella a desplegar             : $target"

if [ -n "$before" ] && [ "$before" = "$target" ]; then
  log "el gateway YA sirve este certificado. Nada que hacer."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
cp "$CERT_DIR/server.key" "$CERT_DIR/server.crt" "$BACKUP_DIR/" 2>/dev/null || true
log "backup del par anterior en $BACKUP_DIR"

chmod 600 "$CERT_DIR/server.key"

log "recreando el servicio '$SERVICE'..."
compose up -d --force-recreate "$SERVICE"

# Esperar a que el gateway vuelva a negociar TLS (arranque + carga del cert).
log "esperando a que :$GATEWAY_PORT responda..."
after=""
for _ in $(seq 1 30); do
  after="$(live_fingerprint)"
  [ -n "$after" ] && break
  sleep 2
done

if [ -z "$after" ]; then
  fail "el puerto $GATEWAY_PORT no responde tras recrear el servicio.
       Revisar: compose logs --tail=100 $SERVICE
       Revertir: ./scripts/deploy-mining-gateway-cert.sh --rollback"
fi

if [ "$after" != "$target" ]; then
  fail "el gateway responde pero sirve OTRA huella ($after).
       El proceso puede no haber releído el cert. Revertir con --rollback."
fi

log "OK — :$GATEWAY_PORT sirve el certificado nuevo ($after)."
log ""
log "PENDIENTE MANUAL: los sensores/gateways externos que fijen (pin) el"
log "certificado anterior dejarán de conectar hasta reconfigurarlos con el"
log "nuevo. Comprobar reconexiones en:  compose logs -f $SERVICE"
