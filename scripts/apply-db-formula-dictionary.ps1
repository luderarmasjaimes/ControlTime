# Aplica/actualiza catálogo de Diccionario de Datos y Operadores Matemáticos en BD existente.
# Uso: .\scripts\apply-db-formula-dictionary.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$sqlFile = Join-Path $root "db_scripts\08_formula_dictionary_seed.sql"
if (-not (Test-Path $sqlFile)) {
    throw "No se encuentra $sqlFile"
}

Write-Host "Aplicando 08_formula_dictionary_seed.sql..."
Get-Content -Raw -Encoding UTF8 $sqlFile | docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw "psql falló aplicando 08_formula_dictionary_seed.sql (código $LASTEXITCODE)"
}

Write-Host "Listo: catálogo de diccionario y operadores actualizado."
