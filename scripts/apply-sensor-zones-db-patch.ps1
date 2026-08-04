# Alias: el parche de zonas/telemetría unificado es el 28 (tenant UUID).
# Redirige a apply-mining-telemetry-tenant-uuid-patch.ps1 para no romper scripts antiguos.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
& (Join-Path $root "scripts\apply-mining-telemetry-tenant-uuid-patch.ps1")
