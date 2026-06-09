# ETL operativo KPI: sincroniza KPI desde BD externa (si está configurada)
# y hace fallback al dashboard local.
#
# Uso:
#   .\scripts\etl-sync-kpis.ps1 -BaseUrl "http://localhost:8082"
#   .\scripts\etl-sync-kpis.ps1 -AuthToken "<token>" -BaseUrl "http://localhost:8082"
# Token opcional: los endpoints de sync KPI no exigen sesión; use token si su gateway lo requiere.

param(
    [string]$AuthToken = "",
    [string]$BaseUrl = "http://localhost:8082"
)

$ErrorActionPreference = "Stop"

if (-not $AuthToken) {
    $AuthToken = $env:KPI_SYNC_TOKEN
}

function Join-Query([string]$url, [string]$token) {
    if (-not $token) { return $url }
    $sep = if ($url -match '\?') { '&' } else { '?' }
    return "$url${sep}auth_token=$token"
}

$base = $BaseUrl.TrimEnd("/")
$externalUrl = Join-Query "$base/api/mining/kpis/sync-from-external" $AuthToken
$dashboardUrl = Join-Query "$base/api/mining/kpis/sync-from-dashboard" $AuthToken

Write-Host "Sincronizando KPI desde fuente externa..."
$external = Invoke-RestMethod -Method Post -Uri $externalUrl -ContentType "application/json" -Body "{}"
Write-Host ("Respuesta externa: " + ($external | ConvertTo-Json -Compress))

if (($external.synced -as [int]) -le 0) {
    Write-Host "Sin nuevos KPI externos. Ejecutando fallback dashboard local..."
    $dashboard = Invoke-RestMethod -Method Post -Uri $dashboardUrl -ContentType "application/json" -Body "{}"
    Write-Host ("Respuesta dashboard: " + ($dashboard | ConvertTo-Json -Compress))
}

Write-Host "ETL KPI finalizado."
