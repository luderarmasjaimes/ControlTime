param(
  [string]$ComposeFile = "c:\mapas\docker-compose.yml"
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

Write-Host "[1/6] Levantando servicios..."
Assert-DockerAvailable
Invoke-CheckedDocker -Command { docker compose -f $ComposeFile up -d backend tileserver frontend | Out-Host } -ErrorMessage "No se pudieron levantar los servicios con docker compose."

Write-Host "[2/6] Verificando capacidad ECW..."
$cap = Invoke-RestMethod -Uri "http://localhost:8081/api/capabilities" -Method Get
$cap | ConvertTo-Json -Depth 5 | Out-Host
if (-not $cap.ecw_supported) {
  throw "ECW no habilitado. Copia plugin .so en ecw-plugin y vuelve a ejecutar."
}

Write-Host "[3/6] Lanzando conversión con rutas fijas..."
$body = @{
  input_path = "/data/incoming/input.ecw"
  output_name = "raura_mbtiles3.mbtiles"
  output_path = "/data/incoming/raura_mbtiles3.mbtiles"
  min_zoom = 0
  max_zoom = 18
  compression = "JPEG"
  quality = 85
  resampling = "BILINEAR"
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:8081/api/convert" -Method Post -ContentType "application/json" -Body $body
$jobId = $resp.job_id
if (-not $jobId) { throw "No se recibió job_id" }
Write-Host "Job: $jobId"

Write-Host "[4/6] Esperando finalización..."
$job = $null
for ($i = 0; $i -lt 240; $i++) {
  Start-Sleep -Seconds 2
  $j = Invoke-RestMethod -Uri "http://localhost:8081/api/jobs/$jobId" -Method Get
  if ($i % 10 -eq 0) { Write-Host ("Estado: " + $j.status) }
  if ($j.status -in @("completed", "failed")) { $job = $j; break }
}
if (-not $job) { throw "Timeout esperando job" }
if ($job.status -ne "completed") {
  $logs = ($job.logs -join "`n")
  throw "Job falló: $($job.status)`n$logs"
}

Write-Host "[5/6] Reiniciando tileserver y verificando catálogo..."
Invoke-CheckedDocker -Command { docker compose -f $ComposeFile restart tileserver | Out-Host } -ErrorMessage "No se pudo reiniciar tileserver."
Start-Sleep -Seconds 3
$services = Invoke-RestMethod -Uri "http://localhost:8000/services" -Method Get
$services | ConvertTo-Json -Depth 8 | Out-Host

Write-Host "[6/6] Probando tile y frontend..."
$tile = Invoke-WebRequest -Uri "http://localhost:8000/services/raura_mbtiles3/tiles/0/0/0.png" -UseBasicParsing
if ($tile.StatusCode -ne 200) { throw "Tile endpoint no devolvió 200" }
$front = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
if ($front.StatusCode -ne 200) { throw "Frontend no devolvió 200" }

Write-Host "✅ ECW end-to-end OK"
Write-Host "- MBTiles: c:\mapas\data\incoming\raura_mbtiles3.mbtiles"
Write-Host "- Servicio: http://localhost:8000/services/raura_mbtiles3"
