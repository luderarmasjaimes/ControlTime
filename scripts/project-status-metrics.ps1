param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$aliases = @(
    '004-replica-alta-disponibilidad',
    '005-push-tiempo-real-sse'
)

$overrides = @{
    '019' = @{ Done = 19; Total = 20; Reason = 'tabla T1-T20; T18 abierto por CA-4 productiva' }
    '020' = @{ Done = 9; Total = 9; Reason = 'tabla de estados Completada' }
}

$records = @()
Get-ChildItem (Join-Path $RepoRoot 'specs') -Directory |
    Where-Object { $_.Name -match '^(\d{3})-' -and $_.Name -notin $aliases } |
    Sort-Object Name |
    ForEach-Object {
        $id = $_.Name.Substring(0, 3)
        $taskFile = Join-Path $_.FullName 'tasks.md'
        if (-not (Test-Path $taskFile)) { return }

        if ($overrides.ContainsKey($id)) {
            $done = $overrides[$id].Done
            $total = $overrides[$id].Total
            $source = $overrides[$id].Reason
        } else {
            $text = Get-Content $taskFile -Raw
            $done = ([regex]::Matches($text, '(?m)^\s*- \[[xX]\]')).Count
            $open = ([regex]::Matches($text, '(?m)^\s*- \[ \]')).Count
            $total = $done + $open
            $source = 'checkboxes canónicos'
        }

        $records += [pscustomobject]@{
            Spec = $id
            Done = $done
            Total = $total
            Percent = if ($total) { [math]::Round(100 * $done / $total, 1) } else { 0 }
            Source = $source
        }
    }

$doneAll = ($records | Measure-Object Done -Sum).Sum
$totalAll = ($records | Measure-Object Total -Sum).Sum

$stageMap = [ordered]@{
    'R2-Jul' = @('001','006')
    'R3-Ago' = @('002','005','007','008','009','010','011','020','021')
    'R4-Sep' = @('007','012','013','014','016','019','021')
    'R5-Oct' = @('003','004','008','011','015','017','018','023')
}

$stages = foreach ($entry in $stageMap.GetEnumerator()) {
    $subset = $records | Where-Object { $_.Spec -in $entry.Value }
    $done = ($subset | Measure-Object Done -Sum).Sum
    $total = ($subset | Measure-Object Total -Sum).Sum
    [pscustomobject]@{
        Stage = $entry.Key
        Done = $done
        Total = $total
        Percent = [math]::Round(100 * $done / $total, 1)
    }
}

[pscustomobject]@{
    Cutoff = '2026-08-18'
    CanonicalSpecs = $records.Count
    Done = $doneAll
    Total = $totalAll
    Percent = [math]::Round(100 * $doneAll / $totalAll, 1)
    Specs = $records
    Stages = $stages
} | ConvertTo-Json -Depth 5
