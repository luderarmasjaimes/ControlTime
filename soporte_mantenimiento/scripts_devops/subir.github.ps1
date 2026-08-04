param(
    [string]$RepoPath = "C:\InformeCliente",
    [string]$RepoUrl = "https://github.com/luderarmasjaimes/ControlTime.git",
    [string]$Branch = "main",
    [string]$CommitMessage,
    [switch]$RunChecks,
    [switch]$ForcePush,
    [switch]$DryRun
)

$scriptPath = Join-Path $PSScriptRoot "subir-github.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "No se encontro el script base: $scriptPath"
}

& $scriptPath `
    -RepoPath $RepoPath `
    -RepoUrl $RepoUrl `
    -Branch $Branch `
    -CommitMessage $CommitMessage `
    -RunChecks:$RunChecks `
    -ForcePush:$ForcePush `
    -DryRun:$DryRun
