#Requires -Version 5.1
<#
.SYNOPSIS
  Reserva URLs HTTP para la UI de mantenimiento (HttpListener) en Windows.

.DESCRIPTION
  Debe ejecutarse UNA VEZ en PowerShell como ADMINISTRADOR.
  Corrige el error al iniciar MaintenanceServer cuando Windows deniega el enlace.

.EXAMPLE
  # Clic derecho en PowerShell > Ejecutar como administrador, luego:
  cd C:\InformeCliente
  .\scripts\maintenance-ui\Register-MaintenanceUrlAcl.ps1
#>
param(
    [int]$Port = 17381
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ""
    Write-Host "Este script debe ejecutarse como ADMINISTRADOR." -ForegroundColor Red
    Write-Host "  Clic derecho en PowerShell > Ejecutar como administrador" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$urls = @(
    "http://127.0.0.1:$Port/",
    "http://localhost:$Port/"
)

Write-Host ""
Write-Host "Registrando urlacl para usuario: $user" -ForegroundColor Cyan
Write-Host "Puerto: $Port" -ForegroundColor Gray
Write-Host ""

foreach ($u in $urls) {
    Write-Host "  netsh http add urlacl url=$u user=$user" -ForegroundColor Gray
    $p = Start-Process -FilePath "netsh.exe" -ArgumentList @('http', 'add', 'urlacl', "url=$u", "user=$user") -Wait -PassThru -NoNewWindow
    $code = $p.ExitCode
    if ($code -eq 0) {
        Write-Host "    OK" -ForegroundColor Green
    } else {
        Write-Host "    Codigo salida: $code (si es duplicado, puede ignorarse)" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "Listo. Cierre esta ventana admin y ejecute de nuevo (sin admin):" -ForegroundColor Green
Write-Host "  .\scripts\Start-MaintenanceUI.ps1" -ForegroundColor Gray
Write-Host ""
Read-Host "Presione Enter para salir"
