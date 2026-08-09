#!/usr/bin/env pwsh
# Importa logotipos (SVG) y galería de fotos (JPEG) por empresa desde
# C:\InformeCliente\IMAGENES a la base de datos (ADR-046/047).
#
# Convención ESTANDARIZADA (una sola carpeta, un solo script, para ambos
# tipos de imagen): una subcarpeta por empresa dentro de IMAGENES, cuyo
# nombre debe corresponder al nombre de la empresa TAL COMO aparece arriba
# de la plataforma (Empresa | Unidad) — el emparejamiento tolera mayúsculas,
# acentos y guiones/espacios distintos, ver normalizeSlug() en
# tenant_assets_routes.cpp. Dentro de cada subcarpeta:
#   - cualquier archivo *.svg  → se sube como LOGOTIPO de esa empresa
#   - cualquier archivo *.jpg/*.jpeg → se sube a la GALERÍA de esa empresa
#     (fotos de la unidad minera, insertables luego en cualquier página del
#     informe desde la pestaña "Galería" del diálogo Insertar Imagen)
#
# Ejemplo:
#   C:\InformeCliente\IMAGENES\Compania Minera Antamina\logo.svg
#   C:\InformeCliente\IMAGENES\Compania Minera Antamina\planta_concentradora.jpg
#   C:\InformeCliente\IMAGENES\Compania Minera Antamina\relave_norte.jpg
#
# El trabajo pesado (validar, generar miniatura JPEG con OpenCV, calcular
# hash, guardar en Postgres) lo hace el BACKEND — este script solo dispara
# el job admin-only que ya lee /imagenes (bind mount de solo lectura de esta
# misma carpeta, ver docker-compose.yml) y procesa TODAS las empresas de una
# sola vez. No requiere copiar nada al contenedor ni reiniciar nada: basta
# con que el stack esté arriba (docker compose up).
#
# Uso:
#   .\scripts\import-tenant-assets.ps1 -Company "Compania Minera Antamina" -Username admin_user -Password ********
#
# (Cualquier usuario con rol admin de CUALQUIER empresa sirve — el job
# recorre TODAS las subcarpetas de IMAGENES en una sola ejecución.)

param(
    [Parameter(Mandatory = $true)][string]$Company,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$BaseUrl = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"

Write-Host "Autenticando como $Username ($Company)..."
$loginBody = @{ company = $Company; username = $Username; password = $Password } | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login/password" `
        -ContentType "application/json" -Body $loginBody
} catch {
    throw "Login falló: $($_.Exception.Message)"
}

$token = $loginResp.user.access_token
if (-not $token) { throw "La respuesta de login no trajo access_token." }
if ($loginResp.user.role -ne "admin") {
    Write-Warning "El usuario '$Username' no tiene rol admin (rol actual: $($loginResp.user.role)) — el servidor rechazará la importación."
}

Write-Host "Disparando importación desde /imagenes (montaje de C:\InformeCliente\IMAGENES)..."
$headers = @{ Authorization = "Bearer $token" }
$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/platform/assets/import" -Headers $headers

Write-Host ""
Write-Host "Importados: $($result.imported.Count)"
$result.imported | ForEach-Object { Write-Host "  OK   $($_.folder)/$($_.file) -> tenant_id $($_.tenant_id)" }
Write-Host ""
Write-Host "Omitidos: $($result.skipped.Count)"
$result.skipped | ForEach-Object { Write-Host "  SKIP $($_.folder)$(if ($_.file) { '/' + $_.file }) — $($_.reason)" }
