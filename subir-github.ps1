param(
    [string]$RepoPath = "C:\InformeCliente",
    [string]$RepoUrl = "https://github.com/luderarmasjaimes/ControlTime.git",
    [string]$Branch = "main",
    [string]$CommitMessage,
    [switch]$RunChecks,
    [switch]$ForcePush,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GlobalGitName = "Luder Armas"
$GlobalGitEmail = "luder.eder.armas.jaimes.leaj@gmail.com"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "====================================="
    Write-Host $Text
    Write-Host "====================================="
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$GitArgs
    )

    if ($DryRun) {
        Write-Host "[DRY-RUN] git $($GitArgs -join ' ')"
        return ""
    }

    Write-Host "> git $($GitArgs -join ' ')"
    $output = & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo comando: git $($GitArgs -join ' ')"
    }
    return $output
}

Write-Section "SINCRONIZACION AUTOMATICA A GITHUB"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git no esta instalado o no esta en PATH."
}

if (-not (Test-Path $RepoPath)) {
    throw "No existe la ruta del repositorio: $RepoPath"
}

Set-Location $RepoPath
Write-Host "Directorio actual: $(Get-Location)"

Write-Section "CONFIGURANDO GIT (USUARIO Y EMAIL)"
Invoke-Git @("config", "--global", "user.name", $GlobalGitName)
Invoke-Git @("config", "--global", "user.email", $GlobalGitEmail)

if (-not (Test-Path ".git")) {
    Write-Host "No se encontro .git, inicializando repositorio..."
    Invoke-Git @("init")
}

Write-Host "Asegurando rama: $Branch"
$currentBranch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo obtener la rama actual."
}

if ($currentBranch -eq "HEAD") {
    Invoke-Git @("checkout", "-B", $Branch)
}
elseif ($currentBranch -ne $Branch) {
    & git checkout $Branch 2>$null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git @("checkout", "-b", $Branch)
    }
}

Write-Section "CONFIGURANDO REMOTO"
$remoteUrl = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteUrl)) {
    Invoke-Git @("remote", "add", "origin", $RepoUrl)
}
elseif ($remoteUrl.Trim() -ne $RepoUrl) {
    Invoke-Git @("remote", "set-url", "origin", $RepoUrl)
}

if ($RunChecks) {
    Write-Section "EJECUTANDO VALIDACIONES LOCALES"
    if (Test-Path "frontend\package.json") {
        if ($DryRun) {
            Write-Host "[DRY-RUN] npm --prefix frontend run test:run --if-present"
        }
        else {
            & npm --prefix frontend run test:run --if-present
            if ($LASTEXITCODE -ne 0) {
                throw "Las pruebas frontend fallaron. Se cancela el push."
            }
        }
    }
    else {
        Write-Host "No se encontro frontend/package.json. Se omiten pruebas."
    }
}

Write-Section "PREPARANDO CAMBIOS"
Invoke-Git @("add", "-A")

$status = (& git status --porcelain)
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo obtener el estado de git."
}

if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
    Write-Host "No hay cambios para commit."
}
else {
    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $CommitMessage = "chore: sync automatica $timestamp"
    }

    Invoke-Git @("commit", "-m", $CommitMessage)
}

Write-Section "SUBIENDO A GITHUB"
$pushArgs = @("push", "-u", "origin", $Branch)
if ($ForcePush) {
    $pushArgs = @("push", "-u", "origin", $Branch, "--force-with-lease")
}
Invoke-Git $pushArgs

Write-Section "PROCESO TERMINADO OK"