param(
    [string]$BackendUrl = "http://localhost:8082",
    [string]$Company = "Minera Raura",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "====================================="
    Write-Host $Text
    Write-Host "====================================="
}

function Invoke-Api {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("GET", "POST")]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [object]$Body
    )

    $url = "$BackendUrl$Path"

    if ($DryRun) {
        Write-Host "[DRY-RUN] $Method $url"
        if ($Body) {
            Write-Host "[DRY-RUN] body: $($Body | ConvertTo-Json -Depth 6 -Compress)"
        }
        return @{}
    }

    if ($Method -eq "GET") {
        try {
            return Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
        }
        catch {
            throw "No se pudo conectar al backend en $BackendUrl. Levanta el backend y vuelve a ejecutar. Detalle: $($_.Exception.Message)"
        }
    }

    $jsonBody = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 6 } else { $null }
    try {
        return Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $jsonBody -TimeoutSec 30
    }
    catch {
        throw "No se pudo conectar al backend en $BackendUrl. Levanta el backend y vuelve a ejecutar. Detalle: $($_.Exception.Message)"
    }
}

function New-FaceTemplate {
    param([int]$Size = 576)

    $values = New-Object System.Collections.Generic.List[Double]
    for ($i = 0; $i -lt $Size; $i++) {
        # Template deterministica para pruebas reproducibles
        $v = (($i % 97) + 1) / 100.0
        [void]$values.Add([Math]::Round($v, 6))
    }
    return $values
}

Write-Section "SMOKE AUTH E2E"
Write-Host "Backend: $BackendUrl"
Write-Host "Empresa: $Company"

$nonce = Get-Date -Format "yyyyMMddHHmmss"
$username = "admin_$nonce"
$password = "SmokeAuth!2026"
$dni = "9$($nonce.Substring($nonce.Length - 7))"
$faceTemplate = New-FaceTemplate

$registerPayload = @{
    company = $Company
    first_name = "Smoke"
    last_name = "Tester"
    dni = $dni
    username = $username
    password = $password
    face_template = $faceTemplate
}

Write-Section "STEP 1 - REGISTER"
$register = Invoke-Api -Method POST -Path "/api/auth/register" -Body $registerPayload
if (-not $DryRun) {
    if ($register.status -ne "registered") {
        throw "Registro fallido: respuesta inesperada"
    }
    Write-Host "Registro OK: $username"
}

Write-Section "STEP 2 - LOGIN PASSWORD"
$loginPassword = Invoke-Api -Method POST -Path "/api/auth/login/password" -Body @{
    company = $Company
    username = $username
    password = $password
}
if (-not $DryRun) {
    if ($loginPassword.status -ne "authenticated" -or $loginPassword.method -ne "password") {
        throw "Login por contrasena fallido"
    }
    Write-Host "Login password OK"
}

$authToken = if (-not $DryRun) { $loginPassword.user.access_token } else { "" }

Write-Section "STEP 3 - LOGIN FACE"
$loginFace = Invoke-Api -Method POST -Path "/api/auth/login/face" -Body @{
    company = $Company
    identity_login = $username
    face_template = $faceTemplate
    threshold = 0.89
}
if (-not $DryRun) {
    if ($loginFace.status -ne "authenticated" -or $loginFace.method -ne "face") {
        throw "Login facial fallido"
    }
    Write-Host "Login facial OK (score=$($loginFace.score))"
}

Write-Section "STEP 4 - AUDIT FILTER"
$auditPath = "/api/auth/audit?page=1&page_size=20&username=$username&auth_token=$authToken"
$audit = Invoke-Api -Method GET -Path $auditPath
if (-not $DryRun) {
    if (-not $audit.logs -or $audit.count -lt 2 -or $audit.total -lt 2) {
        throw "Auditoria incompleta: no se encontraron eventos esperados"
    }
    Write-Host "Auditoria OK (eventos_pagina=$($audit.count), total=$($audit.total), pagina=$($audit.page))"
}

Write-Section "STEP 5 - AUDIT CSV EXPORT"
if ($DryRun) {
    Write-Host "[DRY-RUN] GET $BackendUrl/api/auth/audit/export.csv?username=$username"
}
else {
    $csvResponse = Invoke-WebRequest -Method Get -Uri "$BackendUrl/api/auth/audit/export.csv?username=$username&auth_token=$authToken" -TimeoutSec 30 -UseBasicParsing
    if ($csvResponse.StatusCode -ne 200 -or -not ($csvResponse.Content -match "event_time,event_action")) {
        throw "Export CSV de auditoria fallido"
    }
    Write-Host "Export CSV OK"
}

Write-Section "STEP 6 - REFRESH TOKEN VIA COOKIE + PROTECCION CSRF (ADR-029)"
# El refresh token ya no viaja en el body JSON (ver ADR-029, "Actualizacion
# 2026-07-19") -- viaja en una cookie HttpOnly que el backend pone en el
# login/registro; -SessionVariable hace que Invoke-WebRequest la guarde y
# reenvie automaticamente, igual que un navegador real.
if ($DryRun) {
    Write-Host "[DRY-RUN] POST $BackendUrl/api/auth/refresh (con cookie de sesion)"
    Write-Host "[DRY-RUN] POST $BackendUrl/api/auth/logout (con cookie de sesion)"
}
else {
    $session = $null
    $loginResp = Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/login/password" `
        -ContentType "application/json" `
        -Body (@{ company = $Company; username = $username; password = $password } | ConvertTo-Json) `
        -SessionVariable session -TimeoutSec 30 -UseBasicParsing
    $loginBody = $loginResp.Content | ConvertFrom-Json
    if ($loginBody.user.PSObject.Properties.Name -contains "refresh_token") {
        throw "FALLO: refresh_token sigue presente en el body de login/password (deberia viajar solo por cookie)"
    }
    Write-Host "Login OK: refresh_token NO esta en el body (correcto, ADR-029)"

    $refreshCookie = $session.Cookies.GetCookies("$BackendUrl/api/auth/") | Where-Object { $_.Name -eq "refresh_token" }
    $csrfCookie = $session.Cookies.GetCookies("$BackendUrl/api/auth/") | Where-Object { $_.Name -eq "csrf_token" }
    if (-not $refreshCookie -or -not $csrfCookie) {
        throw "FALLO: no se recibieron las cookies refresh_token/csrf_token esperadas"
    }
    if (-not $refreshCookie.HttpOnly) {
        throw "FALLO: la cookie refresh_token deberia ser HttpOnly"
    }
    Write-Host "Cookies OK: refresh_token (HttpOnly) + csrf_token presentes"

    # Sin header X-CSRF-Token: debe rechazar (403), mismo comportamiento que
    # protege contra un sitio de terceros que solo puede lograr que el
    # navegador MANDE la cookie, no LEERLA para repetirla en el header.
    try {
        Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/refresh" -WebSession $session -TimeoutSec 30 -UseBasicParsing | Out-Null
        throw "FALLO: /api/auth/refresh sin X-CSRF-Token deberia responder 403"
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 403) {
            throw "FALLO: se esperaba 403 sin X-CSRF-Token, se obtuvo $($_.Exception.Response.StatusCode.value__)"
        }
        Write-Host "Refresh sin CSRF rechazado con 403 (correcto)"
    }

    # Con el header correcto: debe funcionar y rotar el refresh token.
    $refreshResp = Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/refresh" `
        -Headers @{ "X-CSRF-Token" = $csrfCookie.Value } -WebSession $session -TimeoutSec 30 -UseBasicParsing
    $refreshBody = $refreshResp.Content | ConvertFrom-Json
    if ($refreshBody.status -ne "refreshed" -or -not $refreshBody.access_token) {
        throw "FALLO: refresh con CSRF correcto no devolvio un access_token nuevo"
    }
    if ($refreshBody.PSObject.Properties.Name -contains "refresh_token") {
        throw "FALLO: refresh_token sigue presente en el body de /api/auth/refresh"
    }
    Write-Host "Refresh con CSRF correcto OK: nuevo access_token, sin refresh_token en el body"

    # Logout: mismo criterio de CSRF, y debe limpiar ambas cookies (Max-Age=0).
    $newCsrfCookie = $session.Cookies.GetCookies("$BackendUrl/api/auth/") | Where-Object { $_.Name -eq "csrf_token" }
    $logoutResp = Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/logout" `
        -Headers @{ Authorization = "Bearer $($refreshBody.access_token)"; "X-CSRF-Token" = $newCsrfCookie.Value } `
        -WebSession $session -TimeoutSec 30 -UseBasicParsing
    $logoutBody = $logoutResp.Content | ConvertFrom-Json
    if ($logoutBody.status -ne "logged_out") {
        throw "FALLO: logout con CSRF correcto no devolvio logged_out"
    }
    Write-Host "Logout con CSRF correcto OK"
}

Write-Section "SMOKE AUTH COMPLETADO"
Write-Host "Resultado: OK"
