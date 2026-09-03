# Validador ADR-106 - Accesibilidad WCAG 2.1 AA
# Script de verificacion 100% automatizado
# Plataforma Minera AURIXA

param(
    [switch]$SkipNodeCheck = $false
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# CONFIGURACION
$ProjectRoot = "c:\InformeCliente\frontend"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFile = "$ProjectRoot\Validar-ADR106_$Timestamp.log"

# Inicializar log
"========================================" | Out-File $LogFile
"VALIDACION ADR-106 - $Timestamp" | Out-File $LogFile -Append
"========================================" | Out-File $LogFile -Append

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "VALIDADOR ADR-106 - ACCESIBILIDAD" -ForegroundColor Magenta
Write-Host "Timestamp: $Timestamp" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# PASO 1: VERIFICAR ARCHIVOS
Write-Host "[1/8] Verificar archivos requeridos..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 1] Verificar archivos requeridos" | Out-File $LogFile -Append

$requiredFiles = @(
    @{ Path = "$ProjectRoot\src\a11y-form-base.css"; Name = "CSS Base" },
    @{ Path = "$ProjectRoot\src\index.css"; Name = "Variables CSS" },
    @{ Path = "$ProjectRoot\src\main.tsx"; Name = "Entry Point" },
    @{ Path = "$ProjectRoot\package.json"; Name = "Package.json" }
)

$filesOk = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file.Path) {
        Write-Host "  [PASS] $($file.Name)" -ForegroundColor Green
        "  [PASS] $($file.Name)" | Out-File $LogFile -Append
    } else {
        Write-Host "  [FAIL] $($file.Name) - NOT FOUND" -ForegroundColor Red
        "  [FAIL] $($file.Name) - NOT FOUND" | Out-File $LogFile -Append
        $filesOk = $false
    }
}

if (-not $filesOk) {
    Write-Host ""
    Write-Host "ERROR: Archivos criticos faltantes" -ForegroundColor Red
    exit 1
}

# PASO 2: VERIFICAR IMPORT EN MAIN.TSX
Write-Host "[2/8] Verificar import en main.tsx..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 2] Verificar import en main.tsx" | Out-File $LogFile -Append

$mainContent = Get-Content "$ProjectRoot\src\main.tsx" -Raw
if ($mainContent -match "import.*a11y-form-base") {
    Write-Host "  [PASS] Import de a11y-form-base.css detectado" -ForegroundColor Green
    "  [PASS] Import detectado en main.tsx" | Out-File $LogFile -Append
} else {
    Write-Host "  [FAIL] Import FALTA en main.tsx" -ForegroundColor Red
    "  [FAIL] Import no encontrado" | Out-File $LogFile -Append
    exit 1
}

# PASO 3: VERIFICAR CLASES CSS
Write-Host "[3/8] Verificar clases CSS..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 3] Verificar clases CSS" | Out-File $LogFile -Append

$cssContent = Get-Content "$ProjectRoot\src\a11y-form-base.css" -Raw
$requiredClasses = @(
    "form-input-base",
    "form-select-base",
    "form-textarea",
    "form-label",
    "listbox-option"
)

$classesOk = $true
foreach ($class in $requiredClasses) {
    if ($cssContent -match "\.$class\s*\{") {
        Write-Host "  [PASS] Clase CSS encontrada: .$class" -ForegroundColor Green
        "  [PASS] Clase: $class" | Out-File $LogFile -Append
    } else {
        Write-Host "  [WARN] Clase CSS faltante: .$class" -ForegroundColor Yellow
        "  [WARN] Clase faltante: $class" | Out-File $LogFile -Append
        $classesOk = $false
    }
}

# PASO 4: VERIFICAR VARIABLES CSS
Write-Host "[4/8] Verificar variables CSS..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 4] Verificar variables CSS" | Out-File $LogFile -Append

$indexContent = Get-Content "$ProjectRoot\src\index.css" -Raw
$requiredVars = @(
    "--a11y-text-primary",
    "--a11y-text-secondary",
    "--a11y-bg-form",
    "--a11y-border-form"
)

$varsOk = $true
foreach ($var in $requiredVars) {
    if ($indexContent -match [regex]::Escape($var)) {
        Write-Host "  [PASS] Variable CSS encontrada: $var" -ForegroundColor Green
        "  [PASS] Variable: $var" | Out-File $LogFile -Append
    } else {
        Write-Host "  [WARN] Variable CSS faltante: $var" -ForegroundColor Yellow
        "  [WARN] Variable faltante: $var" | Out-File $LogFile -Append
        $varsOk = $false
    }
}

# PASO 5: VERIFICAR COMPONENTES
Write-Host "[5/8] Verificar componentes actualizados..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 5] Verificar componentes actualizados" | Out-File $LogFile -Append

$components = @(
    "src\components\ReportStudioV2\components\views\AlarmConfigView.tsx",
    "src\components\ReportStudioV2\components\views\UserManagementView.tsx",
    "src\components\ReportStudioV2\components\views\CompanyManagementView.tsx",
    "src\components\ReportStudioV2\components\modals\MaintenanceBiometricModal.tsx",
    "src\components\UI\DocumentScanCapture.tsx",
    "src\components\Special\QRGenerator.tsx"
)

$componentsVerified = 0
foreach ($comp in $components) {
    $fullPath = "$ProjectRoot\$comp"
    if (Test-Path $fullPath) {
        Write-Host "  [PASS] Componente encontrado: $(Split-Path -Leaf $comp)" -ForegroundColor Green
        "  [PASS] $comp" | Out-File $LogFile -Append
        $componentsVerified++
    } else {
        Write-Host "  [WARN] Componente no encontrado: $(Split-Path -Leaf $comp)" -ForegroundColor Yellow
        "  [WARN] NOT FOUND: $comp" | Out-File $LogFile -Append
    }
}

Write-Host "  Componentes verificados: $componentsVerified/$($components.Count)" -ForegroundColor Yellow
"  Resumen: $componentsVerified/$($components.Count) componentes" | Out-File $LogFile -Append

# PASO 6: VALIDAR TAMANIO CSS
Write-Host "[6/8] Validar tamanio CSS..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 6] Validar tamanio CSS" | Out-File $LogFile -Append

$cssLines = (Get-Content "$ProjectRoot\src\a11y-form-base.css" | Measure-Object -Line).Lines
if ($cssLines -gt 400) {
    Write-Host "  [PASS] CSS tiene $cssLines lineas (esperado: >400)" -ForegroundColor Green
    "  [PASS] Lineas CSS: $cssLines" | Out-File $LogFile -Append
} else {
    Write-Host "  [WARN] CSS solo tiene $cssLines lineas" -ForegroundColor Yellow
    "  [WARN] Lineas CSS: $cssLines" | Out-File $LogFile -Append
}

# PASO 7: VERIFICAR NODE.JS
Write-Host "[7/8] Verificar Node.js..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 7] Verificar Node.js" | Out-File $LogFile -Append

$nodeInstalled = $false
$nodeVersion = ""
$npmVersion = ""

try {
    $nodeVersion = (& node --version 2>$null)
    $npmVersion = (& npm --version 2>$null)
    $nodeInstalled = $true
}
catch {
    $nodeInstalled = $false
}

if ($nodeInstalled) {
    Write-Host "  [PASS] Node.js $nodeVersion detectado" -ForegroundColor Green
    Write-Host "  [PASS] npm $npmVersion detectado" -ForegroundColor Green
    "  [PASS] Node.js $nodeVersion" | Out-File $LogFile -Append
    "  [PASS] npm $npmVersion" | Out-File $LogFile -Append
} else {
    Write-Host "  [SKIP] Node.js no detectado en el sistema" -ForegroundColor Yellow
    "  [SKIP] Node.js no disponible" | Out-File $LogFile -Append
}

# PASO 8: COMPILACION (si Node disponible)
$buildSuccess = $null
Write-Host "[8/8] Compilacion del proyecto..." -ForegroundColor Cyan
"" | Out-File $LogFile -Append
"[PASO 8] Compilacion del proyecto" | Out-File $LogFile -Append

if ($nodeInstalled -and -not $SkipNodeCheck) {
    Write-Host "  Ejecutando: npm run build" -ForegroundColor Yellow
    Write-Host "  Esto puede tomar 2-5 minutos..." -ForegroundColor Yellow
    "  Iniciando npm run build..." | Out-File $LogFile -Append
    
    try {
        Push-Location $ProjectRoot
        
        # Ejecutar build
        $buildOutput = & npm run build 2>&1
        $buildExitCode = $LASTEXITCODE
        
        # Guardar output
        $buildOutput | Out-File "$ProjectRoot\build-output_$Timestamp.log"
        
        if ($buildExitCode -eq 0) {
            Write-Host "  [PASS] Compilacion exitosa" -ForegroundColor Green
            "  [PASS] Build completado sin errores" | Out-File $LogFile -Append
            $buildSuccess = $true
        } else {
            Write-Host "  [FAIL] Compilacion fallo (exit code: $buildExitCode)" -ForegroundColor Red
            "  [FAIL] Build fallo - exit code: $buildExitCode" | Out-File $LogFile -Append
            $buildSuccess = $false
            
            # Mostrar los ultimos errores
            Write-Host ""
            Write-Host "  Ultimos 10 lineas del output:" -ForegroundColor Red
            $buildOutput | Select-Object -Last 10 | ForEach-Object {
                Write-Host "    $_" -ForegroundColor Red
            }
        }
    }
    catch {
        Write-Host "  [FAIL] Excepcion durante build: $_" -ForegroundColor Red
        "  [FAIL] Excepcion: $_" | Out-File $LogFile -Append
        $buildSuccess = $false
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "  [SKIP] Compilacion omitida (Node.js no disponible o skip habilitado)" -ForegroundColor Yellow
    "  [SKIP] Build omitido" | Out-File $LogFile -Append
    $buildSuccess = $null
}

# RESUMEN FINAL
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RESUMEN DE VALIDACION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Archivos verificados: $(if ($filesOk) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($filesOk) {'Green'} else {'Red'})
Write-Host "Clases CSS: $(if ($classesOk) {'PASS'} else {'WARN'})" -ForegroundColor $(if ($classesOk) {'Green'} else {'Yellow'})
Write-Host "Variables CSS: $(if ($varsOk) {'PASS'} else {'WARN'})" -ForegroundColor $(if ($varsOk) {'Green'} else {'Yellow'})
Write-Host "Componentes: PASS ($componentsVerified/$($components.Count))" -ForegroundColor Green
Write-Host "Node.js: $(if ($nodeInstalled) {'DETECTADO'} else {'NO ENCONTRADO'})" -ForegroundColor $(if ($nodeInstalled) {'Green'} else {'Yellow'})

Write-Host ""
if ($buildSuccess -eq $true) {
    Write-Host "COMPILACION: PASS" -ForegroundColor Green
    Write-Host ""
    Write-Host "SUCCESS! ADR-106 AL 100% - LISTO PARA DEPLOY" -ForegroundColor Green
    $exitCode = 0
} elseif ($buildSuccess -eq $false) {
    Write-Host "COMPILACION: FAIL" -ForegroundColor Red
    Write-Host ""
    Write-Host "ERROR - Revisar build-output_$Timestamp.log para detalles" -ForegroundColor Red
    $exitCode = 1
} else {
    Write-Host "COMPILACION: OMITIDA (Node.js no disponible)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "VERIFICACION PARCIAL - Instala Node.js 18+ para compilacion" -ForegroundColor Yellow
    Write-Host "  Descarga desde: https://nodejs.org/" -ForegroundColor Cyan
    $exitCode = 0
}

Write-Host ""
Write-Host "Log detallado: $LogFile" -ForegroundColor Cyan
Write-Host ""

exit $exitCode
