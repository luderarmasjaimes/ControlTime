# Aplica el parche 28 (telemetría minera unificada con tenants.tenant_id) en PostgreSQL Docker.
# Uso: desde la raíz del repo: .\scripts\apply-mining-telemetry-tenant-uuid-patch.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$patch = Join-Path $root "db_scripts\28_mining_telemetry_uuid_tenant.sql"
if (-not (Test-Path $patch)) {
    Write-Error "No se encuentra $patch"
}

Write-Host "Copiando parche SQL al contenedor db..."
docker compose cp $patch "db:/tmp/28_mining_telemetry_uuid_tenant.sql"
Write-Host "Ejecutando parche..."
docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -f /tmp/28_mining_telemetry_uuid_tenant.sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Parche tenant UUID telemetría aplicado correctamente."
