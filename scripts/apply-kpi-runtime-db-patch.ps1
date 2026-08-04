# Aplica el parche idempotente 26 en PostgreSQL del contenedor Docker (bases ya existentes).
# Uso: desde la raíz del repo: .\scripts\apply-kpi-runtime-db-patch.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$patch = Join-Path $root "db_scripts\26_mining_runtime_kpis.sql"
if (-not (Test-Path $patch)) {
    Write-Error "No se encuentra $patch"
}

Write-Host "Copiando parche SQL al contenedor db..."
docker compose cp $patch "db:/tmp/26_mining_runtime_kpis.sql"
Write-Host "Ejecutando parche (ON_ERROR_STOP)..."
docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -f /tmp/26_mining_runtime_kpis.sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Parche KPI runtime aplicado correctamente."
