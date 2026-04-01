# Alinea la BD con el flujo normal de login (hashPassword + face_template + usuarios Minera Raura).
# 1) 07_auth_login_operacion.sql — esquema y hashes; upsert bastian_admin (admin123).
# 2) 06_seed_users_raura.sql — resto de usuarios demo (Demo1234!); ON CONFLICT DO NOTHING en dni.
#
# Uso (repo levantado, contenedor db arriba): .\scripts\apply-db-auth-login.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Invoke-PsqlFile {
    param([string]$RelativePath, [string]$Label)
    $full = Join-Path $root $RelativePath
    if (-not (Test-Path $full)) { throw "No se encuentra $full" }
    Write-Host $Label
    Get-Content -Raw -Encoding UTF8 $full | docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "psql falló ($RelativePath) código $LASTEXITCODE" }
}

Invoke-PsqlFile "db_scripts\07_auth_login_operacion.sql" "Aplicando 07_auth_login_operacion.sql..."
Invoke-PsqlFile "db_scripts\06_seed_users_raura.sql" "Aplicando 06_seed_users_raura.sql..."
Write-Host "Listo: login Minera Raura (bastian_admin / admin123 / carlos_admin / Demo1234!)."
