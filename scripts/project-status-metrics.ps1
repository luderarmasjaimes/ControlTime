param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$aliases = @(
    '004-replica-alta-disponibilidad',
    '005-push-tiempo-real-sse'
)

# Specs formalmente fuera de alcance de ESTE proyecto por decision de
# Gerencia (no duplicados como $aliases arriba) -- se conservan en el
# repositorio como referencia tecnica, pero no cuentan en el avance
# consolidado de un proyecto del que ya no son alcance.
# 022: Operaciones de Campo, ver ADR-178 (2026-09-12).
$outOfScope = @(
    '022-operaciones-campo-offline-erp'
)

$overrides = @{
    '019' = @{ Done = 19; Total = 20; Reason = 'tabla T1-T20; T18 abierto por CA-4 productiva' }
    '020' = @{ Done = 9; Total = 9; Reason = 'tabla de estados Completada' }
    '027' = @{ Done = 14; Total = 22; Reason = 'avance auditado ADR-212; tareas T6/T9/T15/T16/T18/T20-T22 abiertas' }
}

$productionBacklog = [ordered]@{
    '015' = @{ Open = 14; Label = 'DR/continuidad'; Items = 'T1-T14' }
    '003' = @{ Open = 7; Label = 'Tier frio'; Items = 'T2,T9,T10,T12,T16,T17,T18' }
    '004' = @{ Open = 4; Label = 'Replica/HA'; Items = 'T8,T14,T15,T16' }
    '023' = @{ Open = 5; Label = 'Portabilidad/restore/CI-CD'; Items = 'T7-T11' }
    '024' = @{ Open = 6; Label = 'GEOCATMIN'; Items = 'T6,T15-T19' }
    '027' = @{ Open = 8; Label = 'Sensores directo+gateway'; Items = 'T6,T9,T15,T16,T18,T20-T22' }
    '016' = @{ Open = 1; Label = 'Alertas'; Items = 'T14 + demo alarmas.manage' }
    '014' = @{ Open = 2; Label = 'Offline'; Items = 'T13,T15' }
}

$records = @()
Get-ChildItem (Join-Path $RepoRoot 'specs') -Directory |
    Where-Object { $_.Name -match '^(\d{3})-' -and $_.Name -notin $aliases -and $_.Name -notin $outOfScope } |
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
            $source = 'checkboxes canonicos'
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

# Cifras de corte aprobadas por ADR-210/ADR-212. Se mantienen separadas para
# que Gerencia pueda comparar la metrica historica repetible con la lectura
# auditada y el backlog fino que realmente bloquea el go-live.
$officialDone = 148
$officialTotal = 204
$auditedDone = 162
$auditedTotal = 221
$fineBacklogTotal = ($productionBacklog.Values | ForEach-Object { $_.Open } | Measure-Object -Sum).Sum

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
        Percent = if ($total) { [math]::Round(100 * $done / $total, 1) } else { 0 }
    }
}

[pscustomobject]@{
    Cutoff = (Get-Date -Format 'yyyy-MM-dd')
    CanonicalSpecs = $records.Count
    Done = $doneAll
    Total = $totalAll
    Percent = if ($totalAll) { [math]::Round(100 * $doneAll / $totalAll, 1) } else { 0 }
    Official = [pscustomobject]@{
        Done = $officialDone
        Total = $officialTotal
        Percent = [math]::Round(100 * $officialDone / $officialTotal, 1)
        Source = 'metrica historica repetible ADR-210/212; conserva comparabilidad del corte'
    }
    AuditedStrict = [pscustomobject]@{
        Done = $auditedDone
        Total = $auditedTotal
        Percent = [math]::Round(100 * $auditedDone / $auditedTotal, 1)
        Source = 'lectura gerencial recomendada ADR-212; incluye SPEC-027 recalculada 14/22'
    }
    ProductionExitBacklog = [pscustomobject]@{
        Total = $fineBacklogTotal
        Source = 'backlog fino de salida a produccion ADR-212'
        Items = foreach ($entry in $productionBacklog.GetEnumerator()) {
            [pscustomobject]@{
                Spec = $entry.Key
                Label = $entry.Value.Label
                Open = $entry.Value.Open
                Items = $entry.Value.Items
            }
        }
    }
    Specs = $records
    Stages = $stages
} | ConvertTo-Json -Depth 6
