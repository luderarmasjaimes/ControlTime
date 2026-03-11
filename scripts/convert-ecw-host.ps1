param(
  [string]$InputFile = "c:\mapas\data\incoming\input.ecw",
  [string]$OutputFile = "c:\mapas\data\incoming\raura_mbtiles3.mbtiles",
  [string]$ComposeFile = "c:\mapas\docker-compose.yml",
  [int]$MinZoom = 18,
  [int]$MaxZoom = 22,
  [int]$Quality = 85
)

$ErrorActionPreference = "Stop"

function Get-OverviewFactors {
  param(
    [int]$MinZoom,
    [int]$MaxZoom
  )

  $zoomSteps = [Math]::Max(0, $MaxZoom - $MinZoom)
  $factors = @()
  $factor = 2

  for ($i = 0; $i -lt $zoomSteps; $i++) {
    $factors += $factor
    $factor *= 2
  }

  return $factors
}

$gdalRoot = "$env:LOCALAPPDATA\Programs\GDAL"
$env:PATH = "$gdalRoot;$env:PATH"
$env:GDAL_DRIVER_PATH = "$gdalRoot\gdalplugins"
$env:GDAL_DATA = "$gdalRoot\gdal-data"
$env:PROJ_LIB = "$gdalRoot\projlib"

if (-not (Test-Path $InputFile)) {
  throw "No existe archivo de entrada: $InputFile"
}

$partial = [System.IO.Path]::ChangeExtension($OutputFile, "partial_tiles.db")
$journal = "$OutputFile-journal"
$resolvedOutput = $OutputFile
$resolvedPartial = $partial
$resolvedJournal = $journal

Write-Host "[1/4] Verificando driver ECW en host..."
$formats = gdalinfo --formats
$formatsText = ($formats | Out-String)
if ($formatsText -notmatch "ECW\s+-raster") {
  throw "Driver ECW no disponible en GDAL host. Ejecuta install-ecw-sdk-host.ps1"
}

Write-Host "[2/4] Convirtiendo ECW a MBTiles..."
try {
  docker compose -f $ComposeFile stop tileserver | Out-Host

  if (Test-Path $OutputFile) {
    $removed = $false
    for ($i = 0; $i -lt 8; $i++) {
      try {
        Remove-Item $OutputFile -Force -ErrorAction Stop
        $removed = $true
        break
      } catch {
        Start-Sleep -Milliseconds 400
      }
    }

    if (-not $removed) {
      $fallbackName = "{0}_{1}.mbtiles" -f ([System.IO.Path]::GetFileNameWithoutExtension($OutputFile)), (Get-Date -Format "yyyyMMdd_HHmmss")
      $resolvedOutput = Join-Path ([System.IO.Path]::GetDirectoryName($OutputFile)) $fallbackName
      $resolvedPartial = [System.IO.Path]::ChangeExtension($resolvedOutput, "partial_tiles.db")
      $resolvedJournal = "$resolvedOutput-journal"
      Write-Host "Aviso: archivo bloqueado, se usará salida alternativa: $resolvedOutput"
    }
  }

  if (Test-Path $resolvedPartial) { Remove-Item $resolvedPartial -Force -ErrorAction SilentlyContinue }
  if (Test-Path $resolvedJournal) { Remove-Item $resolvedJournal -Force -ErrorAction SilentlyContinue }

  gdal_translate -of MBTILES `
    -co TILE_FORMAT=JPEG `
    -co QUALITY=$Quality `
    -co ZOOM_LEVEL_STRATEGY=AUTO `
    -co MINZOOM=$MinZoom `
    -co MAXZOOM=$MaxZoom `
    -co BLOCKSIZE=256 `
    -r BILINEAR `
    "$InputFile" "$resolvedOutput"

  if (-not (Test-Path $resolvedOutput)) {
    throw "No se generó archivo MBTiles"
  }

  $overviewFactors = Get-OverviewFactors -MinZoom $MinZoom -MaxZoom $MaxZoom
  if ($overviewFactors.Count -gt 0) {
    Write-Host "[2.1/4] Construyendo overviews: $($overviewFactors -join ', ')"
    & gdaladdo -r average $resolvedOutput @overviewFactors
    if ($LASTEXITCODE -ne 0) {
      throw "gdaladdo fallo con codigo $LASTEXITCODE"
    }
  } else {
    Write-Host "[2.1/4] Se omiten overviews porque MinZoom y MaxZoom son iguales."
  }
} finally {
  Write-Host "[3/4] Reiniciando tileserver..."
  docker compose -f $ComposeFile up -d tileserver | Out-Host
  Start-Sleep -Seconds 2
}

Write-Host "[4/4] Validando servicio..."
$serviceId = [System.IO.Path]::GetFileNameWithoutExtension($resolvedOutput)
$svc = Invoke-RestMethod -Uri "http://localhost:8000/services/$serviceId" -Method Get
$maxZoom = [int]$svc.maxzoom
$tileUrl = "http://localhost:8000/services/$serviceId/tiles/$maxZoom/0/0.$($svc.format)"
$svc | ConvertTo-Json -Depth 10 | Out-Host
try {
  Invoke-WebRequest -Uri $tileUrl -UseBasicParsing | Out-Null
} catch {
  Write-Host "Aviso: no se pudo validar tile con URL $tileUrl (puede ser normal según cobertura espacial)."
}

Write-Host "✅ Conversión completada: $resolvedOutput"
