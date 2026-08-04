#Requires -Version 5.1
<#
.SYNOPSIS
  Inicia la pagina web local de mantenimiento para ejecutar scripts PS1 del repo (lista blanca).

.DESCRIPTION
  Abre un servidor solo en 127.0.0.1. Luego abra el navegador en la URL indicada.

.EXAMPLE
  cd C:\InformeCliente
  .\scripts\Start-MaintenanceUI.ps1

.EXAMPLE
  .\scripts\Start-MaintenanceUI.ps1 -Port 17382

.EXAMPLE
  .\scripts\Start-MaintenanceUI.ps1 -NoBrowser
#>
param(
    [int]$Port = 17381,
    [switch]$NoBrowser
)

$server = Join-Path $PSScriptRoot "maintenance-ui\MaintenanceServer.ps1"
if (-not (Test-Path -LiteralPath $server)) {
    Write-Error "No se encontro: $server"
}
if ($NoBrowser) {
    & $server -Port $Port -NoBrowser
} else {
    & $server -Port $Port
}
