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
#      -- con IncludeDb (default), esto YA hace `docker compose up -d`
#      completo, levanta db_replica y provisiona el rol dashboard_ro
#      (2026-09-02: antes eran los pasos 3-4 manuales de acá, fáciles de
#      saltarse -- sin ellos, los endpoints que leen de la réplica fallan
#      con 500 "db_unavailable" sin dejar rastro en logs).
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

# --- 0. Verificación de integridad (ADR-111) --------------------------------
# Falla ANTES de tocar Docker/BD si algún archivo cambió desde el export --
# un dump corrupto detectado a mitad de pg_restore ya dejó el volumen en
# estado intermedio; acá se corta antes de empezar.
$ChecksumFile = Join-Path $ImportDir "checksums.sha256"
if (Test-Path $ChecksumFile) {
    Write-Host "[import] verificando checksums.sha256..."
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
        Write-Warning "[import] archivos listados en checksums.sha256 pero ausentes (¿export parcial con -Include...:`$false?): $($missing -join ', ')"
    }
    if ($bad.Count -gt 0) {
        throw "[import] VERIFICACION DE INTEGRIDAD FALLO -- archivo(s) modificado(s) o corrupto(s) desde el export: $($bad -join ', '). Import abortado antes de tocar Docker/BD."
    }
    Write-Host "[import] checksums OK."
} else {
    Write-Warning "[import] no hay checksums.sha256 en $ImportDir (export generado antes de este cambio, o -IncludeImages/-IncludeVolumes/-IncludeDb en $false para todo) -- se importa SIN verificar integridad."
}

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
        # El .tar.gz se copia PRIMERO adentro del contenedor con `docker cp`
        # (transferencia atómica, no streaming) y recién ahí se extrae --
        # nunca leyendo directo desde la carpeta del host vía bind mount:
        # con archivos grandes (ollama_data) el puente WSL2<->Windows puede
        # cortarse a mitad de camino. Mismo criterio que export-stack.ps1.
        $helperName = "beemetry-import-$volName-$PID"
        & $Docker create --name $helperName -v "${fullVol}:/to" alpine sh -c "rm -rf /to/* /to/..?* /to/.[!.]* 2>/dev/null; tar xzf /tmp/$($_.Name) -C /to" | Out-Null
        & $Docker cp $_.FullName "${helperName}:/tmp/$($_.Name)"
        $restoreExit = $LASTEXITCODE
        if ($restoreExit -eq 0) {
            & $Docker start -a $helperName
            $restoreExit = $LASTEXITCODE
        }
        & $Docker rm -f $helperName | Out-Null
        if ($restoreExit -ne 0) { throw "restauración del volumen $fullVol falló" }
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

        # --- 4. Levantar el resto del stack (incl. db_replica) y provisionar
        #     dashboard_ro -- confirmado en vivo 2026-09-02: sin esto, el rol
        #     dashboard_ro no existe en el destino (los roles son objetos de
        #     CLUSTER, no de base de datos -- pg_dump/pg_restore de sensors_db
        #     NUNCA los incluye), BEEMETRY_REPLICA_DATABASE_URL falla el login
        #     contra db_replica, y los endpoints que leen de la réplica
        #     (wizard de telemetría, KPIs) devuelven 500 "db_unavailable" SIN
        #     dejar ningún rastro en logs (es un return controlado en el
        #     handler, no una excepción). Antes esto quedaba como paso manual
        #     "3" separado (fácil de saltarse); ahora es parte del import.
        Write-Host "[import] levantando el resto del stack (incl. db_replica)..."
        & $Docker compose up -d
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[import] 'docker compose up -d' devolvió errores -- revisá la salida arriba."
        }

        Write-Host "[import] esperando a que db_replica esté healthy..."
        $replicaCid = (& $Docker compose ps -q db_replica).Trim()
        if ($replicaCid) {
            $replicaStatus = ""
            for ($i = 0; $i -lt 40; $i++) {
                $replicaStatus = (& $Docker inspect --format='{{.State.Health.Status}}' $replicaCid 2>$null)
                if ($replicaStatus -eq "healthy") { break }
                Start-Sleep -Seconds 3
            }
            if ($replicaStatus -ne "healthy") {
                Write-Warning "[import] db_replica no llegó a 'healthy' tras 2 min -- dashboard_ro puede tardar en poder leer de ahí (o revisar 'docker compose ps')."
            }
        } else {
            Write-Warning "[import] no encuentro el contenedor db_replica -- saltando provisión de dashboard_ro, correr scripts/provision-dashboard-ro.sh a mano cuando esté arriba."
        }

        if ($replicaCid) {
            $roPassword = $env:BEEMETRY_DASHBOARD_RO_PASSWORD
            if (-not $roPassword) {
                $envFile = Join-Path $RepoRoot ".env"
                if (Test-Path $envFile) {
                    $envLine = Get-Content $envFile | Where-Object { $_ -match '^BEEMETRY_DASHBOARD_RO_PASSWORD=' } | Select-Object -First 1
                    if ($envLine) { $roPassword = $envLine -replace '^BEEMETRY_DASHBOARD_RO_PASSWORD=', '' }
                }
            }
            $sqlPath = Join-Path $RepoRoot "db_scripts\40_dashboard_ro_role.sql"
            if (-not $roPassword) {
                Write-Warning "[import] BEEMETRY_DASHBOARD_RO_PASSWORD no definido (ni en entorno ni en .env) -- saltando provisión de dashboard_ro. Correr scripts/provision-dashboard-ro.sh a mano."
            } elseif (-not (Test-Path $sqlPath)) {
                Write-Warning "[import] no encuentro $sqlPath -- saltando provisión de dashboard_ro."
            } else {
                Write-Host "[import] provisionando rol dashboard_ro (lectura de réplica)..."
                # `<` de redirección no existe en PowerShell (operador
                # reservado) -- el SQL es texto plano (no binario como
                # pg_dump/gzip), así que pipearlo por Get-Content es seguro acá.
                $escapedPassword = $roPassword -replace "'", "''"
                Get-Content -Raw $sqlPath | & $Docker exec -i $DbContainer psql -U sensors -d sensors_db -v "ro_password='$escapedPassword'" -v ON_ERROR_STOP=1
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "[import] provisión de dashboard_ro falló -- correr scripts/provision-dashboard-ro.sh a mano y revisar la salida."
                } else {
                    Write-Host "[import] dashboard_ro OK. Reiniciando 'web' para que tome la réplica..."
                    & $Docker compose up -d --force-recreate web
                }
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[import] saltando bases de datos (IncludeDb=`$false o carpeta ausente)."
}

Write-Host "[import] Listo."
Write-Host "[import] Verificar: docker compose exec db psql -U sensors -d sensors_db -c `"SELECT * FROM auth_password_algo_status;`""
