param(
    [string]$RepoPath = "C:\InformeCliente",
    [string]$RepoUrl = "https://github.com/luderarmasjaimes/ControlTime.git",
    [string]$Branch = "main",
    [string]$CommitMessage,
    [switch]$RunE2E,
    [switch]$RunAuthSmoke,
    [string]$BackendUrl = "http://localhost:8081",
    [switch]$AutoPush,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "====================================="
    Write-Host $Text
    Write-Host "====================================="
}

function Invoke-CommandSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host "[STEP] $Label"
    try {
        & $Action | Out-Host
        Write-Host "[OK] $Label"
        return $true
    }
    catch {
        Write-Host "[ERROR] $Label"
        Write-Host $_.Exception.Message
        return $false
    }
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$NpmArgs
    )

    $cmdLine = "npm " + ($NpmArgs -join " ")
    if ($DryRun) {
        Write-Host "[DRY-RUN] $cmdLine"
        return
    }

    Write-Host "> $cmdLine"
    & npm @NpmArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Fallo comando: $cmdLine (exit=$exitCode)"
    }
}

function Test-Frontend {
    param([switch]$ExecuteE2E)

    $results = [ordered]@{
        Build = $false
        UnitTests = $false
        E2E = $true
    }

    if (-not (Test-Path "frontend\package.json")) {
        throw "No se encontro frontend/package.json"
    }

    [void]($results.Build = Invoke-CommandSafe -Label "Build frontend" -Action {
        Invoke-Npm @("--prefix", "frontend", "run", "build")
    })

    [void]($results.UnitTests = Invoke-CommandSafe -Label "Unit tests (Vitest)" -Action {
        Invoke-Npm @("--prefix", "frontend", "run", "test:run", "--if-present")
    })

    if ($ExecuteE2E) {
        [void]($results.E2E = Invoke-CommandSafe -Label "E2E tests (Playwright)" -Action {
            Invoke-Npm @("--prefix", "frontend", "run", "test:e2e", "--if-present")
        })
    }

    return [pscustomobject]$results
}

function Invoke-AutoFixes {
    Write-Section "FASE 2 - CORRECCION AUTOMATICA (SAFE FIXES)"

    $fixes = @()

    $fixes += Invoke-CommandSafe -Label "Reinstalar dependencias frontend (npm ci)" -Action {
        Invoke-Npm @("--prefix", "frontend", "ci")
    }

    $viteCache = Join-Path $RepoPath "frontend\node_modules\.vite"
    $fixes += Invoke-CommandSafe -Label "Limpiar cache Vite" -Action {
        if (Test-Path $viteCache) {
            if ($DryRun) {
                Write-Host "[DRY-RUN] Remove-Item $viteCache -Recurse -Force"
            }
            else {
                Remove-Item $viteCache -Recurse -Force
            }
        }
    }

    $customFixScript = Join-Path $RepoPath "scripts\fix-errors.ps1"
    if (Test-Path $customFixScript) {
        $fixes += Invoke-CommandSafe -Label "Ejecutar correcciones personalizadas" -Action {
            if ($DryRun) {
                Write-Host "[DRY-RUN] powershell -ExecutionPolicy Bypass -File $customFixScript"
            }
            else {
                & powershell -ExecutionPolicy Bypass -File $customFixScript
                if ($LASTEXITCODE -ne 0) {
                    throw "Fallo script personalizado de correccion"
                }
            }
        }
    }

    return ($fixes -contains $true)
}

Write-Section "PIPELINE LOCAL AUTO-HEAL"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git no esta instalado o no esta en PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node/NPM no esta instalado o no esta en PATH."
}
if (-not (Test-Path $RepoPath)) {
    throw "No existe la ruta del repositorio: $RepoPath"
}

Set-Location $RepoPath
Write-Host "Repositorio: $(Get-Location)"

Write-Section "FASE 1 - IDENTIFICACION DE ERRORES"
& git status --short
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo leer git status"
}

$firstPass = Test-Frontend -ExecuteE2E:$RunE2E
$firstOk = ([bool]$firstPass.Build -and [bool]$firstPass.UnitTests -and [bool]$firstPass.E2E)

if (-not $firstOk) {
    $fixApplied = Invoke-AutoFixes

    Write-Section "FASE 3 - REPRUEBAS POST-CORRECCION"
    $secondPass = Test-Frontend -ExecuteE2E:$RunE2E
    $secondOk = ([bool]$secondPass.Build -and [bool]$secondPass.UnitTests -and [bool]$secondPass.E2E)

    if (-not $secondOk) {
        throw "Persisten errores despues de autocorreccion. Revisar logs y corregir manualmente."
    }

    if ($fixApplied) {
        Write-Host "Se aplicaron correcciones automaticas y las pruebas ahora pasan."
    }
}
else {
    Write-Host "No se detectaron errores en la primera validacion."
}

if ($RunAuthSmoke) {
    Write-Section "FASE 3B - SMOKE AUTH E2E"
    $authSmokeScript = Join-Path $RepoPath "scripts\smoke-auth-e2e.ps1"
    if (-not (Test-Path $authSmokeScript)) {
        throw "No se encontro script smoke auth: $authSmokeScript"
    }

    if ($DryRun) {
        Write-Host "[DRY-RUN] powershell -ExecutionPolicy Bypass -File $authSmokeScript -BackendUrl $BackendUrl -DryRun"
    }
    else {
        & powershell -ExecutionPolicy Bypass -File $authSmokeScript -BackendUrl $BackendUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Fallo el smoke auth e2e."
        }
    }
}

Write-Section "FASE 4 - SINCRONIZACION A GITHUB"
$syncScript = Join-Path $RepoPath "subir-github.ps1"
if (-not (Test-Path $syncScript)) {
    throw "No se encontro el script de sincronizacion: $syncScript"
}

$syncArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $syncScript,
    "-RepoPath", $RepoPath,
    "-RepoUrl", $RepoUrl,
    "-Branch", $Branch,
    "-RunChecks"
)

if (-not [string]::IsNullOrWhiteSpace($CommitMessage)) {
    $syncArgs += @("-CommitMessage", $CommitMessage)
}

if (-not $AutoPush) {
    $syncArgs += "-DryRun"
}

if ($DryRun) {
    Write-Host "[DRY-RUN] powershell $($syncArgs -join ' ')"
}
else {
    & powershell @syncArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo la sincronizacion con GitHub."
    }
}

Write-Section "PIPELINE COMPLETADO"
if ($AutoPush) {
    Write-Host "Resultado: validado, corregido (si aplicaba), probado y sincronizado a GitHub."
}
else {
    Write-Host "Resultado: validado, corregido (si aplicaba) y probado. Sin push real (modo seguro)."
}
