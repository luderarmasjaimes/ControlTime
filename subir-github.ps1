# ==========================================
# CONFIGURACION
# ==========================================

$repoPath = "C:\InformeCliente"
$repoURL  = "https://github.com/luderarmasjaimes/ControlTime.git"
$branch   = "main"

Write-Host "====================================="
Write-Host "SUBIDA AUTOMATICA A GITHUB"
Write-Host "====================================="

# ==========================================
# IR AL PROYECTO
# ==========================================

Set-Location $repoPath

Write-Host "Directorio actual:"
Get-Location

# ==========================================
# BORRAR HISTORIAL GIT
# ==========================================

if (Test-Path ".git") {
    Write-Host "Eliminando historial Git antiguo..."
    Remove-Item ".git" -Recurse -Force
}

# ==========================================
# CREAR .gitignore
# ==========================================

Write-Host "Creando .gitignore..."

@"
data/
tmp/

*.ecw
*.mbtiles
*.tif
*.msi
*.zip

node_modules/
dist/
build/
.env
"@ | Out-File ".gitignore" -Encoding UTF8

# ==========================================
# INICIALIZAR GIT
# ==========================================

Write-Host "Inicializando repositorio Git..."

git init

# ==========================================
# AGREGAR ARCHIVOS
# ==========================================

Write-Host "Agregando archivos..."

git add .

# ==========================================
# COMMIT
# ==========================================

Write-Host "Creando commit..."

git commit -m "Initial clean repository upload"

# ==========================================
# CONECTAR GITHUB
# ==========================================

Write-Host "Conectando repositorio remoto..."

git remote add origin $repoURL

# ==========================================
# SUBIR
# ==========================================

Write-Host "Subiendo a GitHub..."

git push -u origin $branch --force

Write-Host "====================================="
Write-Host "PROCESO TERMINADO"
Write-Host "====================================="