# Lanzador del servidor de desarrollo (Vite) para pruebas en red local.
#
# Desactiva "QuickEdit Mode" de esta ventana de consola. Sin esto, un
# clic accidental dentro de la ventana negra pausa TODO el proceso de
# Windows (no solo la seleccion de texto) hasta soltar clic o pulsar
# Enter -- se ve identico a una "desconexion" con la otra laptop
# aunque el servidor nunca se cayo. Este cambio es solo para esta
# ventana/sesion, no toca ninguna configuracion del sistema.
try {
    Add-Type -Name Console -Namespace Win32NativeMethods -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll")]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll")]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@ -ErrorAction Stop

    $STD_INPUT_HANDLE      = -10
    $ENABLE_QUICK_EDIT     = 0x0040
    $ENABLE_EXTENDED_FLAGS = 0x0080

    $handle = [Win32NativeMethods.Console]::GetStdHandle($STD_INPUT_HANDLE)
    [uint32]$mode = 0
    if ([Win32NativeMethods.Console]::GetConsoleMode($handle, [ref]$mode)) {
        $mode = $mode -band (-bnot $ENABLE_QUICK_EDIT)
        $mode = $mode -bor $ENABLE_EXTENDED_FLAGS
        [Win32NativeMethods.Console]::SetConsoleMode($handle, $mode) | Out-Null
    }
} catch {
    Write-Host "(No se pudo desactivar QuickEdit Mode, no es critico: $_)"
}

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $ScriptDir "frontend"

if (-not (Test-Path (Join-Path $FrontendDir "package.json"))) {
    Write-Host "No se encontro frontend\package.json en `"$FrontendDir`""
    Write-Host "Este script debe estar en la raiz del proyecto InformeCliente."
    Read-Host "Presiona Enter para salir"
    exit 1
}

$env:PATH = "$env:PATH;C:\Program Files\nodejs;$env:APPDATA\npm"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "No se encontro `"npm`" en el PATH ni en C:\Program Files\nodejs."
    Write-Host "Instala Node.js desde https://nodejs.org/ o revisa el PATH del sistema."
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "============================================"
Write-Host " Iniciando servidor de desarrollo (Vite)"
Write-Host " Carpeta: $FrontendDir"
Write-Host "============================================"
Write-Host ""
Write-Host "Cuando arranque, busca la linea 'Network:' en la consola"
Write-Host "(puerto fijo 5180) y usa esa URL desde la otra laptop."
Write-Host "La IP puede cambiar si cambia la red Wi-Fi; usa siempre"
Write-Host "la que muestre la consola en ese momento."
Write-Host ""
Write-Host "IMPORTANTE: no hagas clic con el mouse dentro de esta"
Write-Host "ventana mientras alguien este probando desde otra laptop"
Write-Host "(ya deberia estar corregido, pero si la ventana se queda"
Write-Host "'congelada', presiona Enter aqui para liberarla)."
Write-Host ""

Push-Location $FrontendDir
try {
    npm run dev
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "El servidor se detuvo o hubo un error. Revisa el mensaje de arriba."
Read-Host "Presiona Enter para cerrar"
