#Requires -Version 5.1
<#
.SYNOPSIS
  Da de baja logica REAL (account_status='deleted') a todos los usuarios (auth_users) de UNA
  empresa especifica, en el Postgres del stack Docker. Un solo comando: los deja fuera del
  login Y libera su DNI para poder volver a registrarlos.

.DESCRIPTION
  Script parametrico y reutilizable: recibe el nombre de la empresa por parametro (-CompanyName)
  y da de baja TODAS las filas de auth_users de esa empresa que no esten ya eliminadas
  (comparacion insensible a mayusculas, sin comodines) -- sin importar si estaban 'active',
  'blocked' o 'suspended'.

  Hace exactamente la misma UPDATE que executeUserMaintenancePg para accion="delete"
  (backend/src/auth/auth_storage_pg.cpp), la misma que usa "Eliminar usuario" en el panel de
  administracion real (POST /api/auth/users/maintenance): account_status='deleted', y limpia
  avatar_cartoon_base64 y face_template (el embedding biometrico). Tambien borra -- best effort,
  igual que el backend -- el avatar HD del filesystem (./data/auth/avatars_hd/{id}.png) si
  existe.

  Hallazgo real 2026-09-21: una version anterior de este script solo ponia
  account_status='blocked'. Eso dejaba a los usuarios sin poder loguearse, pero el indice unico
  parcial ux_auth_users_dni_active y el pre-chequeo checkDniExistsPg (mismo archivo) solo
  excluyen filas con account_status='deleted' -- 'blocked' seguia contando como "DNI ocupado",
  asi que un intento de volver a registrar a la misma persona quedaba rechazado con "Ese DNI ya
  esta registrado en esta empresa" aunque la cuenta ya estuviera "depurada". Por eso este script
  ahora hace la baja REAL (deleted) directamente, en un solo paso.

  Sigue sin hacer DELETE fisico de la fila. platform_audit_log es append-only con cadena de hash
  forense (ADR-030/031, ver db_scripts/31_audit_log_append_only_hash_chain.sql): un trigger
  BEFORE UPDATE/DELETE rechaza cualquier mutacion sobre esa tabla, incluida la que dispararia
  automaticamente un "ON DELETE SET NULL" al borrar un auth_users con eventos de auditoria (es
  decir, casi cualquier usuario real). Por eso la baja logica sigue siendo la forma correcta y
  soportada de "eliminar" usuarios aqui: preserva el historial de auditoria intacto. A diferencia
  de un simple bloqueo, esta baja SI es destructiva para el avatar y la plantilla biometrica (se
  borran de verdad, no se pueden recuperar con un UPDATE) -- el registro administrativo de que
  la cuenta existio se conserva, pero el rostro/avatar no.

  Por defecto pide confirmacion escribiendo el nombre exacto de la empresa. Usar -DryRun para solo
  listar los usuarios que se eliminarian, sin tocar nada. Usar -Force para saltar la confirmacion
  interactiva (util para automatizacion, con cuidado).

.PARAMETER CompanyName
  Nombre de la empresa tal como esta en auth_users.company_name (ej. "Alpayana", "Minera Raura").
  La comparacion es insensible a mayusculas/minusculas pero exacta (no admite comodines).

.PARAMETER DryRun
  Solo lista los usuarios (cualquier estado no eliminado) que coincidirian con CompanyName. No
  modifica nada.

.PARAMETER Force
  Omite la confirmacion interactiva (que normalmente exige volver a escribir el nombre de la empresa).

.PARAMETER SkipWebRestart
  No reiniciar el contenedor web tras la baja (por defecto SI se reinicia, para limpiar sesiones
  en memoria de los usuarios eliminados).

.PARAMETER ComposeFile
  Ruta al compose (por defecto docker-compose.yml en la raiz del repo).

.PARAMETER DbService
  Nombre del servicio de Postgres en el compose (por defecto "db").

.PARAMETER WebService
  Nombre del servicio web en el compose, usado para el borrado best-effort del avatar HD y el
  reinicio de sesiones (por defecto "web").

.PARAMETER DbUser
  Usuario de Postgres (por defecto "sensors").

.PARAMETER DbName
  Base de datos de Postgres (por defecto "sensors_db").

.EXAMPLE
  # Ver que usuarios se eliminarian, sin tocar nada
  .\scripts\delete-company-users-docker.ps1 -CompanyName "Alpayana" -DryRun

.EXAMPLE
  # Dar de baja de verdad, en un solo paso (pide escribir "Alpayana" para confirmar)
  .\scripts\delete-company-users-docker.ps1 -CompanyName "Alpayana"

.EXAMPLE
  # Reutilizar para otra empresa minera
  .\scripts\delete-company-users-docker.ps1 -CompanyName "Minera Raura"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$CompanyName,

    [switch]$DryRun,
    [switch]$Force,
    [switch]$SkipWebRestart,

    [string]$ComposeFile = "",
    [string]$DbService = "db",
    [string]$WebService = "web",
    [string]$DbUser = "sensors",
    [string]$DbName = "sensors_db"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CompanyName)) {
    Write-Error "CompanyName no puede estar vacio."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$defaultCompose = Join-Path $root "docker-compose.yml"
if (-not (Test-Path $defaultCompose)) {
    Write-Error "No se encontro docker-compose.yml en: $root"
}

Set-Location $root

$composePrefix = @("compose")
if ($ComposeFile) {
    $cf = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $root $ComposeFile }
    if (-not (Test-Path $cf)) { Write-Error "Compose no encontrado: $cf" }
    $composePrefix = @("compose", "-f", $cf)
}

Write-Host ""
Write-Host "=== InformeCliente - baja logica REAL (deleted) de usuarios de una empresa (Docker)" -ForegroundColor Cyan
Write-Host "    Repo    : $root" -ForegroundColor Gray
Write-Host "    Empresa : $CompanyName" -ForegroundColor Gray
Write-Host "    DB      : $DbService / $DbName / $DbUser" -ForegroundColor Gray
Write-Host ""

Write-Host ">>> Comprobando servicio $DbService..." -ForegroundColor Yellow
$dbId = & docker @composePrefix ps -q $DbService 2>$null
if (-not $dbId -or [string]::IsNullOrWhiteSpace($dbId)) {
    Write-Error "El servicio '$DbService' no esta en ejecucion. Ejecute: docker compose up -d $DbService"
}

function Invoke-Psql {
    param(
        [string]$Sql,
        [switch]$TuplesOnly
    )
    $psqlArgs = @("exec", "-T", $DbService, "psql", "-U", $DbUser, "-d", $DbName,
                  "-v", "ON_ERROR_STOP=1", "-v", "company_name=$CompanyName")
    if ($TuplesOnly) { $psqlArgs += @("-t", "-A") }
    $Sql | & docker @composePrefix @psqlArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "psql fallo (codigo $LASTEXITCODE)."
    }
}

Write-Host ">>> Buscando usuarios de '$CompanyName' que no esten ya eliminados..." -ForegroundColor Yellow
$countSql = "SELECT count(*) FROM auth_users WHERE company_name ILIKE :'company_name' AND account_status IS DISTINCT FROM 'deleted';"
$countRaw = ($countSql | & docker @composePrefix exec -T $DbService psql -U $DbUser -d $DbName `
    -v ON_ERROR_STOP=1 -v "company_name=$CompanyName" -t -A)
if ($LASTEXITCODE -ne 0) {
    Write-Error "psql fallo al contar usuarios (codigo $LASTEXITCODE)."
}
$matchCount = 0
[void][int]::TryParse(($countRaw | Select-Object -Last 1).Trim(), [ref]$matchCount)

if ($matchCount -eq 0) {
    Write-Host ""
    Write-Host "No hay usuarios pendientes (no eliminados) con company_name = '$CompanyName' (comparacion insensible a mayusculas). Nada que dar de baja." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host ">>> Usuarios que coinciden y se eliminarian ($matchCount):" -ForegroundColor Yellow
$listSql = "SELECT id, company_name, username, dni, account_status, first_name, last_name, role FROM auth_users WHERE company_name ILIKE :'company_name' AND account_status IS DISTINCT FROM 'deleted' ORDER BY username;"
Invoke-Psql -Sql $listSql

if ($DryRun) {
    Write-Host ""
    Write-Host "=== DryRun: no se modifico nada." -ForegroundColor Cyan
    exit 0
}

if (-not $Force) {
    Write-Host ""
    Write-Host "Esta a punto de ELIMINAR (account_status='deleted', baja logica REAL) $matchCount usuario(s) de '$CompanyName'. No podran volver a loguearse y su DNI queda libre para volver a registrarse. Tambien se borra su avatar y su plantilla biometrica (eso SI es irreversible, no se puede recuperar con un UPDATE). El historial de auditoria se conserva intacto." -ForegroundColor Red
    $typed = Read-Host "Escriba el nombre de la empresa exactamente ('$CompanyName') para confirmar"
    $typed = $typed.Trim().Trim('"').Trim("'")
    if ($typed -ne $CompanyName) {
        Write-Host "Confirmacion no coincide. Abortado, no se modifico nada." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host ">>> Eliminando (baja logica real) usuarios de '$CompanyName'..." -ForegroundColor Yellow
# Misma UPDATE exacta que executeUserMaintenancePg para accion="delete"
# (backend/src/auth/auth_storage_pg.cpp).
$deleteSql = @"
BEGIN;
UPDATE auth_users SET account_status = 'deleted',
    avatar_cartoon_base64 = NULL,
    face_template = '[]'::jsonb,
    updated_at = NOW()
WHERE company_name ILIKE :'company_name' AND account_status IS DISTINCT FROM 'deleted'
RETURNING id, company_name, username, dni;
COMMIT;
"@
Invoke-Psql -Sql $deleteSql

Write-Host ""
Write-Host "    Revise la salida: UPDATE $matchCount confirma cuantos usuarios se eliminaron." -ForegroundColor DarkYellow

Write-Host ""
Write-Host ">>> Borrando avatar HD (best-effort, ./data/auth/avatars_hd/{id}.png)..." -ForegroundColor Yellow
$idsSql = "SELECT id FROM auth_users WHERE company_name ILIKE :'company_name' AND account_status = 'deleted' AND avatar_cartoon_base64 IS NULL;"
$idsRaw = ($idsSql | & docker @composePrefix exec -T $DbService psql -U $DbUser -d $DbName `
    -v ON_ERROR_STOP=1 -v "company_name=$CompanyName" -t -A)
$ids = $idsRaw | Where-Object { $_ -and $_.Trim() -ne "" }
foreach ($id in $ids) {
    $id = $id.Trim()
    & docker @composePrefix exec -T $WebService sh -c "rm -f /data/auth/avatars_hd/$id.png" 2>$null
}
Write-Host "    OK ($($ids.Count) id(s) procesados)" -ForegroundColor Green

if (-not $SkipWebRestart) {
    Write-Host ""
    Write-Host ">>> Reiniciando web (sesiones en memoria de los usuarios eliminados)..." -ForegroundColor Yellow
    & docker @composePrefix restart $WebService
    if ($LASTEXITCODE -ne 0) {
        Write-Error "docker compose restart $WebService fallo (codigo $LASTEXITCODE)."
    }
    Write-Host "    OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Listo: usuarios de '$CompanyName' eliminados (account_status='deleted'). Sus DNI ya estan libres para volver a registrarse." -ForegroundColor Green
Write-Host ""
