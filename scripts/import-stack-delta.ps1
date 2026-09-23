# ==========================================================================
# import-stack-delta.ps1 — Aplica en esta laptop un paquete generado por
#   export-stack-delta.ps1: carga las imágenes que cambiaron, actualiza
#   docker-compose.yml, corre las migraciones de BD pendientes, y recrea
#   SOLO los contenedores afectados. Pensado para una laptop que YA tiene
#   un stack_export anterior importado (no un despliegue desde cero -- para
#   eso usar import-stack.ps1, ADR-111).
#
# Uso:
#   .\scripts\import-stack-delta.ps1 -ImportDir "D:\stack_export\20260921T...Z_delta"
#   .\scripts\import-stack-delta.ps1 -ImportDir "..." -RunMigrate:$false   # si ya las corriste
#   .\scripts\import-stack-delta.ps1 -ImportDir "..." -ApplyComposeFile:$false
#
# Orden recomendado:
#   1. Copiar la carpeta completa del export a esta laptop.
#   2. Correr este script.
#   3. Revisar 'docker compose ps' -- confirmar healthy.
#   4. Si el paquete trae avatar_engine Y avatar_animation_engine y esta GPU
#      no tiene VRAM para los dos a la vez (ver MIGRACION_NUEVA_LAPTOP.md):
#      decidir cuál dejar arriba y frenar el otro
#      ('docker compose stop avatar_animation_engine' o 'avatar_engine').
# ==========================================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$ImportDir,
    [bool]$ApplyComposeFile = $true,
    [bool]$RunMigrate = $true,
    [bool]$RecreateServices = $true,
    [string]$RepoRoot = "",
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
if ($ProjectName -eq "") {
    $ProjectName = (Split-Path -Leaf $RepoRoot).ToLower()
}

if (-not (Test-Path $ImportDir)) {
    Write-Error "ImportDir no existe: $ImportDir"
    exit 1
}
$ManifestPath = Join-Path $ImportDir "manifest.txt"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "No encuentro manifest.txt en $ImportDir -- ¿es una carpeta generada por export-stack-delta.ps1?"
    exit 1
}

Write-Host "[import-delta] docker: $Docker"
Write-Host "[import-delta] repo: $RepoRoot"
Write-Host "[import-delta] origen: $ImportDir"
Write-Host "[import-delta] manifiesto:"
$manifestLines = Get-Content $ManifestPath
$manifestLines | ForEach-Object { Write-Host "[import-delta]   $_" }

$servicesLine = $manifestLines | Where-Object { $_ -match '^services=' } | Select-Object -First 1
$Services = @()
if ($servicesLine) {
    $Services = ($servicesLine -replace '^services=', '') -split ',' | Where-Object { $_ -ne '' }
}

# --- 0. Verificación de integridad (mismo criterio que import-stack.ps1, ADR-111) ---
$ChecksumFile = Join-Path $ImportDir "checksums.sha256"
if (Test-Path $ChecksumFile) {
    Write-Host "[import-delta] verificando checksums.sha256..."
    $bad = @()
    $missing = @()
    foreach ($line in (Get-Content $ChecksumFile)) {
        if ($line -notmatch '^([0-9a-fA-F]{64})\s{2}(.+)$') { continue }
        $expected = $Matches[1].ToLower()
        $relPath = $Matches[2] -replace '/', '\'
        $fullPath = Join-Path $ImportDir $relPath
        if (-not (Test-Path $fullPath)) {
            $missing += $relPath
            continue
        }
        $actual = (Get-FileHash -Path $fullPath -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) { $bad += $relPath }
    }
    if ($missing.Count -gt 0) {
        Write-Warning "[import-delta] archivos listados en checksums.sha256 pero ausentes: $($missing -join ', ')"
    }
    if ($bad.Count -gt 0) {
        throw "[import-delta] VERIFICACION DE INTEGRIDAD FALLO -- archivo(s) modificado(s) o corrupto(s) desde el export: $($bad -join ', '). Import abortado antes de tocar Docker/BD."
    }
    Write-Host "[import-delta] checksums OK."
} else {
    Write-Warning "[import-delta] no hay checksums.sha256 en $ImportDir -- se importa SIN verificar integridad."
}

# --- 1. Cargar imágenes ------------------------------------------------------
$ImagesDir = Join-Path $ImportDir "images"
if (Test-Path $ImagesDir) {
    Get-ChildItem -Path $ImagesDir -Filter "*.tar.gz" | ForEach-Object {
        Write-Host "[import-delta] cargando $($_.Name) ..."
        & $Docker load -i $_.FullName
        if ($LASTEXITCODE -ne 0) { throw "docker load falló para $($_.Name)" }
    }
} else {
    Write-Warning "[import-delta] no hay carpeta images/ en el paquete."
}

# --- 2. docker-compose.yml ----------------------------------------------------
# Backup del compose actual de destino ANTES de pisarlo -- si algo sale mal
# después (por ejemplo .env le falta una var nueva que el compose nuevo
# exige con ${VAR:?...}), se puede volver atrás sin perder la config previa.
$newCompose = Join-Path $ImportDir "docker-compose.yml"
if ($ApplyComposeFile -and (Test-Path $newCompose)) {
    $targetCompose = Join-Path $RepoRoot "docker-compose.yml"
    if (Test-Path $targetCompose) {
        $backupPath = Join-Path $RepoRoot "docker-compose.yml.bak.$((Get-Date).ToString('yyyyMMddTHHmmss'))"
        Copy-Item $targetCompose $backupPath -Force
        Write-Host "[import-delta] docker-compose.yml actual respaldado en $backupPath"
    }
    Copy-Item $newCompose $targetCompose -Force
    Write-Host "[import-delta] docker-compose.yml actualizado."

    $newProdCompose = Join-Path $ImportDir "docker-compose.prod.yml"
    if (Test-Path $newProdCompose) {
        Copy-Item $newProdCompose (Join-Path $RepoRoot "docker-compose.prod.yml") -Force
        Write-Host "[import-delta] docker-compose.prod.yml actualizado."
    }
} else {
    Write-Host "[import-delta] saltando actualización de docker-compose.yml (ApplyComposeFile=`$false o no está en el paquete)."
}

# --- 3. db_scripts/ ------------------------------------------------------------
$newDbScripts = Join-Path $ImportDir "db_scripts"
if (Test-Path $newDbScripts) {
    $targetDbScripts = Join-Path $RepoRoot "db_scripts"
    Copy-Item -Path (Join-Path $newDbScripts "*") -Destination $targetDbScripts -Recurse -Force
    Write-Host "[import-delta] db_scripts/ sincronizado."
}

# --- 3b. scripts/apply_migrations.sh -------------------------------------------
# db-migrate lo monta como su propio entrypoint. Si esta laptop nunca lo tuvo,
# Docker Desktop puede haber creado una CARPETA FANTASMA vacía en ese path la
# primera vez que algo intentó montarlo (bug real de Docker-Windows con
# bind-mounts a un archivo que no existe en el host -- mismo patrón que ya
# afecta a db_scripts/*.sql renombrados, ver memoria del proyecto). Un
# Copy-Item normal falla silenciosamente contra eso -- hay que borrar la
# carpeta fantasma primero si existe.
$newApplyMigrations = Join-Path $ImportDir "scripts\apply_migrations.sh"
if (Test-Path $newApplyMigrations -PathType Leaf) {
    $targetApplyMigrations = Join-Path $RepoRoot "scripts\apply_migrations.sh"
    if ((Test-Path $targetApplyMigrations -PathType Container)) {
        Write-Warning "[import-delta] scripts/apply_migrations.sh es una carpeta fantasma vacia en esta laptop -- borrandola antes de copiar el archivo real."
        Remove-Item $targetApplyMigrations -Recurse -Force
    }
    Copy-Item $newApplyMigrations $targetApplyMigrations -Force
    Write-Host "[import-delta] scripts/apply_migrations.sh sincronizado."
} else {
    Write-Warning "[import-delta] el paquete no trae scripts/apply_migrations.sh -- si db-migrate falla al arrancar, es por esto (paquete generado con una version vieja de export-stack-delta.ps1)."
}

Push-Location $RepoRoot
try {
    # --- 4. Migraciones pendientes -------------------------------------------
    # apply_migrations.sh (ADR-131) es idempotente: compara checksum contra
    # schema_migrations y solo aplica lo que falta -- seguro correrlo aunque
    # la BD ya tenga algunos de estos scripts aplicados por otra vía.
    if ($RunMigrate) {
        Write-Host "[import-delta] corriendo migraciones pendientes (docker compose --profile migrate run --rm db-migrate)..."
        & $Docker compose --profile migrate run --rm db-migrate
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[import-delta] db-migrate devolvió errores -- revisar la salida arriba antes de seguir. Si la BD destino nunca corrió este runner, puede hacer falta '--record-only' una vez para establecer el baseline (ver cabecera de scripts/apply_migrations.sh)."
        }
    } else {
        Write-Host "[import-delta] saltando migraciones (RunMigrate=`$false)."
    }

    # --- 5. Recrear SOLO los servicios que trajo el paquete -------------------
    if ($RecreateServices -and $Services.Count -gt 0) {
        Write-Host "[import-delta] recreando servicios: $($Services -join ', ')..."
        # avatar_animation_engine vive gateado por 'profiles: ["avatar-animation"]'
        # -- sin --profile no arranca aunque esté en la lista, se queda
        # silenciosamente afuera del 'up'.
        $profileArgs = @()
        if ($Services -contains "avatar_animation_engine") {
            $profileArgs += @("--profile", "avatar-animation")
        }
        & $Docker compose @profileArgs up -d --force-recreate $Services
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[import-delta] 'docker compose up' devolvió errores -- revisar la salida arriba."
        }
    } else {
        Write-Host "[import-delta] saltando recreación de contenedores (RecreateServices=`$false o manifest sin 'services=')."
    }
} finally {
    Pop-Location
}

Write-Host "[import-delta] Listo."
Write-Host "[import-delta] Verificar: docker compose ps"
Write-Host "[import-delta] Si el paquete trajo avatar_engine Y avatar_animation_engine, confirmar que esta GPU aguanta los dos a la vez (VRAM) -- si no, frenar uno con 'docker compose stop <servicio>'."
Write-Host "[import-delta] Confirmar que .env tiene BEEMETRY_FORMULA_AUTH_TOKEN definido (ahora también lo exige el servicio 'web', antes solo 'formula_engine')."
