#Requires -Version 5.1
<#
.SYNOPSIS
  Reconstruye la imagen del servicio frontend (Vite + nginx) sin caché de build y recrea el contenedor.

.DESCRIPTION
  Úsalo cuando los cambios de UI no se ven en http://localhost:5173: fuerza build limpio,
  recrea el contenedor y opcionalmente comprueba que index.html sirva el bundle nuevo.
  Tras ejecutar: Ctrl+Shift+R o ventana de incógnito (caché del navegador).

.PARAMETER ComposeFile
  Archivo compose alternativo (ruta absoluta o relativa al repo). Por defecto docker-compose.yml en la raíz.

.PARAMETER Service
  Nombre del servicio en Compose (por defecto: frontend).

.PARAMETER SkipPull
  No ejecutar --pull en las imágenes base (node, nginx).

.PARAMETER SkipHttpCheck
  No intentar GET a http://127.0.0.1:5173 tras el arranque.

.EXAMPLE
  cd C:\InformeCliente
  .\scripts\rebuild-frontend-docker.ps1

.EXAMPLE
  .\scripts\rebuild-frontend-docker.ps1 -ComposeFile "docker-compose.yml"
#>
param(
    [string]$ComposeFile = "",
    [string]$Service = "frontend",
    [switch]$SkipPull,
    [switch]$SkipHttpCheck
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

$defaultCompose = Join-Path $root "docker-compose.yml"
if (-not (Test-Path $defaultCompose)) {
    Write-Error "No se encontró docker-compose.yml en la raíz del repo: $root"
}

Set-Location $root

$composeArgs = @()
if ($ComposeFile) {
    $cf = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $root $ComposeFile }
    if (-not (Test-Path $cf)) {
        Write-Error "Archivo compose no encontrado: $cf"
    }
    $composeArgs += @("-f", $cf)
}

# BuildKit explícito (Windows/Docker Desktop a veces hereda entornos raros)
$env:DOCKER_BUILDKIT = "1"
$env:COMPOSE_DOCKER_CLI_BUILD = "1"

Write-Host ""
Write-Host "=== InformeCliente — rebuild frontend Docker" -ForegroundColor Cyan
Write-Host "    Raíz repo: $root" -ForegroundColor Gray
Write-Host "    Servicio : $Service" -ForegroundColor Gray
Write-Host ""

$buildCmd = @("compose") + $composeArgs + @("build", "--no-cache", $Service)
if (-not $SkipPull) {
    $buildCmd += "--pull"
}

Write-Host ">>> docker $($buildCmd -join ' ')" -ForegroundColor Yellow
docker @buildCmd
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo en docker compose build (código $LASTEXITCODE)."
}

Write-Host ""
Write-Host ">>> Recreando contenedor (sin reutilizar el anterior)..." -ForegroundColor Yellow
$upCmd = @("compose") + $composeArgs + @("up", "-d", "--force-recreate", "--remove-orphans", $Service)
docker @upCmd
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo en docker compose up (código $LASTEXITCODE)."
}

if (-not $SkipHttpCheck) {
    Write-Host ""
    Write-Host ">>> Esperando nginx (hasta ~25 s)..." -ForegroundColor Yellow
    $ok = $false
    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:5173/index.html" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                $ok = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    if ($ok) {
        if ($r.Content -like '*SENSOR3D*Acceso ICAO*') {
            Write-Host "    OK: título en index.html (build reciente)." -ForegroundColor Green
        }
        if ($r.Content -match '/assets/index-[A-Za-z0-9_-]+\.js') {
            Write-Host "    OK: referencia a bundle /assets/index-*.js en HTML." -ForegroundColor Green
        } else {
            Write-Host "    ADVERTENCIA: no se vio /assets/index-*.js en index.html (¿dev server?)." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "    No hubo respuesta HTTP en :5173 a tiempo. Compruebe: docker compose ps" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "=== Listo" -ForegroundColor Green
Write-Host "    Abra: http://localhost:5173" -ForegroundColor White
Write-Host "    Recarga forzada: Ctrl+Shift+R  |  Mejor: ventana de incógnito" -ForegroundColor Gray
Write-Host "    Si sigue igual: cierre pestañas antiguas y vuelva a abrir la URL." -ForegroundColor Gray
Write-Host ""
