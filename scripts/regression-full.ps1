param(
  [string]$ComposeFile = "c:\mapas\docker-compose.yml",
  [int]$SmokeTimeoutSec = 900,
  [int]$HostConvertTimeoutSec = 7200
)

$ErrorActionPreference = "Stop"

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

function Invoke-ScriptWithTimeout {
  param(
    [string]$ScriptPath,
    [int]$TimeoutSec,
    [string]$StepName
  )

  if (-not (Test-Path $ScriptPath)) {
    throw "No existe script para ${StepName}: $ScriptPath"
  }

  $args = @(
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $ScriptPath
  )

  $stdoutFile = Join-Path $env:TEMP ("regression-{0}-out.log" -f ([guid]::NewGuid().ToString('N')))
  $stderrFile = Join-Path $env:TEMP ("regression-{0}-err.log" -f ([guid]::NewGuid().ToString('N')))

  try {
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $args -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $finished = $proc.WaitForExit($TimeoutSec * 1000)

    if (Test-Path $stdoutFile) {
      Get-Content $stdoutFile | Out-Host
    }
    if (Test-Path $stderrFile) {
      Get-Content $stderrFile | Out-Host
    }
  } finally {
    if (Test-Path $stdoutFile) { Remove-Item $stdoutFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stderrFile) { Remove-Item $stderrFile -Force -ErrorAction SilentlyContinue }
  }

  if (-not $finished) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    throw "$StepName excedió timeout de $TimeoutSec segundos y fue finalizado."
  }

  $exitCode = $null
  try {
    $proc.Refresh()
    $exitCode = $proc.ExitCode
  } catch {
    $exitCode = $null
  }

  if ($null -eq $exitCode -or "$exitCode" -eq "") {
    $exitCode = 0
  }

  if ($exitCode -ne 0) {
    throw "$StepName terminó con ExitCode=$exitCode."
  }
}

Write-Host "[1/6] Levantando stack..."
Assert-DockerAvailable
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile up -d backend tileserver frontend | Out-Host } -ErrorMessage "No se pudo levantar el stack con docker compose."

Write-Host "[2/6] Verificando endpoints base..."
Invoke-RestMethod -Uri "http://localhost:8081/health" -Method Get | ConvertTo-Json -Depth 5 | Out-Host
Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing | Select-Object StatusCode | Out-Host

Write-Host "[3/6] Smoke test general..."
Invoke-ScriptWithTimeout -ScriptPath "c:\mapas\scripts\smoke-test.ps1" -TimeoutSec $SmokeTimeoutSec -StepName "Smoke test general"

Write-Host "[4/6] Conversión ECW host..."
Invoke-ScriptWithTimeout -ScriptPath "c:\mapas\scripts\convert-ecw-host.ps1" -TimeoutSec $HostConvertTimeoutSec -StepName "Conversión ECW host"

Write-Host "[5/6] Verificando catálogo final..."
Invoke-RestMethod -Uri "http://localhost:8000/services" -Method Get | ConvertTo-Json -Depth 8 | Out-Host

Write-Host "[6/6] Verificando servicio raura..."
Invoke-RestMethod -Uri "http://localhost:8000/services/raura_mbtiles3" -Method Get | ConvertTo-Json -Depth 8 | Out-Host

Write-Host "✅ Regresión completa OK"
