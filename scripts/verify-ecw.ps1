param(
  [string]$ComposeFile = "",
  [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = Split-Path -Parent $ScriptDir
}
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

Assert-DockerAvailable

Write-Host "[1/8] Backend en ejecución..."
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile up -d web | Out-Host } -ErrorMessage "No se pudo levantar el servicio web con docker-compose."

$webContainerId = (docker-compose -f $ComposeFile ps -q web 2>$null | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($webContainerId)) {
  throw "No se pudo resolver el contenedor del servicio web."
}

Write-Host "[2/8] Verificando carpeta plugin host..."
$pluginHost = Join-Path $WorkspaceRoot "ecw-plugin"
if (-not (Test-Path $pluginHost)) {
  Write-Host "❌ No existe: $pluginHost"
} else {
  $files = Get-ChildItem -Path $pluginHost -Recurse -File
  if ($files.Count -eq 0) {
    Write-Host "❌ Carpeta vacía: $pluginHost"
  } else {
    Write-Host "✅ Archivos en host: $($files.Count)"
    $files | Select-Object FullName,Length | Format-Table -AutoSize | Out-Host
  }
}

Write-Host "[3/8] Verificando mount /opt/ecw en contenedor..."
docker exec $webContainerId sh -lc "ls -la /opt/ecw || true" | Out-Host

Write-Host "[4/8] Listando binarios .so del plugin..."
$soList = docker exec $webContainerId sh -lc "find /opt/ecw -type f \( -name '*.so' -o -name '*.so.*' \) 2>/dev/null"
if (-not $soList) {
  Write-Host "❌ No hay librerías .so en /opt/ecw"
} else {
  Write-Host "✅ Librerías encontradas:"
  $soList | Out-Host
}

Write-Host "[5/8] Chequeando dependencias dinámicas (ldd)..."
if ($soList) {
  $firstSo = ($soList -split "`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -First 1).Trim()
  if ($firstSo) {
    Write-Host "Analizando: $firstSo"
    docker exec $webContainerId sh -lc "ldd '$firstSo' 2>/dev/null || true" | Out-Host
  }
}

Write-Host "[6/8] Verificando drivers GDAL..."
docker exec $webContainerId sh -lc "echo GDAL_DRIVER_PATH=\$GDAL_DRIVER_PATH; gdalinfo --formats | grep -Ei 'ECW|JP2|MrSID|NITF' || true" | Out-Host

Write-Host "[7/8] Probando apertura de input.ecw..."
docker exec $webContainerId sh -lc "gdalinfo /data/incoming/input.ecw 2>&1 | sed -n '1,60p'" | Out-Host

Write-Host "[8/8] Consultando capacidades de API..."
try {
  $cap = Invoke-RestMethod -Uri "http://localhost:8081/api/capabilities" -Method Get
  $cap | ConvertTo-Json -Depth 5 | Out-Host
  if ($cap.ecw_supported -eq $true) {
    Write-Host "✅ ECW disponible en runtime"
  } else {
    Write-Host "❌ ECW no disponible en runtime"
  }
} catch {
  Write-Host "❌ No se pudo consultar /api/capabilities: $($_.Exception.Message)"
}
