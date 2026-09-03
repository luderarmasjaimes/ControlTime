# ============================================================================
# Habilitar-Acceso-LAN-Firewall.ps1
# Configura las reglas del Firewall de Windows para permitir acceso LAN a Beemetry
# ============================================================================

$RuleName = "AURIXA-Beemetry LAN (5173,5180,8082,8443,8000)"
$Ports = @("5173", "5180", "8082", "8443", "8000")

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Configuración de Firewall para Acceso LAN (Red Local)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Verificar si se ejecuta como Administrador
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Host "[ERROR] Este script requiere ejecutarse como Administrador." -ForegroundColor Red
    Write-Host "Haz clic derecho en 'Habilitar-Acceso-LAN-Firewall.bat' y selecciona 'Ejecutar como administrador'."
    Read-Host "Presiona Enter para salir"
    exit 1
}

try {
    # Eliminar regla anterior si existía para actualizarla limpiamente
    Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

    # Crear regla de entrada para TCP en todos los perfiles (Domain, Private, Public)
    New-NetFirewallRule `
        -DisplayName $RuleName `
        -Description "Permite el acceso a la plataforma Beemetry desde otras PCs en la misma red LAN (puertos 5173, 5180, 8082, 8443, 8000)" `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $Ports `
        -Action Allow `
        -Profile Any `
        -ErrorAction Stop | Out-Null

    Write-Host "[OK] Regla de Firewall creada exitosamente:" -ForegroundColor Green
    Write-Host "     Nombre: $RuleName" -ForegroundColor Green
    Write-Host "     Puertos permitidos: $($Ports -join ', ')" -ForegroundColor Green
    Write-Host "     Perfiles: Todos (Público, Privado, Dominio)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] No se pudo crear la regla de firewall: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Direcciones IP para ingresar desde otra PC en la misma red" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$IPs = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notlike "*Loopback*" -and 
    $_.IPAddress -notlike "169.254.*" -and 
    $_.IPAddress -notlike "172.*" -and 
    $_.IPAddress -notlike "10.0.*"
}

foreach ($ip in $IPs) {
    Write-Host ""
    Write-Host "Red ($($ip.InterfaceAlias)):" -ForegroundColor Yellow
    Write-Host "  -> Opción A (Stack Docker producción):  http://$($ip.IPAddress):5173" -ForegroundColor White
    Write-Host "  -> Opción B (Modo Desarrollo Vite):     http://$($ip.IPAddress):5180" -ForegroundColor White
}

Write-Host ""
Write-Host "Notas importantes:" -ForegroundColor Gray
Write-Host "1. Ambas PCs deben estar conectadas a la misma red Wi-Fi o cable." -ForegroundColor Gray
Write-Host "2. En la otra PC, abre el navegador (Chrome / Edge) e ingresa a la URL de arriba." -ForegroundColor Gray
Write-Host "3. Si la red Wi-Fi cambia, vuelve a ejecutar este script o revisa tu IP con 'ipconfig'." -ForegroundColor Gray
Write-Host ""
Read-Host "Presiona Enter para finalizar"
