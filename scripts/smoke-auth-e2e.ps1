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
        [ValidateSet("GET", "POST", "PUT", "DELETE")]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [object]$Body,
        [hashtable]$Headers = @{}
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
            return Invoke-RestMethod -Method Get -Uri $url -Headers $Headers -TimeoutSec 30
        }
        catch {
            $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            throw "GET $url fallo. Detalle: $detail"
        }
    }

    if ($Method -eq "DELETE") {
        try {
            return Invoke-RestMethod -Method Delete -Uri $url -Headers $Headers -TimeoutSec 30
        }
        catch {
            $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            throw "DELETE $url fallo. Detalle: $detail"
        }
    }

    $jsonBody = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 6 } else { $null }
    $restVerb = if ($Method -eq "PUT") { "Put" } else { "Post" }
    try {
        return Invoke-RestMethod -Method $restVerb -Uri $url -Headers $Headers -ContentType "application/json" -Body $jsonBody -TimeoutSec 30
    }
    catch {
        $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "$Method $url fallo. Detalle: $detail"
    }
}

function Get-HttpStatusCode {
    param([Parameter(Mandatory = $true)] $ErrorRecord)
    return [int]$ErrorRecord.Exception.Response.StatusCode
}

# Genera un RUC peruano sintetico distinto en cada corrida (mismo algoritmo
# mod-11 de tax_id.cpp) -- un valor fijo colisionaria con RUC ya sembrados
# por db_scripts/51 (encontrado en vivo: "20500000016" ya pertenece a
# TimeTelemetry del seed de ADR-088, y el POST devuelve 409 ruc_already_exists
# en vez del 201 esperado por este step).
function New-ValidPeruRuc {
    $body = -join ((1..8) | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
    $digits = "20" + $body
    $factor = @(5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    $sum = 0
    for ($i = 0; $i -lt 10; $i++) {
        $sum += ([int][string]$digits[$i]) * $factor[$i]
    }
    $remainder = $sum % 11
    $check = 11 - $remainder
    if ($check -eq 10) { $check = 0 }
    if ($check -eq 11) { $check = 1 }
    return "$digits$check"
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

$nonce = "$(Get-Date -Format 'yyyyMMddHHmmssfff')_$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$username = "admin_$nonce"
$password = "SmokeAuth!2026"
$dniSeed = [Convert]::ToUInt32(([Guid]::NewGuid().ToString('N').Substring(0,7)), 16)
$dni = (($dniSeed % 90000000) + 10000000).ToString()
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

Write-Section "STEP 4 - ADMIN COMPANY DEDUP"
if ($DryRun) {
    Write-Host "[DRY-RUN] POST $BackendUrl/api/auth/companies (duplicado case-insensitive)"
}
else {
    $duplicateStatus = 0
    try {
        Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/companies" `
            -Headers @{ Authorization = "Bearer $authToken" } `
            -ContentType "application/json" `
            -Body (@{ name = "  $($Company.ToUpperInvariant())  " } | ConvertTo-Json) `
            -TimeoutSec 30 -UseBasicParsing | Out-Null
    }
    catch {
        $duplicateStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($duplicateStatus -ne 409) {
        throw "Deduplicacion de empresa fallo: se esperaba HTTP 409 y se obtuvo $duplicateStatus"
    }
    Write-Host "Empresa duplicada rechazada con 409 (case-insensitive) OK"
}

Write-Section "STEP 5 - AUDIT FILTER"
$auditPath = "/api/auth/audit?page=1&page_size=20&username=$username"
$audit = Invoke-Api -Method GET -Path $auditPath -Headers @{ Authorization = "Bearer $authToken" }
if (-not $DryRun) {
    if (-not $audit.logs -or $audit.count -lt 2 -or $audit.total -lt 2) {
        throw "Auditoria incompleta: no se encontraron eventos esperados"
    }
    Write-Host "Auditoria OK (eventos_pagina=$($audit.count), total=$($audit.total), pagina=$($audit.page))"
}

Write-Section "STEP 6 - AUDIT CSV EXPORT"
if ($DryRun) {
    Write-Host "[DRY-RUN] GET $BackendUrl/api/auth/audit/export.csv?username=$username"
}
else {
    $csvResponse = Invoke-WebRequest -Method Get -Uri "$BackendUrl/api/auth/audit/export.csv?username=$username" `
        -Headers @{ Authorization = "Bearer $authToken" } -TimeoutSec 30 -UseBasicParsing
    if ($csvResponse.StatusCode -ne 200 -or -not ($csvResponse.Content -match "event_time,event_action")) {
        throw "Export CSV de auditoria fallido"
    }
    Write-Host "Export CSV OK"
}

Write-Section "STEP 7 - REFRESH TOKEN VIA COOKIE + PROTECCION CSRF (ADR-029)"
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
    # ADR-041/actualización 2026-07-21: la cookie legible usa nombre
    # csrf_token_v2 y Path=/ para que document.cookie pueda verla desde toda
    # la SPA. El script conservaba el nombre legacy y producía un falso fallo.
    $csrfCookie = $session.Cookies.GetCookies("$BackendUrl/api/auth/") | Where-Object { $_.Name -eq "csrf_token_v2" }
    if (-not $refreshCookie -or -not $csrfCookie) {
        throw "FALLO: no se recibieron las cookies refresh_token/csrf_token_v2 esperadas"
    }
    if (-not $refreshCookie.HttpOnly) {
        throw "FALLO: la cookie refresh_token deberia ser HttpOnly"
    }
    Write-Host "Cookies OK: refresh_token (HttpOnly) + csrf_token_v2 presentes"

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
    $newCsrfCookie = $session.Cookies.GetCookies("$BackendUrl/api/auth/") | Where-Object { $_.Name -eq "csrf_token_v2" }
    $logoutResp = Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/logout" `
        -Headers @{ Authorization = "Bearer $($refreshBody.access_token)"; "X-CSRF-Token" = $newCsrfCookie.Value } `
        -WebSession $session -TimeoutSec 30 -UseBasicParsing
    $logoutBody = $logoutResp.Content | ConvertFrom-Json
    if ($logoutBody.status -ne "logged_out") {
        throw "FALLO: logout con CSRF correcto no devolvio logged_out"
    }
    Write-Host "Logout con CSRF correcto OK"
}

Write-Section "STEP 8 - CRUD DE EMPRESAS (ADR-085/086/087)"
if ($DryRun) {
    Write-Host "[DRY-RUN] POST/PUT/DELETE $BackendUrl/api/auth/companies (ciclo completo)"
}
else {
    $companyNonce = "$(Get-Date -Format 'yyyyMMddHHmmssfff')_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
    $newCompanyName = "Smoke Test Distribuidora $companyNonce"
    $newCompanyRuc = New-ValidPeruRuc
    $authHeader = @{ Authorization = "Bearer $authToken" }

    # 8.1 alta con RUC valido (mismo checksum de tax_id.cpp), generado por
    # corrida para no colisionar con RUC ya sembrados (ver New-ValidPeruRuc) -> 201
    $created = Invoke-Api -Method POST -Path "/api/auth/companies" -Headers $authHeader -Body @{
        name = $newCompanyName
        ruc  = $newCompanyRuc
        country = "PE"
        domicilio_fiscal = "Av. Smoke 123"
    }
    if (-not $created.company -or -not $created.tenant_id) {
        throw "FALLO: alta de empresa no devolvio company/tenant_id"
    }
    Write-Host "Alta de empresa OK: $($created.company) (tenant=$($created.tenant_id))"

    # 8.2 alta duplicada (mismo nombre) -> 409, cierra la condicion de carrera de H4/ADR-085
    $dupStatus = 0
    try {
        Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/companies" -Headers $authHeader `
            -ContentType "application/json" -Body (@{ name = $newCompanyName } | ConvertTo-Json) `
            -TimeoutSec 30 -UseBasicParsing | Out-Null
        throw "FALLO: alta duplicada de empresa deberia responder 409"
    }
    catch {
        if ($_.Exception -is [System.Management.Automation.RuntimeException] -and $_.Exception.Message -like "FALLO:*") { throw }
        $dupStatus = Get-HttpStatusCode $_
    }
    if ($dupStatus -ne 409) { throw "FALLO: alta duplicada devolvio $dupStatus, se esperaba 409" }
    Write-Host "Alta duplicada rechazada con 409 OK"

    # 8.3 RUC con checksum invalido -> 400 ruc_invalido
    $invalidRucName = "Smoke Test RUC Invalido $companyNonce"
    $invalidStatus = 0
    try {
        Invoke-WebRequest -Method Post -Uri "$BackendUrl/api/auth/companies" -Headers $authHeader `
            -ContentType "application/json" -Body (@{ name = $invalidRucName; ruc = "20344735047" } | ConvertTo-Json) `
            -TimeoutSec 30 -UseBasicParsing | Out-Null
        throw "FALLO: RUC de checksum invalido deberia responder 400"
    }
    catch {
        if ($_.Exception -is [System.Management.Automation.RuntimeException] -and $_.Exception.Message -like "FALLO:*") { throw }
        $invalidStatus = Get-HttpStatusCode $_
    }
    if ($invalidStatus -ne 400) { throw "FALLO: RUC invalido devolvio $invalidStatus, se esperaba 400" }
    Write-Host "RUC de checksum invalido rechazado con 400 OK"

    # 8.4 localizar el company_id recien creado via el catalogo administrativo
    $adminList = Invoke-Api -Method GET -Path "/api/auth/companies/manage" -Headers $authHeader
    $companyRow = $adminList.companies | Where-Object { $_.name -eq $newCompanyName }
    if (-not $companyRow) { throw "FALLO: la empresa recien creada no aparece en GET /api/auth/companies/manage" }
    $companyId = $companyRow.company_id
    Write-Host "GET /manage OK: company_id=$companyId, ruc=$($companyRow.ruc)"

    # 8.5 PUT edita domicilio fiscal (nunca el nombre, ver ADR-085) -> 200
    $updated = Invoke-Api -Method PUT -Path "/api/auth/companies/$companyId" -Headers $authHeader -Body @{
        ruc = $newCompanyRuc
        country = "PE"
        domicilio_fiscal = "Av. Smoke 456 (editado)"
    }
    if ($updated.domicilio_fiscal -ne "Av. Smoke 456 (editado)") {
        throw "FALLO: PUT no persistio el domicilio_fiscal editado"
    }
    Write-Host "PUT de empresa OK: domicilio_fiscal actualizado"

    # 8.6 DELETE = baja logica (soft delete) -> 200, active=false
    $deactivated = Invoke-Api -Method DELETE -Path "/api/auth/companies/$companyId" -Headers $authHeader
    if ($deactivated.active -ne $false) { throw "FALLO: DELETE no dejo la empresa como active=false" }
    Write-Host "DELETE (baja logica) OK: active=false, usuarios_afectados=$($deactivated.active_users_affected)"

    # 8.7 el catalogo publico ya no debe listarla; el administrativo (con include_inactive) si
    $publicList = Invoke-Api -Method GET -Path "/api/auth/companies"
    if ($publicList.companies -contains $newCompanyName) {
        throw "FALLO: la empresa dada de baja sigue apareciendo en el catalogo publico"
    }
    $adminListInactive = Invoke-Api -Method GET -Path "/api/auth/companies/manage?include_inactive=true" -Headers $authHeader
    $inactiveRow = $adminListInactive.companies | Where-Object { $_.company_id -eq $companyId }
    if (-not $inactiveRow -or $inactiveRow.active -ne $false) {
        throw "FALLO: la empresa dada de baja no aparece como active=false en el catalogo administrativo"
    }
    Write-Host "Catalogo publico/administrativo consistentes tras la baja OK"

    # 8.8 reactivar -> 200, active=true
    $reactivated = Invoke-Api -Method DELETE -Path "/api/auth/companies/$companyId`?reactivate=true" -Headers $authHeader
    if ($reactivated.active -ne $true) { throw "FALLO: la reactivacion no dejo active=true" }
    Write-Host "Reactivacion OK: active=true"
}

Write-Section "SMOKE AUTH COMPLETADO"
Write-Host "Resultado: OK"
