param(
  [string]$ComposeFile = "c:\mapas\docker-compose.yml",
  [string]$WorkspaceRoot = "c:\mapas"
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

Assert-DockerAvailable

Write-Host "[1/7] Levantando servicios..."
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile up -d --no-build | Out-Host } -ErrorMessage "No se pudieron levantar los servicios con docker compose."

Write-Host "[2/7] Esperando disponibilidad de backend..."
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:8081/health" -Method Get
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

$jpg = Join-Path $incoming "smoke_test.jpg"
$geotiff = Join-Path $incoming "smoke_test_geo.tif"

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 512, 512
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 25, 45, 130))
$foreground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 220, 210, 70))
$graphics.FillRectangle($background, 0, 0, 512, 512)
$graphics.FillEllipse($foreground, 120, 120, 280, 280)
$graphics.Dispose()
$bmp.Save($jpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()

Write-Host "[4/7] Georreferenciando raster de prueba..."
Invoke-CheckedDocker -Command { docker exec mapas-backend gdal_translate -of GTiff -a_srs EPSG:3857 -a_ullr -20037508.34 20037508.34 20037508.34 -20037508.34 /data/incoming/smoke_test.jpg /data/incoming/smoke_test_geo.tif | Out-Host } -ErrorMessage "Falló la georreferenciación con gdal_translate dentro del contenedor backend."
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

$resp = Invoke-RestMethod -Uri "http://localhost:8081/api/convert" -Method Post -ContentType "application/json" -Body $body
$jobId = $resp.job_id
if (-not $jobId) { throw "No se recibió job_id" }

Write-Host "[6/7] Esperando finalización del job $jobId ..."
$job = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 1200
  $job = Invoke-RestMethod -Uri "http://localhost:8081/api/jobs/$jobId" -Method Get
  if ($job.status -in @("completed", "failed")) { break }
}
if (-not $job) { throw "No se pudo consultar el estado del job" }
if ($job.status -ne "completed") {
  $logs = ($job.logs -join "`n")
  throw "El job terminó en '$($job.status)'. Logs:`n$logs"
}

Write-Host "[7/7] Verificando tileserver y frontend..."
Invoke-CheckedDocker -Command { docker-compose -f $ComposeFile restart tileserver | Out-Host } -ErrorMessage "No se pudo reiniciar tileserver."

$found = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 1000
  try {
    $serviceProbe = Invoke-WebRequest -Uri "http://localhost:8000/services/smoke_test" -UseBasicParsing -ErrorAction SilentlyContinue
    if ($serviceProbe -and $serviceProbe.StatusCode -eq 200) {
      $found = $true
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

    if ($serviceItems | Where-Object { $_.name -eq "smoke_test" }) {
      $found = $true
      break
    }
  } catch {}
}

if (-not $found) {
  throw "Tileset smoke_test no aparece en /services luego del tiempo de espera"
}

$tileOk = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 800
  try {
    $tileResp = Invoke-WebRequest -Uri "http://localhost:8000/services/smoke_test/tiles/0/0/0.jpg" -UseBasicParsing
    if ($tileResp.StatusCode -eq 200) {
      $tileOk = $true
      break
    }
  } catch {}
}
if (-not $tileOk) { throw "Tile endpoint no devolvió 200 dentro del tiempo esperado" }

$frontendResp = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
if ($frontendResp.StatusCode -ne 200) { throw "Frontend no devolvió 200" }

Write-Host ""
Write-Host "✅ Smoke test completo OK"
Write-Host "- Backend: http://localhost:8081/health"
Write-Host "- Tile server: http://localhost:8000/services"
Write-Host "- Frontend: http://localhost:5173"
Write-Host "- MBTiles generado: /data/incoming/smoke_test.mbtiles"
