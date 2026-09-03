$ErrorActionPreference = 'Stop'

$projectDir = 'C:\InformeCliente'
$envFile = Join-Path $projectDir '.env'
$composeFile = Join-Path $projectDir 'docker-compose.yml'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultDir = Join-Path $projectDir "auditoria-base-datos-$timestamp"
$transcript = Join-Path $resultDir 'auditoria-completa.log'
$summary = Join-Path $resultDir 'RESUMEN.txt'
$failures = [System.Collections.Generic.List[string]]::new()

$dockerCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    'C:\DockerDesktop\resources\bin\docker.exe',
    'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
)
$docker = $dockerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
Start-Transcript -LiteralPath $transcript -Force

function Invoke-DockerText {
    param([string[]]$Arguments, [string]$TestName)
    $output = & $docker @Arguments 2>&1
    $code = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($code -ne 0) {
        $failures.Add("$TestName (codigo $code)")
    }
    return @($output)
}

function Invoke-SqlFile {
    param(
        [string]$Container,
        [string]$User,
        [string]$Database,
        [string]$Sql,
        [string]$OutputFile,
        [string]$TestName
    )
    $output = & $docker exec $Container psql -X -U $User -d $Database `
        -v ON_ERROR_STOP=1 -P pager=off -c $Sql 2>&1
    $code = $LASTEXITCODE
    $output | Set-Content -LiteralPath $OutputFile -Encoding UTF8
    $output | ForEach-Object { Write-Host $_ }
    if ($code -ne 0) {
        $failures.Add("$TestName (codigo $code)")
    }
}

function Audit-Database {
    param(
        [string]$Container,
        [string]$User,
        [string]$Database,
        [string]$Prefix
    )

    Write-Host "`n=== AUDITORIA $Database ===" -ForegroundColor Cyan

    Invoke-SqlFile $Container $User $Database `
        "BEGIN READ ONLY; SELECT current_database(), current_user, version(), pg_is_in_recovery() AS replica; COMMIT;" `
        (Join-Path $resultDir "$Prefix-01-conexion.txt") "$Database conexion"

    Invoke-SqlFile $Container $User $Database `
        "SELECT extname, extversion FROM pg_extension ORDER BY extname;" `
        (Join-Path $resultDir "$Prefix-02-extensiones.txt") "$Database extensiones"

    Invoke-SqlFile $Container $User $Database `
        "SELECT schemaname, count(*) AS tablas FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') GROUP BY schemaname ORDER BY schemaname;" `
        (Join-Path $resultDir "$Prefix-03-inventario-tablas.txt") "$Database inventario tablas"

    $countSql = @"
\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
\pset pager off
SELECT format('SELECT %L AS tabla, count(*) AS filas FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename;
\gexec
"@
    $countOutput = $countSql | & $docker exec -i $Container psql -X -U $User -d $Database -v ON_ERROR_STOP=1 2>&1
    $countCode = $LASTEXITCODE
    $countOutput | Set-Content -LiteralPath (Join-Path $resultDir "$Prefix-04-conteo-todas-tablas.txt") -Encoding UTF8
    if ($countCode -ne 0) { $failures.Add("$Database conteo de todas las tablas (codigo $countCode)") }

    $readSql = @"
\pset tuples_only on
\pset pager off
SELECT format('SELECT 1 FROM %I.%I LIMIT 1;', schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename;
\gexec
"@
    $readOutput = $readSql | & $docker exec -i $Container psql -X -U $User -d $Database -v ON_ERROR_STOP=1 2>&1
    $readCode = $LASTEXITCODE
    $readOutput | Set-Content -LiteralPath (Join-Path $resultDir "$Prefix-05-lectura-todas-tablas.txt") -Encoding UTF8
    if ($readCode -ne 0) { $failures.Add("$Database lectura de todas las tablas (codigo $readCode)") }

    $viewSql = @"
\pset tuples_only on
\pset pager off
SELECT format('SELECT * FROM %I.%I LIMIT 0;', schemaname, viewname)
FROM pg_views
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, viewname;
\gexec
"@
    $viewOutput = $viewSql | & $docker exec -i $Container psql -X -U $User -d $Database -v ON_ERROR_STOP=1 2>&1
    $viewCode = $LASTEXITCODE
    $viewOutput | Set-Content -LiteralPath (Join-Path $resultDir "$Prefix-06-vistas.txt") -Encoding UTF8
    if ($viewCode -ne 0) { $failures.Add("$Database vistas (codigo $viewCode)") }

    Invoke-SqlFile $Container $User $Database `
        "SELECT n.nspname AS esquema, c.relname AS tabla, con.conname, con.contype FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT con.convalidated ORDER BY 1,2,3;" `
        (Join-Path $resultDir "$Prefix-07-restricciones-no-validadas.txt") "$Database restricciones"

    Invoke-SqlFile $Container $User $Database `
        "SELECT schemaname, relname, seq_scan, idx_scan, n_live_tup, n_dead_tup FROM pg_stat_user_tables ORDER BY schemaname, relname;" `
        (Join-Path $resultDir "$Prefix-08-estadisticas-tablas.txt") "$Database estadisticas"

    Invoke-SqlFile $Container $User $Database `
        "SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit, deadlocks, temp_files FROM pg_stat_database WHERE datname=current_database();" `
        (Join-Path $resultDir "$Prefix-09-salud-base.txt") "$Database salud"
}

try {
    if (-not $docker) { throw 'No se encontro docker.exe.' }
    if (-not (Test-Path -LiteralPath $envFile)) { throw "No existe $envFile" }
    if (-not (Test-Path -LiteralPath $composeFile)) { throw "No existe $composeFile" }

    Write-Host '=== DOCKER Y CONTENEDORES ===' -ForegroundColor Cyan
    Invoke-DockerText @('version') 'Docker version' | Set-Content (Join-Path $resultDir '00-docker-version.txt')
    Invoke-DockerText @('compose','--env-file',$envFile,'-f',$composeFile,'ps','db','formula_db') 'Contenedores' |
        Set-Content (Join-Path $resultDir '00-contenedores.txt')
    Invoke-DockerText @('inspect','--format','{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}','beemetry-db','beemetry-formula-db') 'Salud contenedores' |
        Set-Content (Join-Path $resultDir '00-salud-contenedores.txt')

    Audit-Database 'beemetry-db' 'sensors' 'sensors_db' 'sensors-db'
    Audit-Database 'beemetry-formula-db' 'formula' 'formula' 'formula-db'

    Invoke-SqlFile 'beemetry-db' 'sensors' 'sensors_db' `
        "SELECT extname, extversion FROM pg_extension WHERE extname='timescaledb'; SELECT hypertable_schema, hypertable_name, num_dimensions, num_chunks, compression_enabled FROM timescaledb_information.hypertables ORDER BY 1,2; SELECT job_id, application_name, schedule_interval, scheduled FROM timescaledb_information.jobs ORDER BY job_id;" `
        (Join-Path $resultDir 'sensors-db-10-timescaledb.txt') 'TimescaleDB'

    $containerLogs = & $docker logs --since 30m beemetry-db 2>&1
    $containerLogs | Set-Content -LiteralPath (Join-Path $resultDir 'sensors-db-11-logs-30m.txt') -Encoding UTF8
    $formulaLogs = & $docker logs --since 30m beemetry-formula-db 2>&1
    $formulaLogs | Set-Content -LiteralPath (Join-Path $resultDir 'formula-db-10-logs-30m.txt') -Encoding UTF8

    $status = if ($failures.Count -eq 0) { 'APROBADO' } else { 'CON FALLOS' }
    @(
        "AUDITORIA BASE DE DATOS: $status",
        "Fecha: $(Get-Date -Format o)",
        "Proyecto: $projectDir",
        "Resultados: $resultDir",
        "Fallos detectados: $($failures.Count)",
        ($failures | ForEach-Object { "- $_" })
    ) | Set-Content -LiteralPath $summary -Encoding UTF8

    Write-Host "`nRESULTADO: $status" -ForegroundColor $(if ($failures.Count -eq 0) { 'Green' } else { 'Red' })
    if ($failures.Count) { $failures | ForEach-Object { Write-Host "- $_" -ForegroundColor Red } }
    Write-Host "Resultados guardados en: $resultDir" -ForegroundColor Cyan
}
finally {
    Stop-Transcript
    Read-Host 'Presione Enter para cerrar'
}
