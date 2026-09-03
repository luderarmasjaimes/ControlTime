@echo off
set "SCRIPT=%~dp0Configurar-PowerShell-7.6.4.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
