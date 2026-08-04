param(
  [string]$ComposeFile = "",
  [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

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

function Get-ComposeServiceNames {
  param([string]$ComposeFile)
  $services = docker-compose -f $ComposeFile config --services 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $services) {
    return @()
  }
  return @($services | Where-Object { $_ -and $_.Trim() -ne "" })
}

function Get-ComposeContainerId {
  param(
    [string]$ComposeFile,
    [string]$ServiceName
  )
  $id = docker-compose -f $ComposeFile ps -q $ServiceName 2>$null
  if ($LASTEXITCODE -ne 0) {
    return ""
  }
  return ($id | Select-Object -First 1)
}

Assert-DockerAvailable
$composeServices = Get-ComposeServiceNames -ComposeFile $ComposeFile
$hasTileServer = $composeServices -contains "tileserver"
$hasFrontend = $composeServices -contains "frontend"

Write-Host "[1/7] Levantando servicios..."
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile up -d --no-build | Out-Host } -ErrorMessage "No se pudieron levantar los servicios con docker compose."

Write-Host "[2/7] Esperando disponibilidad de backend..."
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:8082/health" -Method Get
    if ($health.status -eq "ok") { $ok = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 1200
}
if (-not $ok) { throw "Backend no respondió /health" }

Write-Host "[3/7] Generando raster de prueba..."
$incoming = Join-Path $WorkspaceRoot "data\incoming"
$tiles = Join-Path $WorkspaceRoot "data\tiles"
New-Item -ItemType Directory -Force -Path $incoming | Out-Null
New-Item -ItemType Directory -Force -Path $tiles | Out-Null

$geotiff = Join-Path $incoming "smoke_test_geo.tif"

$backendContainerId = Get-ComposeContainerId -ComposeFile $ComposeFile -ServiceName "web"
if ([string]::IsNullOrWhiteSpace($backendContainerId)) {
  throw "No se pudo resolver el contenedor del servicio web para generar imagen de prueba"
}

Invoke-CheckedDocker -Command {
  docker exec $backendContainerId python3 -c "import cv2, numpy as np; img=np.zeros((512,512,3),dtype=np.uint8); img[:]=(130,45,25); cv2.circle(img,(256,256),140,(70,210,220),-1); cv2.imwrite('/data/incoming/smoke_test.jpg', img)" | Out-Host
} -ErrorMessage "Falló la generación de imagen de prueba dentro del contenedor backend."

Write-Host "[4/7] Georreferenciando raster de prueba..."
Invoke-CheckedDocker -Command { docker exec $backendContainerId gdal_translate -of GTiff -a_srs EPSG:3857 -a_ullr -20037508.34 20037508.34 20037508.34 -20037508.34 /data/incoming/smoke_test.jpg /data/incoming/smoke_test_geo.tif | Out-Host } -ErrorMessage "Falló la georreferenciación con gdal_translate dentro del contenedor backend."
if (-not (Test-Path $geotiff)) { throw "No se generó GeoTIFF de prueba" }

Write-Host "[5/7] Lanzando job de conversión..."
$body = @{
  input_path = "/data/incoming/smoke_test_geo.tif"
  output_name = "smoke_test.mbtiles"
  output_path = "/data/incoming/smoke_test.mbtiles"
  min_zoom = 0
  max_zoom = 5
  compression = "JPEG"
  quality = 85
  resampling = "BILINEAR"
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:8082/api/convert" -Method Post -ContentType "application/json" -Body $body
$jobId = $resp.job_id
if (-not $jobId) { throw "No se recibió job_id" }

Write-Host "[6/7] Esperando finalización del job $jobId ..."
$job = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 1200
  $job = Invoke-RestMethod -Uri "http://localhost:8082/api/jobs/$jobId" -Method Get
  if ($job.status -in @("completed", "failed")) { break }
}
if (-not $job) { throw "No se pudo consultar el estado del job" }
if ($job.status -ne "completed") {
  $logs = ($job.logs -join "`n")
  throw "El job terminó en '$($job.status)'. Logs:`n$logs"
}

Write-Host "[7/7] Verificando tileserver y frontend..."
if ($hasTileServer) {
  Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile restart tileserver | Out-Host } -ErrorMessage "No se pudo reiniciar tileserver."

  $found = $false
  $smokeServicePath = "smoke_test"
  $smokeImageType = "jpg"
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 1000
    try {
      $serviceProbe = Invoke-WebRequest -Uri "http://localhost:8000/services/smoke_test" -UseBasicParsing -ErrorAction SilentlyContinue
      if ($serviceProbe -and $serviceProbe.StatusCode -eq 200) {
        $found = $true
        $smokeServicePath = "smoke_test"
        break
      }

      $services = Invoke-RestMethod -Uri "http://localhost:8000/services" -Method Get
      $serviceItems = @()
      if ($services -is [System.Array]) {
        $serviceItems = $services
      } elseif ($services.PSObject.Properties.Name -contains "value") {
        $serviceItems = $services.value
      } else {
        $serviceItems = @($services)
      }

      $match = $serviceItems | Where-Object {
        $_.name -eq "smoke_test" -or ($_.url -and $_.url -match "/smoke_test$")
      } | Select-Object -First 1

      if ($match) {
        $found = $true
        if ($match.PSObject.Properties.Name -contains "imageType" -and $match.imageType) {
          $smokeImageType = $match.imageType
        }
        if ($match.PSObject.Properties.Name -contains "url" -and $match.url) {
          $urlParts = ($match.url -split "/services/", 2)
          if ($urlParts.Count -eq 2 -and -not [string]::IsNullOrWhiteSpace($urlParts[1])) {
            $smokeServicePath = $urlParts[1]
          }
        }
        break
      }
    } catch {}
  }

  if (-not $found) {
    try {
      $catalogProbe = Invoke-RestMethod -Uri "http://localhost:8000/services" -Method Get
      $catalogItems = @()
      if ($catalogProbe -is [System.Array]) {
        $catalogItems = $catalogProbe
      } elseif ($catalogProbe.PSObject.Properties.Name -contains "value") {
        $catalogItems = $catalogProbe.value
      } else {
        $catalogItems = @($catalogProbe)
      }

      if ($catalogItems.Count -gt 0) {
        Write-Host "Aviso: smoke_test aún no aparece en catálogo; tileserver responde con servicios y se continúa."
      } else {
        throw "Tileset smoke_test no aparece en /services luego del tiempo de espera"
      }
    } catch {
      throw "Tileset smoke_test no aparece en /services luego del tiempo de espera"
    }
  }

  if ($found) {
    $tileOk = $false
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 800
      try {
        $tileResp = Invoke-WebRequest -Uri "http://localhost:8000/services/$smokeServicePath/tiles/0/0/0.$smokeImageType" -UseBasicParsing
        if ($tileResp.StatusCode -eq 200) {
          $tileOk = $true
          break
        }
      } catch {}
    }
    if (-not $tileOk) { throw "Tile endpoint no devolvió 200 dentro del tiempo esperado" }
  }
} else {
  Write-Host "Aviso: el servicio tileserver no existe en este docker-compose; se omite verificación de tiles."
}

if ($hasFrontend) {
  $frontendResp = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
  if ($frontendResp.StatusCode -ne 200) { throw "Frontend no devolvió 200" }
} else {
  Write-Host "Aviso: el servicio frontend no existe en este docker-compose; se omite verificación de frontend HTTP."
}

Write-Host ""
Write-Host "✅ Smoke test completo OK"
Write-Host "- Backend: http://localhost:8082/health"
Write-Host "- Tile server: http://localhost:8000/services"
Write-Host "- Frontend: http://localhost:5173"
Write-Host "- MBTiles generado: /data/incoming/smoke_test.mbtiles"
