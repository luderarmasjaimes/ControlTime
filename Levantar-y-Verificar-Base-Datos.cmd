@echo off
set "SCRIPT=%~dp0Levantar-y-Verificar-Base-Datos.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
