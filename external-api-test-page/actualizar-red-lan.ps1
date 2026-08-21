<#
.SYNOPSIS
  Actualiza la pagina de prueba de login (ADR-107) para la IP de LAN ACTUAL
  de esta maquina: agrega el origen a BEEMETRY_CORS_ALLOWED_ORIGIN, regenera
  el certificado HTTPS autofirmado, reinicia el backend y los servidores de
  la pagina de prueba, y verifica con pruebas reales que todo responde.

.DESCRIPTION
  Pensado para correr cada vez que esta maquina cambia de red (Wi-Fi de la
  oficina, de casa, hotspot del celular, etc.) -- ver "Nota operativa" de
  ADR-107 (docs/decisions/107-geolocalizacion-cliente-login-contrasena.md).
  Sin esto, los pasos son manuales: detectar la IP, editar .env a mano,
  regenerar el certificado con openssl, recrear el contenedor del backend,
  y reiniciar dos procesos Python -- easy de olvidar un paso.

  Requiere: Docker Desktop corriendo (el backend ya debe estar levantado con
  `docker compose up -d`), openssl y python en el PATH (Git for Windows trae
  openssl; ambos ya se confirmaron disponibles en esta maquina).

.USAGE
  powershell -ExecutionPolicy Bypass -File actualizar-red-lan.ps1
  (o doble click en Actualizar-Red-LAN.cmd, que llama a este script)
#>

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptDir

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "    FALLO: $msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# 1) Detectar la IP de LAN activa (la interfaz con salida a Internet/red
#    local real -- descarta loopback, adaptadores virtuales de Docker/WSL,
#    y direcciones link-local 169.254.x.x sin DHCP real).
# ---------------------------------------------------------------------------
Write-Step "Detectando IP de LAN activa"
$connProfile = Get-NetConnectionProfile |
    Where-Object { $_.IPv4Connectivity -in @('Internet', 'LocalNetwork') } |
    Select-Object -First 1
if (-not $connProfile) {
    Write-Fail "No se encontro una interfaz de red activa (sin Internet ni red local). Verifique la conexion Wi-Fi/Ethernet."
    exit 1
}
$lanIp = (Get-NetIPAddress -InterfaceIndex $connProfile.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254*' } |
    Select-Object -First 1).IPAddress
if (-not $lanIp) {
    Write-Fail "No se pudo determinar la IPv4 de la interfaz '$($connProfile.InterfaceAlias)'."
    exit 1
}
Write-Ok "$lanIp (interfaz: $($connProfile.InterfaceAlias), categoria: $($connProfile.NetworkCategory))"

$httpOrigin  = "http://${lanIp}:5190"
$httpsOrigin = "https://${lanIp}:5443"

# ---------------------------------------------------------------------------
# 2) BEEMETRY_CORS_ALLOWED_ORIGIN en .env: agregar el origen nuevo si falta,
#    SIN quitar ninguno de los anteriores (una IP vieja no hace daño ahi,
#    y evita romper el acceso si la maquina vuelve a esa red).
# ---------------------------------------------------------------------------
Write-Step "Actualizando BEEMETRY_CORS_ALLOWED_ORIGIN en .env"
$envPath = Join-Path $repoRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Fail "No se encontro $envPath"
    exit 1
}
$envLines = Get-Content -Path $envPath
$corsLineIndex = -1
for ($i = 0; $i -lt $envLines.Count; $i++) {
    if ($envLines[$i] -match '^BEEMETRY_CORS_ALLOWED_ORIGIN=') { $corsLineIndex = $i; break }
}
if ($corsLineIndex -lt 0) {
    Write-Fail "No se encontro la linea BEEMETRY_CORS_ALLOWED_ORIGIN= en .env -- agreguela manualmente primero."
    exit 1
}
$currentValue = $envLines[$corsLineIndex].Substring('BEEMETRY_CORS_ALLOWED_ORIGIN='.Length)
$origins = $currentValue -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$changed = $false
foreach ($origin in @($httpOrigin, $httpsOrigin)) {
    if ($origins -notcontains $origin) {
        $origins += $origin
        $changed = $true
    }
}
if ($changed) {
    $envLines[$corsLineIndex] = 'BEEMETRY_CORS_ALLOWED_ORIGIN=' + ($origins -join ',')
    Set-Content -Path $envPath -Value $envLines -NoNewline:$false
    Write-Ok "Origenes agregados: $httpOrigin, $httpsOrigin"
} else {
    Write-Ok "El origen ya estaba en la lista (sin cambios)"
}

# ---------------------------------------------------------------------------
# 3) Certificado HTTPS autofirmado: agregar la IP al SAN si falta, y
#    regenerar siempre (operacion barata, evita certificados desincronizados).
# ---------------------------------------------------------------------------
Write-Step "Actualizando certificado HTTPS autofirmado (SAN)"
$certsDir = Join-Path $scriptDir "certs"
$sanCnfPath = Join-Path $certsDir "openssl-san.cnf"
$sanLines = Get-Content -Path $sanCnfPath
$existingIpLines = $sanLines | Where-Object { $_ -match '^IP\.\d+\s*=\s*(.+)$' }
$existingIps = $existingIpLines | ForEach-Object { ($_ -split '=')[1].Trim() }
if ($existingIps -notcontains $lanIp) {
    $maxIdx = 0
    foreach ($line in $existingIpLines) {
        if ($line -match '^IP\.(\d+)\s*=') { $n = [int]$Matches[1]; if ($n -gt $maxIdx) { $maxIdx = $n } }
    }
    $lastIpLineIndex = -1
    for ($i = 0; $i -lt $sanLines.Count; $i++) {
        if ($sanLines[$i] -match '^IP\.\d+\s*=') { $lastIpLineIndex = $i }
    }
    $newLine = "IP.$($maxIdx + 1) = $lanIp"
    # List<T>.Insert() en vez de slicing con el operador `..`: cuando la
    # última línea "IP.N" coincide con la última línea del archivo, el rango
    # `($lastIpLineIndex+1)..($sanLines.Count-1)` queda invertido (ppio >
    # fin) y PowerShell lo interpreta como una secuencia DESCENDENTE en vez
    # de vacía -- duplicaba la última línea en vez de no agregar nada después
    # de ella. Insert() no tiene ese caso borde.
    $linesList = [System.Collections.Generic.List[string]]::new($sanLines)
    $linesList.Insert($lastIpLineIndex + 1, $newLine)
    Set-Content -Path $sanCnfPath -Value $linesList
    Write-Ok "IP agregada al SAN: $newLine"
} else {
    Write-Ok "La IP ya estaba en el SAN (sin cambios)"
}

$certPath = Join-Path $certsDir "server.crt"
Push-Location $certsDir
try {
    # openssl escribe sus puntos de progreso (".....+++...") a stderr aunque
    # termine con exito (exit 0) -- ejecutado vía `-File`, PowerShell lo
    # envuelve en un NativeCommandError pese a `2>&1`/ErrorAction (el proceso
    # SI genera el certificado bien, confirmado repetidamente comparando el
    # SAN resultante). Se ignora esa excepcion y se verifica el resultado
    # real revisando el CONTENIDO del certificado (no una fecha de
    # modificacion -- con resolucion de segundo puede coincidir por
    # casualidad entre corridas consecutivas rápidas).
    try {
        & openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 825 `
            -config openssl-san.cnf -extensions v3_req 2>&1 | Out-Null
    } catch {
        # esperado -- ver comentario arriba
    }
} finally {
    Pop-Location
}
$certText = if (Test-Path $certPath) { & openssl x509 -in $certPath -noout -text 2>$null } else { "" }
if ($certText -match [regex]::Escape($lanIp)) {
    Write-Ok "Certificado regenerado con $lanIp en el SAN (certs/server.crt, certs/server.key)"
} else {
    Write-Fail "El certificado no quedo con $lanIp en su SAN -- revise que 'openssl' este en el PATH y corra el comando manualmente para ver el error real."
    exit 1
}

# ---------------------------------------------------------------------------
# 4) Recrear el contenedor del backend para que tome el .env actualizado.
# ---------------------------------------------------------------------------
Write-Step "Recreando el contenedor del backend (para que tome el .env actualizado)"
Push-Location $repoRoot
try {
    # docker compose escribe su progreso ("Container ... Recreate/Started")
    # a stderr por convencion -- mismo caso que openssl arriba. Se ignora la
    # excepcion y se verifica el resultado real con `docker ps` debajo.
    try {
        & docker compose up -d --no-deps web 2>&1 | ForEach-Object { Write-Host "    $_" }
    } catch {
        # esperado -- ver comentario arriba
    }
} finally {
    Pop-Location
}
Start-Sleep -Seconds 3
$apiStatus = & docker ps --filter "name=beemetry-api" --format "{{.Status}}"
if ($apiStatus -match 'healthy|Up') {
    Write-Ok "beemetry-api: $apiStatus"
} else {
    Write-Fail "beemetry-api no aparece saludable ($apiStatus) -- revise 'docker logs beemetry-api'"
    exit 1
}

# ---------------------------------------------------------------------------
# 5) Reiniciar los servidores de la pagina de prueba (matar cualquier
#    instancia previa en 5190/5443 -- serve_https.py necesita reiniciar para
#    cargar el certificado regenerado, serve_http.py no depende de el pero
#    se reinicia igual por consistencia).
# ---------------------------------------------------------------------------
Write-Step "Reiniciando los servidores de la pagina de prueba (puertos 5190 y 5443)"
foreach ($port in @(5190, 5443)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        try {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Ok "Proceso anterior en el puerto $port detenido (PID $($c.OwningProcess))"
        } catch {}
    }
}
Start-Sleep -Milliseconds 500

Start-Process -FilePath "python" -ArgumentList @((Join-Path $scriptDir "serve_http.py"), "5190") `
    -WorkingDirectory $scriptDir -WindowStyle Minimized
Start-Process -FilePath "python" -ArgumentList @((Join-Path $scriptDir "serve_https.py"), "5443") `
    -WorkingDirectory $scriptDir -WindowStyle Minimized
Write-Ok "serve_http.py (5190) y serve_https.py (5443) lanzados en ventanas minimizadas"
Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
# 6) Verificacion real: golpear ambos servidores por la IP de LAN detectada,
#    tanto la pagina estatica como /api/* proxeado (prueba real de
#    conectividad+CORS+backend, no solo "el proceso arranco").
# ---------------------------------------------------------------------------
Write-Step "Verificando conectividad real por la IP de LAN ($lanIp)"
$checks = @(
    @{ Name = "Pagina HTTP";        Url = "$httpOrigin/index.html" },
    @{ Name = "API via proxy HTTP"; Url = "$httpOrigin/api/platform/countries" },
    @{ Name = "Pagina HTTPS";       Url = "$httpsOrigin/index.html" },
    @{ Name = "API via proxy HTTPS"; Url = "$httpsOrigin/api/platform/countries" }
)
$allOk = $true
# curl.exe (nativo de Windows 10/11, no el alias de Invoke-WebRequest) en vez
# de Invoke-WebRequest: -SkipCertificateCheck solo existe en PowerShell 7+, y
# este script puede correr bajo Windows PowerShell 5.1 si se invoca con
# "powershell" en vez de "pwsh" (p. ej. desde el .cmd de doble click) --
# curl.exe se comporta igual en ambos casos.
foreach ($check in $checks) {
    $httpCode = & curl.exe -s -k -o NUL -w "%{http_code}" --max-time 8 $check.Url 2>$null
    if ($httpCode -eq '200') {
        Write-Ok "$($check.Name): HTTP $httpCode -- $($check.Url)"
    } else {
        Write-Fail "$($check.Name): HTTP $httpCode -- $($check.Url)"
        $allOk = $false
    }
}

# ---------------------------------------------------------------------------
# 7) Resumen final
# ---------------------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Cyan
if ($allOk) {
    Write-Host " TODO FUNCIONANDO -- URLs listas para usar desde otra PC de la LAN:" -ForegroundColor Green
} else {
    Write-Host " HAY FALLOS ARRIBA -- revise antes de compartir estas URLs:" -ForegroundColor Red
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  HTTP   (sin camara real):   $httpOrigin/"
Write-Host "  HTTPS  (con camara real):   $httpsOrigin/"
Write-Host "                              (aceptar advertencia de certificado autofirmado la primera vez)"
Write-Host "============================================================`n" -ForegroundColor Cyan
