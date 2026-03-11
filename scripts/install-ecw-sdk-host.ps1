param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\GDAL",
  [string]$DownloadDir = "c:\mapas\tmp"
)

$ErrorActionPreference = "Stop"

$coreUrl = "https://download.gisinternals.com/sdk/downloads/release-1944-x64-gdal-3-12-1-mapserver-8-6-0/gdal-3.12.1-1944-x64-core.msi"
$ecwUrl = "https://download.gisinternals.com/sdk/downloads/release-1944-x64-gdal-3-12-1-mapserver-8-6-0/gdal-3.12.1-1944-x64-ecw-55.msi"

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$coreMsi = Join-Path $DownloadDir "gdal-core.msi"
$ecwMsi = Join-Path $DownloadDir "gdal-ecw.msi"

Write-Host "[1/4] Descargando GDAL core..."
Invoke-WebRequest -Uri $coreUrl -OutFile $coreMsi

Write-Host "[2/4] Descargando plugin ECW..."
Invoke-WebRequest -Uri $ecwUrl -OutFile $ecwMsi

Write-Host "[3/4] Instalando GDAL core (modo usuario)..."
$coreLog = Join-Path $DownloadDir "gdal-core-user.log"
$core = Start-Process msiexec.exe -ArgumentList '/i',"`"$coreMsi`"",'ALLUSERS=2','MSIINSTALLPERUSER=1',"INSTALLDIR=`"$InstallRoot`"",'/qn','/norestart','/L*v',"`"$coreLog`"" -Wait -PassThru
if ($core.ExitCode -ne 0) {
  throw "Fallo instalando GDAL core. ExitCode=$($core.ExitCode). Revisa $coreLog"
}

Write-Host "[4/4] Instalando plugin ECW (modo usuario)..."
$ecwLog = Join-Path $DownloadDir "gdal-ecw-user.log"
$ecw = Start-Process msiexec.exe -ArgumentList '/i',"`"$ecwMsi`"",'ALLUSERS=2','MSIINSTALLPERUSER=1',"INSTALLDIR=`"$InstallRoot`"",'/qn','/norestart','/L*v',"`"$ecwLog`"" -Wait -PassThru
if ($ecw.ExitCode -ne 0) {
  throw "Fallo instalando plugin ECW. ExitCode=$($ecw.ExitCode). Revisa $ecwLog"
}

Write-Host "✅ SDK instalado en: $InstallRoot"
Write-Host "Configura en sesión actual para pruebas:"
Write-Host "`$env:PATH='$InstallRoot;`$env:PATH'"
Write-Host "`$env:GDAL_DRIVER_PATH='$InstallRoot\gdalplugins'"
Write-Host "`$env:GDAL_DATA='$InstallRoot\gdal-data'"
Write-Host "`$env:PROJ_LIB='$InstallRoot\projlib'"
