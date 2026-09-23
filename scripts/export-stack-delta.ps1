# ==========================================================================
# export-stack-delta.ps1 — Export PERSONALIZADO para actualizar una laptop
#   que ya tiene un stack_export previo importado (no un despliegue desde
#   cero -- para eso usar export-stack.ps1/import-stack.ps1, ADR-111).
#
#   Nace del backup 20260918T020337Z_backend-only (manual, 4 imágenes:
#   web/ai_engine/silentface_engine/formula_engine, sin compose file, sin
#   volúmenes, sin BD) que nunca se llegó a aplicar en la segunda laptop.
#   En vez de repetir un export completo (15 imágenes, ~90GB, la mayoría
#   sin cambios reales), este script:
#     1. Detecta qué imágenes están REALMENTE desactualizadas comparando
#        el `Created` de cada imagen contra el archivo más nuevo de su
#        contexto de build (ver Get-ContextNewestMtime) -- no confía en que
#        el tag ":latest" exista, confía en las fechas.
#     2. Rebuildea SOLO esas (a menos que -Rebuild:$false).
#     3. Exporta SOLO -Services (default: las que de verdad cambiaron desde
#        el backend-only del 18-Sep -- ver header de $DefaultServices abajo).
#     4. Copia docker-compose.yml -- export-stack.ps1 NUNCA lo hace (viaja
#        con git), y esa omisión causó un incidente real documentado en
#        MIGRACION_NUEVA_LAPTOP_2026-08-12.md ("Actualización 2026-09-14"):
#        imágenes nuevas sin servicio que las use porque el compose de la
#        laptop destino había quedado viejo. Acá viaja igual aunque nada
#        esté commiteado -- es exactamente el estado real que hay que
#        reproducir en destino.
#     5. Copia db_scripts/ completo (no intenta acertar el rango numérico --
#        apply_migrations.sh (ADR-131) es idempotente por checksum contra
#        schema_migrations, así que de más no rompe nada).
#   NO exporta volúmenes: los cachés de modelos (diffusion_avatar_cache,
#   avatar_animation_*_cache, paddleocr_model_cache) se autodescargan en el
#   primer arranque de cada contenedor -- mismo criterio que ya usan
#   formula_engine/silentface_engine desde siempre. Si preferís no esperar
#   esa descarga en destino, usar export-stack.ps1 -IncludeVolumes:$true
#   aparte.
#
# Uso:
#   .\scripts\export-stack-delta.ps1
#   .\scripts\export-stack-delta.ps1 -ExportDir "C:\InformeCliente\stack_export"
#   .\scripts\export-stack-delta.ps1 -Services @("web","ocr_engine")
#   .\scripts\export-stack-delta.ps1 -Rebuild:$false   # exporta tal cual está, no rebuildea nada
#   .\scripts\export-stack-delta.ps1 -IncludeFrontend   # si por esta vez no lo mandás por .rar
#
# IMPORTANTE -- espacio en disco: D: puede estar casi lleno (verificado
#   2026-09-21: 18GB libres de 476GB). El default de -ExportDir de abajo
#   apunta a C:\InformeCliente\stack_export, igual que el backup anterior --
#   NUNCA lo dejes caer en $RepoRoot\stack_export si $RepoRoot vive en D:.
# ==========================================================================
param(
    # OJO: "C:\InformeCliente" es un symlink a D:\InformeCliente en esta
    # máquina (creado 2026-08-13, `ls -la` lo confirma) -- escribir ahí NO
    # usa espacio de C:, usa el D: que ya está casi lleno. Bug real
    # encontrado 2026-09-21: 3 exports seguidos a "C:\InformeCliente\..."
    # dejaron D: en 4.5GB libres sin que nadie lo notara hasta que
    # `docker save` de una imagen de 5GB no entró. Default real en C:,
    # fuera del symlink.
    [string]$ExportDir = "C:\DockerExports\stack_export",
    # Servicios con cambios reales desde el export backend-only del
    # 2026-09-18 (ver tabla de la investigación) -- formula_engine y
    # silentface_engine quedan afuera del default porque su imagen ya viajó
    # entonces y su fuente no cambió desde. frontend queda afuera del
    # default porque se sigue mandando aparte (.rar) -- usar -IncludeFrontend.
    [string[]]$Services = @("web", "ai_engine", "avatar_engine", "avatar_animation_engine", "ocr_engine", "pdf_export"),
    [switch]$IncludeFrontend,
    [bool]$Rebuild = $true,
    [string]$RepoRoot = "",
    [string]$ProjectName = ""
)

$ErrorActionPreference = "Stop"

# Contexto de build + nombre de imagen de cada servicio -- copiado de
# docker-compose.yml (`build.context` / `image:`), no hay forma de
# descubrir esto en vivo sin invocar `docker compose config` por servicio,
# que es mucho más lento que una tabla fija de 9 entradas conocidas.
$ServiceMap = @{
    "web"                     = @{ Context = "backend"; Image = "informecliente-web:latest" }
    "ai_engine"               = @{ Context = "ai_engine"; Image = "informe-ai-engine:latest" }
    "formula_engine"          = @{ Context = "formula_engine"; Image = "informecliente-formula_engine:latest" }
    "silentface_engine"       = @{ Context = "silentface_engine"; Image = "informe-silentface-engine:latest" }
    "ocr_engine"              = @{ Context = "ocr_engine"; Image = "informe-ocr-engine:latest" }
    "avatar_engine"           = @{ Context = "avatar_engine"; Image = "informe-avatar-engine:latest" }
    "avatar_animation_engine" = @{ Context = "avatar_animation_engine"; Image = "informe-avatar-animation-engine:latest" }
    "frontend"                = @{ Context = "frontend"; Image = "informecliente-frontend:latest" }
    "pdf_export"              = @{ Context = "pdf-export-service"; Image = "informecliente-pdf_export:latest" }
}

if ($IncludeFrontend -and ($Services -notcontains "frontend")) {
    $Services += "frontend"
}

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

function Get-ContextNewestMtime {
    # Ignora __pycache__/node_modules/.git/dist/build -- ruido que no forma
    # parte de lo que realmente entra a la imagen (COPY del Dockerfile).
    param([string]$ContextPath)
    $newest = Get-ChildItem -Path $ContextPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\__pycache__\\|\\node_modules\\|\\\.git\\|\\dist\\|\\build\\' } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($newest) { return $newest.LastWriteTimeUtc }
    return $null
}

function Add-Checksum {
    param([string]$FilePath, [string]$ExportRoot)
    $hash = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
    $fullFile = [System.IO.Path]::GetFullPath($FilePath)
    $fullRoot = [System.IO.Path]::GetFullPath($ExportRoot)
    $rel = $fullFile.Substring($fullRoot.Length).TrimStart('\', '/') -replace '\\', '/'
    return "$hash  $rel"
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

foreach ($svc in $Services) {
    if (-not $ServiceMap.ContainsKey($svc)) {
        throw "Servicio desconocido: '$svc'. Válidos: $($ServiceMap.Keys -join ', ')"
    }
}

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$ExportDir = Join-Path $ExportDir "${Timestamp}_delta"
$ImagesDir = Join-Path $ExportDir "images"
New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null

Write-Host "[export-delta] docker: $Docker"
Write-Host "[export-delta] repo: $RepoRoot"
Write-Host "[export-delta] destino: $ExportDir"
Write-Host "[export-delta] servicios: $($Services -join ', ')"

# --- 0. Advertencia de espacio en disco --------------------------------------
$exportDrive = (Get-Item $ExportDir).PSDrive
if ($exportDrive) {
    $freeGb = [math]::Round($exportDrive.Free / 1GB, 1)
    if ($freeGb -lt 30) {
        Write-Warning "[export-delta] solo ${freeGb}GB libres en $($exportDrive.Name): -- las imágenes ML (ai_engine/avatar_engine/avatar_animation_engine) pesan 14-15GB CADA UNA sin comprimir. Si esto falla a mitad de camino, liberar espacio o pasar -ExportDir a otro disco."
    }
}

# --- 1. Rebuild de lo que esté desactualizado --------------------------------
Push-Location $RepoRoot
try {
    foreach ($svc in $Services) {
        $map = $ServiceMap[$svc]
        $contextPath = Join-Path $RepoRoot $map.Context
        $imageName = $map.Image

        $imageCreated = $null
        $imageExists = & $Docker image inspect $imageName 2>$null
        if ($imageExists) {
            $createdStr = & $Docker image inspect $imageName --format '{{.Created}}'
            $imageCreated = [DateTime]::Parse($createdStr).ToUniversalTime()
        }

        $newestSource = Get-ContextNewestMtime -ContextPath $contextPath
        $isStale = (-not $imageCreated) -or ($newestSource -and $newestSource -gt $imageCreated)

        if ($isStale) {
            if (-not $Rebuild) {
                Write-Warning "[export-delta] $svc parece desactualizada (fuente más nueva que la imagen) pero -Rebuild:`$false -- se exporta tal cual está en disco."
            } else {
                Write-Host "[export-delta] $svc desactualizada -- rebuildeando (docker compose build $svc)..."
                & $Docker compose build $svc
                if ($LASTEXITCODE -ne 0) { throw "docker compose build $svc falló" }
            }
        } else {
            Write-Host "[export-delta] $svc ya está al día (imagen del $imageCreated, fuente más nueva del $newestSource)."
        }
    }
} finally {
    Pop-Location
}

# --- 2. Exportar imágenes -----------------------------------------------------
$ChecksumLines = @()
foreach ($svc in $Services) {
    $imageName = $ServiceMap[$svc].Image
    $exists = & $Docker image inspect $imageName 2>$null
    if (-not $exists) {
        Write-Warning "[export-delta] imagen '$imageName' ($svc) no existe localmente -- se salta."
        continue
    }
    $safeName = $imageName -replace '[/:]', '_'
    Write-Host "[export-delta] imagen $imageName ($svc) -> images/$safeName.tar.gz ..."
    $tmpTar = Join-Path $ImagesDir "$safeName.tar"
    & $Docker save -o $tmpTar $imageName
    if ($LASTEXITCODE -ne 0) { throw "docker save falló para $imageName" }
    # GZipStream de .NET directo sobre los bytes del .tar -- NUNCA
    # `tar -czf` envolviendo el .tar (tar-dentro-de-tar), bug real
    # documentado en ADR-111 que corrompía las 15 imágenes de un export.
    $inStream = [System.IO.File]::OpenRead($tmpTar)
    $outStream = [System.IO.File]::Create("$tmpTar.gz")
    $gzipStream = New-Object System.IO.Compression.GzipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
    try {
        $inStream.CopyTo($gzipStream)
    } finally {
        $gzipStream.Close()
        $outStream.Close()
        $inStream.Close()
    }
    Remove-Item $tmpTar -Force
    $ChecksumLines += Add-Checksum -FilePath "$tmpTar.gz" -ExportRoot $ExportDir
}

# --- 3. docker-compose.yml (+ .prod si existe) -------------------------------
# export-stack.ps1 NUNCA copia esto (viaja con git) -- acá SÍ, a propósito:
# es la causa documentada de un incidente real (MIGRACION_NUEVA_LAPTOP,
# "Actualización 2026-09-14": imágenes nuevas sin servicio que las use
# porque el compose de destino había quedado viejo).
Copy-Item (Join-Path $RepoRoot "docker-compose.yml") (Join-Path $ExportDir "docker-compose.yml") -Force
$ChecksumLines += Add-Checksum -FilePath (Join-Path $ExportDir "docker-compose.yml") -ExportRoot $ExportDir
Write-Host "[export-delta] docker-compose.yml copiado."

$prodCompose = Join-Path $RepoRoot "docker-compose.prod.yml"
if (Test-Path $prodCompose) {
    Copy-Item $prodCompose (Join-Path $ExportDir "docker-compose.prod.yml") -Force
    $ChecksumLines += Add-Checksum -FilePath (Join-Path $ExportDir "docker-compose.prod.yml") -ExportRoot $ExportDir
}

# --- 4. db_scripts/ completo ---------------------------------------------------
# Todo el árbol, no un rango calculado a mano -- apply_migrations.sh
# (ADR-131) trackea checksum por archivo en schema_migrations y omite lo ya
# aplicado, así que copiar de más es inofensivo y evita el error real de la
# vez pasada (rango "97 a 105" a mano, aplicado vía psql).
$DbScriptsSrc = Join-Path $RepoRoot "db_scripts"
$DbScriptsDst = Join-Path $ExportDir "db_scripts"
Copy-Item $DbScriptsSrc $DbScriptsDst -Recurse -Force
Get-ChildItem -Path $DbScriptsDst -Filter "*.sql" -Recurse | ForEach-Object {
    $ChecksumLines += Add-Checksum -FilePath $_.FullName -ExportRoot $ExportDir
}

# El servicio db-migrate (docker-compose.yml) monta este archivo como su
# propio entrypoint (./scripts/apply_migrations.sh:/apply_migrations.sh:ro)
# -- sin él, `docker compose --profile migrate run db-migrate` no arranca.
# Bug real encontrado 2026-09-21: si el destino nunca tuvo este archivo,
# Docker Desktop en Windows crea una CARPETA FANTASMA vacía en el host en
# vez de fallar el mount -- import-stack-delta.ps1 la detecta y la borra
# antes de copiar el archivo real.
$ScriptsDir = Join-Path $ExportDir "scripts"
New-Item -ItemType Directory -Force -Path $ScriptsDir | Out-Null
$applyMigrationsSrc = Join-Path $RepoRoot "scripts\apply_migrations.sh"
if (Test-Path $applyMigrationsSrc -PathType Leaf) {
    Copy-Item $applyMigrationsSrc (Join-Path $ScriptsDir "apply_migrations.sh") -Force
    $ChecksumLines += Add-Checksum -FilePath (Join-Path $ScriptsDir "apply_migrations.sh") -ExportRoot $ExportDir
    Write-Host "[export-delta] scripts/apply_migrations.sh copiado."
} else {
    Write-Warning "[export-delta] scripts/apply_migrations.sh no existe (o es una carpeta fantasma) en $RepoRoot -- db-migrate no va a poder arrancar ni acá ni en destino. Revisar con 'git checkout -- scripts/apply_migrations.sh'."
}
Write-Host "[export-delta] db_scripts/ copiado ($(($ChecksumLines | Where-Object {$_ -match 'db_scripts'}).Count) archivos .sql)."

# --- 5. Manifiesto + checksums -------------------------------------------------
$gitCommit = try { (& git -C $RepoRoot rev-parse HEAD 2>$null) } catch { "sin-git" }
if (-not $gitCommit) { $gitCommit = "sin-git" }
$gitDirty = (& git -C $RepoRoot status --porcelain 2>$null)
$commitNote = if ($gitDirty) { "SIN COMMITEAR -- $(@($gitDirty).Count) archivos con cambios locales" } else { "limpio" }

@"
project=$ProjectName
kind=delta
exported_at=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
based_on=C:\InformeCliente\stack_export\20260918T020337Z_backend-only
services=$($Services -join ',')
excluded=$((($ServiceMap.Keys | Where-Object { $Services -notcontains $_ }) -join ','))
git_commit=$gitCommit
git_status=$commitNote
note=Incluye docker-compose.yml + db_scripts/ completo. En destino: aplicar compose, correr 'docker compose --profile migrate run --rm db-migrate', luego 'docker compose up -d --force-recreate <servicios>'. NO incluye volumenes -- avatar_engine/avatar_animation_engine/ocr_engine autodescargan sus modelos en el primer arranque. avatar_engine y avatar_animation_engine comparten GPU: confirmar en destino si entran juntos o hay que elegir uno (ver docker-compose.yml comentarios).
"@ | Set-Content -Path (Join-Path $ExportDir "manifest.txt")

if ($ChecksumLines.Count -gt 0) {
    $checksumText = ($ChecksumLines -join "`n") + "`n"
    [System.IO.File]::WriteAllText((Join-Path $ExportDir "checksums.sha256"), $checksumText, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[export-delta] checksums.sha256 escrito ($($ChecksumLines.Count) archivos)."
}

$totalSize = (Get-ChildItem -Path $ExportDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalSizeGb = [math]::Round($totalSize / 1GB, 2)
Write-Host "[export-delta] Listo. Tamaño total: ${totalSizeGb} GB en $ExportDir"
Write-Host "[export-delta] Siguiente paso: copiar esta carpeta a la laptop destino y correr import-stack-delta.ps1 -ImportDir <esta carpeta>"
