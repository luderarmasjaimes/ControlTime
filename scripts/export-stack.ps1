# ==========================================================================
# export-stack.ps1 — Exporta TODO lo que vive dentro de Docker para este
#   proyecto (imágenes + volúmenes con nombre + dump lógico de las bases
#   Postgres) a una carpeta autocontenida, lista para copiar a otra máquina
#   e importar con import-stack.ps1. 100% PowerShell nativo -- este único
#   archivo alcanza, no depende de Git Bash ni de ningún .sh.
#
# Qué SÍ cubre (todo lo que Docker gestiona):
#   - Imágenes: las 5 que build-ea este repo + las que se descargan.
#   - Volúmenes con nombre: minio_data, insightface_models, ollama_data
#     (redpanda_data se omite por defecto -- buffer de telemetría de 2h).
#   - Bases de datos: pg_dump lógico de sensors_db y formula.
#
# Qué NO cubre (no es "contenedores", son archivos del host que los
#   contenedores montan -- ver MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3):
#   .env, certs/, dermalog-sdk/, biometric-models/, data/, IMAGENES/*.onnx.
#   Cópialos a mano a las mismas rutas relativas del repo en destino.
#
# Uso:
#   .\scripts\export-stack.ps1
#   .\scripts\export-stack.ps1 -ExportDir "D:\backups\beemetry"
#   .\scripts\export-stack.ps1 -IncludeImages:$false
#   .\scripts\export-stack.ps1 -IncludeImages:$false -IncludeVolumes:$false   # solo BD
# ==========================================================================
param(
    [string]$ExportDir = "",
    [bool]$IncludeImages = $true,
    [bool]$IncludeVolumes = $true,
    [bool]$IncludeDb = $true,
    [bool]$IncludeRedpanda = $false,
    [string]$DbContainer = "beemetry-db",
    [string]$FormulaDbContainer = "beemetry-formula-db",
    # Solo hace falta si el auto-detect de abajo no encuentra docker-compose.yml.
    [string]$RepoRoot = "",
    # Solo hace falta si el nombre de la carpeta del repo NO es el que usa
    # `docker compose` para nombrar los volúmenes (poco común).
    [string]$ProjectName = ""
)

$ErrorActionPreference = "Stop"

function Find-Docker {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe",
        "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    throw "No encuentro docker.exe. Verificá que Docker Desktop esté instalado y corriendo."
}

function Find-RepoRoot {
    # Busca docker-compose.yml empezando por la carpeta de este script y
    # subiendo directorios -- así no importa si el .ps1 vive en scripts/,
    # en la raíz del repo, o en cualquier otro lado dentro del árbol.
    $dir = $PSScriptRoot
    for ($i = 0; $i -lt 5; $i++) {
        if (Test-Path (Join-Path $dir "docker-compose.yml")) { return $dir }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    return $null
}

$Docker = Find-Docker

if ($RepoRoot -eq "") {
    $RepoRoot = Find-RepoRoot
    if (-not $RepoRoot) {
        throw "No encuentro docker-compose.yml cerca de $PSScriptRoot. Pasá la carpeta del repo explícita con -RepoRoot 'C:\ruta\al\repo'."
    }
}
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.yml"))) {
    throw "docker-compose.yml no existe en '$RepoRoot' -- revisá -RepoRoot."
}
if ($ProjectName -eq "") {
    $ProjectName = (Split-Path -Leaf $RepoRoot).ToLower()
}

$Timestamp = Get-Date -AsUTC -Format "yyyyMMddTHHmmssZ"
if ($ExportDir -eq "") {
    $ExportDir = Join-Path $RepoRoot "stack_export\$Timestamp"
}

$ImagesDir = Join-Path $ExportDir "images"
$VolumesDir = Join-Path $ExportDir "volumes"
$DbDir = Join-Path $ExportDir "db"
New-Item -ItemType Directory -Force -Path $ImagesDir, $VolumesDir, $DbDir | Out-Null

Write-Host "[export] docker: $Docker"
Write-Host "[export] destino: $ExportDir"

# --- 1. Bases de datos -------------------------------------------------------
# pg_dump escribe DENTRO del contenedor y se trae el archivo con `docker cp`
# -- nunca por pipe de PowerShell, que decodifica/re-codifica texto y
# corrompe silenciosamente el formato binario custom de pg_dump.
if ($IncludeDb) {
    Write-Host "[export] pg_dump sensors_db ($DbContainer)..."
    & $Docker exec $DbContainer pg_dump -U sensors -d sensors_db --format=custom -f /tmp/sensors_db.dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump sensors_db falló" }
    & $Docker cp "${DbContainer}:/tmp/sensors_db.dump" (Join-Path $DbDir "sensors_db.dump")
    & $Docker exec $DbContainer rm -f /tmp/sensors_db.dump

    $formulaRunning = (& $Docker ps --format '{{.Names}}') -contains $FormulaDbContainer
    if ($formulaRunning) {
        Write-Host "[export] pg_dump formula ($FormulaDbContainer)..."
        & $Docker exec $FormulaDbContainer pg_dump -U formula -d formula --format=custom -f /tmp/formula_db.dump
        if ($LASTEXITCODE -ne 0) { throw "pg_dump formula falló" }
        & $Docker cp "${FormulaDbContainer}:/tmp/formula_db.dump" (Join-Path $DbDir "formula_db.dump")
        & $Docker exec $FormulaDbContainer rm -f /tmp/formula_db.dump
    } else {
        Write-Warning "$FormulaDbContainer no está corriendo, se salta."
    }
} else {
    Write-Host "[export] IncludeDb=`$false, saltando pg_dump."
}

# --- 2. Volumenes con nombre --------------------------------------------------
if ($IncludeVolumes) {
    $volsToExport = @("minio_data", "insightface_models", "ollama_data")
    if ($IncludeRedpanda) { $volsToExport += "redpanda_data" }

    foreach ($vol in $volsToExport) {
        $fullVol = "${ProjectName}_${vol}"
        $existing = & $Docker volume ls --format '{{.Name}}' | Where-Object { $_ -eq $fullVol }
        if (-not $existing) {
            Write-Warning "volumen '$fullVol' no encontrado, se salta."
            continue
        }
        Write-Host "[export] volumen $fullVol -> volumes/$vol.tar.gz ..."
        $volumesDirUnix = $VolumesDir -replace '\\', '/'
        & $Docker run --rm `
            -v "${fullVol}:/from:ro" `
            -v "${volumesDirUnix}:/to" `
            alpine sh -c "tar czf /to/$vol.tar.gz -C /from ."
        if ($LASTEXITCODE -ne 0) { throw "export del volumen $fullVol falló" }
    }
} else {
    Write-Host "[export] IncludeVolumes=`$false, saltando volumenes."
}

# --- 3. Imagenes Docker --------------------------------------------------------
if ($IncludeImages) {
    Push-Location $RepoRoot
    try {
        $images = (& $Docker compose config --images) | Sort-Object -Unique
    } finally {
        Pop-Location
    }
    foreach ($img in $images) {
        $exists = & $Docker image inspect $img 2>$null
        if (-not $exists) {
            Write-Warning "imagen '$img' no existe localmente, se salta."
            continue
        }
        $safeName = $img -replace '[/:]', '_'
        Write-Host "[export] imagen $img -> images/$safeName.tar.gz ..."
        $tmpTar = Join-Path $ImagesDir "$safeName.tar"
        & $Docker save -o $tmpTar $img
        if ($LASTEXITCODE -ne 0) { throw "docker save falló para $img" }
        # Comprimir y borrar el .tar sin comprimir (docker save no soporta gzip nativo en Windows).
        & tar -czf "$tmpTar.gz" -C $ImagesDir (Split-Path -Leaf $tmpTar)
        Remove-Item $tmpTar -Force
    }
} else {
    Write-Host "[export] IncludeImages=`$false, saltando imagenes."
}

# --- 4. Manifiesto ------------------------------------------------------------
$gitCommit = try { (& git -C $RepoRoot rev-parse HEAD 2>$null) } catch { "sin-git" }
if (-not $gitCommit) { $gitCommit = "sin-git" }
$gitBranch = try { (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null) } catch { "sin-git" }
if (-not $gitBranch) { $gitBranch = "sin-git" }

@"
project=$ProjectName
exported_at=$(Get-Date -AsUTC -Format 'yyyy-MM-ddTHH:mm:ssZ')
git_commit=$gitCommit
git_branch=$gitBranch
include_images=$([int]$IncludeImages)
include_volumes=$([int]$IncludeVolumes)
include_db=$([int]$IncludeDb)
include_redpanda=$([int]$IncludeRedpanda)
"@ | Set-Content -Path (Join-Path $ExportDir "manifest.txt")

$totalSize = (Get-ChildItem -Path $ExportDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalSizeGb = [math]::Round($totalSize / 1GB, 2)
Write-Host "[export] Listo. Tamaño total: ${totalSizeGb} GB en $ExportDir"
Write-Host "[export] RECORDATORIO: .env, certs\, dermalog-sdk\, biometric-models\ y data\"
Write-Host "[export]   NO se exportaron (no son 'contenedores') -- copiarlos a mano."
Write-Host "[export]   Ver MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3 para el detalle completo."
