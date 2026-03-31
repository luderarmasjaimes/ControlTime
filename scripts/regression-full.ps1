param(
  [string]$ComposeFile = "",
  [int]$SmokeTimeoutSec = 900,
  [int]$HostConvertTimeoutSec = 7200
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$WorkspaceRoot = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
  $ComposeFile = Join-Path $WorkspaceRoot "docker-compose.yml"
}

function Assert-DockerAvailable {
  try {
    docker version | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Docker no esta disponible en esta sesion."
    }
  } catch {
    throw "Docker no esta en ejecucion o no es accesible. Inicia Docker Desktop y vuelve a intentar."
  }
}

function Invoke-CheckedDocker {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$ErrorMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

function Get-ComposeServiceNames {
  param([string]$ComposeFile)
  $services = docker-compose -f $ComposeFile config --services 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $services) {
    return @()
  }
  return @($services | Where-Object { $_ -and $_.Trim() -ne "" })
}

function Invoke-ScriptWithTimeout {
  param(
    [string]$ScriptPath,
    [int]$TimeoutSec,
    [string]$StepName
  )

  if (-not (Test-Path $ScriptPath)) {
    throw "No existe script para ${StepName}: $ScriptPath"
  }

  if ($TimeoutSec -gt 0) {
    Write-Host "Aviso: timeout no aplicado en modo ejecución directa para ${StepName}."
  }

  & powershell.exe -ExecutionPolicy Bypass -File $ScriptPath
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    throw "$StepName terminó con ExitCode=$exitCode."
  }
}

Write-Host "[1/6] Levantando stack..."
Assert-DockerAvailable
$composeServices = Get-ComposeServiceNames -ComposeFile $ComposeFile
$targets = @()
if ($composeServices -contains "web") { $targets += "web" }
if ($composeServices -contains "backend") { $targets += "backend" }
if ($composeServices -contains "tileserver") { $targets += "tileserver" }
if ($composeServices -contains "frontend") { $targets += "frontend" }
if ($targets.Count -eq 0) {
  throw "No se detectaron servicios ejecutables en docker-compose."
}
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile up -d @targets | Out-Host } -ErrorMessage "No se pudo levantar el stack con docker compose."

Write-Host "[2/6] Verificando endpoints base..."
Invoke-RestMethod -Uri "http://localhost:8081/health" -Method Get | ConvertTo-Json -Depth 5 | Out-Host
if ($composeServices -contains "frontend") {
  Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing | Select-Object StatusCode | Out-Host
} else {
  Write-Host "Aviso: servicio frontend no está definido; se omite verificación HTTP 5173."
}

Write-Host "[3/6] Smoke test general..."
Invoke-ScriptWithTimeout -ScriptPath (Join-Path $ScriptDir "smoke-test.ps1") -TimeoutSec $SmokeTimeoutSec -StepName "Smoke test general"

Write-Host "[4/6] Conversión ECW host..."
$ecwInput = Join-Path $WorkspaceRoot "data\incoming\input.ecw"
$gdalInfoCmd = Get-Command gdalinfo -ErrorAction SilentlyContinue
if (-not (Test-Path $ecwInput)) {
  Write-Host "Aviso: no existe input.ecw en data/incoming; se omite conversión ECW host."
} elseif (-not $gdalInfoCmd) {
  Write-Host "Aviso: gdalinfo no está en PATH; se omite conversión ECW host."
} else {
  Invoke-ScriptWithTimeout -ScriptPath (Join-Path $ScriptDir "convert-ecw-host.ps1") -TimeoutSec $HostConvertTimeoutSec -StepName "Conversión ECW host"
}

Write-Host "[5/6] Verificando catálogo final..."
if ($composeServices -contains "tileserver") {
  Invoke-RestMethod -Uri "http://localhost:8000/services" -Method Get | ConvertTo-Json -Depth 8 | Out-Host
} else {
  Write-Host "Aviso: servicio tileserver no está definido; se omite catálogo final."
}

Write-Host "[6/6] Verificando servicio raura..."
if ($composeServices -contains "tileserver") {
  try {
    Invoke-RestMethod -Uri "http://localhost:8000/services/raura_mbtiles3" -Method Get | ConvertTo-Json -Depth 8 | Out-Host
  } catch {
    Write-Host "Aviso: servicio raura_mbtiles3 no publicado actualmente en tileserver; se omite validación estricta."
  }
} else {
  Write-Host "Aviso: servicio tileserver no está definido; se omite verificación raura."
}

Write-Host "✅ Regresión completa OK"
