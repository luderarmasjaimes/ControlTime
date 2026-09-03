@echo off
rem ============================================================================
rem Habilitar-Acceso-LAN-Firewall.bat
rem Abre los puertos necesarios en el Firewall de Windows con permisos de Administrador
rem para que la web de Beemetry sea visible desde cualquier PC de la misma red local.
rem ============================================================================

net session >nul 2>&1
if %errorLevel% == 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Habilitar-Acceso-LAN-Firewall.ps1"
) else (
    echo Solicitando permisos de Administrador para configurar el Firewall...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0Habilitar-Acceso-LAN-Firewall.ps1\"\"' -Verb RunAs"
)
