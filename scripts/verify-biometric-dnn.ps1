param(
    [string]$BackendUrl = "http://localhost:8081",
    [string]$ComposeFile = "docker-compose.yml",
    [switch]$EnableDnn,
    [string]$ModelHostDir = "./biometric-models",
    [string]$ModelFileName = "face_qc.onnx",
    [string]$AdminUser,
    [pscredential]$AdminPassword,
    [string]$Company = "Minera Raura"
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

function Invoke-Json {
    param(
        [Parameter(Mandatory = $true)] [ValidateSet("GET", "POST")] [string]$Method,
        [Parameter(Mandatory = $true)] [string]$Url,
        [object]$Body,
        [hashtable]$Headers
    )

    $payload = $null
    if ($null -ne $Body) {
        $payload = $Body | ConvertTo-Json -Depth 8
    }

    if ($Method -eq "GET") {
        return Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec 30
    }

    return Invoke-RestMethod -Method Post -Uri $Url -Headers $Headers -ContentType "application/json" -Body $payload -TimeoutSec 30
}

Write-Section "VERIFY BIOMETRIC DNN"
Write-Host "Backend: $BackendUrl"

$modelHostPath = Join-Path $ModelHostDir $ModelFileName
if (Test-Path $modelHostPath) {
    Write-Host "Modelo detectado: $modelHostPath"
} else {
    Write-Host "Modelo no detectado: $modelHostPath"
}

if ($EnableDnn) {
    Write-Section "ENABLE DNN"
    $env:BIOMETRIC_DNN_ENABLE = "true"
    $env:BIOMETRIC_MODEL_HOST_DIR = $ModelHostDir
    Write-Host "BIOMETRIC_DNN_ENABLE=true"
    Write-Host "BIOMETRIC_MODEL_HOST_DIR=$ModelHostDir"

    docker-compose -f $ComposeFile up -d --build web | Out-Host
}

Write-Section "HEALTH"
$health = Invoke-RestMethod -Method Get -Uri "$BackendUrl/health" -TimeoutSec 30
Write-Host ("Health status: " + $health.status)

if (-not $AdminUser -or -not $AdminPassword) {
    Write-Section "STATUS"
    Write-Host "No se envio credencial admin. Mostrando solo log runtime."
    docker-compose -f $ComposeFile logs web --tail 80 | Select-String -Pattern "biometric dnn|biometric provider|auth storage mode" | ForEach-Object { $_.ToString() } | Out-Host
    exit 0
}

Write-Section "LOGIN ADMIN"
$plainAdminPassword = [System.Net.NetworkCredential]::new("", $AdminPassword.Password).Password

$login = Invoke-Json -Method POST -Url "$BackendUrl/api/auth/login/password" -Body @{
    company = $Company
    username = $AdminUser
    password = $plainAdminPassword
}
if (-not $login.user.token) {
    throw "No se pudo obtener token admin"
}
$token = $login.user.token
Write-Host "Login admin OK"

Write-Section "DNN STATUS API"
$status = Invoke-Json -Method GET -Url "$BackendUrl/api/auth/biometric/status" -Headers @{ Authorization = "Bearer $token" }
$status | ConvertTo-Json -Depth 10 | Out-Host

Write-Section "VERIFY COMPLETED"
Write-Host "Resultado: OK"
