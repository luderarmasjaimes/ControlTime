#!/usr/bin/env bash
# ==========================================================================
# harden-vps.sh — Hardening base del host Linux (Ubuntu/Debian) donde corre
#   docker-compose.yml. Ejecutar UNA VEZ por SSH en la VPS, como root/sudo.
#
# NO ejecutar contra la máquina de desarrollo Windows — este script asume un
# host Linux con systemd, ufw y apt disponibles.
#
# Cubre: firewall (default-deny entrante), fail2ban para SSH, actualizaciones
# de seguridad automáticas. NO deshabilita login por contraseña en SSH
# automáticamente (riesgo de dejarte fuera si no confirmaste antes que tu
# clave pública funciona) — ver el paso manual al final.
#
# Uso: sudo ./scripts/harden-vps.sh [--ssh-port 22] [--extra-tcp 8443]
# ==========================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutar como root (sudo ./scripts/harden-vps.sh)" >&2
  exit 1
fi

SSH_PORT=22
EXTRA_TCP_PORTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --extra-tcp) EXTRA_TCP_PORTS+=("$2"); shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 1 ;;
  esac
done

echo "[harden] Instalando ufw, fail2ban, unattended-upgrades..."
apt-get update -qq
apt-get install -y --no-install-recommends ufw fail2ban unattended-upgrades

echo "[harden] Configurando ufw (default-deny entrante)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP (frontend nginx)'
ufw allow 443/tcp comment 'HTTPS (si hay TLS termination delante de nginx)'
# 8443: mining gateway TLS — solo si los sensores conectan directo a esta VPS.
# Ver docker-compose.yml comentario junto a "8443:8443". Restringir a rangos
# IP conocidos de los sensores con `ufw allow from <IP/CIDR> to any port 8443`
# en vez de abrir a todo internet, si esos rangos son estáticos/conocidos.
for p in "${EXTRA_TCP_PORTS[@]}"; do
  ufw allow "${p}/tcp" comment 'extra (harden-vps.sh --extra-tcp)'
done
# Explícitamente NO se abren: 9000/9001 (MinIO), 18020 (formula_engine),
# 8082 (backend HTTP plano) — ya bindeados a 127.0.0.1 en docker-compose.yml
# (ver hardening 2026-07-10); ufw es la segunda capa de defensa por si algún
# día se vuelve a publicar un puerto por error.
ufw --force enable
ufw status verbose

echo "[harden] Configurando fail2ban para sshd..."
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 600
bantime = 3600
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "[harden] Habilitando actualizaciones de seguridad automáticas..."
dpkg-reconfigure -f noninteractive unattended-upgrades || true
systemctl enable --now unattended-upgrades.service 2>/dev/null || true

echo ""
echo "=========================================================================="
echo "[harden] Hecho. Verificar manualmente:"
echo "  ufw status verbose"
echo "  fail2ban-client status sshd"
echo ""
echo "[harden] PASO MANUAL PENDIENTE (no automatizado — riesgo de bloqueo):"
echo "  1. Confirmar que puedes entrar por SSH con clave pública (no contraseña)."
echo "  2. Editar /etc/ssh/sshd_config:"
echo "       PasswordAuthentication no"
echo "       PermitRootLogin prohibit-password"
echo "  3. systemctl restart sshd"
echo "  4. Probar una conexión SSH NUEVA en otra terminal ANTES de cerrar la"
echo "     sesión actual (si algo falla, la sesión actual sigue siendo tu"
echo "     salvavidas para revertir)."
echo "=========================================================================="
