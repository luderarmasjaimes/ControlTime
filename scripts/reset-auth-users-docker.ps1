#Requires -Version 5.1
<#
.SYNOPSIS
  Vacia auth_users (y auditoria auth) en Postgres del stack Docker, conservando el resto de la BD.

.DESCRIPTION
  Ejecuta db_scripts/15_reset_auth_users_runtime.sql contra el servicio db (sensors_db / usuario sensors).
  Reinicia web para limpiar sesiones en memoria. En el navegador: cerrar sesion o limpiar localStorage.

.PARAMETER ComposeFile
  Ruta al compose (por defecto docker-compose.yml en la raiz del repo).

.PARAMETER SkipWebRestart
  No reiniciar el contenedor web tras el SQL.

.EXAMPLE
  cd C:\InformeCliente
  .\scripts\reset-auth-users-docker.ps1
#>
param(
    [string]$ComposeFile = "",
    [switch]$SkipWebRestart
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$defaultCompose = Join-Path $root "docker-compose.yml"
if (-not (Test-Path $defaultCompose)) {
    Write-Error "No se encontro docker-compose.yml en: $root"
}

Set-Location $root

$sqlPath = Join-Path $root "db_scripts\15_reset_auth_users_runtime.sql"
if (-not (Test-Path $sqlPath)) {
    Write-Error "No se encontro: $sqlPath"
}

$composePrefix = @("compose")
if ($ComposeFile) {
    $cf = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $root $ComposeFile }
    if (-not (Test-Path $cf)) { Write-Error "Compose no encontrado: $cf" }
    $composePrefix = @("compose", "-f", $cf)
}

Write-Host ""
Write-Host "=== InformeCliente - reset SOLO auth_users (Docker)" -ForegroundColor Cyan
Write-Host "    Repo: $root" -ForegroundColor Gray
Write-Host "    SQL : $sqlPath" -ForegroundColor Gray
Write-Host ""

Write-Host ">>> Comprobando servicio db..." -ForegroundColor Yellow
$dbId = & docker @composePrefix ps -q db 2>$null
if (-not $dbId -or [string]::IsNullOrWhiteSpace($dbId)) {
    Write-Error "El servicio 'db' no esta en ejecucion. Ejecute: docker compose up -d db"
}

Write-Host ">>> Ejecutando SQL..." -ForegroundColor Yellow
$sqlText = Get-Content -Path $sqlPath -Raw -Encoding UTF8
$sqlText | & docker @composePrefix exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    Write-Error "psql fallo (codigo $LASTEXITCODE)."
}

Write-Host ""
Write-Host "    Revise la salida: la ultima fila debe mostrar auth_users_count = 0." -ForegroundColor DarkYellow

if (-not $SkipWebRestart) {
    Write-Host ""
    Write-Host ">>> Reiniciando web (sesiones en memoria del backend)..." -ForegroundColor Yellow
    & docker @composePrefix restart web
    if ($LASTEXITCODE -ne 0) {
        Write-Error "docker compose restart web fallo (codigo $LASTEXITCODE)."
    }
    Write-Host "    OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Listo" -ForegroundColor Green
Write-Host '    Cierre sesion en el navegador o limpie localStorage antes de registrar usuarios nuevos.' -ForegroundColor Gray
Write-Host ""
