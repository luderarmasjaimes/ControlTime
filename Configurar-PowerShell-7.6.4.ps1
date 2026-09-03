$ErrorActionPreference = 'Stop'

$powerShellDir = 'C:\PowerShell-7.6.4-win-x64'
$pwshExe = Join-Path $powerShellDir 'pwsh.exe'

if (-not (Test-Path -LiteralPath $pwshExe)) {
    throw "No se encontro: $pwshExe"
}

$signature = Get-AuthenticodeSignature -LiteralPath $pwshExe
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'pwsh.exe no tiene una firma digital valida de Microsoft.'
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd('\') -ieq $powerShellDir.TrimEnd('\') }
if (-not $alreadyPresent) {
    $newPath = (($pathEntries + $powerShellDir) -join ';').Trim(';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
}

$appPathKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\pwsh.exe'
New-Item -Path $appPathKey -Force | Out-Null
Set-Item -Path $appPathKey -Value $pwshExe
New-ItemProperty -Path $appPathKey -Name 'Path' -Value $powerShellDir -PropertyType String -Force | Out-Null

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $startMenu 'PowerShell 7.6.4.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pwshExe
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.IconLocation = "$pwshExe,0"
$shortcut.Description = 'PowerShell 7.6.4'
$shortcut.Save()

$env:Path = "$powerShellDir;$env:Path"
$installedVersion = & $pwshExe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

Write-Host ''
Write-Host "PowerShell $installedVersion configurado correctamente." -ForegroundColor Green
Write-Host 'El comando pwsh estara disponible en las terminales nuevas.' -ForegroundColor Green
Write-Host 'Cierre y vuelva a abrir PowerShell, CMD o Windows Terminal.' -ForegroundColor Yellow
Read-Host 'Presione Enter para cerrar'
