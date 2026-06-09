#Requires -Version 5.1
<#
.SYNOPSIS
  Servidor HTTP minimo en 127.0.0.1 (TcpListener) para la UI de mantenimiento.

.DESCRIPTION
  No usa HttpListener/http.sys: no requiere netsh urlacl ni ejecutar como admin.
  Lista blanca en manifest.json.

  Uso:
    cd C:\InformeCliente
    .\scripts\Start-MaintenanceUI.ps1

  Abra SOLO: http://127.0.0.1:17381/  (si localhost falla, use 127.0.0.1)

.PARAMETER Port
.PARAMETER NoBrowser
#>
param(
    [int]$Port = 17381,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$uiDir = $PSScriptRoot
$scriptsDir = Split-Path -Parent $uiDir
$root = Split-Path -Parent $scriptsDir

$manifestPath = Join-Path $uiDir "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Error "No se encontro manifest.json en: $manifestPath"
}

$manifestRaw = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$manifest = $manifestRaw | ConvertFrom-Json

function Get-SafeScriptPath {
    param([string]$FileName)
    if ([string]::IsNullOrWhiteSpace($FileName)) { return $null }
    $baseName = [System.IO.Path]::GetFileName($FileName)
    if ($baseName -ne $FileName) { return $null }
    $combined = Join-Path $scriptsDir $FileName
    $full = [System.IO.Path]::GetFullPath($combined)
    $scriptsFull = [System.IO.Path]::GetFullPath($scriptsDir)
    if (-not ($full.StartsWith($scriptsFull, [StringComparison]::OrdinalIgnoreCase))) {
        return $null
    }
    if (-not (Test-Path -LiteralPath $full)) { return $null }
    return $full
}

function Find-HeaderEndIndex {
    param([byte[]]$Data)
    $len = $Data.Length
    for ($i = 0; $i -le $len - 4; $i++) {
        if ($Data[$i] -eq 13 -and $Data[$i + 1] -eq 10 -and $Data[$i + 2] -eq 13 -and $Data[$i + 3] -eq 10) {
            return $i
        }
    }
    return -1
}

function Read-HttpRequest {
    param([System.Net.Sockets.NetworkStream]$Stream)
    $ms = New-Object System.IO.MemoryStream
    $buf = New-Object byte[] 8192
    $headerEnd = -1
    while ($headerEnd -lt 0) {
        $n = $Stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { return $null }
        $ms.Write($buf, 0, $n)
        if ($ms.Length -gt 262144) { return $null }
        $headerEnd = Find-HeaderEndIndex -Data ($ms.ToArray())
    }
    $all = $ms.ToArray()
    $headerByteLen = $headerEnd + 4
    $headerText = [System.Text.Encoding]::UTF8.GetString($all, 0, $headerByteLen)
    $lines = $headerText -split "`r`n"
    if ($lines.Count -lt 1) { return $null }
    $requestLine = $lines[0]
    if ($requestLine -notmatch '^(?i)(\w+)\s+(\S+)\s+HTTP/') { return $null }
    $method = $Matches[1].ToUpperInvariant()
    $rawPath = $Matches[2]
    if ($rawPath -match '^([^?]+)') { $pathOnly = $Matches[1] } else { $pathOnly = $rawPath }
    $pathOnly = [System.Uri]::UnescapeDataString($pathOnly)
    $cl = 0L
    foreach ($ln in $lines) {
        if ($ln -match '^(?i)Content-Length:\s*(\d+)') { $cl = [int64]$Matches[1] }
    }
    $bodyMs = New-Object System.IO.MemoryStream
    $already = $all.Length - $headerByteLen
    if ($already -gt 0) {
        $bodyMs.Write($all, $headerByteLen, $already)
    }
    while ($bodyMs.Length -lt $cl) {
        $need = [int][Math]::Min($buf.Length, $cl - $bodyMs.Length)
        $n = $Stream.Read($buf, 0, $need)
        if ($n -le 0) { break }
        $bodyMs.Write($buf, 0, $n)
    }
    $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyMs.ToArray())
    return @{
        Method = $method
        Path   = $pathOnly.TrimEnd('/')
        Body   = $bodyText
    }
}

function Send-RawHttpResponse {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$Reason,
        [string]$ContentType,
        [string]$Body
    )
    $enc = [System.Text.Encoding]::UTF8
    $bodyBytes = $enc.GetBytes($Body)
    $statusLine = "HTTP/1.1 $StatusCode $Reason`r`n"
    $h = "Content-Type: $ContentType`r`nContent-Length: $($bodyBytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $headBytes = $enc.GetBytes($statusLine + $h)
    $Stream.Write($headBytes, 0, $headBytes.Length)
    $Stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $Stream.Flush()
}

$tcpListener = $null
try {
    $tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $tcpListener.Start()
} catch {
    Write-Host ""
    Write-Host "No se pudo abrir el puerto $Port en 127.0.0.1." -ForegroundColor Red
    Write-Host "  Motivo: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Pruebe: .\scripts\Start-MaintenanceUI.ps1 -Port 17382" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Presione Enter para salir"
    exit 1
}

$browserUrl = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "=== InformeCliente - UI mantenimiento (TcpListener, sin urlacl) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Use esta URL en el navegador:" -ForegroundColor Yellow
Write-Host "  $browserUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Si 'localhost' da error, use siempre 127.0.0.1 (escucha solo IPv4 loopback)." -ForegroundColor DarkGray
Write-Host "  Deje esta ventana ABIERTA; si la cierra -> ERR_CONNECTION_REFUSED." -ForegroundColor DarkYellow
Write-Host "  Repo: $root" -ForegroundColor Gray
Write-Host "  Ctrl+C para detener." -ForegroundColor Gray
Write-Host ""

if (-not $NoBrowser) {
    try {
        Start-Process $browserUrl
    } catch {
        Write-Host "  No se pudo abrir el navegador automaticamente." -ForegroundColor DarkYellow
    }
}

try {
    while ($true) {
        $client = $null
        $stream = $null
        try {
            $client = $tcpListener.AcceptTcpClient()
            $stream = $client.GetStream()
            $stream.ReadTimeout = 120000
            $stream.WriteTimeout = 120000

            $req = Read-HttpRequest -Stream $stream
            if (-not $req) {
                continue
            }

            $path = $req.Path
            if ([string]::IsNullOrEmpty($path)) { $path = "/" }
            if ($path -eq "") { $path = "/" }

            $method = $req.Method

            if ($method -eq "OPTIONS") {
                Send-RawHttpResponse -Stream $stream -StatusCode 204 -Reason "No Content" -ContentType "text/plain" -Body ""
                continue
            }

            if ($method -eq "GET" -and $path -eq "/") {
                $htmlPath = Join-Path $uiDir "index.html"
                $html = Get-Content -LiteralPath $htmlPath -Raw -Encoding UTF8
                Send-RawHttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -ContentType "text/html; charset=utf-8" -Body $html
                continue
            }

            if ($method -eq "GET" -and $path -eq "/app.js") {
                $jsPath = Join-Path $uiDir "app.js"
                $js = Get-Content -LiteralPath $jsPath -Raw -Encoding UTF8
                Send-RawHttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -ContentType "application/javascript; charset=utf-8" -Body $js
                continue
            }

            if ($method -eq "GET" -and $path -eq "/api/scripts") {
                $json = ($manifest | ConvertTo-Json -Depth 8 -Compress)
                Send-RawHttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -ContentType "application/json; charset=utf-8" -Body $json
                continue
            }

            if ($method -eq "POST" -and $path -eq "/api/run") {
                $rawBody = $req.Body
                $payload = $null
                try {
                    $payload = $rawBody | ConvertFrom-Json
                } catch {
                    $errObj = (@{ error = "JSON invalido"; output = ""; exitCode = -1 } | ConvertTo-Json -Compress)
                    Send-RawHttpResponse -Stream $stream -StatusCode 400 -Reason "Bad Request" -ContentType "application/json; charset=utf-8" -Body $errObj
                    continue
                }

                $scriptId = [string]$payload.scriptId
                $entry = $manifest.scripts | Where-Object { $_.id -eq $scriptId } | Select-Object -First 1

                if (-not $entry) {
                    $errObj = (@{ error = "Script no permitido (id)"; output = ""; exitCode = -1 } | ConvertTo-Json -Compress)
                    Send-RawHttpResponse -Stream $stream -StatusCode 400 -Reason "Bad Request" -ContentType "application/json; charset=utf-8" -Body $errObj
                    continue
                }

                $safePath = Get-SafeScriptPath -FileName $entry.file
                if (-not $safePath) {
                    $errObj = (@{ error = "Archivo no encontrado o ruta invalida"; output = ""; exitCode = -1 } | ConvertTo-Json -Compress)
                    Send-RawHttpResponse -Stream $stream -StatusCode 400 -Reason "Bad Request" -ContentType "application/json; charset=utf-8" -Body $errObj
                    continue
                }

                $log = New-Object System.Collections.ArrayList
                $exitCode = 0

                Push-Location -LiteralPath $root
                try {
                    $oldEap = $ErrorActionPreference
                    $ErrorActionPreference = "Continue"
                    & $safePath *>&1 | ForEach-Object { [void]$log.Add($_.ToString()) }
                    $ErrorActionPreference = $oldEap
                    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
                        $exitCode = $LASTEXITCODE
                    }
                } catch {
                    [void]$log.Add("EXCEPCION: $($_.Exception.Message)")
                    $exitCode = 1
                } finally {
                    Pop-Location
                }

                $outObj = @{
                    ok       = ($exitCode -eq 0)
                    exitCode = $exitCode
                    output   = ($log -join "`n")
                }
                $outJson = ($outObj | ConvertTo-Json -Depth 4 -Compress)
                Send-RawHttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -ContentType "application/json; charset=utf-8" -Body $outJson
                continue
            }

            Send-RawHttpResponse -Stream $stream -StatusCode 404 -Reason "Not Found" -ContentType "text/plain; charset=utf-8" -Body "Not found"
        } catch {
            try {
                if ($null -ne $stream -and $stream.CanWrite) {
                    Send-RawHttpResponse -Stream $stream -StatusCode 500 -Reason "Error" -ContentType "text/plain; charset=utf-8" -Body $_.Exception.Message
                }
            } catch { }
        } finally {
            if ($null -ne $client) {
                try { $client.Close() } catch { }
            }
        }
    }
} finally {
    if ($null -ne $tcpListener) {
        try { $tcpListener.Stop() } catch { }
    }
}
