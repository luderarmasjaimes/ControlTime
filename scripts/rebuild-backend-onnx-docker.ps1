#Requires -Version 5.1
<#
.SYNOPSIS
  Reconstruye solo el servicio web (backend C++ con ONNX Runtime + modelo cartoon) y lo levanta.

.DESCRIPTION
  Usar tras cambios en backend/Dockerfile, onnx_cartoon.cpp o para forzar descarga de ORT/modelo en build.
  Verifica /health (cartoon_onnx_linked, cartoon_onnx_model_exists).

.EXAMPLE
  cd C:\InformeCliente
  .\scripts\rebuild-backend-onnx-docker.ps1
#>
param(
    [string]$ComposeFile = "",
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
    $ComposeFile = Join-Path $root "docker-compose.yml"
}
Set-Location $root

Write-Host ">>> Compose: $ComposeFile" -ForegroundColor Cyan
$buildArgs = @("compose", "-f", $ComposeFile, "build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += "web"
& docker @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ">>> up -d web" -ForegroundColor Yellow
docker compose -f $ComposeFile up -d web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ">>> Esperando health..." -ForegroundColor Yellow
$ok = $false
for ($i = 0; $i -lt 36; $i++) {
    try {
        $h = docker compose -f $ComposeFile exec -T web curl -sf http://127.0.0.1:8081/health 2>$null
        if ($h -match "cartoon_onnx") {
            Write-Host $h
            if ($h -match '"cartoon_onnx_linked"\s*:\s*true' -and $h -match '"cartoon_onnx_model_exists"\s*:\s*true') {
                $ok = $true
            }
            break
        }
    } catch {}
    Start-Sleep -Seconds 3
}

if (-not $ok) {
    Write-Host ">>> ADVERTENCIA: No se confirmo cartoon_onnx en health (revisa logs: docker compose logs web)" -ForegroundColor DarkYellow
    exit 1
}
Write-Host ">>> Backend ONNX listo." -ForegroundColor Green
