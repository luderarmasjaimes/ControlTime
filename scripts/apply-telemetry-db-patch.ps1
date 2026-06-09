# Aplica el parche idempotente 23 en PostgreSQL del contenedor Docker (bases ya existentes).
# Uso: desde la raíz del repo: .\scripts\apply-telemetry-db-patch.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$patch = Join-Path $root "db_scripts\23_telemetry_surveillance_safe_update.sql"
if (-not (Test-Path $patch)) {
    Write-Error "No se encuentra $patch"
}

Write-Host "Copiando parche SQL al contenedor db..."
docker compose cp $patch "db:/tmp/23_telemetry_surveillance_safe_update.sql"
Write-Host "Ejecutando parche (ON_ERROR_STOP)..."
docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -f /tmp/23_telemetry_surveillance_safe_update.sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Parche aplicado correctamente."
