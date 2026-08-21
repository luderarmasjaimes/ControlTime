# ==========================================================================
# import-stack.ps1 — Restaura lo generado por export-stack.ps1 en una
#   máquina nueva. 100% PowerShell nativo, SIN depender de Git Bash ni de
#   ningún otro archivo .sh -- este único archivo alcanza para importar.
#   Complementa (no reemplaza) los pasos manuales de
#   MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3-4 (.env, certs/, dermalog-sdk/,
#   biometric-models/, data/) -- esos hay que copiarlos aparte, este script
#   no los toca.
#
# Uso:
#   .\scripts\import-stack.ps1 -ImportDir "C:\backups\beemetry"
#   .\scripts\import-stack.ps1 -ImportDir "C:\backups\beemetry" -IncludeImages:$false
#
# Orden recomendado en la máquina nueva:
#   1. Copiar .env, certs/, dermalog-sdk/, biometric-models/, data/ (manual).
#   2. .\scripts\import-stack.ps1 -ImportDir <carpeta del export>
#   3. bash scripts/provision-dashboard-ro.sh   (o pedir la versión .ps1)
#   4. docker compose up -d
#
# Requiere: Docker Desktop corriendo, docker.exe accesible (PATH o la ruta
#   default de instalación), y que el nombre de carpeta del repo destino
#   sea igual al de origen -- si no, los volúmenes se restauran con el
#   nombre <carpeta-actual>_<vol>.
# ==========================================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$ImportDir,
    [bool]$IncludeImages = $true,
    [bool]$IncludeVolumes = $true,
    [bool]$IncludeDb = $true,
    [string]$DbContainer = "beemetry-db",
    [string]$FormulaDbContainer = "beemetry-formula-db",
    # Solo hace falta si el auto-detect de abajo no encuentra docker-compose.yml
    # (por ejemplo, corriste este .ps1 desde una copia suelta fuera del repo).
    [string]$RepoRoot = "",
    # Solo hace falta si el nombre de la carpeta del repo NO es el que usó
    # `docker compose` para nombrar los volúmenes originalmente (ver
    # manifest.txt -> "project=..." del export).
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

if (-not (Test-Path $ImportDir)) {
    Write-Error "ImportDir no existe: $ImportDir"
    exit 1
}
$ManifestPath = Join-Path $ImportDir "manifest.txt"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "No encuentro manifest.txt en $ImportDir -- ¿es una carpeta generada por export-stack.ps1?"
    exit 1
}

Write-Host "[import] docker: $Docker"
Write-Host "[import] proyecto: $ProjectName"
Write-Host "[import] origen: $ImportDir"
Write-Host "[import] manifiesto:"
Get-Content $ManifestPath | ForEach-Object { Write-Host "[import]   $_" }

# --- 1. Imagenes -----------------------------------------------------------
# `docker load -i` lee el archivo directo del disco (soporta .tar.gz) --
# nunca por pipe de PowerShell, que corrompe binarios.
$ImagesDir = Join-Path $ImportDir "images"
if ($IncludeImages -and (Test-Path $ImagesDir)) {
    Get-ChildItem -Path $ImagesDir -Filter "*.tar.gz" | ForEach-Object {
        Write-Host "[import] cargando $($_.Name) ..."
        & $Docker load -i $_.FullName
        if ($LASTEXITCODE -ne 0) { throw "docker load falló para $($_.Name)" }
    }
} else {
    Write-Host "[import] saltando imagenes (IncludeImages=`$false o carpeta ausente)."
}

# --- 2. Volumenes ------------------------------------------------------------
$VolumesDir = Join-Path $ImportDir "volumes"
if ($IncludeVolumes -and (Test-Path $VolumesDir)) {
    Get-ChildItem -Path $VolumesDir -Filter "*.tar.gz" | ForEach-Object {
        $volName = $_.BaseName -replace '\.tar$', ''
        $fullVol = "${ProjectName}_${volName}"
        Write-Host "[import] restaurando volumen $fullVol desde $($_.Name) ..."
        & $Docker volume create $fullVol | Out-Null
        $volumesDirUnix = $VolumesDir -replace '\\', '/'
        & $Docker run --rm `
            -v "${fullVol}:/to" `
            -v "${volumesDirUnix}:/from:ro" `
            alpine sh -c "rm -rf /to/* /to/..?* /to/.[!.]* 2>/dev/null; tar xzf /from/$($_.Name) -C /to"
        if ($LASTEXITCODE -ne 0) { throw "restauración del volumen $fullVol falló" }
    }
} else {
    Write-Host "[import] saltando volumenes (IncludeVolumes=`$false o carpeta ausente)."
}

# --- 3. Bases de datos -------------------------------------------------------
$DbDir = Join-Path $ImportDir "db"
if ($IncludeDb -and (Test-Path $DbDir)) {
    Write-Host "[import] levantando db/formula_db (docker compose up -d)..."
    Push-Location $RepoRoot
    try {
        & $Docker compose up -d db formula_db
        if ($LASTEXITCODE -ne 0) { throw "docker compose up -d db formula_db falló" }

        Write-Host "[import] esperando healthcheck..."
        foreach ($svc in @("db", "formula_db")) {
            $cid = (& $Docker compose ps -q $svc).Trim()
            $tries = 0
            while ($tries -lt 60) {
                $status = (& $Docker inspect --format='{{.State.Health.Status}}' $cid 2>$null)
                if ($status -eq "healthy") { break }
                Start-Sleep -Seconds 3
                $tries++
            }
            if ($status -ne "healthy") {
                Write-Warning "$svc no llegó a 'healthy' tras 3 min de espera -- revisá 'docker compose ps' antes de restaurar."
            }
        }

        # docker cp adentro del contenedor + pg_restore desde ahí -- nunca
        # por pipe de PowerShell (corrompe el formato binario custom).
        #
        # sensors_db corre sobre TimescaleDB: pg_restore --clean genera
        # "ALTER TABLE ONLY ... DROP/ADD CONSTRAINT" sobre las hypertables
        # (telemetry_raw, mining_sensor_history, etc.), y TimescaleDB
        # rechaza el ONLY ahí ("ONLY option not supported on hypertable
        # operations") -- se pierden los foreign keys en silencio si no se
        # envuelve con timescaledb_pre_restore()/post_restore() (mecanismo
        # oficial: docs.timescale.com, sección de backup/restore).
        $sensorsDump = Join-Path $DbDir "sensors_db.dump"
        if (Test-Path $sensorsDump) {
            Write-Host "[import] pg_restore sensors_db (con timescaledb_pre_restore)..."
            & $Docker cp $sensorsDump "${DbContainer}:/tmp/sensors_db.dump"
            & $Docker exec $DbContainer psql -U sensors -d sensors_db -c "SELECT timescaledb_pre_restore();"
            & $Docker exec $DbContainer pg_restore -U sensors -d sensors_db --clean --if-exists /tmp/sensors_db.dump
            $restoreExit = $LASTEXITCODE
            & $Docker exec $DbContainer psql -U sensors -d sensors_db -c "SELECT timescaledb_post_restore();"
            & $Docker exec $DbContainer rm -f /tmp/sensors_db.dump
            if ($restoreExit -ne 0) {
                Write-Warning "pg_restore sensors_db devolvió errores (exit $restoreExit) -- revisá la salida arriba antes de dar el restore por bueno."
            }
        }
        $formulaDump = Join-Path $DbDir "formula_db.dump"
        if (Test-Path $formulaDump) {
            Write-Host "[import] pg_restore formula ..."
            & $Docker cp $formulaDump "${FormulaDbContainer}:/tmp/formula_db.dump"
            & $Docker exec $FormulaDbContainer pg_restore -U formula -d formula --clean --if-exists /tmp/formula_db.dump
            & $Docker exec $FormulaDbContainer rm -f /tmp/formula_db.dump
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[import] saltando bases de datos (IncludeDb=`$false o carpeta ausente)."
}

Write-Host "[import] Listo."
Write-Host "[import] Siguiente: provisionar dashboard_ro y levantar todo:"
Write-Host "[import]   docker compose up -d"
Write-Host "[import] Verificar: docker compose exec db psql -U sensors -d sensors_db -c `"SELECT * FROM auth_password_algo_status;`""
