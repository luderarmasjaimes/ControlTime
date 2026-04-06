#Requires -Version 5.1
<#
.SYNOPSIS
  Baja el stack, reconstruye imagenes sin cache y vuelve a levantar todo (fuentes en contenedores).

.DESCRIPTION
  Pull de db/tileserver, build --no-cache --pull de web/ai_engine/frontend, up -d [--wait].

.PARAMETER RemoveVolumes
  docker compose down -v (elimina volúmenes, p. ej. datos Postgres locales).

.PARAMETER ComposeFile
  Ruta al compose (por defecto docker-compose.yml en la raiz del repo).

.PARAMETER SkipPull
  No pull de imagenes externas ni --pull en build.

.PARAMETER SkipVerify
  No comprobar HTTP al final.

.EXAMPLE
  cd C:\InformeCliente
  .\scripts\rebuild-docker-stack-clean.ps1
#>
param(
    [string]$ComposeFile = "",
    [switch]$RemoveVolumes,
    [switch]$SkipPull,
    [switch]$SkipVerify
)

# Docker escribe progreso en stderr; Stop convierte eso en error de PowerShell.
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
    $ComposeFile = Join-Path $root "docker-compose.yml"
}
Set-Location $root

Write-Host ">>> Directorio: $root" -ForegroundColor Cyan
Write-Host ">>> Compose: $ComposeFile" -ForegroundColor Cyan

Write-Host ">>> docker compose down..." -ForegroundColor Yellow
if ($RemoveVolumes) {
    docker compose -f $ComposeFile down -v --remove-orphans
} else {
    docker compose -f $ComposeFile down --remove-orphans
}

if (-not $SkipPull) {
    Write-Host '>>> docker compose pull db tileserver...' -ForegroundColor Yellow
    docker compose -f $ComposeFile pull db tileserver
}

Write-Host '>>> docker compose build --no-cache [--pull] web ai_engine frontend...' -ForegroundColor Yellow
$buildStamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
Write-Host ">>> Build stamp: $buildStamp" -ForegroundColor Cyan
if ($SkipPull) {
    docker compose -f $ComposeFile build --no-cache --build-arg BUILD_STAMP=$buildStamp
} else {
    docker compose -f $ComposeFile build --no-cache --pull --build-arg BUILD_STAMP=$buildStamp
}
if ($LASTEXITCODE -ne 0) {
    Write-Host ">>> ERROR: docker compose build fallo (codigo $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host '>>> docker compose up -d --wait (o up -d si falla)...' -ForegroundColor Yellow
docker compose -f $ComposeFile up -d --wait
if ($LASTEXITCODE -ne 0) {
    Write-Host '>>> up -d sin --wait + espera 35s...' -ForegroundColor DarkYellow
    docker compose -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host ">>> ERROR: docker compose up fallo (codigo $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Start-Sleep -Seconds 35
}

Write-Host ">>> Estado:" -ForegroundColor Green
docker compose -f $ComposeFile ps -a

if (-not $SkipVerify) {
    Write-Host '>>> Comprobacion HTTP...' -ForegroundColor Yellow
    try {
        $h = Invoke-WebRequest -Uri "http://127.0.0.1:8082/health" -UseBasicParsing -TimeoutSec 15
        $snippet = $h.Content.Substring(0, [Math]::Min(80, $h.Content.Length))
        Write-Host "  web : $($h.StatusCode) $snippet..." -ForegroundColor Green
    } catch {
        Write-Host "  web : FALLO - $($_.Exception.Message)" -ForegroundColor Red
    }
    try {
        $f = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 15
        Write-Host "  frontend : $($f.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  frontend : FALLO - $($_.Exception.Message)" -ForegroundColor Red
    }
    try {
        $t = Invoke-WebRequest -Uri "http://127.0.0.1:8000/services" -UseBasicParsing -TimeoutSec 15
        Write-Host "  tileserver : $($t.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  tileserver : FALLO - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Listo. http://localhost:5173 | API http://localhost:8082/health" -ForegroundColor Green
Write-Host "UI: Ctrl+Shift+R o incognito." -ForegroundColor DarkGray
