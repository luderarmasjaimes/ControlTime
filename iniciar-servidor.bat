@echo off
rem Trampolin: doble clic en .ps1 no lo ejecuta directamente en Windows
rem (requiere powershell.exe -File), por eso este .bat solo invoca al
rem script real. %~dp0 = carpeta de este .bat, sin importar desde donde
rem se haga doble clic.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-servidor.ps1"
