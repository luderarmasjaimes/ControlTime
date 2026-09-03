$ErrorActionPreference = 'Stop'

$projectDir = 'C:\InformeCliente'
$composeFile = Join-Path $projectDir 'docker-compose.yml'
$envFile = Join-Path $projectDir '.env'
$logFile = Join-Path $projectDir 'INSTALACION_BASE_DATOS.log'
$dockerCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    'C:\DockerDesktop\resources\bin\docker.exe',
    'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
)
$docker = $dockerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $docker) { throw 'No se encontro docker.exe.' }
if (-not (Test-Path -LiteralPath $composeFile)) { throw "No existe $composeFile" }
if (-not (Test-Path -LiteralPath $envFile)) { throw "No existe $envFile" }

Start-Transcript -LiteralPath $logFile -Force
try {
    Write-Host "Docker: $docker" -ForegroundColor Cyan
    Write-Host "Proyecto: $projectDir" -ForegroundColor Cyan

    & $docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        $desktopCandidates = @(
            (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
            'C:\DockerDesktop\Docker Desktop.exe',
            'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        )
        $desktop = $desktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $desktop) { throw 'Docker Desktop esta instalado, pero el motor no responde.' }

        Write-Host 'Iniciando Docker Desktop...' -ForegroundColor Yellow
        Start-Process -FilePath $desktop | Out-Null
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 5
            & $docker info *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        }
        if (-not $ready) { throw 'Docker Desktop no quedo listo despues de 5 minutos.' }
    }

    Write-Host 'Validando Docker Compose y variables del proyecto...' -ForegroundColor Cyan
    & $docker compose --env-file $envFile -f $composeFile config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'docker compose config detecto una configuracion invalida.' }

    Write-Host 'Volumenes existentes antes del arranque:' -ForegroundColor Cyan
    & $docker volume ls --format '{{.Name}}' | Where-Object { $_ -match 'informecliente|beemetry|formula|db_data' }

    Write-Host 'Descargando PostgreSQL 15 y TimescaleDB compatibles...' -ForegroundColor Cyan
    & $docker compose --env-file $envFile -f $composeFile pull db formula_db
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron descargar las imagenes de base de datos.' }

    Write-Host 'Levantando db y formula_db sin eliminar volumenes existentes...' -ForegroundColor Cyan
    & $docker compose --env-file $envFile -f $composeFile up -d db formula_db
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron levantar los contenedores de base de datos.' }

    function Wait-Healthy {
        param([string]$Container, [int]$Seconds = 240)
        $attempts = [Math]::Ceiling($Seconds / 4)
        for ($i = 0; $i -lt $attempts; $i++) {
            $status = (& $docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Container 2>$null)
            if ($status -eq 'healthy') { return }
            if ($status -eq 'exited' -or $status -eq 'dead') {
                & $docker logs --tail 120 $Container
                throw "$Container termino con estado $status"
            }
            Start-Sleep -Seconds 4
        }
        & $docker logs --tail 120 $Container
        throw "$Container no alcanzo estado healthy."
    }

    Wait-Healthy -Container 'beemetry-db'
    Wait-Healthy -Container 'beemetry-formula-db'

    Write-Host 'Consultas de verificacion en sensors_db:' -ForegroundColor Cyan
    & $docker exec beemetry-db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, version();'
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la consulta de conexion a sensors_db.' }
    & $docker exec beemetry-db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb','pgcrypto');"
    & $docker exec beemetry-db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -c "SELECT schemaname, count(*) AS tables FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') GROUP BY schemaname ORDER BY schemaname;"

    Write-Host 'Consultas de verificacion en formula_db:' -ForegroundColor Cyan
    & $docker exec beemetry-formula-db psql -U formula -d formula -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, version();'
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la consulta de conexion a formula_db.' }
    & $docker exec beemetry-formula-db psql -U formula -d formula -v ON_ERROR_STOP=1 -c "SELECT schemaname, count(*) AS tables FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') GROUP BY schemaname ORDER BY schemaname;"

    Write-Host 'Estado final:' -ForegroundColor Cyan
    & $docker compose --env-file $envFile -f $composeFile ps db formula_db

    Write-Host ''
    Write-Host 'Las dos bases estan encendidas y aceptan consultas.' -ForegroundColor Green
    Write-Host "Registro: $logFile" -ForegroundColor Green
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    throw
}
finally {
    Stop-Transcript
    Read-Host 'Presione Enter para cerrar'
}
