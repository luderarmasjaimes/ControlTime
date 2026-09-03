@echo off
set "SCRIPT=%~dp0Instalar-Docker-PostgreSQL.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
