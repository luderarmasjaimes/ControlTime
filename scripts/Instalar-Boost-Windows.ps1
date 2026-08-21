$ErrorActionPreference = 'Stop'

$boostRoot = 'C:\boost_1_92_0'
$versionHeader = Join-Path $boostRoot 'boost\version.hpp'
$bootstrap = Join-Path $boostRoot 'bootstrap.bat'
$b2 = Join-Path $boostRoot 'b2.exe'

if (-not (Test-Path -LiteralPath $versionHeader)) {
    throw "No se encontró una distribución completa de Boost en $boostRoot"
}

$versionLine = Select-String -LiteralPath $versionHeader -Pattern '^#define BOOST_VERSION ([0-9]+)$'
if (-not $versionLine -or $versionLine.Matches[0].Groups[1].Value -ne '109200') {
    throw 'La carpeta no contiene Boost 1.92.0 (BOOST_VERSION=109200).'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'No se detectó Visual Studio Installer. Instala Visual Studio Build Tools 2022 con Desarrollo para escritorio con C++ y vuelve a ejecutar.'
}

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
    throw 'Falta MSVC x64. Instala la carga Desarrollo para escritorio con C++ de Visual Studio Build Tools 2022.'
}

$devCmd = Join-Path $vsPath 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $devCmd)) {
    throw "No se encontró VsDevCmd.bat en $vsPath"
}

$commands = @(
    "call `"$devCmd`" -arch=x64 -host_arch=x64",
    "cd /d `"$boostRoot`"",
    "call bootstrap.bat",
    "b2.exe -j%NUMBER_OF_PROCESSORS% address-model=64 architecture=x86 variant=release link=static,shared runtime-link=shared threading=multi --with-system --with-json stage",
    'exit /b %ERRORLEVEL%'
) -join ' && '

$process = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/s', '/c', "`"$commands`"" -Wait -PassThru -NoNewWindow
if ($process.ExitCode -ne 0) {
    throw "La compilación de Boost Windows falló con código $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $b2)) {
    throw 'bootstrap.bat terminó, pero no generó b2.exe.'
}

$libraries = Get-ChildItem -LiteralPath (Join-Path $boostRoot 'stage\lib') -File -ErrorAction Stop
if (-not ($libraries.Name -match 'boost_json') -or -not ($libraries.Name -match 'boost_system')) {
    throw 'No se generaron las bibliotecas esperadas boost_json y boost_system.'
}

[Environment]::SetEnvironmentVariable('BOOST_ROOT', $boostRoot, 'User')
[Environment]::SetEnvironmentVariable('Boost_ROOT', $boostRoot, 'User')

Write-Host "Boost 1.92.0 Windows quedó preparado en $boostRoot" -ForegroundColor Green
Write-Host 'Nota: es una versión beta de desarrollo; Docker usa Boost 1.91.0 estable.' -ForegroundColor Yellow
