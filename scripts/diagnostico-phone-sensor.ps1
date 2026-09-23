# ==========================================================================
# diagnostico-phone-sensor.ps1 — Revisa, SOLO LECTURA, si un servidor con el
#   stack Beemetry importado tiene todo lo necesario para conectar un
#   smartphone como sensor (frontend/public/phone-sensor, ADR-194):
#   página estática, ruta /api/mining/telemetry/multi, migraciones 93-114
#   (canales multi-entrada, plantilla triaxial_pga, device_command_log),
#   empresa Alpayana y túnel HTTPS dedicado al frontend.
#
#   No modifica nada: solo docker ps/inspect/exec con SELECT y curl.
#
# Uso (en la laptop/servidor a revisar, en la carpeta del repo):
#   powershell -ExecutionPolicy Bypass -File .\scripts\diagnostico-phone-sensor.ps1
#   ... | Tee-Object diagnostico.txt     # para compartir el resultado
# Compatible con Windows PowerShell 5.1 y PowerShell 7.
# ==========================================================================
param(
    [string]$DbContainer = "beemetry-db",
    [string]$WebContainer = "beemetry-web",
    [string]$FrontendUrl = "http://localhost:5173",
    [string]$Tenant = "alpayana"
)

$ok = 0; $fail = 0
function Pass($m) { Write-Host "[OK]    $m" -ForegroundColor Green; $script:ok++ }
function Fail($m) { Write-Host "[FALTA] $m" -ForegroundColor Red; $script:fail++ }
function Info($m) { Write-Host "        $m" -ForegroundColor DarkGray }

Write-Host "`n== 1. Contenedores ==" -ForegroundColor Cyan
$running = @(docker ps --format "{{.Names}}" 2>$null)
if ($LASTEXITCODE -ne 0) { Fail "docker no responde (¿Docker Desktop encendido?)"; exit 1 }
foreach ($c in @($DbContainer, $WebContainer, "beemetry-api", "beemetry-formula")) {
    if ($running -contains $c) { Pass "$c corriendo" } else { Fail "$c NO está corriendo" }
}
foreach ($c in @($WebContainer, "beemetry-api")) {
    $img = docker inspect $c --format "{{.Image}}" 2>$null
    if ($img) { Info ("$c imagen creada: " + (docker image inspect $img --format "{{.Created}}" 2>$null)) }
}

Write-Host "`n== 2. Página phone-sensor en el frontend ==" -ForegroundColor Cyan
docker exec $WebContainer test -f /usr/share/nginx/html/phone-sensor/index.html 2>$null
if ($LASTEXITCODE -eq 0) { Pass "index.html dentro de la imagen del frontend" }
else { Fail "la imagen del frontend NO trae phone-sensor/ (reconstruir frontend con frontend/public/phone-sensor)" }
$code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 10 "$FrontendUrl/phone-sensor/"
if ($code -eq "200") { Pass "$FrontendUrl/phone-sensor/ responde 200" } else { Fail "$FrontendUrl/phone-sensor/ responde $code" }

Write-Host "`n== 3. Ruta de telemetría por Device Key ==" -ForegroundColor Cyan
$body = '{\"channels\":{\"accel_x\":1}}'
$resp = & curl.exe -s --max-time 10 -X POST "$FrontendUrl/api/mining/telemetry/multi" -H "Content-Type: application/json" -H "X-Device-Key: diagnostico-invalida" -d $body -w " [%{http_code}]"
Info "respuesta: $resp"
if ($resp -match "invalid_device_key" -or $resp -match "\[401\]") { Pass "/api/mining/telemetry/multi existe (401 con clave falsa es lo esperado)" }
else { Fail "/api/mining/telemetry/multi no responde como se espera (backend viejo o nginx sin proxy /api/)" }

Write-Host "`n== 4. Base de datos ==" -ForegroundColor Cyan
$pgUser = docker exec $DbContainer printenv POSTGRES_USER 2>$null
if (-not $pgUser) { $pgUser = "sensors" }
function Q($sql) { (docker exec $DbContainer psql -U $pgUser -d sensors_db -Atc $sql 2>&1 | Out-String).Trim() }

foreach ($t in @("sensor_formula_def", "sensor_formula_template_def", "sensor_input_channel_def", "device_command_log")) {
    $r = Q "select to_regclass('public.$t') is not null"
    if ($r -eq "t") { Pass "tabla $t" } else { Fail "tabla $t no existe (faltan migraciones db_scripts 93-114)" }
}
$r = Q "select count(*) from sensor_formula_template_def where template_code='triaxial_pga'"
if ($r -eq "1") { Pass "plantilla triaxial_pga" } else { Fail "plantilla triaxial_pga no existe (db_scripts/105_formula_template_triaxial_pga.sql)" }
$r = Q "select tenant_id||' '||tenant_name from tenants where tenant_name ilike '%$Tenant%' limit 1"
if ($r -and $r -notmatch "ERROR") { Pass "empresa: $r" } else { Fail "empresa '$Tenant' no encontrada en tenants" }
$r = Q "select string_agg(s.sensor_code||' ('||t.tenant_name||')', ', ') from sensors s join tenants t using(tenant_id) where s.sensor_code ilike '%phone%' or s.sensor_name ilike '%smartphone%'"
Info ("smartphones registrados: " + $(if ($r) { $r } else { "ninguno" }))
$r = Q "select string_agg(distinct role, ', ') from role_permissions where permission_code='dispositivos.manage'"
Info ("roles con dispositivos.manage: " + $(if ($r) { $r } else { "ninguno / tabla distinta" }))

Write-Host "`n== 5. HTTPS para el celular ==" -ForegroundColor Cyan
$tunnels = @(docker ps --format "{{.Names}}|{{.Image}}|{{.Command}}" 2>$null | Where-Object { $_ -match "cloudflared" })
$frontendTunnel = $false
foreach ($t in $tunnels) {
    $name = $t.Split("|")[0]
    $cmd = docker inspect $name --format "{{json .Config.Cmd}}" 2>$null
    Info "$name -> $cmd"
    if ($cmd -match "frontend") { Pass "$name apunta al frontend (sirve para el celular)"; $frontendTunnel = $true }
    else { Info "$name no apunta al frontend (p.ej. webhook WhatsApp -> backend), no sirve para el celular" }
}
if (-not $frontendTunnel) { Fail "ningún túnel HTTPS apunta al frontend: el celular no podrá usar acelerómetro/GPS" }

Write-Host "`n== Resumen: $ok OK, $fail FALTA ==`n" -ForegroundColor Cyan
