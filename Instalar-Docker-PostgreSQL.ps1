$ErrorActionPreference = 'Stop'

$documentsDir = [Environment]::GetFolderPath('MyDocuments')
$installer = Join-Path $documentsDir 'Codex\2026-08-12\nec\work\Docker Desktop Installer.exe'
$installDir = 'C:\DockerDesktop'
$dataDir = 'C:\DockerDesktop\data'
$logPath = Join-Path $PSScriptRoot 'Instalar-Docker-PostgreSQL.log'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $escapedPath = $PSCommandPath.Replace("'", "''")
    $command = "& '$escapedPath'"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand
    )
    exit
}

Start-Transcript -LiteralPath $logPath -Force
try {
    if (-not (Test-Path -LiteralPath $installer)) {
        throw "No se encontro el instalador: $installer"
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Docker Inc') {
        throw 'La firma digital del instalador no es valida o no pertenece a Docker Inc.'
    }

    & dism.exe /Online /Enable-Feature /FeatureName:Microsoft-Windows-Subsystem-Linux /All /NoRestart
    if ($LASTEXITCODE -notin 0,3010) { throw "No se pudo habilitar WSL. Codigo: $LASTEXITCODE" }

    & dism.exe /Online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart
    if ($LASTEXITCODE -notin 0,3010) { throw "No se pudo habilitar VirtualMachinePlatform. Codigo: $LASTEXITCODE" }

    New-Item -ItemType Directory -Force -Path $installDir, $dataDir | Out-Null
    $arguments = @(
        'install',
        '--accept-license',
        '--backend=wsl-2',
        '--no-windows-containers',
        "--installation-dir=$installDir",
        "--wsl-default-data-root=$dataDir"
    )
    $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -notin 0,3010) {
        throw "Docker Desktop no pudo instalarse. Codigo: $($process.ExitCode)"
    }

    & wsl.exe --update --web-download
    & wsl.exe --set-default-version 2

    Write-Host ''
    Write-Host 'Instalacion base completada.' -ForegroundColor Green
    Write-Host 'Reinicie Windows si se lo solicita y vuelva a Codex para continuar con la recuperacion y las pruebas.' -ForegroundColor Yellow
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    throw
}
finally {
    Stop-Transcript
    Read-Host 'Presione Enter para cerrar'
}
